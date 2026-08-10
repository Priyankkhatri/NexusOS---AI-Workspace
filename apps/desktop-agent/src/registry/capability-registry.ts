export interface AgentCapability {
  capabilityId: string;
  category: 'system' | 'runtime' | 'device' | 'network';
  description: string;
  isDangerous: boolean;
  requiredScope?: string;
}

export class CapabilityRegistry {
  private readonly capabilities = new Map<string, AgentCapability>();

  registerCapability(capability: AgentCapability): void {
    if (this.capabilities.has(capability.capabilityId)) {
      throw new Error(
        `[CapabilityRegistryError] Capability '${capability.capabilityId}' is already registered.`,
      );
    }
    this.capabilities.set(capability.capabilityId, Object.freeze({ ...capability }));
  }

  hasCapability(capabilityId: string): boolean {
    return this.capabilities.has(capabilityId);
  }

  getCapability(capabilityId: string): AgentCapability | undefined {
    return this.capabilities.get(capabilityId);
  }

  listCapabilities(): AgentCapability[] {
    return Array.from(this.capabilities.values());
  }

  listCapabilityIds(): string[] {
    return Array.from(this.capabilities.keys());
  }
}
