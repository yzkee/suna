import { replenish, cleanup } from './index';

let interval: ReturnType<typeof setInterval> | null = null;

const INTERVAL_MS = 60_000;

export function start(): void {
  if (interval) return;

  console.log(`[POOL] Auto-replenish started (every ${INTERVAL_MS / 1000}s)`);

  tick();
  interval = setInterval(tick, INTERVAL_MS);
}

export function stop(): void {
  if (!interval) return;
  clearInterval(interval);
  interval = null;
  console.log('[POOL] Auto-replenish stopped');
}

export function isRunning(): boolean {
  return interval !== null;
}

async function tick(): Promise<void> {
  try {
    await cleanup();
    await replenish();
  } catch (err) {
    console.error('[POOL] Auto-replenish tick failed:', err);
  }
}
