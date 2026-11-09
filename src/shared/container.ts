// Composition root: acá (y solo acá) se eligen las implementaciones de los puertos.
import { inject, type InjectionKey } from 'vue'
import type { AuthService, HistoryService, UserAdminService } from '../users/domain/ports'
import type { CatalogCache, ProductRepository } from '../inventory/domain/ports'
import type { Clock, SaleRepository } from '../sales/domain/ports'
import { SaleOutbox } from '../sales/domain/outbox'
import { SupabaseAuthService } from '../users/infra/supabase-auth-service'
import { SupabaseHistoryService, SupabaseUserAdminService } from '../users/infra/supabase-user-admin-service'
import { SupabaseProductRepository } from '../inventory/infra/supabase-product-repository'
import { IdbCatalogCache } from '../inventory/infra/idb-catalog-cache'
import { SupabaseSaleRepository } from '../sales/infra/supabase-sale-repository'
import { IdbOutboxStore } from '../sales/infra/idb-outbox-store'

export interface Services {
  clock: Clock
  auth: AuthService
  users: UserAdminService
  history: HistoryService
  products: ProductRepository
  catalog: CatalogCache
  sales: SaleRepository
  outbox: SaleOutbox
}

export function createServices(): Services {
  const clock: Clock = { now: () => new Date() }
  const sales = new SupabaseSaleRepository()
  return {
    clock,
    auth: new SupabaseAuthService(),
    users: new SupabaseUserAdminService(),
    history: new SupabaseHistoryService(),
    products: new SupabaseProductRepository(),
    catalog: new IdbCatalogCache(),
    sales,
    outbox: new SaleOutbox(new IdbOutboxStore(), sales, clock),
  }
}

export const ServicesKey: InjectionKey<Services> = Symbol('services')

export function useServices(): Services {
  const s = inject(ServicesKey)
  if (!s) throw new Error('Services no provistos')
  return s
}
