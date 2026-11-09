import type { CatalogCache } from '../domain/ports'
import type { Product } from '../domain/product'
import { cacheDel, cacheGet, cacheSet } from '../../shared/local-cache'

const KEY = 'catalog'

export class IdbCatalogCache implements CatalogCache {
  async load() {
    return (await cacheGet<{ products: Product[]; savedAt: string }>(KEY)) ?? null
  }
  async save(products: Product[]) {
    await cacheSet(KEY, { products, savedAt: new Date().toISOString() })
  }
  async clear() {
    await cacheDel(KEY)
  }
}
