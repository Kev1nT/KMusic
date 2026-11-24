<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  Search,
  LayoutDashboard,
  Music2,
  ListMusic,
  ArrowDownToLine,
  Library,
  Users,
  Settings,
  CornerDownLeft,
} from 'lucide-vue-next'

const router = useRouter()
const visible = ref(false)
const q = ref('')
const sel = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)

const navItems = [
  { key: 'dashboard', label: '首页 · 驾驶舱', icon: LayoutDashboard },
  { key: 'search', label: '搜索音乐', icon: Search },
  { key: 'apple', label: 'Apple Music', icon: Music2 },
  { key: 'playlists', label: '歌单与订阅', icon: ListMusic },
  { key: 'tasks', label: '下载任务', icon: ArrowDownToLine },
  { key: 'library', label: '媒体库', icon: Library },
  { key: 'accounts', label: '账号', icon: Users },
  { key: 'settings', label: '设置', icon: Settings },
]

interface Item {
  key: string
  label: string
  icon: any
  hint?: string
  run: () => void
}

const items = computed<Item[]>(() => {
  const kw = q.value.trim()
  const list: Item[] = []
  if (kw) {
    list.push({
      key: 'search-kw',
      label: `搜索 “${kw}”`,
      icon: Search,
      hint: 'Enter',
      run: () => router.push({ name: 'search', query: { q: kw } }),
    })
  }
  const nav = navItems
    .filter((n) => !kw || n.label.toLowerCase().includes(kw.toLowerCase()))
    .map((n) => ({
      key: n.key,
      label: n.label,
      icon: n.icon,
      run: () => router.push({ name: n.key }),
    }))
  return [...list, ...nav]
})

function move(d: number) {
  if (!items.value.length) return
  sel.value = (sel.value + d + items.value.length) % items.value.length
}
function exec(i = sel.value) {
  const it = items.value[i]
  if (!it) return
  visible.value = false
  it.run()
}
function show() {
  visible.value = true
  q.value = ''
  sel.value = 0
  nextTick(() => inputRef.value?.focus())
}

function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    visible.value ? (visible.value = false) : show()
    return
  }
  if (!visible.value) return
  if (e.key === 'Escape') visible.value = false
  else if (e.key === 'ArrowDown') {
    e.preventDefault()
    move(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    move(-1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    exec()
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
defineExpose({ show })
</script>

<template>
  <Teleport to="body">
    <Transition name="cmdk">
      <div v-if="visible" class="fixed inset-0 z-[80] flex items-start justify-center px-4 pt-[12vh]" @click.self="visible = false">
        <div class="absolute inset-0 bg-black/55 backdrop-blur-sm" @click="visible = false" />
        <div class="relative w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-[#14161d]/95 shadow-2xl shadow-black/60 backdrop-blur-2xl">
          <div class="flex items-center gap-3 border-b border-white/[0.07] px-4 py-3">
            <Search :size="18" class="shrink-0 text-zinc-500" />
            <input
              ref="inputRef"
              v-model="q"
              class="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
              placeholder="搜索歌曲 / 跳转页面…"
              @input="sel = 0"
            />
            <kbd class="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-500">ESC</kbd>
          </div>
          <div class="max-h-[52vh] overflow-y-auto p-2">
            <button
              v-for="(it, i) in items"
              :key="it.key"
              class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition"
              :class="i === sel ? 'bg-white/[0.08] text-white' : 'text-zinc-300 hover:bg-white/[0.04]'"
              @mouseenter="sel = i"
              @click="exec(i)"
            >
              <component :is="it.icon" :size="16" :class="i === sel ? 'text-violet-300' : 'text-zinc-500'" />
              <span class="flex-1 truncate">{{ it.label }}</span>
              <CornerDownLeft v-if="i === sel" :size="13" class="text-zinc-500" />
            </button>
            <p v-if="!items.length" class="px-3 py-8 text-center text-xs text-zinc-600">没有匹配项</p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cmdk-enter-active,
.cmdk-leave-active {
  transition: opacity 0.18s ease;
}
.cmdk-enter-from,
.cmdk-leave-to {
  opacity: 0;
}
</style>
