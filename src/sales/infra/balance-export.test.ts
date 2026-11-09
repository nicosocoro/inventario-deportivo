import { describe, expect, it } from 'vitest'
import { buildBalancePdf } from './balance-pdf'
import { buildBalanceCsv } from './balance-csv'
import type { BalanceReport } from '../domain/balance'

const report: BalanceReport = {
  from: '2026-11-08',
  to: '2026-11-08',
  generated_at: '2026-11-08T22:00:00Z',
  income: { total: 15000, count: 3, average: 5000 },
  by_method: { cash: 8000, transfer: 7000, count_efectivo: 1, count_transferencia: 1, count_mixto: 1 },
  transfers: [
    { sale_id: 'a', at: '2026-11-08T18:00:00Z', amount: 3000, last4: '1234', seller: 'vende', mixed: false },
    { sale_id: 'b', at: '2026-11-08T19:00:00Z', amount: 4000, last4: '5678', seller: 'vende', mixed: true },
  ],
  expenses: { total: 23000, by_product: [{ product_id: 'p', name: 'Choripán', quantity: 10, cost: 15000 }] },
  misc_details: [{ at: '2026-11-08T17:00:00Z', name: 'Varios', cost: 2000, note: 'Detergente; trapos', user: 'vende' }],
  by_product: [{ product_id: 'p', name: 'Choripán', units: 5, amount: 15000 }],
  supplies: [{ product_id: 'h', name: 'Hielo (bolsa)', bought: 4, consumed: 3, stock: 1, min_stock: 2 }],
  by_day: [{ day: '2026-11-08', amount: 15000, count: 3 }],
  by_seller: [{ username: 'vende', display_name: 'Juana Pérez', count: 3, amount: 15000, cash: 8000, transfer: 7000 }],
  incidents: {
    voids: [
      { sale_id: 'c', sale_at: '2026-11-08T18:30:00Z', voided_at: '2026-11-08T18:40:00Z', total: 3000, reason: 'error', seller: 'vende', voided_by: 'vende', by_other: false },
    ],
    adjustments: [{ at: '2026-11-08T20:00:00Z', name: 'Hielo (bolsa)', quantity: -1, note: 'se derritió', user: 'vende' }],
    voided_entries: [],
    flagged_sales: [{ sale_id: 'd', at: '2026-11-08T19:30:00Z', total: 4000, flags: ['pago_ajustado', 'stock_negativo'], seller: 'vende', status: 'ok' }],
  },
  stock_alerts: [{ product_id: 'h', name: 'Hielo (bolsa)', stock: 1, min_stock: 2, for_sale: false }],
  result: -8000,
}

describe('exportación del balance', () => {
  it('genera un PDF válido', async () => {
    const blob = await buildBalancePdf(report, 'Admin Ñandú')
    expect(blob.size).toBeGreaterThan(2000)
    const head = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()).slice(0, 5))
    expect(head).toBe('%PDF-')
  })

  it('genera un CSV con ";", BOM y campos escapados', async () => {
    const blob = buildBalanceCsv(report)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]) // BOM UTF-8 (Excel lee bien los acentos)
    const text = await blob.text()
    expect(text).toContain('Ingresos;15000')
    expect(text).toContain('"Detergente; trapos"')
    expect(text).toContain('Pago ajustado, Sin stock')
  })

  it('CSV: neutraliza fórmulas en textos pero no toca montos negativos', async () => {
    const r: BalanceReport = {
      ...report,
      misc_details: [
        { at: '2026-11-08T17:00:00Z', name: 'Varios', cost: 2000, note: '=1+1', user: '@x' },
        { at: '2026-11-08T17:30:00Z', name: 'Varios', cost: 500, note: 'línea\rdos', user: 'vende' },
      ],
    }
    const text = await buildBalanceCsv(r).text()
    expect(text).toContain(";'=1+1;'@x;2000")
    expect(text).toContain('"línea\rdos"')
    expect(text).toContain('Resultado;-8000')
    expect(text).toContain('Hielo (bolsa);-1;')
  })
})
