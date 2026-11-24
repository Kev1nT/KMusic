<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Search,
  Loader2,
  Sparkles,
  HardDrive,
  ListMusic,
  Disc3,
  X,
  Clock3,
  Music2,
  UserRound,
} from 'lucide-vue-next'
import { api, type AlbumSummary, type ArtistSummary, type Track } from '@/lib/api'
import { formatBytes } from '@/lib/format'
import { useAppStore } from '@/stores/app'
import { useToast } from '@/stores/toast'
import TrackList from '@/components/TrackList.vue'

const app = useAppStore()
const toast = useToast()
const router = useRouter()
const route = useRoute()

type Tab = 'song' | 'album' | 'artist'
const tab = ref<Tab>('song')
const provider = ref<'all' | 'qq' | 'netease' | 'qishui' | 'apple'>('all')
const platformFilter = ref<'all' | 'qq' | 'netease' | 'qishui' | 'apple'>('all')
const tabs: { key: Tab; label: string; icon: any }[] = [
  { key: 'song', label: '单曲', icon: Music2 },
  { key: 'album', label: '专辑', icon: Disc3 },
  { key: 'artist', label: '艺术家', icon: UserRound },
]

const keyword = ref('')
const page = ref(1)
const tracks = ref<Track[]>([])
const albums = ref<AlbumSummary[]>([])
const artists = ref<ArtistSummary[]>([])
const loading = ref(false)
const searched = ref(false)
const recents = ref<string[]>(JSON.parse(localStorage.getItem('sq_recent') || '[]'))

const hasAccount = computed(() => app.accounts.length > 0)
const hideBlocked = computed(() => app.settings?.hideBlocked ?? false)
const visibleTracks = computed(() => {
  let list = hideBlocked.value ? tracks.value.filter((t) => !t.blocked) : tracks.value
  if (platformFilter.value !== 'all') list = list.filter((t) => t.provider === platformFilter.value)
  return list
})

function pushRecent(word: string) {
  recents.value = [word, ...recents.value.filter((w) => w !== word)].slice(0, 6)
  localStorage.setItem('sq_recent', JSON.stringify(recents.value))
}

async function runSearch(word?: string, nextPage = 1) {
  const q = (word ?? keyword.value).trim()
  if (!q) return
  keyword.value = q
  page.value = nextPage
  loading.value = true
  searched.value = true
  try {
    if (provider.value === 'all') {
      const sources = ['qq', 'netease', 'qishui']
      if (app.accounts.some((a) => a.provider === 'apple')) sources.push('apple')
      const data = await api<any>(`/search/all?q=${encodeURIComponent(q)}&sources=${sources.join(',')}`)
      tracks.value = data.tracks || []
      albums.value = []
      artists.value = []
    } else {
      const data = await api<any>(`/search?q=${encodeURIComponent(q)}&page=${nextPage}&type=${tab.value}&provider=${provider.value}`)
      if (tab.value === 'song') tracks.value = data.tracks || []
      if (tab.value === 'album') albums.value = data.albums || []
      if (tab.value === 'artist') artists.value = data.artists || []
    }
    pushRecent(q)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '搜索失败')
    tracks.value = []
    albums.value = []
    artists.value = []
  } finally {
    loading.value = false
  }
}

function switchProvider(next: 'all' | 'qq' | 'netease' | 'qishui' | 'apple') {
  if (provider.value === next) return
  provider.value = next
  platformFilter.value = 'all'
  tracks.value = []
  albums.value = []
  artists.value = []
  if (next === 'all' || next === 'qishui' || next === 'apple') tab.value = 'song'
  if (keyword.value) runSearch()
}

function openAlbum(id: string) {
  router.push({ path: `/album/${id}`, query: { provider: provider.value } })
}
function openArtist(id: string) {
  router.push({ path: `/artist/${id}`, query: { provider: provider.value } })
}

function isTabDisabled(key: Tab): boolean {
  if (provider.value === 'all' || provider.value === 'qishui') return key !== 'song'
  return false
}

function switchTab(next: Tab) {
  if (tab.value === next) return
  tab.value = next
  if (keyword.value) runSearch()
}

onMounted(() => {
  app.loadStats().catch(() => {})
  app.loadAccounts().catch(() => {})
  app.loadSettings().catch(() => {})
  const q = String(route.query.q || '').trim()
  if (q) {
    keyword.value = q
    runSearch(q)
  }
})
</script>

