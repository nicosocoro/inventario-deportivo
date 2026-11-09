import type { Actor, Role, Settings } from './permissions'

export interface SessionUser extends Actor {
  username: string
  displayName: string | null
  settings: Settings
}

export interface AuthService {
  /** Inicia sesión con usuario y contraseña (requiere señal). */
  signIn(username: string, password: string): Promise<SessionUser>
  signOut(): Promise<void>
  /**
   * Usuario actual. Con señal se refresca desde el servidor; sin señal usa lo cacheado en el
   * teléfono. null = no hay sesión (o el usuario fue desactivado).
   */
  currentUser(opts?: { refresh?: boolean }): Promise<SessionUser | null>
  /** Último usuario guardado en el teléfono, sin red (null si no hay). */
  cachedUser(): Promise<SessionUser | null>
  /** Avisa cuando la sesión se cierra o cambia. */
  onChange(fn: (user: SessionUser | null) => void): () => void
  changeOwnPassword(newPassword: string): Promise<void>
}

export interface UserProfile {
  id: string
  username: string
  displayName: string | null
  role: Role
  active: boolean
  createdAt: string
}

export interface RoleMatrix {
  permissions: { key: string; description: string }[]
  granted: { role: 'venta' | 'admin'; permission: string }[]
}

export interface UserAdminService {
  list(): Promise<UserProfile[]>
  create(input: { username: string; displayName: string | null; password: string; role: Role }): Promise<void>
  setRole(userId: string, role: Role): Promise<void>
  setActive(userId: string, active: boolean): Promise<void>
  resetPassword(userId: string, password: string): Promise<void>
  rename(userId: string, displayName: string | null): Promise<void>
  roleMatrix(): Promise<RoleMatrix>
  setRolePermission(role: 'venta' | 'admin', key: string, enabled: boolean): Promise<void>
  getSettings(): Promise<Settings>
  setSetting(key: keyof Settings, value: number): Promise<void>
}

export interface AuditEntry {
  id: number
  at: string
  actor: string
  actorName: string
  action: string
  entityId: string | null
  reason: string | null
  flags: string[]
  detail: Record<string, unknown>
}

export interface HistoryService {
  list(filter: { from?: string; to?: string; actorId?: string; action?: string; onlyFlagged?: boolean; before?: number; limit?: number }): Promise<AuditEntry[]>
}
