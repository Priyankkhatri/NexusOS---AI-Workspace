import { TenantId, UserId, DeviceId } from '@nexusos/contracts';

export enum PrincipalType {
  USER = 'USER',
  SERVICE = 'SERVICE',
  DEVICE = 'DEVICE',
}

export interface UserIdentity {
  type: PrincipalType.USER;
  userId: UserId;
  tenantId: TenantId;
  email?: string;
  roles: string[];
}

export interface ServiceIdentity {
  type: PrincipalType.SERVICE;
  serviceId: string;
  tenantId: TenantId;
  serviceName: string;
  scopes: string[];
}

export interface DeviceIdentity {
  type: PrincipalType.DEVICE;
  deviceId: DeviceId;
  tenantId: TenantId;
  hardwareFingerprint?: string;
  scopes: string[];
}

export type IdentityPrincipal = UserIdentity | ServiceIdentity | DeviceIdentity;

export interface AuthenticatedContext {
  principal: IdentityPrincipal;
  tenantId: TenantId;
  issuedAt: string;
  expiresAt: string;
  rawTokenHash: string;
}
