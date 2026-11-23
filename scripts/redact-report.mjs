#!/usr/bin/env node
// Xoá secret khỏi report Playwright trước khi upload làm artifact (NS-54, audit PR #61 M1).
//
//   REDACT_SECRET=<secret> node scripts/redact-report.mjs redact <thư mục>...   # thay secret bằng *** tại chỗ
//   REDACT_SECRET=<secret> node scripts/redact-report.mjs check <thư mục>...    # còn sót thì mã thoát 1
//
// Khi một request API fail, Playwright ghi mọi request header (kể cả x-vercel-protection-bypass) vào message lỗi.
// Message đó nằm ở data/*.md và trong index.html, nơi report được nhúng dưới dạng zip nén rồi mã hoá base64, nên
// sed trên file không thấy. Script mở mọi zip (file .zip và data:application/zip;base64 trong file text) và gzip, đệ
// quy, rồi tìm secret ở dạng thô, JSON escape, URL encode, HTML escape và base64 / base64url (3 cách căn byte).
// Mã màu ANSI chen giữa secret (diff của `expect` bôi đậm phần khác nhau: `\u001b[7m…\u001b[27m`, audit 2 PR #61 L-A)
// không che được secret: mọi dạng trên còn được tìm trên văn bản đã bỏ mã ANSI, và khi che thì che cả đoạn, mã chen
// giữa cũng mất. ESC được nhận ở dạng byte, JSON / JS escape (`\u001b`, `\x1b`, `\033`, mọi số dấu `\`), `^[` và
// tham chiếu HTML.
// `check` coi mọi zip / gzip không đọc được là lỗi: không chứng minh được sạch thì không upload.
// Secret chỉ được đọc từ env và không bao giờ được in; output chỉ có đường dẫn file.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc32, deflateRawSync, gunzipSync, gzipSync, inflateRawSync } from 'node:zlib'

const MASK = '***'
const MIN_SECRET_LENGTH = 8

const htmlEscape = (text) =>
  text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])

