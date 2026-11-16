import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

describe('loadConfig', () => {
  it('defaults the environment to development', () => {
    expect(loadConfig({}).environment).toBe('development')
  })

  it('treats a blank renderer URL as absent', () => {
    expect(loadConfig({ ELECTRON_RENDERER_URL: '' }).rendererUrl).toBeUndefined()
  })

  it('reads the dev server URL when electron-vite sets it', () => {
    expect(loadConfig({ ELECTRON_RENDERER_URL: 'http://localhost:5177' }).rendererUrl).toBe('http://localhost:5177')
  })
})
