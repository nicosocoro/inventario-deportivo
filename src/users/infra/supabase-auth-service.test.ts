import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js'
import type { SessionUser } from '../domain/ports'
import { NetworkError } from '../../shared/errors'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  rpc: vi.fn(),
  cache: new Map<string, unknown>(),
}))

vi.mock('../../shared/supabase-client', () => ({
  supabase: { auth: { getSession: mocks.getSession, onAuthStateChange: vi.fn() } },
  rpc: mocks.rpc,
  toDomainError: (e: Error) => e,
  usernameToEmail: (u: string) => `${u}@cadb.local`,
}))

vi.mock('../../shared/local-cache', () => ({
  cacheGet: async (k: string) => mocks.cache.get(k),
  cacheSet: async (k: string, v: unknown) => void mocks.cache.set(k, v),
  cacheDel: async (k: string) => void mocks.cache.delete(k),
}))

const { SupabaseAuthService } = await import('./supabase-auth-service')

const user: SessionUser = {
  id: 'u1',
  username: 'vende',
  displayName: 'Juana',
  role: 'venta',
  permissions: ['sales.register'],
  settings: { void_own_window_minutes: 60 },
}

beforeEach(() => {
  mocks.getSession.mockReset()
  mocks.rpc.mockReset()
  mocks.cache.clear()
  mocks.cache.set('session-user', user)
})

describe('SupabaseAuthService.currentUser', () => {
  it('token vencido y refresh fallido por red: usa el usuario guardado', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) })
    const auth = new SupabaseAuthService()
    expect(await auth.currentUser({ refresh: true })).toEqual(user)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('refresh token inválido: no hay sesión', async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: null },
      error: new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found'),
    })
    expect(await new SupabaseAuthService().currentUser({ refresh: true })).toBeNull()
  })

  it('sin sesión y sin error: no hay sesión', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null })
    expect(await new SupabaseAuthService().currentUser({ refresh: true })).toBeNull()
  })

  it('sesión válida pero sin red para session_info: usa el usuario guardado', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    mocks.rpc.mockRejectedValue(new NetworkError())
    expect(await new SupabaseAuthService().currentUser({ refresh: true })).toEqual(user)
  })

  it('cachedUser devuelve lo guardado sin ir a la red', async () => {
    expect(await new SupabaseAuthService().cachedUser()).toEqual(user)
    expect(mocks.getSession).not.toHaveBeenCalled()
  })
})
