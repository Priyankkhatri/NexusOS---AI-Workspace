import { z } from 'zod';

/**
 * Common Identifier Schemas matching NexusOS Architecture Bible UUID standards
 */
export const UUIDSchema = z.string().uuid();

export const TenantIdSchema = UUIDSchema;
export const UserIdSchema = UUIDSchema;
export const DeviceIdSchema = UUIDSchema;
export const RequestIdSchema = UUIDSchema;
export const CorrelationIdSchema = UUIDSchema;
export const TaskIdSchema = UUIDSchema;
export const LeaseIdSchema = UUIDSchema;

export type TenantId = z.infer<typeof TenantIdSchema>;
export type UserId = z.infer<typeof UserIdSchema>;
export type DeviceId = z.infer<typeof DeviceIdSchema>;
export type RequestId = z.infer<typeof RequestIdSchema>;
export type CorrelationId = z.infer<typeof CorrelationIdSchema>;
export type TaskId = z.infer<typeof TaskIdSchema>;
export type LeaseId = z.infer<typeof LeaseIdSchema>;

/**
 * Shared Identity Claims Schema
 */
export const IdentityClaimsSchema = z.object({
  tenantId: TenantIdSchema,
  userId: UserIdSchema,
  deviceId: DeviceIdSchema.optional(),
  roles: z.array(z.string()).default([]),
  scopes: z.array(z.string()).default([]),
});

export type IdentityClaims = z.infer<typeof IdentityClaimsSchema>;
