import fs from 'node:fs';
import path from 'node:path';
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
  tasksDbPath: z.string().optional(),
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
    tasksDbPath: env.TASKS_DB_PATH ?? env.TASK_DB_PATH,
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

/**
 * Resolves the SQLite task database path in accordance with environment and security rules:
 * - Does not silently default production execution to :memory:
 * - Does not treat arbitrary databaseUrl as a SQLite filesystem path
 * - Ensures database directories exist safely
 */
export function resolveTasksDbPath(config: BackendConfig): string {
  if (config.tasksDbPath) {
    if (config.tasksDbPath === ':memory:') {
      if (config.nodeEnv === 'production') {
        throw new Error('Production environment cannot use in-memory SQLite storage (:memory:).');
      }
      return ':memory:';
    }
    const resolved = path.resolve(config.tasksDbPath);
    const parentDir = path.dirname(resolved);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    return resolved;
  }

  if (config.nodeEnv === 'test') {
    return ':memory:';
  }

  // Stable default directory outside ephemeral build dirs
  const defaultDir = path.resolve(process.env.NEXUSOS_DATA_DIR ?? path.join(process.cwd(), 'data'));
  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
  }
  return path.join(defaultDir, 'nexusos-tasks.db');
}
