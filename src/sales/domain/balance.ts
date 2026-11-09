import { addDays, monthOf, weekOf, type Day, type DayRange } from '../../shared/dates'

// Forma del JSON que devuelve public.balance_report (se mantiene en snake_case, como viene).
export interface BalanceReport {
  from: Day
  to: Day
  generated_at: string
  income: { total: number; count: number; average: number }
  by_method: { cash: number; transfer: number; count_efectivo: number; count_transferencia: number; count_mixto: number }
  transfers: { sale_id: string; at: string; amount: number; last4: string; seller: string; mixed: boolean }[]
  expenses: { total: number; by_product: { product_id: string; name: string; quantity: number; cost: number }[] }
  misc_details: { at: string; name: string; cost: number; note: string | null; user: string }[]
  by_product: { product_id: string; name: string; units: number; amount: number }[]
  supplies: { product_id: string; name: string; bought: number; consumed: number; stock: number; min_stock: number | null }[]
  by_day: { day: Day; amount: number; count: number }[]
  by_seller: { username: string; display_name: string | null; count: number; amount: number; cash: number; transfer: number }[]
  incidents: {
    voids: {
      sale_id: string
      sale_at: string
      voided_at: string
      total: number
      reason: string
      seller: string
      voided_by: string
      by_other: boolean
    }[]
    adjustments: { at: string; name: string; quantity: number; note: string; user: string }[]
    voided_entries: { at: string; name: string; quantity: number; cost: number; note: string; user: string }[]
    flagged_sales: { sale_id: string; at: string; total: number; flags: string[]; seller: string; status: string }[]
  }
  stock_alerts: { product_id: string; name: string; stock: number; min_stock: number | null; for_sale: boolean }[]
  result: number
}

export type PeriodKind = 'hoy' | 'partido' | 'semana' | 'mes' | 'custom'

export const PERIOD_LABELS: Record<PeriodKind, string> = {
  hoy: 'Hoy',
  partido: 'Último partido',
  semana: 'Semana',
  mes: 'Mes',
  custom: 'Fechas',
}

/** Rango de días de cada atajo. "Último partido" = último día con ventas. Semana = lunes a domingo. */
export function periodRange(kind: PeriodKind, today: Day, lastSaleDay: Day | null, custom?: DayRange): DayRange {
  switch (kind) {
    case 'hoy':
      return { from: today, to: today }
    case 'partido': {
      const d = lastSaleDay ?? today
      return { from: d, to: d }
    }
    case 'semana':
      return weekOf(today)
    case 'mes':
      return monthOf(today)
    case 'custom':
      return custom ?? { from: addDays(today, -6), to: today }
  }
}

export function formatDayShort(d: Day): string {
  return d.split('-').reverse().join('/')
}

export function periodTitle(range: DayRange): string {
  return range.from === range.to ? formatDayShort(range.from) : `${formatDayShort(range.from)} al ${formatDayShort(range.to)}`
}

export function hasIncidents(r: BalanceReport): boolean {
  const i = r.incidents
  return i.voids.length + i.adjustments.length + i.voided_entries.length + i.flagged_sales.length > 0
}
