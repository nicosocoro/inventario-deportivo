import type { AuthService, SessionUser } from '../domain/ports'
import { DEFAULT_SETTINGS, type Role, type Settings } from '../domain/permissions'
import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { rpc, supabase, toDomainError, usernameToEmail } from '../../shared/supabase-client'
import { cacheDel, cacheGet, cacheSet } from '../../shared/local-cache'
import { BusinessError, NetworkError } from '../../shared/errors'

interface SessionInfo {
  id: string
  username: string
  display_name: string | null
  role: Role
  permissions: string[]
  settings: Partial<Settings>
}

const KEY = 'session-user'

function toUser(i: SessionInfo): SessionUser {
  return {
    id: i.id,
    username: i.username,
    displayName: i.display_name,
    role: i.role,
    permissions: i.permissions ?? [],
    settings: { ...DEFAULT_SETTINGS, ...(i.settings ?? {}) },
  }
}

/**
 * Sesión con Supabase Auth (usuario + contraseña; el email es sintético).
 * Los permisos y ajustes se cachean en el teléfono para que la caja ande sin señal.
 */
export class SupabaseAuthService implements AuthService {
  private listeners = new Set<(u: SessionUser | null) => void>()

  constructor() {
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        void cacheDel(KEY)
        for (const fn of this.listeners) fn(null)
      }
    })
  }

  onChange(fn: (u: SessionUser | null) => void) {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  async signIn(username: string, password: string): Promise<SessionUser> {
    if (!navigator.onLine) throw new NetworkError('Para iniciar sesión necesitás señal')
    const { error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password })
    if (error) {
      if (/invalid login credentials/i.test(error.message)) throw new BusinessError('invalid', 'Usuario o contraseña incorrectos')
      if (/banned/i.test(error.message)) throw new BusinessError('forbidden', 'Usuario desactivado')
      throw toDomainError(error)
    }
    const info = await rpc<SessionInfo | null>('session_info')
    if (!info) {
      await supabase.auth.signOut()
      throw new BusinessError('forbidden', 'Tu usuario no tiene acceso. Hablá con un admin.')
    }
    const user = toUser(info)
    await cacheSet(KEY, user)
    for (const fn of this.listeners) fn(user)
    return user
  }

  async signOut(): Promise<void> {
    await cacheDel(KEY)
    // scope local: cierra solo en este teléfono (y funciona sin señal).
    await supabase.auth.signOut({ scope: 'local' })
  }

  async cachedUser(): Promise<SessionUser | null> {
    // La caché se borra en signOut y en SIGNED_OUT, así que sirve como prueba de sesión sin red.
    return (await cacheGet<SessionUser>(KEY)) ?? null
  }

  async currentUser(opts: { refresh?: boolean } = {}): Promise<SessionUser | null> {
    const { data, error } = await supabase.auth.getSession()
    if (!data.session) {
      // Token vencido y refresh fallido por red: supabase-js conserva la sesión; seguimos con la caché.
      if (error && isAuthRetryableFetchError(error)) return this.cachedUser()
      return null
    }
    const cached = (await cacheGet<SessionUser>(KEY)) ?? null
    if (cached && cached.id !== data.session.user.id) await cacheDel(KEY)
    const sameUserCache = cached && cached.id === data.session.user.id ? cached : null
    if (!opts.refresh && sameUserCache) return sameUserCache
    try {
      const info = await rpc<SessionInfo | null>('session_info')
      if (!info) {
        // Desactivado o sin perfil.
        await cacheDel(KEY)
        return null
      }
      const user = toUser(info)
      await cacheSet(KEY, user)
      return user
    } catch (e) {
      if (e instanceof NetworkError) return sameUserCache
      throw e
    }
  }

  async changeOwnPassword(newPassword: string): Promise<void> {
    if (newPassword.length < 8) throw new BusinessError('invalid', 'La contraseña tiene que tener al menos 8 caracteres')
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) throw toDomainError(error)
  }
}
