// Created once: constructing Intl.DateTimeFormat is expensive relative to format(). Always the shop's own time zone,
// whatever the zone of the server or the browser: an admin reads "when" the same way on Vercel (UTC) and on a laptop.
const VI_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  dateStyle: 'short',
  timeStyle: 'short',
})

export const formatDateTime = (date: Date): string => VI_DATE_TIME_FORMATTER.format(date)
