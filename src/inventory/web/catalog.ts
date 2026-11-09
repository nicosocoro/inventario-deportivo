import { reactive } from 'vue'
import type { Services } from '../../shared/container'
import type { Product } from '../domain/product'
import { NetworkError } from '../../shared/errors'

/** Catálogo en memoria + copia en el teléfono para usar sin señal. */
export const catalog = reactive({
  products: [] as Product[],
  savedAt: null as string | null,
  loading: false,
  error: null as string | null,
})

export async function loadCatalogFromCache(services: Services) {
  const cached = await services.catalog.load()
  if (cached && catalog.products.length === 0) {
    catalog.products = cached.products
    catalog.savedAt = cached.savedAt
  }
}

export async function refreshCatalog(services: Services): Promise<void> {
  if (!navigator.onLine) return
  catalog.loading = true
  try {
    const products = await services.products.list()
    catalog.products = products
    catalog.savedAt = new Date().toISOString()
    catalog.error = null
    await services.catalog.save(products)
  } catch (e) {
    if (!(e instanceof NetworkError)) catalog.error = (e as Error).message
  } finally {
    catalog.loading = false
  }
}
