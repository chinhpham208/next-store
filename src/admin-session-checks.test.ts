import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// Audit PR #106 H1 / L1 and its re-audit M-A, M-B, L-a, L-b (ADR-0018 "Sửa theo audit PR #106", conventions.md §2).
// The (protected) layout is not what keeps a page's content in: the App Router renders a page alongside its layout,
// not inside it, so a page under a layout that redirect()s still runs and its content still reaches the flight
// payload and the prerendered `.segments/*.rsc` (measured on `next start` with the proxy's admin matcher removed).
// The same holds for every other route file (a nested layout, a route handler, a loading file that reads data). So
// the admin area holds only the route files listed below, every page checks the session itself, first, and every
// admin action and admin read checks it too (Server Action ids are global: an action can be posted to /admin/login,
// where the proxy lets everything through). Read from the source: the order is what matters, and a render test would
// not show what Next.js does. Anything this file cannot read is reported, never skipped.

const APP_ROOT = 'src/app'
const ADMIN_ROOT = 'src/app/admin'
const PROTECTED_ROOT = 'src/app/admin/(protected)'

// Every file of the admin area outside (protected), each on purpose: the admin root layout (static metadata,
// noindex), /admin (a static redirect to /admin/products that reads nothing; the proxy answers it without a session
// first) and the login page.
const UNPROTECTED_ADMIN_FILES = ['src/app/admin/layout.tsx', 'src/app/admin/login/page.tsx', 'src/app/admin/page.tsx']
// The one layout under (protected): AdminGate inside <Suspense>, for the signed-in bar only. A nested layout would
// render alongside its page with no check of its own (re-audit M-A, t2), so there is no other.
const PROTECTED_LAYOUT = `${PROTECTED_ROOT}/layout.tsx`

const ROUTE_EXTENSION = /\.(tsx|ts|jsx|js)$/
// Route files under (protected) that only show fixed text: no data, no request, nothing async.
const STATIC_ROUTE_FILES = ['loading', 'error', 'not-found']
// What a static route file may import: React, links, shared UI. Never a feature, the database or the request.
// Only the shared UI folders (audit PR #108 L-1); dependency-cruiser `components-and-lib-not-to-db` keeps them off the
// database.
const STATIC_IMPORTS = /^(react|next|next\/link|@\/components\/(ui|layout)\/[a-z0-9-]+|@\/lib\/cn)$/

// Admin Server Actions. A new 'use server' file must be listed here or as a shop file (the net below).
const ADMIN_ACTION_FILES = ['src/features/admin/actions.ts', 'src/features/products/actions.ts']
// The only admin actions that run without a session (ADR-0018: logging in, and logging out whatever the cookie holds).
const SESSIONLESS_ACTIONS = ['loginAction', 'logoutAction']
// Every other file with a 'use server' directive: the shop's actions, which need no admin session.
const SHOP_ACTION_FILES = ['src/features/cart/actions.ts']
// Admin reads live in `src/features/<feature>/admin-queries.ts` (re-audit L-b): found by name, not by a fixed list,
// and an exported `…ForAdmin` function anywhere else is reported.
const ADMIN_READ_FILE = /^src\/features\/[^/]+\/admin-queries\.ts$/
const ADMIN_READ_NAME = /ForAdmin$/
// Where the two checks come from, imported by their own name (re-audit L-a).
const SESSION_MODULES = ['@/features/admin', '@/features/admin/cookie']

// Page exports that are values, not functions; anything else exported as a value is reported (re-audit M-B).
const PAGE_VALUE_EXPORTS = ['metadata', 'viewport']

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

// Text, a number, true / false / null, or an array or object of those, all the way down: nothing runs when the
// module loads and nothing is read (audit PR #107 M-1: `{ title: secretRows() }` ran the call inside).
const isLiteralValue = (node: ts.Expression): boolean => {
  const inner = unwrap(node)
  if (ts.isSatisfiesExpression(inner) || ts.isAsExpression(inner)) return isLiteralValue(inner.expression)
  if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner) || ts.isNumericLiteral(inner)) return true
  if ([ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(inner.kind)) return true
  if (ts.isPrefixUnaryExpression(inner)) return inner.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(inner.operand)
  if (ts.isArrayLiteralExpression(inner)) return inner.elements.every((element) => !ts.isSpreadElement(element) && isLiteralValue(element))
  if (ts.isObjectLiteralExpression(inner)) {
    return inner.properties.every(
      (property) =>
        ts.isPropertyAssignment(property) &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
        isLiteralValue(property.initializer),
    )
  }
  return false
}

// `{ … }`, `{ … } satisfies T` or `{ … } as const` holding literals only: a plain value, nothing runs.
const isObjectValue = (node: ts.Expression | undefined): boolean => {
  if (node === undefined) return false
  if (ts.isSatisfiesExpression(node) || ts.isAsExpression(node)) return isObjectValue(node.expression)
  return ts.isObjectLiteralExpression(unwrap(node)) && isLiteralValue(node)
}

const snippet = (node: ts.Node, file: ts.SourceFile): string => node.getText(file).replace(/\s+/g, ' ').slice(0, 60)

