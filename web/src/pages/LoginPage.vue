<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Disc3, Loader2, ArrowRight, ShieldCheck, Waves, Sparkles } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const password = ref('')
const error = ref('')

async function submit() {
  if (!password.value) return
  error.value = ''
  try {
    await auth.login(password.value)
    router.replace(String(route.query.next || '/'))
  } catch (err) {
    error.value = err instanceof Error ? err.message : '登录失败'
  }
}
</script>

<template>
  <div class="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
    <div class="pointer-events-none absolute inset-0 -z-10">
      <div class="absolute -top-32 left-1/2 h-[560px] w-[760px] -translate-x-1/2 rounded-full bg-violet-600/25 blur-[140px]" />
      <div class="absolute bottom-0 right-0 h-[420px] w-[420px] rounded-full bg-cyan-500/10 blur-[120px]" />
      <div class="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.05)_1px,transparent_0)] [background-size:28px_28px]" />
    </div>

    <div class="grid w-full max-w-5xl overflow-hidden rounded-[32px] lg:min-h-[560px] border border-white/10 bg-white/[0.03] shadow-2xl shadow-black/60 backdrop-blur-2xl lg:grid-cols-2">
      <div class="relative hidden flex-col justify-between p-10 lg:flex">
        <div class="flex items-center gap-3">
          <div class="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-400 shadow-lg shadow-violet-500/30">
            <Disc3 :size="23" class="text-white" />
          </div>
          <div>
            <p class="text-base font-semibold">KMusic</p>
            <p class="text-[11px] text-zinc-500">Self-hosted · Lossless</p>
          </div>
        </div>

        <div class="space-y-6">
          <h1 class="text-3xl font-semibold leading-tight tracking-tight">
            把喜欢的音乐，<br />
            <span class="text-gradient">留在自己的硬盘里</span>
          </h1>
          <p class="max-w-sm text-sm leading-relaxed text-zinc-400">
            QQ 音乐无损下载，自动刮削封面与歌词，按你的规则整理成 Emby / Jellyfin 能识别的音乐库。
          </p>
          <div class="space-y-3 text-sm text-zinc-400">
            <div class="flex items-center gap-2.5"><Waves :size="15" class="text-violet-300" /> 无损优先，自动降级兜底</div>
            <div class="flex items-center gap-2.5"><Sparkles :size="15" class="text-violet-300" /> 封面 / 歌词 / NFO 自动生成</div>
            <div class="flex items-center gap-2.5"><ShieldCheck :size="15" class="text-violet-300" /> Cookie 本地加密，不出内网</div>
          </div>
        </div>

        <p class="text-[11px] text-zinc-600">仅供个人学习与自用，请使用自己的 VIP 账号。</p>
      </div>

      <div class="flex flex-col justify-center border-t border-white/[0.06] p-8 sm:p-12 lg:border-l lg:border-t-0">
        <div class="mb-8 flex items-center gap-3 lg:hidden">
          <div class="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-400">
            <Disc3 :size="20" class="text-white" />
          </div>
          <p class="text-base font-semibold">KMusic</p>
        </div>

        <h2 class="text-xl font-semibold tracking-tight">欢迎回来</h2>
        <p class="mt-1.5 text-sm text-zinc-500">输入管理密码进入你的音乐库</p>

        <form class="mt-8 space-y-4" @submit.prevent="submit">
          <label class="block text-xs font-medium text-zinc-400">
            管理密码
            <input
              v-model="password"
              type="password"
              autocomplete="current-password"
              class="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3.5 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-violet-400/50 focus:bg-black/40 focus:ring-4 focus:ring-violet-500/10"
              placeholder="默认 admin，首次登录后请修改"
            />
          </label>

          <p v-if="error" class="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300">
            {{ error }}
          </p>

          <button
            type="submit"
            :disabled="auth.loading || !password"
            class="group flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-500 to-cyan-400 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-violet-600/25 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Loader2 v-if="auth.loading" :size="16" class="animate-spin" />
            <span>{{ auth.loading ? '正在进入' : '进入音乐库' }}</span>
            <ArrowRight v-if="!auth.loading" :size="16" class="transition group-hover:translate-x-0.5" />
          </button>
        </form>

        <p class="mt-8 text-[11px] leading-relaxed text-zinc-600">
          密码通过环境变量 <code class="rounded bg-white/5 px-1 py-0.5 text-zinc-400">ADMIN_PASSWORD</code> 配置，
          默认 <code class="rounded bg-white/5 px-1 py-0.5 text-zinc-400">admin</code>。
        </p>
      </div>
    </div>
  </div>
</template>
