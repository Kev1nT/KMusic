<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  Ban,
  FolderCog,
  FileText,
  AudioLines,
  Music2,
  Gauge,
  Save,
  Loader2,
  Wand2,
  UserCheck,
  Check,
} from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { useToast } from '@/stores/toast'
import type { Quality, Settings } from '@/lib/api'
import PageHeader from '@/components/PageHeader.vue'
import Toggle from '@/components/Toggle.vue'

const app = useAppStore()
const toast = useToast()
const saving = ref(false)
const dirty = ref(false)
let ready = false

const form = reactive<Settings>({
  libraryPath: '',
  template: '{artist}/{album}/{track:02d} - {title}',
  quality: 'flac',
  coverSize: 800,
  blockWords: [],
  hideBlocked: false,
  fallback: true,
  writeNfo: true,
  writeLrc: true,
  embedCover: true,
  embedLyrics: true,
  concurrency: 2,
  downloadAccountId: null,
  appleWrapperUrl: 'http://127.0.0.1:12340',
  appleAlacDir: '/music/Apple/Lossless',
  appleAtmosDir: '/music/Apple/Atmos',
  appleAacDir: '/music/Apple/AAC',
  appleStorefront: 'cn',
  appleCodec: 'alac',
  appleDualDownload: true,
  appleConvertFlac: false,
  appleLyricType: 'syllable',
  appleLyricFormat: 'lrc',
  appleEmbedLyric: true,
  appleSaveLrc: true,
  appleCoverSize: '3000x3000',
})

type TabId = 'storage' | 'quality' | 'apple' | 'meta' | 'filter'
const tabs = [
  { id: 'storage' as TabId, label: '下载与存储', desc: '落盘位置、命名、取链账号', icon: FolderCog },
  { id: 'quality' as TabId, label: '音质与性能', desc: '默认音质、降级兜底、并发', icon: AudioLines },
  { id: 'apple' as TabId, label: 'Apple Music', desc: '编码、目录、歌词、解密', icon: Music2 },
  { id: 'meta' as TabId, label: '元数据与刮削', desc: '标签、封面、Emby 刮削', icon: FileText },
  { id: 'filter' as TabId, label: '过滤', desc: '屏蔽词与隐藏规则', icon: Ban },
]
const active = ref<TabId>('storage')

const metaToggles = [
  { key: 'embedCover', label: '内嵌封面', desc: '写入音频标签，播放器直接显示' },
  { key: 'embedLyrics', label: '内嵌歌词', desc: '写入 LYRICS 标签' },
  { key: 'writeLrc', label: '旁挂 .lrc', desc: '同名歌词文件' },
  { key: 'writeNfo', label: '生成 album.nfo / cover.jpg', desc: 'Emby、Jellyfin 刮削用' },
]

const tokens = ['{artist}', '{artists}', '{album}', '{title}', '{track:02d}', '{year}', '{ext}']
const sample = { artist: '周杰伦', artists: '周杰伦', album: '叶惠美', title: '晴天', track: 3, year: '2003' }
const preview = computed(() => {
  let out = form.template
  out = out.replace(/\{(\w+):0(\d)d\}/g, (_m, key: string, width: string) =>
    key === 'track' ? String(sample.track).padStart(Number(width), '0') : '',
  )
  out = out.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const value = (sample as any)[key]
    return value !== undefined ? String(value) : key === 'ext' ? 'flac' : ''
  })
  return out.split('/').map((s) => s.replace(/[\\/:*?"<>|]/g, '_').trim()).filter(Boolean).join(' / ')
})
function addToken(token: string) {
  form.template += token
}

async function save() {
  saving.value = true
  try {
    await app.saveSettings({ ...form })
    toast.success('设置已保存，新任务立即生效')
    dirty.value = false
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '保存失败')
  } finally {
    saving.value = false
  }
}

watch(form, () => {
  if (ready) dirty.value = true
}, { deep: true })

onMounted(async () => {
  await Promise.all([app.loadSettings(), app.loadAccounts()])
  if (app.settings) Object.assign(form, app.settings)
  ready = true
})
</script>

