import type { ProductRepository } from '../domain/ports'
import type { MovementType, PriceChange, Product, ProductDraft, StockMovement } from '../domain/product'
import { rpc, select, supabase } from '../../shared/supabase-client'
import { addDays, dayStartIso } from '../../shared/dates'

interface ProductRow {
  id: string
  name: string
  price: number
  stock: number
  for_sale: boolean
  requires_note: boolean
  min_stock: number | null
  sort_order: number
  active: boolean
}

const toProduct = (r: ProductRow): Product => ({
  id: r.id,
  name: r.name,
  price: r.price,
  stock: r.stock,
  forSale: r.for_sale,
  requiresNote: r.requires_note,
  minStock: r.min_stock,
  sortOrder: r.sort_order,
  active: r.active,
})

export class SupabaseProductRepository implements ProductRepository {
  async list(): Promise<Product[]> {
    const rows = await select<ProductRow[]>(
      supabase.from('products').select('id,name,price,stock,for_sale,requires_note,min_stock,sort_order,active').order('sort_order').order('name'),
    )
    return rows.map(toProduct)
  }

  async create(d: ProductDraft): Promise<string> {
    const id = await rpc<string>('create_product', {
      p_name: d.name,
      p_price: d.price,
      p_for_sale: d.forSale,
      p_requires_note: d.requiresNote,
      p_min_stock: d.minStock,
      p_sort_order: d.sortOrder,
    })
    if (!d.active) await this.update(id, d)
    return id
  }

  async update(id: string, d: Omit<ProductDraft, 'price'>): Promise<void> {
    await rpc('update_product', {
      p_id: id,
      p_name: d.name,
      p_for_sale: d.forSale,
      p_requires_note: d.requiresNote,
      p_min_stock: d.minStock,
      p_sort_order: d.sortOrder,
      p_active: d.active,
    })
  }

  async setPrice(id: string, price: number): Promise<void> {
    await rpc('set_price', { p_product_id: id, p_price: price })
  }

  async priceHistory(id: string): Promise<PriceChange[]> {
    const rows = await select<{ product_id: string; price: number; valid_from: string; changed_by: string | null }[]>(
      supabase.from('price_history').select('product_id,price,valid_from,changed_by').eq('product_id', id).order('valid_from', { ascending: false }),
    )
    return rows.map((r) => ({ productId: r.product_id, price: r.price, validFrom: r.valid_from, changedBy: r.changed_by }))
  }

  async addStock(opId: string, productId: string, quantity: number, totalCost: number, note: string | null) {
    await rpc('add_stock', { p_id: opId, p_product_id: productId, p_quantity: quantity, p_total_cost: totalCost, p_note: note })
  }

  async consumeStock(opId: string, productId: string, quantity: number, note: string | null) {
    await rpc('consume_stock', { p_id: opId, p_product_id: productId, p_quantity: quantity, p_note: note })
  }

  async adjustStock(opId: string, productId: string, delta: number, note: string) {
    await rpc('adjust_stock', { p_id: opId, p_product_id: productId, p_delta: delta, p_note: note })
  }

  async voidEntry(movementId: string, note: string) {
    await rpc('void_stock_entry', { p_movement_id: movementId, p_note: note })
  }

  async listMovements(filter: { from?: string; to?: string; productId?: string; types?: string[]; limit?: number }): Promise<StockMovement[]> {
    let q = supabase
      .from('stock_movements')
      .select('id,product_id,type,quantity,total_cost,note,created_by,created_at,reverses_id,products(name)')
      .order('created_at', { ascending: false })
      .limit(filter.limit ?? 100)
    if (filter.from) q = q.gte('created_at', dayStartIso(filter.from))
    if (filter.to) q = q.lt('created_at', dayStartIso(addDays(filter.to, 1)))
    if (filter.productId) q = q.eq('product_id', filter.productId)
    if (filter.types?.length) q = q.in('type', filter.types)
    type Row = {
      id: string
      product_id: string
      type: MovementType
      quantity: number
      total_cost: number | null
      note: string | null
      created_by: string
      created_at: string
      reverses_id: string | null
      products: { name: string } | null
    }
    const rows = await select<Row[]>(q)
    const reversed = new Set(rows.map((r) => r.reverses_id).filter(Boolean))
    // Las anulaciones pueden haber quedado fuera de la página: consultar las que faltan.
    const entries = rows.filter((r) => r.type === 'entrada').map((r) => r.id)
    if (entries.length) {
      const revs = await select<{ reverses_id: string }[]>(supabase.from('stock_movements').select('reverses_id').in('reverses_id', entries))
      for (const r of revs) reversed.add(r.reverses_id)
    }
    return rows.map((r) => ({
      id: r.id,
      productId: r.product_id,
      productName: r.products?.name ?? '',
      type: r.type,
      quantity: r.quantity,
      totalCost: r.total_cost,
      note: r.note,
      createdBy: r.created_by,
      createdAt: r.created_at,
      reversed: reversed.has(r.id),
    }))
  }
}
