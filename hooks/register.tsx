import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { SessionInfo, Snapshot } from '../types'

const PANE = 'session-times'
const TITLE = 'Сессии'
const COMMAND = 'session-times'
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
  shape: 'snapshot-3',
})

const STATE_LABELS: Record<string, string> = {
  working: 'работает',
  blocked: 'ждёт вас',
  done: 'готово',
  stopped: 'стоп',
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "40 с", "12 мин", "5 ч", "3 дн": one unit, coarse enough to read at a glance. */
export const formatAgo = (ms: number): string => {
  if (ms < MINUTE) return `${Math.max(0, Math.round(ms / 1000))} с`
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} мин`
  if (ms < 2 * DAY) return `${Math.floor(ms / HOUR)} ч`
  return `${Math.floor(ms / DAY)} дн`
}

/** "45 с", "12 мин", "2 ч 05 мин": durations keep minutes once past an hour. */
export const formatDuration = (ms: number): string => {
  if (ms < MINUTE) return `${Math.round(ms / 1000)} с`
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} мин`
  const hours = Math.floor(ms / HOUR)
  const minutes = Math.floor((ms % HOUR) / MINUTE)
  return `${hours} ч ${String(minutes).padStart(2, '0')} мин`
}

const fit = (text: string, width: number): string =>
  text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text.padEnd(width)

const COLUMNS = { state: 9, started: 12, active: 12, talked: 14 } as const
const FIXED = COLUMNS.state + COLUMNS.started + COLUMNS.active + COLUMNS.talked

// the full-width transcript table has room for a wider gap after the start date
const WIDE_STARTED_EXTRA = 4

const row = (
  name: string,
  state: string,
  started: string,
  active: string,
  talked: string,
  nameWidth: number,
  startedExtra = 0,
) =>
  fit(name, nameWidth) +
  fit(state, COLUMNS.state) +
  fit(started, COLUMNS.started + startedExtra) +
  fit(active, COLUMNS.active) +
  talked.padStart(COLUMNS.talked - 1)

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
export const groupByProject = (sessions: readonly SessionInfo[]): ProjectGroup[] => {
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
    const label = isShared && parts.length > 1 ? parts.slice(-2).join('/') : name || 'без папки'
    return { project, label, sessions: list }
  })
}

const sessionWord = (n: number) => {
  const tens = n % 100
  const ones = n % 10
  if (tens >= 11 && tens <= 14) return 'сессий'
  if (ones === 1) return 'сессия'
  if (ones >= 2 && ones <= 4) return 'сессии'
  return 'сессий'
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
    return <Text dimColor>Собираю данные…</Text>
  }

  const nameWidth = Math.max(12, width - FIXED - startedExtra - INDENT.length)
  const groups = groupByProject(snap.sessions)
  const total = snap.sessions.length

  return (
    <Box flexDirection="column">
      <Text dimColor>
        {total} {sessionWord(total)} в {groups.length} проектах · обновлено {snap.takenLabel}
      </Text>
      {snap.error !== null && <Text color="red">Ошибка сбора: {snap.error}</Text>}
      <Text bold wrap="truncate">
        {INDENT + row('Сессия', 'Статус', 'Запущена', 'Активно', 'Общались', nameWidth, startedExtra)}
      </Text>
      {groups.map(g => (
        <Box flexDirection="column">
          <Text> </Text>
          <Text wrap="truncate">
            <Text bold>{g.label}</Text>
            <Text dimColor>
              {'  '}
              {g.sessions.length} {sessionWord(g.sessions.length)}
            </Text>
          </Text>
          {g.sessions.map(s => (
            <Text wrap="truncate" dimColor={s.state === 'done' || s.state === 'stopped'}>
              {INDENT +
                row(
                  s.name,
                  STATE_LABELS[s.state] ?? s.state,
                  s.createdLabel,
                  formatDuration(s.workMs),
                  s.lastHumanAtMs === null ? '—' : `${formatAgo(snap.takenAtMs - s.lastHumanAtMs)} назад`,
                  nameWidth,
                  startedExtra,
                )}
            </Text>
          ))}
        </Box>
      ))}
      <Text> </Text>
      <Text dimColor wrap="wrap">
        Активно: время, когда в сессии шла работа или переписка, без пауз длиннее 5 минут. Общались: когда вы последний раз писали в сессию. {footer}
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Таблица сессий по проектам на всю ширину: запуск, активная работа, последнее общение (pane или panel — боковой панелью)',
    })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    if (PANE_ARGS.has(e.args.trim().toLowerCase())) {
      // focus: the pane takes the keyboard at once; again on an open pane focuses it
      // closeOnEscape: Esc closes the pane instead of only handing the keys back
      await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true, columns: PANE_COLUMNS })
      isPaneOpen = true
      await keepRefreshing($)
      return { text: 'Панель «Сессии» открыта сбоку и в фокусе: стрелки листают, r обновляет, Esc или x закрывает.' }
    }
    // a fresh id each time, so the table lands at the end of the transcript
    await $.ui.place({ id: `table-${await $.clock.now()}` })
    await keepRefreshing($)
    return { text: 'Таблица сессий ниже, обновляется каждые 30 секунд в течение 15 минут.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) isPaneOpen = false
    return next(e)
  })

  on('ui.render', { component: 'Placed' }, async ($, e, next) => {
    if (e.props.plugin !== 'session-times' || !e.props.id.startsWith('table-')) return next(e)
    const width = e.viewport?.columns ?? 120
    return drawTable($, e, width, '/session-times — новая таблица, /session-times pane или /session-times panel — боковой панелью.', WIDE_STARTED_EXTRA)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Box>
          <Button key="refresh" label="Обновить" hotkey="r" onPress={() => refresh($)} />
          <Text> </Text>
          <Button key="close" label="Закрыть" hotkey="x" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
        {await drawTable($, e, e.props.bodyColumns, 'Esc или x — закрыть панель, r — обновить, Tab — перейти между кнопками.')}
      </Box>
    )
  })
}
