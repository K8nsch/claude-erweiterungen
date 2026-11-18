/** One rate limit window as the status row shows it. */
export type CacheLotseLimit = {
  usedPercent: number
  /** Epoch ms when the window starts over, null if the engine did not say. */
  resetAt: number | null
}

/** Snapshot of $.session.usage(), taken after answers, refreshes and compactions. */
export type CacheLotseReading = {
  context: { usedPercent: number; tokens: number; window: number }
  fiveHour: CacheLotseLimit | null
  week: CacheLotseLimit | null
  costUsd: number | null
}

/** Per-session switches, kept in $.store so they survive a reload or resume. */
export type CacheLotseSettings = {
  autoCompact: boolean
  keepWarm: boolean
}
