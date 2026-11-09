import { localDay } from '../../shared/dates'

export interface VoidContext {
  userId: string
  now: Date
  windowMinutes: number
  canVoidOwnSameDay: boolean
}

/**
 * Espejo de la regla de void_sale para `sales.void_own_same_day` (solo UX; decide el servidor):
 * venta propia, mismo día en San Juan y, si el límite es > 0, dentro de esos minutos.
 */
export function canVoidOwn(sale: { createdAt: string; createdBy: string; status: string }, ctx: VoidContext): boolean {
  if (!ctx.canVoidOwnSameDay || sale.status !== 'ok' || sale.createdBy !== ctx.userId) return false
  const created = new Date(sale.createdAt)
  if (localDay(created) !== localDay(ctx.now)) return false
  if (ctx.windowMinutes === 0) return true
  return ctx.now.getTime() - created.getTime() <= ctx.windowMinutes * 60_000
}

/** Hasta cuándo se puede anular (para mostrar "podés anular hasta las 15:40"). null = hasta fin del día. */
export function voidDeadline(createdAt: string, windowMinutes: number): Date | null {
  if (windowMinutes === 0) return null
  return new Date(new Date(createdAt).getTime() + windowMinutes * 60_000)
}