<template>
  <div class="pb-16">
    <PageHeader label="Settings" title="设置中心" desc="按用途分区管理，改动在下个任务生效">
      <template #actions>
        <div class="flex items-center gap-2 text-[11px] text-zinc-500">
          <span class="h-1.5 w-1.5 rounded-full" :class="dirty ? 'bg-amber-400' : 'bg-emerald-400'" />
          {{ dirty ? '有未保存的修改' : '已同步' }}
        </div>
      </template>
    </PageHeader>

    <div class="grid gap-5 lg:grid-cols-[240px_1fr]">
      <!-- 分类导航 -->
      <aside class="k-card h-max self-start p-2 lg:sticky lg:top-20">
        <div class="flex gap-1.5 overflow-x-auto lg:flex-col lg:overflow-visible">
          <button
            v-for="t in tabs"
            :key="t.id"
            class="group flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left transition lg:w-full"
            :class="active === t.id ? 'bg-white/[0.08] text-white' : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'"
            @click="active = t.id"
          >
            <component :is="t.icon" :size="17" :class="active === t.id ? 'text-violet-300' : 'text-zinc-500 group-hover:text-zinc-300'" />
            <span class="hidden min-w-0 flex-1 lg:block">
              <span class="block truncate text-[13px] font-medium">{{ t.label }}</span>
              <span class="block truncate text-[10px] text-zinc-500">{{ t.desc }}</span>
            </span>
            <span class="text-xs lg:hidden">{{ t.label }}</span>
          </button>
        </div>
      </aside>

      <!-- 内容区 -->
      <div class="space-y-4">
        <!-- 下载与存储 -->
        <template v-if="active === 'storage'">
          <section class="k-card rise p-5">
            <h2 class="flex items-center gap-2 text-sm font-semibold"><FolderCog :size="16" class="text-violet-300" /> 下载位置</h2>
            <p class="mt-1 text-xs text-zinc-500">容器内路径，需映射到 NAS 上的媒体目录</p>
            <input v-model="form.libraryPath" spellcheck="false" class="mt-3 w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 font-mono text-xs text-zinc-200 outline-none transition focus:border-violet-400/40" placeholder="/music" />
          </section>

          <section class="k-card rise p-5">
            <h2 class="flex items-center gap-2 text-sm font-semibold"><UserCheck :size="16" class="text-cyan-300" /> 统一下载账号</h2>
            <p class="mt-1 text-xs text-zinc-500">读取他人歌单时，也由这个账号取下载链接</p>
            <select v-model="form.downloadAccountId" class="mt-3 w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-xs text-zinc-200 outline-none transition focus:border-violet-400/40">
              <option :value="null">自动选择默认账号</option>
              <option v-for="a in app.accounts" :key="a.id" :value="a.id">{{ a.nickname }}（QQ {{ a.uid }}）{{ a.vip ? ' · VIP' : '' }}</option>
            </select>
          </section>

          <section class="k-card rise p-5">
            <h2 class="flex items-center gap-2 text-sm font-semibold"><Wand2 :size="16" class="text-violet-300" /> 命名模板</h2>
            <p class="mt-1 text-xs text-zinc-500">用 / 分隔目录层级，{track:02d} 会补零</p>
            <input v-model="form.template" class="mt-3 w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-3 font-mono text-xs text-zinc-200 outline-none transition focus:border-violet-400/40" />
            <div class="mt-3 flex flex-wrap gap-1.5">
              <button v-for="token in tokens" :key="token" class="rounded-lg border border-white/[0.07] bg-white/[0.03] px-2 py-1 font-mono text-[10px] text-zinc-400 transition hover:border-violet-400/30 hover:text-zinc-200" @click="addToken(token)">{{ token }}</button>
            </div>
            <div class="mt-4 rounded-2xl border border-white/[0.06] bg-black/20 px-4 py-3">
              <p class="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-zinc-600"><Wand2 :size="11" /> 示例预览</p>
              <p class="mt-1.5 break-all font-mono text-xs text-zinc-300">{{ preview }}<span class="text-zinc-600">.flac</span></p>
            </div>
          </section>
        </template>

        <!-- 音质与性能 -->
        <template v-else-if="active === 'quality'">
          <section class="k-card rise p-5">
            <h2 class="flex items-center gap-2 text-sm font-semibold"><AudioLines :size="16" class="text-emerald-300" /> 默认音质</h2>
            <div class="mt-3 grid grid-cols-4 gap-2">
              <button
                v-for="q in ([['hires', 'Hi-Res'], ['flac', '无损'], ['320', '320K'], ['128', '128K']] as const)"
                :key="q[0]"
                class="rounded-xl border px-2 py-2.5 text-xs transition"
                :class="form.quality === q[0] ? 'border-violet-400/40 bg-violet-500/15 text-violet-100' : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20'"
                @click="form.quality = q[0] as Quality"
              >{{ q[1] }}</button>
            </div>
            <Toggle v-model="form.fallback" class="mt-3" label="自动降级兜底" desc="无损不可用时依次尝试 320K / 128K" />
            <p class="mt-3 text-[10px] leading-relaxed text-zinc-600">Hi-Res 需 SVIP 且曲目支持；实际可用音质取决于会员等级与单曲授权，失败会自动降级。</p>
          </section>

          <section class="k-card rise p-5">
            <h2 class="flex items-center gap-2 text-sm font-semibold"><Gauge :size="16" class="text-amber-300" /> 并发与限速</h2>
            <p class="mt-1 text-xs text-zinc-500">同时下载的任务数，太高容易触发平台风控</p>
            <div class="mt-4 flex items-center gap-4">
              <input v-model.number="form.concurrency" type="range" min="1" max="4" step="1" class="h-1 flex-1 accent-violet-500" />
              <span class="w-16 rounded-lg bg-white/[0.06] px-2 py-1 text-center text-xs tabular-nums text-zinc-200">{{ form.concurrency }} 个</span>
            </div>
            <p class="mt-2 text-[10px] text-zinc-600">建议 1–2 个；触发限流时任务会自动失败并在队列中显示原因。</p>
          </section>
        </template>

        <!-- Apple Music -->
        <template v-else-if="active === 'apple'">
          <section class="k-card rise p-5">
            <h2 class="flex items-center gap-2 text-sm font-semibold"><Music2 :size="16" class="text-rose-300" /> 编码与歌词</h2>
            <p class="mt-1 text-xs text-zinc-500">内置 apple-music-dl 引擎，经 wrapper 做 FairPlay 解密</p>
            <div class="mt-4 grid gap-3 sm:grid-cols-2">
              <label class="block text-[11px] text-zinc-500">音质 / 编码
                <select v-model="form.appleCodec" class="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-violet-400/40">
                  <option value="alac">ALAC 无损（最高 24bit/192kHz）</option>
                  <option value="atmos">Dolby Atmos 全景声</option>
                  <option value="aac">AAC 有损</option>
                </select>
              </label>
              <label class="block text-[11px] text-zinc-500">歌词粒度
                <select v-model="form.appleLyricType" class="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-violet-400/40">
                  <option value="syllable">逐字（syllable）</option>
                  <option value="line">逐句（line）</option>
                </select>
              </label>
              <label class="block text-[11px] text-zinc-500">歌词格式
                <select v-model="form.appleLyricFormat" class="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-violet-400/40">
                  <option value="lrc">LRC</option>
                  <option value="ttml">TTML</option>
                </select>
              </label>
              <label class="block text-[11px] text-zinc-500">封面尺寸
                <select v-model="form.appleCoverSize" class="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-violet-400/40">
                  <option value="5000x5000">5000×5000</option>
                  <option value="3000x3000">3000×3000</option>
                  <option value="1400x1400">1400×1400</option>
                </select>
              </label>
            </div>
            <div class="mt-3 grid gap-2">
              <Toggle v-model="form.appleDualDownload" label="无损 + 全景声双下" desc="同一首同时有 ALAC 与 Atmos 时两版都下，分别落各自目录" />
              <Toggle v-model="form.appleConvertFlac" label="无损转 FLAC 文件" desc="ALAC 装在同 .m4a 容器里的无损；开启后无损那版再转成 .flac（全景声不转）" />
              <div class="grid gap-2 sm:grid-cols-2">
                <Toggle v-model="form.appleEmbedLyric" label="内嵌歌词" />
                <Toggle v-model="form.appleSaveLrc" label="另存 .lrc 文件" />
              </div>
            </div>
          </section>

          <section class="k-card rise p-5">
            <h2 class="flex items-center gap-2 text-sm font-semibold"><FolderCog :size="16" class="text-amber-300" /> 目录与地区</h2>
            <p class="mt-1 text-xs text-zinc-500">三种编码分别落到不同目录，便于媒体库按音质分离</p>
            <div class="mt-4 grid gap-3 sm:grid-cols-2">
              <label class="block text-[11px] text-zinc-500">ALAC 无损目录
                <input v-model="form.appleAlacDir" spellcheck="false" class="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-zinc-200 outline-none focus:border-violet-400/40" />
              </label>
              <label class="block text-[11px] text-zinc-500">Dolby Atmos 目录
                <input v-model="form.appleAtmosDir" spellcheck="false" class="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-zinc-200 outline-none focus:border-violet-400/40" />
              </label>
              <label class="block text-[11px] text-zinc-500">AAC 目录
                <input v-model="form.appleAacDir" spellcheck="false" class="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-zinc-200 outline-none focus:border-violet-400/40" />
              </label>
              <label class="block text-[11px] text-zinc-500">目录地区（storefront）
                <input v-model="form.appleStorefront" maxlength="2" spellcheck="false" placeholder="cn / us / jp" class="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-zinc-200 outline-none focus:border-violet-400/40" />
              </label>
            </div>
          </section>

          <section class="k-card rise p-5">
            <h2 class="flex items-center gap-2 text-sm font-semibold"><Gauge :size="16" class="text-cyan-300" /> 解密服务</h2>
            <p class="mt-1 text-xs text-zinc-500">FairPlay 解密后端（wrapper）地址</p>
            <input v-model="form.appleWrapperUrl" spellcheck="false" class="mt-3 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-zinc-200 outline-none focus:border-violet-400/40" />
          </section>
        </template>

        <!-- 元数据与刮削 -->
        <template v-else-if="active === 'meta'">
          <section class="k-card rise p-5">
            <h2 class="flex items-center gap-2 text-sm font-semibold"><FileText :size="16" class="text-cyan-300" /> 标签与刮削</h2>
            <div class="mt-3 grid gap-2 sm:grid-cols-2">
              <Toggle
                v-for="item in metaToggles"
                :key="item.key"
                :model-value="(form as any)[item.key]"
                :label="item.label"
                :desc="item.desc"
                @update:model-value="(v: boolean) => ((form as any)[item.key] = v)"
              />
            </div>
          </section>
          <section class="k-card rise p-5">
            <h2 class="text-sm font-semibold">封面分辨率</h2>
            <p class="mt-1 text-xs text-zinc-500">下载与内嵌时使用的专辑封面尺寸</p>
            <div class="mt-3 grid grid-cols-4 gap-2">
              <button
                v-for="size in [500, 800, 1200, 1500]"
                :key="size"
                class="rounded-lg border px-2 py-1.5 text-[11px] transition"
                :class="form.coverSize === size ? 'border-violet-400/40 bg-violet-500/15 text-violet-100' : 'border-white/10 bg-white/[0.03] text-zinc-400'"
                @click="form.coverSize = size"
              >{{ size }}px</button>
            </div>
          </section>
        </template>

        <!-- 过滤 -->
        <template v-else-if="active === 'filter'">
          <section class="k-card rise p-5">
            <h2 class="flex items-center gap-2 text-sm font-semibold"><Ban :size="16" class="text-rose-300" /> 屏蔽关键词</h2>
            <p class="mt-1 text-xs text-zinc-500">命中以下词的歌曲不会被下载，适合过滤伴奏、消音、铃声等版本。每行一个词。</p>
            <textarea
              :value="form.blockWords.join('\n')"
              rows="5"
              class="mt-3 w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 font-mono text-xs text-zinc-200 outline-none transition focus:border-violet-400/40"
              placeholder="伴奏&#10;消音&#10;KTV"
              @input="form.blockWords = ($event.target as HTMLTextAreaElement).value.split('\n').map((s) => s.trim()).filter(Boolean)"
            />
            <Toggle v-model="form.hideBlocked" class="mt-3" label="在搜索结果中隐藏被屏蔽歌曲" desc="关闭时仍显示，但下载按钮不可用" />
          </section>
        </template>
      </div>
    </div>

    <!-- 悬浮保存栏 -->
    <div class="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.07] bg-[#0a0b10]/85 backdrop-blur-xl lg:pl-[76px]">
      <div class="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <p class="hidden items-center gap-2 text-[11px] text-zinc-500 sm:flex">
          <Check v-if="!dirty" :size="13" class="text-emerald-400" />
          <span>{{ dirty ? '有未保存的修改，记得保存' : '所有设置已保存' }}</span>
        </p>
        <button :disabled="saving" class="k-btn k-btn-primary ml-auto px-5 py-2.5" @click="save">
          <Loader2 v-if="saving" :size="14" class="animate-spin" />
          <Save v-else :size="14" />
          保存设置
        </button>
      </div>
    </div>
  </div>
</template>
