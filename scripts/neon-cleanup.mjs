#!/usr/bin/env node
// Xoá nhánh Neon preview/<nhánh git> không còn dùng (NS-111, thay việc dọn tay của NS-53).
//
//   node scripts/neon-cleanup.mjs closed <head_ref> [--dry-run]   # PR vừa đóng: xoá preview/<head_ref>
//   node scripts/neon-cleanup.mjs sweep [--dry-run]               # quét mọi preview/*: xoá nhánh không còn PR mở
//
// Tích hợp Neon ↔ Vercel tạo preview/<nhánh git> cho mỗi preview và không xoá khi nhánh git bị xoá; Neon Free cho
// 10 nhánh mỗi project, nên cứ khoảng 8 PR là preview fail ("One or more integration resources failed to provision").
//
// Không bao giờ xoá: nhánh không có tiền tố preview/ (kể cả main), preview/develop (Dev, ADR-0007), nhánh mặc định /
// primary / protected, nhánh có nhánh con, nhánh mà một PR đang mở còn dùng head đó.
//
// Env: NEON_API_KEY (secret, bắt buộc), NEON_PROJECT_ID (bắt buộc), GITHUB_TOKEN, GITHUB_REPOSITORY (owner/repo).
// Key và token không bao giờ được in. Mã thoát: 0 = xong, 1 = lỗi (thiếu cấu hình, API lỗi), 2 = cách gọi sai.

const NEON_API = 'https://console.neon.tech/api/v2'
const GITHUB_API = 'https://api.github.com'
const PREFIX = 'preview/'
const DEV_BRANCH = 'preview/develop'
// A git branch name as GitHub sends it in head.ref; anything else is refused before it reaches a URL or a log.
const HEAD_REF = /^[A-Za-z0-9._/-]{1,200}$/
const PROJECT_ID = /^[a-z0-9-]{1,64}$/

// Branch names and ids are third-party text: reduced to a safe set before they reach the log, so none can be read as
// a workflow command.
const safe = (text) => String(text).replace(/[^A-Za-z0-9._/-]/g, '?')

const keepReason = (branch, branches, openHeads) => {
  if (!branch.name.startsWith(PREFIX)) return 'không có tiền tố preview/'
  if (branch.name === DEV_BRANCH) return 'nhánh Dev (preview/develop), không bao giờ xoá'
  if (branch.default || branch.primary) return 'nhánh mặc định của project'
  if (branch.protected) return 'nhánh protected'
  if (branches.some((other) => other.parent_id === branch.id)) return 'có nhánh con'
  if (openHeads.includes(branch.name.slice(PREFIX.length))) return 'còn PR mở dùng head này'
  return null
}

// Pure: which branches to delete. mode 'closed' looks only at preview/<headRef>; mode 'sweep' at every branch.
export const planDeletions = ({ branches, openHeads, mode, headRef }) => {
  const candidates = mode === 'closed' ? branches.filter((b) => b.name === `${PREFIX}${headRef}`) : branches
  const remove = []
  const keep = []
  for (const branch of candidates) {
    const reason = keepReason(branch, branches, openHeads)
    if (reason) keep.push({ branch, reason })
    else remove.push(branch)
  }
  return { remove, keep }
}

const parseArgs = (argv) => {
  const dryRun = argv.includes('--dry-run')
  const rest = argv.filter((arg) => arg !== '--dry-run')
  if (rest[0] === 'sweep' && rest.length === 1) return { mode: 'sweep', dryRun }
  if (rest[0] === 'closed' && rest.length === 2) return { mode: 'closed', headRef: rest[1], dryRun }
  return null
}

class ApiError extends Error {}

const request = async (fetch, url, init, label) => {
  const response = await fetch(url, init)
  // The body is not printed: it is third-party text.
  if (!response.ok) throw new ApiError(`${label} trả ${response.status}`)
  return response.json()
}

const listOpenHeads = async (fetch, env) => {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`
  const heads = []
  for (let page = 1; page <= 20; page++) {
    const url = `${GITHUB_API}/repos/${env.GITHUB_REPOSITORY}/pulls?state=open&per_page=100&page=${page}`
    const pulls = await request(fetch, url, { headers }, 'GitHub API (PR mở)')
    heads.push(...pulls.map((pull) => pull.head.ref))
    if (pulls.length < 100) return heads
  }
  throw new ApiError('GitHub API (PR mở): quá 2000 PR mở, dừng để không xoá nhầm')
}

const neonHeaders = (env) => ({ Accept: 'application/json', Authorization: `Bearer ${env.NEON_API_KEY}` })

const listBranches = async (fetch, env) => {
  const url = `${NEON_API}/projects/${env.NEON_PROJECT_ID}/branches`
  const body = await request(fetch, url, { headers: neonHeaders(env) }, 'Neon API (danh sách nhánh)')
  if (!Array.isArray(body.branches)) throw new ApiError('Neon API (danh sách nhánh): không có mảng branches')
  return body.branches
}

export const run = async (argv, { env = process.env, fetch = globalThis.fetch, log = console.log } = {}) => {
  const args = parseArgs(argv)
  if (!args) {
    log('neon-cleanup: dùng: node scripts/neon-cleanup.mjs closed <head_ref> | sweep [--dry-run]')
    return 2
  }
  if (!env.NEON_API_KEY) {
    log('neon-cleanup: LỖI: thiếu secret NEON_API_KEY. Chủ dự án thêm nó ở GitHub → Settings → Secrets and variables → Actions (docs/process.md, "Việc của chủ dự án").')
    return 1
  }
  if (!env.NEON_PROJECT_ID || !PROJECT_ID.test(env.NEON_PROJECT_ID)) {
    log('neon-cleanup: LỖI: thiếu hoặc sai NEON_PROJECT_ID (GitHub → Settings → Secrets and variables → Actions → Variables).')
    return 1
  }
  if (!env.GITHUB_REPOSITORY || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY)) {
    log('neon-cleanup: LỖI: thiếu hoặc sai GITHUB_REPOSITORY.')
    return 1
  }
  if (args.mode === 'closed' && !HEAD_REF.test(args.headRef)) {
    log('neon-cleanup: LỖI: head_ref không phải tên nhánh git hợp lệ.')
    return 1
  }

  try {
    const [openHeads, branches] = await Promise.all([listOpenHeads(fetch, env), listBranches(fetch, env)])
    const { remove, keep } = planDeletions({ branches, openHeads, ...args })
    log(`neon-cleanup: project ${env.NEON_PROJECT_ID}: ${branches.length} nhánh, ${openHeads.length} PR mở`)
    for (const { branch, reason } of keep) log(`neon-cleanup: giữ ${safe(branch.name)}: ${reason}`)
    if (remove.length === 0) log('neon-cleanup: không có nhánh nào cần xoá')
    for (const branch of remove) {
      if (args.dryRun) {
        log(`neon-cleanup: (dry-run) sẽ xoá ${safe(branch.name)} (${safe(branch.id)})`)
        continue
      }
      const url = `${NEON_API}/projects/${env.NEON_PROJECT_ID}/branches/${encodeURIComponent(branch.id)}`
      await request(fetch, url, { method: 'DELETE', headers: neonHeaders(env) }, `Neon API (xoá ${safe(branch.name)})`)
      log(`neon-cleanup: đã xoá ${safe(branch.name)} (${safe(branch.id)})`)
    }
    return 0
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    log(`neon-cleanup: LỖI: ${error.message}`)
    return 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await run(process.argv.slice(2))
}
