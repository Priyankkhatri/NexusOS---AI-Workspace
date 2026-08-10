export interface IsolationPolicy {
  enableLogicalIsolation: boolean;
  enableOSProcessSandbox: boolean;
  allowedResourceRoots: string[];
}

export class SandboxIsolationBoundary {
  private readonly policy: IsolationPolicy;

  constructor(policyOverrides: Partial<IsolationPolicy> = {}) {
    this.policy = Object.freeze({
      enableLogicalIsolation: true,
      enableOSProcessSandbox: false, // Task 03A foundation level: logical isolation active, OS process sandbox planned
      allowedResourceRoots: [],
      ...policyOverrides,
    });
  }

  getPolicy(): IsolationPolicy {
    return this.policy;
  }

  isOSIsolationEnforced(): boolean {
    return this.policy.enableOSProcessSandbox;
  }
}
