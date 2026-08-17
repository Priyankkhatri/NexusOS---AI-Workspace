import { ExecutionLeaseHeader } from '@nexusos/contracts';
import { RedactionFilter } from '../telemetry/redaction-filter.js';
import { WorkflowNode } from './types.js';

export const MAX_NODE_OUTPUT_BYTES = 1048576; // 1 MB per node output limit

export interface ImmutableWorkflowContext {
  readonly workflowId: string;
  readonly taskId: string;
  readonly tenantId: string;
  readonly deviceId: string;
  readonly correlationId: string;
  readonly leaseHeader: Readonly<ExecutionLeaseHeader>;
}

export class WorkflowStepContext {
  private readonly outputs = new Map<string, Record<string, unknown>>();

  constructor(
    public readonly context: ImmutableWorkflowContext,
    private readonly redactionFilter?: RedactionFilter,
  ) {}

  public setNodeOutput(nodeId: string, output: Record<string, unknown>): void {
    if (!output || typeof output !== 'object') {
      return;
    }

    // Prototype pollution guard: reject outputs with dangerous property keys
    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    for (const key of Object.keys(output)) {
      if (dangerousKeys.includes(key)) {
        throw new Error(
          `Node output for '${nodeId}' contains a dangerous property key '${key}' (prototype pollution attempt rejected).`,
        );
      }
    }

    // 1. Redact output payload using RedactionFilter
    const sanitizedOutput = this.redactionFilter
      ? (this.redactionFilter.redactObject(output) as Record<string, unknown>)
      : { ...output };

    // 2. Enforce 1MB Byte Size Boundary (with serialization error handling)
    let serialized: string;
    try {
      serialized = JSON.stringify(sanitizedOutput);
    } catch (err) {
      throw new Error(
        `Node output for '${nodeId}' is not JSON-serializable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (Buffer.byteLength(serialized, 'utf8') > MAX_NODE_OUTPUT_BYTES) {
      throw new Error(
        `Node output for '${nodeId}' exceeds maximum limit of 1MB (${MAX_NODE_OUTPUT_BYTES} bytes).`,
      );
    }

    // Store deep copy to prevent mutation
    this.outputs.set(nodeId, JSON.parse(serialized));
  }

  public getNodeOutput(nodeId: string): Record<string, unknown> | undefined {
    const raw = this.outputs.get(nodeId);
    if (!raw) {
      return undefined;
    }
    return JSON.parse(JSON.stringify(raw));
  }

  public getAllOutputs(): Record<string, Record<string, unknown>> {
    const result: Record<string, Record<string, unknown>> = {};
    for (const [nodeId, val] of this.outputs.entries()) {
      result[nodeId] = JSON.parse(JSON.stringify(val));
    }
    return result;
  }

  public buildNodeExecutionPayload(node: WorkflowNode): Record<string, unknown> {
    const payload = JSON.parse(JSON.stringify(node.payload || {}));

    // Inject outputs from explicit parent dependencies if present
    if (node.dependencies && Array.isArray(node.dependencies)) {
      const parentOutputs: Record<string, unknown> = {};
      for (const parentId of node.dependencies) {
        const parentOut = this.getNodeOutput(parentId);
        if (parentOut) {
          parentOutputs[parentId] = parentOut;
        }
      }
      payload._dependencyOutputs = parentOutputs;
    }

    return payload;
  }
}
