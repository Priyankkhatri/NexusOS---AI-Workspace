import { CapabilityRegistry } from '../registry/capability-registry.js';
import { RuntimeRegistry } from '../registry/runtime-registry.js';
import { IRuntimeRouter } from './types.js';

export class RuntimeRouter implements IRuntimeRouter {
  private static readonly VALID_CATEGORIES = new Set([
    'filesystem',
    'terminal',
    'browser',
    'plugin',
    'device',
    'memory',
  ]);

  constructor(
    private readonly capabilityRegistry: CapabilityRegistry,
    private readonly _runtimeRegistry?: RuntimeRegistry,
  ) {}

  public hasCapability(capabilityId: string): boolean {
    if (!capabilityId || typeof capabilityId !== 'string') {
      return false;
    }
    // Check direct registration or standard subsystem capability prefix
    if (this.capabilityRegistry.hasCapability(capabilityId)) {
      return true;
    }
    const prefix = capabilityId.split('.')[0] || capabilityId.split(':')[0];
    return RuntimeRouter.VALID_CATEGORIES.has(prefix.toLowerCase());
  }

  public resolveRuntimeCategory(capabilityId: string): string | null {
    if (!this.hasCapability(capabilityId)) {
      return null;
    }
    const category = (capabilityId.split('.')[0] || capabilityId.split(':')[0]).toLowerCase();
    if (RuntimeRouter.VALID_CATEGORIES.has(category)) {
      return category;
    }
    return null;
  }

  public validateCapabilityRuntimeMatch(capabilityId: string, runtimeCategory: string): boolean {
    if (!capabilityId || !runtimeCategory) {
      return false;
    }
    const expectedCategory = this.resolveRuntimeCategory(capabilityId);
    if (!expectedCategory) {
      return false;
    }
    return expectedCategory === runtimeCategory.toLowerCase();
  }
}
