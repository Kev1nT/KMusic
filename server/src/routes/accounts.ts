import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, getAccount, listAccounts, now, toPublicAccount } from '../db.js'
import { decrypt, encrypt } from '../crypto.js'
import { getProvider } from '../providers/registry.js'
import { markAccountInvalid, refreshAccount } from '../accountHealth.js'
import { normalizeCookie, getUinFromCookie } from '../providers/qq/api.js'
import { getSettings, saveSettings } from '../settings.js'
import type { AccountRow } from '../types.js'
import { createQrSession, pollQrSession } from '../providers/qq/login.js'
import { createWxSession, pollWxSession } from '../providers/qq/wxlogin.js'
import * as ne from '../providers/netease/api.js'
import * as qs from '../providers/qishui/api.js'
import { cleanCookie, upsertAccount } from '../accountStore.js'

const cookieSchema = z.object({
  cookie: z.string().min(20, 'Cookie 太短'),
  isDefault: z.boolean().optional(),
  alias: z.string().max(40).optional(),
})

function setDefault(accountId: number, provider: string) {
  db.prepare('UPDATE accounts SET is_default = 0 WHERE provider = ?').run(provider)
  db.prepare('UPDATE accounts SET is_default = 1, updated_at = ? WHERE id = ?').run(now(), accountId)
  saveSettings({ downloadAccountId: accountId })
}

