<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterView, RouterLink, useRoute } from 'vue-router'
import {
  Disc3,
  Search,
  Music2,
  ArrowDownToLine,
  LayoutDashboard,
  Library,
  ListMusic,
  Users,
  Settings,
  LogOut,
  Command,
  Terminal,
} from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'
import Toaster from './Toaster.vue'
import DialogHost from './DialogHost.vue'
import GlobalLoadingBar from './GlobalLoadingBar.vue'
import PlayerBar from './PlayerBar.vue'
import CommandPalette from './CommandPalette.vue'
import LogPanel from './LogPanel.vue'

const route = useRoute()
const auth = useAuthStore()
const app = useAppStore()
const cmdk = ref<InstanceType<typeof CommandPalette> | null>(null)
const logOpen = ref(false)

const nav = [
  { name: 'dashboard', label: '首页', icon: LayoutDashboard, group: 0 },
  { name: 'search', label: '搜索', icon: Search, group: 0 },
  { name: 'apple', label: 'Apple Music', icon: Music2, group: 0 },
  { name: 'library', label: '媒体库', icon: Library, group: 1 },
  { name: 'playlists', label: '歌单', icon: ListMusic, group: 1 },
  { name: 'tasks', label: '下载', icon: ArrowDownToLine, group: 1 },
  { name: 'accounts', label: '账号', icon: Users, group: 2 },
  { name: 'settings', label: '设置', icon: Settings, group: 2 },
]
const mobileNav = nav.slice(0, 5)

const active = computed(() => String(route.name || ''))
const account = computed(() => app.defaultAccount)
const activeTasks = computed(() => app.stats?.active || 0)
const titleMap: Record<string, string> = {
  dashboard: '首页',
  search: '搜索',
  apple: 'Apple Music',
  library: '媒体库',
  playlists: '歌单',
  tasks: '下载任务',
  accounts: '账号',
  settings: '设置',
  album: '专辑',
  artist: '艺术家',
}
const pageTitle = computed(() => titleMap[active.value] || 'KMusic')

onMounted(() => {
  app.loadAccounts().catch(() => {})
  app.loadStats().catch(() => {})
})
</script>