// Exported functions in the forms this repo writes: `export (default) async function f`, `export const f = async () =>`.
// Every other export is reported (`export { f }`, `export default f`, `export const f = cache(async () => …)`,
// `export const f = withLog(…)`, a class, a destructuring): a wrapper runs before the function it wraps, so the
// check could not be first, and a function must not slip past the check by its spelling (re-audit M-B). Only the
// names in `values` may be exported as a plain object (a page's metadata).
const exportedFunctions = (
  file: ts.SourceFile,
  values: readonly string[] = [],
): { functions: ExportedFunction[]; problems: string[] } => {
  const functions: ExportedFunction[] = []
  const problems: string[] = []
  for (const statement of file.statements) {
    const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    if (ts.isFunctionDeclaration(statement) && exported) {
      const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
      functions.push({ name: statement.name?.text ?? 'default', isDefault, node: statement })
    } else if (ts.isVariableStatement(statement) && exported) {
      for (const declaration of statement.declarationList.declarations) {
        const name = ts.isIdentifier(declaration.name) ? declaration.name.text : undefined
        if (name !== undefined && isFunctionValue(declaration.initializer)) {
          functions.push({ name, isDefault: false, node: declaration.initializer })
        } else if (name === undefined || !values.includes(name) || !isObjectValue(declaration.initializer)) {
          problems.push(`unsupported export form: ${snippet(declaration, file)}`)
        }
      }
    } else if (ts.isExportAssignment(statement) || (ts.isExportDeclaration(statement) && !statement.isTypeOnly)) {
      problems.push(`unsupported export form: ${snippet(statement, file)}`)
    } else if (exported && !ts.isTypeAliasDeclaration(statement) && !ts.isInterfaceDeclaration(statement)) {
      problems.push(`unsupported export form: ${snippet(statement, file)}`)
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

const importDeclarations = (file: ts.SourceFile): ts.ImportDeclaration[] => file.statements.filter(ts.isImportDeclaration)

// `import { name } from '<one of specifiers>'`, under its own name: `import { hasAdminSession as requireAdminPage }`
// does not count (re-audit L-a).
const importsByOwnName = (file: ts.SourceFile, name: string, specifiers: readonly string[]): boolean =>
  importDeclarations(file).some((statement) => {
    const bindings = statement.importClause?.namedBindings
    return (
      ts.isStringLiteral(statement.moduleSpecifier) &&
      specifiers.includes(statement.moduleSpecifier.text) &&
      statement.importClause?.isTypeOnly !== true &&
      bindings !== undefined &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some((element) => element.name.text === name && element.propertyName === undefined && !element.isTypeOnly)
    )
  })

// Any other binding of the same name (a local function, a variable, a parameter, another import's alias) would be
// what `await name()` calls, so the check would not be the real one.
const bindsLocally = (file: ts.SourceFile, name: string): boolean => {
  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    const declared =
      ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) &&
        ts.isIdentifier(node.name) &&
        node.name.text === name) ||
      ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node)) &&
        node.name?.text === name)
    if (declared) found = true
    else ts.forEachChild(node, visit)
  }
  ts.forEachChild(file, visit)
  return found
}

const checkSourceProblems = (file: ts.SourceFile, name: string, specifiers: readonly string[]): string[] => {
  const problems: string[] = []
  if (!importsByOwnName(file, name, specifiers)) problems.push(`does not import ${name} by its own name from ${specifiers.join(' or ')}`)
  if (bindsLocally(file, name)) problems.push(`declares its own ${name}`)
  return problems
}

/**
 * A page under (protected): `export default async function`, and every exported function (the page, generateMetadata,
 * generateViewport…) starts with `await requireAdminPage()`, before reading params, data or anything else. No await
 * at module level. Returns what is wrong, empty when the page is right.
 */
const protectedPageProblems = (source: string): string[] => {
  const file = parse(source)
  const { functions, problems } = exportedFunctions(file, PAGE_VALUE_EXPORTS)
  problems.push(...checkSourceProblems(file, 'requireAdminPage', ['@/features/admin']))
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

/**
 * loading / error / not-found under (protected), and the admin root layout: fixed text only. Nothing async, no await,
 * imports only React, links and shared UI. Such a file renders without a page check (loading is prerendered into
 * `.segments/*.rsc`, re-audit M-A t5), so it must have nothing to hide.
 */
const specifierText = (node: ts.Node | undefined): string => (node !== undefined && ts.isStringLiteralLike(node) ? node.text : '?')

// Every module the file pulls in at run time, whatever the spelling: `import … from`, `import x = require(…)`,
// `import(…)`, `require(…)`. `export … from` is listed apart (re-exports). Type-only imports are erased.
const runtimeImports = (file: ts.SourceFile): string[] => {
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly !== true) found.push(specifierText(node.moduleSpecifier))
    else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly) {
      const reference = node.moduleReference
      found.push(ts.isExternalModuleReference(reference) ? specifierText(reference.expression) : reference.getText(file))
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      found.push(specifierText(node.arguments[0]))
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(file, visit)
  return found
}

