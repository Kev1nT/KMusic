import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { config } from './config.js'
import type { AccountPublic, AccountRow, TaskRow } from './types.js'

export const db = new DatabaseSync(path.join(config.dataDir, 'kmusic.db'))

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    uid TEXT NOT NULL,
    nickname TEXT NOT NULL DEFAULT '',
    alias TEXT NOT NULL DEFAULT '',
    library_path TEXT NOT NULL DEFAULT '',
    avatar TEXT NOT NULL DEFAULT '',
    vip INTEGER NOT NULL DEFAULT 0,
    cookie_enc TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ok',
    last_check_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(provider, uid)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    track_id TEXT NOT NULL,
    title TEXT NOT NULL,
    artists TEXT NOT NULL,
    album TEXT NOT NULL DEFAULT '',
    album_id TEXT NOT NULL DEFAULT '',
    cover TEXT NOT NULL DEFAULT '',
    duration_ms INTEGER NOT NULL DEFAULT 0,
    track_no INTEGER NOT NULL DEFAULT 0,
    year TEXT NOT NULL DEFAULT '',
    media_mid TEXT NOT NULL DEFAULT '',
    quality TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    progress INTEGER NOT NULL DEFAULT 0,
    total_bytes INTEGER NOT NULL DEFAULT 0,
    received_bytes INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    file_path TEXT,
    account_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    account_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'playlist',
    target_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    interval_min INTEGER NOT NULL DEFAULT 30,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_scan_at TEXT,
    next_scan_at TEXT,
    last_status TEXT,
    last_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(provider, account_id, target_id)
  );

  CREATE TABLE IF NOT EXISTS library_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    root TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    artist TEXT NOT NULL DEFAULT '',
    album TEXT NOT NULL DEFAULT '',
    duration_ms INTEGER NOT NULL DEFAULT 0,
    size INTEGER NOT NULL DEFAULT 0,
    mtime INTEGER NOT NULL DEFAULT 0,
    ext TEXT NOT NULL DEFAULT '',
    scanned_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_library_lookup ON library_files (artist, title);
  CREATE INDEX IF NOT EXISTS idx_library_root ON library_files (root);

  CREATE TABLE IF NOT EXISTS subscription_tracks (
    subscription_id INTEGER NOT NULL,
    track_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    task_id INTEGER,
    status TEXT NOT NULL DEFAULT 'queued',
    first_seen_at TEXT NOT NULL,
    PRIMARY KEY (subscription_id, track_id)
  );
`)

function ensureColumn(table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[]
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

ensureColumn('tasks', 'media_mid', "TEXT NOT NULL DEFAULT ''")
ensureColumn('tasks', 'source_url', "TEXT NOT NULL DEFAULT ''")
ensureColumn('accounts', 'alias', "TEXT NOT NULL DEFAULT ''")
ensureColumn('accounts', 'library_path', "TEXT NOT NULL DEFAULT ''")
ensureColumn('library_files', 'bitrate', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('library_files', 'codec', "TEXT NOT NULL DEFAULT ''")

export const now = () => new Date().toISOString()

export function getSetting<T = unknown>(key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value?: string } | undefined
  if (!row?.value) return fallback
  try {
    return JSON.parse(row.value) as T
  } catch {
    return fallback
  }
}

export function setSetting(key: string, value: unknown) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, JSON.stringify(value))
}

export function toPublicAccount(row: AccountRow): AccountPublic {
  return {
    id: row.id,
    provider: row.provider,
    uid: row.uid,
    nickname: row.nickname,
    alias: row.alias || '',
    libraryPath: row.library_path || '',
    avatar: row.avatar,
    vip: row.vip,
    isDefault: row.is_default === 1,
    status: row.status,
    lastCheckAt: row.last_check_at,
    createdAt: row.created_at,
  }
}

export function listAccounts(provider?: string): AccountPublic[] {
  const rows = provider
    ? (db.prepare('SELECT * FROM accounts WHERE provider = ? ORDER BY is_default DESC, id ASC').all(provider) as unknown as AccountRow[])
    : (db.prepare('SELECT * FROM accounts ORDER BY is_default DESC, id ASC').all() as unknown as AccountRow[])
  return rows.map(toPublicAccount)
}

export function getAccount(id: number): AccountRow | undefined {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as unknown as AccountRow | undefined
}

export function getDefaultAccount(provider: string): AccountRow | undefined {
  return db
    .prepare('SELECT * FROM accounts WHERE provider = ? ORDER BY is_default DESC, id ASC LIMIT 1')
    .get(provider) as unknown as AccountRow | undefined
}

export function createTask(input: {
  provider: string
  trackId: string
  title: string
  artists: string
  album: string
  albumId: string
  cover: string
  durationMs: number
  trackNo?: number
  year?: string
  mediaMid?: string
  sourceUrl?: string
  quality: string
  accountId?: number | null
}): TaskRow {
  const ts = now()
  const info = db
    .prepare(
      `INSERT INTO tasks (provider, track_id, title, artists, album, album_id, cover, duration_ms, track_no, year, media_mid, source_url, quality, status, account_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
    )
    .run(
      input.provider,
      input.trackId,
      input.title,
      input.artists,
      input.album,
      input.albumId,
      input.cover,
      input.durationMs,
      input.trackNo ?? 0,
      input.year ?? '',
      input.mediaMid ?? '',
      input.sourceUrl ?? '',
      input.quality,
      input.accountId ?? null,
      ts,
      ts,
    )
  return getTask(Number(info.lastInsertRowid))!
}

export function getTask(id: number): TaskRow | undefined {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as unknown as TaskRow | undefined
}

export function listTasks(limit = 50): TaskRow[] {
  return db.prepare('SELECT * FROM tasks ORDER BY id DESC LIMIT ?').all(limit) as unknown as TaskRow[]
}

export function updateTask(id: number, patch: Partial<TaskRow>) {
  const allowed: (keyof TaskRow)[] = [
    'track_id',
    'title',
    'artists',
    'album',
    'album_id',
    'cover',
    'status',
    'progress',
    'total_bytes',
    'received_bytes',
    'error',
    'file_path',
    'quality',
    'account_id',
    'updated_at',
  ]
  const keys = allowed.filter((k) => patch[k] !== undefined)
  if (!keys.length) return
  const sql = `UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`
  const values = keys.map((k) => (patch[k] as string | number | null) ?? null)
  db.prepare(sql).run(...values, now(), id)
}


export function deleteTask(id: number): boolean {
  const info = db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  return Number(info.changes || 0) > 0
}

export function deleteTasksByStatus(statuses: string[]): number {
  if (!statuses.length) return 0
  const placeholders = statuses.map(() => '?').join(',')
  const info = db.prepare(`DELETE FROM tasks WHERE status IN (${placeholders})`).run(...statuses)
  return Number(info.changes || 0)
}
