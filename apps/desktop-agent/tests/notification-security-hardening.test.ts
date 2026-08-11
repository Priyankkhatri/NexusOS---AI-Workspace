import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NotificationManager, NotificationQueue } from '../src/notifications/index.js';

describe('Task 03J Notification Security Hardening & Vulnerability Audit', () => {
  const testStorageDir = path.join(process.cwd(), '.test-notification-queue-dir');

  it('VULNERABILITY-J01: rejects new notifications without silently evicting existing CRITICAL items when hard capacity is full', () => {
    const queue = new NotificationQueue(2); // soft capacity 2, hard capacity 4

    // Enqueue 4 CRITICAL notifications to reach hard capacity
    for (let i = 1; i <= 4; i++) {
      queue.enqueue({
        id: `00000000-0000-4000-8000-00000000000${i}`,
        timestamp: new Date().toISOString(),
        category: 'SECURITY_ALERT',
        priority: 'CRITICAL',
        title: `Critical Alert ${i}`,
        message: `Security event ${i}`,
        isPrivacyRedacted: false,
        isRead: false,
      });
    }

    // 5th CRITICAL notification attempt when hard capacity is full
    const result5 = queue.enqueue({
      id: '00000000-0000-4000-8000-000000000099',
      timestamp: new Date().toISOString(),
      category: 'SECURITY_ALERT',
      priority: 'CRITICAL',
      title: 'Critical Alert 5',
      message: 'Security event 5',
      isPrivacyRedacted: false,
      isRead: false,
    });

    assert.equal(result5.status, 'REJECTED');
    assert.equal(queue.getMetrics().isQueueFull, true);

    // Assert that the oldest CRITICAL item (Alert 1) was NOT silently discarded via shift()
    const all = queue.peekAll();
    assert.equal(all.length, 4);
    assert.equal(all[0].title, 'Critical Alert 1');

    queue.clear();
  });

  it('VULNERABILITY-J02: blocks action execution when expected task or correlation ID context mismatches', () => {
    const manager = new NotificationManager();
    const item = manager.notify({
      category: 'POLICY_APPROVAL',
      priority: 'HIGH',
      title: 'Approve Lease Task A',
      message: 'Approval needed for Task A',
      taskId: 'task_A',
      correlationId: 'corr_A',
      actions: [
        {
          actionId: 'approve',
          label: 'Approve',
          requiresRevalidation: true,
        },
      ],
    });

    // Attempt execution with mismatched expectedTaskId
    const resMismatch = manager.executeNotificationAction(
      item.id,
      'approve',
      'valid_auth_token_xyz',
      'task_B', // Expected task B, but notification belongs to task A!
    );

    assert.equal(resMismatch.success, false);
    assert.ok(resMismatch.reason?.includes('Task ID mismatch'));

    // Attempt execution with matching expectedTaskId
    const resMatch = manager.executeNotificationAction(
      item.id,
      'approve',
      'valid_auth_token_xyz',
      'task_A',
    );
    assert.equal(resMatch.success, true);
  });

  it('VULNERABILITY-J03: prevents coalescing from overwriting or downgrading CRITICAL notifications', () => {
    const queue = new NotificationQueue();
    const manager = new NotificationManager(queue);

    manager.notify({
      category: 'SECURITY_ALERT',
      priority: 'CRITICAL',
      title: 'CRITICAL SECURITY ALERT',
      message: 'Root security violation',
      coalesceKey: 'coalesce_sec_key_1',
    });

    // Attempt to coalesce with a LOW priority notification
    manager.notify({
      category: 'SYSTEM_INFO',
      priority: 'LOW',
      title: 'Low priority info update',
      message: 'Routine update',
      coalesceKey: 'coalesce_sec_key_1',
    });

    const pending = queue.peekAll();
    assert.equal(pending.length, 2); // Low priority item did NOT overwrite CRITICAL item
    assert.equal(pending[0].priority, 'CRITICAL');
    assert.equal(pending[0].title, 'CRITICAL SECURITY ALERT');
  });

  it('VULNERABILITY-J04: persists queued CRITICAL notifications to local storage file across restarts', () => {
    if (!fs.existsSync(testStorageDir)) {
      fs.mkdirSync(testStorageDir, { recursive: true });
    }

    const queue1 = new NotificationQueue(10, testStorageDir);
    const manager1 = new NotificationManager(queue1);

    manager1.notify({
      category: 'SECURITY_ALERT',
      priority: 'CRITICAL',
      title: 'Persistent Security Alert',
      message: 'Must survive restart',
    });

    // Instantiate queue2 reading from same storage directory
    const queue2 = new NotificationQueue(10, testStorageDir);
    const pending = queue2.peekAll();

    assert.ok(pending.length >= 1);
    assert.equal(pending[0].title, 'Persistent Security Alert');

    queue2.clear();
  });

  it('VULNERABILITY-J05: re-evaluates lock-screen privacy redaction on pending queue items when lock screen transitions', () => {
    const manager = new NotificationManager();

    // Enqueue notification while lock screen is INACTIVE
    const item = manager.notify({
      category: 'POLICY_APPROVAL',
      priority: 'HIGH',
      title: 'Sensitive Financial Access Request',
      message: 'User requested access to account_number_123456',
    });

    assert.equal(item.isPrivacyRedacted, false);

    // Lock screen transitions to ACTIVE
    manager.setLockScreenActive(true);

    const pending = manager.queue.peekAll();
    assert.equal(pending[0].isPrivacyRedacted, true);
    assert.ok(pending[0].message.includes('[LOCK_SCREEN_PRIVACY]'));
    assert.equal(pending[0].message.includes('account_number_123456'), false);
  });
});
