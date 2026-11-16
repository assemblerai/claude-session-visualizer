import { useState } from 'react'
import { Chart } from './chart/Chart'
import type { LayoutMode } from './chart/layout'
import { AppLayout } from './components/AppLayout'
import { DetailsPanel } from './components/DetailsPanel'
import { FilesView } from './components/FilesView'
import { RequestsList } from './components/RequestsList'
import { SessionsList } from './components/SessionsList'
import { SideNav, type Section } from './components/SideNav'
import { TokensView } from './components/TokensView'
import { TopBar } from './components/TopBar'
import { useSessionGraph } from './hooks/useSessionGraph'

/** Composes the chrome and holds what is open: the section, the session, and the selected step. */
export function App(): React.JSX.Element {
  const [section, setSection] = useState<Section>('sessions')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(true)
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [mode, setMode] = useState<LayoutMode>('ordered')
  const [live, setLive] = useState(false)
  const { graph, isLoading, error } = useSessionGraph(sessionId, live)

  const select = (nodeId: string | null): void => {
    setSelectedId(nodeId)
    if (nodeId !== null) setPanelOpen(true)
  }
  const open = (id: string): void => {
    setSessionId(id)
    setSelectedId(null)
    setPanelOpen(true)
    setLive(false)
    setSection('chart')
  }

  const onSession = section !== 'sessions'
  const showPanel = onSession && section !== 'tokens' && graph !== null && panelOpen

  let screen: React.ReactNode
  if (!onSession) {
    screen = <SessionsList openSessionId={sessionId} onOpen={open} />
  } else if (error) {
    screen = (
      <p role="alert" className="p-6 text-sm text-danger">
        {error}
      </p>
    )
  } else if (!graph) {
    screen = <p className="p-6 text-sm text-muted">{isLoading ? 'Reading the session…' : 'Import or open a session from the Sessions list.'}</p>
  } else if (section === 'chart') {
    screen = (
      <Chart
        graph={graph}
        mode={mode}
        onModeChange={setMode}
        selectedId={selectedId}
        onSelect={select}
        onOpen={() => document.getElementById('details-panel')?.focus()}
      />
    )
  } else if (section === 'requests') {
    screen = <RequestsList graph={graph} selectedId={selectedId} onSelect={select} />
  } else if (section === 'tokens') {
    screen = <TokensView graph={graph} />
  } else {
    screen = <FilesView graph={graph} selectedId={selectedId} onSelect={select} />
  }

  return (
    <AppLayout
      topBar={
        <TopBar
          graph={onSession ? graph : null}
          live={live}
          onLive={setLive}
          onSummary={() => {
            setSelectedId(null)
            setPanelOpen(true)
            if (section === 'tokens') setSection('chart')
          }}
        />
      }
      panel={showPanel && graph ? <DetailsPanel graph={graph} selectedId={selectedId} onSelect={select} onClose={() => setPanelOpen(false)} /> : null}
      nav={<SideNav section={section} onSection={setSection} hasSession={sessionId !== null} collapsed={navCollapsed} onCollapsed={setNavCollapsed} />}
    >
      {screen}
    </AppLayout>
  )
}
