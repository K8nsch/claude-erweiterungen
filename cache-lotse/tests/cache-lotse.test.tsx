import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const BAND = { component: 'AbovePrompt' } as const
const BAND_PROPS = (bodyColumns: number) =>
  ({ hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10, contentRows: 0 } }) as never
const START = Date.parse('2026-11-16T12:00:00Z')

// Engine stand-ins shared by every test; returns what the plugin did.
function engine(on: Parameters<TestBody>[1], stored?: Record<string, unknown>) {
  const clock = mock.clock(on, { now: START })
  const did = { toasts: [] as string[], sounds: [] as string[], compacts: [] as string[], forks: [] as string[], commands: [] as string[], cacheRead: 120_000, isHeadless: false,
    fiveHour: { percentUsed: 5, resetsAt: '2026-11-16T14:39:00Z' } }
  mock.store(on, stored)
  on('session.messages', () => ({ value: { messages: [{ role: 'user', text: 'hallo', toolUses: [] }] } }) as never)
  on('session.id', () => ({ value: 's1' }) as never)
  on('audio.play', ($, e) => {
    did.sounds.push(String((e.clip as { asset?: string }).asset))
    return { value: undefined } as never
  })
  on('ui.toast', ($, e) => {
    did.toasts.push(String((e as { text: string }).text))
    return { value: undefined } as never
  })
  on('command.run', ($, e) => {
    did.commands.push(String((e as { command: string }).command))
    return { text: '' } as never
  })
  on('session.compact', ($, e) => {
    // The desktop app hosts sessions headless, where $.session.compact is refused.
    if (did.isHeadless) throw new Error('$.session.compact: not available in a headless (-p / SDK) session yet')
    did.compacts.push('compact')
    return { messages: [{ role: 'user' as const, text: 'Zusammenfassung', toolUses: [] }] }
  })
  on('model.fork', ($, e) => {
    did.forks.push(String((e as { prompt: string }).prompt))
    return {
      value: {
        isAnswered: true,
        text: 'ok',
        usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: did.cacheRead, cache_creation_input_tokens: 0 },
      },
    } as never
  })
  // What Claude Code itself draws above the prompt: nothing here.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 132_000, window: 1_000_000, percent: 13 },
      rateLimits: [
        { kind: 'five_hour', ...did.fiveHour },
        { kind: 'seven_day', percentUsed: 6 },
      ],
      cost: { usd: 11.32 },
    },
  }))
  return { clock, did }
}

async function answerOnce($: Parameters<TestBody>[0]): Promise<void> {
  await $.session.start({ cwd: '/tmp/x', surface: 'terminal', isInteractive: true } as never)
  await $.turn.start({ text: 'hallo', turnId: 't1' })
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
}

