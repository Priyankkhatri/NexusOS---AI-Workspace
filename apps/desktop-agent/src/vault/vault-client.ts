import crypto from 'node:crypto';
import {
  createEventEnvelope,
  EventEnvelope,
  ErrorCategory,
  createNexusOSError,
} from '@nexusos/contracts';
import { ExecutionLeaseBoundary } from '../permissions/lease-boundary.js';
import { AgentLogger } from '../observability/agent-logger.js';
import { SecretInjector } from './injector.js';
import { SecretLeaseResolver } from './lease-resolver.js';
import { SecretRedactionRegistry } from './redaction-registry.js';
import { SecretRevocationHandler } from './revocation-handler.js';
import {
  InjectionChannel,
  InjectionResult,
  SecretLeasePayload,
  VaultOperationName,
  VaultOperationRequestContext,
  VaultOperationResult,
} from './types.js';

export class SecretsVaultClient {
  constructor(
    _leaseBoundary: ExecutionLeaseBoundary,
    public readonly resolver: SecretLeaseResolver = new SecretLeaseResolver(_leaseBoundary),
    public readonly injector: SecretInjector = new SecretInjector(),
    public readonly redactionRegistry: SecretRedactionRegistry = new SecretRedactionRegistry(),
    public readonly revocationHandler: SecretRevocationHandler = new SecretRevocationHandler(),
    _logger?: AgentLogger,
  ) {}

  /**
   * Resolves an opaque secret reference into a short-lived memory payload and registers redaction fingerprints.
   */
  public async resolveSecret(
    referenceString: string,
    context: VaultOperationRequestContext,
  ): Promise<{ result: VaultOperationResult<SecretLeasePayload>; event: EventEnvelope }> {
    const evidenceId = crypto.randomUUID();

    try {
      if (this.revocationHandler.isRevoked(referenceString)) {
        throw createNexusOSError(
          'SECRET_REVOKED',
          ErrorCategory.AUTHORIZATION,
          `Secret reference '${referenceString}' has been revoked and cannot be resolved.`,
        );
      }

      const payload = await this.resolver.resolveSecret(referenceString, context);

      // Register secret redaction fingerprint BEFORE secret is used
      this.redactionRegistry.registerSecret(payload.payloadBuffer, payload.fingerprintId);

      const result: VaultOperationResult<SecretLeasePayload> = {
        success: true,
        operation: VaultOperationName.RESOLVE,
        referenceId: referenceString,
        data: payload,
        evidenceId,
      };

      const event = createEventEnvelope(
        'nexusos.events.vault.resolved.v1',
        '1.0.0',
        context.lease.agent_id,
        context.lease.nonce || context.lease.task_id,
        {
          operation: VaultOperationName.RESOLVE,
          referenceId: referenceString,
          fingerprintId: payload.fingerprintId,
          taskId: context.lease.task_id,
          leaseId: context.lease.lease_id,
          agentId: context.lease.agent_id,
          status: 'SUCCESS',
        },
      );

      return { result, event };
    } catch (err) {
      const errCategory =
        (err as { category?: ErrorCategory }).category || ErrorCategory.AUTHORIZATION;
      const errCode = (err as { code?: string }).code || 'SECRET_RESOLUTION_FAILED';
      const errMessage = err instanceof Error ? err.message : String(err);

      const result: VaultOperationResult<SecretLeasePayload> = {
        success: false,
        operation: VaultOperationName.RESOLVE,
        referenceId: referenceString,
        evidenceId,
        error: {
          code: errCode,
          category: errCategory,
          message: errMessage,
        },
      };

      const event = createEventEnvelope(
        'nexusos.events.vault.denied.v1',
        '1.0.0',
        context.lease.agent_id,
        context.lease.nonce || context.lease.task_id,
        {
          operation: VaultOperationName.RESOLVE,
          referenceId: referenceString,
          taskId: context.lease.task_id,
          leaseId: context.lease.lease_id,
          agentId: context.lease.agent_id,
          status: 'DENIED',
          errorCode: errCode,
          errorMessage: errMessage,
        },
      );

      return { result, event };
    }
  }

