import { z } from 'zod';

export const PolicyConfigSchema = z.object({
  defaultPolicyVersion: z.string().default('v1.0.0-sprint0'),
  enforceStrictScopeMatching: z.boolean().default(true),
  failClosedOnMissingPolicy: z.boolean().default(true),
  auditEvidenceEnabled: z.boolean().default(true),
});

export type PolicyConfig = z.infer<typeof PolicyConfigSchema>;

export function loadPolicyConfig(
  env: Record<string, string | undefined> = process.env,
): PolicyConfig {
  const rawConfig = {
    defaultPolicyVersion: env.POLICY_DEFAULT_VERSION,
    enforceStrictScopeMatching: env.POLICY_ENFORCE_STRICT_SCOPES
      ? env.POLICY_ENFORCE_STRICT_SCOPES === 'true'
      : undefined,
    failClosedOnMissingPolicy: env.POLICY_FAIL_CLOSED
      ? env.POLICY_FAIL_CLOSED === 'true'
      : undefined,
    auditEvidenceEnabled: env.POLICY_AUDIT_ENABLED
      ? env.POLICY_AUDIT_ENABLED === 'true'
      : undefined,
  };

  const result = PolicyConfigSchema.safeParse(rawConfig);
  if (!result.success) {
    const details = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    throw new Error(`[PolicyConfigError] Invalid configuration: ${details}`);
  }

  return result.data;
}