describe('cache-lotse', () => {
  test('zeigt Cache, Kontext, Limits und Kosten wie bisher', async ($, on) => {
    engine(on)
    await answerOnce($)
    for (const surface of ['terminal', 'desktop'] as const) {
      for (const columns of [80, 160]) {
        const ui = await $.ui.mount({ plugin: 'cache-lotse', surface, ...BAND, props: BAND_PROPS(columns) })
        expect(await ui.find({ type: 'Text', text: /1:00 h übrig/ }), 'cache').toBeDefined()
        expect(await ui.find({ type: 'Text', text: /13 %/ }), 'context percent').toBeDefined()
        expect(await ui.find({ type: 'Text', text: /132k\/1M/ }), 'context tokens').toBeDefined()
        expect(await ui.find({ type: 'Text', text: /5 % · 2:39 h/ }), '5h reset').toBeDefined()
        expect(await ui.find({ type: 'Text', text: /11,32 \$/ }), 'cost').toBeDefined()
        expect((await ui.find({ type: 'Button', key: 'auto-compact' }))?.text, 'auto-compact on by default').toContain('☑')
        expect((await ui.find({ type: 'Button', key: 'keep-warm' }))?.text, 'keep-warm off by default').toContain('☐')
        expect(await ui.find({ type: 'Button', key: 'compact' }), 'compact button always there').toBeDefined()
        await ui.unmount()
      }
    }
  })

  test('auto-compact kurz vor Ablauf, genau einmal, mit Warnung', async ($, on) => {
    const { clock, did } = engine(on)
    await answerOnce($)
    await clock.advance(56 * 60_000)
    expect(did.sounds).toEqual(['sounds/gong.wav'])
    expect(did.toasts.some(t => t.includes('Cache-Ablauf in'))).toBe(true)
    expect(did.compacts, 'not yet').toEqual([])
    await clock.advance(3 * 60_000 + 30_000)
    expect(did.compacts).toEqual(['compact'])
    await clock.advance(2 * 60_000)
    expect(did.compacts, 'once per cache window').toEqual(['compact'])
  })

  test('manuelles Komprimieren sperrt das automatische bis zur nächsten Antwort', async ($, on) => {
    const { clock, did } = engine(on)
    await answerOnce($)
    await clock.advance(30 * 60_000)
    const ui = await $.ui.mount({ plugin: 'cache-lotse', surface: 'desktop', ...BAND, props: BAND_PROPS(160) })
    await ui.press({ key: 'compact' })
    expect(did.compacts).toEqual(['compact'])
    expect(await ui.find({ type: 'Text', text: /komprimiert/ }), 'shows compacted').toBeDefined()
    await clock.advance(31 * 60_000)
    expect(did.compacts, 'no second, automatic compaction').toEqual(['compact'])
    expect(did.sounds, 'no warning for a compacted chat').toEqual([])
  })

  test('Desktop (headless): Komprimieren weicht auf den /compact-Befehl aus', async ($, on) => {
    const { clock, did } = engine(on)
    did.isHeadless = true
    await answerOnce($)
    const ui = await $.ui.mount({ plugin: 'cache-lotse', surface: 'desktop', ...BAND, props: BAND_PROPS(160) })
    await ui.press({ key: 'compact' })
    expect(did.commands, 'button').toEqual(['compact'])
    expect(did.toasts.some(t => t.includes('nicht möglich')), 'no error toast').toBe(false)
    expect(await ui.find({ type: 'Text', text: /komprimiert/ }), 'shows compacted').toBeDefined()
  })

  test('Desktop (headless): Auto-Compact weicht ebenfalls aus', async ($, on) => {
    const { clock, did } = engine(on)
    did.isHeadless = true
    await answerOnce($)
    await clock.advance(59 * 60_000 + 30_000)
    expect(did.commands).toEqual(['compact'])
  })

  test('Auto-Compact aus: nur Warnung, kein Komprimieren; Schalter bleibt gespeichert', async ($, on) => {
    const { clock, did } = engine(on)
    await answerOnce($)
    const ui = await $.ui.mount({ plugin: 'cache-lotse', surface: 'terminal', ...BAND, props: BAND_PROPS(160) })
    await ui.press({ key: 'auto-compact' })
    expect((await ui.find({ type: 'Button', key: 'auto-compact' }))?.text).toContain('☐')
    await clock.advance(61 * 60_000)
    expect(did.sounds).toEqual(['sounds/gong.wav'])
    expect(did.compacts).toEqual([])
    expect(await ui.find({ type: 'Text', text: /abgelaufen/ })).toBeDefined()
  })

  test('gespeicherte Schalter gelten nach Neuladen oder Fortsetzen', async ($, on) => {
    engine(on, { 'settings:s1': { autoCompact: false, keepWarm: true } })
    await answerOnce($)
    const ui = await $.ui.mount({ plugin: 'cache-lotse', surface: 'terminal', ...BAND, props: BAND_PROPS(160) })
    expect((await ui.find({ type: 'Button', key: 'auto-compact' }))?.text).toContain('☐')
    expect((await ui.find({ type: 'Button', key: 'keep-warm' }))?.text).toContain('☑')
  })

  test('5h-Limit wird nach dem Reset neu gelesen statt „Reset in 0 min“', async ($, on) => {
    const { clock, did } = engine(on)
    did.fiveHour = { percentUsed: 33, resetsAt: '2026-11-16T12:20:00Z' }
    await answerOnce($)
    const ui = await $.ui.mount({ plugin: 'cache-lotse', surface: 'desktop', ...BAND, props: BAND_PROPS(160) })
    expect(await ui.find({ type: 'Text', text: /33 %/ }), 'before reset').toBeDefined()
    // The window resets at 12:20; the engine then reports the new window.
    did.fiveHour = { percentUsed: 0, resetsAt: '2026-11-16T17:20:00Z' }
    await clock.advance(21 * 60_000)
    expect(await ui.find({ type: 'Text', text: /Reset in 0 min|Reset fällig/ }), 'no stale countdown').toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /33 %/ }), 'no stale percent').toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /0 % · 4:59 h/ }), 'new window').toBeDefined()
  })

  test('5h-Limit: „Reset fällig“, solange noch keine neuen Werte da sind', async ($, on) => {
    const { clock, did } = engine(on)
    did.fiveHour = { percentUsed: 33, resetsAt: '2026-11-16T12:20:00Z' }
    await answerOnce($)
    const ui = await $.ui.mount({ plugin: 'cache-lotse', surface: 'terminal', ...BAND, props: BAND_PROPS(160) })
    await clock.advance(21 * 60_000)
    expect(await ui.find({ type: 'Text', text: /Reset fällig/ })).toBeDefined()
  })

  test('Warm halten: höchstens zwei Auffrischungen, danach wie gewohnt', async ($, on) => {
    const { clock, did } = engine(on)
    await answerOnce($)
    const ui = await $.ui.mount({ plugin: 'cache-lotse', surface: 'desktop', ...BAND, props: BAND_PROPS(160) })
    await ui.press({ key: 'keep-warm' })

    // First refresh about two minutes before expiry; no warning, no compaction.
    await clock.advance(58 * 60_000 + 15_000)
    expect(did.forks.length).toBe(1)
    expect(did.sounds).toEqual([])
    expect(did.compacts).toEqual([])
    expect(await ui.find({ type: 'Text', text: /aufgefrischt 1\/2 \(120k aus Cache\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1:00 h übrig/ }), 'window starts over').toBeDefined()

    // Second refresh one window later.
    await clock.advance(58 * 60_000)
    expect(did.forks.length).toBe(2)

    // Third window: no more refreshes; warning and auto-compact as usual.
    await clock.advance(59 * 60_000 + 30_000)
    expect(did.forks.length).toBe(2)
    expect(did.sounds).toEqual(['sounds/gong.wav'])
    expect(did.compacts).toEqual(['compact'])
  })

  test('Warm halten meldet einen schon kalten Cache', async ($, on) => {
    const { clock, did } = engine(on)
    did.cacheRead = 0
    await answerOnce($)
    const ui = await $.ui.mount({ plugin: 'cache-lotse', surface: 'terminal', ...BAND, props: BAND_PROPS(80) })
    await ui.press({ key: 'keep-warm' })
    await clock.advance(58 * 60_000 + 15_000)
    expect(did.forks.length).toBe(1)
    expect(did.toasts.some(t => t.includes('schon kalt'))).toBe(true)
  })

  test('eine Antwort setzt den Zähler der Auffrischungen zurück', async ($, on) => {
    const { clock, did } = engine(on)
    await answerOnce($)
    const ui = await $.ui.mount({ plugin: 'cache-lotse', surface: 'desktop', ...BAND, props: BAND_PROPS(160) })
    await ui.press({ key: 'keep-warm' })
    await clock.advance(58 * 60_000 + 15_000)
    await clock.advance(58 * 60_000)
    expect(did.forks.length).toBe(2)
    await $.turn.start({ text: 'weiter', turnId: 't2' })
    await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't2', reason: 'answer' })
    await clock.advance(58 * 60_000 + 15_000)
    expect(did.forks.length).toBe(3)
  })
})
