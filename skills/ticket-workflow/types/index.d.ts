// One message of `orca-ide orchestration inbox --json`.
export type Message = {
  id: string
  from_handle: string
  to_handle: string
  type: string
  read: number | boolean
  subject?: string
  body?: string
}

// Where one repo of the worktree stands, when it sits on a work branch.
export type GitState = {
  repo: string
  branch: string
  unpublished: number
  dirty: number
  isPublished: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'ticket-workflow': {
      // This session runs ticket-workflow: it loaded the skill, or `/hijo on`.
      isArmed: boolean
      // A coordinator dispatched a task to this terminal.
      isDispatched: boolean
      handle: string | null
      // The handle the conductor last wrote from.
      conductor: string | null
      repos: GitState[]
      // Message ids already woken for, or already read back after an `ask`.
      woken: string[]
      // prompt.compose ran for this child: the anchor reaches the system prompt
      // there, and stops riding on each prompt.
      isComposed: boolean
    }
  }
}
