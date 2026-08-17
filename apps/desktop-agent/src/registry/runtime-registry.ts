export enum RuntimeCategory {
  FILESYSTEM = 'FILESYSTEM',
  TERMINAL = 'TERMINAL',
  BROWSER = 'BROWSER',
  PLUGIN = 'PLUGIN',
  CLIPBOARD = 'CLIPBOARD',
  DEVICE = 'DEVICE',
  CAMERA = 'CAMERA',
  MICROPHONE = 'MICROPHONE',
  LOCAL_AI = 'LOCAL_AI',
  IDE = 'IDE',
}

export interface ToolRuntimeDescriptor {
  runtimeId: string;
  category: RuntimeCategory;
  version: string;
  isExecutable: boolean;
  supportedActions: string[];
}

/**
 * Controls whether a runtime descriptor may be registered as executable.
 *
 * The foundation layer uses FoundationExecutionPolicy, which always denies.
 * Future runtime phases provide an explicit policy that gates enablement
 * through the required authorization chain:
 *
 *   Runtime registered
 *     → Runtime capability declared
 *       → Runtime authorization/policy requirements satisfied
 *         → Valid execution lease
 *           → Runtime allowed to execute
 *
 * This keeps the fail-closed default without requiring a code removal
 * to enable future authorized runtimes.
 */
export interface RuntimeExecutionPolicy {
  /**
   * Returns true if the given runtime descriptor is allowed to be
   * registered as executable. Returns false to deny.
   */
  allowExecutableRegistration(descriptor: ToolRuntimeDescriptor): boolean;
}

/**
 * Foundation-layer execution policy: always deny executable registration.
 * This is the default and MUST NOT be bypassed in Task 03A.
 */
export class FoundationExecutionPolicy implements RuntimeExecutionPolicy {
  allowExecutableRegistration(_descriptor: ToolRuntimeDescriptor): boolean {
    return false;
  }
}

export class RuntimeRegistry {
  private readonly runtimes = new Map<string, ToolRuntimeDescriptor>();
  private readonly executionPolicy: RuntimeExecutionPolicy;

  constructor(executionPolicy?: RuntimeExecutionPolicy) {
    this.executionPolicy = executionPolicy ?? new FoundationExecutionPolicy();
  }

  registerRuntime(descriptor: ToolRuntimeDescriptor): void {
    if (this.runtimes.has(descriptor.runtimeId)) {
      throw new Error(
        `[RuntimeRegistryError] Runtime '${descriptor.runtimeId}' is already registered.`,
      );
    }

    // Executable runtime registration requires explicit policy authorization.
    // The foundation-layer FoundationExecutionPolicy always denies.
    if (descriptor.isExecutable && !this.executionPolicy.allowExecutableRegistration(descriptor)) {
      throw new Error(
        `[RuntimeRegistrySecurityError] Executable runtime registration denied by execution policy ('${descriptor.runtimeId}'). ` +
          `Future runtime enablement requires: capability declaration → policy authorization → valid execution lease.`,
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
