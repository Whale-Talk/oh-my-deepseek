import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clipDescription, extractDescription, resolveImageInput } from '../src/vision-core.ts'

describe('resolveImageInput', () => {
  it('passes through data URIs and http(s) URLs', async () => {
    const dataUri = 'data:image/png;base64,AAAA'
    expect(await resolveImageInput(dataUri, undefined)).toBe(dataUri)
    const url = 'https://example.com/x.png'
    expect(await resolveImageInput(url, undefined)).toBe(url)
  })

  it('reads an absolute path into a base64 data URI', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omd-vision-'))
    const png = join(dir, 'shot.png')
    writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const out = await resolveImageInput(png, undefined)
    expect(out).toMatch(/^data:image\/png;base64,/)
    expect(out).toContain(Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'))
  })

  it('resolves a relative path against the cwd', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omd-vision-'))
    writeFileSync(join(dir, 'shot.jpg'), 'jpegdata')
    const out = await resolveImageInput('shot.jpg', dir)
    expect(out).toMatch(/^data:image\/jpeg;base64,/)
  })

  it('rejects a missing file', async () => {
    await expect(resolveImageInput('/no/such/file.png', undefined)).rejects.toThrow()
  })

  it('uses the path as-is when relative and no cwd is given', async () => {
    // A relative path with no cwd resolves against the process cwd; reading a
    // nonexistent file must reject rather than silently pass through.
    await expect(resolveImageInput('no-such-file.png', undefined)).rejects.toThrow()
  })

  it('infers mime from extension for gif/webp/bmp/svg and falls back otherwise', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omd-vision-'))
    const cases: Array<[string, string]> = [
      ['a.gif', 'image/gif'],
      ['a.webp', 'image/webp'],
      ['a.bmp', 'image/bmp'],
      ['a.svg', 'image/svg+xml'],
      ['a.unknown', 'application/octet-stream'],
    ]
    for (const [file, mime] of cases) {
      writeFileSync(join(dir, file), 'x')
      const out = await resolveImageInput(file, dir)
      expect(out.startsWith(`data:${mime};base64,`)).toBe(true)
    }
  })
})

describe('extractDescription', () => {
  it('extracts a plain string content', () => {
    expect(extractDescription({ choices: [{ message: { content: 'a screenshot of a dashboard' } }] })).toBe('a screenshot of a dashboard')
  })

  it('joins content parts with text type', () => {
    const payload = {
      choices: [{ message: { content: [
        { type: 'text', text: 'A chart.' },
        { type: 'text', text: ' Rising trend.' },
      ] } }],
    }
    expect(extractDescription(payload as never)).toBe('A chart.\n Rising trend.')
  })

  it('throws on an API error', () => {
    expect(() => extractDescription({ error: { message: 'rate limited', code: '429' } })).toThrow(/429/)
  })

  it('throws when there is no text', () => {
    expect(() => extractDescription({ choices: [] })).toThrow(/no text description/)
  })
})

describe('clipDescription', () => {
  it('passes through short descriptions', () => {
    expect(clipDescription('a short desc')).toBe('a short desc')
  })

  it('truncates long descriptions with a notice', () => {
    const out = clipDescription('x'.repeat(5000))
    // 2000 内容 + '\n… [truncated]' (14 chars)
    expect(out.length).toBeLessThanOrEqual(2000 + 14)
    expect(out).toContain('[truncated]')
  })
})
