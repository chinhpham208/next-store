// A word that contains "--" (a CLI flag such as "--force"); the capture group keeps it in split()'s output.
const FLAG_WORD = /(\S*--\S*)/

// Browsers may wrap after a hyphen, splitting "--force" on narrow cards. Swapping in U+2011 would fix that, but
// Lexend has no U+2011 glyph (fallback font mid-word) and the heading text would no longer equal the image alt
// that the E2E contract matches on, so the flag word is kept whole with nowrap and the characters stay as typed.
// Shared by the card's h3 and the detail page's h1.
export const renderProductName = (name: string) =>
  name
    .split(FLAG_WORD)
    .map((part, index) =>
      index % 2 === 1 ? (
        <span key={index} className="whitespace-nowrap">
          {part}
        </span>
      ) : (
        part
      ),
    )
