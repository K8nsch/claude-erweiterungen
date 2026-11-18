// Cache Lotse steers a session past the moment its prompt cache expires.
// Above the prompt it shows how long the cache stays valid, how full the
// context is, the 5-hour and weekly limits and the session's API value, and
// it offers three controls: compact now, auto-compact on/off, keep warm on/off.
import type { EngineInterface, Register } from 'claude-code'

import type { CacheLotseLimit, CacheLotseReading, CacheLotseSettings } from '../types'

// Lifetime of a cache entry after its last read or write (subscription: 1 h).
const CACHE_MINUTES = 60
// Minutes before expiry at which the sound, the toast and the red line come.
const WARN_MINUTES = 5
// Auto-compact runs this close to expiry, while the old context still costs
// only the cache price to read.
const AUTO_COMPACT_SECONDS = 60
// A keep-warm refresh runs this close to expiry; earlier than auto-compact,
// so with keep-warm on the refresh always comes first.
const KEEP_WARM_SECONDS = 120
// Refreshes per idle period (every answer starts a new one). Each refresh
// reads the whole context and counts toward the 5-hour limit, so a forgotten
// session must not keep refreshing.
const MAX_WARM_REFRESHES = 2
const TICK_MS = 15_000
const GAUGE_CELLS = 5
const ALERT_SOUND = 'sounds/gong.wav'

const DEFAULT_SETTINGS: CacheLotseSettings = { autoCompact: true, keepWarm: false }

// Sent through $.model.fork: the session's own transcript is re-sent and read
// from the cache, which refreshes its lifetime; nothing lands in the chat. No
// effort level is named, so the cached prefix is read on every model.
const KEEP_WARM_PROMPT = 'Antworte sofort und ohne nachzudenken ausschließlich mit "ok". Du hast keine Werkzeuge.'

type WarmInfo = { count: number; lastCacheRead: number | null; error: string | null }
type Tone = 'green' | 'yellow' | 'red'

async function key($: EngineInterface, name: string): Promise<string> {
  return `${name}:${await $.session.id()}`
}

// Usage snapshot reduced to what the row draws.
async function readUsage($: EngineInterface): Promise<CacheLotseReading> {
  const usage = await $.session.usage()
  const windows = new Map(usage.rateLimits.map(limit => [limit.kind, limit] as const))
  const windowOf = (kind: string): CacheLotseLimit | null => {
    const limit = windows.get(kind)
    if (limit === undefined) return null
    const at = limit.resetsAt ? new Date(limit.resetsAt).getTime() : NaN
    return { usedPercent: Math.round(limit.percentUsed), resetAt: Number.isFinite(at) ? at : null }
  }
  const tokens = usage.context.tokens ?? 0
  const window = usage.context.window
  const fallbackPercent = window > 0 ? Math.round((100 * tokens) / window) : 0
  return {
    context: { usedPercent: usage.context.percent ?? fallbackPercent, tokens, window },
    fiveHour: windowOf('five_hour'),
    week: windowOf('seven_day'),
    costUsd: usage.cost?.usd ?? null,
  }
}

// Five-cell gauge, one cell per twenty percent, rounded to the nearest cell.
function gauge(usedPercent: number): string {
  const cells = Math.min(GAUGE_CELLS, Math.max(0, Math.floor((usedPercent * GAUGE_CELLS + 50) / 100)))
  return '▰'.repeat(cells).padEnd(GAUGE_CELLS, '▱')
}

function toneFor(usedPercent: number): Tone {
  if (usedPercent < 60) return 'green'
  if (usedPercent < 85) return 'yellow'
  return 'red'
}

// 950 -> "950", 132000 -> "132k", 1000000 -> "1M", 1500000 -> "1.5M".
function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1))}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

// Countdown text; rounds up so a running countdown never reads "0 min".
function duration(ms: number): string {
  const totalMinutes = Math.ceil(Math.max(0, ms) / 60_000)
  if (totalMinutes < 60) return `${totalMinutes} min`
  return `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, '0')} h`
}

