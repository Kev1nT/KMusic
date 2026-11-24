<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import {
  UserPlus,
  ShieldCheck,
  Trash2,
  RefreshCw,
  Star,
  X,
  Loader2,
  Crown,
  Cookie,
  ExternalLink,
  Users,
  Pencil,
  QrCode,
  Smartphone,
  Folder,
} from 'lucide-vue-next'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import { useToast } from '@/stores/toast'
import { useDialogStore } from '@/stores/dialog'
import { timeAgo } from '@/lib/format'

const app = useAppStore()
const toast = useToast()
const dialog = useDialogStore()

const open = ref(false)
const mode = ref<'qr' | 'cookie'>('qr')
const provider = ref<'qq' | 'netease' | 'qishui' | 'apple'>('qq')
const qqLoginType = ref<'qq' | 'wx'>('qq')
const cookie = ref('')
const submitting = ref(false)
const error = ref('')
const checking = ref<number | null>(null)

const qr = ref<{ id: string; status: string; qr: string; message?: string } | null>(null)
const qrLoading = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

function stopPoll() {
  if (timer) clearInterval(timer)
  timer = null
}

async function startQr() {
  qrLoading.value = true
  error.value = ''
  try {
    const endpoint = provider.value === 'qq' && qqLoginType.value === 'wx' ? '/accounts/qq/wx/qr' : `/accounts/${provider.value}/qr`
    qr.value = await api(endpoint, { method: 'POST' })
    stopPoll()
    timer = setInterval(pollQr, 2000)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '获取二维码失败'
  } finally {
    qrLoading.value = false
  }
}

async function pollQr() {
  if (!qr.value) return
  try {
    const base = provider.value === 'qq' && qqLoginType.value === 'wx' ? '/accounts/qq/wx/qr' : `/accounts/${provider.value}/qr`
    const next: any = await api(`${base}/${qr.value.id}`)
    qr.value = { ...qr.value, ...next }
    if (next.status === 'ok') {
      stopPoll()
      await app.loadAccounts()
      toast.success(`已绑定 ${next.nickname || 'QQ 音乐账号'}`)
      open.value = false
    } else if (next.status === 'error' || next.status === 'expired') {
      stopPoll()
    }
  } catch (err) {
    stopPoll()
    error.value = err instanceof Error ? err.message : '轮询失败'
  }
}

watch(open, (value) => {
  if (!value) {
    stopPoll()
    qr.value = null
  }
})

onUnmounted(stopPoll)
onMounted(() => app.loadAccounts().catch(() => {}))

async function submitApple() {
  error.value = ''
  submitting.value = true
  try {
    const account = await api<Account>('/accounts/apple', { method: 'POST' })
    await app.loadAccounts()
    toast.success('Apple Wrapper 就绪，已启用 Apple Music')
    open.value = false
    void account
  } catch (err) {
    error.value = err instanceof Error ? err.message : '绑定失败'
  } finally {
    submitting.value = false
  }
}

async function submitCookie() {
  error.value = ''
  if (cookie.value.trim().length < 20) {
    error.value = '请粘贴完整的 Cookie'
    return
  }
  submitting.value = true
  try {
    const account = await app.addAccount(cookie.value.trim(), provider.value)
    toast.success(`已绑定 ${account.nickname}`)
    open.value = false
    cookie.value = ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : '绑定失败'
  } finally {
    submitting.value = false
  }
}

async function rename(account: any) {
  const next = await dialog.prompt({ title: '修改备注名', message: '给这个账号起个名字（留空恢复昵称）', value: account.alias || account.nickname })
  if (next === null) return
  try {
    await app.renameAccount(account.id, next.trim())
    toast.success('已更新名称')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '重命名失败')
  }
}

async function setDirectory(account: any) {
  const next = await dialog.prompt({ title: '账号下载目录', message: '该账号的下载目录（留空则使用全局默认目录）', value: account.libraryPath || '' })
  if (next === null) return
  try {
    await api(`/accounts/${account.id}`, {
      method: 'PUT',
      body: JSON.stringify({ libraryPath: next.trim() }),
    })
    await app.loadAccounts()
    toast.success('下载目录已更新')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '更新失败')
  }
}

async function makeDefault(id: number) {
  try {
    await app.setDefault(id)
    toast.success('已设为统一下载账号')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '设置失败')
  }
}

async function openRelogin(account: any) {
  provider.value = account.provider as 'qq' | 'netease' | 'qishui' | 'apple'
  mode.value = 'qr'
  qqLoginType.value = 'qq'
  qr.value = null
  cookie.value = ''
  error.value = ''
  open.value = true
  await startQr()
}

async function check(id: number) {
  checking.value = id
  try {
    await app.checkAccount(id)
    toast.success('登录态有效')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '登录态已失效')
  } finally {
    checking.value = null
  }
}

