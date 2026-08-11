import { PluginPackage, PluginState } from './types.js';

export interface CatalogEntry {
  pluginId: string;
  package: PluginPackage;
  state: PluginState;
  installedAt: string;
  updatedAt: string;
}

export class PluginCatalog {
  private readonly entries = new Map<string, CatalogEntry>();

  public registerPackage(pkg: PluginPackage, initialState: PluginState = 'VERIFIED'): CatalogEntry {
    const pluginId = pkg.manifest.pluginId;
    const now = new Date().toISOString();

    const entry: CatalogEntry = {
      pluginId,
      package: pkg,
      state: initialState,
      installedAt: now,
      updatedAt: now,
    };

    this.entries.set(pluginId, entry);
    return entry;
  }

  public getEntry(pluginId: string): CatalogEntry | undefined {
    return this.entries.get(pluginId);
  }

  public setPluginState(pluginId: string, state: PluginState): boolean {
    const entry = this.entries.get(pluginId);
    if (!entry) return false;

    entry.state = state;
    entry.updatedAt = new Date().toISOString();
    return true;
  }

  public listEntries(): CatalogEntry[] {
    return Array.from(this.entries.values());
  }

  public removeEntry(pluginId: string): boolean {
    return this.entries.delete(pluginId);
  }
}
