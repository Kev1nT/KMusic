import { searchSongs as appleSearch } from '../providers/apple/api.js'

export interface ScrapedMeta {
  cover?: string
  album?: string
  year?: string
  trackNo?: number
}

const cache = new Map<string, ScrapedMeta>()
const norm = (s = '') => s.toLowerCase().replace(/[\s\-_·・.,，。'’"“”()（）[\]【】/]/g, '')

/**
 * 汽水音乐的封面是抖音 CDN 的签名 URI（需要 tplv 模板 + 签名），接口拿不到可直接访问的地址；
 * 因此在缺封面/专辑时，按「歌名 + 歌手」到 Apple 目录兜底刮削一版元数据。
 */
export async function scrapeMeta(title: string, artists: string[] = []): Promise<ScrapedMeta> {
  const t = norm(title)
  if (!t) return {}
  const key = `${t}|${norm(artists[0] || '')}`
  const hit = cache.get(key)
  if (hit) return hit

  const out: ScrapedMeta = {}
  try {
    const list = await appleSearch(`${title} ${artists[0] || ''}`.trim(), 1)
    const wanted = norm(artists[0] || '')
    const sameTitle = list.filter((x) => norm(x.title) === t)
    // 只接受标题精确匹配，宁缺勿错
    const pick =
      sameTitle.find((x) => wanted && (norm(x.artists[0]).includes(wanted) || wanted.includes(norm(x.artists[0])))) ||
      sameTitle[0]
    if (pick) {
      out.cover = pick.cover || undefined
      out.album = pick.album || undefined
      out.year = pick.year
      out.trackNo = pick.trackNo
    }
  } catch {
    /* 刮削失败不影响下载 */
  }
  cache.set(key, out)
  return out
}
