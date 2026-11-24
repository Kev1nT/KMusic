export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

export class HttpError extends Error {
  constructor(
    message: string,
    public status = 500,
  ) {
    super(message)
  }
}

export async function fetchJson<T = any>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 20_000, ...rest } = init
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        ...(rest.headers as Record<string, string> | undefined),
      },
    })
    if (!res.ok) throw new HttpError(`上游返回 ${res.status}`, 502)
    const text = await res.text()
    try {
      return JSON.parse(text) as T
    } catch {
      throw new HttpError(`上游返回非 JSON：${text.slice(0, 120)}`, 502)
    }
  } finally {
    clearTimeout(timer)
  }
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
