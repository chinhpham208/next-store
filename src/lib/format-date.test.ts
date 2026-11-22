import { describe, expect, it } from 'vitest'
import { formatDate } from '@/lib/format-date'

describe('formatDate', () => {
  it('formats a YYYY-MM-DD date in Vietnamese', () => {
    expect(formatDate('2026-11-16')).toBe('16 tháng 11, 2026')
  })
  it('does not pad the day', () => {
    expect(formatDate('2026-10-05')).toBe('5 tháng 10, 2026')
  })
  it('keeps the calendar day whatever the time zone of the machine', () => {
    expect(formatDate('2026-01-01')).toBe('1 tháng 1, 2026')
    expect(formatDate('2026-12-31')).toBe('31 tháng 12, 2026')
  })
  it.each(['2026-02-30', '2026-13-01', '2026-00-10', '16/11/2026', '', '2026-11-16T00:00:00Z', ' 2026-11-16', '2026-1-16'])(
    'throws on %j',
    (value) => {
      expect(() => formatDate(value)).toThrow()
    },
  )
})
