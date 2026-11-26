import { describe, expect, it } from 'vitest'
import {
  buildProductsHref,
  DEFAULT_PRODUCT_QUERY,
  isProductSlug,
  MAX_QUERY_LENGTH,
  PAGE_SIZE,
  parseProductEdit,
  parseProductQuery,
  PRODUCT_EDIT_LIMITS,
  PRODUCT_SORTS,
  type ProductQuery,
} from './schema'

// Mirrors what Next.js hands a page: a plain object of decoded strings / string arrays.
const fromSearch = (search: string) => {
  const params: Record<string, string | string[]> = {}
  for (const [key, value] of new URLSearchParams(search)) {
    const previous = params[key]
    params[key] = previous === undefined ? value : [previous, value].flat()
  }
  return params
}

describe('constants', () => {
  it('exposes the listing constants', () => {
    expect(PRODUCT_SORTS).toEqual(['newest', 'price-asc', 'price-desc'])
    expect(PAGE_SIZE).toBe(12)
    expect(MAX_QUERY_LENGTH).toBe(60)
    expect(DEFAULT_PRODUCT_QUERY).toEqual({ category: null, sort: 'newest', q: '', page: 1 })
  })
})

describe('parseProductQuery', () => {
  it('returns defaults for an empty object', () => {
    expect(parseProductQuery({})).toEqual({ category: null, sort: 'newest', q: '', page: 1 })
  })
  it.each([null, undefined, 'page=2', 42, true, Symbol('x'), () => ({ page: '2' })])(
    'returns defaults when raw is %s',
    (raw) => {
      expect(parseProductQuery(raw)).toEqual(DEFAULT_PRODUCT_QUERY)
    },
  )
  it('returns a fresh object each time so callers cannot mutate the defaults', () => {
    const first = parseProductQuery(null)
    first.page = 7
    expect(parseProductQuery(null)).toEqual(DEFAULT_PRODUCT_QUERY)
    expect(DEFAULT_PRODUCT_QUERY.page).toBe(1)
    expect(Object.isFrozen(DEFAULT_PRODUCT_QUERY)).toBe(true)
  })
  it('accepts a full valid query', () => {
    expect(parseProductQuery({ category: 'ao-thun', sort: 'price-asc', q: 'git', page: '2' })).toEqual({
      category: 'ao-thun',
      sort: 'price-asc',
      q: 'git',
      page: 2,
    })
  })
  it.each(PRODUCT_SORTS)('accepts sort=%s', (sort) => {
    expect(parseProductQuery({ sort }).sort).toBe(sort)
  })
  it.each(['xyz', 'PRICE-ASC', 'price-asc ', 'toString', '__proto__', ''])('treats sort=%j as newest', (sort) => {
    expect(parseProductQuery({ sort }).sort).toBe('newest')
  })
  it('US-03: falls back to defaults for page=abc and sort=xyz without touching other fields', () => {
    expect(parseProductQuery({ category: 'coc', page: 'abc', sort: 'xyz' })).toEqual({
      category: 'coc',
      sort: 'newest',
      q: '',
      page: 1,
    })
  })
  it.each([
    '0',
    '00',
    '01',
    '-1',
    '+2',
    '1.5',
    '2.0',
    '1e3',
    '0x10',
    ' 2',
    '2 ',
    '',
    '10000',
    '99999999999999999999',
    '1e308',
    'Infinity',
    'NaN',
    '２',
    '٢',
    '2\n',
  ])('treats page=%j as page 1', (page) => {
    expect(parseProductQuery({ page }).page).toBe(1)
  })
  it('accepts page 9999', () => {
    expect(parseProductQuery({ page: '9999' }).page).toBe(9999)
  })
  it.each([2, BigInt(2), { toString: () => '2' }])('ignores a non-string page %s', (page) => {
    expect(parseProductQuery({ page }).page).toBe(1)
  })
  it.each(['ao-thun', 'coc', 'sticker', 'sach', 'a'.repeat(40)])('keeps category=%j', (category) => {
    expect(parseProductQuery({ category }).category).toBe(category)
  })
  it.each(['Ao-Thun', 'ao_thun', '-ao', 'ao-', 'ao--thun', '../etc', 'áo', 'ao thun', 'ao\n', 'a'.repeat(41), ''])(
    'drops category=%j',
    (category) => {
      expect(parseProductQuery({ category }).category).toBeNull()
    },
  )
  it('ignores repeated parameters', () => {
    expect(
      parseProductQuery({
        sort: ['price-asc', 'price-desc'],
        q: ['a', 'b'],
        page: ['2', '3'],
        category: ['coc', 'sach'],
      }),
    ).toEqual(DEFAULT_PRODUCT_QUERY)
  })
  it('ignores a repeated parameter without touching the others', () => {
    expect(parseProductQuery(fromSearch('sort=price-asc&sort=price-asc&category=coc&page=2'))).toEqual({
      category: 'coc',
      sort: 'newest',
      q: '',
      page: 2,
    })
  })
  it('ignores a single-element array', () => {
    expect(parseProductQuery({ page: ['2'], sort: ['price-asc'] })).toEqual(DEFAULT_PRODUCT_QUERY)
  })
  it('drops unknown keys', () => {
    expect(Object.keys(parseProductQuery({ page: '2', extra: 'x', limit: '1000' })).sort()).toEqual([
      'category',
      'page',
      'q',
      'sort',
    ])
  })
  it('trims q and cuts it to 60 characters', () => {
    expect(parseProductQuery({ q: '  Git  ' }).q).toBe('Git')
    expect(parseProductQuery({ q: 'a'.repeat(61) }).q).toBe('a'.repeat(60))
    expect(parseProductQuery({ q: 'a'.repeat(10_000) }).q).toBe('a'.repeat(60))
    expect(parseProductQuery({ q: `  ${'a'.repeat(70)}` }).q).toBe('a'.repeat(60))
  })
  it('trims leading whitespace before cutting q', () => {
    expect(parseProductQuery({ q: `${' '.repeat(200)}git` }).q).toBe('git')
  })
  it('trims whitespace left at the cut so the value round-trips', () => {
    expect(parseProductQuery({ q: `${'a'.repeat(59)} b` }).q).toBe('a'.repeat(59))
  })
  it('cuts q by characters, never splitting a surrogate pair', () => {
    const q = parseProductQuery({ q: '😀'.repeat(61) }).q
    expect(Array.from(q)).toHaveLength(60)
    expect(q.isWellFormed()).toBe(true)
  })
  it('keeps Vietnamese letters in q', () => {
    expect(parseProductQuery({ q: 'Áo thun ĐẸP' }).q).toBe('Áo thun ĐẸP')
  })
  it('drops q containing control characters', () => {
    expect(parseProductQuery({ q: 'a\u0000b' }).q).toBe('')
    expect(parseProductQuery({ q: 'a\nb' }).q).toBe('')
    expect(parseProductQuery({ q: 'git\n' }).q).toBe('')
    expect(parseProductQuery({ q: 'a\u001fb' }).q).toBe('')
    expect(parseProductQuery({ q: 'a\u007fb' }).q).toBe('')
  })
  it('drops q containing a lone surrogate', () => {
    expect(parseProductQuery({ q: 'a\uD800b' }).q).toBe('')
  })
  it('treats a whitespace-only q as empty', () => {
    expect(parseProductQuery({ q: ' 　  ' }).q).toBe('')
  })
  it('keeps %, _ and quotes in q for the query layer to escape', () => {
    expect(parseProductQuery({ q: "100%_'" }).q).toBe("100%_'")
  })
  it('does not decode %-sequences a second time', () => {
    expect(parseProductQuery(fromSearch('q=%2541&page=%32&category=%61o')).q).toBe('%41')
    expect(parseProductQuery(fromSearch('q=%2541&page=%2532&category=%2561o'))).toEqual({
      ...DEFAULT_PRODUCT_QUERY,
      q: '%41',
    })
  })

  describe('prototype pollution', () => {
    it('ignores an own __proto__ key', () => {
      const raw: unknown = JSON.parse('{"__proto__": {"page": "5", "sort": "price-asc"}, "q": "git"}')
      const query = parseProductQuery(raw)
      expect(query).toEqual({ ...DEFAULT_PRODUCT_QUERY, q: 'git' })
      expect(Object.getPrototypeOf(query)).toBe(Object.prototype)
      expect(Object.keys(query)).not.toContain('__proto__')
    })
    it('ignores a __proto__ search parameter', () => {
      const query = parseProductQuery(fromSearch('__proto__[page]=5&__proto__=x&constructor=y&page=3'))
      expect(query).toEqual({ ...DEFAULT_PRODUCT_QUERY, page: 3 })
    })
    it('does not pollute Object.prototype', () => {
      parseProductQuery(JSON.parse('{"__proto__": {"polluted": "yes"}, "constructor": {"prototype": {"polluted": "yes"}}}'))
      expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false)
    })
    it('ignores inherited properties', () => {
      const raw: unknown = Object.create({ page: '5', sort: 'price-asc', category: 'coc', q: 'git' })
      expect(parseProductQuery(raw)).toEqual(DEFAULT_PRODUCT_QUERY)
    })
    it('ignores a polluted Object.prototype', () => {
      Reflect.set(Object.prototype, 'page', '5')
      Reflect.set(Object.prototype, 'sort', 'price-asc')
      try {
        expect(parseProductQuery({})).toEqual(DEFAULT_PRODUCT_QUERY)
        expect(parseProductQuery({ q: 'git' })).toEqual({ ...DEFAULT_PRODUCT_QUERY, q: 'git' })
      } finally {
        Reflect.deleteProperty(Object.prototype, 'page')
        Reflect.deleteProperty(Object.prototype, 'sort')
      }
    })
    it('accepts a null-prototype object', () => {
      const raw: unknown = Object.assign(Object.create(null), { page: '2', sort: 'price-desc' })
      expect(parseProductQuery(raw)).toEqual({ ...DEFAULT_PRODUCT_QUERY, page: 2, sort: 'price-desc' })
    })
  })

  describe('with the searchParams Proxy of Next.js', () => {
    // Mirrors createVaryingSearchParams (next/dist/server/app-render/vary-params.js): a read only counts
    // towards the cache key when it goes through the get, has or ownKeys trap.
    const track = (target: Record<string, string | string[]>) => {
      const gets = new Map<string, number>()
      const tracked = new Set<string>()
      const proxy = new Proxy(target, {
        get: (object, prop, receiver) => {
          if (typeof prop === 'string') {
            gets.set(prop, (gets.get(prop) ?? 0) + 1)
            tracked.add(prop)
          }
          return Reflect.get(object, prop, receiver)
        },
        has: (object, prop) => {
          if (typeof prop === 'string') tracked.add(prop)
          return Reflect.has(object, prop)
        },
        ownKeys: (object) => {
          tracked.add('*')
          return Reflect.ownKeys(object)
        },
      })
      return { proxy, gets, tracked }
    }

    it('reads each present parameter through the get trap exactly once', () => {
      const { proxy, gets } = track({ category: 'coc', sort: 'price-asc', q: 'git', page: '2' })
      expect(parseProductQuery(proxy)).toEqual({ category: 'coc', sort: 'price-asc', q: 'git', page: 2 })
      expect(Object.fromEntries(gets)).toEqual({ category: 1, sort: 1, q: 1, page: 1 })
    })
    it('registers every key through a trap, even when the query is empty', () => {
      const { proxy, tracked } = track({})
      expect(parseProductQuery(proxy)).toEqual(DEFAULT_PRODUCT_QUERY)
      expect([...tracked].sort()).toEqual(['category', 'page', 'q', 'sort'])
    })
  })

  it('returns defaults for a revoked Proxy', () => {
    const { proxy, revoke } = Proxy.revocable({ page: '2' }, {})
    revoke()
    expect(parseProductQuery(proxy)).toEqual(DEFAULT_PRODUCT_QUERY)
  })

  it('never throws on hostile objects', () => {
    const throwing = {
      get page(): string {
        throw new Error('boom')
      },
      sort: 'price-asc',
    }
    const trap: unknown = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error('boom')
        },
        getOwnPropertyDescriptor: () => {
          throw new Error('boom')
        },
      },
    )
    expect(parseProductQuery(throwing)).toEqual({ ...DEFAULT_PRODUCT_QUERY, sort: 'price-asc' })
    expect(parseProductQuery(trap)).toEqual(DEFAULT_PRODUCT_QUERY)
    expect(parseProductQuery([])).toEqual(DEFAULT_PRODUCT_QUERY)
    expect(parseProductQuery(new URLSearchParams('page=2'))).toEqual(DEFAULT_PRODUCT_QUERY)
  })
})

