import crypto from 'node:crypto';
import {
  ACPMessageEnvelope,
  createACPMessageEnvelope,
  EventEnvelope,
  TaskRecord,
} from '@nexusos/contracts';

export interface IACPRelayTarget {
  receiveACPMessage(envelope: ACPMessageEnvelope): Promise<void>;
}

export interface IReceiptSettler {
  settleReceipt(receipt: unknown): Promise<TaskRecord>;
}

export class ACPDispatchBridge {
  private targetAgent?: IACPRelayTarget;
  private receiptSettler?: IReceiptSettler;

  constructor(targetAgent?: IACPRelayTarget, receiptSettler?: IReceiptSettler) {
    this.targetAgent = targetAgent;
    this.receiptSettler = receiptSettler;
  }

  public setTargetAgent(target: IACPRelayTarget): void {
    this.targetAgent = target;
  }

  public setReceiptSettler(settler: IReceiptSettler): void {
    this.receiptSettler = settler;
  }

  /**
   * Dispatches a leased task to the Desktop Agent via ACP Message Envelope
   */
  public async dispatchTask(task: TaskRecord): Promise<ACPMessageEnvelope> {
    if (!task.lease) {
      throw new Error(`Cannot dispatch task '${task.taskId}': task has no execution lease.`);
    }

    // 047-SEC-11: Backend CANNOT directly execute desktop tools; it MUST dispatch an ACP envelope
    const messageId = crypto.randomUUID();
    const envelope = createACPMessageEnvelope(
      '1.0.0',
      'control-plane-backend',
      task.targetAgentId,
      'schema:nexusos:acp:task:execute:v1',
      task.taskId,
      {
        task_id: task.taskId,
        step_id: 'step-01',
        correlation_id: task.taskId,
        leaseHeader: task.lease,
        capabilityId: task.capabilityId,
        runtimeCategory: task.runtimeCategory,
        payload: task.parameters,
        timeoutMs: 30000,
        message_id: messageId,
      },
    );

    if (this.targetAgent) {
      await this.targetAgent.receiveACPMessage(envelope);
    }

    return envelope;
  }

  /**
   * Dispatches a leased workflow DAG to the Desktop Agent via ACP Message Envelope
   */
  public async dispatchWorkflow(
    task: TaskRecord,
    dag: import('@nexusos/contracts').WorkflowDAG,
  ): Promise<ACPMessageEnvelope> {
    if (!task.lease) {
      throw new Error(`Cannot dispatch workflow '${task.taskId}': task has no execution lease.`);
    }

    const messageId = crypto.randomUUID();
    const envelope = createACPMessageEnvelope(
      '1.0.0',
      'control-plane-backend',
      task.targetAgentId,
      'schema:nexusos:acp:workflow:execute:v1',
      task.taskId,
      {
        workflow: dag,
        dag,
        task_id: task.taskId,
        taskId: task.taskId,
        workflow_id: dag.workflowId,
        workflowId: dag.workflowId,
        correlation_id: task.taskId,
        correlationId: task.taskId,
        leaseHeader: task.lease,
        message_id: messageId,
      },
    );

    if (this.targetAgent) {
      await this.targetAgent.receiveACPMessage(envelope);
    }

    return envelope;
  }

  /**
   * Inbound receipt event from Desktop Agent over ACP stream
   */
  public async handleInboundEvent(event: EventEnvelope): Promise<void> {
    if (event.schema_id === 'schema:nexusos:task:receipt:v1') {
      if (this.receiptSettler) {
        await this.receiptSettler.settleReceipt(event.payload);
      }
    }
  }

  /**
   * Inbound receipt ACP message envelope from Desktop Agent
   */
  public async handleIncomingFrame(envelope: ACPMessageEnvelope): Promise<void> {
    if (this.receiptSettler && envelope.payload) {
      await this.receiptSettler.settleReceipt(envelope.payload);
    }
  }
}
