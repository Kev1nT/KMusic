<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, UserRound, Disc3, Music2 } from 'lucide-vue-next'
import { api, type ArtistDetail } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import { useToast } from '@/stores/toast'
import TrackList from '@/components/TrackList.vue'

const route = useRoute()
const router = useRouter()
const provider = String(route.query.provider || 'qq')
const app = useAppStore()
const toast = useToast()

const artist = ref<ArtistDetail | null>(null)
const loading = ref(true)
const tab = ref<'songs' | 'albums'>('songs')

async function load() {
  loading.value = true
  try {
    const data = await api<{ artist: ArtistDetail }>(`/artists/${route.params.mid}?provider=${provider}`)
    artist.value = data.artist
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  app.loadSettings().catch(() => {})
watch(
  () => [route.params.mid, route.query.provider],
  () => {
    if (route.name === 'artist') load()
  },
)
  load()
})
</script>

<template>
  <div class="space-y-6">
    <button class="flex items-center gap-1.5 text-xs text-zinc-500 transition hover:text-zinc-300" @click="router.back()">
      <ArrowLeft :size="14" /> 返回
    </button>

    <div v-if="loading" class="space-y-4">
      <div class="skeleton h-40 rounded-3xl" />
      <div class="skeleton h-64 rounded-3xl" />
    </div>

    <template v-else-if="artist">
      <header class="rise glass flex flex-col items-center gap-5 rounded-3xl p-6 text-center sm:flex-row sm:items-end sm:text-left">
        <div class="h-32 w-32 shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-zinc-700 to-zinc-800 ring-2 ring-white/10">
          <img v-if="artist.avatar" :src="artist.avatar" class="h-full w-full object-cover" alt="" />
          <div v-else class="grid h-full w-full place-items-center text-zinc-500"><UserRound :size="34" /></div>
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-[11px] uppercase tracking-[0.18em] text-violet-300/80">Artist</p>
          <h1 class="mt-1 text-2xl font-semibold tracking-tight">{{ artist.name }}</h1>
          <p class="mt-2 text-[11px] text-zinc-500">
            {{ artist.songCount || artist.songs.length }} 首单曲 · {{ artist.albumCount || artist.albums.length }} 张专辑
          </p>
          <p v-if="artist.brief" class="mt-2 line-clamp-2 max-w-2xl text-xs leading-relaxed text-zinc-500">{{ artist.brief }}</p>
        </div>
      </header>

      <div class="rise flex rounded-xl border border-white/[0.07] bg-white/[0.03] p-1 sm:w-fit">
        <button class="flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs transition" :class="tab === 'songs' ? 'bg-white/[0.09] text-white' : 'text-zinc-500 hover:text-zinc-300'" @click="tab = 'songs'">
          <Music2 :size="13" /> 热门单曲
        </button>
        <button class="flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs transition" :class="tab === 'albums' ? 'bg-white/[0.09] text-white' : 'text-zinc-500 hover:text-zinc-300'" @click="tab = 'albums'">
          <Disc3 :size="13" /> 专辑
        </button>
      </div>

      <section v-if="tab === 'songs'" class="rise">
        <TrackList :tracks="artist.songs" />
      </section>

      <section v-else class="rise grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <button
          v-for="album in artist.albums"
          :key="album.id"
          class="group overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] p-2.5 text-left transition hover:border-violet-400/30 hover:bg-white/[0.05]"
          @click="router.push({ path: `/album/${album.id}`, query: { provider } })"
        >
          <div class="aspect-square overflow-hidden rounded-xl bg-gradient-to-br from-zinc-800 to-zinc-900">
            <img v-if="album.cover" :src="album.cover" class="h-full w-full object-cover transition duration-500 group-hover:scale-105" alt="" loading="lazy" />
            <div v-else class="grid h-full w-full place-items-center text-zinc-600"><Disc3 :size="28" /></div>
          </div>
          <p class="mt-2 truncate text-xs font-medium text-zinc-200">{{ album.name }}</p>
          <p class="mt-0.5 text-[11px] text-zinc-500">{{ album.year || '—' }}</p>
        </button>
      </section>
    </template>
  </div>
</template>