// A static file exports exactly `export default function …`, plus literal `metadata` / `viewport` (the admin root
// layout), and types. A re-export (`export { default } from …`, `export * from …`) would serve another module's
// code with no check of its import list (audit PR #107 M-1); anything else is reported as an unsupported form.
const staticExportProblems = (file: ts.SourceFile): string[] => {
  const problems: string[] = []
  for (const statement of file.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue
      problems.push(
        statement.moduleSpecifier === undefined
          ? `unsupported export form: ${snippet(statement, file)}`
          : `re-exports ${specifierText(statement.moduleSpecifier)}`,
      )
      continue
    }
    if (ts.isExportAssignment(statement)) {
      problems.push(`unsupported export form: ${snippet(statement, file)}`)
      continue
    }
    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue
    if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) continue
    if (ts.isFunctionDeclaration(statement) && hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) continue
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const name = ts.isIdentifier(declaration.name) ? declaration.name.text : undefined
        if (name === undefined || !PAGE_VALUE_EXPORTS.includes(name) || !isObjectValue(declaration.initializer)) {
          problems.push(`unsupported export form: ${snippet(declaration, file)}`)
        }
      }
      continue
    }
    problems.push(`unsupported export form: ${snippet(statement, file)}`)
  }
  return problems
}

// `process` (the env, above all) is a global: no import list catches it (audit PR #107 M-1).
const readsProcess = (file: ts.SourceFile): boolean => {
  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    if (ts.isIdentifier(node) && node.text === 'process') found = true
    else ts.forEachChild(node, visit)
  }
  ts.forEachChild(file, visit)
  return found
}

const staticRouteProblems = (source: string): string[] => {
  const file = parse(source)
  const problems: string[] = []
  let awaits = 0
  let asyncFunctions = 0
  const visit = (node: ts.Node): void => {
    if (ts.isAwaitExpression(node) || (ts.isForOfStatement(node) && node.awaitModifier !== undefined)) awaits += 1
    if (ts.isFunctionLike(node) && hasModifier(node, ts.SyntaxKind.AsyncKeyword)) asyncFunctions += 1
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(file, visit)
  if (awaits > 0) problems.push('awaits')
  if (asyncFunctions > 0) problems.push('has an async function')
  for (const specifier of runtimeImports(file)) {
    if (!STATIC_IMPORTS.test(specifier)) problems.push(`imports ${specifier}`)
  }
  problems.push(...staticExportProblems(file))
  if (readsProcess(file)) problems.push('reads process')
  // A second net only: the import list above is what keeps data out.
  if (/\b(dbQuery|cookies|headers|connection)\s*\(/.test(source)) problems.push('reads data or the request')
  return problems
}

// The repo uses the App Router only. A file under pages/ or src/pages/ is a route with none of the checks of this
// file: measured, src/pages/admin/zz.tsx built as `○ /admin/zz` and served its content with a session cookie, kept
// out only by the proxy (audit PR #107 M-1). Paths relative to the repo root.
const PAGES_ROUTER_FILE = /^(src\/)?pages\//
const routerRootProblems = (paths: readonly string[]): string[] =>
  paths.filter((path) => PAGES_ROUTER_FILE.test(path)).map((path) => `${path}: the Pages Router is not used (conventions.md §2)`)

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
 * `if (!(await hasAdminSession())) return … / throw …`, before parsing input or touching the database, and that
 * hasAdminSession is the one of @/features/admin, under its own name.
 */
const sessionFirstProblems = (source: string, allowed: readonly string[] = []): string[] => {
  const file = parse(source)
  const { functions, problems } = exportedFunctions(file)
  if (topLevelAwaits(file) > 0) problems.push('awaits at module level')
  const checked = functions.filter((fn) => !allowed.includes(fn.name))
  if (checked.length > 0) problems.push(...checkSourceProblems(file, 'hasAdminSession', SESSION_MODULES))
  for (const fn of checked) {
    if (!isAsync(fn.node) || !isSessionRefusal(firstStatement(fn.node))) {
      problems.push(`${fn.name} does not start with \`if (!(await hasAdminSession())) return/throw\``)
    }
  }
  return problems
}

type AppFile = { path: string; source: string }

// A path segment that is `admin` once a route group, a parallel slot or an interception marker is set aside:
// `(.)admin`, `Admin`. Route groups do not change the URL, so `src/app/(shop)/admin/x` serves /admin/x (re-audit M-A).
const isAdminSegment = (segment: string): boolean => segment.replace(/^(\(\.{1,3}\))+/, '').toLowerCase() === 'admin'

// Audit PR #108 L-2: `[x]`, `[...x]` and `[[...x]]` as the first URL segment match `admin`, so with a valid session
// such a page would answer /admin/foo (even /admin/_session-probe) with 200, outside every check of this file. Route
// groups and slots do not change the URL and an interception marker is set aside; a `_private` folder is no route.
// No such segment exists today; one that must exist goes in the list with its reason (ADR-0018).
const DYNAMIC_TOP_LEVEL_ALLOWED: readonly string[] = []
const firstUrlSegment = (segments: readonly string[]): string | undefined => {
  if (segments.some((segment) => segment.startsWith('_'))) return undefined
  return segments
    .filter((segment) => !/^\(.*\)$/.test(segment) && !segment.startsWith('@'))
    .map((segment) => segment.replace(/^(\(\.{1,3}\))+/, ''))
    .find((segment) => segment !== '')
}
const isDynamicSegment = (segment: string | undefined): boolean => segment !== undefined && /^\[.*\]$/.test(segment)

// Audit PR #108 L-2: next.config.ts and vercel.json route before the proxy's matcher sees the URL they serve, so a
// rewrite from a public path to /admin/… (or a redirect, basePath, i18n prefix) moves the admin area away from it.
// The repo uses none of them: every such key is refused, found as an identifier or a string anywhere in the config.
const NEXT_ROUTING_KEYS = ['rewrites', 'redirects', 'basePath', 'i18n']
const VERCEL_ROUTING_KEYS = ['rewrites', 'redirects', 'routes']
const routingConfigProblems = (nextConfig: string, vercelJson: string): string[] => {
  const names = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) names.add(node.text)
    else if (ts.isStringLiteralLike(node)) names.add(node.text)
    ts.forEachChild(node, visit)
  }
  visit(parse(nextConfig))
  const vercelKeys = Object.keys(JSON.parse(vercelJson) as Record<string, unknown>)
  return [
    ...NEXT_ROUTING_KEYS.filter((key) => names.has(key)).map((key) => `next.config.ts: ${key} is not used (conventions.md §2)`),
    ...VERCEL_ROUTING_KEYS.filter((key) => vercelKeys.includes(key)).map((key) => `vercel.json: ${key} is not used (conventions.md §2)`),
  ]
}

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
const routeName = (path: string): string => baseName(path).replace(ROUTE_EXTENSION, '')

