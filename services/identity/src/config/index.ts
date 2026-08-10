import { z } from 'zod';

/**
 * Identity Service Configuration Schema
 */
export const IdentityConfigSchema = z.object({
  issuer: z.string().url().default('https://auth.nexusos.internal'),
  audience: z.string().default('nexusos-control-plane'),
  secretKey: z.string().min(16).default('nexusos_sprint0_default_identity_secret_key_32bytes!'),
  tokenClockToleranceSeconds: z.coerce.number().int().min(0).max(300).default(5),
  allowAnonymousEndpoints: z.array(z.string()).default(['/health/liveness', '/health/readiness']),
});

export type IdentityConfig = z.infer<typeof IdentityConfigSchema>;

/**
 * Loads and validates Identity service configuration from environment
 */
export function loadIdentityConfig(
  env: Record<string, string | undefined> = process.env,
): IdentityConfig {
  const rawConfig = {
    issuer: env.IDENTITY_ISSUER,
    audience: env.IDENTITY_AUDIENCE,
    secretKey: env.IDENTITY_SECRET_KEY,
    tokenClockToleranceSeconds: env.IDENTITY_TOKEN_CLOCK_TOLERANCE,
  };

  const result = IdentityConfigSchema.safeParse(rawConfig);
  if (!result.success) {
    const details = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    throw new Error(`[IdentityConfigError] Invalid configuration: ${details}`);
  }

  return result.data;
}
