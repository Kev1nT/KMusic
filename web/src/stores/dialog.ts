import { defineStore } from 'pinia'

type DialogMode = 'confirm' | 'prompt' | 'alert'

interface DialogOptions {
  title?: string
  message: string
  value?: string
  placeholder?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

interface DialogState extends DialogOptions {
  open: boolean
  mode: DialogMode
  resolve: ((value: any) => void) | null
}

export const useDialogStore = defineStore('dialog', {
  state: (): DialogState => ({
    open: false,
    mode: 'alert',
    title: '',
    message: '',
    value: '',
    placeholder: '',
    confirmText: '确定',
    cancelText: '取消',
    danger: false,
    resolve: null,
  }),
  actions: {
    show(mode: DialogMode, options: DialogOptions): Promise<any> {
      if (this.resolve) this.close(false)
      return new Promise((resolve) => {
        this.mode = mode
        this.title = options.title || (mode === 'confirm' ? '请确认' : mode === 'prompt' ? '请输入' : '提示')
        this.message = options.message
        this.value = options.value || ''
        this.placeholder = options.placeholder || ''
        this.confirmText = options.confirmText || '确定'
        this.cancelText = options.cancelText || '取消'
        this.danger = options.danger === true
        this.resolve = resolve
        this.open = true
      })
    },
    confirm(options: DialogOptions) {
      return this.show('confirm', options) as Promise<boolean>
    },
    prompt(options: DialogOptions) {
      return this.show('prompt', options) as Promise<string | null>
    },
    alert(options: DialogOptions) {
      return this.show('alert', options) as Promise<void>
    },
    close(value: any) {
      if (this.resolve) this.resolve(value)
      this.resolve = null
      this.open = false
    },
  },
})