/**
 * Every file of src/app that serves an /admin URL, by path, then by content: what is not listed is reported with
 * the reason, so a new kind of route file needs a decision (ADR-0018) before it can exist.
 */
const adminRouteProblems = (files: readonly AppFile[]): string[] => {
  const problems: string[] = []
  const report = (file: AppFile, found: readonly string[]) => problems.push(...found.map((problem) => `${file.path}: ${problem}`))
  for (const file of files) {
    if (file.path.endsWith('.test.ts')) continue
    const segments = file.path.slice(APP_ROOT.length + 1).split('/').slice(0, -1)
    const inAdminRoot = file.path.startsWith(`${ADMIN_ROOT}/`)
    if (!inAdminRoot) {
      if (segments.some(isAdminSegment)) report(file, ['an admin route outside src/app/admin'])
      else if (isDynamicSegment(firstUrlSegment(segments)) && !DYNAMIC_TOP_LEVEL_ALLOWED.includes(file.path)) {
        report(file, ['a dynamic top-level segment can serve /admin/*'])
      }
      continue
    }
    if (UNPROTECTED_ADMIN_FILES.includes(file.path)) continue
    if (!file.path.startsWith(`${PROTECTED_ROOT}/`)) {
      report(file, ['not one of the deliberate admin files outside (protected)'])
      continue
    }
    if (file.path === PROTECTED_LAYOUT) continue
    if (segments.some((segment) => segment.startsWith('@') || /^\(\.{1,3}\)/.test(segment))) {
      report(file, ['a parallel or intercepting route under (protected)'])
      continue
    }
    const name = routeName(file.path)
    if (!ROUTE_EXTENSION.test(file.path)) report(file, ['not a route file'])
    else if (name === 'page') report(file, protectedPageProblems(file.source))
    else if (STATIC_ROUTE_FILES.includes(name)) report(file, staticRouteProblems(file.source))
    else report(file, [`${baseName(file.path)} is not allowed under (protected)`])
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

const GOOD_NOT_FOUND = `import Link from 'next/link'
import { StatusMessage } from '@/components/layout/status-message'
export default function NotFound() {
  return <StatusMessage title="Không tìm thấy sản phẩm"><Link href="/admin/products">Về danh sách sản phẩm</Link></StatusMessage>
}`

// Renders data without any check: what a leaking route file looks like.
const LEAKY = `import { listProductsForAdmin } from '@/features/products'
export default async function Leak() {
  const rows = await listProductsForAdmin()
  return <p>{rows.length}</p>
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
      'does not import requireAdminPage by its own name from @/features/admin',
    ],
    // Re-audit L-a: measured, page t7 leaked BI-MAT-T7 this way.
    [
      'imports another function under the name requireAdminPage',
      `import { hasAdminSession as requireAdminPage } from '@/features/admin'
export default async function Page() {
  await requireAdminPage()
  return <h1>BI-MAT</h1>
}`,
      'does not import requireAdminPage by its own name from @/features/admin',
    ],
    [
      'shadows requireAdminPage with a parameter',
      `import { requireAdminPage } from '@/features/admin'
export async function generateMetadata(requireAdminPage: () => Promise<void>) {
  await requireAdminPage()
  return { title: 'BI-MAT' }
}
export default async function Page() {
  await requireAdminPage()
  return <h1>BI-MAT</h1>
}`,
      'declares its own requireAdminPage',
    ],
    // Re-audit M-B: a wrapped generateMetadata (measured: BI-MAT-META stayed green).
    [
      'wraps generateMetadata in cache()',
      GOOD_PAGE.replace(
        /export async function generateMetadata[\s\S]*?\n}\n/,
        "export const generateMetadata = cache(async () => ({ title: 'BI-MAT-META' }))\n",
      ),
      'unsupported export form: generateMetadata = cache(',
    ],
    [
      'exports metadata built by a call',
      GOOD_PAGE.replace("export const metadata = { title: 'Sản phẩm' }", 'export const metadata = buildMetadata()'),
      'unsupported export form: metadata = buildMetadata()',
    ],
    // Audit PR #107 M-1: the outer object was a literal, the call inside ran at module load.
    [
      'exports metadata with a call inside',
      GOOD_PAGE.replace("export const metadata = { title: 'Sản phẩm' }", 'export const metadata = { title: secretRows() }'),
      'unsupported export form: metadata = { title: secretRows() }',
    ],
    [
      'exports metadata reading the env',
      GOOD_PAGE.replace("export const metadata = { title: 'Sản phẩm' }", 'export const metadata = { title: process.env.X }'),
      'unsupported export form: metadata = { title: process.env.X }',
    ],
    [
      'exports another value',
      `${GOOD_PAGE}\nexport const dynamicParams = true`,
      'unsupported export form: dynamicParams = true',
    ],
  ])('refuses a page that %s', (_, source, problem) => {
    expect(protectedPageProblems(source)).toEqual(expect.arrayContaining([expect.stringContaining(problem)]))
  })
})

describe('staticRouteProblems (re-audit M-A)', () => {
  it('accepts fixed text with shared UI', () => {
    expect(staticRouteProblems(GOOD_NOT_FOUND)).toEqual([])
  })

  it.each([
    ['reads admin data', LEAKY, 'imports @/features/products'],
    ['awaits', `export default function Loading() { const x = await y; return <p>{x}</p> }`, 'awaits'],
    ['is async', `export default async function Loading() { return <p>…</p> }`, 'has an async function'],
    ['reads the request', `import { cookies } from 'next/headers'\nexport default function L() { cookies(); return null }`, 'imports next/headers'],
    // Audit PR #107 M-1: each one measured green before.
    [
      're-exports a component',
      `export { default } from '@/features/products/components/zz-leak'`,
      're-exports @/features/products/components/zz-leak',
    ],
    ['re-exports a whole feature', `export * from '@/features/products'`, 're-exports @/features/products'],
    // Audit PR #108 L-1: a component outside the shared UI folders (measured: @/components/zz/leak read the database).
    [
      'imports a component outside ui and layout',
      `import { Leak } from '@/components/zz/leak'\nexport default function L() { return <Leak /> }`,
      'imports @/components/zz/leak',
    ],
    ['re-exports under another name', `export { Leak as default } from './leak'`, 're-exports ./leak'],
    ['reads the env', `export default function NotFound() { return <p>{process.env.SESSION_SECRET}</p> }`, 'reads process'],
    ['imports the database at run time', `export default function L() { void import('@/db'); return null }`, 'imports @/db'],
    ['requires the database', `export default function L() { require('@/db'); return null }`, 'imports @/db'],
    ['imports with import = require', `import db = require('@/db')\nexport default function L() { return null }`, 'imports @/db'],
    [
      'exports metadata built by a call',
      `export const metadata = { title: secretRows() }\nexport default function L() { return null }`,
      'unsupported export form: metadata = { title: secretRows() }',
    ],
    [
      'exports metadata holding a variable',
      `const title = rows[0]\nexport const metadata = { title }\nexport default function L() { return null }`,
      'unsupported export form: metadata = { title }',
    ],
    ['exports another function', `export function helper() { return 1 }\nexport default function L() { return null }`, 'unsupported export form: export function helper() { return 1 }'],
    ['exports a value by name', `const L = () => null\nexport default L`, 'unsupported export form: export default L'],
    ['exports a local binding', `function L() { return null }\nexport { L as default }`, 'unsupported export form: export { L as default }'],
  ])('refuses a static route file that %s', (_, source, problem) => {
    expect(staticRouteProblems(source)).toContain(problem)
  })

  it('accepts literal metadata and a default function', () => {
    const source = `import type { Metadata } from 'next'
export const metadata: Metadata = { title: { template: '%s · Quản trị', default: 'Quản trị' }, robots: { index: false, follow: false } }
export default function AdminLayout({ children }: LayoutProps<'/admin'>) { return children }`
    expect(staticRouteProblems(source)).toEqual([])
  })
})

describe('routerRootProblems (audit PR #107 M-1)', () => {
  it('accepts a repo with the App Router only', () => {
    expect(routerRootProblems(['src/app/page.tsx', 'src/features/pages.ts', 'docs/pages.md'])).toEqual([])
  })

  it.each([['src/pages/admin/zz.tsx'], ['pages/admin/zz.tsx'], ['src/pages/index.tsx'], ['pages/api/x.ts']])(
    'reports a Pages Router file: %s',
    (path) => {
      expect(routerRootProblems([path])).toEqual([`${path}: the Pages Router is not used (conventions.md §2)`])
    },
  )
})

describe('sessionFirstProblems (audit PR #106 L1)', () => {
  const IMPORT = "import { hasAdminSession } from '@/features/admin'\n"

  it('accepts actions and reads that refuse without a session first', () => {
    const source = `'use server'
${IMPORT}export type Row = { slug: string }
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

  it('needs no import when every function is session-less', () => {
    expect(sessionFirstProblems(`export async function loginAction() { return 1 }`, SESSIONLESS_ACTIONS)).toEqual([])
  })

  it.each([
    [
      'parses before the check',
      `${IMPORT}export async function updateProductAction(_: unknown, formData: FormData) {
  const input = parseProductEdit(formData)
  if (!(await hasAdminSession())) return { status: 'error', error: 'unauthorized' }
  return input
}`,
      'updateProductAction does not start with `if (!(await hasAdminSession())) return/throw`',
    ],
    [
      'never checks',
      `${IMPORT}export async function deleteProductAction() { return dbQuery({ name: 'products.admin-delete' }) }`,
      'deleteProductAction does not start with `if (!(await hasAdminSession())) return/throw`',
    ],
    [
      'checks without leaving the function',
      `${IMPORT}export async function updateProductAction() {
  if (!(await hasAdminSession())) console.error('admin: no session')
  return dbQuery({ name: 'products.admin-update' })
}`,
      'updateProductAction does not start with `if (!(await hasAdminSession())) return/throw`',
    ],
    [
      'checks a non-awaited promise',
      `${IMPORT}export const getProductForAdmin = async (slug: string) => {
  if (!hasAdminSession()) return null
  return dbQuery({ name: 'products.admin-get' })
}`,
      'getProductForAdmin does not start with `if (!(await hasAdminSession())) return/throw`',
    ],
    // Re-audit M-B: measured, both stayed green (28/28).
    [
      'is wrapped in cache()',
      `${IMPORT}export const listProductsForAdmin = cache(async () => dbQuery({ name: 'products.admin-list' }))`,
      'unsupported export form: listProductsForAdmin = cache(',
    ],
    [
      'is wrapped in cache() with a check inside',
      `${IMPORT}export const listProductsForAdmin = cache(async () => {
  if (!(await hasAdminSession())) throw new Error('admin: no session')
  return dbQuery({ name: 'products.admin-list' })
})`,
      'unsupported export form: listProductsForAdmin = cache(',
    ],
    [
      'is wrapped in another function',
      `${IMPORT}export const updateProductAction = withLog(async (_: unknown, formData: FormData) => save(formData))`,
      'unsupported export form: updateProductAction = withLog(',
    ],
    ['is a class', `${IMPORT}export class Store { run() { return 1 } }`, 'unsupported export form: export class Store { run() { return 1 } }'],
    ['is a destructuring', `${IMPORT}export const { read } = makeReads()`, 'unsupported export form: { read } = makeReads()'],
    // Re-audit L-a.
    [
      'imports another function as hasAdminSession',
      `import { requireAdminPage as hasAdminSession } from '@/features/admin'
export async function f() { if (!(await hasAdminSession())) return 1; return 2 }`,
      'does not import hasAdminSession by its own name from @/features/admin or @/features/admin/cookie',
    ],
    [
      'declares its own hasAdminSession',
      `const hasAdminSession = async () => true
export async function f() { if (!(await hasAdminSession())) return 1; return 2 }`,
      'declares its own hasAdminSession',
    ],
    [
      'takes hasAdminSession as a parameter',
      `${IMPORT}export async function f(hasAdminSession: () => Promise<boolean>) { if (!(await hasAdminSession())) return 1; return 2 }`,
      'declares its own hasAdminSession',
    ],
  ])('refuses a file that %s', (_, source, problem) => {
    expect(sessionFirstProblems(source, SESSIONLESS_ACTIONS)).toEqual(expect.arrayContaining([expect.stringContaining(problem)]))
  })

  it('refuses an export form it cannot read', () => {
    expect(sessionFirstProblems('const a = async () => 1\nexport { a }')).toEqual(['unsupported export form: export { a }'])
  })
})

