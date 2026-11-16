import { describe, expect, it } from 'vitest'
import { createSettings } from './settings.js'
import { createFakeDisk } from './transcripts/fake-disk.js'

describe('settings', () => {
  it('detects the roots on first run and saves them', async () => {
    const disk = createFakeDisk()
    const settings = createSettings('/userData/settings.json', disk, async () => ['/home/me/.claude/projects'])

    await expect(settings.getRoots()).resolves.toEqual(['/home/me/.claude/projects'])
    expect(JSON.parse(disk.files.get('/userData/settings.json') ?? '{}')).toEqual({ roots: ['/home/me/.claude/projects'], imported: [] })
  })

  it('reads saved roots without detecting again', async () => {
    const disk = createFakeDisk({ '/userData/settings.json': '{"roots":["/a","/b"]}' })
    const settings = createSettings('/userData/settings.json', disk, async () => {
      throw new Error('should not detect')
    })

    await expect(settings.getRoots()).resolves.toEqual(['/a', '/b'])
    await expect(settings.getImported()).resolves.toEqual([])
  })

  it('adds imported sessions newest first, without repeats, and removes them', async () => {
    const disk = createFakeDisk()
    const settings = createSettings('/userData/settings.json', disk, async () => [])

    await settings.addImported(['/p/a.jsonl', ' /p/b.jsonl '])
    await expect(settings.addImported(['/p/c.jsonl', '/p/a.jsonl'])).resolves.toEqual(['/p/c.jsonl', '/p/a.jsonl', '/p/b.jsonl'])
    await expect(settings.removeImported('/p/a.jsonl')).resolves.toEqual(['/p/c.jsonl', '/p/b.jsonl'])

    const relaunched = createSettings('/userData/settings.json', disk, async () => [])
    await expect(relaunched.getImported()).resolves.toEqual(['/p/c.jsonl', '/p/b.jsonl'])
  })
})
