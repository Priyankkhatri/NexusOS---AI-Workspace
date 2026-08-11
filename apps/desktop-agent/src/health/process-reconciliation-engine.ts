import { BrowserSessionManager } from '../runtimes/browser/session-manager.js';
import { PluginQuarantineStore } from '../runtimes/plugin/quarantine-store.js';
import { ProcessSupervisor } from '../runtimes/terminal/process-supervisor.js';
import {
  IProcessReconciliationEngine,
  ProcessReconciliationResult,
  RecoveryManifest,
} from './types.js';

export class ProcessReconciliationEngine implements IProcessReconciliationEngine {
  constructor(
    private readonly terminalSupervisor: ProcessSupervisor = new ProcessSupervisor(),
    private readonly browserSessionManager: BrowserSessionManager = new BrowserSessionManager(),
    private readonly pluginQuarantineStore: PluginQuarantineStore = new PluginQuarantineStore(),
  ) {}

  public async reconcileOrphanedProcesses(
    manifest: RecoveryManifest | null,
  ): Promise<ProcessReconciliationResult> {
    const details: string[] = [];
    let orphanedTerminalProcesses = 0;
    let terminatedBrowserSessions = 0;
    let quarantinedPlugins = 0;

    if (!manifest || !manifest.activeStepCheckpoints) {
      return {
        reconciledCount: 0,
        orphanedTerminalProcesses: 0,
        terminatedBrowserSessions: 0,
        quarantinedPlugins: 0,
        details: ['No active recovery manifest found; process reconciliation skipped.'],
      };
    }

    for (const checkpoint of manifest.activeStepCheckpoints) {
      try {
        if (checkpoint.runnerType === 'TERMINAL') {
          if (checkpoint.ownershipToken) {
            this.terminalSupervisor.killProcess(checkpoint.ownershipToken);
            orphanedTerminalProcesses++;
            details.push(
              `Terminated orphaned Terminal process tree for step '${checkpoint.stepId}' (token: ${checkpoint.ownershipToken}).`,
            );
          }
        } else if (checkpoint.runnerType === 'BROWSER') {
          if (checkpoint.ownershipToken) {
            this.browserSessionManager.clearSession(checkpoint.ownershipToken);
            terminatedBrowserSessions++;
            details.push(
              `Closed orphaned Browser session for step '${checkpoint.stepId}' (sessionId: ${checkpoint.ownershipToken}).`,
            );
          }
        } else if (checkpoint.runnerType === 'PLUGIN') {
          if (checkpoint.ownershipToken) {
            this.pluginQuarantineStore.quarantinePlugin(
              checkpoint.ownershipToken,
              'Abnormal exit during plugin execution',
            );
            quarantinedPlugins++;
            details.push(
              `Quarantined Plugin '${checkpoint.ownershipToken}' following abnormal crash exit.`,
            );
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        details.push(`Failed process reconciliation for step '${checkpoint.stepId}': ${msg}`);
      }
    }

    const reconciledCount =
      orphanedTerminalProcesses + terminatedBrowserSessions + quarantinedPlugins;

    return {
      reconciledCount,
      orphanedTerminalProcesses,
      terminatedBrowserSessions,
      quarantinedPlugins,
      details,
    };
  }
}
