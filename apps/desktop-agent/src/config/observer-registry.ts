import {
  ConfigObserverCallback,
  ConfigurationSnapshot,
  IConfigurationObserverRegistry,
} from './types.js';

export class ConfigurationObserverRegistry implements IConfigurationObserverRegistry {
  private readonly observers = new Map<string, ConfigObserverCallback>();

  public subscribe(observerId: string, callback: ConfigObserverCallback): void {
    if (!observerId || !callback) return;
    this.observers.set(observerId, callback);
  }

  public unsubscribe(observerId: string): void {
    this.observers.delete(observerId);
  }

  public notifyObservers(snapshot: Readonly<ConfigurationSnapshot>): void {
    if (!snapshot) return;

    const immutableCopy = Object.freeze({ ...snapshot });

    for (const [id, callback] of this.observers.entries()) {
      try {
        callback(immutableCopy);
      } catch (err) {
        // Observers cannot break the configuration manager pipeline
        console.error(`[ConfigurationObserverError] Observer '${id}' threw error:`, err);
      }
    }
  }
}