<template>
  <div class="space-y-6">
    <header class="rise">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="text-xs font-medium uppercase tracking-[0.18em] text-violet-300/80">Discover</p>
          <h1 class="k-page-title mt-1.5">搜索你想收藏的声音</h1>
          <p class="mt-2 text-sm text-zinc-500">单曲、专辑、艺术家，一次找齐</p>
        </div>
        <div class="flex gap-2">
          <div class="glass flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5">
            <ListMusic :size="15" class="text-violet-300" />
            <div>
              <p class="text-[10px] uppercase tracking-wide text-zinc-500">进行中</p>
              <p class="text-sm font-semibold tabular-nums">{{ app.stats?.active ?? 0 }}</p>
            </div>
          </div>
          <div class="glass flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5">
            <HardDrive :size="15" class="text-cyan-300" />
            <div>
              <p class="text-[10px] uppercase tracking-wide text-zinc-500">已入库</p>
              <p class="text-sm font-semibold tabular-nums">{{ formatBytes(app.stats?.libraryBytes ?? 0) }}</p>
            </div>
          </div>
        </div>
      </div>
    </header>

    <section class="rise" style="animation-delay: 40ms">
      <form
        class="group relative flex items-center gap-2 rounded-3xl border border-white/10 bg-white/[0.04] p-2 shadow-2xl shadow-black/20 transition focus-within:border-violet-400/40 focus-within:bg-white/[0.06] focus-within:ring-4 focus-within:ring-violet-500/10"
        @submit.prevent="runSearch()"
      >
        <Search :size="20" class="ml-2 shrink-0 text-zinc-500" />
        <input
          v-model="keyword"
          class="min-w-0 flex-1 bg-transparent px-1 py-3 text-[15px] text-zinc-100 outline-none placeholder:text-zinc-600"
          :placeholder="'歌名、专辑或歌手，例如：晴天 / 叶惠美 / 周杰伦'"
          autocomplete="off"
        />
        <button v-if="keyword" type="button" class="grid h-8 w-8 place-items-center rounded-full text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200" @click="keyword = ''">
          <X :size="15" />
        </button>
        <button
          type="submit"
          :disabled="loading || !keyword.trim()"
          class="flex shrink-0 items-center gap-1.5 rounded-2xl bg-gradient-to-r from-violet-600 to-cyan-500 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-violet-600/25 transition hover:brightness-110 disabled:opacity-40 sm:px-5"
        >
          <Loader2 v-if="loading" :size="15" class="animate-spin" />
          <Search v-else :size="15" />
          <span class="hidden sm:inline">搜索</span>
        </button>
      </form>

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <div class="flex rounded-xl border border-white/[0.07] bg-white/[0.03] p-1">
          <button
            v-for="p in ([{ id: 'all', label: '全部' }, { id: 'qq', label: 'QQ音乐' }, { id: 'netease', label: '网易云' }, { id: 'qishui', label: '汽水' }, { id: 'apple', label: 'Apple Music' }] as const)"
            :key="p.id"
            class="rounded-lg px-2.5 py-1.5 text-xs transition"
            :class="provider === p.id ? 'bg-violet-500/20 text-violet-100' : 'text-zinc-500 hover:text-zinc-300'"
            @click="switchProvider(p.id)"
          >
            {{ p.label }}
          </button>
        </div>
        <div class="flex rounded-xl border border-white/[0.07] bg-white/[0.03] p-1">
          <button
            v-for="item in tabs"
            :key="item.key"
            class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition disabled:opacity-40"
            :class="tab === item.key ? 'bg-white/[0.09] text-white' : 'text-zinc-500 hover:text-zinc-300'"
            :disabled="isTabDisabled(item.key)"
            @click="switchTab(item.key)"
          >
            <component :is="item.icon" :size="13" />
            {{ item.label }}
          </button>
        </div>
        <div v-if="provider === 'all'" class="flex rounded-xl border border-white/[0.07] bg-white/[0.03] p-1">
          <button
            v-for="p in ([{ id: 'all', label: '全部平台' }, { id: 'qq', label: 'QQ' }, { id: 'netease', label: '网易云' }, { id: 'qishui', label: '汽水' }, { id: 'apple', label: 'Apple Music' }] as const)"
            :key="p.id"
            class="rounded-lg px-2.5 py-1.5 text-xs transition"
            :class="platformFilter === p.id ? 'bg-white/[0.09] text-white' : 'text-zinc-500 hover:text-zinc-300'"
            @click="platformFilter = p.id"
          >
            {{ p.label }}
          </button>
        </div>
        <template v-if="recents.length">
          <span class="ml-1 flex items-center gap-1 text-xs text-zinc-600"><Clock3 :size="12" /> 最近</span>
          <button
            v-for="word in recents"
            :key="word"
            class="rounded-full border border-white/[0.07] bg-white/[0.03] px-3 py-1 text-xs text-zinc-400 transition hover:border-violet-400/30 hover:text-zinc-200"
            @click="runSearch(word)"
          >
            {{ word }}
          </button>
        </template>
      </div>
    </section>

    <div v-if="!hasAccount" class="rise flex flex-wrap items-center gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-sm text-amber-200/90">
      <Sparkles :size="16" class="shrink-0" />
      <p class="flex-1">还没有绑定 QQ 音乐账号。无损下载需要先导入 VIP 账号的 Cookie。</p>
      <RouterLink to="/accounts" class="rounded-full bg-amber-300/15 px-3 py-1.5 text-xs font-medium text-amber-100 transition hover:bg-amber-300/25">去添加</RouterLink>
    </div>

    <section v-if="loading" class="space-y-2">
      <div v-for="i in 6" :key="i" class="flex items-center gap-4 rounded-2xl border border-white/[0.05] p-3">
        <div class="skeleton h-14 w-14 rounded-xl" />
        <div class="flex-1 space-y-2">
          <div class="skeleton h-3.5 w-1/3 rounded-full" />
          <div class="skeleton h-3 w-1/2 rounded-full" />
        </div>
      </div>
    </section>

    <template v-else-if="searched">
      <section v-if="tab === 'song' && visibleTracks.length" class="rise space-y-1">
        <p class="px-1 pb-1 text-xs text-zinc-500">找到 {{ visibleTracks.length }} 首 · 第 {{ page }} 页</p>
        <TrackList :tracks="visibleTracks" />
        <div class="flex justify-center gap-2 pt-4">
          <button class="rounded-full border border-white/10 px-4 py-2 text-xs text-zinc-400 transition hover:bg-white/5 disabled:opacity-30" :disabled="page <= 1" @click="runSearch(keyword, page - 1)">上一页</button>
          <button class="rounded-full border border-white/10 px-4 py-2 text-xs text-zinc-400 transition hover:bg-white/5" @click="runSearch(keyword, page + 1)">下一页</button>
        </div>
      </section>

      <section v-else-if="tab === 'album' && albums.length" class="rise">
        <p class="px-1 pb-3 text-xs text-zinc-500">找到 {{ albums.length }} 张专辑</p>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <button
            v-for="album in albums"
            :key="album.id"
            class="group overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] p-2.5 text-left transition hover:border-violet-400/30 hover:bg-white/[0.05]"
            @click="openAlbum(album.id)"
          >
            <div class="aspect-square overflow-hidden rounded-xl bg-gradient-to-br from-zinc-800 to-zinc-900">
              <img v-if="album.cover" :src="album.cover" class="h-full w-full object-cover transition duration-500 group-hover:scale-105" alt="" loading="lazy" />
              <div v-else class="grid h-full w-full place-items-center text-zinc-600"><Disc3 :size="28" /></div>
            </div>
            <p class="mt-2 truncate text-xs font-medium text-zinc-200">{{ album.name }}</p>
            <p class="mt-0.5 truncate text-[11px] text-zinc-500">{{ album.artist }}</p>
          </button>
        </div>
      </section>

      <section v-else-if="tab === 'artist' && artists.length" class="rise">
        <p class="px-1 pb-3 text-xs text-zinc-500">找到 {{ artists.length }} 位艺术家</p>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <button
            v-for="artist in artists"
            :key="artist.id"
            class="group flex flex-col items-center rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 transition hover:border-violet-400/30 hover:bg-white/[0.05]"
            @click="openArtist(artist.id)"
          >
            <div class="h-20 w-20 overflow-hidden rounded-full bg-gradient-to-br from-zinc-700 to-zinc-800 ring-2 ring-white/5">
              <img v-if="artist.avatar" :src="artist.avatar" class="h-full w-full object-cover" alt="" loading="lazy" />
              <div v-else class="grid h-full w-full place-items-center text-zinc-500"><UserRound :size="26" /></div>
            </div>
            <p class="mt-3 truncate text-xs font-medium text-zinc-200">{{ artist.name }}</p>
            <p class="mt-0.5 text-[10px] text-zinc-500">{{ artist.albumCount ? `${artist.albumCount} 张专辑` : '查看作品' }}</p>
          </button>
        </div>
      </section>

      <section v-else class="rise flex flex-col items-center justify-center py-20 text-center">
        <div class="grid h-16 w-16 place-items-center rounded-3xl border border-white/10 bg-white/[0.03] text-zinc-600">
          <Search :size="24" />
        </div>
        <p class="mt-4 text-sm text-zinc-400">没有找到「{{ keyword }}」的{{ tab === 'song' ? '单曲' : tab === 'album' ? '专辑' : '艺术家' }}</p>
        <p class="mt-1 text-xs text-zinc-600">换个关键词试试，或切换其他分类</p>
      </section>
    </template>

    <section v-else class="rise flex flex-col items-center justify-center py-16 text-center sm:py-24">
      <div class="relative">
        <div class="absolute inset-0 rounded-full bg-violet-500/20 blur-2xl" />
        <div class="pulse-ring relative grid h-20 w-20 place-items-center rounded-[28px] border border-white/10 bg-gradient-to-br from-white/[0.08] to-white/[0.02]">
          <Disc3 :size="30" class="text-violet-300" />
        </div>
      </div>
      <p class="mt-6 text-sm text-zinc-300">输入歌名、专辑或歌手开始</p>
      <p class="mt-1.5 max-w-xs text-xs leading-relaxed text-zinc-600">支持无损与 Hi-Res 下载，自动刮削封面、歌词与 NFO</p>
      <div class="mt-6 flex flex-wrap justify-center gap-2">
        <button v-for="word in ['周杰伦', '陈奕迅', '五月天', '林俊杰']" :key="word" class="rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-xs text-zinc-400 transition hover:border-violet-400/30 hover:text-zinc-200" @click="runSearch(word)">
          {{ word }}
        </button>
      </div>
    </section>
  </div>
</template>
