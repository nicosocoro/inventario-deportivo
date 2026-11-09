import type { PriceChange, Product, ProductDraft, StockMovement } from './product'

export interface ProductRepository {
  list(): Promise<Product[]>
  create(draft: ProductDraft): Promise<string>
  update(id: string, draft: Omit<ProductDraft, 'price'>): Promise<void>
  setPrice(id: string, price: number): Promise<void>
  priceHistory(id: string): Promise<PriceChange[]>
  /** `opId` lo genera el cliente: reintentar no duplica. */
  addStock(opId: string, productId: string, quantity: number, totalCost: number, note: string | null): Promise<void>
  consumeStock(opId: string, productId: string, quantity: number, note: string | null): Promise<void>
  adjustStock(opId: string, productId: string, delta: number, note: string): Promise<void>
  voidEntry(movementId: string, note: string): Promise<void>
  /** Movimientos visibles para el usuario (propios del día, o todos con history.view). */
  listMovements(filter: { from?: string; to?: string; productId?: string; types?: string[]; limit?: number }): Promise<StockMovement[]>
}

/** Copia local del catálogo para usar sin señal. */
export interface CatalogCache {
  load(): Promise<{ products: Product[]; savedAt: string } | null>
  save(products: Product[]): Promise<void>
  clear(): Promise<void>
}
