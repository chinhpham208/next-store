import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatDate } from '@/lib/format-date'

describe('formatDate', () => {
  it('formats a YYYY-MM-DD date in Vietnamese', () => {
    expect(formatDate('2026-11-16')).toBe('16 tháng 11, 2026')
  })
  it('does not pad the day', () => {
    expect(formatDate('2026-10-05')).toBe('5 tháng 10, 2026')
  })
  it.each(['2026-02-30', '2026-13-01', '2026-00-10', '16/11/2026', '', '2026-11-16T00:00:00Z', ' 2026-11-16', '2026-1-16'])(
    'throws on %j',
    (value) => {
      expect(() => formatDate(value)).toThrow()
    },
  )
})

// The build machine's zone must never move the printed day. The formatter is created at module scope, so each case sets
// TZ first and then imports a fresh copy of the module: a formatter without timeZone 'UTC' would pick the stubbed zone
// up and print the day before west of UTC (verified: removing timeZone turns the Pago_Pago and GMT+12 cases red).
// Pacific/Pago_Pago (UTC−11) and Etc/GMT+12 (UTC−12) are the far west; Pacific/Kiritimati (UTC+14) the far east;
// America/St_Johns has a half-hour offset; Asia/Ho_Chi_Minh is where the readers are.
// Offset is Date#getTimezoneOffset() on 1 January 2026 (minutes, positive west of UTC).
describe.each([
  ['Pacific/Pago_Pago', 660],
  ['Etc/GMT+12', 720],
  ['Pacific/Kiritimati', -840],
  ['America/St_Johns', 210],
  ['Asia/Ho_Chi_Minh', -420],
])(
  'formatDate with TZ=%s',
  (zone, offset) => {
    beforeEach(() => {
      vi.stubEnv('TZ', zone)
      vi.resetModules()
    })
    afterEach(() => {
      vi.unstubAllEnvs()
      vi.resetModules()
    })

    // Compares the offset, not the name: ICU reports some zones by an alias (Asia/Ho_Chi_Minh → Asia/Saigon).
    it('applies the zone to the process (guards the test itself)', () => {
      expect(new Date(Date.UTC(2026, 0, 1)).getTimezoneOffset()).toBe(offset)
    })

    it.each([
      ['2026-01-01', '1 tháng 1, 2026'],
      ['2026-11-16', '16 tháng 11, 2026'],
      ['2026-12-31', '31 tháng 12, 2026'],
      ['2028-02-29', '29 tháng 2, 2028'],
    ])('keeps the calendar day of %s', async (isoDate, expected) => {
      const fresh = await import('@/lib/format-date')
      expect(fresh.formatDate(isoDate)).toBe(expected)
    })
  },
)
