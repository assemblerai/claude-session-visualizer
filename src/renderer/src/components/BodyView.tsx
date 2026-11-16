import { useState } from 'react'
import type { Body, BodySlice } from '@shared/session'
import { formatBytes } from '../format'
import { asJson, JsonText } from './JsonText'

interface BodyViewProps {
  body: Body
  /** Fetches more of a body too large to send whole. */
  loadMore: (bodyRef: string, offset: number) => Promise<BodySlice>
  defaultOpen: boolean
}

function DiffText({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {text.split('\n').map((line, i) => {
        const tone = line.startsWith('+')
          ? 'text-success'
          : line.startsWith('-')
            ? 'text-danger'
            : line.startsWith('@@')
              ? 'text-info'
              : ''
        return (
          <span key={i} className={`block ${tone}`}>
            {line || ' '}
          </span>
        )
      })}
    </>
  )
}

interface BodyTextProps {
  body: Body
  loadMore: (bodyRef: string, offset: number) => Promise<BodySlice>
}

/** A body's content, loaded further on request. JSON is pretty-printed and coloured. */
export function BodyText({ body, loadMore }: BodyTextProps): React.JSX.Element {
  const [extra, setExtra] = useState('')
  const [next, setNext] = useState<number | null>(body.bodyRef === null ? null : body.preview.length)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const text = body.preview + extra
  // Text that is JSON can only be read once the whole of it is here.
  const json = body.format === 'json' ? text : body.format === 'text' && next === null ? asJson(text) : null

  const more = async (): Promise<void> => {
    if (body.bodyRef === null || next === null) return
    setBusy(true)
    setFailed(null)
    try {
      const slice = await loadMore(body.bodyRef, next)
      setExtra((known) => known + slice.text)
      setNext(slice.nextOffset)
    } catch (error) {
      setFailed(error instanceof Error ? error.message : 'Could not load more.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <pre
        className={`max-h-96 overflow-auto border-t border-line p-2 font-mono text-[11px] leading-relaxed ${json === null ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'}`}
      >
        {text === '' ? (
          <span className="text-subtle">(empty)</span>
        ) : body.format === 'diff' ? (
          <DiffText text={text} />
        ) : json !== null ? (
          <JsonText text={json} />
        ) : (
          text
        )}
      </pre>
      {next !== null && (
        <div className="flex items-center gap-2 border-t border-line px-2 py-1 text-xs">
          <button
            type="button"
            onClick={() => void more()}
            disabled={busy}
            className="text-primary hover:text-primary-hover disabled:opacity-50"
          >
            {busy ? 'Loading…' : 'Load more'}
          </button>
          <span className="text-subtle">showing the first {formatBytes(text.length)}</span>
          {failed && (
            <span role="alert" className="text-danger">
              {failed}
            </span>
          )}
        </div>
      )}
    </>
  )
}

/** One piece of a node's input or output: a title, its size, and the content. */
export function BodyView({ body, loadMore, defaultOpen }: BodyViewProps): React.JSX.Element {
  return (
    <details open={defaultOpen} className="rounded border border-line bg-surface">
      <summary className="flex items-center gap-2 px-2 py-1 text-xs">
        <span className="min-w-0 flex-1 truncate">{body.title}</span>
        <span className="shrink-0 text-subtle">{formatBytes(body.bytes)}</span>
      </summary>
      <BodyText body={body} loadMore={loadMore} />
    </details>
  )
}
