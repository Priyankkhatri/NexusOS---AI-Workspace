import { AuthenticatedContext } from '../domain/types.js';

export interface AuthenticationResult {
  success: boolean;
  context?: AuthenticatedContext;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Identity Provider Boundary Interface matching Backend EDD Section 3.2
 */
export interface IdentityProviderBoundary {
  authenticateToken(rawToken: string): Promise<AuthenticationResult>;
}
