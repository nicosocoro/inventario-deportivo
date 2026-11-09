import { beforeAll, describe, expect, it } from 'vitest'
import { TestDb } from './db'

// Grants, RLS, feature flags, jerarquía de roles y ajustes.

let db: TestDb
let owner: string, admin: string, admin2: string, venta: string, venta2: string

beforeAll(async () => {
  db = await TestDb.create()
  owner = await db.createUser('dueno', 'owner')
  admin = await db.createUser('admin1', 'admin')
  admin2 = await db.createUser('admin2', 'admin')
  venta = await db.createUser('vende1', 'venta')
  venta2 = await db.createUser('vende2', 'venta')
})

describe('grants', () => {
  it('anon solo puede ejecutar ping', async () => {
    await db.asAnon()
    expect(await db.call('ping')).toBeTruthy()
    expect(await db.error('select * from public.products')).toMatch(/permission denied/)
    expect(await db.callError('session_info')).toMatch(/permission denied/)
    expect(await db.callError('register_sale', [crypto.randomUUID(), '[]', 'efectivo'], ['uuid', 'jsonb', 'text'])).toMatch(
      /permission denied/,
    )
  })

  it('ningún rol escribe tablas directamente', async () => {
    for (const u of [venta, admin, owner]) {
      await db.as(u)
      expect(await db.error(`update public.products set stock = 999`)).toMatch(/permission denied/)
      expect(await db.error(`insert into public.products (name, price) values ('x', 1)`)).toMatch(/permission denied/)
      expect(await db.error(`delete from public.audit_log`)).toMatch(/permission denied/)
      expect(await db.error(`update public.profiles set role = 'owner'`)).toMatch(/permission denied/)
      expect(await db.error(`insert into public.role_permissions values ('venta', 'balance.view')`)).toMatch(/permission denied/)
    }
  })

  it('las funciones internas no se pueden llamar', async () => {
    await db.as(owner)
    expect(await db.callError('audit', ['x', null, null, '{}', '{}'], ['text', 'text', 'text', 'text[]', 'jsonb'])).toMatch(
      /permission denied/,
    )
  })

  it('un usuario inactivo no tiene acceso', async () => {
    const u = await db.createUser('inactivo', 'admin')
    await db.asSuper()
    await db.rows(`update public.profiles set active = false where id = $1`, [u])
    await db.as(u)
    expect(await db.call('session_info')).toBeNull()
    expect(await db.call('my_permissions')).toEqual([])
    expect(await db.rows('select * from public.products')).toHaveLength(0)
    expect(await db.callError('balance_report', ['2026-01-01', '2026-01-31'], ['date', 'date'])).toMatch(/forbidden/)
  })
})

describe('feature flags', () => {
  it('venta no puede crear productos, cambiar precios ni ver balance o historial', async () => {
    await db.as(venta)
    expect(await db.callError('create_product', ['Coca', 100], ['text', 'integer'])).toMatch(/forbidden/)
    expect(await db.callError('balance_report', ['2026-01-01', '2026-01-31'], ['date', 'date'])).toMatch(/forbidden/)
    expect(await db.rows('select * from public.audit_log')).toHaveLength(0)
    expect(await db.callError('set_setting', ['void_own_window_minutes', '10'], ['text', 'jsonb'])).toMatch(/forbidden/)
  })

  it('el owner siempre tiene todos los permisos', async () => {
    await db.as(owner)
    const perms = await db.call<string[]>('my_permissions')
    expect(perms).toContain('users.manage')
    expect(perms).toHaveLength(14)
  })

  it('solo el owner edita la matriz', async () => {
    await db.as(admin)
    expect(await db.callError('set_role_permission', ['venta', 'balance.view', true], ['text', 'text', 'boolean'])).toMatch(
      /forbidden/,
    )
    await db.as(owner)
    expect(await db.callError('set_role_permission', ['owner', 'balance.view', false], ['text', 'text', 'boolean'])).toMatch(
      /invalid/,
    )
  })

  it('dar balance.view a venta habilita el balance; quitar stock.consume lo bloquea', async () => {
    await db.as(owner)
    await db.call('set_role_permission', ['venta', 'balance.view', true], ['text', 'text', 'boolean'])
    await db.call('set_role_permission', ['venta', 'stock.consume', false], ['text', 'text', 'boolean'])
    const pid = await db.call<string>('create_product', ['Hielo test', 0, false], ['text', 'integer', 'boolean'])

    await db.as(venta)
    const report = await db.call<Record<string, unknown>>('balance_report', ['2026-01-01', '2026-01-31'], ['date', 'date'])
    expect(report).toHaveProperty('income')
    expect(await db.callError('consume_stock', [null, pid, 1], ['uuid', 'uuid', 'integer'])).toMatch(/forbidden.*stock.consume/)

    await db.as(owner)
    await db.call('set_role_permission', ['venta', 'balance.view', false], ['text', 'text', 'boolean'])
    await db.call('set_role_permission', ['venta', 'stock.consume', true], ['text', 'text', 'boolean'])
    await db.as(venta)
    expect(await db.callError('balance_report', ['2026-01-01', '2026-01-31'], ['date', 'date'])).toMatch(/forbidden/)
    expect(await db.call('consume_stock', [null, pid, 1], ['uuid', 'uuid', 'integer'])).toBeTruthy()

    await db.as(owner)
    const log = await db.rows<{ action: string }>(`select action from public.audit_log where action = 'role_permission.set'`)
    expect(log.length).toBe(4)
  })
})

