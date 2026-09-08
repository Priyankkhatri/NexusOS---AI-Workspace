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

  /**
   * Resolves template expressions in values, e.g. {{nodes.<nodeId>.output.<key>}}
   * Enforces 049-SEC-04: Strict prototype pollution guards and path validation.
   */
  public resolveInterpolation(value: unknown): unknown {
    return resolveInterpolation(value, { nodes: this.getAllOutputsForInterpolation() });
  }

  public getAllOutputsForInterpolation(): Record<string, { output?: Record<string, unknown> }> {
    const res: Record<string, { output?: Record<string, unknown> }> = {};
    for (const [nodeId, output] of this.outputs.entries()) {
      res[nodeId] = { output };
    }
    return res;
  }

  public buildNodeExecutionPayload(node: WorkflowNode): Record<string, unknown> {
    const rawPayload = JSON.parse(JSON.stringify(node.payload || {}));
    const interpolatedPayload = this.resolveInterpolation(rawPayload) as Record<string, unknown>;

    // Inject outputs from explicit parent dependencies if present
    if (node.dependencies && Array.isArray(node.dependencies)) {
      const parentOutputs: Record<string, unknown> = {};
      for (const parentId of node.dependencies) {
        const parentOut = this.getNodeOutput(parentId);
        if (parentOut) {
          parentOutputs[parentId] = parentOut;
        }
      }
      interpolatedPayload._dependencyOutputs = parentOutputs;
    }

    return interpolatedPayload;
  }
}

/**
 * Standalone prototype-pollution-safe context interpolation (049-SEC-04)
 * Resolves expressions such as {{nodes.<nodeId>.output.<key>}}
 */
export function resolveInterpolation(
  value: unknown,
  context: { nodes: Record<string, { output?: Record<string, unknown> }> },
): unknown {
  if (typeof value === 'string') {
    const rawMatches = Array.from(value.matchAll(/\{\{([^}]+)\}\}/g));
    if (rawMatches.length === 0) {
      return value;
    }

    for (const m of rawMatches) {
      const expr = m[1].trim();
      const parts = expr.split('.');
      for (const part of parts) {
        if (part === '__proto__' || part === 'constructor' || part === 'prototype') {
          throw new Error(
            `049-SEC-04: Prototype pollution attempt detected in workflow expression: '${expr}' contains unsafe property '${part}'.`,
          );
        }
      }
      if (!/^nodes\.[a-zA-Z0-9_-]+\.output\.[a-zA-Z0-9_.-]+$/.test(expr)) {
        throw new Error(
          `049-SEC-04: Invalid workflow interpolation pattern '{{${expr}}}'. Must match '{{nodes.<id>.output.<key>}}'.`,
        );
      }
    }

    const singleMatch = /^\{\{nodes\.([a-zA-Z0-9_-]+)\.output\.([a-zA-Z0-9_.-]+)\}\}$/.exec(
      value.trim(),
    );
    if (singleMatch) {
      const nodeId = singleMatch[1];
      const keyPath = singleMatch[2];
      const nodeData = context.nodes[nodeId];
      if (nodeData && nodeData.output) {
        let current: unknown = nodeData.output;
        for (const part of keyPath.split('.')) {
          if (part === '__proto__' || part === 'constructor' || part === 'prototype') {
            throw new Error('049-SEC-04: Prototype pollution attempt detected in key navigation.');
          }
          if (
            current &&
            typeof current === 'object' &&
            part in (current as Record<string, unknown>)
          ) {
            current = (current as Record<string, unknown>)[part];
          } else {
            return value;
          }
        }
        return current;
      }
      return value;
    }

    const templateRegex = /\{\{nodes\.([a-zA-Z0-9_-]+)\.output\.([a-zA-Z0-9_.-]+)\}\}/g;
    return value.replace(templateRegex, (_match, nodeId, keyPath) => {
      const nodeData = context.nodes[nodeId];
      if (!nodeData || !nodeData.output) {
        return _match;
      }
      let current: unknown = nodeData.output;
      for (const part of keyPath.split('.')) {
        if (part === '__proto__' || part === 'constructor' || part === 'prototype') {
          throw new Error('049-SEC-04: Prototype pollution attempt detected in key navigation.');
        }
        if (
          current &&
          typeof current === 'object' &&
          part in (current as Record<string, unknown>)
        ) {
          current = (current as Record<string, unknown>)[part];
        } else {
          return _match;
        }
      }
      return typeof current === 'object' ? JSON.stringify(current) : String(current);
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveInterpolation(item, context));
  }

  if (value && typeof value === 'object') {
    const resolvedObj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
        throw new Error(
          `049-SEC-04: Prototype pollution attempt detected: unsafe property key '${k}'.`,
        );
      }
      resolvedObj[k] = resolveInterpolation(v, context);
    }
    return resolvedObj;
  }

  return value;
}
