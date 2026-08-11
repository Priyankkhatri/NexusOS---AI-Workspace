import { ErrorCategory, createNexusOSError } from '@nexusos/contracts';
import {
  ConfigurationSnapshotSchema,
  DEFAULT_SECURITY_BASELINES,
  HARD_RESOURCE_CEILINGS,
} from './schemas.js';
import { ConfigValidationResult, ConfigurationSnapshot, IConfigValidationEngine } from './types.js';

export class ConfigValidationEngine implements IConfigValidationEngine {
  public validateSnapshot(raw: unknown): ConfigValidationResult {
    if (!raw || typeof raw !== 'object') {
      return { valid: false, errors: ['Raw configuration must be a non-null object.'] };
    }

    // 1. Plaintext Secrets Check
    const secretViolations = this.checkForPlaintextSecrets(raw);
    if (secretViolations.length > 0) {
      return {
        valid: false,
        errors: [
          `Configuration contains forbidden plaintext secret material: ${secretViolations.join('; ')}`,
        ],
      };
    }

    // 2. Security Baselines Assertion
    try {
      this.assertSecurityBaselinesIntact(raw as Partial<ConfigurationSnapshot>);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { valid: false, errors: [msg] };
    }

    // 3. Schema Parsing & Default Fallbacks
    const parseResult = ConfigurationSnapshotSchema.safeParse(raw);
    if (!parseResult.success) {
      const details = parseResult.error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join('; ');
      return { valid: false, errors: [`Schema validation failed: ${details}`] };
    }

    const sanitized = parseResult.data as ConfigurationSnapshot;

    // 4. Force Security Baselines to Immutable Defaults
    sanitized.securityBaselines = DEFAULT_SECURITY_BASELINES;

    // 5. Clamp Resource Budgets against Architectural Hard Ceilings
    sanitized.resourceBudgets.processTimeoutMs = Math.min(
      sanitized.resourceBudgets.processTimeoutMs,
      HARD_RESOURCE_CEILINGS.maxProcessTimeoutMs,
    );
    sanitized.resourceBudgets.terminalMaxOutputBytes = Math.min(
      sanitized.resourceBudgets.terminalMaxOutputBytes,
      HARD_RESOURCE_CEILINGS.maxTerminalOutputBytes,
    );
    sanitized.resourceBudgets.pluginMaxConcurrentHosts = Math.min(
      sanitized.resourceBudgets.pluginMaxConcurrentHosts,
      HARD_RESOURCE_CEILINGS.maxPluginConcurrentHosts,
    );
    sanitized.resourceBudgets.browserMaxSessions = Math.min(
      sanitized.resourceBudgets.browserMaxSessions,
      HARD_RESOURCE_CEILINGS.maxBrowserSessions,
    );
    sanitized.resourceBudgets.fileMaxByteSize = Math.min(
      sanitized.resourceBudgets.fileMaxByteSize,
      HARD_RESOURCE_CEILINGS.maxFileByteSize,
    );
    sanitized.resourceBudgets.maxConcurrentLeases = Math.min(
      sanitized.resourceBudgets.maxConcurrentLeases,
      HARD_RESOURCE_CEILINGS.maxConcurrentLeases,
    );

    return {
      valid: true,
      errors: [],
      sanitizedConfig: sanitized,
    };
  }

  public assertSecurityBaselinesIntact(config: Partial<ConfigurationSnapshot>): void {
    if (!config || !config.securityBaselines) return;

    const baselines = config.securityBaselines as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(baselines)) {
      if (value === false) {
        throw createNexusOSError(
          'SECURITY_BASELINE_VIOLATION',
          ErrorCategory.AUTHORIZATION,
          `Security baseline '${key}' cannot be disabled or set to false in configuration.`,
        );
      }
    }
  }

  public checkForPlaintextSecrets(obj: unknown): string[] {
    const violations: string[] = [];

    const scan = (current: unknown, path: string) => {
      if (!current) return;

      if (typeof current === 'string') {
        if (/Bearer\s+[A-Za-z0-9._~+/-]+=*/i.test(current)) {
          violations.push(`Bearer token pattern detected at ${path}`);
        }
        if (/-----BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY-----/i.test(current)) {
          violations.push(`Private key block detected at ${path}`);
        }
        if (/ghp_[a-zA-Z0-9]{36}/.test(current) || /sk_live_[0-9a-zA-Z]{24}/.test(current)) {
          violations.push(`API token pattern detected at ${path}`);
        }
        return;
      }

      if (typeof current === 'object') {
        for (const [key, val] of Object.entries(current as Record<string, unknown>)) {
          const fieldPath = path ? `${path}.${key}` : key;
          const lowerKey = key.toLowerCase();

          if (
            (lowerKey.includes('password') ||
              lowerKey.includes('secret') ||
              lowerKey.includes('apikey') ||
              lowerKey.includes('api_key') ||
              lowerKey.includes('token') ||
              lowerKey.includes('privatekey')) &&
            typeof val === 'string' &&
            val.trim().length > 0 &&
            !val.startsWith('vault:sec_ref_')
          ) {
            violations.push(`Plaintext secret field detected at ${fieldPath}`);
          }

          scan(val, fieldPath);
        }
      }
    };

    scan(obj, '');
    return violations;
  }
}
