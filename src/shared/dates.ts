// Fechas en la zona del club. Los días se representan como 'YYYY-MM-DD'.
export const TZ = 'America/Argentina/San_Juan'

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
const timeFmt = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
const dateTimeFmt = new Intl.DateTimeFormat('es-AR', {
  timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
})
const longDayFmt = new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit' })

export type Day = string

export function localDay(d: Date | string): Day {
  return dayFmt.format(typeof d === 'string' ? new Date(d) : d)
}

export function formatTime(d: Date | string): string {
  return timeFmt.format(typeof d === 'string' ? new Date(d) : d)
}

export function formatDateTime(d: Date | string): string {
  return dateTimeFmt.format(typeof d === 'string' ? new Date(d) : d)
}

/** 'lun 09/11' */
export function formatDay(day: Day): string {
  return longDayFmt.format(new Date(`${day}T12:00:00Z`))
}

export function addDays(day: Day, n: number): Day {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 0 = lunes ... 6 = domingo */
function weekdayMon0(day: Day): number {
  return (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7
}

export interface DayRange {
  from: Day
  to: Day
}

export function weekOf(day: Day): DayRange {
  const from = addDays(day, -weekdayMon0(day))
  return { from, to: addDays(from, 6) }
}

export function monthOf(day: Day): DayRange {
  const [y, m] = day.split('-').map(Number)
  const from = `${y}-${String(m).padStart(2, '0')}-01`
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  return { from, to: addDays(next, -1) }
}

export function isValidDay(s: string): s is Day {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T12:00:00Z`).getTime()) &&
    new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s
}

/** Inicio del día local expresado en UTC. San Juan está en UTC-3 todo el año (sin horario de verano). */
export function dayStartIso(day: Day): string {
  return `${day}T03:00:00.000Z`
}
