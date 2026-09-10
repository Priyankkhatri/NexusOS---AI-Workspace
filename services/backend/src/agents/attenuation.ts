/**
 * Scope Attenuation Engine (060-SEC-01)
 * Enforces strict set/subset containment for delegated capabilities: childScopes ⊆ parentScopes.
 */

export interface AttenuationResult {
  valid: boolean;
  unauthorizedScopes: string[];
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Validates that all child requested scopes are explicitly granted within parent scopes.
 * Rejects wildcard expansion, lexical tricks, and empty parent scope sets.
 */
export function verifyScopeAttenuation(
  parentScopes: string[],
  childScopes: string[],
): AttenuationResult {
  if (!parentScopes || !Array.isArray(parentScopes) || parentScopes.length === 0) {
    return {
      valid: false,
      unauthorizedScopes: childScopes ?? [],
      errorCode: 'EMPTY_PARENT_SCOPES',
      errorMessage: 'Parent lease contains no granted scopes.',
    };
  }

  if (!childScopes || !Array.isArray(childScopes) || childScopes.length === 0) {
    return {
      valid: false,
      unauthorizedScopes: [],
      errorCode: 'EMPTY_CHILD_SCOPES',
      errorMessage: 'Child delegation request must specify at least one scope.',
    };
  }

  const parentSet = new Set(parentScopes.map((s) => s.trim()));
  const unauthorizedScopes: string[] = [];

  for (const scope of childScopes) {
    if (typeof scope !== 'string' || scope.trim() === '') {
      unauthorizedScopes.push(String(scope));
      continue;
    }

    const trimmed = scope.trim();

    // Wildcard escalation guard: child cannot introduce wildcards not present in parent
    if (trimmed === '*' || trimmed.endsWith('.*') || trimmed.endsWith(':*')) {
      if (!parentSet.has(trimmed)) {
        unauthorizedScopes.push(trimmed);
        continue;
      }
    }

    if (!parentSet.has(trimmed)) {
      unauthorizedScopes.push(trimmed);
    }
  }

  if (unauthorizedScopes.length > 0) {
    return {
      valid: false,
      unauthorizedScopes,
      errorCode: 'SCOPE_AMPLIFICATION_FORBIDDEN',
      errorMessage: `Child requested scopes exceed parent lease authority: [${unauthorizedScopes.join(', ')}]`,
    };
  }

  return {
    valid: true,
    unauthorizedScopes: [],
  };
}
