import { defineStore } from 'pinia'
import { api, type Account, type Settings } from '@/lib/api'

export interface Stats {
  accounts: number
  libraryCount: number
  libraryBytes: number
  active: number
  failed: number
  recent: any[]
}

export const useAppStore = defineStore('app', {
  state: () => ({
    accounts: [] as Account[],
    settings: null as Settings | null,
    stats: null as Stats | null,
    loadingAccounts: false,
    loadingSettings: false,
  }),
  getters: {
    defaultAccount(state): Account | undefined {
      return state.accounts.find((a) => a.isDefault) || state.accounts[0]
    },
  },
  actions: {
    async loadAccounts() {
      this.loadingAccounts = true
      try {
        this.accounts = await api<Account[]>('/accounts')
      } finally {
        this.loadingAccounts = false
      }
    },
    async addAccount(cookie: string, provider = 'qq', isDefault = false) {
      const account = await api<Account>(`/accounts/${provider}`, {
        method: 'POST',
        body: JSON.stringify({ cookie, isDefault }),
      })
      await this.loadAccounts()
      return account
    },
    async renameAccount(id: number, alias: string) {
      const account = await api<Account>(`/accounts/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ alias }),
      })
      await this.loadAccounts()
      return account
    },
    async setDefault(id: number) {
      await api(`/accounts/${id}/default`, { method: 'POST' })
      await this.loadAccounts()
    },
    async checkAccount(id: number) {
      try {
        await api(`/accounts/${id}/check`, { method: 'POST' })
        await this.loadAccounts()
      } finally {
        await this.loadSettings()
      }
    },
    async removeAccount(id: number) {
      await api(`/accounts/${id}`, { method: 'DELETE' })
      await this.loadAccounts()
    },
    async loadSettings() {
      this.loadingSettings = true
      try {
        const data = await api<{ settings: Settings }>('/settings')
        this.settings = data.settings
      } finally {
        this.loadingSettings = false
      }
    },
    async saveSettings(patch: Partial<Settings>) {
      const data = await api<{ settings: Settings }>('/settings', {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
      this.settings = data.settings
      return data.settings
    },
    async loadStats() {
      this.stats = await api<Stats>('/stats')
    },
  },
})
