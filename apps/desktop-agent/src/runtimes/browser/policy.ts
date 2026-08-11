import {
  RuntimeExecutionPolicy,
  ToolRuntimeDescriptor,
  RuntimeCategory,
} from '../../registry/runtime-registry.js';

/**
 * Execution policy for Task 03D: Browser Runtime.
 *
 * Explicitly authorizes RuntimeCategory.BROWSER, RuntimeCategory.TERMINAL,
 * and RuntimeCategory.FILESYSTEM descriptors as executable. Keeps all other
 * runtime categories (PLUGIN, CAMERA, MICROPHONE, CLIPBOARD, LOCAL_AI) strictly fail-closed.
 */
export class BrowserExecutionPolicy implements RuntimeExecutionPolicy {
  allowExecutableRegistration(descriptor: ToolRuntimeDescriptor): boolean {
    return (
      descriptor.category === RuntimeCategory.BROWSER ||
      descriptor.category === RuntimeCategory.TERMINAL ||
      descriptor.category === RuntimeCategory.FILESYSTEM
    );
  }
}
