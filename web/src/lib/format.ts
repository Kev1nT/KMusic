export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** i
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

export function formatDuration(ms: number): string {
  if (!ms) return '--:--'
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function timeAgo(iso: string): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  return `${Math.floor(hour / 24)} 天前`
}

export const STATUS_META: Record<string, { label: string; tone: string }> = {
  queued: { label: '排队中', tone: 'text-zinc-300 bg-white/5' },
  resolving: { label: '解析中', tone: 'text-sky-300 bg-sky-500/10' },
  downloading: { label: '下载中', tone: 'text-violet-300 bg-violet-500/10' },
  verifying: { label: '校验中', tone: 'text-amber-300 bg-amber-500/10' },
  tagging: { label: '写入标签', tone: 'text-cyan-300 bg-cyan-500/10' },
  done: { label: '已完成', tone: 'text-emerald-300 bg-emerald-500/10' },
  failed: { label: '失败', tone: 'text-rose-300 bg-rose-500/10' },
  canceled: { label: '已取消', tone: 'text-zinc-400 bg-white/5' },
}