function percentText(usedPercent: number): string {
  return `${usedPercent} %`
}

// Asks the engine for a new frame; if that fails it repaints on its own later.
function repaint($: EngineInterface): void {
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // nothing to do
  }
}

// Mod state: plain module variables. A reload starts them over; the anchor
// and the switches are restored from $.store at session.start. Functions that
// take $ must be declared at the top of the file, so they live out here too.
let reading: CacheLotseReading | null = null
// When the cache was last written or read by a main-thread request (an
// answer or a keep-warm refresh): the cache lifetime counts from here.
let anchor: number | null = null
let now = 0
let isWorking = false
let isRefreshing = false
let settings: CacheLotseSettings = { ...DEFAULT_SETTINGS }
let warm: WarmInfo = { count: 0, lastCacheRead: null, error: null }
// True after a compaction between turns: the next prompt rebuilds the cache,
// so neither auto-compact nor keep-warm makes sense until then.
let isCompacted = false

// One warning, one auto-compact and one refresh attempt per cache window.
let warnedFor: number | null = null
let compactedFor: number | null = null
let refreshTriedFor: number | null = null
// The 5-hour reset the limits were last re-read for: limits are otherwise read
// only after an answer, so a passed reset would keep showing the old window.
let limitsReadFor: number | null = null

async function saveSettings($: EngineInterface, next: CacheLotseSettings): Promise<void> {
  settings = next
  repaint($)
  await $.store.set(await key($, 'settings'), next)
}

async function setAnchor($: EngineInterface, t: number): Promise<void> {
  anchor = t
  await $.store.set(await key($, 'anchor'), t)
}

function canKeepWarm(): boolean {
  return settings.keepWarm && warm.count < MAX_WARM_REFRESHES
}

async function refresh($: EngineInterface, forAnchor: number): Promise<void> {
  refreshTriedFor = forAnchor
  isRefreshing = true
  repaint($)
  try {
    const result = await $.model.fork({ prompt: KEEP_WARM_PROMPT })
    const usage = 'usage' in result ? result.usage : null
    if (result.isAnswered || (usage && usage.cache_read_input_tokens + usage.cache_creation_input_tokens > 0)) {
      const t = await $.clock.now()
      now = t
      await setAnchor($, t)
      const cacheRead = usage ? usage.cache_read_input_tokens : null
      warm = { count: warm.count + 1, lastCacheRead: cacheRead, error: null }
      if (cacheRead === 0) {
        $.ui.toast('Cache Lotse: Der Cache war beim Auffrischen schon kalt und wurde neu geschrieben.', { timeoutMs: 15_000 })
      }
    } else {
      const reason = 'reason' in result ? result.reason : 'unbekannt'
      warm = { ...warm, error: reason }
      $.ui.toast(`Cache Lotse: Warmhalten fehlgeschlagen (${reason}).`, { timeoutMs: 15_000 })
    }
  } catch (error) {
    warm = { ...warm, error: String(error) }
  } finally {
    isRefreshing = false
    reading = await readUsage($).catch(() => reading)
    repaint($)
  }
}

// Records a compaction of the main conversation: blocks auto-compact and
// keep-warm until the next answer and refreshes the context reading.
async function markCompacted($: EngineInterface): Promise<void> {
  if (!isWorking) isCompacted = true
  compactedFor = anchor
  reading = await readUsage($).catch(() => reading)
  repaint($)
}

async function compactNow($: EngineInterface): Promise<void> {
  try {
    // The engine runs this past every hook but the caller's own, so this
    // mod's session.compact hook does not see it: mark it here.
    const result = await $.session.compact()
    if ('skip' in result && result.skip) $.ui.toast(`Komprimieren übersprungen: ${result.skip}`, { timeoutMs: 15_000 })
    else await markCompacted($)
  } catch {
    // The desktop app hosts sessions headless, where $.session.compact is
    // refused ("compaction here runs inside a turn"): run /compact instead,
    // as a typed one would.
    try {
      await $.command.run({ command: 'compact' })
      await markCompacted($)
    } catch (error) {
      $.ui.toast(`Komprimieren nicht möglich: ${String(error)}`, { timeoutMs: 15_000 })
    }
  }
}

