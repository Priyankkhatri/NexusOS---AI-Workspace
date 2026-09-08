import crypto from 'node:crypto';
import {
  ExecutionReceipt,
  ExecutionReceiptSchema,
  WorkflowExecutionReceipt,
  WorkflowExecutionReceiptSchema,
} from '@nexusos/contracts';

/**
 * Computes canonical SHA-256 evidence hash of capability output
 */
export function computeEvidenceHash(output: unknown): string {
  const serialized = JSON.stringify(output ?? {});
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

/**
 * Computes canonical HMAC-SHA256 signature over execution receipt attributes
 */
export function computeReceiptSignature(
  receipt: Omit<ExecutionReceipt, 'signature'>,
  secret: string,
): string {
  const payload = [
    receipt.receiptId,
    receipt.taskId,
    receipt.leaseId,
    receipt.agentId,
    receipt.tenantId,
    receipt.status,
    (receipt.exitCode ?? 0).toString(),
    receipt.evidenceChecksum,
    receipt.completedAt,
  ].join(':');

  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Computes canonical HMAC-SHA256 signature over workflow execution receipt attributes
 */
export function computeWorkflowReceiptSignature(
  receipt: Omit<WorkflowExecutionReceipt, 'signature'>,
  secret: string,
): string {
  const payload = [
    receipt.receiptId,
    receipt.workflowId,
    receipt.taskId,
    receipt.leaseId,
    receipt.agentId,
    receipt.tenantId,
    receipt.status,
    receipt.completedNodes.slice().sort().join(','),
    receipt.evidenceChecksum,
    receipt.completedAt,
  ].join(':');

  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verifies execution receipt cryptographic signature using timingSafeEqual
 */
export function verifyReceiptSignature(receipt: ExecutionReceipt, secret: string): boolean {
  try {
    const expected = computeReceiptSignature(receipt, secret);
    if (receipt.signature.length !== expected.length) {
      return false;
    }
    return crypto.timingSafeEqual(
      Buffer.from(receipt.signature, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    return false;
  }
}

/**
 * Verifies workflow execution receipt cryptographic signature using timingSafeEqual
 */
export function verifyWorkflowReceiptSignature(
  receipt: WorkflowExecutionReceipt,
  secret: string,
): boolean {
  try {
    const expected = computeWorkflowReceiptSignature(receipt, secret);
    if (receipt.signature.length !== expected.length) {
      return false;
    }
    return crypto.timingSafeEqual(
      Buffer.from(receipt.signature, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    return false;
  }
}

export interface ReceiptVerificationResult {
  valid: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface ReceiptExpectations {
  expectedTaskId: string;
  expectedLeaseId?: string;
  expectedAgentId: string;
  expectedTenantId: string;
}

export interface ReceiptVerifierOptions {
  agentSecret: string;
}

export class ReceiptVerifier {
  private readonly secretKey: string;

  constructor(secretKeyOrOptions: string | ReceiptVerifierOptions) {
    if (typeof secretKeyOrOptions === 'object') {
      this.secretKey = secretKeyOrOptions.agentSecret;
    } else {
      this.secretKey = secretKeyOrOptions;
    }

    if (!this.secretKey || this.secretKey.length < 16) {
      throw new Error('ReceiptVerifier requires a secret key of at least 16 characters.');
    }
  }

  public verifyReceipt(params: {
    receipt: unknown;
    expectedTaskId: string;
    expectedLeaseId?: string;
    expectedAgentId?: string;
    expectedTenantId: string;
    actualOutput?: unknown;
  }): ReceiptVerificationResult {
    return this.verify(params.receipt, {
      expectedTaskId: params.expectedTaskId,
      expectedLeaseId: params.expectedLeaseId,
      expectedAgentId:
        params.expectedAgentId ??
        (typeof params.receipt === 'object' &&
        params.receipt !== null &&
        'agentId' in params.receipt &&
        typeof (params.receipt as { agentId?: unknown }).agentId === 'string'
          ? (params.receipt as { agentId: string }).agentId
          : ''),
      expectedTenantId: params.expectedTenantId,
    });
  }

  public verify(rawReceipt: unknown, expectations: ReceiptExpectations): ReceiptVerificationResult {
    // 1. Schema Validation
    const parseResult = ExecutionReceiptSchema.safeParse(rawReceipt);
    if (!parseResult.success) {
      return {
        valid: false,
        errorCode: 'MALFORMED_RECEIPT',
        errorMessage: `Receipt schema validation failed: ${parseResult.error.message}`,
      };
    }

    const receipt = parseResult.data;

    // 2. Task & Lease Binding
    if (receipt.taskId !== expectations.expectedTaskId) {
      return {
        valid: false,
        errorCode: 'TASK_ID_MISMATCH',
        errorMessage: `Receipt task_id '${receipt.taskId}' does not match expected '${expectations.expectedTaskId}'.`,
      };
    }

    if (expectations.expectedLeaseId && receipt.leaseId !== expectations.expectedLeaseId) {
      return {
        valid: false,
        errorCode: 'LEASE_ID_MISMATCH',
        errorMessage: `Receipt lease_id '${receipt.leaseId}' does not match expected '${expectations.expectedLeaseId}'.`,
      };
    }

    // 3. Security Context & Tenant Consistency
    if (receipt.tenantId !== expectations.expectedTenantId) {
      return {
        valid: false,
        errorCode: 'TENANT_MISMATCH',
        errorMessage: `Receipt tenant_id '${receipt.tenantId}' does not match expected '${expectations.expectedTenantId}'.`,
      };
    }

    if (receipt.agentId !== expectations.expectedAgentId) {
      return {
        valid: false,
        errorCode: 'AGENT_ID_MISMATCH',
        errorMessage: `Receipt agent_id '${receipt.agentId}' does not match expected '${expectations.expectedAgentId}'.`,
      };
    }

    // 4. Evidence Integrity / Checksum Validation
    const expectedChecksum = computeEvidenceHash(receipt.output);
    if (receipt.evidenceChecksum !== expectedChecksum) {
      return {
        valid: false,
        errorCode: 'EVIDENCE_HASH_MISMATCH',
        errorMessage: `Receipt evidence checksum '${receipt.evidenceChecksum}' does not match computed output hash '${expectedChecksum}'.`,
      };
    }

    // 5. Cryptographic Signature Verification
    if (!verifyReceiptSignature(receipt, this.secretKey)) {
      return {
        valid: false,
        errorCode: 'INVALID_RECEIPT_SIGNATURE',
        errorMessage: 'Receipt cryptographic signature is invalid or tampered.',
      };
    }

    return { valid: true };
  }

  public verifyWorkflowReceipt(
    rawReceipt: unknown,
    expectations: {
      expectedTaskId: string;
      expectedWorkflowId?: string;
      expectedLeaseId?: string;
      expectedAgentId: string;
      expectedTenantId: string;
    },
  ): ReceiptVerificationResult {
    // 1. Schema Validation
    const parseResult = WorkflowExecutionReceiptSchema.safeParse(rawReceipt);
    if (!parseResult.success) {
      return {
        valid: false,
        errorCode: 'MALFORMED_WORKFLOW_RECEIPT',
        errorMessage: `Workflow receipt schema validation failed: ${parseResult.error.message}`,
      };
    }

    const receipt = parseResult.data;

    // 2. Task, Workflow & Lease Binding
    if (receipt.taskId !== expectations.expectedTaskId) {
      return {
        valid: false,
        errorCode: 'TASK_ID_MISMATCH',
        errorMessage: `Receipt task_id '${receipt.taskId}' does not match expected '${expectations.expectedTaskId}'.`,
      };
    }

    if (expectations.expectedWorkflowId && receipt.workflowId !== expectations.expectedWorkflowId) {
      return {
        valid: false,
        errorCode: 'WORKFLOW_ID_MISMATCH',
        errorMessage: `Receipt workflow_id '${receipt.workflowId}' does not match expected '${expectations.expectedWorkflowId}'.`,
      };
    }

    if (expectations.expectedLeaseId && receipt.leaseId !== expectations.expectedLeaseId) {
      return {
        valid: false,
        errorCode: 'LEASE_ID_MISMATCH',
        errorMessage: `Receipt lease_id '${receipt.leaseId}' does not match expected '${expectations.expectedLeaseId}'.`,
      };
    }

    // 3. Security Context & Tenant Consistency
    if (receipt.tenantId !== expectations.expectedTenantId) {
      return {
        valid: false,
        errorCode: 'TENANT_MISMATCH',
        errorMessage: `Receipt tenant_id '${receipt.tenantId}' does not match expected '${expectations.expectedTenantId}'.`,
      };
    }

    if (receipt.agentId !== expectations.expectedAgentId) {
      return {
        valid: false,
        errorCode: 'AGENT_ID_MISMATCH',
        errorMessage: `Receipt agent_id '${receipt.agentId}' does not match expected '${expectations.expectedAgentId}'.`,
      };
    }

    // 4. Evidence Integrity / Checksum Validation
    const expectedChecksum = computeEvidenceHash(receipt.nodeOutputs);
    if (receipt.evidenceChecksum !== expectedChecksum) {
      return {
        valid: false,
        errorCode: 'EVIDENCE_HASH_MISMATCH',
        errorMessage: `Receipt evidence checksum '${receipt.evidenceChecksum}' does not match computed nodeOutputs hash '${expectedChecksum}'.`,
      };
    }

    // 5. Cryptographic Signature Verification
    if (!verifyWorkflowReceiptSignature(receipt, this.secretKey)) {
      return {
        valid: false,
        errorCode: 'INVALID_RECEIPT_SIGNATURE',
        errorMessage: 'Workflow receipt cryptographic signature is invalid or tampered.',
      };
    }

    return { valid: true };
  }
}
