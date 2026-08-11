import crypto from 'node:crypto';
import {
  ErrorCategory,
  EventEnvelope,
  createEventEnvelope,
  createNexusOSError,
} from '@nexusos/contracts';
import { ExecutionLeaseBoundary } from '../permissions/lease-boundary.js';
import { ConfigRollbackHandler } from './rollback-handler.js';
import { ConfigurationObserverRegistry } from './observer-registry.js';
import { ConfigSignatureVerifier } from './signature-verifier.js';
import { InMemoryConfigurationStore } from './store.js';
import {
  ConfigLayer,
  ConfigOperationResult,
  ConfigSignatureVerificationResult,
  ConfigurationSnapshot,
  DeepPartialConfigurationSnapshot,
  IConfigRollbackHandler,
  IConfigSignatureVerifier,
  IConfigValidationEngine,
  IConfigurationManager,
  IConfigurationObserverRegistry,
  IConfigurationStore,
  SignedConfigEnvelope,
} from './types.js';
import { ConfigValidationEngine } from './validation-engine.js';

const LAYER_PRECEDENCE_ORDER: Record<ConfigLayer, number> = {
  [ConfigLayer.IMMUTABLE_SHIPPED_DEFAULTS]: 1,
  [ConfigLayer.SIGNED_RELEASE_CONFIG]: 2,
  [ConfigLayer.ENTERPRISE_POLICY_OVERLAYS]: 3,
  [ConfigLayer.USER_PREFERENCES]: 4,
};

export class ConfigurationManager implements IConfigurationManager {
  private readonly store: IConfigurationStore;
  private readonly signatureVerifier: IConfigSignatureVerifier;
  private readonly validationEngine: IConfigValidationEngine;
  private readonly rollbackHandler: IConfigRollbackHandler;
  public readonly observerRegistry: IConfigurationObserverRegistry;

  constructor(
    _leaseBoundary?: ExecutionLeaseBoundary,
    store?: IConfigurationStore,
    signatureVerifier?: IConfigSignatureVerifier,
    validationEngine?: IConfigValidationEngine,
    rollbackHandler?: IConfigRollbackHandler,
    observerRegistry?: IConfigurationObserverRegistry,
  ) {
    this.store = store || new InMemoryConfigurationStore();
    this.signatureVerifier = signatureVerifier || new ConfigSignatureVerifier();
    this.validationEngine = validationEngine || new ConfigValidationEngine();
    this.rollbackHandler = rollbackHandler || new ConfigRollbackHandler();
    this.observerRegistry = observerRegistry || new ConfigurationObserverRegistry();
  }

  public getActiveConfiguration(): Readonly<ConfigurationSnapshot> {
    return this.store.getActiveConfig();
  }

