<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Music2, Search, Loader2, Disc3, ListMusic, UserRound, ChevronRight } from 'lucide-vue-next'
import { api, type AlbumSummary, type ArtistSummary, type Track } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import { useToast } from '@/stores/toast'
import TrackList from '@/components/TrackList.vue'

const router = useRouter()
const app = useAppStore()
const toast = useToast()

const loading = ref(true)
const charts = ref<{ albums: AlbumSummary[]; playlists: AlbumSummary[]; spatialPlaylists: AlbumSummary[]; songs: Track[] }>({
  albums: [],
  playlists: [],
  spatialPlaylists: [],
  songs: [],
})

const keyword = ref('')
const searching = ref(false)
const hasSearch = ref(false)
const tab = ref<'song' | 'album' | 'artist'>('song')
const result = ref<{ songs: Track[]; albums: AlbumSummary[]; artists: ArtistSummary[] }>({
  songs: [],
  albums: [],
  artists: [],
})

async function loadCharts() {
  loading.value = true
  try {
    const d = await api<{ albums: AlbumSummary[]; playlists: AlbumSummary[]; spatialPlaylists: AlbumSummary[]; songs: Track[] }>('/apple/charts')
    charts.value = {
      albums: d.albums || [],
      playlists: d.playlists || [],
      spatialPlaylists: d.spatialPlaylists || [],
      songs: d.songs || [],
    }
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '加载 Apple Music 榜单失败')
  } finally {
    loading.value = false
  }
}

async function runSearch() {
  const q = keyword.value.trim()
  if (!q) {
    hasSearch.value = false
    return
  }
  searching.value = true
  hasSearch.value = true
  try {
    const data = await api<any>(`/search?q=${encodeURIComponent(q)}&type=${tab.value}&provider=apple`)
    if (tab.value === 'song') result.value.songs = data.tracks || []
    if (tab.value === 'album') result.value.albums = data.albums || []
    if (tab.value === 'artist') result.value.artists = data.artists || []
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '搜索失败')
  } finally {
    searching.value = false
  }
}

function switchTab(next: 'song' | 'album' | 'artist') {
  if (tab.value === next) return
  tab.value = next
  if (keyword.value.trim()) runSearch()
}

function clearSearch() {
  keyword.value = ''
  hasSearch.value = false
}

function openAlbum(id: string) {
  router.push({ path: `/album/${id}`, query: { provider: 'apple' } })
}
function openArtist(id: string) {
  router.push({ path: `/artist/${id}`, query: { provider: 'apple' } })
}

onMounted(() => {
  app.loadSettings().catch(() => {})
  loadCharts()
})
</script>

