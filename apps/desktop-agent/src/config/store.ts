import { IMMUTABLE_SHIPPED_SNAPSHOT } from './schemas.js';
import { ConfigurationSnapshot, IConfigurationStore } from './types.js';

export class InMemoryConfigurationStore implements IConfigurationStore {
  private activeSnapshot: ConfigurationSnapshot = IMMUTABLE_SHIPPED_SNAPSHOT;
  private lkgSnapshot: ConfigurationSnapshot | null = IMMUTABLE_SHIPPED_SNAPSHOT;

  public getActiveConfig(): Readonly<ConfigurationSnapshot> {
    return Object.freeze({ ...this.activeSnapshot });
  }

  public getLKGConfig(): Readonly<ConfigurationSnapshot> | null {
    return this.lkgSnapshot ? Object.freeze({ ...this.lkgSnapshot }) : null;
  }

  public getShippedDefaults(): Readonly<ConfigurationSnapshot> {
    return IMMUTABLE_SHIPPED_SNAPSHOT;
  }

  public setActiveConfig(snapshot: ConfigurationSnapshot): void {
    if (!snapshot) return;
    this.activeSnapshot = Object.freeze({ ...snapshot });
  }

  public setLKGConfig(snapshot: ConfigurationSnapshot): void {
    if (!snapshot) return;
    this.lkgSnapshot = Object.freeze({ ...snapshot });
  }
}
