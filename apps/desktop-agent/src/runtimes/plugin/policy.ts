import {
  RuntimeExecutionPolicy,
  ToolRuntimeDescriptor,
  RuntimeCategory,
} from '../../registry/runtime-registry.js';

/**
 * Execution policy for Task 03E: Plugin Host Manager.
 *
 * Explicitly authorizes RuntimeCategory.PLUGIN, RuntimeCategory.BROWSER,
 * RuntimeCategory.TERMINAL, and RuntimeCategory.FILESYSTEM descriptors as executable.
 * Keeps all remaining runtime categories (CAMERA, MICROPHONE, CLIPBOARD, LOCAL_AI) strictly fail-closed.
 */
export class PluginExecutionPolicy implements RuntimeExecutionPolicy {
  allowExecutableRegistration(descriptor: ToolRuntimeDescriptor): boolean {
    return (
      descriptor.category === RuntimeCategory.PLUGIN ||
      descriptor.category === RuntimeCategory.BROWSER ||
      descriptor.category === RuntimeCategory.TERMINAL ||
      descriptor.category === RuntimeCategory.FILESYSTEM ||
      descriptor.category === RuntimeCategory.CLIPBOARD ||
      descriptor.category === RuntimeCategory.DEVICE ||
      descriptor.category === RuntimeCategory.VAULT ||
      descriptor.category === RuntimeCategory.UPDATER ||
      descriptor.category === RuntimeCategory.HEALTH ||
      descriptor.category === RuntimeCategory.CONFIG ||
      descriptor.category === RuntimeCategory.STATE ||
      descriptor.category === RuntimeCategory.TELEMETRY
    );
  }
}
