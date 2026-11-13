import type { PluginOptions } from 'claude-code'

export type Lang = 'en' | 'ru'

/** Every text the table, the pane and the commands show, per language. */
export type Strings = {
  tableCommandDescription: string
  paneCommandDescription: string
  paneTitle: string
  paneOpened: string
  tableOpened: string
  collecting: string
  summary: (sessions: number, projects: number, updated: string) => string
  collectError: (error: string) => string
  columns: { name: string; state: string; started: string; active: string; talked: string }
  states: Record<string, string>
  sessionCount: (n: number) => string
  noFolder: string
  ago: (span: string) => string
  never: string
  legend: string
  tableFooter: string
  paneFooter: string
  refresh: string
  close: string
  /** "2026-11-13 16:23" (local time) as shown in the Started column. */
  startedLabel: (local: string) => string
  units: { second: string; minute: string; hour: string; day: string }
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const splitLocal = (local: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})$/.exec(local)
  if (!match) return null
  const [, , month = '', day = '', time = ''] = match
  return { month, day, time }
}

/** Russian plural: 1 сессия, 3 сессии, 5 сессий, 21 сессия, 11 сессий. */
const ruPlural = (n: number, one: string, few: string, many: string) => {
  const tens = n % 100
  const ones = n % 10
  if (tens >= 11 && tens <= 14) return many
  if (ones === 1) return one
  if (ones >= 2 && ones <= 4) return few
  return many
}

const en: Strings = {
  tableCommandDescription: 'Full-width table of background sessions by project: started, active time, last talk',
  paneCommandDescription: 'The same table in a side pane (like /session-times pane or panel)',
  paneTitle: 'Sessions',
  paneOpened: 'Sessions pane is open and focused: arrows scroll, r refreshes, Esc or x closes.',
  tableOpened: 'Session table below, refreshing every 30 seconds for 15 minutes.',
  collecting: 'Collecting data…',
  summary: (sessions, projects, updated) =>
    `${sessions} ${sessions === 1 ? 'session' : 'sessions'} in ${projects} ${projects === 1 ? 'project' : 'projects'} · updated ${updated}`,
  collectError: error => `Collection failed: ${error}`,
  columns: { name: 'Session', state: 'Status', started: 'Started', active: 'Active', talked: 'Last talk' },
  states: { working: 'working', blocked: 'needs you', done: 'done', stopped: 'stopped' },
  sessionCount: n => `${n} ${n === 1 ? 'session' : 'sessions'}`,
  noFolder: 'no folder',
  ago: span => `${span} ago`,
  never: '—',
  legend:
    'Active: time the session was being worked on or talked to, not counting pauses over 5 minutes. Last talk: when you last wrote to the session.',
  tableFooter: '/session-times for a new table; /session-times-pane, /session-times pane or panel for the side pane.',
  paneFooter: 'Esc or x closes the pane, r refreshes, Tab moves between buttons.',
  refresh: 'Refresh',
  close: 'Close',
  startedLabel: local => {
    const parts = splitLocal(local)
    if (!parts) return local
    const month = MONTHS_EN[Number(parts.month) - 1] ?? parts.month
    return `${month} ${Number(parts.day)} ${parts.time}`
  },
  units: { second: 's', minute: 'min', hour: 'h', day: 'd' },
}

const ru: Strings = {
  tableCommandDescription: 'Таблица сессий по проектам на всю ширину: запуск, активная работа, последнее общение',
  paneCommandDescription: 'То же в боковой панели (как /session-times pane или panel)',
  paneTitle: 'Сессии',
  paneOpened: 'Панель «Сессии» открыта сбоку и в фокусе: стрелки листают, r обновляет, Esc или x закрывает.',
  tableOpened: 'Таблица сессий ниже, обновляется каждые 30 секунд в течение 15 минут.',
  collecting: 'Собираю данные…',
  summary: (sessions, projects, updated) =>
    `${sessions} ${ruPlural(sessions, 'сессия', 'сессии', 'сессий')} в ${projects} ${ruPlural(projects, 'проекте', 'проектах', 'проектах')} · обновлено ${updated}`,
  collectError: error => `Ошибка сбора: ${error}`,
  columns: { name: 'Сессия', state: 'Статус', started: 'Запущена', active: 'Активно', talked: 'Общались' },
  states: { working: 'работает', blocked: 'ждёт вас', done: 'готово', stopped: 'стоп' },
  sessionCount: n => `${n} ${ruPlural(n, 'сессия', 'сессии', 'сессий')}`,
  noFolder: 'без папки',
  ago: span => `${span} назад`,
  never: '—',
  legend:
    'Активно: время, когда в сессии шла работа или переписка, без пауз длиннее 5 минут. Общались: когда вы последний раз писали в сессию.',
  tableFooter: '/session-times — новая таблица; /session-times-pane, /session-times pane или panel — боковой панелью.',
  paneFooter: 'Esc или x — закрыть панель, r — обновить, Tab — перейти между кнопками.',
  refresh: 'Обновить',
  close: 'Закрыть',
  startedLabel: local => {
    const parts = splitLocal(local)
    return parts ? `${parts.day}.${parts.month} ${parts.time}` : local
  },
  units: { second: 'с', minute: 'мин', hour: 'ч', day: 'дн' },
}

export const STRINGS: Record<Lang, Strings> = { en, ru }

/** The language the person chose in the plugin's options; English otherwise. */
export function langOf(options: PluginOptions): Lang {
  return options['language'] === 'ru' ? 'ru' : 'en'
}
