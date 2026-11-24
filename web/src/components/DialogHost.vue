<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { AlertTriangle, HelpCircle, X } from 'lucide-vue-next'
import { useDialogStore } from '@/stores/dialog'

const dialog = useDialogStore()
const inputRef = ref<HTMLInputElement | null>(null)

watch(
  () => dialog.open,
  async (open) => {
    if (open && dialog.mode === 'prompt') {
      await nextTick()
      inputRef.value?.focus()
      inputRef.value?.select()
    }
  },
)

function onKeydown(event: KeyboardEvent) {
  if (!dialog.open) return
  if (event.key === 'Escape') dialog.close(dialog.mode === 'prompt' ? null : false)
  if (event.key === 'Enter') confirm()
}

function confirm() {
  dialog.close(dialog.mode === 'prompt' ? dialog.value : true)
}

window.addEventListener('keydown', onKeydown)
</script>

<template>
  <div v-if="dialog.open" class="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" @click.self="dialog.close(dialog.mode === 'prompt' ? null : false)">
    <div class="w-full max-w-md rounded-3xl border border-white/10 bg-[#11141b] p-5 shadow-2xl shadow-black/50">
      <div class="flex items-start gap-3">
        <div class="grid h-9 w-9 shrink-0 place-items-center rounded-xl" :class="dialog.danger ? 'bg-rose-500/15 text-rose-300' : 'bg-violet-500/15 text-violet-300'">
          <AlertTriangle v-if="dialog.danger" :size="18" />
          <HelpCircle v-else :size="18" />
        </div>
        <div class="min-w-0 flex-1">
          <h2 class="text-sm font-semibold text-zinc-100">{{ dialog.title }}</h2>
          <p class="mt-1 whitespace-pre-line text-xs leading-relaxed text-zinc-400">{{ dialog.message }}</p>
        </div>
        <button class="grid h-7 w-7 place-items-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-zinc-300" @click="dialog.close(dialog.mode === 'prompt' ? null : false)">
          <X :size="14" />
        </button>
      </div>

      <input
        v-if="dialog.mode === 'prompt'"
        ref="inputRef"
        v-model="dialog.value"
        :placeholder="dialog.placeholder"
        class="mt-4 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-violet-400/50"
        @keydown.enter.prevent="confirm"
      />

      <div class="mt-5 flex justify-end gap-2">
        <button v-if="dialog.mode !== 'alert'" class="rounded-xl px-3.5 py-2 text-xs text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200" @click="dialog.close(dialog.mode === 'prompt' ? null : false)">
          {{ dialog.cancelText }}
        </button>
        <button
          class="rounded-xl px-4 py-2 text-xs font-semibold text-white transition"
          :class="dialog.danger ? 'bg-rose-600 hover:bg-rose-500' : 'bg-gradient-to-r from-violet-600 to-cyan-500 hover:brightness-110'"
          @click="confirm"
        >
          {{ dialog.confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>
