import { defineStore } from 'pinia'
import { api, getToken, setToken } from '@/lib/api'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: getToken(),
    loading: false,
  }),
  actions: {
    async login(password: string) {
      this.loading = true
      try {
        const data = await api<{ token: string }>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ password }),
        })
        setToken(data.token)
        this.token = data.token
      } finally {
        this.loading = false
      }
    },
    logout() {
      setToken('')
      this.token = ''
      location.href = '/login'
    },
  },
})