// Base64 of the secret as it appears inside a longer base64 text, for each of the 3 byte alignments: only the
// characters that depend on the secret's bytes alone.
const base64Forms = (secret) => {
  const forms = []
  for (let shift = 0; shift < 3; shift++) {
    const encoded = Buffer.concat([Buffer.alloc(shift), secret]).toString('base64')
    const start = [0, 2, 3][shift]
    const end = Math.floor(((shift + secret.length) * 8) / 6)
    const form = encoded.slice(start, end)
    forms.push(form, form.replace(/\+/g, '-').replace(/\//g, '_'))
  }
  return forms
}

// [form, replacement]: the text forms can be masked in place; a base64 form cannot, so it only fails `check`.
export const secretForms = (secretText) => {
  const secret = Buffer.from(secretText)
  const replaceable = [secretText, JSON.stringify(secretText).slice(1, -1), encodeURIComponent(secretText), htmlEscape(secretText)]
  const masked = [...new Set(replaceable)].map((form) => [Buffer.from(form), Buffer.from(MASK)])
  const encodedOnly = [...new Set(base64Forms(secret))].filter((form) => form.length >= MIN_SECRET_LENGTH)
  return [...masked, ...encodedOnly.map((form) => [Buffer.from(form), undefined])]
}

const replaceAll = (buffer, from, to) => {
  const parts = []
  let start = 0
  for (let at = buffer.indexOf(from); at !== -1; at = buffer.indexOf(from, start)) {
    parts.push(buffer.subarray(start, at), to)
    start = at + from.length
  }
  if (parts.length === 0) return buffer
  parts.push(buffer.subarray(start))
  return Buffer.concat(parts)
}

// One ANSI control sequence (CSI: ESC [ params final), with ESC in any of the encodings above.
const ANSI = /(?:\x1b|\\+(?:u001[bB]|x1[bB]|033)|\^\[|&#(?:27|[xX]0*1[bB]);)\[[0-?]*[ -/]*[@-~]/g

// The layer without its ANSI codes (latin1, so one char per byte), and a map from an index in it back to the layer.
// undefined when the layer has none.
const withoutAnsi = (layer) => {
  const text = layer.toString('latin1')
  const kept = [] // [index in the stripped text, index in the layer] where each kept run starts
  let stripped = ''
  let from = 0
  for (const match of text.matchAll(ANSI)) {
    kept.push([stripped.length, from])
    stripped += text.slice(from, match.index)
    from = match.index + match[0].length
  }
  if (kept.length === 0) return undefined
  kept.push([stripped.length, from])
  stripped += text.slice(from)
  const toLayer = (index) => {
    let low = 0
    for (let high = kept.length - 1; low < high; ) {
      const middle = (low + high + 1) >> 1
      if (kept[middle][0] <= index) low = middle
      else high = middle - 1
    }
    return kept[low][1] + index - kept[low][0]
  }
  return { stripped, toLayer }
}

// Masks each form also where ANSI codes cut it: the whole span, from its first byte to its last, codes included.
const maskAcrossAnsi = (layer, forms) => {
  const view = withoutAnsi(layer)
  if (!view) return layer
  const spans = []
  for (const [form, mask] of forms) {
    if (!mask) continue
    const needle = form.toString('latin1')
    for (let at = view.stripped.indexOf(needle); at !== -1; at = view.stripped.indexOf(needle, at + needle.length))
      spans.push([view.toLayer(at), view.toLayer(at + needle.length - 1) + 1])
  }
  if (spans.length === 0) return layer
  spans.sort((a, b) => a[0] - b[0])
  const parts = []
  let start = 0
  for (const [from, to] of spans) {
    if (from < start) {
      // Overlapping spans (two forms of one secret) become one.
      if (to > start) start = to
      continue
    }
    parts.push(layer.subarray(start, from), Buffer.from(MASK))
    start = to
  }
  parts.push(layer.subarray(start))
  return Buffer.concat(parts)
}

const hasForm = (layer, forms) => {
  if (forms.some(([form]) => layer.includes(form))) return true
  const view = withoutAnsi(layer)
  return view !== undefined && forms.some(([form]) => view.stripped.includes(form.toString('latin1')))
}

const isZip = (buffer) => buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50
const isGzip = (buffer) => buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b

// Entries of a zip, read through the central directory (sizes are there even when the writer used data
// descriptors). Only stored and deflated entries, no zip64: anything else throws.
export const readZip = (buffer) => {
  let end = -1
  for (let at = buffer.length - 22; at >= Math.max(0, buffer.length - 22 - 0xffff); at--)
    if (buffer.readUInt32LE(at) === 0x06054b50) {
      end = at
      break
    }
  if (end === -1) throw new Error('zip: không thấy end of central directory')
  const count = buffer.readUInt16LE(end + 10)
  let at = buffer.readUInt32LE(end + 16)
  const entries = []
  for (let index = 0; index < count; index++) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('zip: central directory hỏng')
    const method = buffer.readUInt16LE(at + 10)
    const compressedSize = buffer.readUInt32LE(at + 20)
    const nameLength = buffer.readUInt16LE(at + 28)
    const extraLength = buffer.readUInt16LE(at + 30)
    const commentLength = buffer.readUInt16LE(at + 32)
    const localOffset = buffer.readUInt32LE(at + 42)
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    if (compressedSize === 0xffffffff || localOffset === 0xffffffff) throw new Error('zip: zip64 không hỗ trợ')
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('zip: local header hỏng')
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28)
    const raw = buffer.subarray(dataStart, dataStart + compressedSize)
    if (method !== 0 && method !== 8) throw new Error(`zip: phương thức nén ${method} không hỗ trợ`)
    entries.push({ name, data: method === 0 ? Buffer.from(raw) : inflateRawSync(raw) })
    at += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

export const writeZip = (entries) => {
  const locals = []
  const centrals = []
  let offset = 0
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8')
    const compressed = deflateRawSync(data)
    const common = Buffer.alloc(26)
    common.writeUInt16LE(20, 0) // version needed
    common.writeUInt16LE(0x0800, 2) // UTF-8 names
    common.writeUInt16LE(8, 4) // deflate
    common.writeUInt32LE(0, 6) // time, date
    common.writeUInt32LE(crc32(data), 10)
    common.writeUInt32LE(compressed.length, 14)
    common.writeUInt32LE(data.length, 18)
    common.writeUInt16LE(nameBytes.length, 22)
    common.writeUInt16LE(0, 24) // extra
    const local = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), common, nameBytes, compressed])
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    common.copy(central, 6, 0, 26)
    central.writeUInt32LE(offset, 42)
    locals.push(local)
    centrals.push(Buffer.concat([central, nameBytes]))
    offset += local.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

const ZIP_DATA_URI = /data:application\/zip;base64,([A-Za-z0-9+/=]+)/g

// Walks a buffer and what it contains. `onText` gets every plain-text layer with its location and returns the
// (possibly) changed buffer; containers are rebuilt only when something inside changed.
const walk = (buffer, location, onText) => {
  if (isZip(buffer)) {
    let changed = false
    const entries = readZip(buffer).map(({ name, data }) => {
      const next = walk(data, `${location} → ${name}`, onText)
      if (next !== data) changed = true
      return { name, data: next }
    })
    return changed ? writeZip(entries) : buffer
  }
  if (isGzip(buffer)) {
    const inner = gunzipSync(buffer)
    const next = walk(inner, `${location} → gzip`, onText)
    return next === inner ? buffer : gzipSync(next)
  }
  let text = onText(buffer, location)
  const latin1 = text.toString('latin1')
  if (latin1.includes('data:application/zip;base64,')) {
    let changed = false
    const next = latin1.replace(ZIP_DATA_URI, (match, base64) => {
      const zip = Buffer.from(base64, 'base64')
      const rebuilt = walk(zip, `${location} → zip nhúng`, onText)
      if (rebuilt === zip) return match
      changed = true
      return `data:application/zip;base64,${rebuilt.toString('base64')}`
    })
    if (changed) text = Buffer.from(next, 'latin1')
  }
  return text
}

export const redactBuffer = (buffer, forms, location = '') =>
  walk(buffer, location, (layer) => {
    let next = layer
    for (const [form, mask] of forms) if (mask) next = replaceAll(next, form, mask)
    return maskAcrossAnsi(next, forms)
  })

// Locations (never the secret) where a form of it is left. A container that cannot be read counts as a finding.
export const findSecret = (buffer, forms, location = '') => {
  const found = []
  try {
    walk(buffer, location, (layer, where) => {
      if (hasForm(layer, forms)) found.push(where)
      return layer
    })
  } catch (error) {
    found.push(`${location} (không đọc được: ${error.message})`)
  }
  return found
}

const filesIn = (path) =>
  statSync(path).isDirectory() ? readdirSync(path).flatMap((name) => filesIn(join(path, name))) : [path]

const main = () => {
  const [command, ...paths] = process.argv.slice(2)
  const secret = process.env.REDACT_SECRET ?? ''
  if ((command !== 'redact' && command !== 'check') || paths.length === 0) {
    console.error('Cách dùng: REDACT_SECRET=<secret> node scripts/redact-report.mjs redact|check <thư mục>...')
    process.exit(2)
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    console.error(`redact-report: REDACT_SECRET trống hoặc ngắn hơn ${MIN_SECRET_LENGTH} ký tự; không kiểm được.`)
    process.exit(2)
  }
  const forms = secretForms(secret)
  const files = paths.flatMap((path) => {
    try {
      return filesIn(path)
    } catch {
      return [] // A folder that does not exist has nothing to upload.
    }
  })
  if (command === 'redact') {
    let count = 0
    for (const file of files) {
      const buffer = readFileSync(file)
      let next
      try {
        next = redactBuffer(buffer, forms, file)
      } catch (error) {
        console.error(`redact-report: không xử lý được ${file}: ${error.message}`)
        process.exit(1)
      }
      if (next !== buffer && !next.equals(buffer)) {
        writeFileSync(file, next)
        count++
      }
    }
    console.log(`redact-report: đã che secret trong ${count} / ${files.length} file.`)
    return
  }
  const found = files.flatMap((file) => findSecret(readFileSync(file), forms, file))
  if (found.length > 0) {
    console.error(`redact-report: còn secret (hoặc không kiểm được) ở:\n${found.map((where) => `  ${where}`).join('\n')}`)
    process.exit(1)
  }
  console.log(`redact-report: không còn secret trong ${files.length} file.`)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
