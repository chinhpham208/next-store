import { describe, expect, it } from 'vitest'
import { toNonBreakingDashes } from './non-breaking-dashes'

const NB_HYPHEN = '‑'

describe('toNonBreakingDashes', () => {
  it('keeps "--force" on one line in "git push --force"', () => {
    expect(toNonBreakingDashes('git push --force')).toBe(`git push ${NB_HYPHEN}${NB_HYPHEN}force`)
  })
  it('converts every double dash', () => {
    expect(toNonBreakingDashes('--a --b')).toBe(`${NB_HYPHEN}${NB_HYPHEN}a ${NB_HYPHEN}${NB_HYPHEN}b`)
  })
  it('leaves single hyphens alone', () => {
    expect(toNonBreakingDashes('next-store')).toBe('next-store')
  })
})
