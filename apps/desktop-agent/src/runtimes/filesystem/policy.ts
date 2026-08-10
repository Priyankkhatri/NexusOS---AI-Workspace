import {
  RuntimeExecutionPolicy,
  ToolRuntimeDescriptor,
  RuntimeCategory,
} from '../../registry/runtime-registry.js';

/**
 * Execution policy for Task 03B: Filesystem Runtime.
 *
 * Explicitly authorizes ONLY RuntimeCategory.FILESYSTEM descriptors as executable.
 * Keeps all other runtime categories (TERMINAL, BROWSER, PLUGIN, CAMERA, etc.)
 * fail-closed.
 */
export class FilesystemExecutionPolicy implements RuntimeExecutionPolicy {
  allowExecutableRegistration(descriptor: ToolRuntimeDescriptor): boolean {
    return descriptor.category === RuntimeCategory.FILESYSTEM;
  }
}
