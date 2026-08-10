import { AuthenticatedContext, IdentityPrincipal } from './types.js';
import crypto from 'node:crypto';

/**
 * Creates an immutable AuthenticatedContext object
 */
export function createAuthenticatedContext(
  principal: IdentityPrincipal,
  issuedAt: Date,
  expiresAt: Date,
  rawToken: string,
): AuthenticatedContext {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const context: AuthenticatedContext = Object.freeze({
    principal: Object.freeze({ ...principal }),
    tenantId: principal.tenantId,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    rawTokenHash: tokenHash,
  });

  return context;
}