describe('isProductSlug', () => {
  it.each(['ao-git-push-force', 'coc-giu-nhiet-localhost', 'a1', 'a'.repeat(80)])('accepts %s', (slug) => {
    expect(isProductSlug(slug)).toBe(true)
  })
  it.each([
    '',
    'Sai_Dang',
    'a/b',
    'a b',
    '-a',
    'a-',
    'a--b',
    'a'.repeat(81),
    'khong%00',
    'ao\n',
    '\nao',
    'áo',
    '__proto__',
    '..',
    'ao.html',
  ])('rejects %j', (slug) => {
    expect(isProductSlug(slug)).toBe(false)
  })
  // Audit PR #20 L5: a caller handing over an untyped value must get false, not a TypeError from .length / test().
  it.each([undefined, null, 42, ['ao-git-push-force'], { length: 3 }, Symbol('a')])('rejects the non-string %s', (value) => {
    expect(isProductSlug(value)).toBe(false)
  })
})

describe('buildProductsHref', () => {
  it('omits defaults', () => {
    expect(buildProductsHref({})).toBe('/products')
    expect(buildProductsHref(DEFAULT_PRODUCT_QUERY)).toBe('/products')
    expect(buildProductsHref({ category: undefined, q: undefined, sort: undefined, page: undefined })).toBe('/products')
  })
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 10000, Number.MAX_SAFE_INTEGER + 2])(
    'omits page %s, which parseProductQuery would not accept',
    (page) => {
      expect(buildProductsHref({ page, category: 'coc' })).toBe('/products?category=coc')
    },
  )
  it('keeps page 9999', () => {
    expect(buildProductsHref({ page: 9999 })).toBe('/products?page=9999')
  })
  it('omits an unknown sort', () => {
    const query: Partial<ProductQuery> = JSON.parse('{"sort": "xyz", "page": 2}')
    expect(buildProductsHref(query)).toBe('/products?page=2')
  })
  it('writes parameters in a fixed order', () => {
    expect(buildProductsHref({ page: 2, sort: 'price-asc', category: 'ao-thun' })).toBe(
      '/products?category=ao-thun&sort=price-asc&page=2',
    )
    expect(buildProductsHref({ page: 3, sort: 'price-desc', q: 'git', category: 'sach' })).toBe(
      '/products?category=sach&q=git&sort=price-desc&page=3',
    )
  })
  it('encodes q', () => {
    expect(buildProductsHref({ q: 'git push & pull' })).toBe('/products?q=git+push+%26+pull')
    expect(buildProductsHref({ q: '100%#=?+/' })).toBe('/products?q=100%25%23%3D%3F%2B%2F')
    expect(buildProductsHref({ q: 'áo' })).toBe('/products?q=%C3%A1o')
  })
  it('round-trips through parseProductQuery', () => {
    const query: ProductQuery = { category: 'sach', sort: 'price-desc', q: 'Git từ', page: 3 }
    const params = Object.fromEntries(new URL(buildProductsHref(query), 'http://x').searchParams)
    expect(parseProductQuery(params)).toEqual(query)
  })
  it.each(["100%_'", '&page=9&', '__proto__', 'a+b c', '😀 emoji', 'Áo thun ĐẸP'])(
    'round-trips q=%j',
    (q) => {
      const query: ProductQuery = { ...DEFAULT_PRODUCT_QUERY, q, page: 2 }
      expect(parseProductQuery(fromSearch(new URL(buildProductsHref(query), 'http://x').search))).toEqual(query)
    },
  )
})

