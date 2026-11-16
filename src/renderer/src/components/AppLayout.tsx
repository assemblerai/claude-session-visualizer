interface AppLayoutProps {
  topBar: React.ReactNode
  /** Shown to the right of the main region, when open. */
  panel?: React.ReactNode
  nav: React.ReactNode
  children?: React.ReactNode
}

/**
 * The shell: top bar across the window, the navigation on the left, the main
 * region, and the details panel on the right when it is open. The body has
 * `overflow: hidden`, so each region manages its own scrolling.
 */
export function AppLayout({ topBar, panel, nav, children }: AppLayoutProps): React.JSX.Element {
  return (
    <div className="flex h-screen flex-col bg-surface text-on-surface">
      {topBar}
      <div className="flex min-h-0 flex-1">
        {nav}
        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
        {panel}
      </div>
    </div>
  )
}
