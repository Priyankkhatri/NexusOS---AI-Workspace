export interface QuarantineRecord {
  pluginId: string;
  quarantinedAt: string;
  reason: string;
  crashCount: number;
}

export class PluginQuarantineStore {
  private readonly records = new Map<string, QuarantineRecord>();

  public quarantinePlugin(
    pluginId: string,
    reason: string,
    crashCount: number = 1,
  ): QuarantineRecord {
    const record: QuarantineRecord = {
      pluginId,
      quarantinedAt: new Date().toISOString(),
      reason,
      crashCount,
    };

    this.records.set(pluginId, record);
    return record;
  }

  public isQuarantined(pluginId: string): boolean {
    return this.records.has(pluginId);
  }

  public getQuarantineRecord(pluginId: string): QuarantineRecord | undefined {
    return this.records.get(pluginId);
  }

  public liftQuarantine(pluginId: string): boolean {
    return this.records.delete(pluginId);
  }

  public listQuarantined(): QuarantineRecord[] {
    return Array.from(this.records.values());
  }
}
