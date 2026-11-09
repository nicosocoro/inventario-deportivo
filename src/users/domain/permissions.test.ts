import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PERMISSIONS, SETTINGS_KEYS, assignableRoles, canAssignRole, canManageUser, type Actor } from './permissions'

const MIGRATIONS = join(import.meta.dirname, '..', '..', 'server', 'supabase', 'migrations')
const seed = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('_seed.sql'))
  .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
  .join('\n')

describe('permisos', () => {
  it('las claves de TS coinciden con la semilla SQL', () => {
    const block = seed.slice(seed.indexOf('insert into public.permissions'), seed.indexOf('insert into public.role_permissions'))
    const sqlKeys = [...block.matchAll(/\('([a-z_.]+)',/g)].map((m) => m[1])
    expect(sqlKeys.sort()).toEqual([...PERMISSIONS].sort())
    for (const key of SETTINGS_KEYS) expect(seed).toContain(`'${key}'`)
  })

  const owner: Actor = { id: 'o', role: 'owner', permissions: [] }
  const admin: Actor = { id: 'a', role: 'admin', permissions: ['users.manage'] }
  const venta: Actor = { id: 'v', role: 'venta', permissions: [] }

  it('jerarquía (espejo de la regla SQL)', () => {
    expect(canManageUser(admin, { id: 'v', role: 'venta' })).toBe(true)
    expect(canManageUser(admin, { id: 'a2', role: 'admin' })).toBe(false)
    expect(canManageUser(owner, { id: 'a2', role: 'admin' })).toBe(true)
    expect(canManageUser(owner, { id: 'o2', role: 'owner' })).toBe(false)
    expect(canManageUser(owner, { id: 'o', role: 'venta' })).toBe(false) // a sí mismo
    expect(canManageUser(venta, { id: 'v2', role: 'venta' })).toBe(false)
    expect(canAssignRole(admin, 'admin')).toBe(true)
    expect(canAssignRole(admin, 'owner')).toBe(false)
    expect(assignableRoles(owner)).toEqual(['venta', 'admin', 'owner'])
    expect(assignableRoles({ ...admin, permissions: [] })).toEqual([])
  })
})
