import {
  RuntimeExecutionPolicy,
  ToolRuntimeDescriptor,
  RuntimeCategory,
} from '../../registry/runtime-registry.js';

export class DeviceExecutionPolicy implements RuntimeExecutionPolicy {
  allowExecutableRegistration(descriptor: ToolRuntimeDescriptor): boolean {
    return (
      descriptor.category === RuntimeCategory.DEVICE ||
      descriptor.category === RuntimeCategory.CLIPBOARD
    );
  }
}
