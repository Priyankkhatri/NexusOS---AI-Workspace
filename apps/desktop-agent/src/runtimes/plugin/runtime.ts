import crypto from 'node:crypto';
import { createEventEnvelope, EventEnvelope, ErrorCategory } from '@nexusos/contracts';
import { ExecutionLeaseBoundary } from '../../permissions/lease-boundary.js';
import { RuntimeCategory, ToolRuntimeDescriptor } from '../../registry/runtime-registry.js';
import { AgentLogger } from '../../observability/agent-logger.js';
import { PluginCatalog } from './catalog.js';
import { PluginPolicyGateway } from './policy-gateway.js';
import { PluginQuarantineStore } from './quarantine-store.js';
import {
  PluginInvocationRequest,
  PluginOperationName,
  PluginOperationRequestContext,
  PluginOperationResult,
  PluginPackage,
} from './types.js';
import { PluginVerifier } from './verifier.js';

export class PluginRuntime {
  public static readonly RUNTIME_ID = 'rt:plugin-v1';

  constructor(
    private readonly leaseBoundary: ExecutionLeaseBoundary,
    public readonly verifier: PluginVerifier = new PluginVerifier(),
    public readonly catalog: PluginCatalog = new PluginCatalog(),
    public readonly quarantineStore: PluginQuarantineStore = new PluginQuarantineStore(),
    public readonly policyGateway: PluginPolicyGateway = new PluginPolicyGateway(),
    private readonly logger?: AgentLogger,
  ) {}

  public getDescriptor(): ToolRuntimeDescriptor {
    return Object.freeze({
      runtimeId: PluginRuntime.RUNTIME_ID,
      category: RuntimeCategory.PLUGIN,
      version: '0.1.0-sprint0',
      isExecutable: true,
      supportedActions: [
        PluginOperationName.VERIFY,
        PluginOperationName.INSTALL,
        PluginOperationName.ACTIVATE,
        PluginOperationName.INVOKE,
        PluginOperationName.SUSPEND,
        PluginOperationName.QUARANTINE,
      ],
    });
  }

  /**
   * Verifies plugin package signature, manifest, and trust level.
   */
  public async verifyPluginPackage(
    pkg: PluginPackage,
    context: PluginOperationRequestContext,
  ): Promise<{ result: PluginOperationResult<boolean>; event: EventEnvelope }> {
    return this.executeProtectedOperation(
      PluginOperationName.VERIFY,
      pkg?.manifest?.pluginId || '',
      context,
      async () => {
        const vRes = this.verifier.verifyPlugin(pkg);
        if (!vRes.valid) {
          return {
            data: false,
            error: vRes.error,
          };
        }
        return { data: true };
      },
    );
  }

  /**
   * Verifies and installs a plugin package into the PluginCatalog.
   */
  public async installPlugin(
    pkg: PluginPackage,
    context: PluginOperationRequestContext,
  ): Promise<{ result: PluginOperationResult<boolean>; event: EventEnvelope }> {
    return this.executeProtectedOperation(
      PluginOperationName.INSTALL,
      pkg?.manifest?.pluginId || '',
      context,
      async () => {
        const vRes = this.verifier.verifyPlugin(pkg);
        if (!vRes.valid) {
          return {
            data: false,
            error: vRes.error,
          };
        }

        const pluginId = pkg.manifest.pluginId;
        if (this.quarantineStore.isQuarantined(pluginId)) {
          return {
            data: false,
            error: {
              code: 'PLUGIN_QUARANTINED',
              message: `Plugin '${pluginId}' is currently quarantined and cannot be installed.`,
            },
          };
        }

        this.catalog.registerPackage(pkg, 'INSTALLED');
        return { data: true };
      },
    );
  }