describe('parseProductEdit (M5 Task 9, US-13)', () => {
  const UPDATED_AT = '2026-11-25T08:00:00.123456Z'
  const form = (fields: Record<string, string | undefined> = {}) => {
    const data = new FormData()
    const values: Record<string, string | undefined> = {
      slug: 'ao-git-push-force',
      expectedUpdatedAt: UPDATED_AT,
      name: 'Áo git push --force',
      price: '199000',
      description: 'Áo thun cotton.',
      stock: '12',
      ...fields,
    }
    for (const [key, value] of Object.entries(values)) if (value !== undefined) data.set(key, value)
    return data
  }

  it('reads a valid edit', () => {
    expect(parseProductEdit(form())).toEqual({
      ok: true,
      value: {
        slug: 'ao-git-push-force',
        expectedUpdatedAt: UPDATED_AT,
        name: 'Áo git push --force',
        price: 199000,
        description: 'Áo thun cotton.',
        stock: 12,
      },
    })
  })

  it('has the limits of the plan', () => {
    expect(PRODUCT_EDIT_LIMITS).toEqual({ nameMax: 120, descriptionMax: 2000, priceMax: 100_000_000, stockMax: 10_000 })
  })

  it('US-13: a negative price is a field error on price', () => {
    expect(parseProductEdit(form({ price: '-1' }))).toEqual({ ok: false, fieldErrors: { price: 'negative' } })
  })

  it.each(['', '   ', '\n\t'])('US-13: an empty or blank name is a field error on name (%j)', (name) => {
    expect(parseProductEdit(form({ name }))).toEqual({ ok: false, fieldErrors: { name: 'empty' } })
  })

  it.each(['1.5', '1e3', '', 'abc', '1.000', '0x10', '+5', '١٢'])('refuses %j as a price', (price) => {
    expect(parseProductEdit(form({ price }))).toEqual({ ok: false, fieldErrors: { price: 'not-integer' } })
  })

  it('accepts 0 and the maximum price, refuses one more', () => {
    expect(parseProductEdit(form({ price: '0' })).ok).toBe(true)
    expect(parseProductEdit(form({ price: '100000000' })).ok).toBe(true)
    expect(parseProductEdit(form({ price: '100000001' }))).toEqual({ ok: false, fieldErrors: { price: 'too-large' } })
    expect(parseProductEdit(form({ price: '9'.repeat(400) }))).toEqual({ ok: false, fieldErrors: { price: 'too-large' } })
  })

  it('refuses a stock of 10001, a negative or a fractional stock', () => {
    expect(parseProductEdit(form({ stock: '10000' })).ok).toBe(true)
    expect(parseProductEdit(form({ stock: '10001' }))).toEqual({ ok: false, fieldErrors: { stock: 'too-large' } })
    expect(parseProductEdit(form({ stock: '-3' }))).toEqual({ ok: false, fieldErrors: { stock: 'negative' } })
    expect(parseProductEdit(form({ stock: '2.5' }))).toEqual({ ok: false, fieldErrors: { stock: 'not-integer' } })
  })

  it('accepts updated_at exactly as getProductForAdmin writes it', () => {
    for (const expectedUpdatedAt of ['1970-01-01T00:00:00.000000Z', '2026-11-25T23:59:59.999999Z', '9999-12-31T23:59:59.999999Z']) {
      expect(parseProductEdit(form({ expectedUpdatedAt })).ok, expectedUpdatedAt).toBe(true)
    }
  })

  // Audit PR #107 L-2: String.prototype.trim() keeps format characters (\p{Cf}), so a zero-width space was saved as
  // the name and the shop showed an empty one.
  it.each(['\u200b', '\u200b \u200b', '\u2060\ufeff', '\u00a0\u200d', '\u3000\u180e'])(
    'US-13: a name of invisible characters only is empty (%j)',
    (name) => {
      expect(parseProductEdit(form({ name }))).toEqual({ ok: false, fieldErrors: { name: 'empty' } })
    },
  )

  it('a description of invisible characters only is empty', () => {
    expect(parseProductEdit(form({ description: '\u200b\n\u200b' }))).toEqual({
      ok: false,
      fieldErrors: { description: 'empty' },
    })
  })

  it('keeps an emoji joined by a zero-width joiner', () => {
    const parsed = parseProductEdit(form({ name: 'Áo 👩‍💻' }))
    expect(parsed.ok && parsed.value.name).toBe('Áo 👩‍💻')
  })

  it('a name stays on one line: a line break or a tab becomes one space', () => {
    const parsed = parseProductEdit(form({ name: 'Áo\nthun \r\n\t git' }))
    expect(parsed.ok && parsed.value.name).toBe('Áo thun git')
  })

  it('a description keeps its line breaks', () => {
    const parsed = parseProductEdit(form({ description: 'Dòng 1\nDòng 2\r\n\tDòng 3' }))
    expect(parsed.ok && parsed.value.description).toBe('Dòng 1\nDòng 2\r\n\tDòng 3')
  })

  // Audit PR #107 nit: the length was counted with the zeros.
  it('reads leading zeros as the number they spell', () => {
    const parsed = parseProductEdit(form({ price: '0000000000000001', stock: '007' }))
    expect(parsed.ok && parsed.value).toMatchObject({ price: 1, stock: 7 })
    expect(parseProductEdit(form({ price: '000' })).ok && parseProductEdit(form({ price: '000' }))).toMatchObject({
      value: { price: 0 },
    })
    expect(parseProductEdit(form({ price: `${'0'.repeat(400)}100000000` })).ok).toBe(true)
    expect(parseProductEdit(form({ price: `${'0'.repeat(400)}100000001` }))).toEqual({
      ok: false,
      fieldErrors: { price: 'too-large' },
    })
    expect(parseProductEdit(form({ stock: '-007' }))).toEqual({ ok: false, fieldErrors: { stock: 'negative' } })
  })

  it('trims name and description', () => {
    const parsed = parseProductEdit(form({ name: '  Áo  ', description: '\n Mô tả \n' }))
    expect(parsed.ok && parsed.value).toMatchObject({ name: 'Áo', description: 'Mô tả' })
  })

  it('counts characters, not UTF-16 units, against the limits', () => {
    expect(parseProductEdit(form({ name: '😀'.repeat(120) })).ok).toBe(true)
    expect(parseProductEdit(form({ name: 'a'.repeat(121) }))).toEqual({ ok: false, fieldErrors: { name: 'too-long' } })
    expect(parseProductEdit(form({ description: 'a'.repeat(2001) }))).toEqual({
      ok: false,
      fieldErrors: { description: 'too-long' },
    })
    expect(parseProductEdit(form({ description: ' ' }))).toEqual({ ok: false, fieldErrors: { description: 'empty' } })
  })

  it('reports every field error at once', () => {
    expect(parseProductEdit(form({ name: '', price: '-5', description: '', stock: 'x' }))).toEqual({
      ok: false,
      fieldErrors: { name: 'empty', price: 'negative', description: 'empty', stock: 'not-integer' },
    })
  })

  it.each([
    ['a malformed slug', { slug: 'Ao Git' }],
    ['a missing slug', { slug: undefined }],
    ['a date without zone', { expectedUpdatedAt: '2026-11-25T08:00:00' }],
    ['a date that is not a date', { expectedUpdatedAt: '2026-13-45T08:00:00Z' }],
    ['a missing expectedUpdatedAt', { expectedUpdatedAt: undefined }],
    ['a missing field', { stock: undefined }],
    ['a NUL in the name', { name: 'Áo\u0000' }],
    // Audit PR #107 L-1: these passed Zod and made Postgres throw (unavailable, updateTag, an error log).
    ['the year 0000', { expectedUpdatedAt: '0000-01-01T00:00:00.000000Z' }],
    ['a year before 1970', { expectedUpdatedAt: '1969-12-31T23:59:59.999999Z' }],
    ['milliseconds only', { expectedUpdatedAt: '2026-11-25T08:00:00.123Z' }],
    ['no fraction', { expectedUpdatedAt: '2026-11-25T08:00:00Z' }],
    ['an offset', { expectedUpdatedAt: '2026-11-25T08:00:00.123456+07:00' }],
    ['the 30th of February', { expectedUpdatedAt: '2026-02-30T08:00:00.123456Z' }],
    ['a five-digit year', { expectedUpdatedAt: '+12026-11-25T08:00:00.123456Z' }],
    // Audit PR #107 L-2: a control character the form cannot type (a bell); line breaks in a name are a space.
    ['a control character in the name', { name: 'Áo\u0007' }],
    ['a control character in the description', { description: 'Mô tả\u001b[31m' }],
  ])('refuses %s as a form error', (_, fields) => {
    expect(parseProductEdit(form(fields))).toEqual({ ok: false, fieldErrors: {}, formError: 'invalid' })
  })

  it('refuses a file or anything but FormData as a form error', () => {
    const data = form()
    data.set('name', new Blob(['x']))
    expect(parseProductEdit(data)).toEqual({ ok: false, fieldErrors: {}, formError: 'invalid' })
    expect(parseProductEdit({ slug: 'ao-git-push-force' })).toEqual({ ok: false, fieldErrors: {}, formError: 'invalid' })
    expect(parseProductEdit(null)).toEqual({ ok: false, fieldErrors: {}, formError: 'invalid' })
  })
})
