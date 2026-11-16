import { useMemo } from 'react'

/** Past this, colouring costs more than it gives: the text is shown plain. */
export const MAX_HIGHLIGHT_CHARS = 300_000

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],])/g

/**
 * JSON with syntax colours. Tolerant of a cut-off preview: whatever it cannot
 * read, such as an unterminated string at the end, is shown uncoloured.
 */
export function JsonText({ text }: { text: string }): React.JSX.Element {
  const parts = useMemo(() => {
    if (text.length > MAX_HIGHLIGHT_CHARS) return [text]
    const out: React.ReactNode[] = []
    let last = 0
    let k = 0
    for (const m of text.matchAll(TOKEN)) {
      const at = m.index
      if (at > last) out.push(text.slice(last, at))
      const [whole, str, colon, num, word, punct] = m
      if (str !== undefined && colon !== undefined) {
        out.push(
          <span key={k++} className="text-info">
            {str}
          </span>,
          <span key={k++} className="text-muted">
            {colon}
          </span>,
        )
      } else if (str !== undefined) {
        out.push(
          <span key={k++} className="text-success">
            {str}
          </span>,
        )
      } else if (num !== undefined) {
        out.push(
          <span key={k++} className="text-warning">
            {num}
          </span>,
        )
      } else if (word !== undefined) {
        out.push(
          <span key={k++} className="text-primary">
            {word}
          </span>,
        )
      } else if (punct !== undefined) {
        out.push(
          <span key={k++} className="text-muted">
            {punct}
          </span>,
        )
      }
      last = at + whole.length
    }
    if (last < text.length) out.push(text.slice(last))
    return out
  }, [text])
  return <>{parts}</>
}

/** The text pretty-printed when the whole of it is a JSON object or array; otherwise null. */
export function asJson(text: string): string | null {
  const trimmed = text.trim()
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return null
  if (trimmed.length > MAX_HIGHLIGHT_CHARS) return null
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return null
  }
}
