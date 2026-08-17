import { createNexusOSError, ErrorCategory, NexusOSError } from '@nexusos/contracts';
import { ExecutionLeaseBoundary } from '../../permissions/lease-boundary.js';
import { RuntimeCategory, ToolRuntimeDescriptor } from '../../registry/runtime-registry.js';
import { AgentLogger } from '../../observability/agent-logger.js';
import { TelemetryManager } from '../../telemetry/telemetry-manager.js';
import { RedactionFilter } from '../../telemetry/redaction-filter.js';
import { AgentLifecycleState } from '../../lifecycle/index.js';

import {
  DeviceOperationName,
  DeviceOperationRequest,
  DeviceOperationResult,
  DeviceRuntimeConfig,
  DEFAULT_DEVICE_RUNTIME_CONFIG,
} from './types.js';
import { DeviceOperationRequestSchema, DeviceRuntimeConfigSchema } from './schemas.js';
import { IClipboardAdapter, InMemoryClipboardAdapter } from './clipboard-adapter.js';
import {
  IDeviceCapabilitiesAdapter,
  DefaultDeviceCapabilitiesAdapter,
} from './device-capabilities-adapter.js';
import {
  IDeviceNotificationAdapter,
  DefaultDeviceNotificationAdapter,
} from './device-notification-adapter.js';

export class DeviceRuntime {
  public static readonly RUNTIME_ID = 'rt:device-v1';

  private readonly config: DeviceRuntimeConfig;
  private readonly clipboardAdapter: IClipboardAdapter;
  private readonly capabilitiesAdapter: IDeviceCapabilitiesAdapter;
  private readonly notificationAdapter: IDeviceNotificationAdapter;
  private readonly redactionFilter: RedactionFilter;

  constructor(
    private readonly leaseBoundary: ExecutionLeaseBoundary,
    customConfig?: Partial<DeviceRuntimeConfig>,
    clipboardAdapter?: IClipboardAdapter,
    capabilitiesAdapter?: IDeviceCapabilitiesAdapter,
    notificationAdapter?: IDeviceNotificationAdapter,
    private readonly logger?: AgentLogger,
    private readonly telemetryManager?: TelemetryManager,
    private readonly getAgentLifecycleState?: () => AgentLifecycleState,
  ) {
    this.config = DeviceRuntimeConfigSchema.parse(customConfig || DEFAULT_DEVICE_RUNTIME_CONFIG);
    this.clipboardAdapter =
      clipboardAdapter || new InMemoryClipboardAdapter(this.config.maxClipboardSizeBytes);
    this.capabilitiesAdapter = capabilitiesAdapter || new DefaultDeviceCapabilitiesAdapter();
    this.notificationAdapter = notificationAdapter || new DefaultDeviceNotificationAdapter();
    this.redactionFilter = new RedactionFilter();
  }

  public getDescriptor(): ToolRuntimeDescriptor {
    return Object.freeze({
      runtimeId: DeviceRuntime.RUNTIME_ID,
      category: RuntimeCategory.DEVICE,
      version: '0.1.0-sprint0',
      isExecutable: true,
      supportedActions: [
        DeviceOperationName.CLIPBOARD_READ,
        DeviceOperationName.CLIPBOARD_WRITE,
        DeviceOperationName.CLIPBOARD_CLEAR,
        DeviceOperationName.DEVICE_QUERY_INFO,
        DeviceOperationName.DEVICE_GET_POSTURE,
        DeviceOperationName.DEVICE_SHOW_NOTIFICATION,
      ],
    });
  }

