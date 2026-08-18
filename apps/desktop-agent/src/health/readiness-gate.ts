import { ErrorCategory, createNexusOSError } from '@nexusos/contracts';
import { ITelemetrySpool } from '../telemetry/types.js';
import { HealthState, IReadinessGate, ReadinessCheckResult } from './types.js';

export interface ReadinessCheckProvider {
  name: string;
  critical: boolean;
  check: () => boolean | Promise<boolean>;
}

export class ReadinessGate implements IReadinessGate {
  private readonly providers = new Map<string, ReadinessCheckProvider>();

  constructor() {
    // Register default readiness providers
    this.registerProvider({
      name: 'state_store',
      critical: true,
      check: () => true,
    });
    this.registerProvider({
      name: 'policy_boundary',
      critical: true,
      check: () => true,
    });
    this.registerProvider({
      name: 'process_supervisor',
      critical: true,
      check: () => true,
    });
    this.registerProvider({
      name: 'vault_client',
      critical: true,
      check: () => true,
    });
    this.registerProvider({
      name: 'config_manager',
      critical: true,
      check: () => true,
    });
    this.registerProvider({
      name: 'telemetry_spool',
      critical: true,
      check: () => true,
    });
  }

  public bindPolicyFreshnessCheck(getPolicyAgeSec: () => number): void {
    this.registerProvider({
      name: 'policy_freshness',
      critical: true,
      check: () => {
        const ageSec = getPolicyAgeSec();
        return ageSec <= 300;
      },
    });
  }

  public bindTelemetrySpool(spool: ITelemetrySpool): void {
    this.registerProvider({
      name: 'telemetry_spool',
      critical: true,
      check: () => !spool.getSpoolMetrics().isCriticalSpoolFull,
    });
  }

  public registerProvider(provider: ReadinessCheckProvider): void {
    if (!provider || !provider.name) return;
    this.providers.set(provider.name, provider);
  }

  public setProviderStatus(name: string, isHealthy: boolean): void {
    const existing = this.providers.get(name);
    if (existing) {
      existing.check = () => isHealthy;
    }
  }

  public evaluateReadiness(): ReadinessCheckResult {
    const reasons: string[] = [];
    let criticalFailures = 0;
    let nonCriticalFailures = 0;

    for (const [name, provider] of this.providers.entries()) {
      try {
        const ok = provider.check();
        if (!ok) {
          if (provider.critical) {
            criticalFailures++;
            reasons.push(`Critical readiness dependency '${name}' failed health check.`);
          } else {
            nonCriticalFailures++;
            reasons.push(`Non-critical dependency '${name}' degraded.`);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (provider.critical) {
          criticalFailures++;
          reasons.push(`Critical dependency '${name}' check threw error: ${msg}`);
        } else {
          nonCriticalFailures++;
          reasons.push(`Non-critical dependency '${name}' check threw error: ${msg}`);
        }
      }
    }

    let state: HealthState = 'HEALTHY';
    let ready = true;

    if (criticalFailures > 0) {
      state = 'FAILED';
      ready = false;
    } else if (nonCriticalFailures > 0) {
      state = 'DEGRADED';
      ready = true; // Degraded posture accepts safe work only if non-critical
    }

    return {
      ready,
      state,
      reasons,
      checkedAt: new Date().toISOString(),
    };
  }

  public assertReadyForLease(): void {
    const readiness = this.evaluateReadiness();
    if (!readiness.ready || readiness.state === 'FAILED') {
      throw createNexusOSError(
        'READINESS_CHECK_FAILED',
        ErrorCategory.RATE_LIMITED,
        `Agent is not ready to accept new execution leases. State: ${readiness.state}. Reasons: ${readiness.reasons.join('; ')}`,
      );
    }
  }
}
