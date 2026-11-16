import type { ModelTotals, SessionGraph, Usage } from '@shared/session'
import { byAgent, bySkill, byTool, type UsageRow } from '../breakdowns'
import { formatBytes, formatCost, formatCount, formatDuration } from '../format'

const KINDS: readonly { key: keyof Usage; label: string }[] = [
  { key: 'input', label: 'Input' },
  { key: 'output', label: 'Output' },
  { key: 'cacheRead', label: 'Cache read' },
  { key: 'cacheWrite5m', label: 'Cache write (5 min)' },
  { key: 'cacheWrite1h', label: 'Cache write (1 hour)' },
]

/** Claude Code often records cache writes as one total, so the comparison adds the two lifetimes. */
const COMPARED: readonly { label: string; of: (u: Usage) => number }[] = [
  { label: 'Input', of: (u) => u.input },
  { label: 'Output', of: (u) => u.output },
  { label: 'Cache read', of: (u) => u.cacheRead },
  { label: 'Cache write (both lifetimes)', of: (u) => u.cacheWrite5m + u.cacheWrite1h },
]

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="mb-8">
      <h2 className="text-sm font-medium">{title}</h2>
      {note && <p className="mb-2 mt-0.5 max-w-3xl text-xs text-muted">{note}</p>}
      <div className="mt-2 overflow-x-auto rounded border border-line">{children}</div>
    </section>
  )
}

const th = 'px-3 py-1.5 font-normal'
const td = 'px-3 py-1.5 text-right'

function UsageTable({ first, rows }: { first: string; rows: UsageRow[] }): React.JSX.Element {
  return (
    <table className="w-full text-sm">
      <thead className="bg-surface-sunken text-left text-xs text-muted">
        <tr>
          <th className={th}>{first}</th>
          <th className={`${th} text-right`}>Requests</th>
          {KINDS.map((k) => (
            <th key={k.key} className={`${th} text-right`}>
              {k.label}
            </th>
          ))}
          <th className={`${th} text-right`}>Estimated cost</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-t border-line">
            <td className="max-w-xs truncate px-3 py-1.5" title={row.label}>
              {row.label}
            </td>
            <td className={td}>{row.requests}</td>
            {KINDS.map((k) => (
              <td key={k.key} className={td}>
                {formatCount(row.usage[k.key])}
              </td>
            ))}
            <td className={td}>{formatCost(row.costUsd)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Breakdowns by agent, model, skill and tool, and by kind of token, with our estimate next to Claude Code's own figure. */
export function TokensView({ graph }: { graph: SessionGraph }): React.JSX.Element {
  const theirs = graph.claudeCodeTotals
  const models = [...new Set([...graph.byModel, ...graph.claudeCodeByModel].map((m) => m.model))]
  const find = (list: ModelTotals[], model: string): ModelTotals | undefined => list.find((m) => m.model === model)

  return (
    <div className="h-full overflow-y-auto p-6">
      <Section
        title="Our estimate and Claude Code's own figure"
        note="Ours counts each reply once and multiplies by the price list. Claude Code keeps its own running total, which includes helpers. The two are shown side by side; neither is called right."
      >
        <table className="w-full text-sm">
          <thead className="bg-surface-sunken text-left text-xs text-muted">
            <tr>
              <th className={th}>Kind of token</th>
              <th className={`${th} text-right`}>Ours</th>
              <th className={`${th} text-right`}>Claude Code</th>
            </tr>
          </thead>
          <tbody>
            {COMPARED.map((row) => (
              <tr key={row.label} className="border-t border-line">
                <td className="px-3 py-1.5">{row.label}</td>
                <td className={td}>{formatCount(row.of(graph.totals.usage))}</td>
                <td className={td}>{theirs ? formatCount(row.of(theirs.usage)) : '–'}</td>
              </tr>
            ))}
            <tr className="border-t border-line-strong font-medium">
              <td className="px-3 py-1.5">Cost</td>
              <td className={td}>{formatCost(graph.totals.costUsd)}</td>
              <td className={td}>{theirs ? formatCost(theirs.costUsd) : 'not recorded'}</td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section title="By model">
        <table className="w-full text-sm">
          <thead className="bg-surface-sunken text-left text-xs text-muted">
            <tr>
              <th className={th}>Model</th>
              <th className={`${th} text-right`}>Output tokens, ours</th>
              <th className={`${th} text-right`}>Output tokens, Claude Code</th>
              <th className={`${th} text-right`}>Cost, ours</th>
              <th className={`${th} text-right`}>Cost, Claude Code</th>
            </tr>
          </thead>
          <tbody>
            {models.map((model) => {
              const ours = find(graph.byModel, model)
              const cc = find(graph.claudeCodeByModel, model)
              return (
                <tr key={model} className="border-t border-line">
                  <td className="px-3 py-1.5">{model}</td>
                  <td className={td}>{ours ? formatCount(ours.usage.output) : '–'}</td>
                  <td className={td}>{cc ? formatCount(cc.usage.output) : '–'}</td>
                  <td className={td}>{ours ? formatCost(ours.costUsd) : '–'}</td>
                  <td className={td}>{cc ? formatCost(cc.costUsd) : '–'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Section>

      <Section title="By agent">
        <UsageTable first="Agent" rows={byAgent(graph)} />
      </Section>

      <Section title="By skill">
        <UsageTable first="Skill" rows={bySkill(graph)} />
      </Section>

      <Section title="By tool" note="A tool is not charged for directly. What it costs is the data it sends back, which becomes input to the requests after it.">
        <table className="w-full text-sm">
          <thead className="bg-surface-sunken text-left text-xs text-muted">
            <tr>
              <th className={th}>Tool</th>
              <th className={`${th} text-right`}>Uses</th>
              <th className={`${th} text-right`}>Failed</th>
              <th className={`${th} text-right`}>Data in</th>
              <th className={`${th} text-right`}>Data back</th>
              <th className={`${th} text-right`}>Time</th>
            </tr>
          </thead>
          <tbody>
            {byTool(graph).map((row) => (
              <tr key={row.name} className="border-t border-line">
                <td className="px-3 py-1.5">{row.name}</td>
                <td className={td}>{row.uses}</td>
                <td className={td}>{row.errors || '–'}</td>
                <td className={td}>{formatBytes(row.bytesIn)}</td>
                <td className={td}>{formatBytes(row.bytesOut)}</td>
                <td className={td}>{formatDuration(row.durationMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  )
}
