import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fitOgTitle, OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '@/lib/og-image'

const IMAGE_ROUTES = [
  'src/app/opengraph-image.tsx',
  'src/app/(shop)/products/[slug]/opengraph-image.tsx',
  'src/app/(shop)/blog/[slug]/opengraph-image.tsx',
]

// M3 K7, K8, K9: an async read or fetch makes the image route dynamic (ƒ) or a 500 at request time under Cache
// Components; woff2 and variable TTF fonts break ImageResponse; generateImageMetadata stops the prerender.
describe('open graph image sources', () => {
  it('reads fonts synchronously at module scope', () => {
    const source = readFileSync('src/lib/og-image.tsx', 'utf8')
    expect(source).toMatch(/readFileSync\(/)
    expect(source).not.toMatch(/readFile\(|fs\/promises|fetch\(/)
  })

  it.each(['lexend-regular.ttf', 'lexend-bold.ttf'])('%s is a static TrueType / OpenType font', (name) => {
    const font = readFileSync(`src/app/fonts/${name}`)
    expect(['00010000', '4f54544f']).toContain(font.subarray(0, 4).toString('hex')) // không phải 'wOF2'
    expect(font.includes(Buffer.from('fvar'))).toBe(false) // không phải variable
  })

  it('no image route uses generateImageMetadata or async file IO', () => {
    for (const file of IMAGE_ROUTES) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/generateImageMetadata|readFile\(|fetch\(/)
    }
  })

  it('every image route exports size, contentType and a fixed Vietnamese alt', () => {
    for (const file of IMAGE_ROUTES) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).toMatch(/export const size = OG_SIZE;/)
      expect(source, file).toMatch(/export const contentType = OG_CONTENT_TYPE;/)
      expect(source, file).toMatch(/export const alt = "[^"${}]+";/)
    }
  })
})

describe('fitOgTitle (Task 6 title rules)', () => {
  it.each([
    ['Đồ dùng cho dân code.', false, 96, 2],
    ['Chào mừng đến next-store', false, 96, 2],
    ['Vì sao cốc cà phê là công cụ debug tốt nhất', false, 72, 3],
    ['x'.repeat(49), false, 60, 3],
    ['Áo thun git push --force', true, 72, 3],
    ['Sách TypeScript thực chiến', true, 64, 3],
    ["Sticker It's not a bug, it's a feature", true, 64, 3],
    ['x'.repeat(41), true, 56, 3],
  ])('%s (illustration: %s) → %i px, %i lines', (title, hasIllustration, fontSize, lines) => {
    expect(fitOgTitle({ title, hasIllustration })).toEqual({ text: title, fontSize, lines })
  })

  it('counts code points, not UTF-16 units', () => {
    expect(fitOgTitle({ title: 'ệ'.normalize('NFD').repeat(12), hasIllustration: false }).fontSize).toBe(72)
    expect(fitOgTitle({ title: '😀'.repeat(24), hasIllustration: false }).fontSize).toBe(96)
  })

  it('cuts a long title at the last space before the limit, drops trailing punctuation and adds …', () => {
    expect(
      fitOgTitle({
        title: 'Sách Cấu trúc dữ liệu và giải thuật nâng cao cho kỳ phỏng vấn kỹ thuật đầu tiên của bạn',
        hasIllustration: true,
      }).text,
    ).toBe('Sách Cấu trúc dữ liệu và giải thuật nâng cao cho kỳ phỏng…')
    const cut = fitOgTitle({ title: `${'a'.repeat(70)}, b ${'c'.repeat(10)}`, hasIllustration: false }).text
    expect(cut).toBe(`${'a'.repeat(70)}, b…`)
    expect(fitOgTitle({ title: `${'abcd, '.repeat(11)}efgh`, hasIllustration: true }).text).toBe(
      `${'abcd, '.repeat(8)}abcd…`,
    )
  })

  it('keeps a title at the limit whole and trims surrounding whitespace', () => {
    expect(fitOgTitle({ title: 'a'.repeat(60), hasIllustration: true }).text).toBe('a'.repeat(60))
    expect(fitOgTitle({ title: '  Blog  ', hasIllustration: false }).text).toBe('Blog')
  })

  it('cuts a title with no space before the limit at the limit', () => {
    expect(fitOgTitle({ title: 'a'.repeat(80), hasIllustration: false }).text).toBe(`${'a'.repeat(74)}…`)
  })
})

describe('renderOgImage', () => {
  it('exposes the 1200 × 630 PNG contract', () => {
    expect(OG_SIZE).toEqual({ width: 1200, height: 630 })
    expect(OG_CONTENT_TYPE).toBe('image/png')
  })

  it('renders a 1200 × 630 PNG with Vietnamese text, ₫ and an illustration', async () => {
    const response = renderOgImage({
      eyebrow: 'Sách',
      title: 'Sách TypeScript thực chiến',
      footer: '450.000 ₫',
      illustration: 'sach',
    })
    expect(response.headers.get('content-type')).toBe('image/png')
    const png = Buffer.from(await response.arrayBuffer())
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(png.readUInt32BE(16)).toBe(1200)
    expect(png.readUInt32BE(20)).toBe(630)
  })
})
