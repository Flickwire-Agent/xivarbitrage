import { config } from "../config.js";

export class RateLimiter {
  private nextAvailableAt = 0;

  constructor(private readonly requestsPerSecond: number) {}

  async schedule<T>(task: () => Promise<T>): Promise<T> {
    const spacingMs = 1000 / this.requestsPerSecond;
    const now = Date.now();
    const waitMs = Math.max(0, this.nextAvailableAt - now);
    this.nextAvailableAt = Math.max(now, this.nextAvailableAt) + spacingMs;

    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    return task();
  }
}

export const rateLimiter = new RateLimiter(config.universalisRequestsPerSecond);
