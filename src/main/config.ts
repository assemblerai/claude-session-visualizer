/**
 * The process's configuration, read once by the composition root at start-up.
 * `loadConfig` is the only reader of `process.env`.
 */
export interface AppConfig {
  /** `NODE_ENV`, defaulting to `development`. */
  readonly environment: string
  /** `ELECTRON_RENDERER_URL`: the dev server, set only by `electron-vite dev`. */
  readonly rendererUrl: string | undefined
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return Object.freeze({
    environment: env.NODE_ENV || 'development',
    rendererUrl: env.ELECTRON_RENDERER_URL || undefined,
  })
}
