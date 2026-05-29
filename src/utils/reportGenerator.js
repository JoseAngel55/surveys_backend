import PDFDocument from 'pdfkit'
import ExcelJS from 'exceljs'

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(seconds) {
  if (!seconds) return 'N/A'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function formatDate(iso) {
  if (!iso) return 'N/A'
  return new Date(iso).toLocaleString('es-MX', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

// ── PDF ──────────────────────────────────────────────────────────────────────

/**
 * Generates a survey report PDF and pipes it to `res`.
 * @param {Object} report  — result of GET /surveys/:id/reports
 * @param {import('express').Response} res
 */
export function generatePDF(report, res) {
  const doc = new PDFDocument({ margin: 50, size: 'A4' })

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="reporte-${report.survey_id}.pdf"`
  )
  doc.pipe(res)

  const BRAND   = '#4F46E5'   // indigo
  const DARK    = '#111827'
  const MUTED   = '#6B7280'
  const LIGHT   = '#F3F4F6'
  const PAGE_W  = doc.page.width - 100  // usable width

  // ── Cover / Header ──────────────────────────────────────────────────────
  doc.rect(0, 0, doc.page.width, 110).fill(BRAND)

  doc.fillColor('#FFFFFF').fontSize(22).font('Helvetica-Bold')
     .text('Reporte de Encuesta', 50, 30)

  doc.fontSize(13).font('Helvetica')
     .text(report.survey_title, 50, 58, { width: PAGE_W })

  doc.fontSize(9).fillColor('#C7D2FE')
     .text(`Generado el ${formatDate(new Date().toISOString())}`, 50, 88)

  // ── Summary boxes ───────────────────────────────────────────────────────
  let y = 130
  const boxes = [
    { label: 'Asignaciones',     value: report.total_assigned },
    { label: 'Respuestas',       value: report.total_responses },
    { label: 'Tasa completado',  value: `${report.completion_rate}%` },
    { label: 'Duración promedio',value: formatDuration(report.avg_duration_seconds) },
  ]
  const bw = (PAGE_W - 30) / 4
  boxes.forEach((b, i) => {
    const x = 50 + i * (bw + 10)
    doc.roundedRect(x, y, bw, 60, 6).fill(LIGHT)
    doc.fillColor(BRAND).fontSize(20).font('Helvetica-Bold')
       .text(String(b.value), x, y + 10, { width: bw, align: 'center' })
    doc.fillColor(MUTED).fontSize(8).font('Helvetica')
       .text(b.label, x, y + 36, { width: bw, align: 'center' })
  })

  // ── Activity timeline ───────────────────────────────────────────────────
  y += 80
  doc.fillColor(DARK).fontSize(13).font('Helvetica-Bold')
     .text('Actividad por día', 50, y)

  y += 18
  if (report.responses_by_day?.length) {
    const maxCount = Math.max(...report.responses_by_day.map(d => d.count))
    const BAR_MAX_H = 50
    const sorted = [...report.responses_by_day].sort((a, b) => a.date.localeCompare(b.date))
    const barW = Math.min(30, (PAGE_W - 10) / sorted.length - 4)

    sorted.forEach((d, i) => {
      const bh = maxCount ? Math.max(4, (d.count / maxCount) * BAR_MAX_H) : 4
      const x = 50 + i * (barW + 4)
      const barY = y + BAR_MAX_H - bh

      doc.roundedRect(x, barY, barW, bh, 2).fill(BRAND)

      doc.fillColor(DARK).fontSize(7).font('Helvetica')
         .text(String(d.count), x, barY - 10, { width: barW, align: 'center' })

      doc.fillColor(MUTED).fontSize(6)
         .text(d.date.slice(5), x, y + BAR_MAX_H + 2, { width: barW, align: 'center' })
    })
    y += BAR_MAX_H + 22
  } else {
    doc.fillColor(MUTED).fontSize(10).font('Helvetica')
       .text('Sin datos de actividad aún.', 50, y)
    y += 16
  }

  // ── Questions summary ───────────────────────────────────────────────────
  y += 14
  doc.fillColor(DARK).fontSize(13).font('Helvetica-Bold')
     .text('Resumen por pregunta', 50, y)
  y += 18

  ;(report.questions_summary || []).forEach((q, idx) => {
    // Auto page-break
    if (y > doc.page.height - 130) { doc.addPage(); y = 50 }

    // Question header
    doc.roundedRect(50, y, PAGE_W, 24, 4).fill(BRAND)
    doc.fillColor('#FFFFFF').fontSize(9).font('Helvetica-Bold')
       .text(`${idx + 1}. ${q.question_text}`, 58, y + 7, { width: PAGE_W - 16 })
    y += 28

    doc.fillColor(MUTED).fontSize(8).font('Helvetica')
       .text(`Tipo: ${q.question_type}   |   Respuestas: ${q.response_count}   |   Sin responder: ${q.skip_count}`, 50, y)
    y += 14

    // Option stats (bar chart style)
    if (q.option_stats?.length) {
      q.option_stats.forEach(opt => {
        if (y > doc.page.height - 60) { doc.addPage(); y = 50 }

        const pct = Math.round(opt.percentage)
        const barLen = (pct / 100) * (PAGE_W - 120)

        doc.fillColor(DARK).fontSize(8).font('Helvetica')
           .text(opt.option_text, 50, y, { width: 120, ellipsis: true })

        doc.roundedRect(175, y + 1, Math.max(2, barLen), 9, 2).fill('#C7D2FE')

        doc.fillColor(DARK).fontSize(8)
           .text(`${opt.count} (${pct}%)`, 178 + Math.max(2, barLen), y, { width: 60 })

        y += 16
      })
    }

    // Numeric stats
    if (q.numeric_stats) {
      const ns = q.numeric_stats
      const stats = [
        `Min: ${ns.min}`, `Máx: ${ns.max}`,
        `Media: ${ns.mean}`, `Mediana: ${ns.median}`,
        `Desv. std: ${ns.std_deviation}`
      ].join('   |   ')
      doc.fillColor(MUTED).fontSize(8).font('Helvetica').text(stats, 50, y)
      y += 14
    }

    // Open-text answers (first 10)
    if (q.open_answers?.length) {
      q.open_answers.slice(0, 10).forEach(ans => {
        if (y > doc.page.height - 50) { doc.addPage(); y = 50 }
        doc.roundedRect(50, y, PAGE_W, 14, 2).fill(LIGHT)
        doc.fillColor(DARK).fontSize(8).font('Helvetica')
           .text(`• ${ans}`, 56, y + 3, { width: PAGE_W - 12, ellipsis: true })
        y += 18
      })
      if (q.open_answers.length > 10) {
        doc.fillColor(MUTED).fontSize(7)
           .text(`… y ${q.open_answers.length - 10} respuestas más`, 50, y)
        y += 12
      }
    }

    y += 14  // spacing between questions
  })

  // ── Footer ──────────────────────────────────────────────────────────────
  const range = report.first_response_at
    ? `Primera respuesta: ${formatDate(report.first_response_at)}   |   Última: ${formatDate(report.last_response_at)}`
    : 'Sin respuestas registradas'

  doc.fillColor(MUTED).fontSize(8).text(range, 50, doc.page.height - 40, {
    width: PAGE_W, align: 'center'
  })

  doc.end()
}

// ── Excel ─────────────────────────────────────────────────────────────────────

/**
 * Generates a survey report Excel file and pipes it to `res`.
 * @param {Object} report
 * @param {import('express').Response} res
 */
export async function generateExcel(report, res) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'SurveyApp'
  wb.created = new Date()

  const BRAND_HEX  = 'FF4F46E5'
  const LIGHT_HEX  = 'FFF3F4F6'
  const HEADER_HEX = 'FF1E1B4B'

  // ── Sheet 1: Resumen ─────────────────────────────────────────────────────
  const sum = wb.addWorksheet('Resumen', { tabColor: { argb: BRAND_HEX } })

  sum.mergeCells('A1:D1')
  sum.getCell('A1').value = `Reporte: ${report.survey_title}`
  sum.getCell('A1').font  = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } }
  sum.getCell('A1').fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_HEX } }
  sum.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' }
  sum.getRow(1).height = 36

  const kpis = [
    ['Encuesta', report.survey_title],
    ['ID',       report.survey_id],
    ['Asignaciones totales', report.total_assigned],
    ['Total respuestas',     report.total_responses],
    ['Tasa de completado',  `${report.completion_rate}%`],
    ['Duración promedio',   formatDuration(report.avg_duration_seconds)],
    ['Primera respuesta',   formatDate(report.first_response_at)],
    ['Última respuesta',    formatDate(report.last_response_at)],
    ['Generado',            formatDate(new Date().toISOString())],
  ]

  kpis.forEach(([label, value], i) => {
    const row = sum.getRow(i + 3)
    row.getCell(1).value = label
    row.getCell(2).value = value
    row.getCell(1).font  = { bold: true, color: { argb: HEADER_HEX } }
    row.getCell(1).fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_HEX } }
    row.height = 20
  })

  sum.getColumn(1).width = 28
  sum.getColumn(2).width = 40

  // ── Sheet 2: Actividad por día ────────────────────────────────────────────
  const actSheet = wb.addWorksheet('Actividad por día', { tabColor: { argb: BRAND_HEX } })

  const actHeaders = ['Fecha', 'Respuestas']
  const actHeaderRow = actSheet.getRow(1)
  actHeaders.forEach((h, i) => {
    const cell = actHeaderRow.getCell(i + 1)
    cell.value = h
    cell.font  = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_HEX } }
    cell.alignment = { horizontal: 'center' }
  })
  actHeaderRow.height = 22

  const sortedDays = [...(report.responses_by_day || [])].sort((a, b) => a.date.localeCompare(b.date))
  sortedDays.forEach((d, i) => {
    const row = actSheet.getRow(i + 2)
    row.getCell(1).value = d.date
    row.getCell(2).value = d.count
    if (i % 2 === 0) {
      row.eachCell(c => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_HEX } }
      })
    }
  })

  actSheet.getColumn(1).width = 16
  actSheet.getColumn(2).width = 16

  // Chart for activity
  if (sortedDays.length > 0) {
    const chart = wb.addChart('bar', { style: 2 })
    chart.title.name = 'Respuestas por día'
    chart.setBarStyle({ grouping: 'clustered', dir: 'col' })
    chart.addSeries({
      name: 'Respuestas',
      labels: { data: { type: 'formula', value: `'Actividad por día'!$A$2:$A$${sortedDays.length + 1}` } },
      values: { data: { type: 'formula', value: `'Actividad por día'!$B$2:$B$${sortedDays.length + 1}` } },
    })
    chart.plot.area = { start: { col: 3, row: 0 }, end: { col: 9, row: 15 } }
    actSheet.addChart(chart, 'D2')
  }

  actSheet.autoFilter = 'A1:B1'

  // ── Sheet 3: Preguntas – opciones ─────────────────────────────────────────
  const qSheet = wb.addWorksheet('Preguntas', { tabColor: { argb: BRAND_HEX } })

  const qHeaders = ['#', 'Pregunta', 'Tipo', 'Respuestas', 'Sin responder', 'Opción', 'Conteo', '%']
  const qHeaderRow = qSheet.getRow(1)
  qHeaders.forEach((h, i) => {
    const cell = qHeaderRow.getCell(i + 1)
    cell.value = h
    cell.font  = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_HEX } }
    cell.alignment = { horizontal: 'center', wrapText: true }
  })
  qHeaderRow.height = 26

  let qRow = 2
  ;(report.questions_summary || []).forEach((q, idx) => {
    if (q.option_stats?.length) {
      q.option_stats.forEach((opt, oi) => {
        const row = qSheet.getRow(qRow++)
        if (oi === 0) {
          row.getCell(1).value = idx + 1
          row.getCell(2).value = q.question_text
          row.getCell(3).value = q.question_type
          row.getCell(4).value = q.response_count
          row.getCell(5).value = q.skip_count
        }
        row.getCell(6).value = opt.option_text
        row.getCell(7).value = opt.count
        row.getCell(8).value = opt.percentage / 100
        row.getCell(8).numFmt = '0.0%'
        if (idx % 2 === 0) {
          row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_HEX } } })
        }
      })
    } else {
      const row = qSheet.getRow(qRow++)
      row.getCell(1).value = idx + 1
      row.getCell(2).value = q.question_text
      row.getCell(3).value = q.question_type
      row.getCell(4).value = q.response_count
      row.getCell(5).value = q.skip_count
      row.getCell(6).value = q.numeric_stats
        ? `Media: ${q.numeric_stats.mean}  Mediana: ${q.numeric_stats.median}  Min: ${q.numeric_stats.min}  Máx: ${q.numeric_stats.max}`
        : (q.open_answers?.length ? `${q.open_answers.length} respuestas abiertas` : '—')
      if (idx % 2 === 0) {
        row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_HEX } } })
      }
    }
  })

  qSheet.getColumn(1).width = 5
  qSheet.getColumn(2).width = 40
  qSheet.getColumn(3).width = 18
  qSheet.getColumn(4).width = 14
  qSheet.getColumn(5).width = 14
  qSheet.getColumn(6).width = 30
  qSheet.getColumn(7).width = 10
  qSheet.getColumn(8).width = 10
  qSheet.autoFilter = 'A1:H1'

  // ── Sheet 4: Respuestas abiertas ──────────────────────────────────────────
  const openQs = (report.questions_summary || []).filter(q => q.open_answers?.length)
  if (openQs.length) {
    const openSheet = wb.addWorksheet('Respuestas abiertas', { tabColor: { argb: BRAND_HEX } })
    const oHeaders = ['Pregunta', 'Respuesta']
    const oHeaderRow = openSheet.getRow(1)
    oHeaders.forEach((h, i) => {
      const cell = oHeaderRow.getCell(i + 1)
      cell.value = h
      cell.font  = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_HEX } }
    })
    oHeaderRow.height = 22

    let oRow = 2
    openQs.forEach((q, qi) => {
      q.open_answers.forEach(ans => {
        const row = openSheet.getRow(oRow++)
        row.getCell(1).value = q.question_text
        row.getCell(2).value = ans
        if (qi % 2 === 0) {
          row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_HEX } } })
        }
      })
    })

    openSheet.getColumn(1).width = 40
    openSheet.getColumn(2).width = 60
    openSheet.autoFilter = 'A1:B1'
  }

  // ── Stream ───────────────────────────────────────────────────────────────
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="reporte-${report.survey_id}.xlsx"`
  )
  await wb.xlsx.write(res)
  res.end()
}