  /**
   * Activates an installed plugin package for invocation.
   */
  public async activatePlugin(
    pluginId: string,
    context: PluginOperationRequestContext,
  ): Promise<{ result: PluginOperationResult<boolean>; event: EventEnvelope }> {
    return this.executeProtectedOperation(
      PluginOperationName.ACTIVATE,
      pluginId,
      context,
      async () => {
        if (this.quarantineStore.isQuarantined(pluginId)) {
          return {
            data: false,
            error: {
              code: 'PLUGIN_QUARANTINED',
              message: `Plugin '${pluginId}' is quarantined and cannot be activated.`,
            },
          };
        }

        const entry = this.catalog.getEntry(pluginId);
        if (!entry) {
          return {
            data: false,
            error: {
              code: 'PLUGIN_NOT_FOUND',
              message: `Plugin '${pluginId}' is not registered in the catalog.`,
            },
          };
        }

        this.catalog.setPluginState(pluginId, 'ACTIVATED');
        return { data: true };
      },
    );
  }

  /**
   * Invokes a plugin capability within a sandboxed host environment.
   */
  public async invokePlugin(
    request: PluginInvocationRequest,
    context: PluginOperationRequestContext,
  ): Promise<{ result: PluginOperationResult<unknown>; event: EventEnvelope }> {
    return this.executeProtectedOperation(
      PluginOperationName.INVOKE,
      request.pluginId,
      context,
      async () => {
        const pluginId = request.pluginId;

        // 1. Quarantine Check
        if (this.quarantineStore.isQuarantined(pluginId)) {
          return {
            data: null,
            error: {
              code: 'PLUGIN_QUARANTINED',
              message: `Plugin '${pluginId}' is quarantined and cannot be invoked.`,
            },
          };
        }

        // 2. Catalog Entry Check
        const entry = this.catalog.getEntry(pluginId);
        if (!entry || entry.state !== 'ACTIVATED') {
          return {
            data: null,
            error: {
              code: 'PLUGIN_NOT_ACTIVE',
              message: `Plugin '${pluginId}' is not active. Current state: '${entry?.state || 'UNREGISTERED'}'.`,
            },
          };
        }

        // 3. Policy Gateway Capability Check
        const policyCheck = this.policyGateway.evaluateInvocation(
          request,
          entry.package.manifest,
          context,
        );

        if (!policyCheck.allowed) {
          return {
            data: null,
            error: policyCheck.error,
          };
        }

        // 4. Simulate Sandboxed Host Execution
        const mockHostResult = {
          invokedPluginId: pluginId,
          capability: request.capability,
          action: request.action,
          executedInSandboxHost: true,
          output: `Plugin host executed capability '${request.capability}:${request.action}' safely.`,
        };

        return { data: mockHostResult };
      },
    );
  }

  /**
   * Suspends an active plugin.
   */
  public async suspendPlugin(
    pluginId: string,
    context: PluginOperationRequestContext,
  ): Promise<{ result: PluginOperationResult<boolean>; event: EventEnvelope }> {
    return this.executeProtectedOperation(
      PluginOperationName.SUSPEND,
      pluginId,
      context,
      async () => {
        const updated = this.catalog.setPluginState(pluginId, 'SUSPENDED');
        return { data: updated };
      },
    );
  }

  /**
   * Quarantines a plugin package due to failure, crash loop, or signature violation.
   */
  public async quarantinePlugin(
    pluginId: string,
    reason: string,
    context: PluginOperationRequestContext,
  ): Promise<{ result: PluginOperationResult<boolean>; event: EventEnvelope }> {
    return this.executeProtectedOperation(
      PluginOperationName.QUARANTINE,
      pluginId,
      context,
      async () => {
        this.quarantineStore.quarantinePlugin(pluginId, reason);
        this.catalog.setPluginState(pluginId, 'QUARANTINED');
        return { data: true };
      },
    );
  }