  public async execute(rawRequest: DeviceOperationRequest): Promise<DeviceOperationResult> {
    const executedAt = new Date().toISOString();

    // 1. Check Agent Lifecycle Posture
    if (this.getAgentLifecycleState) {
      const currentState = this.getAgentLifecycleState();
      if (
        currentState === AgentLifecycleState.STOPPING ||
        currentState === AgentLifecycleState.STOPPED ||
        currentState === AgentLifecycleState.FAILED
      ) {
        const err = createNexusOSError(
          'LIFECYCLE_STATE_REJECTED',
          ErrorCategory.VALIDATION,
          `Device operation rejected: Agent is in non-executable state '${currentState}'.`,
          { details: { currentState } },
        );
        return {
          success: false,
          operationName: rawRequest?.operationName || 'unknown',
          error: err,
          executedAt,
        };
      }
    }

    // 2. Validate Request Schema
    const parseResult = DeviceOperationRequestSchema.safeParse(rawRequest);
    if (!parseResult.success) {
      const err = createNexusOSError(
        'INVALID_ARGUMENT',
        ErrorCategory.VALIDATION,
        `Device operation request failed schema validation: ${parseResult.error.message}`,
        { details: { errors: parseResult.error.issues } },
      );
      return {
        success: false,
        operationName: rawRequest?.operationName || 'unknown',
        error: err,
        executedAt,
      };
    }

    const request = parseResult.data;
    const { context, operationName } = request;

    // 3. Validate Execution Lease & Capability Scope
    const leaseDecision = await this.leaseBoundary.validateLease(context.leaseHeader, undefined);

    if (!leaseDecision.valid) {
      const err = createNexusOSError(
        'LEASE_VALIDATION_FAILED',
        ErrorCategory.AUTHORIZATION,
        `Device operation denied: Lease boundary validation failed: ${leaseDecision.reason}`,
        { details: { denyReason: leaseDecision.reason } },
      );
      this.logger?.warn('Device operation denied by lease boundary', {
        operationName,
        denyReason: leaseDecision.reason,
      });
      return {
        success: false,
        operationName,
        error: err,
        executedAt,
      };
    }

    const requiredCapability = this.mapOperationToCapability(operationName);
    const leaseScopes = leaseDecision.lease?.scopes || [];
    const hasScope = leaseScopes.some(
      (s) =>
        s === requiredCapability ||
        s === 'capability:device' ||
        s === 'capability:clipboard' ||
        s === '*',
    );

    if (!hasScope) {
      const err = createNexusOSError(
        'MISSING_REQUIRED_SCOPE',
        ErrorCategory.AUTHORIZATION,
        `Device operation denied: Required capability scope '${requiredCapability}' not present in lease.`,
        { details: { requiredCapability, leaseScopes } },
      );
      this.logger?.warn('Device operation denied: Missing required scope', {
        operationName,
        requiredCapability,
      });
      return {
        success: false,
        operationName,
        error: err,
        executedAt,
      };
    }

    // 4. Dispatch Capability Operation
    try {
      let resultData: unknown;

      switch (operationName) {
        case DeviceOperationName.CLIPBOARD_READ: {
          const rawText = await this.clipboardAdapter.readText();
          if (Buffer.byteLength(rawText, 'utf-8') > this.config.maxClipboardSizeBytes) {
            throw createNexusOSError(
              'PAYLOAD_TOO_LARGE',
              ErrorCategory.VALIDATION,
              `Clipboard payload exceeds maximum size limit of ${this.config.maxClipboardSizeBytes} bytes.`,
            );
          }
          // Redact secrets before returning payload
          resultData = { text: this.redactionFilter.redactString(rawText) };
          break;
        }

        case DeviceOperationName.CLIPBOARD_WRITE: {
          const writeReq = request;
          if (Buffer.byteLength(writeReq.text, 'utf-8') > this.config.maxClipboardSizeBytes) {
            throw createNexusOSError(
              'PAYLOAD_TOO_LARGE',
              ErrorCategory.VALIDATION,
              `Clipboard write payload exceeds maximum size limit of ${this.config.maxClipboardSizeBytes} bytes.`,
            );
          }
          await this.clipboardAdapter.writeText(writeReq.text);
          resultData = { written: true };
          break;
        }

        case DeviceOperationName.CLIPBOARD_CLEAR: {
          await this.clipboardAdapter.clear();
          resultData = { cleared: true };
          break;
        }

        case DeviceOperationName.DEVICE_QUERY_INFO: {
          resultData = await this.capabilitiesAdapter.queryInfo();
          break;
        }

        case DeviceOperationName.DEVICE_GET_POSTURE: {
          resultData = await this.capabilitiesAdapter.getPosture();
          break;
        }

        case DeviceOperationName.DEVICE_SHOW_NOTIFICATION: {
          const notifReq = request;
          const shown = await this.notificationAdapter.showNotification(
            this.redactionFilter.redactString(notifReq.title),
            this.redactionFilter.redactString(notifReq.body),
            notifReq.actionId,
            { taskId: context.taskId, workspaceId: context.workspaceId },
          );
          resultData = { notificationShown: shown };
          break;
        }

        default: {
          throw createNexusOSError(
            'UNSUPPORTED_CAPABILITY',
            ErrorCategory.VALIDATION,
            `Unsupported device operation '${operationName}'.`,
          );
        }
      }

      // Redact sensitive data from result object
      const sanitizedData = this.redactionFilter.redactObject(resultData);

      this.logger?.info('Device operation executed successfully', {
        operationName,
        taskId: context.taskId,
        workspaceId: context.workspaceId,
      });
      this.telemetryManager?.trackTrace('device_operation_executed', { operationName });

      return {
        success: true,
        operationName,
        data: sanitizedData,
        executedAt,
      };
    } catch (err) {
      const nexusErr =
        typeof err === 'object' && err !== null && 'code' in err && 'category' in err
          ? (err as NexusOSError)
          : createNexusOSError(
              'INTERNAL_ERROR',
              ErrorCategory.SYSTEM,
              `Device operation failed: ${err instanceof Error ? err.message : String(err)}`,
            );

      this.logger?.error('Device operation failed', {
        operationName,
        error: nexusErr.message,
      });

      return {
        success: false,
        operationName,
        error: nexusErr,
        executedAt,
      };
    }
  }

  private mapOperationToCapability(operationName: DeviceOperationName): string {
    switch (operationName) {
      case DeviceOperationName.CLIPBOARD_READ:
        return 'capability:clipboard:read';
      case DeviceOperationName.CLIPBOARD_WRITE:
        return 'capability:clipboard:write';
      case DeviceOperationName.CLIPBOARD_CLEAR:
        return 'capability:clipboard:clear';
      case DeviceOperationName.DEVICE_QUERY_INFO:
      case DeviceOperationName.DEVICE_GET_POSTURE:
        return 'capability:device:query';
      case DeviceOperationName.DEVICE_SHOW_NOTIFICATION:
        return 'capability:device:notification';
      default:
        return 'capability:device';
    }
  }
}
