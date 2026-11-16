import { BrowserWindow, shell } from 'electron'
import type { Log } from '../diagnostics/log.js'

export interface MainWindowDeps {
  readonly rendererUrl: string | undefined
  readonly preloadPath: string
  readonly rendererFile: string
  readonly log: Log
}

function constructWindow(preloadPath: string): BrowserWindow {
  return new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Session Manager',
    // The renderer's own ground, so the first paint is not a lighter flash.
    backgroundColor: '#1c1c1e',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      // The preload is an ES module, which Electron only loads unsandboxed.
      sandbox: false,
    },
  })
}

/** Dev only: open devtools and mirror the renderer console, so a blank window is never silent. */
function attachDiagnostics(window: BrowserWindow, deps: MainWindowDeps): void {
  if (!deps.rendererUrl) return

  window.webContents.on('console-message', (details) => {
    deps.log.write(details.level === 'error' ? 'error' : 'info', `renderer[${details.level}] ${details.message}`)
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    deps.log.write('error', 'renderer process gone', details)
  })
  window.webContents.on('did-fail-load', (_event, code, description) => {
    deps.log.write('error', `renderer failed to load: ${description} (${code})`)
  })
  window.webContents.openDevTools({ mode: 'detach' })
}

export function openMainWindow(deps: MainWindowDeps): BrowserWindow {
  const window = constructWindow(deps.preloadPath)

  window.on('ready-to-show', () => window.show())

  // Never let the app navigate itself away; external links go to the browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  attachDiagnostics(window, deps)

  if (deps.rendererUrl) {
    deps.log.write('info', `renderer: loading from the dev server at ${deps.rendererUrl}`)
    void window.loadURL(deps.rendererUrl)
  } else {
    deps.log.write('info', `renderer: loading the built file at ${deps.rendererFile}`)
    void window.loadFile(deps.rendererFile)
  }

  return window
}