const DYNAMIC_TOP = 'a dynamic top-level segment can serve /admin/*'

describe('adminRouteProblems (re-audit M-A)', () => {
  const at = (path: string, source = LEAKY): AppFile => ({ path, source })

  it('accepts the deliberate files and the allowed route files', () => {
    expect(
      adminRouteProblems([
        at('src/app/admin/layout.tsx'),
        at('src/app/admin/page.tsx'),
        at('src/app/admin/login/page.tsx'),
        at(PROTECTED_LAYOUT),
        at(`${PROTECTED_ROOT}/products/page.tsx`, GOOD_PAGE),
        at(`${PROTECTED_ROOT}/products/[slug]/page.tsx`, GOOD_PAGE),
        at(`${PROTECTED_ROOT}/products/[slug]/not-found.tsx`, GOOD_NOT_FOUND),
        at(`${PROTECTED_ROOT}/error.tsx`, `'use client'\n${GOOD_NOT_FOUND}`),
        at(`${PROTECTED_ROOT}/products/loading.tsx`, GOOD_NOT_FOUND),
        at('src/app/(shop)/products/[slug]/page.tsx'),
        at('src/app/sitemap.ts'),
        at('src/app/(shop)/blog/[slug]/opengraph-image.tsx'),
        at('src/app/_private/[a]/helper.ts'),
      ]),
    ).toEqual([])
  })

  // Each one measured or named by the re-audit: the old test stayed green on all of them.
  it.each([
    ['a page.jsx that never checks (t1)', `${PROTECTED_ROOT}/t1/page.jsx`, 'Leak does not start with `await requireAdminPage()`'],
    ['a page.ts', `${PROTECTED_ROOT}/t1/page.ts`, 'Leak does not start with `await requireAdminPage()`'],
    ['a page.js', `${PROTECTED_ROOT}/t1/page.js`, 'Leak does not start with `await requireAdminPage()`'],
    ['a nested layout (t2)', `${PROTECTED_ROOT}/t2/layout.tsx`, 'layout.tsx is not allowed under (protected)'],
    ['a route handler (t3)', `${PROTECTED_ROOT}/t3/route.ts`, 'route.ts is not allowed under (protected)'],
    ['a loading file that reads data (t5)', `${PROTECTED_ROOT}/t5/loading.tsx`, 'imports @/features/products'],
    ['an error file that reads data', `${PROTECTED_ROOT}/error.tsx`, 'has an async function'],
    ['a not-found file that reads data', `${PROTECTED_ROOT}/x/not-found.jsx`, 'awaits'],
    ['a template', `${PROTECTED_ROOT}/template.tsx`, 'template.tsx is not allowed under (protected)'],
    ['a default', `${PROTECTED_ROOT}/default.tsx`, 'default.tsx is not allowed under (protected)'],
    ['a parallel slot', `${PROTECTED_ROOT}/@slot/default.tsx`, 'a parallel or intercepting route under (protected)'],
    ['an intercepting route', `${PROTECTED_ROOT}/(.)x/page.tsx`, 'a parallel or intercepting route under (protected)'],
    ['an opengraph image', `${PROTECTED_ROOT}/products/[slug]/opengraph-image.tsx`, 'opengraph-image.tsx is not allowed under (protected)'],
    ['a twitter image', `${PROTECTED_ROOT}/twitter-image.tsx`, 'twitter-image.tsx is not allowed under (protected)'],
    ['an icon', `${PROTECTED_ROOT}/icon.tsx`, 'icon.tsx is not allowed under (protected)'],
    ['a static image', `${PROTECTED_ROOT}/icon.png`, 'not a route file'],
    ['a helper next to a page', `${PROTECTED_ROOT}/products/helpers.ts`, 'helpers.ts is not allowed under (protected)'],
    ['a new file outside (protected)', 'src/app/admin/reports/page.tsx', 'not one of the deliberate admin files outside (protected)'],
    ['a route handler outside (protected)', 'src/app/admin/export/route.ts', 'not one of the deliberate admin files outside (protected)'],
    ['a layout of the login page', 'src/app/admin/login/layout.tsx', 'not one of the deliberate admin files outside (protected)'],
    ['an admin page in another route group (t9)', 'src/app/(shop)/admin/t9/page.tsx', 'an admin route outside src/app/admin'],
    ['an admin route handler in a route group', 'src/app/(api)/admin/route.ts', 'an admin route outside src/app/admin'],
    ['an intercepted admin route', 'src/app/(shop)/(.)admin/products/page.tsx', 'an admin route outside src/app/admin'],
    ['an admin segment in another case', 'src/app/(shop)/Admin/page.tsx', 'an admin route outside src/app/admin'],
    // Audit PR #108 L-2: a dynamic first URL segment matches `admin` and would serve /admin/* with a session.
    ['a catch-all in a route group', 'src/app/(shop)/[...x]/page.tsx', DYNAMIC_TOP],
    ['an optional catch-all', 'src/app/[[...x]]/page.tsx', DYNAMIC_TOP],
    ['two dynamic segments', 'src/app/[a]/[b]/page.tsx', DYNAMIC_TOP],
    ['two dynamic segments in a group', 'src/app/(g)/[a]/[b]/page.tsx', DYNAMIC_TOP],
    ['a dynamic route handler', 'src/app/[a]/route.ts', DYNAMIC_TOP],
    ['a dynamic segment behind a slot', 'src/app/@modal/(shop)/[a]/page.tsx', DYNAMIC_TOP],
    ['an intercepted dynamic segment', 'src/app/(shop)/(.)[a]/page.tsx', DYNAMIC_TOP],
  ])('reports %s', (_, path, problem) => {
    expect(adminRouteProblems([at(path)])).toContain(`${path}: ${problem}`)
  })
})