describe('jerarquía de roles', () => {
  const setRole = (id: string, role: string) => db.call('set_user_role', [id, role], ['uuid', 'text'])
  const setRoleErr = (id: string, role: string) => db.callError('set_user_role', [id, role], ['uuid', 'text'])

  it('admin puede crear venta o admin, pero no owner', async () => {
    await db.as(admin)
    expect(await db.call('can_assign_role', ['venta'], ['text'])).toBe(true)
    expect(await db.call('can_assign_role', ['admin'], ['text'])).toBe(true)
    expect(await db.call('can_assign_role', ['owner'], ['text'])).toBe(false)
    const id = await db.createAuthOnly('nuevo1')
    await db.as(admin)
    await db.call('create_profile', [id, 'Nuevo1', 'Nuevo', 'venta'], ['uuid', 'text', 'text', 'text'])
    const id2 = await db.createAuthOnly('nuevo2')
    await db.as(admin)
    expect(await db.callError('create_profile', [id2, 'nuevo2', null, 'owner'], ['uuid', 'text', 'text', 'text'])).toMatch(
      /forbidden/,
    )
    await db.as(owner)
    const created = await db.one<{ username: string }>(`select username from public.profiles where id = $1`, [id])
    expect(created.username).toBe('nuevo1')
  })

  it('venta no gestiona usuarios', async () => {
    await db.as(venta)
    expect(await setRoleErr(venta2, 'admin')).toMatch(/forbidden/)
  })

  it('admin sube venta a admin, pero no baja a otro admin', async () => {
    const u = await db.createUser('subible', 'venta')
    await db.as(admin)
    await setRole(u, 'admin')
    expect(await setRoleErr(u, 'venta')).toMatch(/forbidden/)
    expect(await setRoleErr(admin2, 'venta')).toMatch(/forbidden/)
    expect(await db.callError('set_user_active', [admin2, false], ['uuid', 'boolean'])).toMatch(/forbidden/)
    expect(await db.callError('log_password_reset', [admin2], ['uuid'])).toMatch(/forbidden/)
  })

  it('owner baja admins y nombra owners, pero nadie gestiona a un owner', async () => {
    const u = await db.createUser('bajable', 'admin')
    await db.as(owner)
    await setRole(u, 'venta')
    await setRole(u, 'owner')
    expect(await setRoleErr(u, 'admin')).toMatch(/forbidden/)
    expect(await db.callError('set_user_active', [u, false], ['uuid', 'boolean'])).toMatch(/forbidden/)
    await db.as(u)
    expect(await setRoleErr(owner, 'admin')).toMatch(/forbidden/)
  })

  it('nadie cambia su propio rol ni se desactiva', async () => {
    await db.as(admin)
    expect(await setRoleErr(admin, 'owner')).toMatch(/forbidden/)
    expect(await db.callError('set_user_active', [admin, false], ['uuid', 'boolean'])).toMatch(/forbidden/)
    await db.as(owner)
    expect(await setRoleErr(owner, 'venta')).toMatch(/forbidden/)
  })

  it('admin desactiva a un venta y queda auditado', async () => {
    const u = await db.createUser('desactivable', 'venta')
    await db.as(admin)
    await db.call('set_user_active', [u, false], ['uuid', 'boolean'])
    await db.call('rename_user', [u, 'Juan'], ['uuid', 'text'])
    await db.as(owner)
    const log = await db.rows(`select action from public.audit_log where entity_id = $1 order by id`, [u])
    expect(log.map((r) => r.action)).toEqual(['user.active', 'user.rename'])
  })
})

describe('ajustes', () => {
  it('admin cambia el límite de anulación con validación', async () => {
    await db.as(admin)
    expect(await db.callError('set_setting', ['void_own_window_minutes', '-1'], ['text', 'jsonb'])).toMatch(/invalid/)
    expect(await db.callError('set_setting', ['void_own_window_minutes', '"10"'], ['text', 'jsonb'])).toMatch(/invalid/)
    expect(await db.callError('set_setting', ['void_own_window_minutes', '1.5'], ['text', 'jsonb'])).toMatch(/invalid/)
    expect(await db.callError('set_setting', ['otra', '1'], ['text', 'jsonb'])).toMatch(/invalid/)
    await db.call('set_setting', ['void_own_window_minutes', '45'], ['text', 'jsonb'])
    const info = await db.call<{ settings: { void_own_window_minutes: number } }>('session_info')
    expect(info.settings.void_own_window_minutes).toBe(45)
    await db.call('set_setting', ['void_own_window_minutes', '60'], ['text', 'jsonb'])
  })
})
