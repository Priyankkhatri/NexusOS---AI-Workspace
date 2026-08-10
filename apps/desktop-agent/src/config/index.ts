import { z } from 'zod';

export const DesktopAgentConfigSchema = z.object({
  deviceId: z.string().uuid().default('00000000-0000-0000-0000-000000000000'),
  agentVersion: z.string().default('0.1.0-sprint0'),
  controlPlaneUrl: z.string().url().default('https://device-gateway.nexusos.internal'),
  environment: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  heartbeatIntervalMs: z.coerce.number().int().min(1000).max(60000).default(10000),
  stateStoragePath: z.string().default('.nexusos/agent-state.json'),
  maxConcurrentLeases: z.coerce.number().int().min(1).max(10).default(3),
});

export type DesktopAgentConfig = z.infer<typeof DesktopAgentConfigSchema>;

export function loadDesktopAgentConfig(
  env: Record<string, string | undefined> = process.env,
): DesktopAgentConfig {
  const rawConfig = {
    deviceId: env.AGENT_DEVICE_ID,
    agentVersion: env.AGENT_VERSION,
    controlPlaneUrl: env.AGENT_CONTROL_PLANE_URL,
    environment: env.NODE_ENV,
    logLevel: env.AGENT_LOG_LEVEL,
    heartbeatIntervalMs: env.AGENT_HEARTBEAT_INTERVAL_MS,
    stateStoragePath: env.AGENT_STATE_STORAGE_PATH,
    maxConcurrentLeases: env.AGENT_MAX_CONCURRENT_LEASES,
  };

  const result = DesktopAgentConfigSchema.safeParse(rawConfig);
  if (!result.success) {
    const details = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    throw new Error(`[DesktopAgentConfigError] Invalid configuration: ${details}`);
  }

  return result.data;
}
