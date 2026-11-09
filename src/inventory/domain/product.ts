export interface Product {
  id: string
  name: string
  price: number
  stock: number
  forSale: boolean
  requiresNote: boolean
  minStock: number | null
  sortOrder: number
  active: boolean
}

export interface PriceChange {
  productId: string
  price: number
  validFrom: string
  changedBy: string | null
}

export type MovementType = 'entrada' | 'venta' | 'consumo' | 'ajuste' | 'anulacion_venta' | 'anulacion_entrada'

export interface StockMovement {
  id: string
  productId: string
  productName: string
  type: MovementType
  quantity: number
  totalCost: number | null
  note: string | null
  createdBy: string
  createdAt: string
  reversed: boolean
}

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  entrada: 'Compra',
  venta: 'Venta',
  consumo: 'Consumo',
  ajuste: 'Ajuste',
  anulacion_venta: 'Venta anulada',
  anulacion_entrada: 'Compra anulada',
}

export type StockStatus = 'negative' | 'low' | 'ok'

export function stockStatus(p: Pick<Product, 'stock' | 'minStock'>): StockStatus {
  if (p.stock < 0) return 'negative'
  if (p.minStock !== null && p.stock < p.minStock) return 'low'
  return 'ok'
}

/** Productos de la grilla de la caja. */
export function registerProducts(products: Product[]): Product[] {
  return products.filter((p) => p.forSale && p.active).sort(byOrder)
}

/** Productos a los que se les carga stock y que aparecen en "Stock" (todo menos "Varios"). */
export function stockProducts(products: Product[]): Product[] {
  return products.filter((p) => p.active && !p.requiresNote).sort(byStockAttention)
}

/** Productos elegibles en "Compras": a la venta, insumos y al final "Varios". */
export function purchaseProducts(products: Product[]): { forSale: Product[]; supplies: Product[]; misc: Product[] } {
  const active = products.filter((p) => p.active).sort(byOrder)
  return {
    forSale: active.filter((p) => p.forSale),
    supplies: active.filter((p) => !p.forSale && !p.requiresNote),
    misc: active.filter((p) => p.requiresNote),
  }
}

export function isSupply(p: Product): boolean {
  return !p.forSale && !p.requiresNote
}

export function byOrder(a: Product, b: Product): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'es')
}

const ATTENTION: Record<StockStatus, number> = { negative: 0, low: 1, ok: 2 }
function byStockAttention(a: Product, b: Product): number {
  return ATTENTION[stockStatus(a)] - ATTENTION[stockStatus(b)] || byOrder(a, b)
}

export interface ProductDraft {
  name: string
  price: number
  forSale: boolean
  requiresNote: boolean
  minStock: number | null
  sortOrder: number
  active: boolean
}

export function validateProduct(d: ProductDraft): string | null {
  if (!d.name.trim()) return 'El nombre es obligatorio'
  if (d.name.trim().length > 60) return 'El nombre es demasiado largo'
  if (!Number.isInteger(d.price) || d.price < 0) return 'Precio inválido'
  if (d.minStock !== null && (!Number.isInteger(d.minStock) || d.minStock < 0)) return 'Stock mínimo inválido'
  return null
}
