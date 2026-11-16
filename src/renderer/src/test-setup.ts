import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})

if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe(): void {
      // jsdom has no layout; nothing to observe.
    }
    unobserve(): void {
      // Stub.
    }
    disconnect(): void {
      // Stub.
    }
  }
}
