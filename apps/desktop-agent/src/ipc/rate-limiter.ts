import { IIPCRateLimiter } from './types.js';

export class IPCRateLimiter implements IIPCRateLimiter {
  private readonly clientRequests = new Map<string, number[]>();
  private globalRequests: number[] = [];

  constructor(
    private readonly maxRequestsPerWindow: number = 20,
    private readonly windowMs: number = 1000,
    private readonly globalMaxRequestsPerWindow: number = 100,
  ) {}

  public isRateLimited(clientId: string): boolean {
    if (!clientId) return true;

    const now = Date.now();

    // 1. Check Global Rate Limit across all connections (blocks connection churn DoS)
    this.globalRequests = this.globalRequests.filter((t) => now - t < this.windowMs);
    if (this.globalRequests.length >= this.globalMaxRequestsPerWindow) {
      return true;
    }

    // 2. Check Per-Client Rate Limit
    const timestamps = this.clientRequests.get(clientId) || [];
    const validTimestamps = timestamps.filter((t) => now - t < this.windowMs);

    if (validTimestamps.length >= this.maxRequestsPerWindow) {
      this.clientRequests.set(clientId, validTimestamps);
      return true;
    }

    validTimestamps.push(now);
    this.globalRequests.push(now);
    this.clientRequests.set(clientId, validTimestamps);
    return false;
  }

  public reset(clientId?: string): void {
    if (clientId) {
      this.clientRequests.delete(clientId);
    } else {
      this.clientRequests.clear();
      this.globalRequests = [];
    }
  }
}
