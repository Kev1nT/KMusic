import { createTask, db, getAccount, now } from './db.js'
import { decrypt } from './crypto.js'
import { getSettings } from './settings.js'
import { getProvider } from './providers/registry.js'
import { enqueueTask } from './download/pipeline.js'
import { findBlocked } from './download/filter.js'
import { findExistingFile } from './library.js'
import { keepAliveAccounts } from './accountHealth.js'

let timer: ReturnType<typeof setInterval> | null = null
let scanning = false

export interface SubscriptionRow {
  id: number
  provider: string
  account_id: number
  kind: string
  target_id: string
  name: string
  interval_min: number
  enabled: number
  last_scan_at: string | null
  next_scan_at: string | null
  last_status: string | null
  last_message: string | null
  created_at: string
  updated_at: string
}

export function listSubscriptions(): SubscriptionRow[] {
  return db
    .prepare('SELECT * FROM subscriptions ORDER BY enabled DESC, id DESC')
    .all() as unknown as SubscriptionRow[]
}

export function getSubscription(id: number): SubscriptionRow | undefined {
  return db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id) as unknown as SubscriptionRow | undefined
}

export function nextScanAt(): string | null {
  const row = db
    .prepare("SELECT MIN(next_scan_at) AS at FROM subscriptions WHERE enabled = 1 AND next_scan_at IS NOT NULL")
    .get() as any
  return row?.at || null
}

export async function scanSubscription(id: number): Promise<{ queued: number; message: string }> {
  const sub = getSubscription(id)
  if (!sub) throw new Error('订阅不存在')
  const account = getAccount(sub.account_id)
  if (!account) throw new Error('订阅绑定的账号已被移除')

  let cookie = ''
  try {
    cookie = decrypt(account.cookie_enc)
  } catch {
    /* ignore */
  }

  const settings = getSettings()
  const provider = getProvider(sub.provider)
  const playlist = await provider.playlist(sub.target_id, { cookie, uin: account.uid })
  const existing = new Set(
    (db.prepare('SELECT track_id FROM subscription_tracks WHERE subscription_id = ?').all(sub.id) as any[]).map(
      (r) => String(r.track_id),
    ),
  )

  let queued = 0
  let skipped = 0
  const limit = 200
  const markSeen = db.prepare(
    'INSERT OR IGNORE INTO subscription_tracks (subscription_id, track_id, title, task_id, status, first_seen_at) VALUES (?, ?, ?, ?, ?, ?)',
  )

  for (const track of playlist.tracks.slice(0, 1000)) {
    if (queued >= limit) break
    if (existing.has(track.id)) continue
    const blocked = findBlocked(`${track.title} ${track.album || ''}`, settings.blockWords)
    if (blocked) {
      markSeen.run(sub.id, track.id, track.title, null, 'blocked', now())
      skipped += 1
      continue
    }
    const inLibrary = findExistingFile(track.title, track.artists)
    if (inLibrary) {
      markSeen.run(sub.id, track.id, track.title, null, 'exists', now())
      continue
    }
    const done = db
      .prepare("SELECT id FROM tasks WHERE provider = ? AND track_id = ? AND status = 'done' LIMIT 1")
      .get(track.provider, track.id) as any
    if (done) {
      markSeen.run(sub.id, track.id, track.title, done.id, 'exists', now())
      continue
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
      quality: settings.quality,
      accountId: sub.account_id,
    })
    enqueueTask(task.id)
    markSeen.run(sub.id, track.id, track.title, task.id, 'queued', now())
    queued += 1
  }

  const message = `新增 ${queued} 首${skipped ? `，跳过 ${skipped} 首` : ''}`
  const ts = now()
  const next = new Date(Date.now() + sub.interval_min * 60_000).toISOString()
  db.prepare(
    "UPDATE subscriptions SET last_scan_at = ?, next_scan_at = ?, last_status = 'ok', last_message = ?, updated_at = ? WHERE id = ?",
  ).run(ts, next, message, ts, sub.id)
  return { queued, message }
}

let lastKeepAlive = 0

async function tick() {
  // 每 6 小时做一次账号保活（吸收 Cookie 轮换，减少 QQ 这类短期会话静默过期）
  if (Date.now() - lastKeepAlive > 6 * 3600_000) {
    lastKeepAlive = Date.now()
    void keepAliveAccounts()
  }
  if (scanning) return
  const due = db
    .prepare(
      "SELECT * FROM subscriptions WHERE enabled = 1 AND (next_scan_at IS NULL OR next_scan_at <= ?) ORDER BY next_scan_at ASC LIMIT 3",
    )
    .all(now()) as unknown as SubscriptionRow[]
  if (!due.length) return
  scanning = true
  try {
    for (const sub of due) {
      try {
        await scanSubscription(sub.id)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const ts = now()
        const next = new Date(Date.now() + sub.interval_min * 60_000).toISOString()
        db.prepare(
          "UPDATE subscriptions SET last_scan_at = ?, next_scan_at = ?, last_status = 'error', last_message = ?, updated_at = ? WHERE id = ?",
        ).run(ts, next, message, ts, sub.id)
        console.error(`[subscription ${sub.id}]`, message)
      }
    }
  } finally {
    scanning = false
  }
}

export function startScheduler() {
  if (timer) return
  timer = setInterval(() => void tick(), 30_000)
  setTimeout(() => void tick(), 5_000)
}

export function stopScheduler() {
  if (timer) clearInterval(timer)
  timer = null
}