<template>
  <div class="relative min-h-full">
    <!-- 环境光 -->
    <div class="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div class="absolute -top-40 left-1/4 h-[520px] w-[520px] rounded-full bg-violet-600/20 blur-[140px]" />
      <div class="absolute top-1/3 -right-40 h-[460px] w-[460px] rounded-full bg-cyan-500/10 blur-[140px]" />
      <div class="absolute -bottom-52 left-0 h-[420px] w-[420px] rounded-full bg-fuchsia-600/10 blur-[140px]" />
      <div class="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.04)_1px,transparent_0)] [background-size:28px_28px] opacity-50" />
    </div>

    <!-- 桌面图标 rail -->
    <aside class="fixed inset-y-0 left-0 z-40 hidden w-[76px] flex-col items-center border-r border-white/[0.06] bg-black/25 py-5 backdrop-blur-2xl lg:flex">
      <RouterLink to="/" class="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-400 shadow-lg shadow-violet-500/30">
        <Disc3 :size="22" class="text-white" />
      </RouterLink>

      <nav class="mt-7 flex flex-1 flex-col items-center gap-1.5">
        <template v-for="(item, i) in nav" :key="item.name">
          <div v-if="i > 0 && nav[i - 1].group !== item.group" class="my-2 h-px w-8 bg-white/[0.07]" />
          <RouterLink
            :to="{ name: item.name }"
            class="group relative grid h-11 w-11 place-items-center rounded-xl transition-all duration-200"
            :class="active === item.name ? 'bg-white/[0.09] text-white' : 'text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200'"
          >
            <span
              v-if="active === item.name"
              class="absolute -left-[18px] h-6 w-1 rounded-full bg-gradient-to-b from-violet-400 to-cyan-400"
            />
            <component :is="item.icon" :size="20" :class="active === item.name ? 'text-violet-200' : ''" />
            <span
              v-if="item.name === 'tasks' && activeTasks"
              class="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-violet-500 px-1 text-[9px] font-bold text-white"
            >{{ activeTasks }}</span>
            <span class="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-lg border border-white/10 bg-[#151821] px-2.5 py-1 text-xs text-zinc-200 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
              {{ item.label }}
            </span>
          </RouterLink>
        </template>
      </nav>

      <div class="mt-auto flex flex-col items-center gap-2">
        <button class="group relative grid h-10 w-10 place-items-center rounded-full transition hover:bg-white/5" @click="auth.logout()">
          <LogOut :size="18" class="text-zinc-600 transition group-hover:text-zinc-300" />
          <span class="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-lg border border-white/10 bg-[#151821] px-2.5 py-1 text-xs text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100">退出登录</span>
        </button>
      </div>
    </aside>

    <!-- 桌面顶栏 -->
    <header class="sticky top-0 z-30 hidden items-center gap-3 border-b border-white/[0.06] bg-[#07080b]/70 px-6 py-2.5 backdrop-blur-xl lg:flex lg:pl-[100px]">
      <h2 class="text-sm font-semibold tracking-tight text-zinc-300">{{ pageTitle }}</h2>
      <button
        class="ml-auto flex w-72 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-zinc-500 transition hover:border-white/15 hover:bg-white/[0.05]"
        @click="cmdk?.show()"
      >
        <Search :size="14" />
        <span class="flex-1 text-left">搜索或跳转…</span>
        <kbd class="flex items-center gap-0.5 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px]"><Command :size="10" />K</kbd>
      </button>
      <button
        class="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-zinc-400 transition hover:text-white"
        title="程序日志"
        @click="logOpen = true"
      >
        <Terminal :size="16" />
      </button>
      <RouterLink to="/tasks" class="relative grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-zinc-400 transition hover:text-white">
        <ArrowDownToLine :size="16" />
        <span v-if="activeTasks" class="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-violet-500 px-1 text-[9px] font-bold text-white">{{ activeTasks }}</span>
      </RouterLink>
      <RouterLink to="/accounts" class="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-2 py-1.5 transition hover:border-white/20">
        <img v-if="account?.avatar" :src="account.avatar" class="h-6 w-6 rounded-full object-cover ring-1 ring-white/15" alt="" />
        <div v-else class="grid h-6 w-6 place-items-center rounded-full bg-zinc-800 text-zinc-400"><Users :size="13" /></div>
        <span class="max-w-24 truncate text-[11px] text-zinc-300">{{ account?.alias || account?.nickname || '未绑定' }}</span>
      </RouterLink>
    </header>

    <!-- 移动端顶栏 -->
    <header class="sticky top-0 z-30 flex items-center justify-between border-b border-white/[0.06] bg-[#07080b]/85 px-4 py-3 backdrop-blur-xl lg:hidden">
      <div class="flex items-center gap-2.5">
        <div class="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-cyan-400">
          <Disc3 :size="17" class="text-white" />
        </div>
        <span class="text-sm font-semibold tracking-tight">{{ pageTitle }}</span>
      </div>
      <div class="flex items-center gap-2">
        <button class="grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-white/5 text-zinc-400" @click="cmdk?.show()">
          <Search :size="15" />
        </button>
        <button class="grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-white/5 text-zinc-400" title="程序日志" @click="logOpen = true">
          <Terminal :size="15" />
        </button>
        <RouterLink to="/accounts" class="grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-white/5">
          <img v-if="account?.avatar" :src="account.avatar" class="h-8 w-8 rounded-full object-cover" alt="" />
          <Users v-else :size="15" class="text-zinc-400" />
        </RouterLink>
      </div>
    </header>

    <main class="lg:pl-[76px]">
      <div class="mx-auto w-full max-w-7xl px-4 pt-6 pb-28 sm:px-6 lg:px-8 lg:pt-8 lg:pb-32">
        <RouterView />
      </div>
    </main>

    <!-- 移动端底部 tab -->
    <nav class="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.07] bg-[#0a0b10]/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-2xl lg:hidden">
      <div class="grid grid-cols-5">
        <RouterLink
          v-for="item in mobileNav"
          :key="item.name"
          :to="{ name: item.name }"
          class="relative flex flex-col items-center gap-1 py-2.5 text-[10px] transition-colors"
          :class="active === item.name ? 'text-violet-300' : 'text-zinc-500'"
        >
          <component :is="item.icon" :size="20" />
          <span>{{ item.label }}</span>
          <span v-if="item.name === 'tasks' && activeTasks" class="absolute right-[26%] top-1.5 h-1.5 w-1.5 rounded-full bg-violet-400" />
        </RouterLink>
      </div>
    </nav>

    <CommandPalette ref="cmdk" />
    <LogPanel v-model:open="logOpen" />
    <Toaster />
    <DialogHost />
    <GlobalLoadingBar />
    <PlayerBar />
  </div>
</template>
