import type { SaleRepository } from '../domain/ports'
import type { RegisterSaleCommand, Sale, VoidSaleCommand } from '../domain/sale'
import type { BalanceReport } from '../domain/balance'
import type { PaymentMethod } from '../domain/payment'
import { rpc, select, supabase } from '../../shared/supabase-client'
import { addDays, dayStartIso, localDay, type Day } from '../../shared/dates'

interface SaleJson {
  id: string
  total: number
  payment_method: PaymentMethod
  cash_amount: number
  transfer_amount: number
  transfer_last4: string | null
  status: 'ok' | 'anulada'
  flags: string[]
  created_at: string
  created_by: string
  voided_at: string | null
  void_reason: string | null
}

interface SaleRow extends SaleJson {
  profiles?: { username: string; display_name: string | null } | null
  sale_items?: { product_id: string; quantity: number; unit_price: number; products: { name: string } | null }[]
}

const SALE_COLUMNS =
  'id,total,payment_method,cash_amount,transfer_amount,transfer_last4,status,flags,created_at,created_by,voided_at,void_reason,' +
  'profiles!sales_created_by_fkey(username,display_name),sale_items(product_id,quantity,unit_price,products(name))'

function toSale(r: SaleRow): Sale {
  return {
    id: r.id,
    total: r.total,
    paymentMethod: r.payment_method,
    cashAmount: r.cash_amount,
    transferAmount: r.transfer_amount,
    transferLast4: r.transfer_last4,
    status: r.status,
    flags: r.flags ?? [],
    createdAt: r.created_at,
    createdBy: r.created_by,
    voidedAt: r.voided_at,
    voidReason: r.void_reason,
    sellerName: r.profiles ? (r.profiles.display_name ?? r.profiles.username) : undefined,
    items: r.sale_items?.map((i) => ({ productId: i.product_id, name: i.products?.name ?? '', quantity: i.quantity, unitPrice: i.unit_price })),
  }
}

export class SupabaseSaleRepository implements SaleRepository {
  async register(cmd: RegisterSaleCommand): Promise<Sale> {
    const r = await rpc<SaleJson>('register_sale', {
      p_sale_id: cmd.id,
      p_items: cmd.items.map((l) => ({ product_id: l.productId, quantity: l.quantity, shown_price: l.shownPrice })),
      p_payment: cmd.payment,
      p_transfer_amount: cmd.payment === 'mixto' ? cmd.transferAmount : null,
      p_last4: cmd.payment === 'efectivo' ? null : cmd.last4,
      p_device_created_at: cmd.deviceCreatedAt,
      p_client_total: cmd.clientTotal,
    })
    return toSale(r)
  }

  async void(cmd: VoidSaleCommand): Promise<Sale> {
    const r = await rpc<SaleJson>('void_sale', {
      p_sale_id: cmd.saleId,
      p_reason: cmd.reason,
      p_device_voided_at: cmd.deviceVoidedAt,
    })
    return toSale(r)
  }

  async listMineToday(): Promise<Sale[]> {
    const { data: auth } = await supabase.auth.getSession()
    const uid = auth.session?.user.id
    if (!uid) return []
    const today = localDay(new Date())
    const rows = await select<SaleRow[]>(
      supabase
        .from('sales')
        .select(SALE_COLUMNS)
        .eq('created_by', uid)
        .gte('created_at', dayStartIso(today))
        .order('created_at', { ascending: false }),
    )
    return rows.map(toSale)
  }

  async listSales(filter: { from: Day; to: Day; onlyFlagged?: boolean }): Promise<Sale[]> {
    let q = supabase
      .from('sales')
      .select(SALE_COLUMNS)
      .gte('created_at', dayStartIso(filter.from))
      .lt('created_at', dayStartIso(addDays(filter.to, 1)))
      .order('created_at', { ascending: false })
      .limit(500)
    if (filter.onlyFlagged) q = q.neq('flags', '{}')
    return (await select<SaleRow[]>(q)).map(toSale)
  }

  async balance(from: Day, to: Day): Promise<BalanceReport> {
    return rpc<BalanceReport>('balance_report', { p_from: from, p_to: to })
  }

  async lastSaleDay(): Promise<Day | null> {
    return rpc<Day | null>('last_sale_day')
  }
}
