import type { AuditEntry, HistoryService, RoleMatrix, UserAdminService, UserProfile } from '../domain/ports'
import { DEFAULT_SETTINGS, type Role, type Settings } from '../domain/permissions'
import { rpc, select, supabase, toDomainError } from '../../shared/supabase-client'
import { addDays, dayStartIso } from '../../shared/dates'
import { BusinessError, businessErrorFromMessage } from '../../shared/errors'

async function invokeAdminUsers(body: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.functions.invoke('admin-users', { body })
  if (!error) return
  // FunctionsHttpError: el cuerpo trae { error: 'codigo: mensaje' }
  const ctx = (error as { context?: Response }).context
  if (ctx && typeof ctx.json === 'function') {
    const payload = await ctx.json().catch(() => null)
    if (payload?.error) throw businessErrorFromMessage(String(payload.error))
  }
  throw toDomainError(error)
}

export class SupabaseUserAdminService implements UserAdminService {
  async list(): Promise<UserProfile[]> {
    const rows = await select<{ id: string; username: string; display_name: string | null; role: Role; active: boolean; created_at: string }[]>(
      supabase.from('profiles').select('id,username,display_name,role,active,created_at').order('username'),
    )
    return rows.map((r) => ({ id: r.id, username: r.username, displayName: r.display_name, role: r.role, active: r.active, createdAt: r.created_at }))
  }

  async create(input: { username: string; displayName: string | null; password: string; role: Role }) {
    await invokeAdminUsers({ action: 'create', username: input.username, display_name: input.displayName, password: input.password, role: input.role })
  }

  async setRole(userId: string, role: Role) {
    await rpc('set_user_role', { p_user_id: userId, p_role: role })
  }

  async setActive(userId: string, active: boolean) {
    await invokeAdminUsers({ action: 'set-active', user_id: userId, active })
  }

  async resetPassword(userId: string, password: string) {
    if (password.length < 8) throw new BusinessError('invalid', 'La contraseña tiene que tener al menos 8 caracteres')
    await invokeAdminUsers({ action: 'reset-password', user_id: userId, password })
  }

  async rename(userId: string, displayName: string | null) {
    await rpc('rename_user', { p_user_id: userId, p_display_name: displayName })
  }

  async roleMatrix(): Promise<RoleMatrix> {
    const [permissions, granted] = await Promise.all([
      select<{ key: string; description: string }[]>(supabase.from('permissions').select('key,description').order('key')),
      select<{ role: 'venta' | 'admin'; permission: string }[]>(supabase.from('role_permissions').select('role,permission')),
    ])
    return { permissions, granted }
  }

  async setRolePermission(role: 'venta' | 'admin', key: string, enabled: boolean) {
    await rpc('set_role_permission', { p_role: role, p_key: key, p_enabled: enabled })
  }

  async getSettings(): Promise<Settings> {
    const rows = await select<{ key: string; value: unknown }[]>(supabase.from('settings').select('key,value'))
    const s: Record<string, unknown> = { ...DEFAULT_SETTINGS }
    for (const r of rows) s[r.key] = r.value
    return s as unknown as Settings
  }

  async setSetting(key: keyof Settings, value: number) {
    await rpc('set_setting', { p_key: key, p_value: value })
  }
}

export class SupabaseHistoryService implements HistoryService {
  async list(filter: { from?: string; to?: string; actorId?: string; action?: string; onlyFlagged?: boolean; before?: number; limit?: number }): Promise<AuditEntry[]> {
    let q = supabase
      .from('audit_log')
      .select('id,at,actor,action,entity_id,reason,flags,detail,profiles(username,display_name)')
      .order('id', { ascending: false })
      .limit(filter.limit ?? 50)
    if (filter.from) q = q.gte('at', dayStartIso(filter.from))
    if (filter.to) q = q.lt('at', dayStartIso(addDays(filter.to, 1)))
    if (filter.actorId) q = q.eq('actor', filter.actorId)
    if (filter.action) q = q.like('action', `${filter.action}%`)
    if (filter.onlyFlagged) q = q.neq('flags', '{}')
    if (filter.before) q = q.lt('id', filter.before)
    type Row = {
      id: number
      at: string
      actor: string
      action: string
      entity_id: string | null
      reason: string | null
      flags: string[]
      detail: Record<string, unknown>
      profiles: { username: string; display_name: string | null } | null
    }
    const rows = await select<Row[]>(q)
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      actor: r.actor,
      actorName: r.profiles?.display_name ?? r.profiles?.username ?? '?',
      action: r.action,
      entityId: r.entity_id,
      reason: r.reason,
      flags: r.flags ?? [],
      detail: r.detail ?? {},
    }))
  }
}
