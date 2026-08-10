import { describe, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import {
  createAuthenticatedContext,
  PrincipalType,
  UserIdentity,
  ServiceIdentity,
} from '@nexusos/identity';
import {
  ReferencePolicyEvaluator,
  loadPolicyConfig,
  PolicyEffect,
  PolicyRule,
} from '../src/index.js';

function createDummyUserContext(
  tenantId = crypto.randomUUID(),
  roles: string[] = ['admin'],
): ReturnType<typeof createAuthenticatedContext> {
  const user: UserIdentity = {
    type: PrincipalType.USER,
    userId: crypto.randomUUID(),
    tenantId,
    email: 'test@nexusos.internal',
    roles,
  };
  return createAuthenticatedContext(
    user,
    new Date(),
    new Date(Date.now() + 3600000),
    'dummy-token',
  );
}

function createDummyServiceContext(
  tenantId = crypto.randomUUID(),
  scopes: string[] = ['tasks:read'],
): ReturnType<typeof createAuthenticatedContext> {
  const service: ServiceIdentity = {
    type: PrincipalType.SERVICE,
    serviceId: 'service-orchestrator',
    tenantId,
    serviceName: 'Task Orchestrator',
    scopes,
  };
  return createAuthenticatedContext(
    service,
    new Date(),
    new Date(Date.now() + 3600000),
    'dummy-token',
  );
}

describe('Policy Evaluator & Fail-Closed Authorization', () => {
  const config = loadPolicyConfig({});
  const rules: PolicyRule[] = [
    {
      ruleId: 'rule-admin-all',
      actionName: '*',
      resourceType: 'admin-resource',
      requiredRole: 'admin',
      effect: PolicyEffect.ALLOW,
    },
    {
      ruleId: 'rule-tasks-read',
      actionName: 'tasks:read',
      resourceType: 'task',
      requiredScope: 'tasks:read',
      effect: PolicyEffect.ALLOW,
    },
  ];

  const evaluator = new ReferencePolicyEvaluator(config, rules);

  it('evaluates ALLOW decision for subject with required role', async () => {
    const tenantId = crypto.randomUUID();
    const subject = createDummyUserContext(tenantId, ['admin']);

    const res = await evaluator.evaluate({
      subject,
      action: { actionName: 'admin:config', requiredRole: 'admin' },
      resource: { resourceType: 'admin-resource', resourceId: 'res-1', tenantId },
      context: {
        requestId: crypto.randomUUID(),
        correlationId: crypto.randomUUID(),
        requestTimestamp: new Date().toISOString(),
      },
    });

    assert.strictEqual(res.allowed, true);
    assert.strictEqual(res.effect, PolicyEffect.ALLOW);
    assert.ok(res.policyHash.length > 0);
    assert.strictEqual(res.policyVersion, config.defaultPolicyVersion);
  });

  it('fails closed (DENY) when subject lacks required role', async () => {
    const tenantId = crypto.randomUUID();
    const subject = createDummyUserContext(tenantId, ['user']);

    const res = await evaluator.evaluate({
      subject,
      action: { actionName: 'admin:config', requiredRole: 'admin' },
      resource: { resourceType: 'admin-resource', resourceId: 'res-1', tenantId },
      context: {
        requestId: crypto.randomUUID(),
        correlationId: crypto.randomUUID(),
        requestTimestamp: new Date().toISOString(),
      },
    });

    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.effect, PolicyEffect.DENY);
    assert.match(res.reason, /Subject lacks required role/);
  });

  it('fails closed (DENY) when subject is missing', async () => {
    const res = await evaluator.evaluate({
      subject: undefined,
      action: { actionName: 'tasks:read' },
      resource: { resourceType: 'task', resourceId: 'task-1' },
      context: {
        requestId: crypto.randomUUID(),
        correlationId: crypto.randomUUID(),
        requestTimestamp: new Date().toISOString(),
      },
    });

    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.effect, PolicyEffect.DENY);
    assert.match(res.reason, /missing/i);
  });

  it('fails closed (DENY) on cross-tenant access violation', async () => {
    const subjectTenant = crypto.randomUUID();
    const resourceTenant = crypto.randomUUID();
    const subject = createDummyUserContext(subjectTenant, ['admin']);

    const res = await evaluator.evaluate({
      subject,
      action: { actionName: 'admin:config' },
      resource: { resourceType: 'admin-resource', resourceId: 'res-1', tenantId: resourceTenant },
      context: {
        requestId: crypto.randomUUID(),
        correlationId: crypto.randomUUID(),
        requestTimestamp: new Date().toISOString(),
      },
    });

    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.effect, PolicyEffect.DENY);
    assert.match(res.reason, /Cross-tenant access violation/);
  });

  it('evaluates ALLOW decision for service subject with required scope', async () => {
    const tenantId = crypto.randomUUID();
    const subject = createDummyServiceContext(tenantId, ['tasks:read']);

    const res = await evaluator.evaluate({
      subject,
      action: { actionName: 'tasks:read', requiredScope: 'tasks:read' },
      resource: { resourceType: 'task', resourceId: 'task-99', tenantId },
      context: {
        requestId: crypto.randomUUID(),
        correlationId: crypto.randomUUID(),
        requestTimestamp: new Date().toISOString(),
      },
    });

    assert.strictEqual(res.allowed, true);
    assert.strictEqual(res.effect, PolicyEffect.ALLOW);
  });
});
