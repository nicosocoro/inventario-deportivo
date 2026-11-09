// Pesos enteros.
const fmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0, minimumFractionDigits: 0 })

export function formatMoney(amount: number): string {
  return fmt.format(amount).replace(/ /g, ' ')
}

/** "4.500", "$ 4500", "4500" -> 4500. Devuelve null si no es un entero >= 0. */
export function parseMoney(raw: string): number | null {
  const digits = raw.replace(/[$\s.]/g, '')
  if (!/^\d{1,9}$/.test(digits)) return null
  return Number(digits)
}
