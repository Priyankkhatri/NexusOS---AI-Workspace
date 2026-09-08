import {
  RuntimeExecutionPolicy,
  ToolRuntimeDescriptor,
  RuntimeCategory,
} from '../../registry/runtime-registry.js';

/**
 * Execution policy for Plugin Host Manager.
 *
 * Explicitly authorizes RuntimeCategory.PLUGIN, RuntimeCategory.BROWSER,
 * RuntimeCategory.TERMINAL, RuntimeCategory.FILESYSTEM, RuntimeCategory.CLIPBOARD,
 * RuntimeCategory.DEVICE, RuntimeCategory.VAULT, RuntimeCategory.UPDATER,
 * RuntimeCategory.HEALTH, RuntimeCategory.CONFIG, RuntimeCategory.STATE,
 * RuntimeCategory.TELEMETRY, RuntimeCategory.NOTIFICATION, and RuntimeCategory.LOCAL_AI descriptors as executable.
 * Keeps remaining runtime categories (CAMERA, MICROPHONE) strictly fail-closed.
 */
export class PluginExecutionPolicy implements RuntimeExecutionPolicy {
  public isRuntimeCategoryAuthorized(category: RuntimeCategory): boolean {
    return (
      category === RuntimeCategory.PLUGIN ||
      category === RuntimeCategory.BROWSER ||
      /** Task 043: Terminal Runtime & Process Supervisor Adapter */
      category === RuntimeCategory.TERMINAL ||
      category === RuntimeCategory.FILESYSTEM ||
      category === RuntimeCategory.CLIPBOARD ||
      category === RuntimeCategory.DEVICE ||
      category === RuntimeCategory.VAULT ||
      category === RuntimeCategory.UPDATER ||
      category === RuntimeCategory.HEALTH ||
      category === RuntimeCategory.CONFIG ||
      category === RuntimeCategory.STATE ||
      category === RuntimeCategory.TELEMETRY ||
      category === RuntimeCategory.NOTIFICATION ||
      /** Task 046: Local AI Runtime & Hardware Acceleration Adapter */
      category === RuntimeCategory.LOCAL_AI
    );
  }

  allowExecutableRegistration(descriptor: ToolRuntimeDescriptor): boolean {
    return this.isRuntimeCategoryAuthorized(descriptor.category);
  }
}
