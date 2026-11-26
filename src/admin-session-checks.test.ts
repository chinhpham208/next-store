import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// Audit PR #106 H1 / L1 (ADR-0018 "Sửa theo audit PR #106", conventions.md §2). The (protected) layout is not what
// keeps a page's content in: the App Router renders a page alongside its layout, not inside it, so a page under a
// layout that redirect()s still runs and its content still reaches the flight payload and the prerendered
// `.segments/*.rsc` (measured on `next start` with the proxy's admin matcher removed). So every admin page checks the
// session itself, first. Server Action ids are global: an action can be posted to /admin/login, where the proxy lets
// everything through, so every admin action and admin read checks the session itself, first, too. Read from the
// source: the order is what matters, and a render test would not show what Next.js does.

const PROTECTED_ROOT = 'src/app/admin/(protected)'
// The admin pages that are not under (protected), each on purpose: the login page, and /admin, a static redirect to
// /admin/products that renders nothing (the proxy answers it without a session before it runs).
const UNPROTECTED_ADMIN_PAGES = ['src/app/admin/login/page.tsx', 'src/app/admin/page.tsx']

// Admin Server Actions and admin reads. Task 9 adds src/features/products/actions.ts (updateProductAction) and
// admin-queries.ts (listProductsForAdmin, getProductForAdmin) at these paths; a file is checked once it exists.
const ADMIN_ACTION_FILES = ['src/features/admin/actions.ts', 'src/features/products/actions.ts']
const ADMIN_READ_FILES = ['src/features/products/admin-queries.ts']
// The only admin actions that run without a session (ADR-0018: logging in, and logging out whatever the cookie holds).
const SESSIONLESS_ACTIONS = ['loginAction', 'logoutAction']
// Every other file with a 'use server' directive: the shop's actions, which need no admin session.
const SHOP_ACTION_FILES = ['src/features/cart/actions.ts']

// Paths relative to the repo root (Vitest's cwd), with forward slashes.
const filesUnder = (root: string, name: RegExp): string[] =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && name.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name).split('\\').join('/'))
    .sort()

const parse = (source: string): ts.SourceFile =>
  ts.createSourceFile('file.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind)

const unwrap = (node: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node)

// `await <name>()`, no arguments.
const isAwaitedCall = (node: ts.Expression, name: string): boolean => {
  const inner = unwrap(node)
  if (!ts.isAwaitExpression(inner)) return false
  const call = unwrap(inner.expression)
  return (
    ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.expression.text === name && call.arguments.length === 0
  )
}

type ExportedFunction = { name: string; isDefault: boolean; node: ts.FunctionLikeDeclaration }

const isFunctionValue = (node: ts.Expression | undefined): node is ts.ArrowFunction | ts.FunctionExpression =>
  node !== undefined && (ts.isArrowFunction(node) || ts.isFunctionExpression(node))

// Exported functions in the forms this repo writes: `export (default) async function f`, `export const f = async () =>`.
// Any other way of exporting (`export { f }`, `export default f`, `export default async () =>`) is reported, so a
// function cannot slip past the check by its spelling.
const exportedFunctions = (file: ts.SourceFile): { functions: ExportedFunction[]; problems: string[] } => {
  const functions: ExportedFunction[] = []
  const problems: string[] = []
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
      functions.push({ name: statement.name?.text ?? 'default', isDefault, node: statement })
    } else if (ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        if (isFunctionValue(declaration.initializer) && ts.isIdentifier(declaration.name)) {
          functions.push({ name: declaration.name.text, isDefault: false, node: declaration.initializer })
        }
      }
    } else if (ts.isExportAssignment(statement) || (ts.isExportDeclaration(statement) && !statement.isTypeOnly)) {
      problems.push(`unsupported export form: ${statement.getText(file).slice(0, 60)}`)
    }
  }
  return { functions, problems }
}

// An `await` outside every function runs when the module loads, before any check.
const topLevelAwaits = (file: ts.SourceFile): number => {
  let count = 0
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return
    if (ts.isAwaitExpression(node) || (ts.isForOfStatement(node) && node.awaitModifier !== undefined)) count += 1
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(file, visit)
  return count
}

const firstStatement = (fn: ts.FunctionLikeDeclaration): ts.Statement | undefined =>
  fn.body !== undefined && ts.isBlock(fn.body) ? fn.body.statements[0] : undefined

const isAsync = (fn: ts.FunctionLikeDeclaration): boolean => hasModifier(fn, ts.SyntaxKind.AsyncKeyword)

const importsFrom = (file: ts.SourceFile, name: string, specifier: string): boolean =>
  file.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === specifier &&
      statement.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some((element) => element.name.text === name),
  )

/**
 * A page under (protected): `export default async function`, and every exported function (the page, generateMetadata,
 * generateViewport…) starts with `await requireAdminPage()`, before reading params, data or anything else. No await
 * at module level. Returns what is wrong, empty when the page is right.
 */