  /**
   * Centralized protected operation boundary.
   */
  private async executeProtectedOperation<T>(
    operation: PluginOperationName,
    pluginId: string,
    context: PluginOperationRequestContext,
    action: () => Promise<{
      data: T;
      error?: { code: string; message: string };
    }>,
  ): Promise<{ result: PluginOperationResult<T>; event: EventEnvelope }> {
    const evidenceId = crypto.randomUUID();

    // 1. Lease & Policy Evaluation
    const leaseResult = await this.leaseBoundary.validateLease(context.lease, context.subject);
    if (!leaseResult.valid || !leaseResult.lease) {
      return this.buildDeniedResult(
        operation,
        pluginId,
        context,
        'LEASE_OR_POLICY_INVALID',
        leaseResult.reason || 'Lease validation failed',
      );
    }

    // 2. Capability Scope Check
    const requiredScope = operation;
    if (
      !context.lease.scopes.includes(requiredScope) &&
      !context.lease.scopes.includes('plugin:invoke')
    ) {
      return this.buildDeniedResult(
        operation,
        pluginId,
        context,
        'MISSING_CAPABILITY_SCOPE',
        `Lease does not grant capability '${requiredScope}'.`,
      );
    }

    // 3. Action Execution
    try {
      const outcome = await action();

      if (outcome.error) {
        return this.buildDeniedResult(
          operation,
          pluginId,
          context,
          outcome.error.code,
          outcome.error.message,
        );
      }

      const result: PluginOperationResult<T> = {
        success: true,
        operation,
        pluginId,
        data: outcome.data,
        evidenceId,
      };

      const eventSchema =
        operation === PluginOperationName.INVOKE
          ? 'invocation_completed'
          : operation.replace('plugin:', '');
      const eventPayload: Record<string, unknown> = {
        operation,
        pluginId,
        taskId: context.lease.task_id,
        leaseId: context.lease.lease_id,
        agentId: context.lease.agent_id,
        tenantId: context.lease.tenant_id,
        status: 'SUCCESS',
      };

      const event = createEventEnvelope(
        `nexusos.events.plugin.${eventSchema}.v1`,
        '1.0.0',
        context.lease.agent_id,
        context.lease.nonce || context.lease.task_id,
        eventPayload,
      );

      this.logger?.info(`Plugin operation completed: ${operation}`, {
        operation,
        pluginId,
        status: 'SUCCESS',
      });

      return { result, event };
    } catch (err) {
      const errCategory = (err as { category?: ErrorCategory }).category || ErrorCategory.SYSTEM;
      const errCode = (err as { code?: string }).code || 'PLUGIN_OPERATION_FAILED';
      const errMessage = err instanceof Error ? err.message : String(err);

      const result: PluginOperationResult<T> = {
        success: false,
        operation,
        pluginId,
        evidenceId,
        error: {
          code: errCode,
          category: errCategory,
          message: errMessage,
        },
      };

      const eventPayload: Record<string, unknown> = {
        operation,
        pluginId,
        taskId: context.lease.task_id,
        leaseId: context.lease.lease_id,
        agentId: context.lease.agent_id,
        tenantId: context.lease.tenant_id,
        status: 'FAILED',
        errorCode: errCode,
        errorMessage: errMessage,
      };

      const event = createEventEnvelope(
        'nexusos.events.plugin.error.v1',
        '1.0.0',
        context.lease.agent_id,
        context.lease.nonce || context.lease.task_id,
        eventPayload,
      );

      return { result, event };
    }
  }

  private buildDeniedResult<T>(
    operation: PluginOperationName,
    pluginId: string,
    context: PluginOperationRequestContext,
    code: string,
    message: string,
  ): { result: PluginOperationResult<T>; event: EventEnvelope } {
    const evidenceId = crypto.randomUUID();

    const result: PluginOperationResult<T> = {
      success: false,
      operation,
      pluginId,
      evidenceId,
      error: {
        code,
        category: ErrorCategory.AUTHORIZATION,
        message,
      },
    };

    const eventPayload: Record<string, unknown> = {
      operation,
      pluginId,
      taskId: context.lease.task_id,
      leaseId: context.lease.lease_id,
      agentId: context.lease.agent_id,
      tenantId: context.lease.tenant_id,
      status: 'DENIED',
      errorCode: code,
      errorMessage: message,
    };

    const event = createEventEnvelope(
      'nexusos.events.plugin.denied.v1',
      '1.0.0',
      context.lease.agent_id,
      context.lease.nonce || context.lease.task_id,
      eventPayload,
    );

    return { result, event };
  }
}
