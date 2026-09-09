import {
  PluginManifest,
  PluginManifestInput,
  PluginManifestSchema,
  PluginInvocationRequest,
  PluginOperationResult,
  PluginTrustLevel,
  PluginRiskTier,
} from '@nexusos/contracts';

/**
 * Plugin Logger Interface
 * Safe structured logging interface exposed to plugin execution context.
 * Redacts secrets automatically and forwards to host telemetry.
 */
export interface PluginLogger {
  debug(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, error?: Error | unknown, metadata?: Record<string, unknown>): void;
}

/**
 * Plugin Host API
 * Governed boundary through which plugin code requests host platform capabilities.
 * Prevents raw access to filesystem, processes, network, or control plane.
 */
export interface PluginHostAPI {
  /**
   * Invokes a declared host capability within the execution lease.
   */
  invokeCapability(
    capabilityId: string,
    action: string,
    payload: Record<string, unknown>,
  ): Promise<unknown>;

  /**
   * Saves a plugin-generated artifact bound to the task/workspace.
   */
  saveArtifact(
    name: string,
    content: string | Uint8Array,
    mimeType?: string,
  ): Promise<{ artifactId: string; checksum: string }>;

  /**
   * Emits a typed plugin domain event via the host event pipeline.
   */
  emitEvent(eventName: string, payload: Record<string, unknown>): void;
}

/**
 * Execution Context passed to plugin lifecycle hooks and handlers.
 */
export interface PluginContext {
  readonly pluginId: string;
  readonly version: string;
  readonly tenantId: string;
  readonly workspaceId?: string;
  readonly taskId?: string;
  readonly correlationId?: string;
  readonly logger: PluginLogger;
  readonly host: PluginHostAPI;
  readonly signal?: AbortSignal;
}

/**
 * Plugin Capability Handler
 */
export type PluginCapabilityHandler<TPayload = Record<string, unknown>, TResult = unknown> = (
  payload: TPayload,
  context: PluginContext,
) => Promise<TResult> | TResult;

/**
 * Plugin Definition Structure
 */
export interface PluginDefinition {
  readonly manifest: PluginManifestInput | PluginManifest;
  activate?(context: PluginContext): Promise<void> | void;
  deactivate?(context: PluginContext): Promise<void> | void;
  readonly capabilities?: Record<string, PluginCapabilityHandler<any, any>>;
}

/**
 * Validates and creates a type-safe NexusOS Plugin Definition.
 * Fails closed if the manifest is invalid or malformed.
 */
export function definePlugin(definition: PluginDefinition): PluginDefinition {
  if (!definition || !definition.manifest) {
    throw new Error('Plugin definition requires a valid manifest object.');
  }

  // Strictly validate manifest against canonical schema
  const parsed = PluginManifestSchema.safeParse(definition.manifest);
  if (!parsed.success) {
    const errorDetails = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(
      `Invalid plugin manifest for '${definition.manifest?.pluginId || 'unknown'}': ${errorDetails}`,
    );
  }

  // Freeze definition structure to prevent runtime prototype/property tampering
  return Object.freeze({
    manifest: Object.freeze(parsed.data),
    activate: definition.activate,
    deactivate: definition.deactivate,
    capabilities: definition.capabilities
      ? Object.freeze({ ...definition.capabilities })
      : undefined,
  });
}

// Re-export canonical types needed by plugin developers
export type {
  PluginManifest,
  PluginManifestInput,
  PluginInvocationRequest,
  PluginOperationResult,
  PluginTrustLevel,
  PluginRiskTier,
};
