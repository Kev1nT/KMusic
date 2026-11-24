<script setup lang="ts">
import { computed } from 'vue'
import { apiPending } from '@/lib/api'

const active = computed(() => apiPending.value > 0)
</script>

<template>
  <div v-if="active" class="pointer-events-none fixed inset-x-0 top-0 z-[90] h-0.5 overflow-hidden bg-white/5">
    <div class="loading-bar-inner h-full w-1/3 bg-gradient-to-r from-violet-500 via-cyan-400 to-violet-500" />
  </div>
</template>

<style scoped>
.loading-bar-inner { animation: loadingbar 1.1s ease-in-out infinite; }
@keyframes loadingbar {
  0% { transform: translateX(-110%); }
  100% { transform: translateX(330%); }
}
</style>
