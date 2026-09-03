/**
 * Token bucket. Cheap enough to run per-connection per-message and gives a
 * burst allowance so normal play is never throttled.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  /** Consume one token; false means the caller should drop the message. */
  take(cost = 1, now = Date.now()): boolean {
    const elapsed = (now - this.lastRefill) / 1000;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
      this.lastRefill = now;
    }
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }

  get available(): number {
    return this.tokens;
  }
}

/** Per-IP connection throttle, applied during the WebSocket handshake. */
export class ConnectionThrottle {
  private readonly buckets = new Map<string, TokenBucket>();
  private lastSweep = Date.now();

  constructor(
    private readonly burst = 8,
    private readonly perSecond = 1,
  ) {}

  allow(ip: string): boolean {
    this.sweep();
    let bucket = this.buckets.get(ip);
    if (!bucket) {
      bucket = new TokenBucket(this.burst, this.perSecond);
      this.buckets.set(ip, bucket);
    }
    return bucket.take();
  }

  private sweep(): void {
    const now = Date.now();
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [ip, bucket] of this.buckets) {
      if (bucket.available >= this.burst) this.buckets.delete(ip);
    }
  }
}
