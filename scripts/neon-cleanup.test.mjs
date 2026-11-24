// Kiểm scripts/neon-cleanup.mjs (NS-111) bằng dữ liệu giả: không ra mạng, fetch giả ghi lại mọi request.
//
//   node --test scripts/neon-cleanup.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { planDeletions, run } from './neon-cleanup.mjs'

const PROJECT = 'proj-test-12345678'
const branch = (name, extra = {}) => ({ id: `br-${name.replace(/[^a-z0-9]/gi, '-')}`, name, ...extra })
const BRANCHES = [
  branch('main', { default: true, primary: true }),
  branch('preview/develop'),
  branch('preview/NS-1-merged'),
  branch('preview/NS-2-open'),
  branch('preview/NS-3-protected', { protected: true }),
  branch('tmp/manual'),
  branch('preview/NS-4-parent'),
  branch('preview/NS-4-child', { parent_id: 'br-preview-NS-4-parent' }),
  branch('preview/NS-5-default', { default: true }),
]
const OPEN_HEADS = ['NS-2-open', 'NS-6-no-branch']

test('sweep: chỉ xoá preview/* không còn PR mở, không phải nhánh bảo vệ', () => {
  const { remove, keep } = planDeletions({ branches: BRANCHES, openHeads: OPEN_HEADS, mode: 'sweep' })
  assert.deepEqual(remove.map((b) => b.name).sort(), ['preview/NS-1-merged', 'preview/NS-4-child'])
  const reasons = Object.fromEntries(keep.map((k) => [k.branch.name, k.reason]))
  assert.match(reasons['main'], /không có tiền tố preview\//)
  assert.match(reasons['preview/develop'], /nhánh Dev/)
  assert.match(reasons['preview/NS-2-open'], /PR mở/)
  assert.match(reasons['preview/NS-3-protected'], /protected/)
  assert.match(reasons['tmp/manual'], /không có tiền tố preview\//)
  assert.match(reasons['preview/NS-4-parent'], /nhánh con/)
  assert.match(reasons['preview/NS-5-default'], /mặc định/)
})

test('closed: chỉ xoá đúng preview/<head_ref> của PR vừa đóng', () => {
  const { remove } = planDeletions({ branches: BRANCHES, openHeads: OPEN_HEADS, mode: 'closed', headRef: 'NS-1-merged' })
  assert.deepEqual(remove.map((b) => b.name), ['preview/NS-1-merged'])
})

test('closed: giữ nhánh khi một PR mở khác còn dùng cùng head', () => {
  const { remove, keep } = planDeletions({ branches: BRANCHES, openHeads: OPEN_HEADS, mode: 'closed', headRef: 'NS-2-open' })
  assert.deepEqual(remove, [])
  assert.match(keep[0].reason, /PR mở/)
})

test('closed: head develop không bao giờ xoá preview/develop', () => {
  const { remove } = planDeletions({ branches: BRANCHES, openHeads: [], mode: 'closed', headRef: 'develop' })
  assert.deepEqual(remove, [])
})

test('closed: không có nhánh Neon tương ứng thì không xoá gì', () => {
  const { remove, keep } = planDeletions({ branches: BRANCHES, openHeads: [], mode: 'closed', headRef: 'NS-9-none' })
  assert.deepEqual(remove, [])
  assert.deepEqual(keep, [])
})

test('main và nhánh mặc định không bao giờ bị xoá, kể cả khi tên có tiền tố preview/', () => {
  const branches = [branch('preview/main', { default: true }), branch('main', { primary: true })]
  const { remove } = planDeletions({ branches, openHeads: [], mode: 'sweep' })
  assert.deepEqual(remove, [])
})

// A fake of GitHub REST and Neon API v2. Records every request; answers from the data given.
const fakeFetch = ({ branches = BRANCHES, openPulls = OPEN_HEADS, neonStatus = 200 } = {}) => {
  const calls = []
  const fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET'
    calls.push({ method, url: String(url), headers: init.headers })
    const u = new URL(url)
    const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) })
    if (u.hostname === 'api.github.com' && u.pathname === '/repos/o/r/pulls') {
      const page = Number(u.searchParams.get('page') ?? '1')
      return json(page === 1 ? openPulls.map((ref) => ({ head: { ref } })) : [])
    }
    if (u.hostname === 'console.neon.tech' && u.pathname === `/api/v2/projects/${PROJECT}/branches` && method === 'GET') {
      return json(neonStatus === 200 ? { branches } : { message: 'nope' }, neonStatus)
    }
    if (u.hostname === 'console.neon.tech' && method === 'DELETE') return json({ branch: {} })
    return json({ message: 'unexpected' }, 404)
  }
  return { fetch, calls }
}
const ENV = { NEON_API_KEY: 'neon-key-gia', NEON_PROJECT_ID: PROJECT, GITHUB_TOKEN: 'gh-token-gia', GITHUB_REPOSITORY: 'o/r' }
const capture = () => {
  const lines = []
  return { log: (line) => lines.push(line), lines }
}

