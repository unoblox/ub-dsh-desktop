import { describe, expect, it } from 'vitest'
import { resolveHarnessLocale } from '../src/main/application-locale'

describe('application locale', () => {
  it('is English whatever the stored preference or system language (unoblox is English-only)', () => {
    expect(resolveHarnessLocale('en', ['zh-Hans-CN'])).toBe('en')
    expect(resolveHarnessLocale('zh', ['en-US'])).toBe('en')
    expect(resolveHarnessLocale(undefined, ['zh-Hans-CN', 'en-US'])).toBe('en')
    expect(resolveHarnessLocale(undefined, ['zh-Hant-TW'])).toBe('en')
    expect(resolveHarnessLocale(undefined, [])).toBe('en')
    expect(resolveHarnessLocale({ value: 'zh' }, ['es-ES'])).toBe('en')
  })
})
