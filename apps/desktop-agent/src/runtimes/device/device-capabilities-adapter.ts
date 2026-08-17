import os from 'node:os';
import { DeviceInfo, DevicePosture } from './types.js';

export interface IDeviceCapabilitiesAdapter {
  getPosture(): Promise<DevicePosture>;
  queryInfo(): Promise<DeviceInfo>;
}

export class DefaultDeviceCapabilitiesAdapter implements IDeviceCapabilitiesAdapter {
  constructor(
    private readonly agentVersion: string = '0.1.0-sprint0',
    private readonly mockConsent: boolean = true,
  ) {}

  public async getPosture(): Promise<DevicePosture> {
    return {
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      uptimeSeconds: Math.floor(os.uptime()),
      hasOSConsent: this.mockConsent,
      displayCount: 1,
      powerSource: 'ac',
    };
  }

  public async queryInfo(): Promise<DeviceInfo> {
    return {
      platform: os.platform(),
      arch: os.arch(),
      agentVersion: this.agentVersion,
      supportedCapabilities: [
        'clipboard:read',
        'clipboard:write',
        'clipboard:clear',
        'device:query_info',
        'device:get_posture',
        'device:show_notification',
      ],
    };
  }
}
