import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createAuthenticatedContext,
  PrincipalType,
  UserIdentity,
  ServiceIdentity,
  DeviceIdentity,
} from '../src/index.js';

describe('Authenticated Context & Identity Models', () => {
  it('creates an immutable user authenticated context', () => {
    const user: UserIdentity = {
      type: PrincipalType.USER,
      userId: crypto.randomUUID(),
      tenantId: crypto.randomUUID(),
      email: 'operator@nexusos.internal',
      roles: ['operator', 'admin'],
    };

    const issued = new Date();
    const expires = new Date(Date.now() + 3600000);
    const rawToken = 'sample_raw_jwt_token_value';

    const ctx = createAuthenticatedContext(user, issued, expires, rawToken);

    assert.strictEqual(ctx.principal.type, PrincipalType.USER);
    assert.strictEqual(ctx.tenantId, user.tenantId);
    assert.ok(ctx.rawTokenHash.length > 0);

    // Verify immutability
    assert.throws(() => {
      (ctx as unknown as Record<string, unknown>).tenantId = 'new-tenant';
    });
  });

  it('creates an immutable service authenticated context', () => {
    const service: ServiceIdentity = {
      type: PrincipalType.SERVICE,
      serviceId: 'service-orchestrator',
      tenantId: crypto.randomUUID(),
      serviceName: 'Orchestrator Service',
      scopes: ['tasks:dispatch', 'events:publish'],
    };

    const ctx = createAuthenticatedContext(service, new Date(), new Date(), 'token');
    assert.strictEqual(ctx.principal.type, PrincipalType.SERVICE);
    assert.strictEqual(ctx.principal.serviceName, 'Orchestrator Service');
  });

  it('creates an immutable device authenticated context', () => {
    const device: DeviceIdentity = {
      type: PrincipalType.DEVICE,
      deviceId: crypto.randomUUID(),
      tenantId: crypto.randomUUID(),
      hardwareFingerprint: 'tpm2_hw_fp_1234',
      scopes: ['lease:execute'],
    };

    const ctx = createAuthenticatedContext(device, new Date(), new Date(), 'token');
    assert.strictEqual(ctx.principal.type, PrincipalType.DEVICE);
    assert.strictEqual(ctx.principal.hardwareFingerprint, 'tpm2_hw_fp_1234');
  });
});
