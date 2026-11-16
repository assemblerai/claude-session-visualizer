import { app, BrowserWindow, dialog, type OpenDialogOptions } from 'electron'
import { dirname, join } from 'node:path'
import { loadConfig } from './config.js'
import { createLog, describeError } from './diagnostics/log.js'
import { registerTrpcIpc } from './router/ipc-adapter.js'
import type { Context } from './router/trpc.js'
import { createSettings } from './settings.js'
import { disk } from './transcripts/locate.js'
import { createSessionIndex } from './transcripts/session-index.js'
import { createSessionStore } from './transcripts/session-store.js'
import { openMainWindow } from './windows/main-window.js'

// Electron derives userData from the app name, which is "Electron" until this
// is set. Must run before anything calls `app.getPath`.
app.setName('claude-session-visualizer')

const config = loadConfig()
const log = createLog(join(app.getPath('userData'), 'logs', 'main.log'))

function createWindow(): void {
  openMainWindow({
    rendererUrl: config.rendererUrl,
    preloadPath: join(__dirname, '../preload/index.mjs'),
    rendererFile: join(__dirname, '../renderer/index.html'),
    log,
  })
}

/**
 * The native open dialog, over the focused window: session `.jsonl` files only.
 * Opens in the projects folder: the given root, or the one a session file is two levels under.
 */
async function pickSessionFiles(startAt: string | undefined): Promise<string[]> {
  const options: OpenDialogOptions = {
    title: 'Import a Claude Code session',
    defaultPath: startAt?.endsWith('.jsonl') ? dirname(dirname(startAt)) : startAt,
    buttonLabel: 'Import',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Claude Code sessions', extensions: ['jsonl'] }],
  }
  const window = BrowserWindow.getFocusedWindow()
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
  return result.canceled ? [] : result.filePaths
}

/** Builds the services every procedure reaches through. Grows as domains are added. */
function createContext(): Context {
  const userData = app.getPath('userData')
  const settings = createSettings(join(userData, 'settings.json'), disk)
  const sessionIndex = createSessionIndex({
    disk,
    imported: () => settings.getImported(),
    cacheFile: join(userData, 'session-index.json'),
    log,
  })
  const sessionStore = createSessionStore(disk, (sessionId) => sessionIndex.pathOf(sessionId))
  return { version: app.getVersion(), settings, sessionIndex, sessionStore, pickSessionFiles }
}

app
  .whenReady()
  .then(() => {
    log.write('info', `launch: Claude Session Visualizer ${app.getVersion()} on ${process.platform}`)
    const context = createContext()
    registerTrpcIpc(() => context, log)
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  // A launch that throws leaves a packaged app with no window and nothing on
  // screen. Log first, so the dialog can point at a file that exists.
  .catch((error: unknown) => {
    log.write('error', 'launch: Claude Session Visualizer could not start', error)
    dialog.showErrorBox('Claude Session Visualizer could not start', describeError(error))
    app.exit(1)
  })

app.on('window-all-closed', () => {
  app.quit()
})
