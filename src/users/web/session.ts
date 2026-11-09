import { reactive } from 'vue'
import type { Services } from '../../shared/container'
import type { SessionUser } from '../domain/ports'
import { can as canDo, type Permission } from '../domain/permissions'

export const session = reactive({
  user: null as SessionUser | null,
  ready: false,
})

export function can(p: Permission): boolean {
  return canDo(session.user, p)
}

export async function initSession(services: Services): Promise<void> {
  const cached = await services.auth.cachedUser().catch(() => null)
  if (cached) {
    // Montamos enseguida con lo guardado en el teléfono. La verificación con Auth puede tardar
    // (refresh con reintentos sin señal), así que corre en segundo plano.
    session.user = cached
    session.ready = true
    void services.auth
      .currentUser({ refresh: navigator.onLine })
      .then((u) => {
        // Si mientras tanto hubo un signIn/signOut, no pisamos ese resultado.
        if (session.user?.id === cached.id) session.user = u
      })
      .catch(() => {})
  } else {
    try {
      session.user = await services.auth.currentUser({ refresh: navigator.onLine })
    } catch {
      session.user = null
    }
    session.ready = true
  }
  services.auth.onChange((u) => {
    session.user = u
  })
}

export async function refreshSession(services: Services): Promise<void> {
  try {
    const u = await services.auth.currentUser({ refresh: true })
    session.user = u
  } catch {
    /* sin cambios */
  }
}
