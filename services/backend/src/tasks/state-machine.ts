import { TaskLifecycleState, TaskRecord } from '@nexusos/contracts';

export class TaskStateMachineError extends Error {
  constructor(
    public readonly fromState: TaskLifecycleState,
    public readonly toState: TaskLifecycleState,
    message: string,
  ) {
    super(message);
    this.name = 'TaskStateMachineError';
  }
}

export class TaskStateMachine {
  private static readonly ALLOWED_TRANSITIONS: Record<
    TaskLifecycleState,
    ReadonlySet<TaskLifecycleState>
  > = {
    [TaskLifecycleState.SUBMITTED]: new Set([
      TaskLifecycleState.POLICY_EVALUATED,
      TaskLifecycleState.FAILED,
      TaskLifecycleState.CANCELLED,
    ]),
    [TaskLifecycleState.POLICY_EVALUATED]: new Set([
      TaskLifecycleState.LEASED,
      TaskLifecycleState.FAILED,
      TaskLifecycleState.CANCELLED,
    ]),
    [TaskLifecycleState.LEASED]: new Set([
      TaskLifecycleState.DISPATCHED,
      TaskLifecycleState.FAILED,
      TaskLifecycleState.CANCELLED,
    ]),
    [TaskLifecycleState.DISPATCHED]: new Set([
      TaskLifecycleState.EXECUTING,
      TaskLifecycleState.FAILED,
      TaskLifecycleState.CANCELLED,
    ]),
    [TaskLifecycleState.EXECUTING]: new Set([
      TaskLifecycleState.RECEIPT_VERIFIED,
      TaskLifecycleState.FAILED,
      TaskLifecycleState.CANCELLED,
    ]),
    [TaskLifecycleState.RECEIPT_VERIFIED]: new Set([
      TaskLifecycleState.COMPLETED,
      TaskLifecycleState.FAILED,
    ]),
    [TaskLifecycleState.COMPLETED]: new Set(),
    [TaskLifecycleState.FAILED]: new Set(),
    [TaskLifecycleState.CANCELLED]: new Set(),
  };

  public static canTransition(
    currentState: TaskLifecycleState,
    targetState: TaskLifecycleState,
  ): boolean {
    const allowed = this.ALLOWED_TRANSITIONS[currentState];
    return allowed ? allowed.has(targetState) : false;
  }

  public static transition(
    task: TaskRecord,
    targetState: TaskLifecycleState,
    reason?: string,
  ): TaskRecord {
    if (!this.canTransition(task.state, targetState)) {
      throw new TaskStateMachineError(
        task.state,
        targetState,
        `Illegal task state transition from '${task.state}' to '${targetState}'. ${reason ?? ''}`.trim(),
      );
    }

    const error =
      targetState === TaskLifecycleState.FAILED && reason
        ? { code: 'TASK_EXECUTION_FAILED', message: reason }
        : task.error;

    return {
      ...task,
      state: targetState,
      error,
      updatedAt: new Date().toISOString(),
    };
  }

  public static isTerminal(state: TaskLifecycleState): boolean {
    return (
      state === TaskLifecycleState.COMPLETED ||
      state === TaskLifecycleState.FAILED ||
      state === TaskLifecycleState.CANCELLED
    );
  }
}
