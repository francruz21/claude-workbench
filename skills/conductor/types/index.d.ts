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
  updatedAt: string | null
  lastNote: string | null
}

declare module 'claude-code' {
  interface PluginState {
    conductor: {
      // Absolute path of this workspace's ledger; null when the session is not a conductor's.
      ledger: string | null
      rows: Row[]
    }
  }
}
