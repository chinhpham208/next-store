const NON_BREAKING_HYPHEN = '‑'

// Browsers may wrap after a plain hyphen, splitting CLI flags such as "--force" across lines on mobile.
export const toNonBreakingDashes = (text: string): string =>
  text.replaceAll('--', NON_BREAKING_HYPHEN + NON_BREAKING_HYPHEN)
