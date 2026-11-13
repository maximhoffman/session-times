import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { SessionInfo, Snapshot } from '../types'

import { STRINGS, langOf } from './strings'
import type { Strings } from './strings'

const PANE = 'session-times'
const COMMAND = 'session-times'
// a command of its own, so the side pane shows up in the typeahead list
const PANE_COMMAND = 'session-times-pane'
const REFRESH_MS = 30_000
// the transcript table keeps refreshing this long after the last command
const AUTO_STOP_MS = 15 * 60_000
// asks for the widest dock; the engine caps it at 45% of the terminal
const PANE_COLUMNS = 1000
// either word opens the side pane
const PANE_ARGS = new Set(['pane', 'panel'])

// Change the tag when Snapshot's fields change: it declines what an earlier
// version stored, which outlives a reload.
const snapshot = atom({ plugin: 'session-times', key: 'snapshot' } as const, null, {
  shape: 'snapshot-4',
})

// The texts of the language the person chose; set when the module registers.
let t: Strings = STRINGS.en

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

type Units = Strings['units']

/** "40 s", "12 min", "5 h", "3 d": one unit, coarse enough to read at a glance. */
export const formatAgo = (ms: number, u: Units): string => {
  if (ms < MINUTE) return `${Math.max(0, Math.round(ms / 1000))} ${u.second}`
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} ${u.minute}`
  if (ms < 2 * DAY) return `${Math.floor(ms / HOUR)} ${u.hour}`
  return `${Math.floor(ms / DAY)} ${u.day}`
}

/** "45 s", "12 min", "2 h 05 min": durations keep minutes once past an hour. */
export const formatDuration = (ms: number, u: Units): string => {
  if (ms < MINUTE) return `${Math.round(ms / 1000)} ${u.second}`
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} ${u.minute}`
  const hours = Math.floor(ms / HOUR)
  const minutes = Math.floor((ms % HOUR) / MINUTE)
  return `${hours} ${u.hour} ${String(minutes).padStart(2, '0')} ${u.minute}`
}

const fit = (text: string, width: number): string =>
  text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text.padEnd(width)

type Columns = { state: number; started: number; active: number; talked: number }

/** Column widths for a language: the status column fits its longest label. */
const columnsFor = (s: Strings): Columns => ({
  state: Math.max(s.columns.state.length, ...Object.values(s.states).map(l => l.length)) + 2,
  started: s.startedLabel('2026-12-31 23:59').length + 1,
  active: 12,
  talked: 14,
})

const fixedWidth = (c: Columns) => c.state + c.started + c.active + c.talked

// the full-width transcript table has room for a wider gap after the start date
const WIDE_STARTED_EXTRA = 4

const row = (
  c: Columns,
  name: string,
  state: string,
  started: string,
  active: string,
  talked: string,
  nameWidth: number,
  startedExtra = 0,
) =>
  fit(name, nameWidth) +
  fit(state, c.state) +
  fit(started, c.started + startedExtra) +
  fit(active, c.active) +
  talked.padStart(c.talked - 1)

const lastTouch = (s: SessionInfo) => s.lastHumanAtMs ?? s.createdAtMs

const byLastTalk = (a: SessionInfo, b: SessionInfo) => lastTouch(b) - lastTouch(a)

const INDENT = '  '

export type ProjectGroup = { project: string; label: string; sessions: SessionInfo[] }

const baseName = (path: string) => path.replace(/\/+$/, '').split('/').pop() || path

/**
 * Sessions grouped by the folder they were started in. Groups and the
 * sessions inside them go from the most recently talked to the least.
 * Two folders with the same name are told apart by their parent folder.
 */
export const groupByProject = (sessions: readonly SessionInfo[], noFolder = 'no folder'): ProjectGroup[] => {
  const groups = new Map<string, SessionInfo[]>()
  for (const s of [...sessions].sort(byLastTalk)) {
    const list = groups.get(s.project)
    if (list) list.push(s)
    else groups.set(s.project, [s])
  }
  const names = [...groups.keys()].map(baseName)
  return [...groups.entries()].map(([project, list]) => {
    const name = baseName(project)
    const isShared = names.filter(n => n === name).length > 1
    const parts = project.split('/').filter(Boolean)
    const label = isShared && parts.length > 1 ? parts.slice(-2).join('/') : name || noFolder
    return { project, label, sessions: list }
  })
}

let isRefreshing = false

async function refresh($: EngineInterface): Promise<void> {
  if (isRefreshing) return
  isRefreshing = true
  try {
    const script = `${$.plugin.root}/bin/session_times.py`
    const ran = await $.process.run(['python3', '-I', script], { timeoutMs: 60_000 })
    const takenAtMs = await $.clock.now()
    if (ran.exitCode !== 0) {
      const error = ran.stderr.trim().split('\n').slice(-1)[0] || `exit ${ran.exitCode}`
      await update($, snapshot, prev => ({ takenAtMs, takenLabel: prev?.takenLabel ?? '', sessions: prev?.sessions ?? [], error }))
      return
    }
    const parsed = JSON.parse(ran.stdout) as { nowLabel: string; sessions: SessionInfo[] }
    const next: Snapshot = { takenAtMs, takenLabel: parsed.nowLabel, sessions: parsed.sessions, error: null }
    await update($, snapshot, () => next)
  } catch (err) {
    const takenAtMs = await $.clock.now()
    const error = err instanceof Error ? err.message : String(err)
    await update($, snapshot, prev => ({ takenAtMs, takenLabel: prev?.takenLabel ?? '', sessions: prev?.sessions ?? [], error }))
  } finally {
    isRefreshing = false
  }
}

