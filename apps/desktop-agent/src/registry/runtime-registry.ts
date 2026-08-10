export enum RuntimeCategory {
  FILESYSTEM = 'FILESYSTEM',
  TERMINAL = 'TERMINAL',
  BROWSER = 'BROWSER',
  PLUGIN = 'PLUGIN',
  CLIPBOARD = 'CLIPBOARD',
  CAMERA = 'CAMERA',
  MICROPHONE = 'MICROPHONE',
  LOCAL_AI = 'LOCAL_AI',
}

export interface ToolRuntimeDescriptor {
  runtimeId: string;
  category: RuntimeCategory;
  version: string;
  isExecutable: boolean;
  supportedActions: string[];
}

export class RuntimeRegistry {
  private readonly runtimes = new Map<string, ToolRuntimeDescriptor>();

  registerRuntime(descriptor: ToolRuntimeDescriptor): void {
    if (this.runtimes.has(descriptor.runtimeId)) {
      throw new Error(
        `[RuntimeRegistryError] Runtime '${descriptor.runtimeId}' is already registered.`,
      );
    }

    // Safety invariant: Runtime foundation descriptors MUST NOT be registered as executable in Task 03A
    if (descriptor.isExecutable) {
      throw new Error(
        `[RuntimeRegistrySecurityError] Dangerous runtime execution is prohibited in Task 03A foundation ('${descriptor.runtimeId}').`,
      );
    }

    this.runtimes.set(descriptor.runtimeId, Object.freeze({ ...descriptor }));
  }

  hasRuntime(runtimeId: string): boolean {
    return this.runtimes.has(runtimeId);
  }

  getRuntime(runtimeId: string): ToolRuntimeDescriptor | undefined {
    return this.runtimes.get(runtimeId);
  }

  listRuntimes(): ToolRuntimeDescriptor[] {
    return Array.from(this.runtimes.values());
  }
}
