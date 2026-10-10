import { describe, expect, it } from 'vitest'
import {
  initialUpdateStatus,
  reduceUpdateStatus
} from '../src/main/update/update-state'

describe('desktop update state', () => {
  it('tracks an automatic download from discovery through completion', () => {
    let status = initialUpdateStatus('1.0.0')
    status = reduceUpdateStatus(status, { type: 'check', manual: false })
    status = reduceUpdateStatus(status, { type: 'available', version: '1.1.0' })
    status = reduceUpdateStatus(status, { type: 'progress', percent: 52.37, version: '1.1.0' })

    expect(status).toEqual({
      phase: 'downloading',
      currentVersion: '1.0.0',
      availableVersion: '1.1.0',
      percent: 52.4,
      manual: false
    })

    status = reduceUpdateStatus(status, { type: 'downloaded', version: '1.1.0' })
    expect(status).toEqual({
      phase: 'downloaded',
      currentVersion: '1.0.0',
      availableVersion: '1.1.0',
      manual: false
    })
  })

  it('preserves whether a check was initiated from the application menu', () => {
    let status = initialUpdateStatus('1.0.0')
    status = reduceUpdateStatus(status, { type: 'check', manual: true })
    status = reduceUpdateStatus(status, { type: 'not-available' })

    expect(status.phase).toBe('up-to-date')
    expect(status.manual).toBe(true)
  })

  it('carries downgrade through transient events and clears it on reset', () => {
    const base = { ...initialUpdateStatus('1.5.0'), downgrade: true }
    expect(reduceUpdateStatus(base, { type: 'available', version: '1.2.0' }).downgrade).toBe(true)
    expect(reduceUpdateStatus(base, { type: 'progress', percent: 40, version: '1.2.0' }).downgrade).toBe(true)
    expect(reduceUpdateStatus(base, { type: 'downloaded', version: '1.2.0' }).downgrade).toBe(true)
    expect(reduceUpdateStatus(base, { type: 'reset' }).downgrade).toBeUndefined()
  })

  it('clamps invalid download percentages', () => {
    const status = {
      ...initialUpdateStatus('1.0.0'),
      availableVersion: '1.1.0'
    }

    expect(reduceUpdateStatus(status, { type: 'progress', percent: -5, version: '1.1.0' }).percent).toBe(0)
    expect(reduceUpdateStatus(status, { type: 'progress', percent: 140, version: '1.1.0' }).percent).toBe(100)
    expect(
      reduceUpdateStatus(status, { type: 'progress', percent: Number.NaN, version: '1.1.0' }).percent
    ).toBe(0)
  })
})

describe('progress after a skip', () => {
  it('keeps naming the version being downloaded once a skip reset the status', () => {
    let status = reduceUpdateStatus(initialUpdateStatus('1.0.0'), { type: 'available', version: '1.1.0' })
    status = reduceUpdateStatus(status, { type: 'reset' })
    status = reduceUpdateStatus(status, { type: 'progress', percent: 30, version: '1.1.0' })
    expect(status).toMatchObject({ phase: 'downloading', availableVersion: '1.1.0', percent: 30 })
  })
})
