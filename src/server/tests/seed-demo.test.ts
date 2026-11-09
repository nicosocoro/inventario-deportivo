import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TestDb } from './db'

describe('seed-demo.sql', () => {
  it('carga productos, compras y dos domingos de ventas manteniendo los invariantes', async () => {
    const db = await TestDb.create()
    await db.createUser('demo-admin', 'admin')
    await db.createUser('demo-venta', 'venta')
    await db.createUser('demo-venta2', 'venta')
    await db.asSuper()
    await db.pg.exec(readFileSync(join(import.meta.dirname, '..', 'supabase', 'seed-demo.sql'), 'utf8'))

    const counts = await db.one<{ products: number; sales: number; voided: number; days: number; mixed: number }>(`
      select (select count(*) from public.products)::int as products,
             (select count(*) from public.sales)::int as sales,
             (select count(*) from public.sales where status = 'anulada')::int as voided,
             (select count(distinct public.sj_date(created_at)) from public.sales)::int as days,
             (select count(*) from public.sales where payment_method = 'mixto')::int as mixed`)
    expect(counts).toMatchObject({ products: 18, sales: 50, voided: 2, days: 2 })

    const days = await db.rows<{ dow: number }>(`select distinct extract(isodow from public.sj_date(created_at))::int as dow from public.sales`)
    expect(days).toEqual([{ dow: 7 }])

    const bad = await db.rows(`
      select p.name from public.products p left join public.stock_movements m on m.product_id = p.id
      group by p.id having p.stock <> coalesce(sum(m.quantity), 0)`)
    expect(bad).toEqual([])

    expect(await db.error(`select 1 from (select public.register_sale(null, null, null)) x`)).toBeTruthy()
  })
})
