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
export * from './tasks/index.js';
export * from './filesystem/index.js';
export * from './ai/index.js';
export * from './approval/index.js';
export * from './plugin/index.js';
export * from './browser/index.js';
export * from './memory/index.js';
export * from './planner/index.js';
