import { IMMUTABLE_SHIPPED_SNAPSHOT } from './schemas.js';
import { ConfigurationSnapshot, IConfigurationStore } from './types.js';

export function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  Object.freeze(obj);

  for (const prop of Object.getOwnPropertyNames(obj)) {
    const val = (obj as Record<string, unknown>)[prop];
    if (
      val !== null &&
      (typeof val === 'object' || typeof val === 'function') &&
      !Object.isFrozen(val)
    ) {
      deepFreeze(val);
    }
  }

  return obj;
}

export class InMemoryConfigurationStore implements IConfigurationStore {
  private activeSnapshot: ConfigurationSnapshot = deepFreeze(
    JSON.parse(JSON.stringify(IMMUTABLE_SHIPPED_SNAPSHOT)),
  );
  private lkgSnapshot: ConfigurationSnapshot | null = deepFreeze(
    JSON.parse(JSON.stringify(IMMUTABLE_SHIPPED_SNAPSHOT)),
  );

  public getActiveConfig(): Readonly<ConfigurationSnapshot> {
    return deepFreeze(JSON.parse(JSON.stringify(this.activeSnapshot)));
  }

  public getLKGConfig(): Readonly<ConfigurationSnapshot> | null {
    return this.lkgSnapshot ? deepFreeze(JSON.parse(JSON.stringify(this.lkgSnapshot))) : null;
  }

  public getShippedDefaults(): Readonly<ConfigurationSnapshot> {
    return deepFreeze(JSON.parse(JSON.stringify(IMMUTABLE_SHIPPED_SNAPSHOT)));
  }

  public setActiveConfig(snapshot: ConfigurationSnapshot): void {
    if (!snapshot) return;

    // Verify basic security baseline presence before accepting active config
    if (snapshot.securityBaselines && snapshot.securityBaselines.policyDenyRulesEnabled !== true) {
      throw new Error(
        '[SecurityBaselineViolation] Cannot set active config with disabled security baselines.',
      );
    }

    const cloned = JSON.parse(JSON.stringify(snapshot));
    this.activeSnapshot = deepFreeze(cloned);
  }

  public setLKGConfig(snapshot: ConfigurationSnapshot): void {
    if (!snapshot) return;

    // Verify basic security baseline presence before committing to LKG
    if (snapshot.securityBaselines && snapshot.securityBaselines.policyDenyRulesEnabled !== true) {
      throw new Error(
        '[SecurityBaselineViolation] Cannot commit poisoned LKG config with disabled security baselines.',
      );
    }

    const cloned = JSON.parse(JSON.stringify(snapshot));
    this.lkgSnapshot = deepFreeze(cloned);
  }
}
