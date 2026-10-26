export type Gate = 'GREEN' | 'RED' | 'PENDING' | 'SINCHECKS' | 'ERROR'

export type Pr = { repo: string; number: number; gate: Gate | null }

// One open ticket of the conductor ledger, as the pane draws it.
export type Routing = {
  enabled: boolean
  conductor: string | null
  child: string | null
  childHeavy: string | null
  // Models no role may run on (`fable` matches any Fable id); applies on or off.
  forbidden: string[]
}

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
      // This session's Orca terminal handle; it changes when the conductor is reopened.
      handle: string | null
      // `choices.modelRouting` of the capabilities file, re-read on every poll.
      routing: Routing
      // The handles this session sent a `/model` to, and which one.
      modelSentTo: Record<string, string>
      // An arming not yet followed by the conductor's own `/model`.
      isModelPending: boolean
      // When each child's last heartbeat arrived, by handle (ms); shown in the pane, never injected.
      heartbeats: Record<string, number>
      // Orca injected mail into this session: the injection rules over `check --wait`.
      isInjected: boolean
      // prompt.compose ran for this conductor: the anchor reaches the system
      // prompt there, and stops riding on each prompt.
      isComposed: boolean
      // Each open ticket's child, as last measured in Orca ("trabajando", "PARADO hace 6 min").
      health: Record<string, string>
      // Nudges typed into a stalled child, by handle: how many this stall, and when the last.
      childNudges: Record<string, { count: number; at: number }>
    }
  }
}
