import 'server-only'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'

export const OG_SIZE = { width: 1200, height: 630 } as const
export const OG_CONTENT_TYPE = 'image/png'

export const OG_ILLUSTRATIONS = ['ao-thun', 'coc', 'sticker', 'sach'] as const
export type OgIllustration = (typeof OG_ILLUSTRATIONS)[number]

export const isOgIllustration = (value: string): value is OgIllustration =>
  OG_ILLUSTRATIONS.some((illustration) => illustration === value)

export type OgImageInput = {
  eyebrow: string
  title: string
  footer: string
  illustration?: OgIllustration
}

// Read synchronously at module scope, never inside the image function: an async read is uncached IO under Cache
// Components, which turns the route dynamic (ƒ) or, with generateStaticParams, into a 500 at request time (M3 K8).
// Static TTF only: ImageResponse rejects woff2 and breaks on a variable TTF (K7). Regenerate: design-system.md §3.
const FONT_REGULAR = readFileSync(join(process.cwd(), 'src/app/fonts/lexend-regular.ttf'))
const FONT_BOLD = readFileSync(join(process.cwd(), 'src/app/fonts/lexend-bold.ttf'))

const readIllustration = (name: OgIllustration): string =>
  `data:image/svg+xml;base64,${readFileSync(join(process.cwd(), 'public/images', `${name}.svg`)).toString('base64')}`

const ILLUSTRATION_SRC: Record<OgIllustration, string> = {
  'ao-thun': readIllustration('ao-thun'),
  coc: readIllustration('coc'),
  sticker: readIllustration('sticker'),
  sach: readIllustration('sach'),
}

// Same values as --color-inverse* in globals.css (the inverted band is identical in both themes); one theme because
// the image does not change with the viewer. Cyan only for the cursor block.
const COLOR = {
  background: '#0c0f12',
  foreground: '#e8eef0',
  muted: '#9ba2aa',
  border: '#38424c',
  accent: '#2ee6ea',
} as const

type TitleStep = { maxChars: number; fontSize: number; lines: number }

// Design system §2 "Ảnh Open Graph": size by code-point count; the column is 656 px beside an illustration, 1040 px
// without one.
const TITLE_STEPS: Record<'withIllustration' | 'without', readonly TitleStep[]> = {
  withIllustration: [
    { maxChars: 24, fontSize: 72, lines: 3 },
    { maxChars: 40, fontSize: 64, lines: 3 },
    { maxChars: Infinity, fontSize: 56, lines: 3 },
  ],
  without: [
    { maxChars: 24, fontSize: 96, lines: 2 },
    { maxChars: 48, fontSize: 72, lines: 3 },
    { maxChars: Infinity, fontSize: 60, lines: 3 },
  ],
}
const MAX_TITLE_CHARS = { withIllustration: 60, without: 75 } as const
const TRAILING_PUNCTUATION = /[\s.,:;!?·–-]+$/u

export type FittedTitle = { text: string; fontSize: number; lines: number }

// The word-boundary cut runs before lineClamp, which satori applies mid-word, so the ellipsis never splits a word.
export const fitOgTitle = ({ title, hasIllustration }: { title: string; hasIllustration: boolean }): FittedTitle => {
  const key = hasIllustration ? 'withIllustration' : 'without'
  const max = MAX_TITLE_CHARS[key]
  const chars = Array.from(title.trim())
  const text = chars.length <= max ? chars.join('') : cutAtWord(chars, max)
  const length = Array.from(text).length
  const step = TITLE_STEPS[key].find((candidate) => length <= candidate.maxChars) ?? { maxChars: Infinity, fontSize: 56, lines: 3 }
  return { text, fontSize: step.fontSize, lines: step.lines }
}

const cutAtWord = (chars: string[], max: number): string => {
  const head = chars.slice(0, max - 1).join('')
  const lastSpace = head.lastIndexOf(' ')
  return `${(lastSpace > 0 ? head.slice(0, lastSpace) : head).replace(TRAILING_PUNCTUATION, '')}…`
}

// Synchronous: everything it reads was loaded above, so the image routes stay prerendered (K8).
export const renderOgImage = ({ eyebrow, title, footer, illustration }: OgImageInput): ImageResponse => {
  const fitted = fitOgTitle({ title, hasIllustration: illustration !== undefined })
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 80px',
          backgroundColor: COLOR.background,
          color: COLOR.foreground,
          fontFamily: 'Lexend',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-end', fontSize: 40, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1 }}>
          next-store
          <div style={{ width: 20, height: 20, marginLeft: 12, marginBottom: 2, backgroundColor: COLOR.accent }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 64 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24, flex: 1 }}>
            <div
              style={{
                fontSize: 24,
                fontWeight: 400,
                lineHeight: 1.33,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: COLOR.muted,
              }}
            >
              {eyebrow}
            </div>
            <div
              style={{
                display: 'block',
                fontSize: fitted.fontSize,
                fontWeight: 700,
                lineHeight: 1.1,
                letterSpacing: '-0.02em',
                lineClamp: fitted.lines,
              }}
            >
              {fitted.text}
            </div>
          </div>
          {illustration ? (
            // satori renders <img> only; next/image does not exist inside ImageResponse. Decorative: the route's alt
            // describes the whole image.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={ILLUSTRATION_SRC[illustration]}
              alt=""
              width={320}
              height={320}
              style={{ borderRadius: 16, border: `2px solid ${COLOR.border}` }}
            />
          ) : null}
        </div>
        <div
          style={{
            display: 'flex',
            borderTop: `2px solid ${COLOR.border}`,
            paddingTop: 32,
            fontSize: 32,
            fontWeight: 700,
            lineHeight: 1.25,
          }}
        >
          {footer}
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: 'Lexend', data: FONT_REGULAR, weight: 400, style: 'normal' },
        { name: 'Lexend', data: FONT_BOLD, weight: 700, style: 'normal' },
      ],
    },
  )
}