async function tick($: EngineInterface): Promise<void> {
  const t = await $.clock.now()
  now = t
  const resetAt = reading?.fiveHour?.resetAt ?? null
  if (resetAt !== null && resetAt <= t && limitsReadFor !== resetAt) {
    limitsReadFor = resetAt
    reading = await readUsage($).catch(() => reading)
  }
  repaint($)
  const last = anchor
  if (last === null || isWorking || isRefreshing || isCompacted) return
  const left = last + CACHE_MINUTES * 60_000 - t
  if (left <= 0) return

  if (canKeepWarm()) {
    if (refreshTriedFor !== last && left <= KEEP_WARM_SECONDS * 1000) await refresh($, last)
    return
  }
  if (warnedFor !== last && left <= WARN_MINUTES * 60_000) {
    warnedFor = last
    void $.audio.play({ asset: ALERT_SOUND }).catch(() => undefined)
    $.ui.toast(`Cache-Ablauf in ${duration(left)}: weiterschreiben, „Warm halten“ einschalten oder komprimieren, sonst wird der nächste Prompt teuer.`, {
      timeoutMs: 60_000,
    })
  }
  if (settings.autoCompact && compactedFor !== last && left <= AUTO_COMPACT_SECONDS * 1000) {
    compactedFor = last
    await compactNow($)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    now = await $.clock.now()
    const savedAnchor = await $.store.get(await key($, 'anchor'))
    if (typeof savedAnchor === 'number') anchor = savedAnchor
    const savedSettings = (await $.store.get(await key($, 'settings'))) as Partial<CacheLotseSettings> | undefined
    settings = { ...DEFAULT_SETTINGS, ...(savedSettings ?? {}) }
    reading = await readUsage($)
    $.clock.every(TICK_MS, () => {
      void tick($)
    })
    return result
  })

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    isWorking = true
    repaint($)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result
    const t = await $.clock.now()
    isWorking = false
    isCompacted = false
    warm = { count: 0, lastCacheRead: null, error: null }
    now = t
    await setAnchor($, t)
    reading = await readUsage($)
    repaint($)
    return result
  })

  // Sees every compaction of the main conversation, the person's /compact
  // included, so a manual compaction blocks the next automatic one.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId || e.trigger === 'precompute' || 'skip' in result) return result
    await markCompacted($)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Rows of Claude Code and other mods come first; Cache Lotse goes last.
    const others = await next(e)
    if (e.props.hasSurvey) return others

    const { Box, Text, Button } = $.ui.resolve(e)
    const usage = reading
    const t = now
    const last = anchor
    const busy = isWorking
    const left = last === null ? Infinity : last + CACHE_MINUTES * 60_000 - t
    // Native buttons on desktop and phone are taller than a text row and need
    // a row of air; the terminal stays tight. Numbers only: this engine build
    // refuses the named steps ("xs") its types allow.
    const air = e.surface === 'desktop' || e.surface === 'mobile' ? 1 : 0

    // Cache state, most specific first.
    const state: { symbol: string; text: string; tone: Tone | 'gray' } = busy
      ? { symbol: '◉', text: 'aktiv', tone: 'green' }
      : isRefreshing
        ? { symbol: '◉', text: 'frischt auf …', tone: 'green' }
        : isCompacted
          ? { symbol: '○', text: 'komprimiert, nächster Prompt baut ihn neu auf', tone: 'gray' }
          : last === null
            ? { symbol: '○', text: 'noch kein Prompt', tone: 'gray' }
            : left <= 0
              ? { symbol: '○', text: 'abgelaufen, nächster Prompt zahlt den vollen Preis', tone: 'red' }
              : {
                  symbol: '◉',
                  text: `${duration(left)} übrig`,
                  tone: canKeepWarm() || left > 15 * 60_000 ? 'green' : left > WARN_MINUTES * 60_000 ? 'yellow' : 'red',
                }
    const showWarm = settings.keepWarm && !busy && !isCompacted && last !== null
    const warmNote = `aufgefrischt ${warm.count}/${MAX_WARM_REFRESHES}${warm.lastCacheRead === null ? '' : ` (${compactNumber(warm.lastCacheRead)} aus Cache)`}`

    const cacheSegment = (
      <Text key="cache">
        <Text dimColor>Cache </Text>
        <Text color={state.tone}>
          {state.symbol} {state.text}
        </Text>
        {showWarm && <Text dimColor> · {warmNote}</Text>}
      </Text>
    )
    const meter = (k: string, label: string, usedPercent: number, extra: string | null) => (
      <Text key={k}>
        <Text dimColor>{label} </Text>
        <Text color={toneFor(usedPercent)}>{gauge(usedPercent)}</Text> {percentText(usedPercent)}
        {extra !== null && <Text dimColor> · {extra}</Text>}
      </Text>
    )
    const contextSegment = usage
      ? meter('context', 'Kontext', usage.context.usedPercent, `${compactNumber(usage.context.tokens)}/${compactNumber(usage.context.window)}`)
      : null
    const five = usage?.fiveHour ?? null
    const fiveExtra = five === null || five.resetAt === null || t <= 0 ? null : five.resetAt <= t ? 'Reset fällig' : duration(five.resetAt - t)
    const fiveSegment = five ? meter('five-hour', '5h', five.usedPercent, fiveExtra) : null
    const week = usage?.week ?? null
    const weekSegment = week ? (
      <Text key="week">
        <Text dimColor>Woche </Text>
        <Text color={toneFor(week.usedPercent)}>{percentText(week.usedPercent)}</Text>
      </Text>
    ) : null
    const costSegment =
      usage && usage.costUsd !== null ? (
        <Text key="cost" dimColor>
          {usage.costUsd.toFixed(2).replace('.', ',')} $
        </Text>
      ) : null
    const meters = [contextSegment, fiveSegment, weekSegment, costSegment].filter(segment => segment !== null)

    const isAlert = !busy && !isCompacted && !canKeepWarm() && left > 0 && left <= WARN_MINUTES * 60_000

    const own = (
      <Box flexDirection="column" paddingX={1} gap={air}>
        {isAlert && (
          <Text color="red" bold wrap="truncate-end">
            ▲ Cache-Ablauf in {duration(left)} · weiterschreiben, „Warm halten“ einschalten oder komprimieren
          </Text>
        )}
        {/* Status left, controls right; on a narrow body the controls wrap below. */}
        <Box flexWrap="wrap" justifyContent="space-between" alignItems="center" columnGap={2} rowGap={air}>
          {cacheSegment}
          <Box columnGap={1}>
            {!busy && last !== null && <Button key="compact" label="Komprimieren" onPress={() => void compactNow($)} />}
            <Button
              key="auto-compact"
              label={`${settings.autoCompact ? '☑' : '☐'} Auto-Compact`}
              dimColor={!settings.autoCompact}
              onPress={() => void saveSettings($, { ...settings, autoCompact: !settings.autoCompact })}
            />
            <Button
              key="keep-warm"
              label={`${settings.keepWarm ? '☑' : '☐'} Warm halten`}
              dimColor={!settings.keepWarm}
              onPress={() => {
                warm = { count: 0, lastCacheRead: null, error: null }
                void saveSettings($, { ...settings, keepWarm: !settings.keepWarm })
              }}
            />
          </Box>
        </Box>
        {meters.length > 0 && (
          <Box flexWrap="wrap" columnGap={3}>
            {meters}
          </Box>
        )}
      </Box>
    )

    if (!others) return own
    return (
      <Box flexDirection="column">
        {others}
        {own}
      </Box>
    )
  })
}
