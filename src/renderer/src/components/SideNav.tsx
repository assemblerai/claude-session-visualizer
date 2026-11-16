import { Coins, FileText, List, PanelLeftClose, PanelLeftOpen, Send, Workflow, type LucideIcon } from 'lucide-react'

export type Section = 'sessions' | 'chart' | 'requests' | 'tokens' | 'files'

const ENTRIES: readonly { id: Section; label: string; icon: LucideIcon; needsSession: boolean }[] = [
  { id: 'sessions', label: 'Sessions', icon: List, needsSession: false },
  { id: 'chart', label: 'Process chart', icon: Workflow, needsSession: true },
  { id: 'requests', label: 'Requests', icon: Send, needsSession: true },
  { id: 'tokens', label: 'Tokens & cost', icon: Coins, needsSession: true },
  { id: 'files', label: 'Files', icon: FileText, needsSession: true },
]

interface SideNavProps {
  section: Section
  onSection: (section: Section) => void
  /** Whether a session is open: the other screens need one. */
  hasSession: boolean
  /** A narrow strip of icons. */
  collapsed: boolean
  onCollapsed: (collapsed: boolean) => void
}

/** The left-hand navigation, which folds to a strip of icons. */
export function SideNav({ section, onSection, hasSession, collapsed, onCollapsed }: SideNavProps): React.JSX.Element {
  const Toggle = collapsed ? PanelLeftOpen : PanelLeftClose
  return (
    <nav aria-label="Sections" className={`flex shrink-0 flex-col border-r border-line bg-surface-sunken ${collapsed ? 'w-12' : 'w-52'}`}>
      <ul className="flex flex-1 flex-col gap-0.5 p-2">
        {ENTRIES.map(({ id, label, icon: Icon, needsSession }) => (
          <li key={id}>
            <button
              type="button"
              disabled={needsSession && !hasSession}
              aria-current={section === id ? 'page' : undefined}
              aria-label={label}
              title={needsSession && !hasSession ? `${label}: open a session first` : label}
              onClick={() => onSection(id)}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40 ${
                section === id ? 'bg-surface-raised text-primary' : ''
              } ${collapsed ? 'justify-center' : ''}`}
            >
              <Icon aria-hidden strokeWidth={1.5} className="size-4 shrink-0" />
              {!collapsed && <span>{label}</span>}
            </button>
          </li>
        ))}
      </ul>
      <div className="border-t border-line p-2">
        <button
          type="button"
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          onClick={() => onCollapsed(!collapsed)}
          className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-muted hover:bg-surface-raised hover:text-on-surface ${collapsed ? 'justify-center' : ''}`}
        >
          <Toggle aria-hidden strokeWidth={1.5} className="size-4 shrink-0" />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </nav>
  )
}
