/**
 * NexusOS Public Contracts Foundation
 * Authoritative system contract version and core error taxonomy definitions.
 * Implementation-independent — MUST NOT import service implementations.
 */

export const NEXUSOS_CONTRACT_VERSION = '0.1.0-sprint0' as const;

export enum ErrorCategory {
  SYSTEM = 'SYSTEM',
  VALIDATION = 'VALIDATION',
  AUTHENTICATION = 'AUTHENTICATION',
  AUTHORIZATION = 'AUTHORIZATION',
  POLICY_DENIED = 'POLICY_DENIED',
  LEASE_EXPIRED = 'LEASE_EXPIRED',
  RATE_LIMITED = 'RATE_LIMITED',
  NOT_FOUND = 'NOT_FOUND',
  TIMEOUT = 'TIMEOUT',
  DEPENDENCY_FAILURE = 'DEPENDENCY_FAILURE',
}

export interface NexusOSError {
  code: string;
  category: ErrorCategory;
  message: string;
  correlationId?: string;
  requestId?: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export function createNexusOSError(
  code: string,
  category: ErrorCategory,
  message: string,
  extra: Partial<Omit<NexusOSError, 'code' | 'category' | 'message' | 'timestamp'>> = {},
): NexusOSError {
  return {
    code,
    category,
    message,
    timestamp: new Date().toISOString(),
    ...extra,
  };
}
