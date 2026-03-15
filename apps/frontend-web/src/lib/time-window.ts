export type TimeWindowPreset = 'live' | '24h' | '48h' | '7d' | '30d' | 'custom';

const DAY_MS = 24 * 60 * 60 * 1000;

const PRESET_MS: Record<Exclude<TimeWindowPreset, 'custom' | 'live'>, number> = {
  '24h': DAY_MS,
  '48h': 2 * DAY_MS,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
};

export function computeTimeWindow(period: string, customDate: string, now: Date = new Date()): { from: string; to: string; durationMs: number } {
  if (period === 'live') {
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    return {
      from: dayStart.toISOString(),
      to: now.toISOString(),
      durationMs: now.getTime() - dayStart.getTime(),
    };
  }

  if (period === 'custom' && customDate) {
    const dayStart = new Date(`${customDate}T00:00:00`);
    if (!Number.isNaN(dayStart.getTime())) {
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);
      return {
        from: dayStart.toISOString(),
        to: dayEnd.toISOString(),
        durationMs: dayEnd.getTime() - dayStart.getTime(),
      };
    }
  }

  const durationMs = PRESET_MS[(period as keyof typeof PRESET_MS)] ?? DAY_MS;
  return {
    from: new Date(now.getTime() - durationMs).toISOString(),
    to: now.toISOString(),
    durationMs,
  };
}

export function adaptiveBucketMs(durationMs: number): number {
  if (durationMs <= 2 * DAY_MS) return 5 * 60 * 1000;
  if (durationMs <= 7 * DAY_MS) return 15 * 60 * 1000;
  if (durationMs <= 30 * DAY_MS) return 60 * 60 * 1000;
  return 3 * 60 * 60 * 1000;
}

export function downsampleByStep<T>(rows: T[], maxPoints: number): T[] {
  if (rows.length <= maxPoints) return rows;
  const step = Math.ceil(rows.length / maxPoints);
  return rows.filter((_, idx) => idx % step === 0 || idx === rows.length - 1);
}
