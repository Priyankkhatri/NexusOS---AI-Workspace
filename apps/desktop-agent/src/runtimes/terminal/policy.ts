import {
  RuntimeExecutionPolicy,
  ToolRuntimeDescriptor,
  RuntimeCategory,
} from '../../registry/runtime-registry.js';

/**
 * Execution policy for Task 03C: Terminal Runtime.
 *
 * Explicitly authorizes RuntimeCategory.TERMINAL and RuntimeCategory.FILESYSTEM
 * descriptors as executable. Keeps all other runtime categories (BROWSER,
 * PLUGIN, CAMERA, MICROPHONE, CLIPBOARD, LOCAL_AI) strictly fail-closed.
 */
export class TerminalExecutionPolicy implements RuntimeExecutionPolicy {
  allowExecutableRegistration(descriptor: ToolRuntimeDescriptor): boolean {
    return (
      descriptor.category === RuntimeCategory.TERMINAL ||
      descriptor.category === RuntimeCategory.FILESYSTEM
    );
  }
}