describe('routingConfigProblems (audit PR #108 L-2)', () => {
  const CLEAN = 'const nextConfig = { headers: async () => [] }\nexport default nextConfig'
  it('accepts a config that moves no path', () => {
    expect(routingConfigProblems(CLEAN, '{ "framework": "nextjs" }')).toEqual([])
  })

  it.each([
    ['rewrites', 'const nextConfig = { rewrites: async () => [{ source: "/x/:p*", destination: "/admin/:p*" }] }'],
    ['redirects', 'const nextConfig = { async redirects() { return [] } }'],
    ['basePath', 'const nextConfig = { basePath: "/shop" }'],
    ['i18n', 'const nextConfig = { i18n: { locales: ["vi"], defaultLocale: "vi" } }'],
    ['rewrites', 'const key = "rewrites"\nconst nextConfig = { [key]: f }'],
  ])('reports %s in next.config.ts', (name, source) => {
    expect(routingConfigProblems(source, '{}')).toContain(`next.config.ts: ${name} is not used (conventions.md §2)`)
  })

  it.each(['rewrites', 'redirects', 'routes'])('reports %s in vercel.json', (name) => {
    expect(routingConfigProblems(CLEAN, JSON.stringify({ [name]: [] }))).toContain(`vercel.json: ${name} is not used (conventions.md §2)`)
  })
})

