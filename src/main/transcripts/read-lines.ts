import { createReadStream } from 'node:fs'

const NEWLINE = 0x0a

/**
 * Stream a file as lines, from byte `start`. Session files run to hundreds of
 * megabytes, so the file is never held whole. See `Disk.forEachLine`.
 */
export async function forEachLine(path: string, start: number, onLine: (line: string) => void): Promise<number> {
  let consumed = start
  let rest: Buffer = Buffer.alloc(0)

  for await (const chunk of createReadStream(path, { start }) as AsyncIterable<Buffer>) {
    const data = rest.length === 0 ? chunk : Buffer.concat([rest, chunk])
    const end = data.lastIndexOf(NEWLINE)
    if (end === -1) {
      rest = data
      continue
    }
    for (const line of data.toString('utf8', 0, end).split('\n')) onLine(line)
    consumed += end + 1
    rest = data.subarray(end + 1)
  }
  return consumed
}
