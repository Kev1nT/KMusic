import { db, getAccount, now } from './db.js'
import { decrypt, encrypt } from './crypto.js'
import { getProvider } from './providers/registry.js'
import { getSettings } from './settings.js'
import { mergeCookie } from './util/cookie.js'
import { logEvent } from './logger.js'

interface ProfileResult {
  nickname: string
  avatar: string
  vip: number
  setCookie?: string[]
}

/**
 * 校验并顺带续期账号：
 * - 上游返回 Set-Cookie 时合并进本地 Cookie 并加密保存（QQ 的 qqmusic_key / p_skey 会随访问轮换）
 * - 成功则刷新昵称/头像/VIP 与校验时间
 */
export async function refreshAccount(id: number): Promise<void> {
  const account = getAccount(id)
  if (!account) throw new Error('账号不存在')
  const cookie = decrypt(account.cookie_enc)

  let profile: ProfileResult
  if (account.provider === 'apple') {
    const res = await fetch(`${getSettings().appleWrapperUrl}/status`, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) throw new Error(`wrapper /status 返回 ${res.status}`)
    profile = { nickname: 'Apple Music（Wrapper）', avatar: '', vip: 1 }
  } else {
    profile = (await getProvider(account.provider).profile({ cookie, uin: account.uid })) as ProfileResult
  }

  if (profile.setCookie?.length) {
    const merged = mergeCookie(cookie, profile.setCookie)
    if (merged && merged !== cookie) {
      db.prepare('UPDATE accounts SET cookie_enc = ?, updated_at = ? WHERE id = ?').run(encrypt(merged), now(), id)
    }
  }

  db.prepare(
    "UPDATE accounts SET status = 'ok', nickname = ?, avatar = ?, vip = ?, last_check_at = ?, updated_at = ? WHERE id = ?",
  ).run(profile.nickname, profile.avatar, profile.vip, now(), now(), id)
}

export function markAccountInvalid(id: number): void {
  db.prepare("UPDATE accounts SET status = 'invalid', updated_at = ? WHERE id = ?").run(now(), id)
}

/** 定时保活：保持会话活跃并吸收 Cookie 轮换，避免 QQ 这类短期会话静默过期 */
export async function keepAliveAccounts(): Promise<void> {
  const rows = db.prepare("SELECT id, provider, nickname FROM accounts").all() as any[]
  for (const row of rows) {
    try {
      await refreshAccount(row.id)
    } catch (err) {
      markAccountInvalid(row.id)
      logEvent('warn', '账号', `${row.provider} 登录态失效`, err instanceof Error ? err.message : String(err))
    }
  }
}
