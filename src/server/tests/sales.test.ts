import { beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { TestDb } from './db'

// Ventas, pagos, anulaciones, stock y balance.

let db: TestDb
let admin: string, venta: string, venta2: string
let coca: string, chori: string, hielo: string, varios: string

interface SaleResult {
  id: string
  total: number
  cash_amount: number
  transfer_amount: number
  transfer_last4: string | null
  flags: string[]
  status: string
  created_at: string
  voided_at: string | null
}

const SALE_CASTS = ['uuid', 'jsonb', 'text', 'integer', 'text', 'timestamptz', 'integer']

function items(...lines: [string, number, number][]) {
  return JSON.stringify(lines.map(([product_id, quantity, shown_price]) => ({ product_id, quantity, shown_price })))
}

async function sell(
  user: string,
  lines: [string, number, number][],
  payment = 'efectivo',
  opts: { transfer?: number; last4?: string; at?: Date; clientTotal?: number; id?: string } = {},
) {
  await db.as(user)
  const clientTotal = opts.clientTotal ?? lines.reduce((s, [, q, p]) => s + q * p, 0)
  return db.call<SaleResult>(
    'register_sale',
    [opts.id ?? randomUUID(), items(...lines), payment, opts.transfer ?? null, opts.last4 ?? null, (opts.at ?? new Date()).toISOString(), clientTotal],
    SALE_CASTS,
  )
}

async function sellError(user: string, lines: [string, number, number][], payment: string, opts: { transfer?: number; last4?: string; clientTotal?: number } = {}) {
  await db.as(user)
  const clientTotal = opts.clientTotal ?? lines.reduce((s, [, q, p]) => s + q * p, 0)
  return db.callError(
    'register_sale',
    [randomUUID(), items(...lines), payment, opts.transfer ?? null, opts.last4 ?? null, new Date().toISOString(), clientTotal],
    SALE_CASTS,
  )
}

async function stockOf(id: string) {
  await db.asSuper()
  return (await db.one<{ stock: number }>('select stock from public.products where id = $1', [id])).stock
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000)

beforeAll(async () => {
  db = await TestDb.create()
  await db.createUser('dueno', 'owner')
  admin = await db.createUser('admin1', 'admin')
  venta = await db.createUser('vende1', 'venta')
  venta2 = await db.createUser('vende2', 'venta')
  await db.as(admin)
  coca = await db.call<string>('create_product', ['Coca 500', 2000], ['text', 'integer'])
  chori = await db.call<string>('create_product', ['Choripán', 4000], ['text', 'integer'])
  hielo = await db.call<string>('create_product', ['Hielo (bolsa)', 0, false, false, 2], ['text', 'integer', 'boolean', 'boolean', 'integer'])
  await db.asSuper()
  varios = (await db.one<{ id: string }>(`select id from public.products where name = 'Varios'`)).id
  // Precios con historia: Coca valía 1500 hace 2 días.
  await db.rows(`update public.price_history set valid_from = now() - interval '10 days' where product_id = $1`, [coca])
  await db.rows(
    `insert into public.price_history (product_id, price, valid_from) values ($1, 1500, now() - interval '10 days'), ($1, 2000, now() - interval '1 day')`,
    [coca],
  )
  await db.rows(`delete from public.price_history where product_id = $1 and price = 2000 and valid_from < now() - interval '5 days'`, [coca])
  await db.as(venta)
  await db.call('add_stock', [null, coca, 50, 60000], ['uuid', 'uuid', 'integer', 'integer'])
  await db.call('add_stock', [null, chori, 10, 20000], ['uuid', 'uuid', 'integer', 'integer'])
})

describe('register_sale', () => {
  it('efectivo: guarda montos, atribuye al usuario, descuenta stock y audita', async () => {
    const before = await stockOf(coca)
    const s = await sell(venta, [[coca, 2, 2000]])
    expect(s).toMatchObject({ total: 4000, cash_amount: 4000, transfer_amount: 0, transfer_last4: null, flags: [] })
    expect(await stockOf(coca)).toBe(before - 2)
    await db.asSuper()
    const row = await db.one<{ created_by: string }>('select created_by from public.sales where id = $1', [s.id])
    expect(row.created_by).toBe(venta)
    const log = await db.rows(`select action from public.audit_log where entity_id = $1`, [s.id])
    expect(log).toEqual([{ action: 'sale.register' }])
  })

  it('es idempotente: reenviar la misma venta no duplica', async () => {
    const id = randomUUID()
    const before = await stockOf(chori)
    const a = await sell(venta, [[chori, 1, 4000]], 'efectivo', { id })
    const b = await sell(venta, [[chori, 1, 4000]], 'efectivo', { id })
    expect(b.id).toBe(a.id)
    expect(await stockOf(chori)).toBe(before - 1)
    await db.as(venta2)
    expect(
      await db.callError('register_sale', [id, items([chori, 1, 4000]), 'efectivo', null, null, null, 4000], SALE_CASTS),
    ).toMatch(/conflict/)
  })

  it('transferencia exige los 4 dígitos', async () => {
    expect(await sellError(venta, [[coca, 1, 2000]], 'transferencia')).toMatch(/4 números/)
    expect(await sellError(venta, [[coca, 1, 2000]], 'transferencia', { last4: '12a4' })).toMatch(/4 números/)
    const s = await sell(venta, [[coca, 1, 2000]], 'transferencia', { last4: '1234' })
    expect(s).toMatchObject({ total: 2000, cash_amount: 0, transfer_amount: 2000, transfer_last4: '1234' })
  })

  it('mixto: el efectivo es total − transferido', async () => {
    const s = await sell(venta, [[chori, 1, 4000]], 'mixto', { transfer: 3000, last4: '9876' })
    expect(s).toMatchObject({ total: 4000, cash_amount: 1000, transfer_amount: 3000, transfer_last4: '9876', flags: [] })
  })

  it('mixto rechaza transferencia en 0 o mayor/igual al total', async () => {
    expect(await sellError(venta, [[chori, 1, 4000]], 'mixto', { transfer: 0, last4: '1111' })).toMatch(/mixto/)
    expect(await sellError(venta, [[chori, 1, 4000]], 'mixto', { transfer: 4000, last4: '1111' })).toMatch(/mixto/)
    expect(await sellError(venta, [[chori, 1, 4000]], 'mixto', { transfer: 1000 })).toMatch(/4 números/)
  })

  it('precio desactualizado (vigente en los últimos 3 días) se acepta y se marca', async () => {
    const s = await sell(venta, [[coca, 1, 1500]])
    expect(s.total).toBe(1500)
    expect(s.flags).toEqual(['precio_desactualizado'])
  })

  it('precio que nunca estuvo vigente: usa el del servidor y marca precio_distinto', async () => {
    const s = await sell(venta, [[coca, 1, 999]])
    expect(s.total).toBe(2000)
    expect(s.flags).toEqual(['precio_distinto'])
  })

  it('mixto con precio distinto: respeta la transferencia, ajusta el efectivo y marca pago_ajustado', async () => {
    // El teléfono cree que el total es 2 × 1000 = 2000 y declara 1500 transferidos; el real es 4000.
    const s = await sell(venta, [[coca, 2, 1000]], 'mixto', { transfer: 1500, last4: '4321' })
    expect(s).toMatchObject({ total: 4000, transfer_amount: 1500, cash_amount: 2500 })
    expect(s.flags).toEqual(expect.arrayContaining(['precio_distinto', 'pago_ajustado']))
    await db.asSuper()
    const log = await db.one<{ detail: { declared: { total: number; transfer: number; cash: number } } }>(
      `select detail from public.audit_log where entity_id = $1`,
      [s.id],
    )
    expect(log.detail.declared).toEqual({ total: 2000, transfer: 1500, cash: 500 })
  })

  it('mixto: si la transferencia supera el nuevo total, se recorta y el efectivo queda en 0', async () => {
    await db.as(admin)
    const caro = await db.call<string>('create_product', ['Promo', 3000], ['text', 'integer'])
    await db.call('set_price', [caro, 1000], ['uuid', 'integer'])
    await db.asSuper()
    // Hacer que el precio de 3000 nunca haya estado vigente en los últimos 3 días.
    await db.rows(`update public.price_history set valid_from = now() - interval '20 days' where product_id = $1 and price = 3000`, [caro])
    await db.rows(`update public.price_history set valid_from = now() - interval '10 days' where product_id = $1 and price = 1000`, [caro])
    const s = await sell(venta, [[caro, 1, 3000]], 'mixto', { transfer: 2000, last4: '5555' })
    expect(s).toMatchObject({ total: 1000, transfer_amount: 1000, cash_amount: 0 })
    expect(s.flags).toEqual(expect.arrayContaining(['precio_distinto', 'pago_ajustado']))
  })

  it('permite vender sin stock, con marca stock_negativo', async () => {
    await db.as(admin)
    const sin = await db.call<string>('create_product', ['Sin stock', 500], ['text', 'integer'])
    const s = await sell(venta, [[sin, 3, 500]])
    expect(s.flags).toContain('stock_negativo')
    expect(await stockOf(sin)).toBe(-3)
  })

  it('rechaza productos que no se venden en caja y cantidades fuera de rango', async () => {
    expect(await sellError(venta, [[hielo, 1, 0]], 'efectivo')).toMatch(/no se vende en caja/)
    expect(await sellError(venta, [[coca, 0, 2000]], 'efectivo')).toMatch(/Cantidad/)
    expect(await sellError(venta, [[coca, 101, 2000]], 'efectivo')).toMatch(/Cantidad/)
    expect(await sellError(venta, [], 'efectivo')).toMatch(/invalid/)
  })

  it('producto desactivado: se acepta y se marca', async () => {
    await db.as(admin)
    const viejo = await db.call<string>('create_product', ['Viejo', 100], ['text', 'integer'])
    await db.call('update_product', [viejo, 'Viejo', true, false, null, 0, false], ['uuid', 'text', 'boolean', 'boolean', 'integer', 'integer', 'boolean'])
    const s = await sell(venta, [[viejo, 1, 100]])
    expect(s.flags).toContain('producto_inactivo')
  })

  it('hora del teléfono: diferida si llega tarde, corregida si está fuera de la ventana', async () => {
    const late = await sell(venta, [[coca, 1, 2000]], 'efectivo', { at: minutesAgo(30) })
    expect(late.flags).toEqual(['diferida'])
    const old = await sell(venta, [[coca, 1, 2000]], 'efectivo', { at: minutesAgo(60 * 24 * 5) })
    expect(old.flags).toContain('fecha_corregida')
    // Un admin (sales.backdate) puede cargar ventas de hasta 30 días (plan C, papel).
    // Hace 5 días la Coca valía 1500: ese es el precio de la venta.
    const back = await sell(admin, [[coca, 1, 1500]], 'efectivo', { at: minutesAgo(60 * 24 * 5) })
    expect(back.flags).toEqual(['diferida'])
    expect(back.total).toBe(1500)
  })
})

describe('void_sale', () => {
  const voidSale = (user: string, id: string, at?: Date) =>
    db.as(user).then(() => db.call<SaleResult>('void_sale', [id, 'error de carga', at?.toISOString() ?? null], ['uuid', 'text', 'timestamptz']))
  const voidError = (user: string, id: string, reason = 'motivo') =>
    db.as(user).then(() => db.callError('void_sale', [id, reason, null], ['uuid', 'text', 'timestamptz']))

  it('venta anula su propia venta reciente; repone stock; es idempotente', async () => {
    const before = await stockOf(chori)
    const s = await sell(venta, [[chori, 2, 4000]])
    const v = await voidSale(venta, s.id)
    expect(v.status).toBe('anulada')
    expect(await stockOf(chori)).toBe(before)
    const again = await voidSale(venta, s.id)
    expect(again.status).toBe('anulada')
    expect(await stockOf(chori)).toBe(before)
  })

  it('exige motivo', async () => {
    const s = await sell(venta, [[coca, 1, 2000]])
    expect(await voidError(venta, s.id, '  ')).toMatch(/motivo/)
  })

  it('venta no anula ventas de otro', async () => {
    const s = await sell(venta2, [[coca, 1, 2000]])
    expect(await voidError(venta, s.id)).toMatch(/out_of_window/)
  })

  it('venta no anula fuera del límite de minutos (60 por defecto)', async () => {
    const s = await sell(venta, [[coca, 1, 2000]], 'efectivo', { at: minutesAgo(61) })
    expect(await voidError(venta, s.id)).toMatch(/Fuera de plazo/)
    // Con el límite en 0 (sin límite extra dentro del día) sí puede, si sigue siendo el mismo día en San Juan.
    await db.as(admin)
    await db.call('set_setting', ['void_own_window_minutes', '0'], ['text', 'jsonb'])
    await db.asSuper()
    const sameDay = await db.one<{ same: boolean }>(
      `select public.sj_date(created_at) = public.sj_date(now()) as same from public.sales where id = $1`,
      [s.id],
    )
    if (sameDay.same) expect((await voidSale(venta, s.id)).status).toBe('anulada')
    else expect(await voidError(venta, s.id)).toMatch(/Fuera de plazo/)
    await db.as(admin)
    await db.call('set_setting', ['void_own_window_minutes', '60'], ['text', 'jsonb'])
  })

  it('anulación hecha sin señal: vale la hora del teléfono', async () => {
    const s = await sell(venta, [[coca, 1, 2000]], 'efectivo', { at: minutesAgo(90) })
    // Se tocó "Anular" 20 minutos después de la venta, pero recién se sincroniza ahora.
    const v = await voidSale(venta, s.id, minutesAgo(70))
    expect(v.status).toBe('anulada')
    await db.asSuper()
    const log = await db.one<{ flags: string[] }>(`select flags from public.audit_log where entity_id = $1 and action = 'sale.void'`, [s.id])
    expect(log.flags).toEqual(['diferida'])
  })

  it('una hora de anulación anterior a la venta se acota a la hora de la venta', async () => {
    const s = await sell(venta, [[coca, 1, 2000]], 'efectivo', { at: minutesAgo(90) })
    const v = await voidSale(venta, s.id, minutesAgo(60 * 24))
    expect(v.status).toBe('anulada')
    expect(new Date(v.voided_at!).getTime()).toBe(new Date(s.created_at).getTime())
  })

  it('admin anula cualquier venta de los últimos 30 días', async () => {
    const s = await sell(venta2, [[coca, 1, 2000]], 'efectivo', { at: minutesAgo(120) })
    const v = await voidSale(admin, s.id)
    expect(v.status).toBe('anulada')
    await db.asSuper()
    const log = await db.one<{ detail: { mode: string } }>(`select detail from public.audit_log where entity_id = $1 and action = 'sale.void'`, [s.id])
    expect(log.detail.mode).toBe('any')
  })

  it('venta ve solo sus ventas del día; admin ve todas', async () => {
    await db.as(venta)
    const mine = await db.rows<{ created_by: string }>('select created_by from public.sales')
    expect(mine.every((r) => r.created_by === venta)).toBe(true)
    await db.as(admin)
    const all = await db.rows<{ created_by: string }>('select distinct created_by from public.sales')
    expect(all.length).toBeGreaterThan(1)
  })
})

describe('stock', () => {
  it('add_stock exige costo; Varios exige detalle; idempotente por id', async () => {
    await db.as(venta)
    expect(await db.callError('add_stock', [null, coca, 1, null], ['uuid', 'uuid', 'integer', 'integer'])).toMatch(/gastó/)
    expect(await db.callError('add_stock', [null, varios, 1, 5000], ['uuid', 'uuid', 'integer', 'integer'])).toMatch(/detalle/)
    await db.call('add_stock', [null, varios, 1, 5000, 'Detergente'], ['uuid', 'uuid', 'integer', 'integer', 'text'])
    const id = randomUUID()
    const before = await stockOf(hielo)
    await db.as(venta)
    await db.call('add_stock', [id, hielo, 5, 7500], ['uuid', 'uuid', 'integer', 'integer'])
    await db.call('add_stock', [id, hielo, 5, 7500], ['uuid', 'uuid', 'integer', 'integer'])
    expect(await stockOf(hielo)).toBe(before + 5)
  })

  it('consumo de insumos resta stock; no se permite en Varios', async () => {
    const before = await stockOf(hielo)
    await db.as(venta)
    await db.call('consume_stock', [null, hielo, 2, 'para las bebidas'], ['uuid', 'uuid', 'integer', 'text'])
    expect(await stockOf(hielo)).toBe(before - 2)
    await db.as(venta)
    expect(await db.callError('consume_stock', [null, varios, 1], ['uuid', 'uuid', 'integer'])).toMatch(/invalid/)
  })

  it('ajuste exige motivo y marca stock negativo', async () => {
    await db.as(venta)
    expect(await db.callError('adjust_stock', [null, hielo, -1, ''], ['uuid', 'uuid', 'integer', 'text'])).toMatch(/motivo/)
    const stock = await stockOf(hielo)
    await db.as(venta)
    await db.call('adjust_stock', [null, hielo, -(stock + 1), 'se rompió'], ['uuid', 'uuid', 'integer', 'text'])
    await db.asSuper()
    const log = await db.rows<{ flags: string[] }>(`select flags from public.audit_log where action = 'stock.adjust' order by id desc limit 1`)
    expect(log[0].flags).toEqual(['stock_negativo'])
  })

  it('anular una compra revierte cantidad y costo, una sola vez', async () => {
    await db.as(venta)
    const mov = await db.call<string>('add_stock', [null, coca, 3, 4500], ['uuid', 'uuid', 'integer', 'integer'])
    const before = await stockOf(coca)
    await db.as(venta)
    const r1 = await db.call<string>('void_stock_entry', [mov, 'cargué de más'], ['uuid', 'text'])
    const r2 = await db.call<string>('void_stock_entry', [mov, 'cargué de más'], ['uuid', 'text'])
    expect(r2).toBe(r1)
    expect(await stockOf(coca)).toBe(before - 3)
    await db.asSuper()
    const rev = await db.one<{ total_cost: number; quantity: number }>('select total_cost, quantity from public.stock_movements where id = $1', [r1])
    expect(rev).toEqual({ total_cost: -4500, quantity: -3 })
  })

  it('invariante: stock = suma de movimientos, en todos los productos', async () => {
    await db.asSuper()
    const bad = await db.rows(`
      select p.name from public.products p
      left join public.stock_movements m on m.product_id = p.id
      group by p.id having p.stock <> coalesce(sum(m.quantity), 0)`)
    expect(bad).toEqual([])
  })

  it('toda escritura deja auditoría', async () => {
    await db.asSuper()
    const counts = await db.one<{ sales: number; voids: number; movs: number; audits: number }>(`
      select
        (select count(*) from public.sales)::int as sales,
        (select count(*) from public.sales where status = 'anulada')::int as voids,
        (select count(*) from public.stock_movements where type in ('entrada','consumo','ajuste','anulacion_entrada'))::int as movs,
        (select count(*) from public.audit_log where action in ('sale.register','sale.void','stock.add','stock.consume','stock.adjust','stock.void_entry'))::int as audits`)
    expect(counts.audits).toBe(counts.sales + counts.voids + counts.movs)
  })
})

describe('balance_report', () => {
  it('suma ingresos por medio, egresos y resultado', async () => {
    const fresh = await TestDb.create()
    const a = await fresh.createUser('admin', 'admin')
    const v = await fresh.createUser('vende', 'venta')
    await fresh.as(a)
    const p = await fresh.call<string>('create_product', ['Pancho', 3000], ['text', 'integer'])
    const h = await fresh.call<string>('create_product', ['Carbón', 0, false], ['text', 'integer', 'boolean'])
    await fresh.call('add_stock', [null, p, 10, 15000], ['uuid', 'uuid', 'integer', 'integer'])
    await fresh.call('add_stock', [null, h, 2, 8000], ['uuid', 'uuid', 'integer', 'integer'])
    await fresh.as(v)
    await fresh.call('consume_stock', [null, h, 1], ['uuid', 'uuid', 'integer'])
    const reg = (args: unknown[]) => fresh.call<SaleResult>('register_sale', args, SALE_CASTS)
    await reg([randomUUID(), items([p, 2, 3000]), 'efectivo', null, null, null, 6000])
    await reg([randomUUID(), items([p, 1, 3000]), 'transferencia', null, '1234', null, 3000])
    await reg([randomUUID(), items([p, 2, 3000]), 'mixto', 4000, '5678', null, 6000])
    const anulada = await reg([randomUUID(), items([p, 1, 3000]), 'efectivo', null, null, null, 3000])
    await fresh.call('void_sale', [anulada.id, 'error', null], ['uuid', 'text', 'timestamptz'])

    await fresh.as(a)
    const today = (await fresh.one<{ d: string }>(`select public.sj_date(now())::text as d`)).d
    const r = await fresh.call<Record<string, any>>('balance_report', [today, today], ['date', 'date'])
    expect(r.income).toEqual({ total: 15000, count: 3, average: 5000 })
    expect(r.by_method).toMatchObject({ cash: 8000, transfer: 7000, count_efectivo: 1, count_transferencia: 1, count_mixto: 1 })
    expect(r.transfers.map((t: any) => [t.amount, t.last4, t.mixed])).toEqual([
      [3000, '1234', false],
      [4000, '5678', true],
    ])
    expect(r.expenses.total).toBe(23000)
    expect(r.result).toBe(15000 - 23000)
    expect(r.by_product).toEqual([{ product_id: p, name: 'Pancho', units: 5, amount: 15000 }])
    expect(r.supplies).toMatchObject([{ name: 'Carbón', bought: 2, consumed: 1, stock: 1 }])
    expect(r.by_seller).toMatchObject([{ username: 'vende', count: 3, amount: 15000, cash: 8000, transfer: 7000 }])
    expect(r.incidents.voids).toHaveLength(1)
    expect(await fresh.call('last_sale_day')).toBeTruthy()
  })
})
