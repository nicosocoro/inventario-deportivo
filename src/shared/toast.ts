import { ref } from 'vue'

export interface Toast {
  id: number
  text: string
  tone: 'ok' | 'warn' | 'error' | 'info'
}

export const toasts = ref<Toast[]>([])
let next = 1

export function toast(text: string, tone: Toast['tone'] = 'ok', ms = 3500) {
  const id = next++
  toasts.value = [...toasts.value, { id, text, tone }]
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }, ms)
}