const protectedPageProblems = (source: string): string[] => {
  const file = parse(source)
  const { functions, problems } = exportedFunctions(file)
  if (!importsFrom(file, 'requireAdminPage', '@/features/admin')) problems.push('does not import requireAdminPage from @/features/admin')
  if (topLevelAwaits(file) > 0) problems.push('awaits at module level')
  const page = functions.find((fn) => fn.isDefault)
  if (page === undefined) problems.push('has no `export default async function` page')
  for (const fn of functions) {
    if (!isAsync(fn.node)) {
      problems.push(`${fn.name} is not async, so it cannot check the session first`)
      continue
    }
    const first = firstStatement(fn.node)
    const checksFirst = first !== undefined && ts.isExpressionStatement(first) && isAwaitedCall(first.expression, 'requireAdminPage')
    if (!checksFirst) problems.push(`${fn.name} does not start with \`await requireAdminPage()\``)
  }
  return problems
}

// `if (!(await hasAdminSession())) …` whose branch leaves the function (return or throw).
const leaves = (node: ts.Statement): boolean => {
  if (ts.isReturnStatement(node) || ts.isThrowStatement(node)) return true
  if (ts.isBlock(node)) {
    const last = node.statements.at(-1)
    return last !== undefined && leaves(last)
  }
  return false
}

const isSessionRefusal = (statement: ts.Statement | undefined): boolean => {
  if (statement === undefined || !ts.isIfStatement(statement) || statement.elseStatement !== undefined) return false
  const condition = unwrap(statement.expression)
  return (
    ts.isPrefixUnaryExpression(condition) &&
    condition.operator === ts.SyntaxKind.ExclamationToken &&
    isAwaitedCall(condition.operand, 'hasAdminSession') &&
    leaves(statement.thenStatement)
  )
}

/**
 * An admin action or read file: every exported function but `allowed` starts with
 * `if (!(await hasAdminSession())) return … / throw …`, before parsing input or touching the database.
 */
const sessionFirstProblems = (source: string, allowed: readonly string[] = []): string[] => {
  const file = parse(source)
  const { functions, problems } = exportedFunctions(file)
  if (topLevelAwaits(file) > 0) problems.push('awaits at module level')
  for (const fn of functions) {
    if (allowed.includes(fn.name)) continue
    if (!isAsync(fn.node) || !isSessionRefusal(firstStatement(fn.node))) {
      problems.push(`${fn.name} does not start with \`if (!(await hasAdminSession())) return/throw\``)
    }
  }
  return problems
}

const GOOD_PAGE = `import { requireAdminPage } from '@/features/admin'
export const metadata = { title: 'Sản phẩm' }
export async function generateMetadata({ params }: PageProps<'/admin/products/[slug]'>) {
  await requireAdminPage()
  const { slug } = await params
  return { title: slug }
}
export default async function Page({ params }: PageProps<'/admin/products/[slug]'>) {
  await requireAdminPage()
  const product = await getProductForAdmin((await params).slug)
  return <h1>{product.name}</h1>
}`

describe('protectedPageProblems (audit PR #106 H1)', () => {
  it('accepts a page and generateMetadata that check the session first', () => {
    expect(protectedPageProblems(GOOD_PAGE)).toEqual([])
  })

  it.each([
    [
      'reads data before the check',
      `import { requireAdminPage } from '@/features/admin'
export default async function Page() {
  const rows = await listProductsForAdmin()
  await requireAdminPage()
  return <p>{rows.length}</p>
}`,
      'Page does not start with `await requireAdminPage()`',
    ],
    [
      'never checks',
      `import { requireAdminPage } from '@/features/admin'
export default async function Page() {
  return <h1>BI-MAT</h1>
}`,
      'Page does not start with `await requireAdminPage()`',
    ],
    [
      'is a synchronous page',
      `import { requireAdminPage } from '@/features/admin'
export default function Page() {
  return <h1>BI-MAT</h1>
}`,
      'Page is not async, so it cannot check the session first',
    ],
    [
      'calls the check without awaiting it',
      `import { requireAdminPage } from '@/features/admin'
export default async function Page() {
  requireAdminPage()
  return <h1>BI-MAT</h1>
}`,
      'Page does not start with `await requireAdminPage()`',
    ],
    [
      'reads params first',
      `import { requireAdminPage } from '@/features/admin'
export default async function Page({ params }: PageProps<'/admin/products/[slug]'>) {
  const { slug } = await params
  await requireAdminPage()
  return <h1>{slug}</h1>
}`,
      'Page does not start with `await requireAdminPage()`',
    ],
    [
      'has a generateMetadata that reads first',
      GOOD_PAGE.replace("{\n  await requireAdminPage()\n  const { slug }", '{\n  const { slug }'),
      'generateMetadata does not start with `await requireAdminPage()`',
    ],
    [
      'awaits at module level',
      `import { requireAdminPage } from '@/features/admin'
const rows = await listProductsForAdmin()
export default async function Page() {
  await requireAdminPage()
  return <p>{rows.length}</p>
}`,
      'awaits at module level',
    ],
    [
      'exports the page by name only',
      `import { requireAdminPage } from '@/features/admin'
const Page = async () => <h1>BI-MAT</h1>
export default Page`,
      'unsupported export form: export default Page',
    ],
    [
      'uses another requireAdminPage',
      `import { requireAdminPage } from './fake'
export default async function Page() {
  await requireAdminPage()
  return <h1>BI-MAT</h1>
}`,
      'does not import requireAdminPage from @/features/admin',
    ],
  ])('refuses a page that %s', (_, source, problem) => {
    expect(protectedPageProblems(source)).toContain(problem)
  })
})

