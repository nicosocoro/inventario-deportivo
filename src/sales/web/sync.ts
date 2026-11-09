import { reactive } from 'vue'
import type { Services } from '../../shared/container'
import { session } from '../../users/web/session'
import { refreshCatalog } from '../../inventory/web/catalog'
import { toast } from '../../shared/toast'

// Disparadores de sincronización (sin Background Sync: no existe en iOS):
// al abrir, al volver la señal, al volver a primer plano, cada 30 s y con el botón.

export const syncState = reactive({
  pending: 0,
  rejected: 0,
  syncing: false,
  lastSync: null as string | null,
  needsLogin: false,
})

let services: Services | null = null

export async function updateCounts() {
  if (!services) return
  const ops = await services.outbox.all()
  syncState.pending = ops.filter((o) => o.status === 'pending').length
  syncState.rejected = ops.filter((o) => o.status === 'rejected').length
}

export async function syncNow(opts: { manual?: boolean } = {}): Promise<void> {
  if (!services || !session.user) return
  if (!navigator.onLine) {
    if (opts.manual) toast('Sin señal: las ventas quedan guardadas en el teléfono', 'warn')
    return
  }
  syncState.syncing = true
  try {
    const before = syncState.rejected
    const r = await services.outbox.sync(session.user.id)
    syncState.needsLogin = r.stopped === 'session'
    if (r.stopped === null) syncState.lastSync = new Date().toISOString()
    await updateCounts()
    if (r.synced > 0) void refreshCatalog(services)
    if (syncState.rejected > before) toast('Una operación fue rechazada. Mirá "Mis ventas".', 'error', 6000)
    else if (opts.manual && r.stopped === null) toast('Todo sincronizado ✓')
  } catch (e) {
    if (opts.manual) toast((e as Error).message, 'error')
  } finally {
    syncState.syncing = false
  }
}

export function startAutoSync(s: Services): () => void {
  services = s
  void updateCounts()
  const offChange = s.outbox.onChange(() => void updateCounts())
  const onOnline = () => void syncNow()
  const onVisible = () => {
    if (document.visibilityState === 'visible') void syncNow()
  }
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisible)
  const timer = setInterval(() => {
    if (syncState.pending > 0) void syncNow()
  }, 30_000)
  const catalogTimer = setInterval(() => void refreshCatalog(s), 5 * 60_000)
  void syncNow()
  return () => {
    offChange()
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisible)
    clearInterval(timer)
    clearInterval(catalogTimer)
  }
}
