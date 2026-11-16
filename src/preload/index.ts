import { contextBridge, ipcRenderer } from 'electron'
import { TRPC_CHANNEL, type TrpcRequest, type TrpcResponse } from '../shared/types.js'

// The preload surface stays deliberately tiny: one command channel. Pushed
// events (a session file changing on disk, a live request arriving) will be
// added here as named subscriptions when something needs them.

const api = {
  trpc: {
    invoke: (request: TrpcRequest): Promise<TrpcResponse> => ipcRenderer.invoke(TRPC_CHANNEL, request),
  },
} as const

export type PreloadApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error('preload: failed to expose api over the context bridge', error)
  }
} else {
  throw new Error('preload: contextIsolation is disabled -- refusing to attach api')
}