async function remove(id: number) {
  if (!(await dialog.confirm({ title: '移除账号', message: '确定要移除这个账号吗？已下载的文件不会受影响。', danger: true }))) return
  try {
    await app.removeAccount(id)
    toast.success('账号已移除')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '移除失败')
  }
}
</script>

<template>
  <div class="space-y-7">
    <PageHeader label="Accounts" title="账号与下载通道" desc="绑定多个音乐账号，指定其中一个 VIP 账号统一下载">
      <template #actions>
        <button class="k-btn k-btn-primary" @click="open = true; mode = 'qr'">
          <UserPlus :size="16" /> 添加账号
        </button>
      </template>
    </PageHeader>

    <div v-if="!app.accounts.length && !app.loadingAccounts" class="rise glass rounded-3xl p-8 text-center sm:p-12">
      <div class="mx-auto grid h-16 w-16 place-items-center rounded-3xl border border-white/10 bg-white/[0.03] text-zinc-500">
        <Users :size="26" />
      </div>
      <h2 class="mt-5 text-base font-medium">还没有绑定账号</h2>
      <p class="mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-500">
        直接用手机扫码登录，或者从浏览器复制 Cookie 导入。Cookie 会加密保存在本地，不会上传到任何第三方。
      </p>
      <button class="mt-6 inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm text-zinc-200 transition hover:border-violet-400/40" @click="open = true; mode = 'qr'">
        <QrCode :size="16" /> 扫码登录
      </button>
    </div>

    <div v-else class="grid gap-3 sm:grid-cols-2">
      <article
        v-for="(account, index) in app.accounts"
        :key="account.id"
        class="rise glass group relative overflow-hidden rounded-3xl p-5 transition hover:border-white/15"
        :style="{ animationDelay: `${index * 50}ms` }"
      >
        <div class="flex items-start gap-4">
          <img v-if="account.avatar" :src="account.avatar" class="h-14 w-14 rounded-2xl object-cover ring-1 ring-white/10" alt="" />
          <div v-else class="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-zinc-700 to-zinc-800 text-zinc-400">
            <Users :size="20" />
          </div>

          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-1.5">
              <h3 class="truncate text-sm font-semibold text-zinc-100">{{ account.alias || account.nickname }}</h3>
              <button class="rounded p-1 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200" title="重命名" @click="rename(account)">
                <Pencil :size="11" />
              </button>
              <span class="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-zinc-400">{{ account.provider === 'netease' ? '网易云' : account.provider === 'qishui' ? '汽水' : account.provider === 'apple' ? 'Apple Music' : 'QQ' }}</span>
              <span v-if="account.vip" class="inline-flex items-center gap-1 rounded-md bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                <Crown :size="10" /> VIP
              </span>
              <span v-if="account.isDefault" class="rounded-md bg-violet-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-violet-200">统一下载</span>
              <span v-if="account.status !== 'ok'" class="rounded-md bg-rose-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">登录态失效</span>
            </div>
            <p class="mt-1 text-xs text-zinc-500">{{ account.alias ? account.nickname + ' · ' : '' }}{{ account.provider === 'netease' ? '网易云' : account.provider === 'qishui' ? '汽水' : account.provider === 'apple' ? 'Apple Music' : 'QQ' }} {{ account.uid }}</p>
            <button class="mt-1 flex max-w-full items-center gap-1 text-[10px] text-zinc-600 transition hover:text-zinc-300" @click="setDirectory(account)">
              <Folder :size="10" class="shrink-0" />
              <span class="truncate">{{ account.libraryPath || '默认下载目录' }}</span>
            </button>
            <p class="mt-1 text-[11px] text-zinc-600">{{ account.lastCheckAt ? `最近校验 ${timeAgo(account.lastCheckAt)}` : '尚未校验' }}</p>
          </div>
        </div>

        <div class="mt-5 flex items-center gap-1.5 border-t border-white/[0.06] pt-3">
          <button v-if="!account.isDefault" class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200" @click="makeDefault(account.id)">
            <Star :size="12" /> 设为下载账号
          </button>
          <span v-else class="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-violet-300"><ShieldCheck :size="12" /> 当前下载通道</span>
          <button class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-violet-300 transition hover:bg-violet-500/10 hover:text-violet-200" @click="openRelogin(account)">
            <RefreshCw :size="12" /> 重新登录
          </button>
          <button class="ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200" :disabled="checking === account.id" @click="check(account.id)">
            <RefreshCw :size="12" :class="checking === account.id ? 'animate-spin' : ''" /> 检测
          </button>
          <button class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-500 transition hover:bg-rose-500/10 hover:text-rose-300" @click="remove(account.id)">
            <Trash2 :size="12" /> 移除
          </button>
        </div>
      </article>
    </div>

    <Teleport to="body">
      <Transition name="fade">
        <div v-if="open" class="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6" @click.self="open = false">
          <div class="w-full max-w-lg overflow-hidden rounded-t-3xl border border-white/10 bg-[#0d0f15] shadow-2xl sm:rounded-3xl">
            <div class="space-y-2.5 border-b border-white/[0.06] px-5 py-3.5">
              <div class="flex items-center justify-between">
                <div class="flex gap-1 rounded-xl border border-white/[0.07] bg-white/[0.03] p-1">
                  <button class="rounded-lg px-3 py-1.5 text-xs transition" :class="provider === 'qq' ? 'bg-violet-500/20 text-violet-100' : 'text-zinc-500'" @click="provider = 'qq'; qr = null; stopPoll()">
                    QQ 音乐
                  </button>
                  <button class="rounded-lg px-3 py-1.5 text-xs transition" :class="provider === 'netease' ? 'bg-violet-500/20 text-violet-100' : 'text-zinc-500'" @click="provider = 'netease'; mode = 'qr'; qr = null; stopPoll()">
                    网易云音乐
                  </button>
                  <button class="rounded-lg px-3 py-1.5 text-xs transition" :class="provider === 'qishui' ? 'bg-violet-500/20 text-violet-100' : 'text-zinc-500'" @click="provider = 'qishui'; mode = 'qr'; qr = null; stopPoll()">
                    汽水音乐
                  </button>
                  <button class="rounded-lg px-3 py-1.5 text-xs transition" :class="provider === 'apple' ? 'bg-violet-500/20 text-violet-100' : 'text-zinc-500'" @click="provider = 'apple'; mode = 'cookie'; qr = null; stopPoll()">
                    Apple Music
                  </button>
                </div>
                <button class="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200" @click="open = false">
                  <X :size="18" />
                </button>
              </div>
              <div class="flex gap-1 rounded-xl border border-white/[0.07] bg-white/[0.03] p-1">
                <button v-if="provider !== 'apple'" class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition" :class="mode === 'qr' ? 'bg-white/[0.09] text-white' : 'text-zinc-500'" @click="mode = 'qr'">
                  <QrCode :size="13" /> 扫码登录
                </button>
                <button v-if="provider !== 'qishui'" class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition" :class="mode === 'cookie' ? 'bg-white/[0.09] text-white' : 'text-zinc-500'" @click="mode = 'cookie'">
                  <Cookie :size="13" /> {{ provider === 'apple' ? '启用 Apple' : 'Cookie 导入' }}
                </button>
              </div>
            </div>

            <div class="max-h-[72vh] overflow-y-auto px-5 py-5">
              <template v-if="mode === 'qr'">
                <div class="flex flex-col items-center text-center">
                  <div v-if="provider === 'qq'" class="mb-3 flex rounded-xl border border-white/[0.07] bg-white/[0.03] p-1">
                    <button class="rounded-lg px-3 py-1.5 text-[11px] transition" :class="qqLoginType === 'qq' ? 'bg-white/[0.09] text-white' : 'text-zinc-500'" @click="qqLoginType = 'qq'; qr = null; stopPoll()">QQ 扫码</button>
                    <button class="rounded-lg px-3 py-1.5 text-[11px] transition" :class="qqLoginType === 'wx' ? 'bg-white/[0.09] text-white' : 'text-zinc-500'" @click="qqLoginType = 'wx'; qr = null; stopPoll()">微信扫码</button>
                  </div>
                  <div v-if="!qr" class="grid h-40 w-40 place-items-center rounded-2xl border border-white/10 bg-white/[0.03] text-zinc-600">
                    <Smartphone :size="30" />
                  </div>
                  <img v-else :src="qr.qr" class="h-40 w-40 rounded-2xl bg-white p-2" alt="QQ 登录二维码" />
                  <p class="mt-4 text-sm text-zinc-300">
                    {{ qr ? (provider === 'qishui' ? ({ waiting: '请使用抖音 App 扫码', scanned: '已扫码，请在手机上确认', confirmed: '正在登录…', error: '登录失败', expired: '二维码已失效' } as any) : provider === 'netease' ? ({ waiting: '请使用网易云音乐 App 扫码', scanned: '已扫码，请在手机上确认', confirmed: '正在登录…', error: '登录失败', expired: '二维码已失效' } as any) : qqLoginType === 'wx' ? ({ waiting: '请使用微信扫码', scanned: '已扫码，请在手机上确认', confirmed: '正在登录…', error: '登录失败', expired: '二维码已失效' } as any) : ({ waiting: '请使用手机 QQ 扫码', scanned: '已扫码，请在手机上确认', confirmed: '正在登录…', error: '登录失败', expired: '二维码已失效' } as any))[qr.status] : '点击下方按钮获取二维码' }}
                  </p>
                  <p class="mt-1 text-xs text-zinc-600">{{ qr?.message || '扫码后账号会自动出现在列表里' }}</p>
                  <button
                    class="mt-4 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-xs text-zinc-200 transition hover:border-violet-400/40 disabled:opacity-50"
                    :disabled="qrLoading"
                    @click="startQr"
                  >
                    <Loader2 v-if="qrLoading" :size="14" class="animate-spin" />
                    <RefreshCw v-else :size="14" />
                    {{ qr ? '刷新二维码' : '获取二维码' }}
                  </button>
                </div>
                <p class="mt-5 flex items-start gap-2 text-[11px] leading-relaxed text-zinc-600">
                  <ShieldCheck :size="13" class="mt-0.5 shrink-0" />
                  扫码由{{ provider === 'qq' ? '腾讯' : provider === 'netease' ? '网易云' : '抖音' }}官方登录页完成，我们只保存登录后的 Cookie，并加密存储在本机。
                </p>
              </template>

              <template v-else-if="provider === 'apple'">
                <p class="text-xs leading-relaxed text-zinc-400">
                  Apple Music 音频由 kmusic 内置引擎经 <b class="text-zinc-200">wrapper</b> 做 FairPlay 解密下载。
                  这里只做「连通性检查并启用」，真正的 Apple 账号登录在 wrapper 容器侧完成。
                </p>
                <div class="mt-4 rounded-xl border border-white/10 bg-black/30 px-3.5 py-3 text-[11px] leading-relaxed text-zinc-500">
                  <p>· 首次使用请在 NAS 上给 <code class="rounded bg-white/5 px-1 text-zinc-300">apple-wrapper</code> 配置 Apple ID 并完成 2FA；</p>
                  <p class="mt-1">· 验证码写入 <code class="rounded bg-white/5 px-1 text-zinc-300">/vol2/1000/Docker/kmusic/apple-wrapper/2fa.txt</code> 后重启该容器；</p>
                  <p class="mt-1">· 登录态缓存后会一直有效，之后点下方按钮即可启用。</p>
                </div>
              </template>

              <template v-else>
                <ol class="space-y-2 text-xs leading-relaxed text-zinc-400">
                  <li class="flex gap-2">
                    <span class="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/5 text-[10px] text-zinc-400">1</span>
                    <span>
                      浏览器打开
                      <a :href="provider === 'qq' ? 'https://y.qq.com' : 'https://music.163.com'" target="_blank" rel="noreferrer" class="inline-flex items-center gap-0.5 text-violet-300 hover:underline">
                        {{ provider === 'qq' ? 'y.qq.com' : 'music.163.com' }} <ExternalLink :size="10" />
                      </a>
                      并登录
                    </span>
                  </li>
                  <li class="flex gap-2">
                    <span class="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/5 text-[10px] text-zinc-400">2</span>
                    <span>F12 → Network → 刷新 → 任意请求 → 复制 Request Headers 里的 <code class="rounded bg-white/5 px-1 text-zinc-300">Cookie</code></span>
                  </li>
                  <li class="flex gap-2">
                    <span class="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/5 text-[10px] text-zinc-400">3</span>
                    <span v-if="provider === 'qq'">粘贴到下面，必须包含 <code class="rounded bg-white/5 px-1 text-zinc-300">uin</code> 和 <code class="rounded bg-white/5 px-1 text-zinc-300">qm_keyst</code></span>
                    <span v-else>粘贴到下面，必须包含 <code class="rounded bg-white/5 px-1 text-zinc-300">MUSIC_U</code>（VIP 账号才有无损权限）</span>
                  </li>
                </ol>
                <textarea
                  v-model="cookie"
                  rows="6"
                  spellcheck="false"
                  class="mt-4 w-full resize-none rounded-2xl border border-white/10 bg-black/40 p-3.5 font-mono text-[11px] leading-relaxed text-zinc-300 outline-none transition placeholder:text-zinc-600 focus:border-violet-400/40 focus:ring-4 focus:ring-violet-500/10"
                  placeholder="uin=o1234567890; qm_keyst=...; qqmusic_key=...;"
                />
              </template>

              <p v-if="error" class="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{{ error }}</p>
            </div>

            <div class="flex justify-end gap-2 border-t border-white/[0.06] px-5 py-4">
              <button class="rounded-xl px-4 py-2 text-xs text-zinc-400 transition hover:text-zinc-200" @click="open = false">关闭</button>
              <button
                v-if="mode === 'cookie'"
                :disabled="submitting"
                class="flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-cyan-400 px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                @click="provider === 'apple' ? submitApple() : submitCookie()"
              >
                <Loader2 v-if="submitting" :size="14" class="animate-spin" />
                {{ submitting ? '校验中' : '保存并校验' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