<template>
  <div class="space-y-7">
    <!-- Hero -->
    <header class="rise relative overflow-hidden rounded-3xl border border-white/[0.06] bg-gradient-to-br from-rose-500/15 via-fuchsia-500/10 to-transparent p-6 sm:p-8">
      <div class="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-rose-500/20 blur-3xl" />
      <div class="relative flex items-center gap-3">
        <div class="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-rose-500 to-fuchsia-500 shadow-lg shadow-rose-500/30">
          <Music2 :size="22" class="text-white" />
        </div>
        <div>
          <h1 class="k-page-title">Apple Music</h1>
          <p class="text-xs text-zinc-400">无损 · 全景声 · 逐字歌词 · 在线试听</p>
        </div>
      </div>

      <form class="relative mt-6 flex gap-2" @submit.prevent="runSearch">
        <div class="flex flex-1 items-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-3.5 py-2.5 backdrop-blur">
          <Search :size="16" class="text-zinc-500" />
          <input
            v-model="keyword"
            placeholder="搜索歌曲、专辑或艺术家"
            class="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
          />
          <button v-if="hasSearch" type="button" class="text-xs text-zinc-500 hover:text-zinc-300" @click="clearSearch">清除</button>
        </div>
        <button
          type="submit"
          :disabled="searching"
          class="flex shrink-0 items-center gap-1.5 rounded-2xl bg-gradient-to-r from-rose-500 to-fuchsia-500 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-rose-500/25 transition hover:brightness-110 disabled:opacity-40"
        >
          <Loader2 v-if="searching" :size="15" class="animate-spin" />
          <Search v-else :size="15" />
          搜索
        </button>
      </form>
    </header>

    <!-- 搜索结果 -->
    <template v-if="hasSearch">
      <div class="flex gap-1 rounded-xl border border-white/[0.07] bg-white/[0.03] p-1">
        <button
          v-for="t in ([['song', '单曲'], ['album', '专辑'], ['artist', '艺术家']] as const)"
          :key="t[0]"
          class="rounded-lg px-3.5 py-1.5 text-xs transition"
          :class="tab === t[0] ? 'bg-white/[0.09] text-white' : 'text-zinc-500 hover:text-zinc-300'"
          @click="switchTab(t[0])"
        >
          {{ t[1] }}
        </button>
      </div>

      <div v-if="searching" class="grid gap-2">
        <div v-for="i in 6" :key="i" class="skeleton h-20 rounded-2xl" />
      </div>
      <TrackList v-else-if="tab === 'song'" :tracks="result.songs" />
      <div v-else-if="tab === 'album'" class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div v-for="a in result.albums" :key="a.id" class="group text-left">
          <button class="block w-full" title="打开专辑" @click="openAlbum(a.id)">
            <div class="aspect-square overflow-hidden rounded-2xl bg-zinc-800">
              <img v-if="a.cover" :src="a.cover" class="h-full w-full object-cover transition duration-500 group-hover:scale-105" alt="" />
            </div>
          </button>
          <button class="mt-2 block w-full truncate text-left text-xs font-medium text-zinc-200 transition hover:text-violet-300" @click="openAlbum(a.id)">{{ a.name }}</button>
          <p class="truncate text-[11px] text-zinc-500">{{ a.artist }}</p>
        </div>
      </div>
      <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div v-for="ar in result.artists" :key="ar.id" class="group text-center">
          <button class="mx-auto block w-full" @click="openArtist(ar.id)">
            <div class="mx-auto aspect-square w-full overflow-hidden rounded-full bg-zinc-800">
              <img v-if="ar.avatar" :src="ar.avatar" class="h-full w-full object-cover transition duration-500 group-hover:scale-105" alt="" />
              <div v-else class="grid h-full w-full place-items-center text-zinc-600"><UserRound :size="30" /></div>
            </div>
          </button>
          <button class="mt-2 block w-full truncate text-xs font-medium text-zinc-200 transition hover:text-violet-300" @click="openArtist(ar.id)">{{ ar.name }}</button>
        </div>
      </div>
    </template>

    <!-- 榜单 -->
    <template v-else>
      <div v-if="loading" class="grid gap-3">
        <div class="skeleton h-40 rounded-3xl" />
        <div class="skeleton h-40 rounded-3xl" />
      </div>
      <template v-else>
        <section>
          <div class="mb-3 flex items-center gap-2">
            <Disc3 :size="16" class="text-rose-300" />
            <h2 class="text-sm font-semibold text-zinc-200">热门专辑</h2>
            <ChevronRight :size="14" class="text-zinc-600" />
          </div>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <div v-for="a in charts.albums" :key="a.id" class="group text-left">
              <button class="block w-full" title="打开专辑" @click="openAlbum(a.id)">
                <div class="relative aspect-square overflow-hidden rounded-2xl bg-zinc-800 shadow-lg shadow-black/20">
                  <img v-if="a.cover" :src="a.cover" class="h-full w-full object-cover transition duration-500 group-hover:scale-105" alt="" />
                  <span v-if="a.hasAtmos" class="absolute left-2 top-2 rounded-md bg-cyan-500/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">ATMOS</span>
                </div>
              </button>
              <button class="mt-2 block w-full truncate text-left text-xs font-medium text-zinc-200 transition hover:text-violet-300" @click="openAlbum(a.id)">{{ a.name }}</button>
              <button
                v-if="a.artistId"
                class="block w-full truncate text-left text-[11px] text-zinc-500 transition hover:text-violet-300"
                title="查看艺术家"
                @click="openArtist(a.artistId)"
              >{{ a.artist }}</button>
              <p v-else class="truncate text-[11px] text-zinc-500">{{ a.artist }}</p>
            </div>
          </div>
        </section>

        <section>
          <div class="mb-3 flex items-center gap-2">
            <ListMusic :size="16" class="text-fuchsia-300" />
            <h2 class="text-sm font-semibold text-zinc-200">热门歌单</h2>
            <ChevronRight :size="14" class="text-zinc-600" />
          </div>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <div v-for="p in charts.playlists" :key="p.id" class="group text-left">
              <button class="block w-full" title="打开歌单" @click="openAlbum(p.id)">
                <div class="relative aspect-square overflow-hidden rounded-2xl bg-zinc-800 shadow-lg shadow-black/20 ring-1 ring-transparent transition group-hover:ring-fuchsia-400/40">
                  <img v-if="p.cover" :src="p.cover" class="h-full w-full object-cover transition duration-500 group-hover:scale-105" alt="" />
                  <span v-if="p.trackCount" class="absolute right-2 top-2 rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] text-white/80">{{ p.trackCount }} 首</span>
                </div>
              </button>
              <button class="mt-2 block w-full truncate text-left text-xs font-medium text-zinc-200 transition hover:text-violet-300" @click="openAlbum(p.id)">{{ p.name }}</button>
              <button class="block w-full truncate text-left text-[11px] text-zinc-500 transition hover:text-violet-300" title="打开歌单" @click="openAlbum(p.id)">{{ p.artist }}</button>
            </div>
          </div>
        </section>

        <section v-if="charts.spatialPlaylists.length">
          <div class="mb-3 flex items-center gap-2">
            <span class="rounded-md bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300">ATMOS</span>
            <h2 class="text-sm font-semibold text-zinc-200">全景声 / 空间音频专区</h2>
            <span class="text-[11px] text-zinc-600">这些歌单内多数曲目支持 Dolby Atmos</span>
            <ChevronRight :size="14" class="text-zinc-600" />
          </div>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <div v-for="p in charts.spatialPlaylists" :key="p.id" class="group text-left">
              <button class="block w-full" title="打开歌单" @click="openAlbum(p.id)">
                <div class="relative aspect-square overflow-hidden rounded-2xl bg-gradient-to-br from-cyan-900/40 to-zinc-800 shadow-lg shadow-black/20 ring-1 ring-cyan-400/20 transition group-hover:ring-cyan-300/60">
                  <img v-if="p.cover" :src="p.cover" class="h-full w-full object-cover transition duration-500 group-hover:scale-105" alt="" />
                  <span class="absolute left-2 top-2 rounded-md bg-cyan-500/85 px-1.5 py-0.5 text-[10px] font-semibold text-white">ATMOS</span>
                  <span v-if="p.trackCount" class="absolute right-2 top-2 rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] text-white/80">{{ p.trackCount }} 首</span>
                </div>
              </button>
              <button class="mt-2 block w-full truncate text-left text-xs font-medium text-zinc-200 transition hover:text-violet-300" @click="openAlbum(p.id)">{{ p.name }}</button>
              <button class="block w-full truncate text-left text-[11px] text-cyan-300/70 transition hover:text-violet-300" title="打开歌单" @click="openAlbum(p.id)">{{ p.artist }}</button>
            </div>
          </div>
        </section>

        <section>
          <div class="mb-3 flex items-center gap-2">
            <Music2 :size="16" class="text-rose-300" />
            <h2 class="text-sm font-semibold text-zinc-200">热门歌曲</h2>
            <ChevronRight :size="14" class="text-zinc-600" />
          </div>
          <TrackList :tracks="charts.songs" />
        </section>
      </template>
    </template>
  </div>
</template>