test('run sweep: gọi DELETE đúng nhánh, có Bearer, không in key', async () => {
  const { fetch, calls } = fakeFetch()
  const out = capture()
  const code = await run(['sweep'], { env: ENV, fetch, log: out.log })
  assert.equal(code, 0)
  const deletes = calls.filter((c) => c.method === 'DELETE')
  assert.deepEqual(deletes.map((c) => c.url).sort(), [
    `https://console.neon.tech/api/v2/projects/${PROJECT}/branches/br-preview-NS-1-merged`,
    `https://console.neon.tech/api/v2/projects/${PROJECT}/branches/br-preview-NS-4-child`,
  ])
  for (const c of calls.filter((c) => c.url.startsWith('https://console.neon.tech'))) {
    assert.equal(c.headers.Authorization, 'Bearer neon-key-gia')
  }
  assert.ok(!out.lines.join('\n').includes('neon-key-gia'))
  assert.ok(!out.lines.join('\n').includes('gh-token-gia'))
})

test('run closed: head_ref đọc từ tham số, chỉ xoá nhánh đó', async () => {
  const { fetch, calls } = fakeFetch()
  const code = await run(['closed', 'NS-1-merged'], { env: ENV, fetch, log: () => {} })
  assert.equal(code, 0)
  assert.deepEqual(
    calls.filter((c) => c.method === 'DELETE').map((c) => c.url),
    [`https://console.neon.tech/api/v2/projects/${PROJECT}/branches/br-preview-NS-1-merged`],
  )
})

test('run --dry-run: không gọi DELETE', async () => {
  const { fetch, calls } = fakeFetch()
  const out = capture()
  const code = await run(['sweep', '--dry-run'], { env: ENV, fetch, log: out.log })
  assert.equal(code, 0)
  assert.equal(calls.filter((c) => c.method === 'DELETE').length, 0)
  assert.match(out.lines.join('\n'), /sẽ xoá preview\/NS-1-merged/)
})

test('thiếu NEON_API_KEY: thoát 1 với thông báo rõ, không gọi mạng', async () => {
  const { fetch, calls } = fakeFetch()
  const out = capture()
  const code = await run(['sweep'], { env: { ...ENV, NEON_API_KEY: '' }, fetch, log: out.log })
  assert.equal(code, 1)
  assert.match(out.lines.join('\n'), /thiếu secret NEON_API_KEY/)
  assert.equal(calls.length, 0)
})

test('thiếu hay sai NEON_PROJECT_ID: thoát 1, không gọi mạng', async () => {
  for (const id of ['', 'x/../y']) {
    const { fetch, calls } = fakeFetch()
    const out = capture()
    const code = await run(['sweep'], { env: { ...ENV, NEON_PROJECT_ID: id }, fetch, log: out.log })
    assert.equal(code, 1)
    assert.match(out.lines.join('\n'), /NEON_PROJECT_ID/)
    assert.equal(calls.length, 0)
  }
})

test('head_ref lạ (ký tự ngoài tên nhánh git) bị từ chối, không gọi mạng', async () => {
  const { fetch, calls } = fakeFetch()
  const code = await run(['closed', 'a b;rm'], { env: ENV, fetch, log: () => {} })
  assert.equal(code, 1)
  assert.equal(calls.length, 0)
})

test('Neon API lỗi: thoát 1, không xoá gì', async () => {
  const { fetch, calls } = fakeFetch({ neonStatus: 401 })
  const out = capture()
  const code = await run(['sweep'], { env: ENV, fetch, log: out.log })
  assert.equal(code, 1)
  assert.match(out.lines.join('\n'), /Neon API \(danh sách nhánh\) trả 401/)
  assert.equal(calls.filter((c) => c.method === 'DELETE').length, 0)
})

test('cách gọi sai: thoát 2', async () => {
  const { fetch } = fakeFetch()
  assert.equal(await run([], { env: ENV, fetch, log: () => {} }), 2)
  assert.equal(await run(['closed'], { env: ENV, fetch, log: () => {} }), 2)
  assert.equal(await run(['nuke'], { env: ENV, fetch, log: () => {} }), 2)
})
