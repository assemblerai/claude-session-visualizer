import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeDetail, SessionSummary } from '@shared/session'
import { App } from './App'
import { loadGraph } from './chart/fixtures'

const graph = loadGraph('one-helper')
const session: SessionSummary = {
  sessionId: 'one-helper',
  path: '/root/-home-me-app/one-helper.jsonl',
  project: '-home-me-app',
  missing: false,
  modifiedAt: 1,
  sizeBytes: 2048,
  pending: false,
  title: 'Look something up',
  startedAt: graph.startedAt,
  endedAt: graph.endedAt,
  helperCount: 1,
  costUsd: 0.66,
  hasRequests: true,
}
const old: SessionSummary = {
  ...session,
  sessionId: 'old',
  path: '/root/-home-me-app/old.jsonl',
  title: 'An old one',
  hasRequests: false,
}
const importSessions = vi.fn()
const remove = vi.fn()
const detail: NodeDetail = {
  nodeId: '',
  input: [
    {
      title: 'System prompt',
      role: 'system',
      repeated: true,
      format: 'text',
      preview: 'You are…',
      bytes: 8,
      bodyRef: null,
    },
    {
      title: 'Message 3 · user',
      role: 'user',
      repeated: false,
      format: 'text',
      preview: 'the new part',
      bytes: 12,
      bodyRef: null,
    },
  ],
  output: [
    {
      title: 'Text',
      role: 'assistant',
      repeated: false,
      format: 'text',
      preview: 'the reply',
      bytes: 9,
      bodyRef: null,
    },
  ],
}

vi.mock('./hooks/useAppInfo', () => ({ useAppInfo: () => ({ version: '1.2.3', connected: true }) }))
vi.mock('./hooks/useSessions', () => ({
  useSessions: () => ({ items: [session, old], isLoading: false, error: null }),
  useImportSessions: () => ({ importSessions, remove, isImporting: false, error: null }),
}))
vi.mock('./hooks/useSessionGraph', () => ({
  useSessionGraph: (sessionId: string | null) => ({ graph: sessionId ? graph : null, isLoading: false, error: null }),
  useNodeDetail: (_: string | null, nodeId: string | null) => ({
    detail: nodeId ? { ...detail, nodeId } : null,
    isLoading: false,
    error: null,
  }),
  useBodyLoader: () => vi.fn(),
}))

async function openSession(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup()
  render(<App />)
  await user.click(screen.getByRole('button', { name: 'Look something up' }))
  return user
}

beforeEach(() => {
  // jsdom has no canvas; the chart draws nothing without a context.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

describe('App', () => {
  it('shows the top bar, the left-hand navigation and the main region', () => {
    render(<App />)

    expect(screen.getByRole('banner')).toHaveTextContent('Claude Session Visualizer')
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeInTheDocument()
    expect(screen.getByText('v1.2.3')).toBeInTheDocument()
  })

  it('keeps the session screens closed until a session is open', () => {
    render(<App />)

    expect(screen.getByRole('button', { name: 'Process chart' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Sessions' })).toBeEnabled()
  })

  it('lists the imported sessions, and will not open one with no request records', () => {
    render(<App />)

    expect(screen.getAllByRole('cell', { name: '-home-me-app' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Look something up' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'An old one' })).toBeDisabled()
    expect(screen.getByText('no request records')).toBeInTheDocument()
  })

  it('opens a session on the process chart, with its summary in the details panel', async () => {
    await openSession()
    const panel = screen.getByRole('complementary', { name: 'Details' })

    expect(screen.getByRole('application')).toBeInTheDocument()
    expect(within(panel).getByRole('heading', { name: 'Session summary' })).toBeInTheDocument()
    expect(within(panel).getByText('Requests to Anthropic')).toBeInTheDocument()
    expect(screen.getByRole('banner')).toHaveTextContent(graph.title ?? '')
  })

  it('imports from the file dialog, and removes a session from the list', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Import session' }))
    await user.click(screen.getByRole('button', { name: 'Remove An old one' }))

    expect(importSessions).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledWith('/root/-home-me-app/old.jsonl')
  })

  it('collapses the navigation to icons and opens it again', async () => {
    const user = userEvent.setup()
    render(<App />)
    const nav = screen.getByRole('navigation', { name: 'Sections' })

    expect(within(nav).getByText('Requests')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }))
    expect(within(nav).queryByText('Requests')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Expand navigation' }))
    expect(within(nav).getByText('Requests')).toBeInTheDocument()
  })

  it('opens a request from the Requests list, with new parts apart from repeated ones', async () => {
    const user = await openSession()
    await user.click(screen.getByRole('button', { name: 'Requests' }))
    await user.click(screen.getByRole('button', { name: 'Open request 2' }))
    const panel = screen.getByRole('complementary', { name: 'Details' })

    expect(within(panel).getByRole('heading', { name: 'Anthropic request' })).toBeInTheDocument()
    expect(within(panel).getByRole('heading', { name: 'New in this request (1)' })).toBeInTheDocument()
    expect(within(panel).getByRole('heading', { name: 'Repeated from earlier (1)' })).toBeInTheDocument()
    expect(within(panel).getByText('the reply')).toBeInTheDocument()
  })

  it("shows our estimate next to Claude Code's own figure", async () => {
    const user = await openSession()
    await user.click(screen.getByRole('button', { name: 'Tokens & cost' }))

    expect(screen.getByRole('heading', { name: "Our estimate and Claude Code's own figure" })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'By agent' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Claude Code' })).toBeInTheDocument()
  })

  it('moves along the chart with the arrow keys and announces the step', async () => {
    const user = await openSession()
    screen.getByRole('application').focus()
    await user.keyboard('{ArrowRight}')

    expect(screen.getByRole('status')).not.toBeEmptyDOMElement()
  })
})
