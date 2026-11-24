/** 把上游响应的 Set-Cookie 合并进已有 Cookie 串（用于会话续期） */
export function mergeCookie(oldCookie: string, setCookies: string[]): string {
  const map = new Map<string, string>()
  for (const part of String(oldCookie || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) map.set(part.slice(0, i).trim(), part.slice(i + 1).trim())
  }
  for (const raw of setCookies) {
    const first = String(raw).split(';')[0]
    const i = first.indexOf('=')
    if (i <= 0) continue
    const k = first.slice(0, i).trim()
    const v = first.slice(i + 1).trim()
    if (v && v.toLowerCase() !== 'deleted') map.set(k, v)
    else map.delete(k)
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}
