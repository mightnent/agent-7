export interface RateLimiter {
  allow(key: string, now?: Date): boolean;
}

interface SlidingWindowBucket {
  hits: number[];
}

export class SlidingWindowRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, SlidingWindowBucket>();

  constructor(
    private readonly config: {
      maxHits: number;
      windowMs: number;
      maxKeys?: number;
    },
  ) {}

  allow(key: string, now = new Date()): boolean {
    const ts = now.getTime();
    const windowStart = ts - this.config.windowMs;

    const bucket = this.buckets.get(key) ?? { hits: [] };
    bucket.hits = bucket.hits.filter((hitTs) => hitTs >= windowStart);

    if (bucket.hits.length >= this.config.maxHits) {
      this.buckets.set(key, bucket);
      return false;
    }

    bucket.hits.push(ts);
    this.buckets.set(key, bucket);

    if (this.config.maxKeys && this.buckets.size > this.config.maxKeys) {
      const firstKey = this.buckets.keys().next().value;
      if (firstKey) {
        this.buckets.delete(firstKey);
      }
    }

    return true;
  }
}
