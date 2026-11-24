import { db, now } from './db.js'
import { encrypt } from './crypto.js'

export function cleanCookie(raw: string): string {
  return raw
    .replace(/\r?\n/g, '; ')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/^(Max-Age|Expires|Path|Domain|HttpOnly|Secure|SameSite|Priority)=/i.test(s))
    .join('; ')
}

export function upsertAccount(
  provider: string,
  uid: string,
  profile: { nickname: string; avatar: string; vip: number },
  cookie: string,
): number {
  const ts = now()
  db.prepare(
    `INSERT INTO accounts (provider, uid, nickname, alias, avatar, vip, cookie_enc, is_default, status, last_check_at, created_at, updated_at)
     VALUES (?, ?, ?, '', ?, ?, ?, 0, 'ok', ?, ?, ?)
     ON CONFLICT(provider, uid) DO UPDATE SET
       nickname = excluded.nickname,
       avatar = excluded.avatar,
       vip = excluded.vip,
       cookie_enc = excluded.cookie_enc,
       status = 'ok',
       last_check_at = excluded.last_check_at,
       updated_at = excluded.updated_at`,
  ).run(provider, uid, profile.nickname, profile.avatar, profile.vip, encrypt(cookie), ts, ts, ts)

  const row = db.prepare('SELECT * FROM accounts WHERE provider = ? AND uid = ?').get(provider, uid) as any
  const hasDefault = (db
    .prepare('SELECT COUNT(*) c FROM accounts WHERE provider = ? AND is_default = 1')
    .get(provider) as any).c
  if (!hasDefault) {
    db.prepare('UPDATE accounts SET is_default = 1 WHERE id = ?').run(row.id)
    const current = db.prepare('SELECT value FROM settings WHERE key = ?').get('settings') as any
    const parsed = current?.value ? JSON.parse(current.value) : {}
    if (parsed.downloadAccountId === undefined || parsed.downloadAccountId === null) {
      parsed.downloadAccountId = row.id
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
        'settings',
        JSON.stringify(parsed),
      )
    }
  }
  return row.id as number
}
