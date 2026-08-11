import {
  ConfigurationSnapshot,
  IConfigRollbackHandler,
  IConfigValidationEngine,
  IConfigurationStore,
} from './types.js';

export class ConfigRollbackHandler implements IConfigRollbackHandler {
  public rollbackToLKG(
    store: IConfigurationStore,
    validationEngine: IConfigValidationEngine,
  ): ConfigurationSnapshot {
    const lkg = store.getLKGConfig();

    if (lkg) {
      const lkgVal = validationEngine.validateSnapshot(lkg);
      if (lkgVal.valid && lkgVal.sanitizedConfig) {
        store.setActiveConfig(lkgVal.sanitizedConfig);
        return lkgVal.sanitizedConfig;
      }
    }

    // Fallback: LKG is missing or corrupted → restore Shipped Defaults
    const shipped = store.getShippedDefaults();
    const shippedVal = validationEngine.validateSnapshot(shipped);
    const safeShipped = shippedVal.sanitizedConfig || shipped;

    store.setActiveConfig(safeShipped);
    store.setLKGConfig(safeShipped); // Reset LKG to uncorrupted shipped baseline

    return safeShipped;
  }
}
