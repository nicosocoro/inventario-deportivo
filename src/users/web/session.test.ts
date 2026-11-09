import { describe, expect, it, vi } from 'vitest'
import type { Services } from '../../shared/container'
import type { SessionUser } from '../domain/ports'
import { initSession, session } from './session'

const user: SessionUser = {
  id: 'u1',
  username: 'vende',
  displayName: null,
  role: 'venta',
  permissions: [],
  settings: { void_own_window_minutes: 60 },
}

describe('initSession', () => {
  it('con usuario guardado monta enseguida aunque Auth no responda', async () => {
    const auth = {
      cachedUser: vi.fn(async () => user),
      currentUser: vi.fn(() => new Promise<SessionUser | null>(() => {})), // nunca resuelve (sin señal)
      onChange: vi.fn(() => () => {}),
    }
    await initSession({ auth } as unknown as Services)
    expect(session.ready).toBe(true)
    expect(session.user).toEqual(user)
    expect(auth.currentUser).toHaveBeenCalled()
  })
})
