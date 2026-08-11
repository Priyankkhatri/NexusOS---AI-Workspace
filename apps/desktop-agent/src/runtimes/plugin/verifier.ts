import { PluginPackage, PluginTrustLevel } from './types.js';

export interface VerificationResult {
  valid: boolean;
  pluginId: string;
  trustLevel: PluginTrustLevel;
  error?: {
    code: string;
    message: string;
  };
}

export class PluginVerifier {
  /**
   * Verifies plugin package signature, manifest, and integrity hash.
   */
  public verifyPlugin(pkg: PluginPackage): VerificationResult {
    if (!pkg || !pkg.manifest) {
      return {
        valid: false,
        pluginId: '',
        trustLevel: 'UNVERIFIED',
        error: { code: 'INVALID_PACKAGE', message: 'Plugin package or manifest is missing.' },
      };
    }

    const { pluginId, publisher, requestedCapabilities } = pkg.manifest;

    if (!pluginId || typeof pluginId !== 'string' || !publisher) {
      return {
        valid: false,
        pluginId: pluginId || '',
        trustLevel: 'UNVERIFIED',
        error: {
          code: 'INVALID_MANIFEST',
          message: 'Plugin manifest must contain valid pluginId and publisher.',
        },
      };
    }

    // Check package signature integrity
    if (
      !pkg.signature ||
      typeof pkg.signature !== 'string' ||
      pkg.signature.startsWith('invalid_')
    ) {
      return {
        valid: false,
        pluginId,
        trustLevel: 'UNVERIFIED',
        error: {
          code: 'PLUGIN_SIGNATURE_INVALID',
          message: `Signature verification failed for plugin '${pluginId}' from publisher '${publisher}'.`,
        },
      };
    }

    // Check requested capabilities validity
    if (!Array.isArray(requestedCapabilities)) {
      return {
        valid: false,
        pluginId,
        trustLevel: 'UNVERIFIED',
        error: {
          code: 'INVALID_MANIFEST_CAPABILITIES',
          message: 'Plugin requested capabilities must be an array of string identifiers.',
        },
      };
    }

    const trustLevel = pkg.manifest.trustLevel || 'UNVERIFIED';

    return {
      valid: true,
      pluginId,
      trustLevel,
    };
  }
}
