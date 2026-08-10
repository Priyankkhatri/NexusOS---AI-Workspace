import { z } from 'zod';

/**
 * Backend Service Configuration Schema matching Backend EDD Section 150
 */
export const BackendConfigSchema = z.object({
  port: z.coerce.number().int().min(0).max(65535).default(3000),
  host: z.string().default('0.0.0.0'),
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  apiPrefix: z.string().default('/v1'),
  databaseUrl: z.string().optional(),
  shutdownTimeoutMs: z.coerce.number().int().positive().default(5000),
});

export type BackendConfig = z.infer<typeof BackendConfigSchema>;

/**
 * Loads and validates configuration from environment variables.
 * Fails fast with structured error if required configuration is invalid.
 */
export function loadBackendConfig(
  env: Record<string, string | undefined> = process.env,
): BackendConfig {
  const rawConfig = {
    port: env.PORT,
    host: env.HOST,
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    apiPrefix: env.API_PREFIX,
    databaseUrl: env.DATABASE_URL,
    shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
  };

  const result = BackendConfigSchema.safeParse(rawConfig);
  if (!result.success) {
    const errorDetails = result.error.errors
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('; ');
    throw new Error(`[BackendConfigError] Invalid configuration: ${errorDetails}`);
  }

  return result.data;
}
