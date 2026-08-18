import fs from 'node:fs';
import os from 'node:os';
import { ReadinessGate } from './readiness-gate.js';
import {
  HealthReport,
  HealthState,
  IHealthMonitor,
  ReadinessCheckResult,
  ResourceUsage,
} from './types.js';

import { NotificationManager } from '../notifications/notification-manager.js';

export class HealthMonitor implements IHealthMonitor {
  private readonly startTime = Date.now();
  private lastCpuUsage = process.cpuUsage();
  private lastCpuCheckTime = Date.now();

  constructor(
    private readonly agentId: string = '00000000-0000-4000-8000-000000000000',
    private readonly agentVersion: string = '0.1.0-sprint0',
    private readonly readinessGate: ReadinessGate = new ReadinessGate(),
    private readonly storageDir: string = '.',
    private readonly notificationManager?: NotificationManager,
  ) {}

  public checkLiveness(): boolean {
    // Process is alive if main event loop is responsive and memory usage is bounded
    const mem = process.memoryUsage();
    // Fail liveness if heap usage exceeds 1.5 GB limit
    if (mem.heapUsed > 1_500_000_000) {
      return false;
    }
    return true;
  }

  public checkReadiness(): ReadinessCheckResult {
    return this.readinessGate.evaluateReadiness();
  }

  public getHealthReport(): HealthReport {
    const readiness = this.readinessGate.evaluateReadiness();
    const liveness = this.checkLiveness();
    const resourceUsage = this.sampleResourceUsage();
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    let state: HealthState = 'HEALTHY';
    if (!liveness || readiness.state === 'FAILED') {
      state = 'FAILED';
    } else if (readiness.state === 'DEGRADED') {
      state = 'DEGRADED';
    }

    // Disk headroom check: below 100MB triggers DEGRADED state
    if (resourceUsage.diskHeadroomBytes < 100 * 1024 * 1024 && state === 'HEALTHY') {
      state = 'DEGRADED';
    }

    if (state === 'DEGRADED' || state === 'FAILED') {
      this.notificationManager?.notify({
        category: 'SYSTEM_INFO',
        priority: state === 'FAILED' ? 'CRITICAL' : 'HIGH',
        title: 'NexusOS Agent Health Alert',
        message: `Agent health state changed to ${state}. Low disk headroom or readiness dependency issue.`,
      });
    }

    return {
      state,
      agentId: this.agentId,
      agentVersion: this.agentVersion,
      configRevision: 1,
      uptimeSeconds,
      resourceUsage,
      queueBacklog: 0,
      spoolBacklog: 0,
      policyFreshnessSec: 0,
      capabilityAvailability: {
        filesystem: true,
        terminal: true,
        browser: true,
        plugin: true,
        vault: true,
      },
      checkedAt: new Date().toISOString(),
    };
  }

  private sampleResourceUsage(): ResourceUsage {
    const memUsage = process.memoryUsage();
    const totalMem = os.totalmem();

    // Calculate process CPU usage percentage since last sample
    const now = Date.now();
    const timeDeltaMs = now - this.lastCpuCheckTime || 1;
    const cpuDelta = process.cpuUsage(this.lastCpuUsage);

    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuCheckTime = now;

    const userCpuMs = cpuDelta.user / 1000;
    const systemCpuMs = cpuDelta.system / 1000;
    const totalCpuMs = userCpuMs + systemCpuMs;
    const cpuCount = os.cpus().length || 1;

    const cpuUsagePercent = Math.min(
      100,
      Math.max(0, Number(((totalCpuMs / (timeDeltaMs * cpuCount)) * 100).toFixed(2))),
    );

    const diskHeadroomBytes = this.sampleDiskHeadroom();

    return {
      cpuUsagePercent,
      memoryUsedBytes: memUsage.heapUsed,
      memoryTotalBytes: totalMem,
      diskHeadroomBytes,
    };
  }

  private sampleDiskHeadroom(): number {
    try {
      if (typeof fs.statfsSync === 'function') {
        const stats = fs.statfsSync(this.storageDir);
        const freeBlocks = BigInt(stats.bavail || stats.bfree || 0);
        const blockSize = BigInt(stats.bsize || 4096);
        return Number(freeBlocks * blockSize);
      }
    } catch {
      // Fallback if statfsSync is unsupported on specific target path
    }
    return os.freemem();
  }
}
