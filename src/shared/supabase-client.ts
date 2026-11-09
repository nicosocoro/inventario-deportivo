import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js'
import { BusinessError, NetworkError, SessionError, businessErrorFromMessage } from './errors'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const isConfigured = Boolean(url && key)

/** Tope por request: con señal mala (lie-fi) un fetch puede colgarse sin fallar nunca. */
const REQUEST_TIMEOUT_MS = 15_000

/**
 * fetch con timeout para todo el cliente (PostgREST, refresh de Auth, Edge Functions).
 * Usa AbortController y no AbortSignal.any (recién en Safari 17.4).
 */
const fetchWithTimeout: typeof fetch = (input, init = {}) => {
  const ctrl = new AbortController()
  const outer = init.signal
  if (outer?.aborted) ctrl.abort()
  else outer?.addEventListener('abort', () => ctrl.abort(), { once: true })
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(t))
}

/** Un solo cliente por sitio. La sesión queda guardada en el teléfono y se renueva sola. */
export const supabase: SupabaseClient = createClient(url ?? 'http://localhost:54321', key ?? 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  global: { fetch: fetchWithTimeout },
  db: { timeout: REQUEST_TIMEOUT_MS },
})

export const EMAIL_DOMAIN = 'cadb.local'
export const usernameToEmail = (u: string) => `${u.trim().toLowerCase()}@${EMAIL_DOMAIN}`

/** Traduce errores de supabase-js a los errores del dominio. */
export function toDomainError(error: PostgrestError | { message: string; code?: string; status?: number } | Error): Error {
  const message = error.message ?? String(error)
  const code = 'code' in error ? (error.code ?? '') : ''
  const status = 'status' in error ? (error as { status?: number }).status : undefined
  const name = 'name' in error ? String(error.name ?? '') : ''
  // Un timeout o abort (fetchWithTimeout / db.timeout) cuenta como falta de señal: se reintenta.
  if (
    /Failed to fetch|NetworkError|Load failed|fetch failed|network|AbortError|TimeoutError|aborted/i.test(message) ||
    /^(AbortError|TimeoutError)$/.test(name) ||
    status === 0
  )
    return new NetworkError()
  if (status !== undefined && status >= 500) return new NetworkError(`Servidor no disponible (${status})`)
  if (code === 'PGRST301' || code === 'PGRST303' || /JWT|refresh token/i.test(message) || status === 401) return new SessionError()
  if (code === '42501') return new BusinessError('forbidden', 'No tenés permiso para esta acción')
  if (code === 'P0001' || /^[a-z_]+: /.test(message)) return businessErrorFromMessage(message)
  return new BusinessError('unknown', message)
}

/** Llama una RPC y devuelve los datos o lanza un error del dominio. */
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new NetworkError()
  let res
  try {
    res = await supabase.rpc(fn, args)
  } catch (e) {
    throw toDomainError(e as Error)
  }
  if (res.error) throw toDomainError({ ...res.error, status: res.status })
  return res.data as T
}

export async function select<T>(query: PromiseLike<{ data: unknown; error: PostgrestError | null; status: number }>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new NetworkError()
  let res
  try {
    res = await query
  } catch (e) {
    throw toDomainError(e as Error)
  }
  if (res.error) throw toDomainError({ ...res.error, status: res.status })
  return res.data as T
}