  public async applyConfigurationUpdate(
    layer: ConfigLayer,
    update: DeepPartialConfigurationSnapshot | SignedConfigEnvelope,
  ): Promise<{ result: ConfigOperationResult; event: EventEnvelope }> {
    const activeConfig = this.store.getActiveConfig();
    const agentId = activeConfig.settings.deviceId || '00000000-0000-4000-8000-000000000000';
    const correlationId = crypto.randomUUID();

    try {
      // 1. Signature Verification for High-Trust Signed Layers
      if (
        layer === ConfigLayer.SIGNED_RELEASE_CONFIG ||
        layer === ConfigLayer.ENTERPRISE_POLICY_OVERLAYS
      ) {
        const envelope = update as SignedConfigEnvelope;
        if (!envelope || !envelope.signature) {
          throw createNexusOSError(
            'CONFIG_SIGNATURE_MISSING',
            ErrorCategory.AUTHORIZATION,
            `Layer '${layer}' requires a cryptographically signed configuration envelope.`,
          );
        }

        const sigResult: ConfigSignatureVerificationResult =
          await this.signatureVerifier.verifySignature(envelope);
        if (!sigResult.valid) {
          throw createNexusOSError(
            'CONFIG_SIGNATURE_INVALID',
            ErrorCategory.AUTHORIZATION,
            sigResult.reason || 'Cryptographic signature verification failed for config envelope.',
          );
        }
      }

      // 2. Extract Raw Payload Update
      const rawPayload = (update as SignedConfigEnvelope).payload
        ? (update as SignedConfigEnvelope).payload
        : (update as DeepPartialConfigurationSnapshot);

      // 3. Precedence Layer Resolution & Merging
      const mergedCandidate = this.resolvePrecedence(activeConfig, layer, rawPayload);

      // 4. Validate Complete Candidate Snapshot
      const valResult = this.validationEngine.validateSnapshot(mergedCandidate);
      if (!valResult.valid || !valResult.sanitizedConfig) {
        throw createNexusOSError(
          'CONFIG_VALIDATION_FAILED',
          ErrorCategory.VALIDATION,
          `Configuration validation failed: ${valResult.errors.join('; ')}`,
        );
      }

      const finalSnapshot = valResult.sanitizedConfig;
      finalSnapshot.layer = layer;
      finalSnapshot.revision = activeConfig.revision + 1;
      finalSnapshot.updatedAt = new Date().toISOString();
      finalSnapshot.hash = crypto
        .createHash('sha256')
        .update(JSON.stringify(finalSnapshot))
        .digest('hex');

      // 5. Atomic Application: Set Active Config & LKG (if valid)
      this.store.setActiveConfig(finalSnapshot);
      this.store.setLKGConfig(finalSnapshot);

      // 6. Notify Observers Atomically
      this.observerRegistry.notifyObservers(finalSnapshot);

      const result: ConfigOperationResult = {
        success: true,
        action: 'UPDATE',
        snapshot: finalSnapshot,
      };

      const event = createEventEnvelope(
        'nexusos.events.config.updated.v1',
        '1.0.0',
        agentId,
        correlationId,
        {
          operation: 'UPDATE',
          layer,
          revision: finalSnapshot.revision,
          configHash: finalSnapshot.hash,
          status: 'SUCCESS',
        },
      );

      return { result, event };
    } catch (err) {
      const errCategory =
        (err as { category?: ErrorCategory }).category || ErrorCategory.VALIDATION;
      const errCode = (err as { code?: string }).code || 'CONFIG_UPDATE_REJECTED';
      const errMessage = (err as { message?: string }).message || String(err);

      const result: ConfigOperationResult = {
        success: false,
        action: 'REJECT',
        snapshot: activeConfig,
        error: {
          code: errCode,
          category: errCategory,
          message: errMessage,
        },
      };

      const event = createEventEnvelope(
        'nexusos.events.config.rejected.v1',
        '1.0.0',
        agentId,
        correlationId,
        {
          operation: 'REJECT',
          layer,
          currentRevision: activeConfig.revision,
          status: 'REJECTED',
          errorCode: errCode,
          errorMessage: errMessage,
        },
      );

      return { result, event };
    }
  }

  public async rollbackToLKG(): Promise<{ result: ConfigOperationResult; event: EventEnvelope }> {
    const previousConfig = this.store.getActiveConfig();
    const agentId = previousConfig.settings.deviceId || '00000000-0000-4000-8000-000000000000';
    const correlationId = crypto.randomUUID();

    const restoredSnapshot = this.rollbackHandler.rollbackToLKG(this.store, this.validationEngine);

    // Notify observers of rollback
    this.observerRegistry.notifyObservers(restoredSnapshot);

    const result: ConfigOperationResult = {
      success: true,
      action: 'ROLLBACK',
      snapshot: restoredSnapshot,
    };

    const event = createEventEnvelope(
      'nexusos.events.config.rollback.v1',
      '1.0.0',
      agentId,
      correlationId,
      {
        operation: 'ROLLBACK',
        previousRevision: previousConfig.revision,
        restoredRevision: restoredSnapshot.revision,
        restoredLayer: restoredSnapshot.layer,
        restoredHash: restoredSnapshot.hash,
        status: 'SUCCESS',
      },
    );

    return { result, event };
  }

  private resolvePrecedence(
    current: ConfigurationSnapshot,
    layer: ConfigLayer,
    updatePayload: DeepPartialConfigurationSnapshot,
  ): Record<string, unknown> {
    const currentLayerLevel = LAYER_PRECEDENCE_ORDER[current.layer] || 1;
    const targetLayerLevel = LAYER_PRECEDENCE_ORDER[layer] || 1;

    // Deep copy current snapshot
    const merged: Record<string, unknown> = JSON.parse(JSON.stringify(current));

    // If update layer is equal or higher precedence level, merge properties
    if (targetLayerLevel >= currentLayerLevel) {
      if (updatePayload.settings) {
        merged.settings = { ...(merged.settings as object), ...updatePayload.settings };
      }
      if (updatePayload.resourceBudgets) {
        merged.resourceBudgets = {
          ...(merged.resourceBudgets as object),
          ...updatePayload.resourceBudgets,
        };
      }
      if (updatePayload.securityBaselines) {
        merged.securityBaselines = {
          ...(merged.securityBaselines as object),
          ...updatePayload.securityBaselines,
        };
      }
      if (updatePayload.featureFlags) {
        merged.featureFlags = { ...(merged.featureFlags as object), ...updatePayload.featureFlags };
      }
      if (updatePayload.customPreferences) {
        merged.customPreferences = {
          ...((merged.customPreferences as object) || {}),
          ...updatePayload.customPreferences,
        };
      }
    }

    return merged;
  }
}
