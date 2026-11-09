import { describe, expect, it } from 'vitest'
import { autocompleteMixed, change, paymentAmounts, validatePayment } from './payment'
import { addOne, cartTotal, negativeStockLines, setQuantity } from './cart'
import { canVoidOwn } from './void-rules'
import { periodRange } from './balance'
import { addDays, localDay, monthOf, weekOf } from '../../shared/dates'
import { formatMoney, parseMoney } from '../../shared/money'
import { businessErrorFromMessage } from '../../shared/errors'

describe('pago', () => {
  it('mixto: escribir lo transferido completa el efectivo (y al revés)', () => {
    expect(autocompleteMixed(4000, 'transfer', 3000)).toEqual({ cash: 1000, transfer: 3000 })
    expect(autocompleteMixed(4000, 'cash', 1500)).toEqual({ cash: 1500, transfer: 2500 })
    expect(autocompleteMixed(4000, 'cash', 5000)).toEqual({ cash: 5000, transfer: 0 })
    expect(autocompleteMixed(4000, 'cash', null)).toEqual({ cash: null, transfer: null })
  })

  it('valida 4 dígitos y montos del mixto', () => {
    const base = { transferAmount: null, cashAmount: null, last4: '' }
    expect(validatePayment(4000, { ...base, method: 'efectivo' })).toBeNull()
    expect(validatePayment(4000, { ...base, method: 'transferencia' })).toMatch(/4 números/)
    expect(validatePayment(4000, { ...base, method: 'transferencia', last4: '123' })).toMatch(/4 números/)
    expect(validatePayment(4000, { ...base, method: 'transferencia', last4: '1234' })).toBeNull()
    const mixto = { method: 'mixto' as const, last4: '1234' }
    expect(validatePayment(4000, { ...mixto, transferAmount: 3000, cashAmount: 1000 })).toBeNull()
    expect(validatePayment(4000, { ...mixto, transferAmount: 4000, cashAmount: 0 })).toMatch(/elegí/)
    expect(validatePayment(4000, { ...mixto, transferAmount: 3000, cashAmount: 500 })).toMatch(/no suman/)
    expect(validatePayment(4000, { ...mixto, transferAmount: null, cashAmount: 1000 })).toMatch(/dos montos/)
  })

  it('montos finales y vuelto', () => {
    const p = { transferAmount: 3000, cashAmount: 1000, last4: '1234' }
    expect(paymentAmounts(4000, { ...p, method: 'mixto' })).toEqual({ cash: 1000, transfer: 3000 })
    expect(paymentAmounts(4000, { ...p, method: 'efectivo' })).toEqual({ cash: 4000, transfer: 0 })
    expect(paymentAmounts(4000, { ...p, method: 'transferencia' })).toEqual({ cash: 0, transfer: 4000 })
    expect(change(4500, 10000)).toBe(5500)
    expect(change(4500, 2000)).toBeNull()
  })
})

describe('carrito', () => {
  const coca = { id: 'c', name: 'Coca', price: 2000 }
  it('suma, cambia cantidades y calcula el total', () => {
    let cart = addOne([], coca)
    cart = addOne(cart, coca)
    expect(cart).toEqual([{ productId: 'c', name: 'Coca', quantity: 2, shownPrice: 2000 }])
    expect(cartTotal(cart)).toBe(4000)
    cart = setQuantity(cart, 'c', 0)
    expect(cart).toEqual([])
  })
  it('detecta líneas que dejarían el stock negativo', () => {
    const cart = setQuantity(addOne([], coca), 'c', 3)
    expect(negativeStockLines(cart, [{ id: 'c', stock: 2 }])).toHaveLength(1)
    expect(negativeStockLines(cart, [{ id: 'c', stock: 3 }])).toHaveLength(0)
  })
})

describe('anulación propia', () => {
  const ctx = (now: string, windowMinutes = 60) => ({ userId: 'u', now: new Date(now), windowMinutes, canVoidOwnSameDay: true })
  const sale = (createdAt: string, createdBy = 'u') => ({ createdAt, createdBy, status: 'ok' })

  it('dentro del límite y el mismo día', () => {
    expect(canVoidOwn(sale('2026-11-08T18:00:00Z'), ctx('2026-11-08T18:59:00Z'))).toBe(true)
    expect(canVoidOwn(sale('2026-11-08T18:00:00Z'), ctx('2026-11-08T19:01:00Z'))).toBe(false)
  })
  it('no anula ventas de otro ni sin permiso', () => {
    expect(canVoidOwn(sale('2026-11-08T18:00:00Z', 'otro'), ctx('2026-11-08T18:10:00Z'))).toBe(false)
    expect(canVoidOwn(sale('2026-11-08T18:00:00Z'), { ...ctx('2026-11-08T18:10:00Z'), canVoidOwnSameDay: false })).toBe(false)
  })
  it('el día cambia a medianoche de San Juan (03:00 UTC), aunque el límite sea 0', () => {
    // 23:50 en San Juan -> 00:10 del día siguiente
    expect(canVoidOwn(sale('2026-11-09T02:50:00Z'), ctx('2026-11-09T03:10:00Z', 0))).toBe(false)
    expect(canVoidOwn(sale('2026-11-09T02:50:00Z'), ctx('2026-11-09T02:59:00Z', 0))).toBe(true)
    expect(canVoidOwn(sale('2026-11-08T12:00:00Z'), ctx('2026-11-08T23:00:00Z', 0))).toBe(true)
  })
})

describe('fechas y períodos (San Juan)', () => {
  it('día local', () => {
    expect(localDay(new Date('2026-11-09T02:59:00Z'))).toBe('2026-11-08')
    expect(localDay(new Date('2026-11-09T03:00:00Z'))).toBe('2026-11-09')
  })
  it('semana de lunes a domingo y mes', () => {
    expect(weekOf('2026-11-09')).toEqual({ from: '2026-11-09', to: '2026-11-15' }) // lunes
    expect(weekOf('2026-11-08')).toEqual({ from: '2026-11-02', to: '2026-11-08' }) // domingo
    expect(monthOf('2026-12-15')).toEqual({ from: '2026-12-01', to: '2026-12-31' })
    expect(monthOf('2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
  it('último partido = último día con ventas', () => {
    expect(periodRange('partido', '2026-11-11', '2026-11-08')).toEqual({ from: '2026-11-08', to: '2026-11-08' })
    expect(periodRange('hoy', '2026-11-11', null)).toEqual({ from: '2026-11-11', to: '2026-11-11' })
  })
})

describe('dinero y errores', () => {
  it('formatea y parsea pesos', () => {
    expect(formatMoney(4500)).toBe('$ 4.500')
    expect(parseMoney('4.500')).toBe(4500)
    expect(parseMoney('$ 1200')).toBe(1200)
    expect(parseMoney('12,5')).toBeNull()
    expect(parseMoney('')).toBeNull()
  })
  it('traduce errores del servidor', () => {
    const e = businessErrorFromMessage('out_of_window: Fuera de plazo')
    expect(e.code).toBe('out_of_window')
    expect(e.message).toBe('Fuera de plazo')
    expect(businessErrorFromMessage('algo raro').code).toBe('unknown')
  })
})
