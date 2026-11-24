import { defineStore } from 'pinia'

export interface ToastItem {
  id: number
  text: string
  kind: 'success' | 'error' | 'info'
}

let seed = 1

export const useToast = defineStore('toast', {
  state: () => ({ items: [] as ToastItem[] }),
  actions: {
    push(text: string, kind: ToastItem['kind'] = 'info') {
      const id = seed++
      this.items.push({ id, text, kind })
      setTimeout(() => this.remove(id), 3600)
    },
    success(text: string) {
      this.push(text, 'success')
    },
    error(text: string) {
      this.push(text, 'error')
    },
    remove(id: number) {
      this.items = this.items.filter((t) => t.id !== id)
    },
  },
})
