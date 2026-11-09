import type { BalanceReport } from '../domain/balance'
import { periodTitle } from '../domain/balance'
import { flagLabel } from '../domain/sale'
import { formatMoney } from '../../shared/money'
import { formatDateTime, formatDay, formatTime } from '../../shared/dates'

/**
 * PDF del balance (A4). jsPDF se carga recién acá (import dinámico), así no pesa en la app.
 * Usa Helvetica estándar: cubre á, é, ñ y $.
 */
export async function buildBalancePdf(r: BalanceReport, generatedBy: string): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const M = 14
  const money = (n: number) => formatMoney(n)
  let y = 16

  const lastY = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y
  const ensure = (h: number) => {
    if (y + h > 280) {
      doc.addPage()
      y = 16
    }
  }
  const heading = (text: string) => {
    ensure(16)
    doc.setFont('helvetica', 'bold').setFontSize(12).text(text, M, y)
    y += 2
  }
  const table = (head: string[], body: (string | number)[][], right: number[] = []) => {
    if (body.length === 0) {
      doc.setFont('helvetica', 'normal').setFontSize(9).text('Sin datos', M, y + 5)
      y += 10
      return
    }
    autoTable(doc, {
      startY: y + 1,
      head: [head],
      body: body.map((row) => row.map(String)),
      margin: { left: M, right: M },
      styles: { fontSize: 9, cellPadding: 1.5 },
      headStyles: { fillColor: [20, 83, 45] },
      columnStyles: Object.fromEntries(right.map((i) => [i, { halign: 'right' }])),
    })
    y = lastY() + 8
  }

  // Encabezado
  doc.setFont('helvetica', 'bold').setFontSize(15).text('CADB – Cantina – Balance', M, y)
  y += 7
  doc.setFont('helvetica', 'normal').setFontSize(11).text(periodTitle({ from: r.from, to: r.to }), M, y)
  y += 5
  doc.setFontSize(8).setTextColor(90).text(`Generado por ${generatedBy} el ${formatDateTime(r.generated_at)}`, M, y)
  doc.setTextColor(0)
  y += 6

  heading('Resumen')
  table(
    ['Concepto', 'Monto'],
    [
      ['Ingresos (ventas)', money(r.income.total)],
      ['Egresos (compras)', money(r.expenses.total)],
      ['Resultado', money(r.result)],
      ['Cantidad de ventas', r.income.count],
      ['Ticket promedio', money(r.income.average)],
    ],
    [1],
  )

  heading('Medios de pago')
  table(
    ['Medio', 'Monto', 'Ventas'],
    [
      ['Efectivo', money(r.by_method.cash), r.by_method.count_efectivo],
      ['Transferencias', money(r.by_method.transfer), r.by_method.count_transferencia],
      ['(Mixtas: se reparten entre los dos)', '', r.by_method.count_mixto],
    ],
    [1, 2],
  )

  heading('Ventas por producto')
  table(['Producto', 'Unidades', 'Monto'], r.by_product.map((p) => [p.name, p.units, money(p.amount)]), [1, 2])

  heading('Egresos (compras)')
  table(['Producto', 'Unidades', 'Gastado'], r.expenses.by_product.map((p) => [p.name, p.quantity, money(p.cost)]), [1, 2])
  if (r.misc_details.length) {
    heading('Detalle de "Varios"')
    table(['Fecha', 'Detalle', 'Usuario', 'Monto'], r.misc_details.map((m) => [formatDateTime(m.at), m.note ?? '', m.user, money(m.cost)]), [3])
  }

  if (r.supplies.length) {
    heading('Insumos')
    table(['Insumo', 'Comprados', 'Usados', 'Stock'], r.supplies.map((s) => [s.name, s.bought, s.consumed, s.stock]), [1, 2, 3])
  }

  if (r.by_day.length > 1) {
    heading('Por día')
    table(['Día', 'Ventas', 'Monto'], r.by_day.map((d) => [formatDay(d.day), d.count, money(d.amount)]), [1, 2])
  }

  heading('Por vendedor')
  table(
    ['Vendedor', 'Ventas', 'Efectivo', 'Transf.', 'Total'],
    r.by_seller.map((s) => [s.display_name ?? s.username, s.count, money(s.cash), money(s.transfer), money(s.amount)]),
    [1, 2, 3, 4],
  )

  const inc = r.incidents
  heading('Incidencias')
  table(
    ['Tipo', 'Fecha', 'Detalle', 'Usuario'],
    [
      ...inc.voids.map((v) => [
        'Venta anulada',
        formatDateTime(v.voided_at),
        `${money(v.total)} · venta de las ${formatTime(v.sale_at)} · ${v.reason}`,
        v.by_other ? `${v.voided_by} (de ${v.seller})` : v.voided_by,
      ]),
      ...inc.adjustments.map((a) => ['Ajuste de stock', formatDateTime(a.at), `${a.name} ${a.quantity > 0 ? '+' : ''}${a.quantity} · ${a.note}`, a.user]),
      ...inc.voided_entries.map((e) => ['Compra anulada', formatDateTime(e.at), `${e.name} ${e.quantity} · ${money(e.cost)} · ${e.note}`, e.user]),
      ...inc.flagged_sales.map((s) => ['Venta con marca', formatDateTime(s.at), `${money(s.total)} · ${s.flags.map(flagLabel).join(', ')}${s.status === 'anulada' ? ' · anulada' : ''}`, s.seller]),
    ],
  )

  if (r.stock_alerts.length) {
    heading('Stock bajo o negativo')
    table(['Producto', 'Stock', 'Mínimo'], r.stock_alerts.map((s) => [s.name, s.stock, s.min_stock ?? '']), [1, 2])
  }

  if (r.transfers.length) {
    heading('Anexo: transferencias (para conciliar con el banco)')
    table(
      ['Fecha', 'Últimos 4', 'Vendedor', 'Mixta', 'Monto'],
      r.transfers.map((t) => [formatDateTime(t.at), t.last4, t.seller, t.mixed ? 'Sí' : '', money(t.amount)]),
      [4],
    )
  }

  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFontSize(8).setTextColor(120).text(`Página ${i} de ${pages}`, 210 - M, 290, { align: 'right' })
  }
  return doc.output('blob')
}
