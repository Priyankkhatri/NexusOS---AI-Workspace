import { PlanRiskTier } from '@nexusos/contracts';
import { ICapabilityRegistryBoundary } from './types.js';

export interface CapabilityMetadata {
  id: string;
  category: string;
  riskTier: PlanRiskTier;
  description: string;
}

/**
 * Authoritative Canonical Capability Registry (057-SEC-04).
 * Enforces a strict closed allowlist of registered capabilities across NexusOS runtimes.
 */
export class DefaultCapabilityRegistry implements ICapabilityRegistryBoundary {
  private readonly capabilities = new Map<string, CapabilityMetadata>();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    // Filesystem Runtime
    this.register({
      id: 'filesystem.readFile',
      category: 'filesystem',
      riskTier: 'LOW',
      description: 'Read file contents from authorized workspace root',
    });
    this.register({
      id: 'filesystem.listDirectory',
      category: 'filesystem',
      riskTier: 'LOW',
      description: 'List files and directories in path',
    });
    this.register({
      id: 'filesystem.searchFiles',
      category: 'filesystem',
      riskTier: 'LOW',
      description: 'Search directory tree for files matching pattern',
    });
    this.register({
      id: 'filesystem.writeFile',
      category: 'filesystem',
      riskTier: 'MEDIUM',
      description: 'Write or overwrite file contents in workspace',
    });
    this.register({
      id: 'filesystem.copyFile',
      category: 'filesystem',
      riskTier: 'LOW',
      description: 'Copy file within workspace root',
    });
    this.register({
      id: 'filesystem.moveFile',
      category: 'filesystem',
      riskTier: 'MEDIUM',
      description: 'Move or rename file within workspace',
    });
    this.register({
      id: 'filesystem.deleteFile',
      category: 'filesystem',
      riskTier: 'HIGH',
      description: 'Delete file within workspace',
    });

    // Terminal Runtime
    this.register({
      id: 'terminal.execute',
      category: 'terminal',
      riskTier: 'HIGH',
      description: 'Execute command in controlled process tree',
    });

    // Device Runtime
    this.register({
      id: 'device.queryInfo',
      category: 'device',
      riskTier: 'LOW',
      description: 'Query host hardware and OS profile',
    });
    this.register({
      id: 'device.execute',
      category: 'device',
      riskTier: 'HIGH',
      description: 'Execute managed device action',
    });

    // Browser Runtime
    this.register({
      id: 'browser.navigate',
      category: 'browser',
      riskTier: 'LOW',
      description: 'Navigate to policy-allowed URL',
    });
    this.register({
      id: 'browser.extractText',
      category: 'browser',
      riskTier: 'LOW',
      description: 'Extract text content from active page',
    });
    this.register({
      id: 'browser.screenshot',
      category: 'browser',
      riskTier: 'LOW',
      description: 'Capture screenshot of current page',
    });
    this.register({
      id: 'browser.click',
      category: 'browser',
      riskTier: 'MEDIUM',
      description: 'Click interactive element on page',
    });
    this.register({
      id: 'browser.type',
      category: 'browser',
      riskTier: 'MEDIUM',
      description: 'Type text into page input field',
    });
    this.register({
      id: 'browser.close',
      category: 'browser',
      riskTier: 'LOW',
      description: 'Close active browser session',
    });

    // Local AI Runtime
    this.register({
      id: 'localAi.generate',
      category: 'ai',
      riskTier: 'LOW',
      description: 'Perform local model inference',
    });
    this.register({
      id: 'localAi.listModels',
      category: 'ai',
      riskTier: 'LOW',
      description: 'List available local model weights',
    });
    this.register({
      id: 'localAi.getHardwareProfile',
      category: 'ai',
      riskTier: 'LOW',
      description: 'Get GPU/VRAM hardware detection profile',
    });
    this.register({
      id: 'localAi.unloadModel',
      category: 'ai',
      riskTier: 'LOW',
      description: 'Unload active model from memory',
    });

    // Plugin Runtime
    this.register({
      id: 'plugin.execute',
      category: 'plugin',
      riskTier: 'MEDIUM',
      description: 'Execute registered plugin action',
    });

    // Agent Delegation Runtime (Task 060)
    this.register({
      id: 'agent.delegate',
      category: 'agent',
      riskTier: 'MEDIUM',
      description:
        'Delegate bounded sub-task to specialized logical sub-agent with attenuated lease',
    });
  }

  public register(meta: CapabilityMetadata): void {
    const normalized = this.normalizeId(meta.id);
    this.capabilities.set(normalized, { ...meta, id: normalized });
  }

  public isRegistered(capabilityId: string): boolean {
    if (!capabilityId || typeof capabilityId !== 'string') return false;
    const normalized = this.normalizeId(capabilityId);
    return this.capabilities.has(normalized);
  }

  public getCategory(capabilityId: string): string | undefined {
    const normalized = this.normalizeId(capabilityId);
    return this.capabilities.get(normalized)?.category;
  }

  public getRiskTier(capabilityId: string): PlanRiskTier {
    const normalized = this.normalizeId(capabilityId);
    return this.capabilities.get(normalized)?.riskTier ?? 'HIGH';
  }

  public listRegisteredCapabilities(): string[] {
    return Array.from(this.capabilities.keys());
  }

  private normalizeId(id: string): string {
    const trimmed = id.trim();
    // Handle colon notation (e.g. 'filesystem:readFile' -> 'filesystem.readFile')
    if (trimmed.startsWith('capability:')) {
      return trimmed.slice('capability:'.length).replace(/:/g, '.');
    }
    return trimmed.replace(/:/g, '.');
  }
}

export const defaultCapabilityRegistry = new DefaultCapabilityRegistry();
