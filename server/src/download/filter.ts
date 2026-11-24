export function findBlocked(text: string, words: string[]): string | null {
  if (!text || !words?.length) return null
  const haystack = text.toLowerCase()
  for (const raw of words) {
    const word = raw.trim().toLowerCase()
    if (word && haystack.includes(word)) return raw.trim()
  }
  return null
}

export function annotateBlocked<T extends { title: string; album?: string }>(
  items: T[],
  words: string[],
): (T & { blocked?: boolean; blockedBy?: string })[] {
  return items.map((item) => {
    const hit = findBlocked(`${item.title} ${item.album || ''}`, words)
    return hit ? { ...item, blocked: true, blockedBy: hit } : { ...item, blocked: false }
  })
}
