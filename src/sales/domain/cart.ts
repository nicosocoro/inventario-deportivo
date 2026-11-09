import type { Product } from '../../inventory/domain/product'

export interface CartLine {
  productId: string
  name: string
  quantity: number
  /** Precio que mostró el teléfono. */
  shownPrice: number
}

export const MAX_QTY = 100

export function addOne(cart: CartLine[], p: Pick<Product, 'id' | 'name' | 'price'>): CartLine[] {
  const i = cart.findIndex((l) => l.productId === p.id)
  if (i === -1) return [...cart, { productId: p.id, name: p.name, quantity: 1, shownPrice: p.price }]
  return cart.map((l, j) => (j === i ? { ...l, quantity: Math.min(MAX_QTY, l.quantity + 1) } : l))
}

export function setQuantity(cart: CartLine[], productId: string, quantity: number): CartLine[] {
  if (quantity <= 0) return cart.filter((l) => l.productId !== productId)
  return cart.map((l) => (l.productId === productId ? { ...l, quantity: Math.min(MAX_QTY, quantity) } : l))
}

export function cartTotal(cart: CartLine[]): number {
  return cart.reduce((s, l) => s + l.quantity * l.shownPrice, 0)
}

export function cartUnits(cart: CartLine[]): number {
  return cart.reduce((s, l) => s + l.quantity, 0)
}

export function quantityOf(cart: CartLine[], productId: string): number {
  return cart.find((l) => l.productId === productId)?.quantity ?? 0
}

/** Productos que quedarían con stock negativo (según el stock que conoce el teléfono). */
export function negativeStockLines(cart: CartLine[], products: Pick<Product, 'id' | 'stock'>[]): CartLine[] {
  return cart.filter((l) => {
    const p = products.find((x) => x.id === l.productId)
    return p !== undefined && p.stock - l.quantity < 0
  })
}
