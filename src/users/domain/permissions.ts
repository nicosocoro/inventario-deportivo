// Feature flags por rol. La lista es fija y debe coincidir con la semilla SQL
// (src/server/supabase/migrations/*_seed.sql); lo verifica permissions.test.ts.

export const PERMISSIONS = [
  'sales.register',
  'sales.void_own_same_day',
  'sales.void_any',
  'sales.backdate',
  'stock.add',
  'stock.consume',
  'stock.adjust',
  'products.manage',
  'prices.manage',
  'balance.view',
  'history.view',
  'settings.manage',
  'admin.access',
  'users.manage',
] as const

export type Permission = (typeof PERMISSIONS)[number]

export const ROLES = ['venta', 'admin', 'owner'] as const
export type Role = (typeof ROLES)[number]
/** Roles cuyos permisos se editan (el owner tiene todo implícito). */
export const EDITABLE_ROLES = ['venta', 'admin'] as const

export const ROLE_LABELS: Record<Role, string> = { venta: 'Venta', admin: 'Admin', owner: 'Owner' }

export const SETTINGS_KEYS = ['void_own_window_minutes'] as const
export type SettingKey = (typeof SETTINGS_KEYS)[number]
export interface Settings {
  void_own_window_minutes: number
}
export const DEFAULT_SETTINGS: Settings = { void_own_window_minutes: 60 }

export function rank(role: Role | null | undefined): number {
  return role === 'owner' ? 3 : role === 'admin' ? 2 : role === 'venta' ? 1 : 0
}

export interface Actor {
  id: string
  role: Role
  permissions: readonly string[]
}

export function can(actor: Actor | null | undefined, permission: Permission): boolean {
  if (!actor) return false
  return actor.role === 'owner' || actor.permissions.includes(permission)
}

/** Espejo de public.can_manage_user (solo para mostrar u ocultar botones). */
export function canManageUser(actor: Actor, target: { id: string; role: Role }): boolean {
  return can(actor, 'users.manage') && actor.id !== target.id && rank(target.role) < rank(actor.role)
}

/** Espejo de public.can_assign_role. */
export function canAssignRole(actor: Actor, role: Role): boolean {
  return can(actor, 'users.manage') && rank(role) <= rank(actor.role)
}

export function assignableRoles(actor: Actor): Role[] {
  return ROLES.filter((r) => canAssignRole(actor, r))
}

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase()
}
