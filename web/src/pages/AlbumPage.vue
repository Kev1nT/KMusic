<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Disc3, Download, Loader2, CalendarDays, Building2, Music4, UserRound } from 'lucide-vue-next'
import { api, type AlbumDetail, type Quality } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import { useTasksStore } from '@/stores/tasks'
import { useToast } from '@/stores/toast'
import TrackList from '@/components/TrackList.vue'

const route = useRoute()
const router = useRouter()
const app = useAppStore()
const tasks = useTasksStore()
const toast = useToast()

const album = ref<AlbumDetail | null>(null)
const loading = ref(true)
const downloading = ref(false)

async function load() {
  loading.value = true
  try {
    const provider = String(route.query.provider || 'qq')
    const data = await api<{ album: AlbumDetail }>(`/albums/${route.params.mid}?provider=${provider}`)
    album.value = data.album
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '加载失败')
  } finally {
    loading.value = false
  }
}

function openArtist() {
  if (album.value?.artistId) router.push({ path: `/artist/${album.value.artistId}`, query: { provider: 'apple' } })
}

async function downloadAll() {
  if (!album.value) return
  downloading.value = true
  const quality = (app.settings?.quality || 'flac') as Quality
  let count = 0
  try {
    // 歌单（pl.）不能整包下——否则引擎会建一个「歌单名」文件夹；改成逐首下载，按每首的 艺术家/专辑 结构落盘
    const isPlaylist = /^pl\./i.test(String(album.value.id)) || !album.value.artistId
    // Apple Music 的「专辑」仍可整张交给引擎一次下完（引擎按 艺术家/专辑 落盘）
    if (String(route.query.provider) === 'apple' && album.value.url && album.value.tracks.length > 1 && !isPlaylist) {
      const whole = {
        provider: 'apple',
        id: album.value.id,
        title: album.value.name,
        artists: album.value.artist ? [album.value.artist] : ['Apple Music'],
        album: album.value.name,
        albumId: album.value.id,
        durationMs: 0,
        cover: album.value.cover,
        trackNo: 0,
        sourceUrl: album.value.url,
      }
      const res = await tasks.create(whole as any, quality)
      toast.success(res.skipped ? res.message || '已在队列中' : `已加入整张下载：${album.value.name}`)
      return
    }
    for (const track of album.value.tracks) {
      if (track.blocked) continue
      try {
        const res = await tasks.create(track, quality)
        if (!res.skipped) count += 1
      } catch {
        /* 跳过单曲失败 */
      }
    }
    toast.success(`已加入 ${count} 首到下载队列`)
  } finally {
    downloading.value = false
  }
}

onMounted(() => {
  app.loadSettings().catch(() => {})
  load()
})
// 同组件内切换专辑/歌单（路由参数变化）时重新加载，否则会停留在上一页
watch(
  () => [route.params.mid, route.query.provider],
  () => {
    if (route.name === 'album') load()
  },
)
</script>

<template>
  <div class="space-y-6">
    <button class="flex items-center gap-1.5 text-xs text-zinc-500 transition hover:text-zinc-300" @click="router.back()">
      <ArrowLeft :size="14" /> 返回
    </button>

    <div v-if="loading" class="space-y-4">
      <div class="skeleton h-44 rounded-3xl" />
      <div class="skeleton h-64 rounded-3xl" />
    </div>

    <template v-else-if="album">
      <header class="rise glass flex flex-col gap-5 rounded-3xl p-5 sm:flex-row sm:items-end">
        <div class="h-40 w-40 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-900 shadow-2xl">
          <img v-if="album.cover" :src="album.cover" class="h-full w-full object-cover" alt="" />
          <div v-else class="grid h-full w-full place-items-center text-zinc-600"><Disc3 :size="40" /></div>
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-[11px] uppercase tracking-[0.18em] text-violet-300/80">{{ album.artistId ? 'Album' : 'Playlist' }}</p>
          <h1 class="mt-1 text-2xl font-semibold tracking-tight">{{ album.name }}</h1>
          <p class="mt-1 text-sm text-zinc-400">
            <button v-if="album.artistId" class="inline-flex items-center gap-1 transition hover:text-violet-300" @click="openArtist">
              {{ album.artist }} <UserRound :size="12" />
            </button>
            <span v-else>{{ album.artist }}</span>
          </p>
          <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500">
            <span v-if="album.year" class="flex items-center gap-1"><CalendarDays :size="12" /> {{ album.year }}</span>
            <span v-if="album.genre" class="flex items-center gap-1"><Music4 :size="12" /> {{ album.genre }}</span>
            <span v-if="album.company" class="flex items-center gap-1"><Building2 :size="12" /> {{ album.company }}</span>
            <span>{{ album.trackCount || album.tracks.length }} 首</span>
          </div>
          <button
            :disabled="downloading"
            class="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-violet-600/20 transition hover:brightness-110 disabled:opacity-50"
            @click="downloadAll"
          >
            <Loader2 v-if="downloading" :size="14" class="animate-spin" />
            <Download v-else :size="14" />
            {{ downloading ? '正在加入' : '全部下载' }}
          </button>
        </div>
      </header>

      <p v-if="album.desc" class="rise line-clamp-3 text-xs leading-relaxed text-zinc-500">{{ album.desc }}</p>

      <section class="rise">
        <TrackList :tracks="album.tracks" :show-album="!album.artistId" />
      </section>
    </template>
  </div>
</template>
