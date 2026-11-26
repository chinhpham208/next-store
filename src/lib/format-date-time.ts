// Created once: constructing Intl.DateTimeFormat is expensive relative to format(). Always the shop's own time zone,
// whatever the zone of the server or the browser: an admin reads "when" the same way on Vercel (UTC) and on a laptop.
// Explicit options, not dateStyle: 'short' (two-digit year); Gate 2 decision 11: "00:30 27/11/2026", 24-hour clock.
const VI_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export const formatDateTime = (date: Date): string => VI_DATE_TIME_FORMATTER.format(date)
