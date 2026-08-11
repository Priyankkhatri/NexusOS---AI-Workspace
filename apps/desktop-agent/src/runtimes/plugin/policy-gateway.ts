import { PluginInvocationRequest, PluginManifest, PluginOperationRequestContext } from './types.js';

export interface PolicyGatewayCheckResult {
  allowed: boolean;
  error?: {
    code: string;
    message: string;
  };
}

export class PluginPolicyGateway {
  /**
   * Evaluates plugin invocation request against signed manifest capabilities and lease scopes.
   */
  public evaluateInvocation(
    request: PluginInvocationRequest,
    manifest: PluginManifest,
    context: PluginOperationRequestContext,
  ): PolicyGatewayCheckResult {
    // 1. Validate manifest capability declaration
    if (!manifest.requestedCapabilities.includes(request.capability)) {
      return {
        allowed: false,
        error: {
          code: 'UNAUTHORIZED_PLUGIN_CAPABILITY',
          message: `Plugin '${manifest.pluginId}' is not authorized to invoke capability '${request.capability}'. Manifest approved capabilities: [${manifest.requestedCapabilities.join(', ')}].`,
        },
      };
    }

    // 2. Validate lease scopes grant capability or plugin invocation
    const requiredScope = `plugin:${request.capability}`;
    const genericScope = 'plugin:invoke';
    const grantedScopes = context.lease.scopes || [];

    if (!grantedScopes.includes(requiredScope) && !grantedScopes.includes(genericScope)) {
      return {
        allowed: false,
        error: {
          code: 'MISSING_CAPABILITY_SCOPE',
          message: `Lease does not grant capability scope '${requiredScope}' or '${genericScope}'. Granted scopes: [${grantedScopes.join(', ')}].`,
        },
      };
    }

    return { allowed: true };
  }
}