describe('sessionFirstProblems (audit PR #106 L1)', () => {
  it('accepts actions and reads that refuse without a session first', () => {
    const source = `'use server'
export async function loginAction() { return 1 }
export async function updateProductAction(_: unknown, formData: FormData) {
  if (!(await hasAdminSession())) return { status: 'error', error: 'unauthorized' }
  return parse(formData)
}
export const listProductsForAdmin = async () => {
  if (!(await hasAdminSession())) {
    throw new Error('admin: no session')
  }
  return dbQuery({ name: 'products.admin-list' })
}`
    expect(sessionFirstProblems(source, SESSIONLESS_ACTIONS)).toEqual([])
  })

  it.each([
    [
      'parses before the check',
      `export async function updateProductAction(_: unknown, formData: FormData) {
  const input = parseProductEdit(formData)
  if (!(await hasAdminSession())) return { status: 'error', error: 'unauthorized' }
  return input
}`,
    ],
    ['never checks', `export async function deleteProductAction() { return dbQuery({ name: 'products.admin-delete' }) }`],
    [
      'checks without leaving the function',
      `export async function updateProductAction() {
  if (!(await hasAdminSession())) console.error('admin: no session')
  return dbQuery({ name: 'products.admin-update' })
}`,
    ],
    [
      'checks a non-awaited promise',
      `export const getProductForAdmin = async (slug: string) => {
  if (!hasAdminSession()) return null
  return dbQuery({ name: 'products.admin-get' })
}`,
    ],
  ])('refuses a function that %s', (_, source) => {
    expect(sessionFirstProblems(source, SESSIONLESS_ACTIONS)).toHaveLength(1)
  })

  it('refuses an export form it cannot read', () => {
    expect(sessionFirstProblems('const a = async () => 1\nexport { a }')).toEqual(['unsupported export form: export { a }'])
  })
})

describe('admin pages check the session themselves (audit PR #106 H1)', () => {
  const pages = existsSync(PROTECTED_ROOT) ? filesUnder(PROTECTED_ROOT, /^page\.tsx$/) : []

  it.each(pages.map((page) => [page]))('%s starts every export with await requireAdminPage()', (page) => {
    expect(protectedPageProblems(readFileSync(page, 'utf8'))).toEqual([])
  })

  it('every other admin page is one of the deliberate exceptions', () => {
    const outside = filesUnder('src/app/admin', /^page\.(t|j)sx?$/).filter((page) => !page.startsWith(`${PROTECTED_ROOT}/`))
    expect(outside).toEqual([...UNPROTECTED_ADMIN_PAGES].sort())
  })

  it('/admin itself only redirects, reading nothing', () => {
    const source = readFileSync('src/app/admin/page.tsx', 'utf8')
    expect(source).not.toMatch(/\bawait\b|cookies\(|headers\(|dbQuery|@\/features\/products/)
    expect(source).toMatch(/redirect\("\/admin\/products"\)/)
  })
})

describe('admin actions and reads check the session themselves (audit PR #106 L1)', () => {
  it.each(ADMIN_ACTION_FILES.filter((file) => existsSync(file)).map((file) => [file]))(
    '%s: every action but loginAction / logoutAction refuses without a session first',
    (file) => {
      expect(sessionFirstProblems(readFileSync(file, 'utf8'), SESSIONLESS_ACTIONS)).toEqual([])
    },
  )

  it.each(ADMIN_READ_FILES.filter((file) => existsSync(file)).map((file) => [file]))(
    '%s: every read refuses without a session first',
    (file) => {
      expect(sessionFirstProblems(readFileSync(file, 'utf8'))).toEqual([])
    },
  )

  it('the session-less actions are still the ones of the admin action file', () => {
    const { functions } = exportedFunctions(parse(readFileSync('src/features/admin/actions.ts', 'utf8')))
    expect(functions.map((fn) => fn.name)).toEqual(expect.arrayContaining(SESSIONLESS_ACTIONS))
  })

  it('every file with a use server directive is listed as admin or shop', () => {
    const withDirective = filesUnder('src', /\.tsx?$/)
      .filter((file) => !file.endsWith('.test.ts'))
      .filter((file) => /^\s*['"]use server['"]/m.test(readFileSync(file, 'utf8')))
    const listed = [...ADMIN_ACTION_FILES, ...SHOP_ACTION_FILES]
    expect(withDirective.filter((file) => !listed.includes(file))).toEqual([])
  })
})