export function registerAccountRoutes(app: FastifyInstance) {
  app.get('/api/accounts', async () => listAccounts())

  app.post('/api/accounts/qq/qr', async () => createQrSession())

  app.post('/api/accounts/qq/wx/qr', async () => createWxSession())

  app.get('/api/accounts/qq/wx/qr/:id', async (req, reply) => {
    try {
      return await pollWxSession(String((req.params as any).id))
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : '二维码会话不存在' })
    }
  })

  app.post('/api/accounts/apple', async (_req, reply) => {
    const settings = getSettings()
    try {
      const res = await fetch(`${settings.appleWrapperUrl}/status`, { signal: AbortSignal.timeout(6000) })
      if (!res.ok) throw new Error(`wrapper /status 返回 ${res.status}`)
      const id = upsertAccount(
        'apple',
        'wrapper',
        { nickname: 'Apple Music（Wrapper）', avatar: '', vip: 1 },
        JSON.stringify({ wrapperUrl: settings.appleWrapperUrl }),
      )
      return toPublicAccount(getAccount(id)!)
    } catch (err) {
      return reply.code(400).send({
        error: `Apple Wrapper 未就绪：${err instanceof Error ? err.message : err}。请确认 apple-wrapper 容器已登录 Apple 账号（2FA 完成后自动就绪）`,
      })
    }
  })

  app.post('/api/accounts/netease', async (req, reply) => {
    const cookie = cleanCookie(String((req.body as any)?.cookie || ''))
    if (cookie.length < 20) return reply.code(400).send({ error: 'Cookie 太短' })
    try {
      const profile = await ne.getProfile(cookie)
      const id = upsertAccount('netease', profile.uid, profile, cookie)
      return toPublicAccount(getAccount(id)!)
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'Cookie 校验失败' })
    }
  })

  app.post('/api/accounts/qishui/qr', async () => {
    const qr = await qs.qrStart()
    return { id: qr.key, status: 'waiting', qr: qr.qr, message: '请使用抖音 App 扫码' }
  })

  app.get('/api/accounts/qishui/qr/:key', async (req, reply) => {
    const key = String((req.params as any).key)
    try {
      const data = await qs.qrCheck(key)
      if (data.state === 'confirmed') {
        const user = qs.currentUser()
        const row = db.prepare("SELECT * FROM accounts WHERE provider = 'qishui' ORDER BY id ASC LIMIT 1").get() as any
        return {
          id: key,
          status: 'ok',
          nickname: user?.nickname || '汽水账号',
          avatar: '',
          vip: user?.isVip ? 1 : 0,
          accountId: row?.id,
        }
      }
      const status = data.state === 'expired' ? 'expired' : data.state === 'scanned' ? 'scanned' : data.state === 'error' ? 'error' : 'waiting'
      return { id: key, status, message: data.state }
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : '扫码状态查询失败' })
    }
  })

  app.post('/api/accounts/netease/qr', async () => {
    const qr = await ne.qrCreate()
    return { id: qr.key, status: 'waiting', qr: qr.qrimg, message: '请使用网易云音乐 App 扫码' }
  })

  app.get('/api/accounts/netease/qr/:key', async (req, reply) => {
    const key = String((req.params as any).key)
    try {
      const result = await ne.qrCheck(key)
      if (result.code === 803 && result.cookie) {
        const cookie = cleanCookie(result.cookie)
        const profile = await ne.getProfile(cookie)
        const id = upsertAccount('netease', profile.uid, profile, cookie)
        return {
          id: key,
          status: 'ok',
          nickname: profile.nickname,
          avatar: profile.avatar,
          vip: profile.vip,
          accountId: id,
        }
      }
      const status = result.code === 800 ? 'expired' : result.code === 802 ? 'scanned' : 'waiting'
      return { id: key, status, message: result.message }
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : '扫码状态查询失败' })
    }
  })

  app.get('/api/accounts/qq/qr/:id', async (req, reply) => {
    try {
      return await pollQrSession(String((req.params as any).id))
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : '二维码会话不存在' })
    }
  })

  app.post('/api/accounts/qq', async (req, reply) => {
    const parsed = cookieSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message || '参数错误' })
    }
    const cookie = normalizeCookie(parsed.data.cookie)
    const uin = getUinFromCookie(cookie)
    if (!uin) {
      return reply.code(400).send({ error: 'Cookie 中缺少 uin，请确认复制的是 y.qq.com 的完整 Cookie' })
    }

    let profile: { nickname: string; avatar: string; vip: number }
    try {
      profile = await getProvider('qq').profile({ cookie, uin })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Cookie 校验失败'
      return reply.code(400).send({ error: message })
    }

    const ts = now()
    db.prepare(
      `INSERT INTO accounts (provider, uid, nickname, alias, avatar, vip, cookie_enc, is_default, status, last_check_at, created_at, updated_at)
       VALUES ('qq', ?, ?, ?, ?, ?, ?, 0, 'ok', ?, ?, ?)
       ON CONFLICT(provider, uid) DO UPDATE SET
         nickname = excluded.nickname,
         alias = CASE WHEN excluded.alias <> '' THEN excluded.alias ELSE accounts.alias END,
         avatar = excluded.avatar,
         vip = excluded.vip,
         cookie_enc = excluded.cookie_enc,
         status = 'ok',
         last_check_at = excluded.last_check_at,
         updated_at = excluded.updated_at`,
    ).run(
      uin,
      profile.nickname,
      parsed.data.alias || '',
      profile.avatar,
      profile.vip,
      encrypt(cookie),
      ts,
      ts,
      ts,
    )

    const row = db.prepare('SELECT * FROM accounts WHERE provider = ? AND uid = ?').get('qq', uin) as unknown as AccountRow
    const hasDefault = listAccounts('qq').some((a) => a.isDefault)
    if (parsed.data.isDefault || !hasDefault) setDefault(row.id, 'qq')

    const refreshed = getAccount(row.id)!
    return toPublicAccount(refreshed)
  })

  app.put('/api/accounts/:id', async (req, reply) => {
    const id = Number((req.params as any).id)
    const account = getAccount(id)
    if (!account) return reply.code(404).send({ error: '账号不存在' })
    const body = req.body as any
    const alias = body?.alias !== undefined ? String(body.alias).trim().slice(0, 40) : account.alias
    const libraryPath = body?.libraryPath !== undefined ? String(body.libraryPath).trim() : account.library_path
    db.prepare('UPDATE accounts SET alias = ?, library_path = ?, updated_at = ? WHERE id = ?').run(
      alias,
      libraryPath,
      now(),
      id,
    )
    return toPublicAccount(getAccount(id)!)
  })

  app.post('/api/accounts/:id/default', async (req, reply) => {
    const id = Number((req.params as any).id)
    const account = getAccount(id)
    if (!account) return reply.code(404).send({ error: '账号不存在' })
    setDefault(id, account.provider)
    return { ok: true }
  })

  app.post('/api/accounts/:id/check', async (req, reply) => {
    const id = Number((req.params as any).id)
    const account = getAccount(id)
    if (!account) return reply.code(404).send({ error: '账号不存在' })
    try {
      await refreshAccount(id)
      return toPublicAccount(getAccount(id)!)
    } catch (err) {
      markAccountInvalid(id)
      return reply.code(400).send({ error: err instanceof Error ? err.message : '登录态已失效' })
    }
  })

  app.delete('/api/accounts/:id', async (req, reply) => {
    const id = Number((req.params as any).id)
    const account = getAccount(id)
    if (!account) return reply.code(404).send({ error: '账号不存在' })
    db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
    if (account.is_default) {
      const next = listAccounts(account.provider)[0]
      if (next) setDefault(next.id, next.provider)
    }
    return { ok: true }
  })
}
