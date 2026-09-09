import { ExecutionLeaseHeader } from '@nexusos/contracts';
import { AuthenticatedContext } from '@nexusos/identity';
import {
  PluginTrustLevel,
  PluginLifecycleState,
  PluginManifest,
  PluginPackage,
  PluginResourceLimits,
  PluginInvocationRequest,
  PluginOperationResult,
  DEFAULT_PLUGIN_RESOURCE_LIMITS,
} from '@nexusos/contracts';

export enum PluginOperationName {
  VERIFY = 'plugin:verify',
  INSTALL = 'plugin:install',
  ACTIVATE = 'plugin:activate',
  INVOKE = 'plugin:invoke',
  SUSPEND = 'plugin:suspend',
  QUARANTINE = 'plugin:quarantine',
}

export type {
  PluginTrustLevel,
  PluginManifest,
  PluginPackage,
  PluginResourceLimits,
  PluginInvocationRequest,
  PluginOperationResult,
};

export type PluginState = PluginLifecycleState;

export { DEFAULT_PLUGIN_RESOURCE_LIMITS };

export interface PluginOperationRequestContext {
  lease: ExecutionLeaseHeader;
  subject?: AuthenticatedContext;
  allowedRoots: string[];
  limits?: Partial<PluginResourceLimits>;
}
