import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { asJson, JsonText } from './JsonText'

describe('asJson', () => {
  it('pretty-prints a whole JSON object or array', () => {
    expect(asJson('{"a":1,"b":[true,null]}')).toBe('{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ]\n}')
    expect(asJson('  [1]  ')).toBe('[\n  1\n]')
  })

  it.each(['plain text', '42', '"a string"', '{"cut off": ', ''])('leaves %j alone', (text) => {
    expect(asJson(text)).toBeNull()
  })
})

describe('JsonText', () => {
  it('colours keys, strings, numbers and literals differently, and keeps the text intact', () => {
    const text = '{\n  "key": "value",\n  "n": -1.5e3,\n  "ok": false\n}'
    const { container } = render(<pre><JsonText text={text} /></pre>)
    expect(container.textContent).toBe(text)
    expect(screen.getByText('"key"')).toHaveClass('text-info')
    expect(screen.getByText('"value"')).toHaveClass('text-success')
    expect(screen.getByText('-1.5e3')).toHaveClass('text-warning')
    expect(screen.getByText('false')).toHaveClass('text-primary')
  })

  it('keeps a cut-off preview readable', () => {
    const text = '{\n  "a": "unterminated'
    const { container } = render(<pre><JsonText text={text} /></pre>)
    expect(container.textContent).toBe(text)
  })
})
