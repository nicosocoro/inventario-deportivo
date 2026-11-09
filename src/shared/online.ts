import { ref } from 'vue'

/** Estado de conexión del navegador (reactivo). */
export const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => (online.value = true))
  window.addEventListener('offline', () => (online.value = false))
}
