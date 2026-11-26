import { describe, expect, it } from 'vitest'
import { formatDateTime } from '@/lib/format-date-time'

describe('formatDateTime', () => {
  it('prints the time in Asia/Ho_Chi_Minh (UTC+7), whatever the zone of the machine', () => {
    // 2026-11-26 17:30 UTC is 00:30 on the 27th in Ho Chi Minh City.
    expect(formatDateTime(new Date('2026-11-26T17:30:00.000Z'))).toBe('00:30 27/11/26')
  })

  it('has no seconds and no zone name', () => {
    expect(formatDateTime(new Date('2026-01-05T03:04:59.000Z'))).toBe('10:04 5/1/26')
  })
})
