import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

// "unoblox" is always lowercase, also at the start of a sentence
// (src/shared/brand.ts). Code identifiers such as UnobloxGlyph or
// UNOBLOX_API_KEY are not words of their own, so \b leaves them alone.
describe('brand casing', () => {
  it('never writes the brand as a capitalised word in tracked files', () => {
    let hits = ''
    try {
      // Built from parts so this file does not match its own pattern.
      const word = ['U', 'noblox'].join('')
      hits = execFileSync('git', ['grep', '-nP', `\\b(${word}|${word.toUpperCase()})\\b`, '--', '.', ':!package-lock.json'], { encoding: 'utf8' })
    } catch (error) {
      // git grep exits 1 when nothing matches.
      if ((error as { status?: number }).status !== 1) throw error
    }
    expect(hits).toBe('')
  })
})
