export type PaymentMethod = 'efectivo' | 'transferencia' | 'mixto'

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  mixto: 'Mixto',
}

export interface PaymentInput {
  method: PaymentMethod
  /** Solo en mixto. */
  transferAmount: number | null
  /** Solo en mixto (se deduce del total). */
  cashAmount: number | null
  /** Últimos 4 números de la transferencia (transferencia y mixto). */
  last4: string
}

export const LAST4_RE = /^\d{4}$/

/**
 * Pago mixto: al escribir uno de los montos, el otro se completa con total − monto.
 * El último campo editado manda.
 */
export function autocompleteMixed(total: number, edited: 'cash' | 'transfer', value: number | null): { cash: number | null; transfer: number | null } {
  if (value === null) return { cash: null, transfer: null }
  const other = Math.max(0, total - value)
  return edited === 'cash' ? { cash: value, transfer: other } : { cash: other, transfer: value }
}

/** Montos finales (cash + transfer = total). */
export function paymentAmounts(total: number, p: PaymentInput): { cash: number; transfer: number } {
  if (p.method === 'efectivo') return { cash: total, transfer: 0 }
  if (p.method === 'transferencia') return { cash: 0, transfer: total }
  const transfer = p.transferAmount ?? 0
  return { cash: total - transfer, transfer }
}

/** null = válido; si no, el mensaje para mostrar. */
export function validatePayment(total: number, p: PaymentInput): string | null {
  if (p.method !== 'efectivo' && !LAST4_RE.test(p.last4)) return 'Cargá los últimos 4 números de la transferencia'
  if (p.method === 'mixto') {
    const t = p.transferAmount
    const c = p.cashAmount
    if (t === null || c === null || !Number.isInteger(t) || !Number.isInteger(c)) return 'Completá los dos montos'
    if (t <= 0 || c <= 0) return 'Si un monto es 0, elegí Efectivo o Transferencia'
    if (t + c !== total) return 'Los montos no suman el total'
  }
  return null
}

/** Vuelto para "Paga con" (no se guarda). null si no alcanza o no hay dato. */
export function change(total: number, paysWith: number | null): number | null {
  if (paysWith === null || paysWith < total) return null
  return paysWith - total
}
