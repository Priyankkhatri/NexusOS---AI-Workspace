import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { RedactionFilter, StructuredLogger } from '../src/telemetry/index.js';
import { SecretRedactionRegistry } from '../src/vault/redaction-registry.js';

describe('Task 03I Structured Logger & Redaction Filter', () => {
  let redactionRegistry: SecretRedactionRegistry;
  let redactionFilter: RedactionFilter;

  beforeEach(() => {
    redactionRegistry = new SecretRedactionRegistry();
    redactionFilter = new RedactionFilter(redactionRegistry);
  });

  it('emits structured JSON log records enriched with correlation context', async () => {
    const emitted: string[] = [];
    const logger = new StructuredLogger('TestComponent', redactionFilter, undefined, (msg) =>
      emitted.push(msg),
    );

    logger.setCorrelationContext('corr_123', 'task_456', 'step_789');
    logger.info('System operation started', { user: 'admin' });

    // Wait for setImmediate async emission
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(emitted.length, 1);
    const parsed = JSON.parse(emitted[0]);

    assert.equal(parsed.level, 'info');
    assert.equal(parsed.component, 'TestComponent');
    assert.equal(parsed.message, 'System operation started');
    assert.equal(parsed.correlationId, 'corr_123');
    assert.equal(parsed.taskId, 'task_456');
    assert.equal(parsed.stepId, 'step_789');
    assert.equal(parsed.details.user, 'admin');
  });

  it('redacts Bearer tokens, private keys, passwords, and registered secrets from strings and objects', () => {
    redactionRegistry.registerSecret('SUPER_SECRET_VALUE', 'fp_sec_999');

    const inputString = 'Connecting with Bearer gh_token_xyz and SUPER_SECRET_VALUE';
    const redactedString = redactionFilter.redactString(inputString);

    assert.equal(redactedString.includes('SUPER_SECRET_VALUE'), false);
    assert.equal(redactedString.includes('gh_token_xyz'), false);
    assert.ok(redactedString.includes('[REDACTED'));

    const inputObj = {
      password: 'my_secret_password_123',
      nested: {
        token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        secretValue: 'SUPER_SECRET_VALUE',
      },
    };

    const redactedObj = redactionFilter.redactObject(inputObj);
    assert.equal(JSON.stringify(redactedObj).includes('my_secret_password_123'), false);
    assert.equal(JSON.stringify(redactedObj).includes('SUPER_SECRET_VALUE'), false);
  });

  it('redacts error messages and stack traces safely', () => {
    redactionRegistry.registerSecret('db_secret_pass', 'fp_vault_pass');
    const err = new Error('Database connection failed for db_secret_pass');

    const redactedErr = redactionFilter.redactError(err);
    assert.equal(redactedErr.message.includes('db_secret_pass'), false);
    assert.ok(redactedErr.message.includes('[REDACTED'));
  });

  it('prevents JSON injection / log forging by escaping newlines and control characters', async () => {
    const emitted: string[] = [];
    const logger = new StructuredLogger('TestComponent', redactionFilter, undefined, (msg) =>
      emitted.push(msg),
    );

    const maliciousInput = 'Normal log message\n{"level":"fatal","message":"Fake injected log"}';
    logger.info(maliciousInput);

    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(emitted.length, 1);
    const parsed = JSON.parse(emitted[0]);
    assert.equal(parsed.level, 'info');
    assert.ok(parsed.message.includes('\\n'));
    assert.equal(parsed.message.includes('\n'), false);
  });

  it('fails closed when redaction pipeline encounters an error', () => {
    const brokenFilter = new RedactionFilter({
      redactText: () => {
        throw new Error('Redaction internal fault');
      },
    } as unknown as SecretRedactionRegistry);

    const res = brokenFilter.redactString('test string');
    assert.ok(res.includes('[SECURITY_ALERT]'));
  });
});