  /**
   * Injects a resolved secret payload into an authorized runner channel (Terminal, Browser, Plugin).
   */
  public async injectSecret(
    payload: SecretLeasePayload,
    channel: InjectionChannel,
    targetId: string,
    context: VaultOperationRequestContext,
  ): Promise<{ result: VaultOperationResult<InjectionResult>; event: EventEnvelope }> {
    const evidenceId = crypto.randomUUID();

    try {
      if (this.revocationHandler.isRevoked(payload.referenceId)) {
        throw createNexusOSError(
          'SECRET_REVOKED',
          ErrorCategory.AUTHORIZATION,
          `Secret payload '${payload.referenceId}' has been revoked.`,
        );
      }

      let injRes: InjectionResult;
      if (channel === 'TERMINAL') {
        injRes = await this.injector.injectTerminalSecret(payload, targetId, context);
      } else if (channel === 'BROWSER') {
        injRes = await this.injector.injectBrowserSecret(payload, targetId, context);
      } else if (channel === 'PLUGIN') {
        injRes = await this.injector.injectPluginSecret(payload, targetId, context);
      } else {
        throw createNexusOSError(
          'UNAUTHORIZED_INJECTION_CHANNEL',
          ErrorCategory.AUTHORIZATION,
          `Injection channel '${channel}' is not authorized.`,
        );
      }

      const result: VaultOperationResult<InjectionResult> = {
        success: true,
        operation: VaultOperationName.INJECT,
        referenceId: payload.referenceId,
        data: injRes,
        evidenceId,
      };

      const event = createEventEnvelope(
        'nexusos.events.vault.injected.v1',
        '1.0.0',
        context.lease.agent_id,
        context.lease.nonce || context.lease.task_id,
        {
          operation: VaultOperationName.INJECT,
          referenceId: payload.referenceId,
          fingerprintId: payload.fingerprintId,
          channel,
          targetId,
          taskId: context.lease.task_id,
          leaseId: context.lease.lease_id,
          agentId: context.lease.agent_id,
          status: 'SUCCESS',
        },
      );

      return { result, event };
    } catch (err) {
      const errCategory =
        (err as { category?: ErrorCategory }).category || ErrorCategory.AUTHORIZATION;
      const errCode = (err as { code?: string }).code || 'SECRET_INJECTION_FAILED';
      const errMessage = err instanceof Error ? err.message : String(err);

      const result: VaultOperationResult<InjectionResult> = {
        success: false,
        operation: VaultOperationName.INJECT,
        referenceId: payload?.referenceId || '',
        evidenceId,
        error: {
          code: errCode,
          category: errCategory,
          message: errMessage,
        },
      };

      const event = createEventEnvelope(
        'nexusos.events.vault.denied.v1',
        '1.0.0',
        context.lease.agent_id,
        context.lease.nonce || context.lease.task_id,
        {
          operation: VaultOperationName.INJECT,
          referenceId: payload?.referenceId || '',
          channel,
          targetId,
          taskId: context.lease.task_id,
          leaseId: context.lease.lease_id,
          agentId: context.lease.agent_id,
          status: 'DENIED',
          errorCode: errCode,
          errorMessage: errMessage,
        },
      );

      return { result, event };
    }
  }

  /**
   * Revokes an active secret lease, zeroizes payload memory buffers, and unregisters redaction.
   */
  public async revokeSecret(
    referenceId: string,
    payload?: SecretLeasePayload,
    context?: VaultOperationRequestContext,
  ): Promise<{ result: VaultOperationResult<boolean>; event: EventEnvelope }> {
    const evidenceId = crypto.randomUUID();

    this.revocationHandler.revokeSecretLease(referenceId);

    if (payload) {
      this.revocationHandler.zeroizePayloadBuffer(payload);
      this.redactionRegistry.unregisterSecret(payload.fingerprintId);
    }

    const agentId = context?.lease.agent_id || 'agent_vault_system';
    const taskId = context?.lease.task_id || 'task_vault_system';

    const result: VaultOperationResult<boolean> = {
      success: true,
      operation: VaultOperationName.REVOKE,
      referenceId,
      data: true,
      evidenceId,
    };

    const event = createEventEnvelope('nexusos.events.vault.revoked.v1', '1.0.0', agentId, taskId, {
      operation: VaultOperationName.REVOKE,
      referenceId,
      taskId,
      status: 'SUCCESS',
    });

    return { result, event };
  }
}
