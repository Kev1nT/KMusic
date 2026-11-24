import type { FastifyInstance } from 'fastify'
import { db, listTasks } from '../db.js'
import { nextScanAt } from '../scheduler.js'

export function registerDashboardRoutes(app: FastifyInstance) {
  app.get('/api/dashboard', async () => {
    const scalar = (sql: string, ...args: any[]) => {
      const row = db.prepare(sql).get(...args) as any
      return { count: Number(row?.c || 0), bytes: Number(row?.b || 0) }
    }

    const today = scalar(
      "SELECT COUNT(*) c, COALESCE(SUM(received_bytes),0) b FROM tasks WHERE status = 'done' AND date(updated_at, 'localtime') = date('now', 'localtime')",
    )
    const week = scalar(
      "SELECT COUNT(*) c, COALESCE(SUM(received_bytes),0) b FROM tasks WHERE status = 'done' AND datetime(updated_at) >= datetime('now', '-7 days')",
    )
    const total = scalar("SELECT COUNT(*) c, COALESCE(SUM(received_bytes),0) b FROM tasks WHERE status = 'done'")

    const seriesRows = db
      .prepare(
        "SELECT date(updated_at, 'localtime') d, COUNT(*) c FROM tasks WHERE status = 'done' AND datetime(updated_at) >= datetime('now', '-6 days') GROUP BY d ORDER BY d ASC",
      )
      .all() as any[]
    const map = new Map(seriesRows.map((r) => [r.d, Number(r.c)]))
    const series: { date: string; count: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      series.push({ date: key, count: map.get(key) || 0 })
    }

    const byAccount = (
      db
        .prepare(
          `SELECT COALESCE(NULLIF(a.alias,''), a.nickname, '未绑定') name, t.account_id id,
                  COUNT(*) c, COALESCE(SUM(t.received_bytes),0) b
           FROM tasks t LEFT JOIN accounts a ON a.id = t.account_id
           WHERE t.status = 'done' GROUP BY t.account_id ORDER BY c DESC`,
        )
        .all() as any[]
    ).map((r) => ({ id: r.id, name: r.name, count: Number(r.c), bytes: Number(r.b) }))

    const activeRows = db
      .prepare(
        "SELECT * FROM tasks WHERE status IN ('queued','resolving','downloading','verifying','tagging') ORDER BY id DESC LIMIT 8",
      )
      .all() as any[]
    const recent = db
      .prepare("SELECT * FROM tasks WHERE status = 'done' ORDER BY updated_at DESC LIMIT 10")
      .all() as any[]

    const subs = db
      .prepare('SELECT COUNT(*) total, COALESCE(SUM(enabled),0) enabled FROM subscriptions')
      .get() as any

    return {
      today,
      week,
      total,
      series,
      byAccount,
      active: activeRows,
      recent,
      nextScanAt: nextScanAt(),
      subscriptions: { total: Number(subs?.total || 0), enabled: Number(subs?.enabled || 0) },
      recentAll: listTasks(1),
    }
  })
}
