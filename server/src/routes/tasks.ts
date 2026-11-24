import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createTask, db, deleteTask, deleteTasksByStatus, getDefaultAccount, getTask, listTasks, updateTask } from '../db.js'
import { enqueueTask } from '../download/pipeline.js'
import { getSettings } from '../settings.js'
import { findBlocked } from '../download/filter.js'
import { findExistingFile } from '../library.js'

const qualitySchema = z.enum(['hires', 'flac', '320', '128'])

const trackSchema = z.object({
  provider: z.string().default('qq'),
  id: z.string().min(1),
  title: z.string().min(1),
  artists: z.array(z.string()).default([]),
  album: z.string().default(''),
  albumId: z.string().default(''),
  durationMs: z.number().default(0),
  cover: z.string().default(''),
  trackNo: z.number().optional(),
  year: z.string().optional(),
  mediaMid: z.string().optional(),
  sourceUrl: z.string().optional(),
})

const createSchema = z.object({
  track: trackSchema,
  quality: qualitySchema.optional(),
  // force=true 时忽略「媒体库已存在」，强制重新下载
  force: z.boolean().optional(),
})

const ACTIVE = ['queued', 'resolving', 'downloading', 'verifying', 'tagging']

export function registerTaskRoutes(app: FastifyInstance) {
  app.get('/api/tasks', async (req) => {
    const limit = Math.min(200, Math.max(1, Number((req.query as any).limit) || 50))
    const totalFailed = Number((db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE status = 'failed'").get() as any)?.c || 0)
    return { tasks: listTasks(limit), totalFailed }
  })

  app.post('/api/tasks', async (req, reply) => {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message || '参数错误' })
    }
    const { track } = parsed.data
    const settings = getSettings()
    const blocked = findBlocked(`${track.title} ${track.album}`, settings.blockWords)
    if (blocked) {
      return reply.code(400).send({ error: `命中屏蔽词「${blocked}」，已跳过` })
    }
    const existingFile = parsed.data.force ? null : findExistingFile(track.title, track.artists)
    if (existingFile) {
      return reply.code(200).send({ skipped: true, message: `媒体库已存在：${existingFile.path}`, path: existingFile.path })
    }
    const quality = parsed.data.quality || settings.quality

    const existing = db
      .prepare(
        `SELECT * FROM tasks WHERE provider = ? AND track_id = ? AND quality = ? AND status IN (${ACTIVE.map(() => '?').join(',')}) LIMIT 1`,
      )
      .get(track.provider, track.id, quality, ...ACTIVE) as any
    if (existing) {
      return { task: existing, deduped: true }
    }

    const task = createTask({
      provider: track.provider,
      trackId: track.id,
      title: track.title,
      artists: track.artists.join(' / '),
      album: track.album,
      albumId: track.albumId,
      cover: track.cover,
      durationMs: track.durationMs,
      trackNo: track.trackNo,
      year: track.year,
      mediaMid: track.mediaMid,
      sourceUrl: track.sourceUrl,
      quality,
      accountId: getDefaultAccount(track.provider)?.id ?? null,
    })
    enqueueTask(task.id)
    return { task }
  })

  app.post('/api/tasks/retry-failed', async (req) => {
    const body = (req.body || {}) as { provider?: string; limit?: number }
    const provider = String(body.provider || '')
    const limit = Math.min(500, Math.max(1, Number(body.limit) || 200))
    const rows = (
      provider
        ? db.prepare("SELECT id FROM tasks WHERE status = 'failed' AND provider = ? ORDER BY id ASC LIMIT ?").all(provider, limit)
        : db.prepare("SELECT id FROM tasks WHERE status = 'failed' ORDER BY id ASC LIMIT ?").all(limit)
    ) as any[]
    for (const row of rows) {
      updateTask(row.id, { status: 'queued', progress: 0, error: null, received_bytes: 0 })
      enqueueTask(row.id)
    }
    const remaining = Number(
      (db.prepare(
        provider
          ? "SELECT COUNT(*) AS c FROM tasks WHERE status = 'failed' AND provider = ?"
          : "SELECT COUNT(*) AS c FROM tasks WHERE status = 'failed'",
      ).get(...(provider ? [provider] : [])) as any)?.c || 0,
    )
    return { count: rows.length, ids: rows.map((row) => row.id), remaining }
  })

  app.post('/api/tasks/:id/retry', async (req, reply) => {
    const id = Number((req.params as any).id)
    const task = getTask(id)
    if (!task) return reply.code(404).send({ error: '任务不存在' })
    updateTask(id, { status: 'queued', progress: 0, error: null, received_bytes: 0 })
    enqueueTask(id)
    return { task: getTask(id) }
  })

  const ACTIVE_STATUSES = ['queued', 'resolving', 'downloading', 'verifying', 'tagging']

  // 清除单条任务记录（进行中的要先取消）
  app.delete('/api/tasks/:id', async (req, reply) => {
    const id = Number((req.params as any).id)
    const task = getTask(id)
    if (!task) return reply.code(404).send({ error: '任务不存在' })
    if (ACTIVE_STATUSES.includes(task.status)) return reply.code(400).send({ error: '任务进行中，请先取消再清除' })
    deleteTask(id)
    return { ok: true }
  })

  // 批量清除：status = failed | done | canceled | inactive(默认 failed+canceled)
  app.post('/api/tasks/clear', async (req) => {
    const status = String((req.body as any)?.status || 'inactive')
    const list =
      status === 'failed'
        ? ['failed']
        : status === 'done'
          ? ['done']
          : status === 'canceled'
            ? ['canceled']
            : ['failed', 'canceled']
    return { removed: deleteTasksByStatus(list) }
  })

  app.post('/api/tasks/:id/cancel', async (req, reply) => {
    const id = Number((req.params as any).id)
    const task = getTask(id)
    if (!task) return reply.code(404).send({ error: '任务不存在' })
    if (task.status === 'done') return reply.code(400).send({ error: '任务已完成' })
    updateTask(id, { status: 'canceled' })
    return { task: getTask(id) }
  })
}
