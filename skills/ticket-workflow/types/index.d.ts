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
      // This session is a dispatched child: a coordinator dispatched it a task,
      // it loaded ticket-workflow, or `/hijo on`.
      isArmed: boolean
      // It runs ticket-workflow (the gates apply), not only a dispatched task such as a QA.
      isTicket: boolean
      // Skills it loads before any other tool: `choices.childSkills` plus the spec's `Skills:` line.
      requiredSkills: string[]
      // Skills it invoked, attempted or not.
      loadedSkills: string[]
      // A coordinator dispatched a task to this terminal.
      isDispatched: boolean
      handle: string | null
      // The superior: the conductor that dispatched the live task, or its accepted
      // successor after a rotation. Nobody else's word is an order.
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
