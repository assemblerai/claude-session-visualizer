import { useState } from 'react'
import { X } from 'lucide-react'
import type { Body, GraphNode, SessionGraph } from '@shared/session'
import { NODE_STYLE } from '../chart/theme'
import { attachmentsOf } from '../chart/visible'
import { formatBytes, formatClock, formatCost, formatCount, formatDateTime, formatDuration, formatTokens } from '../format'
import { useBodyLoader, useNodeDetail } from '../hooks/useSessionGraph'
import { BodyText, BodyView } from './BodyView'

interface DetailsPanelProps {
  graph: SessionGraph
  selectedId: string | null
  onSelect: (nodeId: string | null) => void
  onClose: () => void
}

/**
 * What went into a node and what came out. Nothing happens inside a node that
 * is not already on the chart, so there is no third section. With nothing
 * selected it shows the summary of the whole session.
 */
export function DetailsPanel({ graph, selectedId, onSelect, onClose }: DetailsPanelProps): React.JSX.Element {
  const node = selectedId === null ? undefined : graph.nodes.find((n) => n.id === selectedId)

  return (
    <aside aria-label="Details" tabIndex={-1} id="details-panel" className="flex w-[26rem] shrink-0 flex-col border-l border-line bg-surface-sunken outline-none">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{node ? NODE_STYLE[node.kind].name : 'Session summary'}</h2>
        {node && (
          <button type="button" onClick={() => onSelect(null)} className="text-xs text-muted hover:text-on-surface">
            Summary
          </button>
        )}
        <button type="button" onClick={onClose} aria-label="Close details" className="rounded p-1 text-muted hover:bg-surface-raised hover:text-on-surface">
          <X aria-hidden className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {node ? <NodeDetails key={node.id} graph={graph} node={node} /> : <Summary graph={graph} onSelect={onSelect} />}
      </div>
    </aside>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex justify-between gap-3 py-0.5 text-xs">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  )
}

function Summary({ graph, onSelect }: { graph: SessionGraph; onSelect: (nodeId: string | null) => void }): React.JSX.Element {
  const first = graph.nodes.find((n) => n.kind === 'prompt')
  const results = graph.nodes.filter((n) => n.kind === 'result')
  const last = results[results.length - 1]
  const link = (label: string, node: GraphNode | undefined): React.JSX.Element => (
    <div className="mt-3">
      <h3 className="mb-1 text-xs text-muted">{label}</h3>
      {node ? (
        <button type="button" onClick={() => onSelect(node.id)} className="w-full rounded border border-line bg-surface p-2 text-left text-xs hover:border-line-strong">
          {node.label}
        </button>
      ) : (
        <p className="text-xs text-subtle">None recorded.</p>
      )}
    </div>
  )

  return (
    <>
      <p className="mb-2 text-sm">{graph.title ?? graph.sessionId}</p>
      <dl>
        <Fact label="Ran">{formatDateTime(graph.startedAt)}</Fact>
        <Fact label="Duration">{formatDuration(graph.totals.durationMs)}</Fact>
        <Fact label="Agents">{graph.agents.length}</Fact>
        <Fact label="Requests to Anthropic">{graph.totals.requests}</Fact>
        <Fact label="Tool uses">{graph.totals.toolUses}</Fact>
        <Fact label="Tokens">{formatTokens(graph.totals.usage)}</Fact>
        <Fact label="Estimated cost">{formatCost(graph.totals.costUsd)}</Fact>
        {graph.claudeCodeTotals && <Fact label="Claude Code's own figure">{formatCost(graph.claudeCodeTotals.costUsd)}</Fact>}
      </dl>
      {link('Started from', first)}
      {link('Ended with', last)}
      {graph.warnings.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1 text-xs text-muted">Not recognised or not recorded</h3>
          <ul className="text-xs text-warning">
            {graph.warnings.map((w) => (
              <li key={`${w.kind}:${w.subject}`}>
                {w.count} × {w.subject}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

function Bodies({ title, bodies, sessionId, empty }: { title: string; bodies: Body[]; sessionId: string; empty: string }): React.JSX.Element {
  const loadMore = useBodyLoader(sessionId)
  const fresh = bodies.filter((b) => !b.repeated)
  const repeated = bodies.filter((b) => b.repeated)
  const list = (items: Body[], open: boolean): React.JSX.Element => (
    <div className="flex flex-col gap-1.5">
      {items.map((body, i) => (
        <BodyView key={`${body.title}:${i}`} body={body} loadMore={loadMore} defaultOpen={open && items.length <= 6} />
      ))}
    </div>
  )

  return (
    <section className="mt-4">
      <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">{title}</h3>
      {bodies.length === 0 && <p className="text-xs text-subtle">{empty}</p>}
      {repeated.length === 0 ? (
        list(fresh, true)
      ) : (
        <>
          <h4 className="mb-1 text-xs text-muted">New in this request ({fresh.length})</h4>
          {fresh.length === 0 ? <p className="text-xs text-subtle">Nothing new.</p> : list(fresh, true)}
          <h4 className="mb-1 mt-3 text-xs text-muted">Repeated from earlier ({repeated.length})</h4>
          {list(repeated, false)}
        </>
      )}
    </section>
  )
}

/** One attachment's content, fetched when it is opened. */
function AttachmentContent({ sessionId, nodeId }: { sessionId: string; nodeId: string }): React.JSX.Element {
  const { detail, isLoading, error } = useNodeDetail(sessionId, nodeId)
  const loadMore = useBodyLoader(sessionId)
  if (isLoading) return <p className="border-t border-line p-2 text-xs text-muted">Loading…</p>
  if (error) return <p role="alert" className="border-t border-line p-2 text-xs text-danger">{error}</p>
  const body = detail?.output[0]
  return body ? <BodyText body={body} loadMore={loadMore} /> : <p className="border-t border-line p-2 text-xs text-subtle">(empty)</p>
}

function AttachmentItem({ sessionId, node }: { sessionId: string; node: GraphNode }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)} className="rounded border border-line bg-surface">
      <summary className="flex items-center gap-2 px-2 py-1 text-xs">
        <span className="min-w-0 flex-1 truncate">{node.label}</span>
        <span className="shrink-0 text-subtle">{formatClock(node.startedAt)}</span>
        <span className="w-16 shrink-0 text-right text-subtle">{formatBytes(node.bytesOut)}</span>
      </summary>
      {open && <AttachmentContent sessionId={sessionId} nodeId={node.id} />}
    </details>
  )
}

/** What Claude Code attached on its own before this request: not drawn on the chart, so listed here. */
function Attachments({ graph, requestId }: { graph: SessionGraph; requestId: string }): React.JSX.Element | null {
  const items = attachmentsOf(graph, requestId)
  if (items.length === 0) return null
  return (
    <section className="mt-4">
      <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">Attachments ({items.length})</h3>
      <div className="flex flex-col gap-1.5">
        {items.map((n) => (
          <AttachmentItem key={n.id} sessionId={graph.sessionId} node={n} />
        ))}
      </div>
    </section>
  )
}

function NodeDetails({ graph, node }: { graph: SessionGraph; node: GraphNode }): React.JSX.Element {
  const { detail, isLoading, error } = useNodeDetail(graph.sessionId, node.id)
  const agent = graph.agents.find((a) => a.id === node.agentId)
  const helpersStarted = node.kind === 'agent' ? graph.agents.filter((a) => a.parentId === node.agentId) : []

  return (
    <>
      <p className="mb-2 break-words text-sm">{node.label}</p>
      <dl>
        <Fact label="Agent">{agent ? (agent.id === 'main' ? 'main' : `${agent.type}${node.run > 0 ? ` (run ${node.run + 1})` : ''}`) : node.agentId}</Fact>
        <Fact label="Started">{formatClock(node.startedAt)}</Fact>
        <Fact label="Took">{formatDuration(node.endedAt - node.startedAt)}</Fact>
        {node.request && (
          <>
            <Fact label="Model">{node.request.model}</Fact>
            {node.request.hasReply ? (
              <>
                <Fact label="Input tokens">{formatCount(node.request.usage.input)}</Fact>
                <Fact label="Output tokens">{formatCount(node.request.usage.output)}</Fact>
                <Fact label="Cache read">{formatCount(node.request.usage.cacheRead)}</Fact>
                <Fact label="Cache write (5 min / 1 hour)">
                  {formatCount(node.request.usage.cacheWrite5m)} / {formatCount(node.request.usage.cacheWrite1h)}
                </Fact>
                <Fact label="Estimated cost">{formatCost(node.request.costUsd)}</Fact>
              </>
            ) : (
              <Fact label="Reply">no reply recorded</Fact>
            )}
          </>
        )}
        {node.tool && <Fact label="Tool">{node.tool.server ? `${node.tool.name} (server ${node.tool.server})` : node.tool.name}</Fact>}
        {node.tool?.file && <Fact label={`File ${node.tool.file.action}`}>{node.tool.file.path}</Fact>}
        {node.skill && <Fact label="Skill">{node.skill}</Fact>}
        {node.kind === 'agent' && agent && (
          <>
            <Fact label="Task">{agent.description || '–'}</Fact>
            <Fact label="Requests">{agent.totals.requests}</Fact>
            <Fact label="Tool uses">{agent.totals.toolUses}</Fact>
            <Fact label="Tokens">{formatTokens(agent.totals.usage)}</Fact>
            <Fact label="Estimated cost">{formatCost(agent.totals.costUsd)}</Fact>
            <Fact label="Helpers started">{helpersStarted.length === 0 ? 'none' : helpersStarted.map((a) => a.type).join(', ')}</Fact>
            <Fact label="Ran in the background">{agent.background ? 'yes' : 'no'}</Fact>
            {!agent.finished && <Fact label="Finished">no</Fact>}
          </>
        )}
        {node.error && <Fact label="Outcome"><span className="text-danger">failed</span></Fact>}
      </dl>

      {node.kind === 'request' && <Attachments graph={graph} requestId={node.id} />}
      {isLoading && <p className="mt-4 text-xs text-muted">Loading…</p>}
      {error && <p role="alert" className="mt-4 text-xs text-danger">{error}</p>}
      {detail && (
        <>
          <Bodies title="Input" bodies={detail.input} sessionId={graph.sessionId} empty="Nothing flowed into this step." />
          <Bodies title="Output" bodies={detail.output} sessionId={graph.sessionId} empty={node.request && !node.request.hasReply ? 'No reply was recorded.' : 'Nothing came out of this step.'} />
        </>
      )}
    </>
  )
}
