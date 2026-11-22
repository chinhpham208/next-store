// Created once: constructing Intl.DateTimeFormat is expensive relative to format(). timeZone UTC because the date is
// built with Date.UTC: in the machine's zone, a build west of UTC would print the day before.
const VI_DATE_FORMATTER = new Intl.DateTimeFormat('vi-VN', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

// Throws rather than printing "Invalid Date": the dates come from the post registry, so a bad one is a bug that the
// registry test and the build should catch, not something a reader should see.
export const formatDate = (isoDate: string): string => {
  const match = ISO_DATE.exec(isoDate)
  if (!match) throw new RangeError('formatDate: expected YYYY-MM-DD')
  const [year, month, day] = match.slice(1).map(Number)
  if (year === undefined || month === undefined || day === undefined) throw new RangeError('formatDate: expected YYYY-MM-DD')
  const date = new Date(Date.UTC(year, month - 1, day))
  // Date.UTC rolls 2026-02-30 over to 2 March; a round trip catches days and months that do not exist.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new RangeError('formatDate: not a calendar date')
  }
  return VI_DATE_FORMATTER.format(date)
}
