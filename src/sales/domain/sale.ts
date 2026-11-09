import type { CartLine } from './cart'
import type { PaymentMethod } from './payment'

export type SaleFlag =
  | 'diferida'
  | 'fecha_corregida'
  | 'stock_negativo'
  | 'precio_desactualizado'
  | 'precio_distinto'
  | 'producto_inactivo'
  | 'pago_ajustado'

export const FLAG_LABELS: Record<string, string> = {
  diferida: 'Cargada después',
  fecha_corregida: 'Fecha corregida',
  stock_negativo: 'Sin stock',
  precio_desactualizado: 'Precio anterior',
  precio_distinto: 'Precio corregido',
  producto_inactivo: 'Producto inactivo',
  pago_ajustado: 'Pago ajustado',
}

export function flagLabel(flag: string): string {
  return FLAG_LABELS[flag] ?? flag
}

export interface Sale {
  id: string
  total: number
  paymentMethod: PaymentMethod
  cashAmount: number
  transferAmount: number
  transferLast4: string | null
  status: 'ok' | 'anulada'
  flags: string[]
  createdAt: string
  createdBy: string
  voidedAt: string | null
  voidReason: string | null
  sellerName?: string
  items?: { productId: string; name: string; quantity: number; unitPrice: number }[]
}

export interface RegisterSaleCommand {
  id: string
  items: CartLine[]
  payment: PaymentMethod
  transferAmount: number | null
  last4: string | null
  deviceCreatedAt: string
  clientTotal: number
}

export interface VoidSaleCommand {
  saleId: string
  reason: string
  deviceVoidedAt: string
}