describe('the admin area holds only checked route files (audit PR #106 H1, re-audit M-A)', () => {
  const appFiles = filesUnder(APP_ROOT, /./).map((path) => ({ path, source: readFileSync(path, 'utf8') }))

  it('every file serving /admin is allowed and checks what it must', () => {
    expect(adminRouteProblems(appFiles)).toEqual([])
  })

  // Audit PR #108 L-2: a rewrite from a public path to /admin/… (or a redirect) is matched by next.config before
  // the proxy's matcher sees the URL it serves. The repo uses neither, so both are refused outright, with basePath and
  // i18n (they move /admin), in next.config.ts and in vercel.json.
  it('next.config.ts and vercel.json move no path', () => {
    expect(routingConfigProblems(readFileSync('next.config.ts', 'utf8'), readFileSync('vercel.json', 'utf8'))).toEqual([])
  })

  it('the deliberate files still exist', () => {
    expect([...UNPROTECTED_ADMIN_FILES, PROTECTED_LAYOUT].filter((file) => !existsSync(file))).toEqual([])
  })

  // Audit PR #107 M-1: a Pages Router file under pages/admin served /admin/zz with none of the checks above.
  it('there is no Pages Router', () => {
    const roots = ['pages', 'src/pages'].filter((root) => existsSync(root))
    expect(routerRootProblems(roots.flatMap((root) => filesUnder(root, /./)))).toEqual([])
    expect(roots).toEqual([])
  })

  it('the admin root layout is static', () => {
    expect(staticRouteProblems(readFileSync('src/app/admin/layout.tsx', 'utf8'))).toEqual([])
  })

  it('the (protected) layout only renders AdminGate inside <Suspense>, after connection()', () => {
    const file = parse(readFileSync(PROTECTED_LAYOUT, 'utf8'))
    const imports = importDeclarations(file).map((statement) =>
      ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : '?',
    )
    // NS-146 (plan M6 Task 12): the one domain the layout names is monitoring's admin entry, for the count in the chip of
    // "Lỗi". `admin` cannot import a domain, so the layout hands the read to the gate as a function. It runs after the
    // gate's own session check and starts with its own (admin-queries.ts, below), and the layout still awaits nothing
    // but `connection`.
    expect(imports.sort()).toEqual(['@/features/admin/ui', '@/features/monitoring/admin', 'next/server', 'react'])
    expect(topLevelAwaits(file)).toBe(0)
    // ADR-0020: the one await is `connection`, first, so no admin page has a prerendered shell without the CSP nonce;
    // it reads no cookie, header or data.
    const source = readFileSync(PROTECTED_LAYOUT, 'utf8')
    const code = source.replace(/^\s*\/\/.*$/gm, '')
    expect(code.match(/\bawait\b/g)).toEqual(['await'])
    expect(source).toMatch(/export default async function ProtectedAdminLayout\([^)]*\) \{\n {2}await connection\(\);\n/)
    expect(source).toMatch(/^export const instant = false;$/m)
    expect(code).not.toMatch(/cookies\(|headers\(|dbQuery|process\./)
    expect(source).toMatch(
      /<Suspense fallback=\{<AdminShellSkeleton \/>\}>\s*<AdminGate countErrors=\{countRecentErrorsForAdmin\}>\{children\}<\/AdminGate>/,
    )
    // The read is passed, never called here: a call in the layout would run before the gate's check (and for a visitor).
    expect(code).not.toMatch(/countRecentErrorsForAdmin\(/)
    expect(code.match(/countRecentErrorsForAdmin/g)).toHaveLength(2)
  })

  it('/admin itself only redirects, reading nothing', () => {
    const source = readFileSync('src/app/admin/page.tsx', 'utf8')
    expect(source).not.toMatch(/\bawait\b|cookies\(|headers\(|dbQuery|@\/features\/products/)
    expect(source).toMatch(/redirect\("\/admin\/products"\)/)
  })
})

describe('admin actions and reads check the session themselves (audit PR #106 L1, re-audit L-b)', () => {
  const sourceFiles = filesUnder('src', /\.(tsx|ts|jsx|js)$/).filter((file) => !/\.test\.(ts|tsx)$/.test(file))
  const adminReadFiles = sourceFiles.filter((file) => ADMIN_READ_FILE.test(file))

  it.each(ADMIN_ACTION_FILES.filter((file) => existsSync(file)).map((file) => [file]))(
    '%s: every action but loginAction / logoutAction refuses without a session first',
    (file) => {
      expect(sessionFirstProblems(readFileSync(file, 'utf8'), SESSIONLESS_ACTIONS)).toEqual([])
    },
  )

  it('Task 9 reads are found by name', () => {
    expect(adminReadFiles).toContain('src/features/products/admin-queries.ts')
  })

  it.each(adminReadFiles.map((file) => [file]))('%s: every read refuses without a session first', (file) => {
    expect(sessionFirstProblems(readFileSync(file, 'utf8'))).toEqual([])
  })

  it('an exported …ForAdmin function lives in an admin-queries.ts', () => {
    const misplaced = sourceFiles
      .filter((file) => !ADMIN_READ_FILE.test(file) && !file.endsWith('/index.ts'))
      .flatMap((file) => {
        const { functions } = exportedFunctions(parse(readFileSync(file, 'utf8')))
        return functions.filter((fn) => ADMIN_READ_NAME.test(fn.name)).map((fn) => `${file} ${fn.name}`)
      })
    expect(misplaced).toEqual([])
  })

  it('the session-less actions are still the ones of the admin action file', () => {
    const { functions } = exportedFunctions(parse(readFileSync('src/features/admin/actions.ts', 'utf8')))
    expect(functions.map((fn) => fn.name)).toEqual(expect.arrayContaining(SESSIONLESS_ACTIONS))
  })

  it('every file with a use server directive is listed as admin or shop', () => {
    const withDirective = sourceFiles.filter((file) => /^\s*['"]use server['"]/m.test(readFileSync(file, 'utf8')))
    const listed = [...ADMIN_ACTION_FILES, ...SHOP_ACTION_FILES]
    expect(withDirective.filter((file) => !listed.includes(file))).toEqual([])
  })
})
