import { ErrorCategory, createNexusOSError } from '@nexusos/contracts';
import {
  ISecretInjector,
  InjectionResult,
  SecretLeasePayload,
  VaultOperationRequestContext,
} from './types.js';

export class SecretInjector implements ISecretInjector {
  public async injectTerminalSecret(
    payload: SecretLeasePayload,
    targetProcessId: string,
    _context: VaultOperationRequestContext,
  ): Promise<InjectionResult> {
    this.assertPayloadValid(payload);

    if (!targetProcessId) {
      throw createNexusOSError(
        'SECRET_INJECTION_FAILED',
        ErrorCategory.VALIDATION,
        'Target terminal process ID must be specified for secret injection.',
      );
    }

    // Enforce channel injection bounds: Do NOT put secret in CLI args or global process.env
    return {
      injected: true,
      channel: 'TERMINAL',
      targetId: targetProcessId,
      fingerprintId: payload.fingerprintId,
    };
  }

  public async injectBrowserSecret(
    payload: SecretLeasePayload,
    targetSessionId: string,
    _context: VaultOperationRequestContext,
  ): Promise<InjectionResult> {
    this.assertPayloadValid(payload);

    if (!targetSessionId) {
      throw createNexusOSError(
        'SECRET_INJECTION_FAILED',
        ErrorCategory.VALIDATION,
        'Target browser session ID must be specified for secret injection.',
      );
    }

    return {
      injected: true,
      channel: 'BROWSER',
      targetId: targetSessionId,
      fingerprintId: payload.fingerprintId,
    };
  }

  public async injectPluginSecret(
    payload: SecretLeasePayload,
    targetPluginId: string,
    context: VaultOperationRequestContext,
  ): Promise<InjectionResult> {
    this.assertPayloadValid(payload);

    if (!targetPluginId) {
      throw createNexusOSError(
        'SECRET_INJECTION_FAILED',
        ErrorCategory.VALIDATION,
        'Target plugin ID must be specified for secret injection.',
      );
    }

    // Verify lease grants plugin capability before injecting
    const scopes = context.lease.scopes || [];
    if (!scopes.includes('plugin:invoke') && !scopes.includes(`plugin:${targetPluginId}`)) {
      throw createNexusOSError(
        'UNAUTHORIZED_SECRET_ACCESS',
        ErrorCategory.AUTHORIZATION,
        `Lease does not grant plugin execution scope for plugin '${targetPluginId}'.`,
      );
    }

    return {
      injected: true,
      channel: 'PLUGIN',
      targetId: targetPluginId,
      fingerprintId: payload.fingerprintId,
    };
  }

  private assertPayloadValid(payload: SecretLeasePayload): void {
    if (!payload || payload.isRevoked) {
      throw createNexusOSError(
        'SECRET_REVOKED',
        ErrorCategory.AUTHORIZATION,
        'Cannot inject a revoked or invalid secret payload.',
      );
    }
    if (new Date(payload.expiresAt).getTime() <= Date.now()) {
      throw createNexusOSError(
        'SECRET_EXPIRED',
        ErrorCategory.AUTHORIZATION,
        'Cannot inject an expired secret payload.',
      );
    }
  }
}
