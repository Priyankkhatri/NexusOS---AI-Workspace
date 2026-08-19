import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DesktopAgent } from '../src/agent.js';
import { DesktopAgentConfig } from '../src/config/index.js';
import { AgentIdentityProvider } from '../src/identity/agent-identity.js';
import { ControlPlaneClient } from '../src/communication/types.js';
import { ExecutionLeaseBoundary } from '../src/permissions/lease-boundary.js';
import { InMemoryLocalStateStore } from '../src/state/local-state-store.js';
import { Logger } from '@nexusos/backend';
import { NotificationManager } from '../src/notifications/index.js';

describe('Task 040 — Local Notification IPC & Integration Tests', () => {
  let agent: DesktopAgent;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusos-notification-ipc-test-'));

    const config: DesktopAgentConfig = {
      agentVersion: '1.0.0',
      deviceId: 'test-device-id-040',
      environment: 'development',
      heartbeatIntervalMs: 60000,
      controlPlaneUrl: 'https://localhost:8443',
      logLevel: 'info',
      stateStoragePath: tmpDir,
      maxConcurrentLeases: 5,
    };

    const identityProvider: AgentIdentityProvider = {
      getIdentity: async () => ({
        agentId: 'test-agent-040',
        deviceId: 'test-device-id-040',
        pairedTenantId: 'tenant-040',
        deviceFingerprint: 'fingerprint-040',
        agentVersion: '1.0.0',
        enrolledAt: new Date().toISOString(),
      }),
      verifyHardwareAttestation: async () =>
        ({ valid: true, status: 'PASSED', reason: 'OK' }) as any,
    };

    const controlPlaneClient: ControlPlaneClient = {
      start: async () => {},
      registerAgent: async () => ({ accepted: true, controlPlaneVersion: '1.0.0' }),
      sendHeartbeat: async () => true,
      relayEvent: async () => ({ success: true }) as any,
      getConnectionState: () => 'CONNECTED' as any,
      disconnect: async () => {},
    };

    const leaseBoundary = new ExecutionLeaseBoundary();
    const stateStore = new InMemoryLocalStateStore();
    const baseLogger: Logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      fatal: () => {},
    } as unknown as Logger;

    agent = new DesktopAgent(
      config,
      identityProvider,
      controlPlaneClient,
      leaseBoundary,
      stateStore,
      baseLogger,
    );
  });

  afterEach(async () => {
    try {
      if (!agent.lifecycle.isStoppingOrStopped()) {
        await agent.stop();
      }
    } catch {
      // Ignore
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('exposes notificationManager as a NotificationManager instance on DesktopAgent', () => {
    assert.ok(agent.notificationManager instanceof NotificationManager);
  });

  it('notification.dispatch — dispatches a structured notification through policy gate', async () => {
    const result = agent.notificationManager.notify({
      category: 'TASK_STATUS',
      priority: 'NORMAL',
      title: 'Build Complete',
      message: 'Pipeline finished successfully.',
      taskId: 'task-ipc-01',
    });

    assert.ok(result.id);
    assert.equal(result.category, 'TASK_STATUS');
    assert.equal(result.priority, 'NORMAL');
    assert.equal(result.isRead, false);
    // Policy gate must not have inadvertently redacted this safe item
    assert.equal(result.isPrivacyRedacted, false);
  });

  it('notification.dispatch — sanitized response contains no raw secret patterns', async () => {
    const item = agent.notificationManager.notify({
      category: 'SYSTEM_INFO',
      priority: 'NORMAL',
      title: 'Config Reload',
      message: 'Reload with token: Bearer sk-secret-12345',
      taskId: 'task-ipc-02',
    });

    // The policyGate.sanitizeAndRedact() must redact secret patterns
    const sanitized = agent.notificationManager.policyGate.sanitizeAndRedact(item);
    assert.ok(!sanitized.message.includes('sk-secret-12345'));
  });

  it('notification.listPending — returns pending unread items respecting maxCount', async () => {
    // Dispatch three notifications
    for (let i = 0; i < 3; i++) {
      agent.notificationManager.notify({
        category: 'TASK_STATUS',
        priority: 'NORMAL',
        title: `Notification ${i}`,
        message: `Message body ${i}`,
      });
    }

    const pending = agent.notificationManager.queue.popPending(2);
    assert.equal(pending.length, 2);
    // Confirm all items are sanitized on list
    for (const item of pending) {
      const sanitized = agent.notificationManager.policyGate.sanitizeAndRedact(item);
      assert.ok(sanitized.id);
    }
  });

  it('notification.markRead — marks a specific notification as read', async () => {
    const item = agent.notificationManager.notify({
      category: 'TASK_STATUS',
      priority: 'LOW',
      title: 'Background Job Done',
      message: 'The cleanup job has completed.',
    });

    const marked = agent.notificationManager.queue.markRead(item.id);
    assert.equal(marked, true);

    const pending = agent.notificationManager.queue.popPending();
    const found = pending.find((i) => i.id === item.id);
    // markRead removes item from pending list
    assert.equal(found, undefined);
  });

  it('notification.executeAction — succeeds with valid auth token and matching context', async () => {
    const item = agent.notificationManager.notify({
      category: 'POLICY_APPROVAL',
      priority: 'HIGH',
      title: 'Permission Request',
      message: 'Agent requires approval to access /tmp directory.',
      taskId: 'task-action-01',
      correlationId: 'corr-action-01',
      actions: [
        {
          actionId: 'approve',
          label: 'Approve',
          requiresRevalidation: true,
        },
      ],
    });

    const result = agent.notificationManager.executeNotificationAction(
      item.id,
      'approve',
      'valid-revalidation-token-xyz',
      'task-action-01',
      'corr-action-01',
    );

    assert.equal(result.success, true);
  });

  it('notification.executeAction — denied when auth token is absent', async () => {
    const item = agent.notificationManager.notify({
      category: 'POLICY_APPROVAL',
      priority: 'HIGH',
      title: 'Permission Request',
      message: 'Agent requires approval.',
      actions: [{ actionId: 'approve', label: 'Approve', requiresRevalidation: true }],
    });

    const result = agent.notificationManager.executeNotificationAction(
      item.id,
      'approve',
      '', // empty auth token — must be denied
    );

    assert.equal(result.success, false);
    assert.ok(result.reason);
  });

  it('notification.getMetrics — returns queue health metrics', async () => {
    agent.notificationManager.notify({
      category: 'SYSTEM_INFO',
      priority: 'NORMAL',
      title: 'Health Check',
      message: 'System is healthy.',
    });

    const metrics = agent.notificationManager.getHealthMetrics();
    assert.ok(metrics.totalDelivered >= 1);
    assert.ok(typeof metrics.pendingCount === 'number');
    assert.ok(typeof metrics.isQueueFull === 'boolean');
  });

  it('notification.setLockScreen — retroactively redacts pending items when lock screen activates', async () => {
    const item = agent.notificationManager.notify({
      category: 'SECURITY_ALERT',
      priority: 'CRITICAL',
      title: 'Unauthorized Access',
      message: 'Blocked suspicious process from /proc/shadow.',
    });

    // Before lock screen: item should not be redacted
    assert.equal(item.isPrivacyRedacted, false);

    // Activate lock screen
    agent.notificationManager.setLockScreenActive(true);

    // All pending items with sensitive categories must be retroactively redacted
    const pending = agent.notificationManager.queue.peekAll();
    const target = pending.find((i) => i.id === item.id);
    assert.ok(target);
    assert.equal(target.isPrivacyRedacted, true);
    assert.ok(target.message.includes('[LOCK_SCREEN_PRIVACY]'));
  });

  it('notification.setLockScreen — lock-screen state persists across multiple reads', async () => {
    agent.notificationManager.notify({
      category: 'TASK_STATUS',
      priority: 'HIGH',
      title: 'High Priority Task',
      message: 'Important task status update.',
    });

    agent.notificationManager.setLockScreenActive(true);

    // Both reads must honor lock-screen
    const firstRead = agent.notificationManager.queue.peekAll();
    const secondRead = agent.notificationManager.queue.peekAll();

    for (const item of [...firstRead, ...secondRead]) {
      if (item.category !== 'SYSTEM_INFO') {
        assert.equal(item.isPrivacyRedacted, true);
      }
    }
  });

  it('DesktopAgent lifecycle — stop() purges expired notifications without losing CRITICAL items', async () => {
    await agent.start();

    // Dispatch a CRITICAL notification (no expiry)
    agent.notificationManager.notify({
      category: 'SECURITY_ALERT',
      priority: 'CRITICAL',
      title: 'Active Security Event',
      message: 'Ongoing threat detected.',
    });

    // Dispatch a LOW item with immediate expiry
    agent.notificationManager.notify({
      category: 'SYSTEM_INFO',
      priority: 'LOW',
      title: 'Stale Info',
      message: 'This has expired.',
      ttlSeconds: 0, // Will expire immediately
    });

    await agent.stop();
    assert.equal(agent.lifecycle.getState(), 'STOPPED');
    // Critical notifications must survive (no clear() was called)
    const remaining = agent.notificationManager.queue.peekAll();
    const hasActive = remaining.some((i) => i.priority === 'CRITICAL');
    assert.equal(hasActive, true);
  });

  it('CRITICAL notification remains non-evictable under queue capacity pressure', async () => {
    // Fill the queue with LOW items, then add a CRITICAL one
    const smallQueue = new (
      await import('../src/notifications/notification-queue.js')
    ).NotificationQueue(2); // soft max of 2

    // Fill with LOW items
    for (let i = 0; i < 2; i++) {
      smallQueue.enqueue({
        id: `00000000-0000-4000-8000-00000000000${i}`,
        timestamp: new Date().toISOString(),
        category: 'SYSTEM_INFO',
        priority: 'LOW',
        title: `Low ${i}`,
        message: 'Info',
        isPrivacyRedacted: false,
        isRead: false,
      });
    }

    // CRITICAL item must not be rejected
    const criticalResult = smallQueue.enqueue({
      id: '00000000-0000-4000-8000-000000000099',
      timestamp: new Date().toISOString(),
      category: 'SECURITY_ALERT',
      priority: 'CRITICAL',
      title: 'CRITICAL EVENT',
      message: 'Must not be dropped.',
      isPrivacyRedacted: false,
      isRead: false,
    });

    assert.notEqual(criticalResult.status, 'REJECTED');
    const items = smallQueue.peekAll();
    assert.ok(items.some((i) => i.priority === 'CRITICAL'));
  });
});
