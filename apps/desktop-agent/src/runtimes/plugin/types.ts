import { ExecutionLeaseHeader } from '@nexusos/contracts';
import { AuthenticatedContext } from '@nexusos/identity';

export enum PluginOperationName {
  VERIFY = 'plugin:verify',
  INSTALL = 'plugin:install',
  ACTIVATE = 'plugin:activate',
  INVOKE = 'plugin:invoke',
  SUSPEND = 'plugin:suspend',
  QUARANTINE = 'plugin:quarantine',
}

export type PluginTrustLevel = 'UNVERIFIED' | 'VERIFIED_PUBLISHER' | 'ENTERPRISE_INTERNAL';

export type PluginState =
  | 'DISCOVERED'
  | 'VERIFIED'
  | 'INSTALLED'
  | 'ACTIVATED'
  | 'SUSPENDED'
  | 'QUARANTINED';

export interface PluginManifest {
  pluginId: string;
  version: string;
  publisher: string;
  name: string;
  description: string;
  requestedCapabilities: string[];
  outboundDomains: string[];
  trustLevel: PluginTrustLevel;
}

export interface PluginPackage {
  manifest: PluginManifest;
  packageHash: string;
  signature: string;
  bundleContent: string;
}

export interface PluginInvocationRequest {
  pluginId: string;
  capability: string;
  action: string;
  payload: Record<string, unknown>;
}

export interface PluginResourceLimits {
  /** Maximum concurrent sandboxed plugin hosts allowed (default: 5) */
  maxConcurrentHosts: number;
  /** Invocation timeout in ms (default: 30000ms) */
  hostTimeoutMs: number;
  /** Maximum allowed crash count before auto-quarantine (default: 3) */
  maxCrashAttempts: number;
}

export const DEFAULT_PLUGIN_RESOURCE_LIMITS: PluginResourceLimits = {
  maxConcurrentHosts: 5,
  hostTimeoutMs: 30_000,
  maxCrashAttempts: 3,
};

export interface PluginOperationRequestContext {
  lease: ExecutionLeaseHeader;
  subject?: AuthenticatedContext;
  allowedRoots: string[];
  limits?: Partial<PluginResourceLimits>;
}

export interface PluginOperationResult<T = unknown> {
  success: boolean;
  operation: PluginOperationName;
  pluginId?: string;
  data?: T;
  evidenceId: string;
  error?: {
    code: string;
    category: string;
    message: string;
  };
}
