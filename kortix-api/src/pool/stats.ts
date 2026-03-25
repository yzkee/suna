/** In-memory pool stats tracker. Resets on process restart. */

let totalCreated = 0;
let totalClaimed = 0;
let totalExpired = 0;
let claimTimesMs: number[] = [];
let lastReplenishAt: Date | null = null;
let lastCleanupAt: Date | null = null;

const MAX_CLAIM_SAMPLES = 100;

export function recordCreated(count = 1): void {
  totalCreated += count;
}

export function recordClaimed(durationMs: number): void {
  totalClaimed++;
  claimTimesMs.push(durationMs);
  if (claimTimesMs.length > MAX_CLAIM_SAMPLES) {
    claimTimesMs = claimTimesMs.slice(-MAX_CLAIM_SAMPLES);
  }
}

export function recordExpired(count = 1): void {
  totalExpired += count;
}

export function recordReplenish(): void {
  lastReplenishAt = new Date();
}

export function recordCleanup(): void {
  lastCleanupAt = new Date();
}

export function getStats() {
  const avgClaimTimeMs =
    claimTimesMs.length > 0
      ? Math.round(claimTimesMs.reduce((a, b) => a + b, 0) / claimTimesMs.length)
      : 0;

  return {
    totalCreated,
    totalClaimed,
    totalExpired,
    avgClaimTimeMs,
    poolHitRate: totalClaimed > 0 ? totalClaimed / (totalClaimed + totalExpired) : 0,
    lastReplenishAt,
    lastCleanupAt,
  };
}
