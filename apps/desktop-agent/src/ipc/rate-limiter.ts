import { IIPCRateLimiter } from './types.js';

export class IPCRateLimiter implements IIPCRateLimiter {
  private readonly clientRequests = new Map<string, number[]>();

  constructor(
    private readonly maxRequestsPerWindow: number = 20,
    private readonly windowMs: number = 1000,
  ) {}

  public isRateLimited(clientId: string): boolean {
    if (!clientId) return true;

    const now = Date.now();
    const timestamps = this.clientRequests.get(clientId) || [];

    // Filter out timestamps outside the sliding window
    const validTimestamps = timestamps.filter((t) => now - t < this.windowMs);

    if (validTimestamps.length >= this.maxRequestsPerWindow) {
      this.clientRequests.set(clientId, validTimestamps);
      return true;
    }

    validTimestamps.push(now);
    this.clientRequests.set(clientId, validTimestamps);
    return false;
  }

  public reset(clientId?: string): void {
    if (clientId) {
      this.clientRequests.delete(clientId);
    } else {
      this.clientRequests.clear();
    }
  }
}