type RenderInput = Parameters<EngineInterface['ui']['resolve']>[0]

/** The whole table, drawn the same in the side pane and in the transcript. */
async function drawTable($: EngineInterface, e: RenderInput, width: number, footer: string, startedExtra = 0) {
  const { Box, Text } = $.ui.resolve(e)
  const snap = await read($, snapshot)

  if (snap === null) {
    return <Text dimColor>{t.collecting}</Text>
  }

  const cols = columnsFor(t)
  const nameWidth = Math.max(12, width - fixedWidth(cols) - startedExtra - INDENT.length)
  const groups = groupByProject(snap.sessions, t.noFolder)
  const head = t.columns

  return (
    <Box flexDirection="column">
      <Text dimColor>{t.summary(snap.sessions.length, groups.length, snap.takenLabel)}</Text>
      {snap.error !== null && <Text color="red">{t.collectError(snap.error)}</Text>}
      <Text bold wrap="truncate">
        {INDENT + row(cols, head.name, head.state, head.started, head.active, head.talked, nameWidth, startedExtra)}
      </Text>
      {groups.map(g => (
        <Box flexDirection="column">
          <Text> </Text>
          <Text wrap="truncate">
            <Text bold>{g.label}</Text>
            <Text dimColor>
              {'  '}
              {t.sessionCount(g.sessions.length)}
            </Text>
          </Text>
          {g.sessions.map(s => (
            <Text wrap="truncate" dimColor={s.state === 'done' || s.state === 'stopped'}>
              {INDENT +
                row(
                  cols,
                  s.name,
                  t.states[s.state] ?? s.state,
                  t.startedLabel(s.createdLocal),
                  formatDuration(s.workMs, t.units),
                  s.lastHumanAtMs === null ? t.never : t.ago(formatAgo(snap.takenAtMs - s.lastHumanAtMs, t.units)),
                  nameWidth,
                  startedExtra,
                )}
            </Text>
          ))}
        </Box>
      ))}
      <Text> </Text>
      <Text dimColor wrap="wrap">
        {t.legend} {footer}
      </Text>
    </Box>
  )
}

let timer: Timer | null = null
let isPaneOpen = false
let lastAskedAtMs = 0

// One refresh loop serves both views; the transcript table alone stops it
// AUTO_STOP_MS after the last command, an open pane keeps it going.
async function keepRefreshing($: EngineInterface): Promise<void> {
  lastAskedAtMs = await $.clock.now()
  void refresh($)
  timer ??= $.clock.every(REFRESH_MS, () => {
    void (async () => {
      const now = await $.clock.now()
      if (!isPaneOpen && now - lastAskedAtMs > AUTO_STOP_MS) {
        timer?.cancel()
        timer = null
        return
      }
      await refresh($)
    })()
  })
}

async function openPane($: EngineInterface): Promise<{ text: string }> {
  // focus: the pane takes the keyboard at once; again on an open pane focuses it
  // closeOnEscape: Esc closes the pane instead of only handing the keys back
  await $.ui.open({ id: PANE, title: t.paneTitle, focus: true, closeOnEscape: true, columns: PANE_COLUMNS })
  isPaneOpen = true
  await keepRefreshing($)
  return { text: t.paneOpened }
}

export const register: Register = (on, options) => {
  t = STRINGS[langOf(options)]

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: t.tableCommandDescription,
      argumentHint: '[pane|panel]',
    })
    await $.command.register({
      name: PANE_COMMAND,
      description: t.paneCommandDescription,
    })
    return next(e)
  })

  on('command.run', { command: PANE_COMMAND }, async $ => openPane($))

  on('command.run', { command: COMMAND }, async ($, e) => {
    if (PANE_ARGS.has(e.args.trim().toLowerCase())) return openPane($)
    // a fresh id each time, so the table lands at the end of the transcript
    await $.ui.place({ id: `table-${await $.clock.now()}` })
    await keepRefreshing($)
    return { text: t.tableOpened }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) isPaneOpen = false
    return next(e)
  })

  on('ui.render', { component: 'Placed' }, async ($, e, next) => {
    if (e.props.plugin !== 'session-times' || !e.props.id.startsWith('table-')) return next(e)
    const width = e.viewport?.columns ?? 120
    return drawTable($, e, width, t.tableFooter, WIDE_STARTED_EXTRA)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Box>
          <Button key="refresh" label={t.refresh} hotkey="r" onPress={() => refresh($)} />
          <Text> </Text>
          <Button key="close" label={t.close} hotkey="x" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
        {await drawTable($, e, e.props.bodyColumns, t.paneFooter)}
      </Box>
    )
  })
}
