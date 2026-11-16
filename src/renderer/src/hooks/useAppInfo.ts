import { trpc } from '../trpc'

export interface AppInfo {
  /** The main process's version, or null until it has answered. */
  version: string | null
  /** Whether main answered the ping. False while loading and on failure. */
  connected: boolean
}

/** The running build, as main reports it. Also proves the IPC round trip works. */
export function useAppInfo(): AppInfo {
  const { data } = trpc.app.ping.useQuery()
  return { version: data?.version ?? null, connected: data?.ok === true }
}
