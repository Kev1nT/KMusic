export function resizeCover(url: string, size: number): string {
  if (!url) return url
  url = url.replace(/^http:\/\//, 'https://')
  if (url.includes('126.net')) {
    const base = url.split('?')[0]
    return `${base}?param=${size}y${size}`
  }
  return url.replace(/T00[12]R\d+x\d+M000/, (m) => m.replace(/R\d+x\d+/, `R${size}x${size}`))
}

export function withCoverSize<T extends { cover?: string }>(items: T[], size: number): T[] {
  return items.map((item) => (item.cover ? { ...item, cover: resizeCover(item.cover, size) } : item))
}

export function withAvatarSize<T extends { avatar?: string }>(items: T[], size: number): T[] {
  return items.map((item) =>
    item.avatar ? { ...item, avatar: item.avatar.replace(/R\d+x\d+/, `R${size}x${size}`) } : item,
  )
}
