import type { FastifyInstance } from 'fastify'
import { db, listTasks } from '../db.js'

export function registerStatsRoutes(app: FastifyInstance) {
  app.get('/api/stats', async () => {
    const count = (sql: string, ...args: any[]) =>
      Number((db.prepare(sql).get(...args) as any)?.c || 0)
    const byStatus = db.prepare('SELECT status, COUNT(*) c FROM tasks GROUP BY status').all() as any[]
    const statusMap: Record<string, number> = {}
    for (const row of byStatus) statusMap[row.status] = Number(row.c)

    const bytes = Number(
      (db.prepare("SELECT COALESCE(SUM(received_bytes),0) c FROM tasks WHERE status = 'done'").get() as any)?.c || 0,
    )
    return {
      accounts: count('SELECT COUNT(*) c FROM accounts'),
      libraryCount: statusMap.done || 0,
      libraryBytes: bytes,
      active:
        (statusMap.queued || 0) +
        (statusMap.resolving || 0) +
        (statusMap.downloading || 0) +
        (statusMap.verifying || 0) +
        (statusMap.tagging || 0),
      failed: statusMap.failed || 0,
      recent: listTasks(6),
    }
  })

  app.get('/api/library', async () => {
    const rows = db
      .prepare("SELECT * FROM tasks WHERE status = 'done' ORDER BY id DESC LIMIT 500")
      .all() as any[]
    return { items: rows }
  })
}
