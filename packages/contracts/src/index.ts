/**
 * NexusOS Shared Public Contracts Package (@nexusos/contracts)
 * Implementation-independent specifications, error taxonomies, event envelopes, and schema validation.
 */

export const NEXUSOS_CONTRACT_VERSION = '0.1.0-sprint0' as const;

export * from './identity/index.js';
export * from './errors/index.js';
export * from './api/index.js';
export * from './events/index.js';
export * from './acp/index.js';
export * from './permissions/index.js';
