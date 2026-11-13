import { expect, test } from 'claude-code/testing'

import { formatAgo, formatDuration, groupByProject } from './register'

const NOW = Date.UTC(2026, 10, 13, 12, 0, 0)
const MIN = 60_000

const COLLECTED = {
  nowLabel: '15:00:00',
  sessions: [
    {
      id: 'old',
      name: 'old finished session',
      state: 'done',
      project: '/p/alpha',
      createdAtMs: NOW - 10 * 24 * 60 * MIN,
      createdLabel: '03.11 10:00',
      workMs: 125 * MIN,
      lastHumanAtMs: NOW - 3 * 24 * 60 * MIN,
    },
    {
      id: 'alpha-recent',
      name: 'alpha recent session',
      state: 'working',
      project: '/p/alpha',
      createdAtMs: NOW - 60 * MIN,
      createdLabel: '13.11 14:00',
      workMs: 40 * MIN,
      lastHumanAtMs: NOW - 20 * MIN,
    },
    {
      id: 'fresh',
      name: 'fresh waiting session',
      state: 'blocked',
      project: '/p/beta',
      createdAtMs: NOW - 30 * MIN,
      createdLabel: '13.11 14:30',
      workMs: 12 * MIN,
      lastHumanAtMs: NOW - 5 * MIN,
    },
  ],
}

const PANE = {
  plugin: 'session-times',
  component: 'Pane',
  requestId: 'session-times',
  props: {
    title: 'Сессии',
    isFocused: false,
    bodyColumns: 90,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('formatting picks one readable unit', () => {
  expect(formatAgo(40_000)).toBe('40 с')
  expect(formatAgo(12 * MIN)).toBe('12 мин')
  expect(formatAgo(5 * 60 * MIN)).toBe('5 ч')
  expect(formatAgo(3 * 24 * 60 * MIN)).toBe('3 дн')
  expect(formatDuration(45_000)).toBe('45 с')
  expect(formatDuration(125 * MIN)).toBe('2 ч 05 мин')
})

test('the command opens a pane listing sessions, most recently talked first', async ($, on) => {
  on('command.register', () => ({ value: { command: 'session-times' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: NOW }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: JSON.stringify(COLLECTED), stderr: '' },
  }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-times', args: 'pane' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const header = await ui.find({ type: 'Text', text: /3 сессии в 2 проектах · обновлено 15:00:00/ })
    expect(header).toBeDefined()

    const fresh = await ui.find({ type: 'Text', text: /fresh waiting session/ })
    expect(fresh?.text).toMatch(/ждёт вас\s+13\.11 14:30\s+12 мин\s+5 мин назад/)

    const old = await ui.find({ type: 'Text', text: /old finished session/ })
    expect(old?.text).toMatch(/готово\s+03\.11 10:00\s+2 ч 05 мин\s+3 дн назад/)

    // beta holds the most recent talk, so it comes first; alpha's own rows go newest first
    const lines = await ui.findAll({ type: 'Text', text: /^(alpha|beta)$|session\s/ })
    expect(lines.map(r => r.text.trim().slice(0, 12))).toEqual([
      'beta', 'fresh waitin', 'alpha', 'alpha recent', 'old finished',
    ])
    const bold = await ui.find({ type: 'Text', text: /^beta$/ })
    expect(bold?.props.bold).toBe(true)
    await ui.unmount()
  }
})

test('a failed collection shows the error instead of crashing', async ($, on) => {
  on('command.register', () => ({ value: { command: 'session-times' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: NOW }))
  on('process.run', () => ({
    value: { exitCode: 1, stdout: '', stderr: 'Traceback\nboom: broken' },
  }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-times', args: 'pane' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const error = await ui.find({ type: 'Text', text: /Ошибка сбора/ })
  expect(error?.text).toContain('boom: broken')
  await ui.unmount()
})

test('folders that share a name are told apart by their parent', () => {
  const base = { state: 'done', createdAtMs: 0, createdLabel: '', workMs: 0, lastHumanAtMs: null }
  const groups = groupByProject([
    { ...base, id: 'a', name: 'a', project: '/x/app' },
    { ...base, id: 'b', name: 'b', project: '/y/app' },
    { ...base, id: 'c', name: 'c', project: '/y/tool' },
  ])
  expect(groups.map(g => g.label).sort()).toEqual(['tool', 'x/app', 'y/app'])
})

test('the plain command puts a full-width table into the transcript', async ($, on) => {
  on('command.register', () => ({ value: { command: 'session-times' } }))
  on('ui.place', () => ({ value: {} }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: {} }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: JSON.stringify(COLLECTED), stderr: '' },
  }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const answer = await $.command.run({ command: 'session-times', args: '' })
  expect(JSON.stringify(answer)).toContain('Таблица сессий ниже')

  const ui = await $.ui.mount({
    plugin: 'session-times',
    surface: 'terminal',
    component: 'Placed',
    props: { id: `table-${NOW}`, plugin: 'session-times' },
    viewport: { columns: 200, rows: 50 },
  })
  const fresh = await ui.find({ type: 'Text', text: /fresh waiting session/ })
  // 200 columns leave the name column far wider than the 45% dock could
  expect(fresh?.text.length).toBeGreaterThan(150)
  expect(fresh?.text).toMatch(/fresh waiting session {60,}ждёт вас/)
  // wide view: five spaces between the start date and the active time
  expect(fresh?.text).toMatch(/13\.11 14:30 {5}12 мин/)
  expect(await ui.find({ type: 'Text', text: /^beta$/ })).toBeDefined()
  await ui.unmount()
})

test('the close button closes the pane from the keyboard', async ($, on) => {
  const closed: string[] = []
  const opened: unknown[] = []
  on('command.register', () => ({ value: { command: 'session-times' } }))
  on('ui.open', (_, e) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: {} }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: JSON.stringify(COLLECTED), stderr: '' },
  }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-times', args: 'pane' })

  expect(opened).toEqual([expect.objectContaining({ focus: true, closeOnEscape: true })])

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const button = await ui.find({ key: 'close' })
  expect(button?.props.hotkey).toBe('x')
  await ui.press({ key: 'close' })
  expect(closed).toEqual(['session-times'])
  await ui.unmount()
})
