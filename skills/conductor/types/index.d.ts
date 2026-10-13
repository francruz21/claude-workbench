export type Gate = 'GREEN' | 'RED' | 'PENDING' | 'SINCHECKS' | 'ERROR'

export type Pr = { repo: string; number: number; gate: Gate | null }

// One open ticket of the conductor ledger, as the pane draws it.
export type Row = {
  id: string
  name: string
  qaTurn: string | null
  prs: Pr[]
  isAnnounced: boolean
  // The worktree was already removed: open only until it is announced or closed by hand.
  isCleaned: boolean
  // The child's terminal handle, the address its messages come from.
  handle: string | null
  updatedAt: string | null
  lastNote: string | null
}

declare module 'claude-code' {
  interface PluginState {
    conductor: {
      // Absolute path of this workspace's ledger; null when the session is not a conductor's.
      ledger: string | null
      rows: Row[]
      // This session is the conductor: it loaded the skill, or `/tanda on`.
      isArmed: boolean
      // Inbox messages and announce-ready tickets already woken for.
      woken: string[]
      lastTurnAt: number
      idleNudges: number
    }
  }
}
