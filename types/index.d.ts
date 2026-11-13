export type SessionInfo = {
  id: string
  name: string
  state: string
  /** Absolute folder the session was started in, worktrees folded into their repo. */
  project: string
  createdAtMs: number
  /** Local creation time as "YYYY-MM-DD HH:MM"; the module formats it per language. */
  createdLocal: string
  workMs: number
  lastHumanAtMs: number | null
}

export type Snapshot = {
  takenAtMs: number
  takenLabel: string
  sessions: SessionInfo[]
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'session-times': { snapshot: Shaped<Snapshot | null> }
  }
}
