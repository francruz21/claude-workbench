// The unread mail Orca types into the conductor's prompt as a block of its own
// ("--- Orchestration Messages (N) ---"). A heartbeat says a child is alive and
// nothing else: one per turn costs context with no information, so they are
// taken out of the block and kept for the pane. Pure, no `$`.

const HEADER = /^--- Orchestration Messages \(\d+\) ---\s*$/
const FROM = /^──── From: .*\((term_[^)\s]+)\) \(([a-z_]+)\) ────\s*$/
const CLOSE = /^---\s*$/

export type Injected = { handle: string; type: string; lines: string[] }

// The messages of an Orca block, or null when the text is anything else: a
// person's prompt is never taken for one.
export function parseInjected(text: string): Injected[] | null {
  const lines = text.trim().split('\n')
  if (lines.length < 3 || !HEADER.test(lines[0] ?? '') || !CLOSE.test(lines[lines.length - 1] ?? '')) return null

  const messages: Injected[] = []
  for (const line of lines.slice(1, -1)) {
    const from = line.match(FROM)
    if (from) {
      messages.push({ handle: from[1] ?? '', type: from[2] ?? '', lines: [line] })
    } else if (messages.length > 0) {
      messages[messages.length - 1]?.lines.push(line)
    } else if (line.trim() !== '') {
      return null
    }
  }

  return messages.length > 0 ? messages : null
}

export type Filtered = {
  // The block without its heartbeats; null when nothing else was in it.
  text: string | null
  // The handles whose heartbeat was taken out.
  heartbeats: string[]
}

// The text to let through and the heartbeats it carried, or null when the text
// is not an Orca block (it goes through untouched).
export function withoutHeartbeats(text: string): Filtered | null {
  const messages = parseInjected(text)
  if (messages === null) return null
  const heartbeats = messages.filter(m => m.type === 'heartbeat').map(m => m.handle)
  if (heartbeats.length === 0) return { text, heartbeats }
  const kept = messages.filter(m => m.type !== 'heartbeat')
  if (kept.length === 0) return { text: null, heartbeats }

  const body = kept.flatMap(m => m.lines).join('\n')

  return { text: `--- Orchestration Messages (${kept.length}) ---\n${body}\n---`, heartbeats }
}
