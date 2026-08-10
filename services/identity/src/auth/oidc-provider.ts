import { IdentityConfig } from '../config/index.js';
import { IdentityProviderBoundary, AuthenticationResult } from './provider-boundary.js';
import { verifyJWT, JWTPayload } from './jwt-validator.js';
import { PrincipalType, IdentityPrincipal } from '../domain/types.js';
import { createAuthenticatedContext } from '../domain/context.js';

export class OIDCAuthenticationProvider implements IdentityProviderBoundary {
  constructor(private readonly config: IdentityConfig) {}

  async authenticateToken(rawToken: string): Promise<AuthenticationResult> {
    if (!rawToken || rawToken.trim().length === 0) {
      return {
        success: false,
        errorCode: 'MISSING_CREDENTIALS',
        errorMessage: 'No authentication token provided.',
      };
    }

    try {
      const payload: JWTPayload = verifyJWT(rawToken, {
        issuer: this.config.issuer,
        audience: this.config.audience,
        secretKey: this.config.secretKey,
        clockToleranceSeconds: this.config.tokenClockToleranceSeconds,
      });

      let principal: IdentityPrincipal;

      if (payload.principal_type === PrincipalType.USER) {
        principal = {
          type: PrincipalType.USER,
          userId: payload.sub,
          tenantId: payload.tenant_id,
          email: payload.email,
          roles: payload.roles || [],
        };
      } else if (payload.principal_type === PrincipalType.SERVICE) {
        principal = {
          type: PrincipalType.SERVICE,
          serviceId: payload.sub,
          tenantId: payload.tenant_id,
          serviceName: payload.service_name || payload.sub,
          scopes: payload.scopes || [],
        };
      } else if (payload.principal_type === PrincipalType.DEVICE) {
        principal = {
          type: PrincipalType.DEVICE,
          deviceId: payload.sub,
          tenantId: payload.tenant_id,
          hardwareFingerprint: payload.hardware_fingerprint,
          scopes: payload.scopes || [],
        };
      } else {
        return {
          success: false,
          errorCode: 'UNSUPPORTED_PRINCIPAL_TYPE',
          errorMessage: 'Token principal type is not supported.',
        };
      }

      const issuedAt = payload.iat ? new Date(payload.iat * 1000) : new Date();
      const expiresAt = new Date(payload.exp * 1000);

      const context = createAuthenticatedContext(principal, issuedAt, expiresAt, rawToken);

      return {
        success: true,
        context,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed.';
      const errorCode = message.split(':')[0] || 'AUTHENTICATION_FAILED';
      return {
        success: false,
        errorCode,
        errorMessage: message,
      };
    }
  }
}
