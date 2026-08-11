import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createEventEnvelope } from '@nexusos/contracts';
import {
  NotificationManager,
  NotificationPolicyGate,
  NotificationQueue,
} from '../src/notifications/index.js';
import { RedactionFilter } from '../src/telemetry/index.js';
import { SecretRedactionRegistry } from '../src/vault/redaction-registry.js';

describe('Task 03J Notification Manager & Policy Gate', () => {
  let redactionRegistry: SecretRedactionRegistry;
  let redactionFilter: RedactionFilter;
  let policyGate: NotificationPolicyGate;
  let queue: NotificationQueue;
  let manager: NotificationManager;

  beforeEach(() => {
    redactionRegistry = new SecretRedactionRegistry();
    redactionFilter = new RedactionFilter(redactionRegistry);
    policyGate = new NotificationPolicyGate(redactionFilter);
    queue = new NotificationQueue(5); // soft max capacity 5
    manager = new NotificationManager(queue, policyGate);
  });

  it('dispatches structured, schema-validated notifications with priority and metadata', () => {
    const item = manager.notify({
      category: 'SECURITY_ALERT',
      priority: 'CRITICAL',
      title: 'Unauthorized Access Attempt',
      message: 'Blocked execution on un-scoped path /etc/shadow',
      taskId: 'task_101',
      actions: [
        {
          actionId: 'quarantine',
          label: 'Quarantine Process',
          requiresRevalidation: true,
        },
      ],
    });

    assert.ok(item.id);
    assert.equal(item.category, 'SECURITY_ALERT');
    assert.equal(item.priority, 'CRITICAL');
    assert.equal(item.title, 'Unauthorized Access Attempt');
    assert.equal(item.isRead, false);

    const pending = queue.popPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, item.id);
  });

  it('coalesces duplicate notifications with matching coalesceKey', () => {
    manager.notify({
      category: 'TASK_STATUS',
      priority: 'NORMAL',
      title: 'Step Progress',
      message: 'Completed step 1',
      coalesceKey: 'task_step_progress_123',
    });

    manager.notify({
      category: 'TASK_STATUS',
      priority: 'NORMAL',
      title: 'Step Progress',
      message: 'Completed step 2',
      coalesceKey: 'task_step_progress_123',
    });

    const metrics = queue.getMetrics();
    assert.equal(metrics.coalescedCount, 1);
    assert.equal(metrics.pendingCount, 1);

    const pending = queue.peekAll();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].message, 'Completed step 2');
  });

  it('redacts secrets, Bearer tokens, and sensitive keys from titles, messages, and metadata', () => {
    redactionRegistry.registerSecret('top_secret_pass', 'fp_sec_007');

    const item = manager.notify({
      category: 'SECURITY_ALERT',
      priority: 'HIGH',
      title: 'Token Bearer gh_token_999 detected',
      message: 'User password top_secret_pass leaked in context',
      metadata: { password: 'my_raw_password_123' },
    });

    assert.equal(item.title.includes('gh_token_999'), false);
    assert.equal(item.message.includes('top_secret_pass'), false);
    assert.ok(item.title.includes('[REDACTED'));
    assert.ok(item.message.includes('[REDACTED'));
    assert.equal(JSON.stringify(item.metadata).includes('my_raw_password_123'), false);
  });

  it('hides sensitive payload details under lock-screen privacy mode', () => {
    manager.setLockScreenActive(true);

    const item = manager.notify({
      category: 'POLICY_APPROVAL',
      priority: 'HIGH',
      title: 'Approval Required',
      message: 'User requested access to restricted database financial_records',
    });

    assert.equal(item.isPrivacyRedacted, true);
    assert.ok(item.message.includes('[LOCK_SCREEN_PRIVACY]'));
    assert.equal(item.message.includes('financial_records'), false);
  });

  it('fails closed when executing an action without valid revalidation auth token', () => {
    const item = manager.notify({
      category: 'POLICY_APPROVAL',
      priority: 'HIGH',
      title: 'Approve Lease Extension',
      message: 'Extend lease for task 404',
      actions: [
        {
          actionId: 'approve_lease',
          label: 'Approve',
          requiresRevalidation: true,
        },
      ],
    });

    // Attempt action execution WITHOUT auth token
    const resNoToken = manager.executeNotificationAction(item.id, 'approve_lease');
    assert.equal(resNoToken.success, false);
    assert.ok(resNoToken.reason?.includes('requires valid revalidation auth token'));

    // Attempt action execution WITH valid auth token
    const resWithToken = manager.executeNotificationAction(
      item.id,
      'approve_lease',
      'valid_user_jwt_token_abc',
    );
    assert.equal(resWithToken.success, true);
  });

  it('purges expired notifications and rejects action execution on expired items', async () => {
    const item = manager.notify({
      category: 'SYSTEM_INFO',
      priority: 'LOW',
      title: 'Ephemeral Warning',
      message: 'Short lived notification',
      ttlSeconds: 1, // 1 second TTL
      actions: [
        {
          actionId: 'dismiss',
          label: 'Dismiss',
          requiresRevalidation: true,
        },
      ],
    });

    // Wait 1.1s for expiration
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const res = manager.executeNotificationAction(item.id, 'dismiss', 'valid_auth_token_xyz');
    assert.equal(res.success, false);
    assert.ok(res.reason?.includes('Notification not found') || res.reason?.includes('expired'));
  });

  it('preserves CRITICAL priority notifications under queue capacity pressure', () => {
    // Fill queue of capacity 5 with LOW/NORMAL items
    for (let i = 1; i <= 5; i++) {
      manager.notify({
        category: 'SYSTEM_INFO',
        priority: 'NORMAL',
        title: `Notice ${i}`,
        message: `Message ${i}`,
      });
    }

    // Now send a CRITICAL security alert
    const criticalItem = manager.notify({
      category: 'SECURITY_ALERT',
      priority: 'CRITICAL',
      title: 'CRITICAL SECURITY BREACH',
      message: 'Unauthorized root access detected',
    });

    const all = queue.peekAll();
    assert.ok(all.some((n) => n.id === criticalItem.id));
  });

  it('maps canonical event envelopes automatically to priority notifications', () => {
    const envelope = createEventEnvelope(
      'nexusos.events.security.alert.v1',
      '1.0.0',
      '00000000-0000-4000-8000-000000000000',
      '00000000-0000-4000-8000-000000000001',
      { message: 'Malicious payload injection blocked' },
    );

    const item = manager.notifyEventEnvelope(envelope);
    assert.ok(item);
    assert.equal(item?.category, 'SECURITY_ALERT');
    assert.equal(item?.priority, 'CRITICAL');
    assert.equal(item?.message, 'Malicious payload injection blocked');
  });

  it('exposes notification metrics to Health Monitor', () => {
    manager.notify({
      category: 'SYSTEM_INFO',
      priority: 'LOW',
      title: 'Info',
      message: 'Test message',
    });

    const metrics = manager.getHealthMetrics();
    assert.ok(metrics.totalDelivered >= 1);
  });
});
