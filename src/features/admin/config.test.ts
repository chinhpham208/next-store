import { describe, expect, it } from 'vitest'
import { readAdminConfig } from '@/features/admin/config'

// Fake values, test only.
const PASSWORD = 'test-admin-password-0123'
const SECRET = 'test-session-secret-0123456789abcdef'

describe('readAdminConfig', () => {
  it('is enabled with a strong password and secret', () => {
    expect(readAdminConfig({ ADMIN_PASSWORD: PASSWORD, SESSION_SECRET: SECRET })).toEqual({
      enabled: true,
      password: PASSWORD,
      sessionSecret: SECRET,
    })
  })

  it('is disabled when either value is missing', () => {
    for (const env of [
      {},
      { ADMIN_PASSWORD: PASSWORD },
      { SESSION_SECRET: SECRET },
      { ADMIN_PASSWORD: '', SESSION_SECRET: SECRET },
      { ADMIN_PASSWORD: PASSWORD, SESSION_SECRET: '' },
      { ADMIN_PASSWORD: '   ', SESSION_SECRET: SECRET },
      { ADMIN_PASSWORD: PASSWORD, SESSION_SECRET: ' \t\n ' },
    ]) {
      expect(readAdminConfig(env), JSON.stringify(Object.keys(env))).toEqual({ enabled: false, reason: 'missing' })
    }
  })

  it('is disabled when the password is under 20 characters', () => {
    expect(readAdminConfig({ ADMIN_PASSWORD: 'x'.repeat(19), SESSION_SECRET: SECRET })).toEqual({
      enabled: false,
      reason: 'weak',
    })
    // Padding with spaces does not make it stronger.
    expect(readAdminConfig({ ADMIN_PASSWORD: `  ${'x'.repeat(19)}  `, SESSION_SECRET: SECRET })).toEqual({
      enabled: false,
      reason: 'weak',
    })
    expect(readAdminConfig({ ADMIN_PASSWORD: 'x'.repeat(20), SESSION_SECRET: SECRET }).enabled).toBe(true)
  })

  it('is disabled when the secret is under 32 characters', () => {
    expect(readAdminConfig({ ADMIN_PASSWORD: PASSWORD, SESSION_SECRET: 'y'.repeat(31) })).toEqual({
      enabled: false,
      reason: 'weak',
    })
    expect(readAdminConfig({ ADMIN_PASSWORD: PASSWORD, SESSION_SECRET: ` ${'y'.repeat(31)} ` })).toEqual({
      enabled: false,
      reason: 'weak',
    })
    expect(readAdminConfig({ ADMIN_PASSWORD: PASSWORD, SESSION_SECRET: 'y'.repeat(32) }).enabled).toBe(true)
  })

  it('is disabled when password and secret are equal', () => {
    expect(readAdminConfig({ ADMIN_PASSWORD: SECRET, SESSION_SECRET: SECRET })).toEqual({
      enabled: false,
      reason: 'weak',
    })
    // Equal once surrounding whitespace is gone: still one value for both.
    for (const env of [
      { ADMIN_PASSWORD: `${SECRET} `, SESSION_SECRET: SECRET },
      { ADMIN_PASSWORD: SECRET, SESSION_SECRET: `${SECRET}\n` },
      { ADMIN_PASSWORD: `\t${SECRET}`, SESSION_SECRET: `${SECRET}\r\n` },
    ]) {
      expect(readAdminConfig(env)).toEqual({ enabled: false, reason: 'weak' })
    }
  })

  it('returns both values trimmed, so a value pasted with a newline still works', () => {
    // Vercel keeps a trailing newline pasted into the dashboard; the owner never meant it as part of the value.
    expect(readAdminConfig({ ADMIN_PASSWORD: `${PASSWORD}\n`, SESSION_SECRET: ` ${SECRET}\r\n` })).toEqual({
      enabled: true,
      password: PASSWORD,
      sessionSecret: SECRET,
    })
  })

  it('reads process.env by default', () => {
    const saved = { password: process.env.ADMIN_PASSWORD, secret: process.env.SESSION_SECRET }
    try {
      process.env.ADMIN_PASSWORD = PASSWORD
      process.env.SESSION_SECRET = SECRET
      expect(readAdminConfig().enabled).toBe(true)
      delete process.env.SESSION_SECRET
      expect(readAdminConfig()).toEqual({ enabled: false, reason: 'missing' })
    } finally {
      if (saved.password === undefined) delete process.env.ADMIN_PASSWORD
      else process.env.ADMIN_PASSWORD = saved.password
      if (saved.secret === undefined) delete process.env.SESSION_SECRET
      else process.env.SESSION_SECRET = saved.secret
    }
  })

  it('never puts a value in the disabled answer', () => {
    const answer = readAdminConfig({ ADMIN_PASSWORD: 'short-password', SESSION_SECRET: SECRET })
    expect(JSON.stringify(answer)).not.toContain('short-password')
    expect(JSON.stringify(answer)).not.toContain(SECRET)
  })
})
