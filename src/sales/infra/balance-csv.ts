import type { BalanceReport } from '../domain/balance'
import { flagLabel } from '../domain/sale'
import { formatDateTime } from '../../shared/dates'

const esc = (v: unknown) => {
  let s = v === null || v === undefined ? '' : String(v)
  // Texto que Excel tomaría como fórmula (= + - @, tab o CR al inicio): se antepone un apóstrofo.
  // Solo a strings: los montos (number) negativos quedan como números.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV con ";" (lo que Excel en español abre bien) y BOM para los acentos. */
export function buildBalanceCsv(r: BalanceReport): Blob {
  const lines: unknown[][] = []
  const section = (title: string, head: string[], rows: unknown[][]) => {
    lines.push([title], head, ...rows, [])
  }
  section('Resumen', ['Concepto', 'Monto'], [
    ['Ingresos', r.income.total],
    ['Egresos', r.expenses.total],
    ['Resultado', r.result],
    ['Efectivo', r.by_method.cash],
    ['Transferencias', r.by_method.transfer],
    ['Ventas', r.income.count],
  ])
  section('Ventas por producto', ['Producto', 'Unidades', 'Monto'], r.by_product.map((p) => [p.name, p.units, p.amount]))
  section('Egresos', ['Producto', 'Unidades', 'Gastado'], r.expenses.by_product.map((p) => [p.name, p.quantity, p.cost]))
  section('Varios', ['Fecha', 'Detalle', 'Usuario', 'Monto'], r.misc_details.map((m) => [formatDateTime(m.at), m.note, m.user, m.cost]))
  section('Insumos', ['Insumo', 'Comprados', 'Usados', 'Stock'], r.supplies.map((s) => [s.name, s.bought, s.consumed, s.stock]))
  section('Por día', ['Día', 'Ventas', 'Monto'], r.by_day.map((d) => [d.day, d.count, d.amount]))
  section('Por vendedor', ['Vendedor', 'Ventas', 'Efectivo', 'Transferencias', 'Total'], r.by_seller.map((s) => [s.username, s.count, s.cash, s.transfer, s.amount]))
  section('Transferencias', ['Fecha', 'Últimos 4', 'Vendedor', 'Mixta', 'Monto'], r.transfers.map((t) => [formatDateTime(t.at), t.last4, t.seller, t.mixed ? 'Sí' : '', t.amount]))
  section('Anulaciones', ['Anulada', 'Venta', 'Total', 'Motivo', 'Vendedor', 'Anuló'], r.incidents.voids.map((v) => [formatDateTime(v.voided_at), formatDateTime(v.sale_at), v.total, v.reason, v.seller, v.voided_by]))
  section('Ajustes', ['Fecha', 'Producto', 'Cantidad', 'Motivo', 'Usuario'], r.incidents.adjustments.map((a) => [formatDateTime(a.at), a.name, a.quantity, a.note, a.user]))
  section('Ventas con marcas', ['Fecha', 'Total', 'Marcas', 'Vendedor', 'Estado'], r.incidents.flagged_sales.map((s) => [formatDateTime(s.at), s.total, s.flags.map(flagLabel).join(', '), s.seller, s.status]))
  const text = lines.map((l) => l.map(esc).join(';')).join('\r\n')
  return new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' })
}
