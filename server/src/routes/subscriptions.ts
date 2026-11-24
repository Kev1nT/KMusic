import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, getAccount, now } from '../db.js'
import { decrypt } from '../crypto.js'
import { getProvider } from '../providers/registry.js'
import { getSubscription, listSubscriptions, scanSubscription } from '../scheduler.js'

const createSchema = z.object({
  accountId: z.number().int(),
  playlistId: z.string().min(1),
  name: z.string().max(120).optional(),
  intervalMin: z.number().int().min(5).max(24 * 60).optional(),
})

const updateSchema = z.object({
  intervalMin: z.number().int().min(5).max(24 * 60).optional(),
  enabled: z.boolean().optional(),
})

export function registerSubscriptionRoutes(app: FastifyInstance) {
  app.get('/api/subscriptions', async () => {
    const rows = listSubscriptions()
    const accounts = new Map(
      (db.prepare('SELECT id, alias, nickname, uid FROM accounts').all() as any[]).map((a) => [a.id, a]),
    )
    return {
      subscriptions: rows.map((s) => {
        const account = accounts.get(s.account_id)
        return {
          ...s,
          enabled: Boolean(s.enabled),
          accountName: account?.alias || account?.nickname || '未知账号',
          accountUid: account?.uid || '',
        }
      }),
    }
  })

  app.post('/api/subscriptions', async (req, reply) => {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message || '参数错误' })
    const { accountId, playlistId } = parsed.data
    const account = getAccount(accountId)
    if (!account) return reply.code(404).send({ error: '账号不存在' })

    const exists = db
      .prepare('SELECT id FROM subscriptions WHERE provider = ? AND account_id = ? AND target_id = ?')
      .get(account.provider, accountId, playlistId) as any
    if (exists) return reply.code(409).send({ error: '这个歌单已经订阅了' })

    let name = parsed.data.name || ''
    if (!name) {
      try {
        const cookie = decrypt(account.cookie_enc)
        const playlist = await getProvider(account.provider).playlist(playlistId, { cookie, uin: account.uid })
        name = playlist.name
      } catch {
        name = `歌单 ${playlistId}`
      }
    }

    const interval = parsed.data.intervalMin || 30
    const ts = now()
    const info = db
      .prepare(
        `INSERT INTO subscriptions (provider, account_id, kind, target_id, name, interval_min, enabled, next_scan_at, created_at, updated_at)
         VALUES (?, ?, 'playlist', ?, ?, ?, 1, ?, ?, ?)`,
      )
      .run(account.provider, accountId, playlistId, name, interval, new Date(Date.now() + interval * 60_000).toISOString(), ts, ts)
    return { subscription: getSubscription(Number(info.lastInsertRowid)) }
  })

  app.put('/api/subscriptions/:id', async (req, reply) => {
    const id = Number((req.params as any).id)
    const sub = getSubscription(id)
    if (!sub) return reply.code(404).send({ error: '订阅不存在' })
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: '参数错误' })
    const interval = parsed.data.intervalMin ?? sub.interval_min
    const enabled = parsed.data.enabled === undefined ? sub.enabled : parsed.data.enabled ? 1 : 0
    const next =
      parsed.data.enabled === true
        ? now()
        : new Date(Date.now() + interval * 60_000).toISOString()
    db.prepare('UPDATE subscriptions SET interval_min = ?, enabled = ?, next_scan_at = ?, updated_at = ? WHERE id = ?').run(
      interval,
      enabled,
      next,
      now(),
      id,
    )
    return { subscription: getSubscription(id) }
  })

  app.delete('/api/subscriptions/:id', async (req, reply) => {
    const id = Number((req.params as any).id)
    if (!getSubscription(id)) return reply.code(404).send({ error: '订阅不存在' })
    db.prepare('DELETE FROM subscription_tracks WHERE subscription_id = ?').run(id)
    db.prepare('DELETE FROM subscriptions WHERE id = ?').run(id)
    return { ok: true }
  })

  app.post('/api/subscriptions/:id/scan', async (req, reply) => {
    const id = Number((req.params as any).id)
    try {
      return await scanSubscription(id)
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : '扫描失败' })
    }
  })
}
