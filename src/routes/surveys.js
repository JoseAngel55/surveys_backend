import { Router } from 'express'
import { nanoid } from 'nanoid'
import supabase from '../db/supabase.js'
import { authenticate } from '../middleware/auth.js'
import { generatePDF, generateExcel } from '../utils/reportGenerator.js'

const router = Router()

// ── Helpers ───────────────────────────────────────────────────────────────────

async function checkOwnership(surveyId, user) {
  const { data, error } = await supabase
    .from('surveys').select('id, created_by').eq('id', surveyId).single()
  if (error || !data) return { allowed: false, notFound: true }
  if (user.role !== 'admin' && data.created_by !== user.id) return { allowed: false, notFound: false }
  return { allowed: true, survey: data }
}

/**
 * buildReport — estructura sincronizada con GET /reports del surveys.js original
 * Campos: total_responses, complete_responses, total_questions, avg_duration_seconds,
 *         first_response_at, last_response_at, responses_by_day, questions_summary
 */
function buildReport(survey, responses, questions) {
  const completed      = responses.filter(r => r.is_complete)
  const totalResponses = responses.length

  const byDay = {}
  responses.forEach(r => {
    const day = r.started_at?.split('T')[0]
    if (day) byDay[day] = (byDay[day] || 0) + 1
  })

  const allAnswers = responses.flatMap(r => r.answers || [])
  const questions_summary = questions.map(q => {
    const qAnswers = allAnswers.filter(a => a.question_id === q.id)
    const stats = {
      question_id: q.id, question_text: q.text, question_type: q.type,
      response_count: qAnswers.length, skip_count: totalResponses - qAnswers.length
    }

    if (['multiple_choice', 'single_choice', 'checkbox'].includes(q.type) && q.options) {
      const optionCounts = {}
      qAnswers.forEach(a => {
        const vals = Array.isArray(a.value) ? a.value : [a.value]
        vals.forEach(v => { optionCounts[v] = (optionCounts[v] || 0) + 1 })
      })
      stats.option_stats = (q.options || []).map(opt => ({
        option_id: opt.id || opt.value, option_text: opt.text,
        count: optionCounts[opt.value] || 0,
        percentage: qAnswers.length ? ((optionCounts[opt.value] || 0) / qAnswers.length) * 100 : 0
      }))
    }

    if (['scale', 'rating'].includes(q.type)) {
      const nums = qAnswers.map(a => Number(a.value)).filter(n => !isNaN(n))
      if (nums.length) {
        const sorted = [...nums].sort((a, b) => a - b)
        const mean   = nums.reduce((s, n) => s + n, 0) / nums.length
        const median = sorted.length % 2 === 0
          ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
          : sorted[Math.floor(sorted.length / 2)]
        const std_deviation = Math.sqrt(nums.reduce((s, n) => s + Math.pow(n - mean, 2), 0) / nums.length)
        stats.numeric_stats = {
          min: Math.min(...nums), max: Math.max(...nums),
          mean: Math.round(mean * 100) / 100, median,
          std_deviation: Math.round(std_deviation * 100) / 100
        }
      }
    }

    if (q.type === 'open_text') {
      stats.open_answers = qAnswers.slice(0, 20).map(a => a.value)
    }

    return stats
  })

  const avgDuration = completed.length
    ? completed.reduce((s, r) => s + (r.duration_seconds || 0), 0) / completed.length
    : 0

  return {
    survey_id:            survey.id,
    survey_title:         survey.title,
    total_responses:      totalResponses,
    complete_responses:   completed.length,
    total_questions:      questions.length,
    avg_duration_seconds: Math.round(avgDuration),
    first_response_at:    responses[responses.length - 1]?.started_at || null,
    last_response_at:     responses[0]?.started_at || null,
    responses_by_day:     Object.entries(byDay).map(([date, count]) => ({ date, count })),
    questions_summary
  }
}

async function fetchReportData(surveyId) {
  const [
    { data: survey },
    { data: responses },
    { data: questions }
  ] = await Promise.all([
    supabase.from('surveys').select('id, title, created_by').eq('id', surveyId).single(),
    supabase.from('responses').select('*, answers(*)').eq('survey_id', surveyId).order('started_at', { ascending: false }),
    supabase.from('questions').select('*').eq('survey_id', surveyId).order('order')
  ])
  return { survey, responses: responses || [], questions: questions || [] }
}

// ── SURVEYS ───────────────────────────────────────────────────────────────────

router.get('/', authenticate, async (req, res) => {
  const { page = 1, limit = 10, status, type, created_by } = req.query
  const offset = (page - 1) * limit

  let query = supabase
    .from('surveys')
    .select('*, profiles!surveys_created_by_fkey(id, name, email)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + Number(limit) - 1)

  if (req.user.role !== 'admin') query = query.eq('created_by', req.user.id)
  if (status) query = query.eq('status', status)
  if (type)   query = query.eq('type', type)
  if (created_by && req.user.role === 'admin') query = query.eq('created_by', created_by)

  const { data, error, count } = await query
  if (error) return res.status(500).json({ code: 'DB_ERROR', message: error.message })

  res.json({
    data,
    meta: {
      page: Number(page), limit: Number(limit), total: count,
      total_pages: Math.ceil(count / limit),
      has_next: offset + Number(limit) < count,
      has_prev: page > 1
    }
  })
})

router.post('/', authenticate, async (req, res) => {
  const { title, description, type = 'satisfaction', settings = {} } = req.body
  if (!title) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'title es requerido' })

  const { data, error } = await supabase.from('surveys').insert({
    title, description, type,
    settings: { allow_anonymous: true, show_progress_bar: true, randomize_questions: false, ...settings },
    created_by: req.user.id, status: 'draft'
  }).select().single()

  if (error) return res.status(500).json({ code: 'DB_ERROR', message: error.message })
  res.status(201).json(data)
})

router.get('/:surveyId', authenticate, async (req, res) => {
  const { allowed, notFound } = await checkOwnership(req.params.surveyId, req.user)
  if (notFound) return res.status(404).json({ code: 'NOT_FOUND', message: 'Encuesta no encontrada' })
  if (!allowed) return res.status(403).json({ code: 'FORBIDDEN', message: 'Sin acceso' })

  const { data, error } = await supabase
    .from('surveys').select('*, questions(*)').eq('id', req.params.surveyId).single()
  if (error || !data) return res.status(404).json({ code: 'NOT_FOUND', message: 'Encuesta no encontrada' })
  res.json(data)
})

router.put('/:surveyId', authenticate, async (req, res) => {
  const { title, description, type, settings } = req.body
  const { allowed, notFound } = await checkOwnership(req.params.surveyId, req.user)
  if (notFound) return res.status(404).json({ code: 'NOT_FOUND', message: 'Encuesta no encontrada' })
  if (!allowed) return res.status(403).json({ code: 'FORBIDDEN', message: 'Sin acceso' })

  const { data, error } = await supabase.from('surveys')
    .update({ title, description, type, settings, updated_at: new Date().toISOString() })
    .eq('id', req.params.surveyId).select().single()

  if (error) return res.status(500).json({ code: 'DB_ERROR', message: error.message })
  res.json(data)
})

router.delete('/:surveyId', authenticate, async (req, res) => {
  const { allowed, notFound } = await checkOwnership(req.params.surveyId, req.user)
  if (notFound) return res.status(404).json({ code: 'NOT_FOUND', message: 'Encuesta no encontrada' })
  if (!allowed) return res.status(403).json({ code: 'FORBIDDEN', message: 'Sin acceso' })

  await supabase.from('surveys').delete().eq('id', req.params.surveyId)
  res.status(204).send()
})

router.post('/:surveyId/publish', authenticate, async (req, res) => {
  const { data: existing } = await supabase.from('surveys')
    .select('public_token, created_by').eq('id', req.params.surveyId).single()
  if (!existing) return res.status(404).json({ code: 'NOT_FOUND', message: 'Encuesta no encontrada' })
  if (req.user.role !== 'admin' && existing.created_by !== req.user.id) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Sin acceso' })
  }

  const publicToken = existing.public_token || nanoid(12)
  const { data, error } = await supabase.from('surveys')
    .update({ status: 'active', public_token: publicToken, updated_at: new Date().toISOString() })
    .eq('id', req.params.surveyId).select().single()

  if (error || !data) return res.status(500).json({ code: 'DB_ERROR', message: error?.message })
  res.json({ ...data, public_url: `${process.env.FRONTEND_URL}/s/${publicToken}` })
})

router.post('/:surveyId/close', authenticate, async (req, res) => {
  const { allowed, notFound } = await checkOwnership(req.params.surveyId, req.user)
  if (notFound) return res.status(404).json({ code: 'NOT_FOUND', message: 'Encuesta no encontrada' })
  if (!allowed) return res.status(403).json({ code: 'FORBIDDEN', message: 'Sin acceso' })

  const { data, error } = await supabase.from('surveys')
    .update({ status: 'closed', updated_at: new Date().toISOString() })
    .eq('id', req.params.surveyId).select().single()

  if (error || !data) return res.status(500).json({ code: 'DB_ERROR', message: error?.message })
  res.json(data)
})

router.post('/:surveyId/duplicate', authenticate, async (req, res) => {
  const { data: original } = await supabase.from('surveys')
    .select('*, questions(*)').eq('id', req.params.surveyId).single()
  if (!original) return res.status(404).json({ code: 'NOT_FOUND', message: 'Encuesta no encontrada' })

  const { data: copy, error: copyError } = await supabase.from('surveys').insert({
    title: `${original.title} (copia)`, description: original.description,
    type: original.type, settings: original.settings,
    created_by: req.user.id, status: 'draft'
  }).select().single()

  if (copyError || !copy) {
    return res.status(500).json({ code: 'DB_ERROR', message: copyError?.message || 'Error al duplicar' })
  }

  if (original.questions?.length) {
    const questionsCopy = original.questions.map(({ id: _id, created_at: _ca, ...q }) => ({
      ...q, survey_id: copy.id
    }))
    await supabase.from('questions').insert(questionsCopy)
  }
  res.status(201).json(copy)
})

// ── QUESTIONS ─────────────────────────────────────────────────────────────────

router.get('/:surveyId/questions', authenticate, async (req, res) => {
  const { data, error } = await supabase.from('questions')
    .select('*').eq('survey_id', req.params.surveyId).order('order')
  if (error) return res.status(500).json({ code: 'DB_ERROR', message: error.message })
  res.json(data)
})

router.post('/:surveyId/questions', authenticate, async (req, res) => {
  const { text, type, required = false, order, options, scale_config } = req.body
  if (!text || !type) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'text y type son requeridos' })

  const { data, error } = await supabase.from('questions').insert({
    survey_id: req.params.surveyId, text, type, required, order, options, scale_config
  }).select().single()

  if (error) return res.status(500).json({ code: 'DB_ERROR', message: error.message })
  res.status(201).json(data)
})

router.put('/:surveyId/questions/:questionId', authenticate, async (req, res) => {
  const { text, type, required, order, options, scale_config } = req.body
  const { data, error } = await supabase.from('questions')
    .update({ text, type, required, order, options, scale_config })
    .eq('id', req.params.questionId).eq('survey_id', req.params.surveyId)
    .select().single()

  if (error || !data) return res.status(404).json({ code: 'NOT_FOUND', message: 'Pregunta no encontrada' })
  res.json(data)
})

router.delete('/:surveyId/questions/:questionId', authenticate, async (req, res) => {
  await supabase.from('questions')
    .delete().eq('id', req.params.questionId).eq('survey_id', req.params.surveyId)
  res.status(204).send()
})

router.patch('/:surveyId/questions/reorder', authenticate, async (req, res) => {
  const { order } = req.body
  if (!Array.isArray(order)) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'order debe ser un array de IDs' })
  }

  const rows = order.map((id, index) => ({ id, order: index + 1, survey_id: req.params.surveyId }))
  const { error } = await supabase.from('questions').upsert(rows, { onConflict: 'id' })

  if (error) return res.status(500).json({ code: 'DB_ERROR', message: error.message })
  res.json({ message: 'Orden actualizado' })
})

// ── ASSIGNMENTS ───────────────────────────────────────────────────────────────

router.get('/:surveyId/assignments', authenticate, async (req, res) => {
  const { data, error } = await supabase.from('assignments')
    .select('*, profiles(id, name, email), groups(id, name)')
    .eq('survey_id', req.params.surveyId)
  if (error) return res.status(500).json({ code: 'DB_ERROR', message: error.message })
  res.json(data)
})

router.post('/:surveyId/assignments', authenticate, async (req, res) => {
  const { user_ids = [], group_ids = [], due_date } = req.body
  const surveyId = req.params.surveyId

  const rows = [
    ...user_ids.map(uid => ({ survey_id: surveyId, user_id: uid, due_date, access_token: nanoid(16) })),
    ...group_ids.map(gid => ({ survey_id: surveyId, group_id: gid, due_date, access_token: nanoid(16) }))
  ]

  if (!rows.length) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'user_ids o group_ids requerido' })

  const { data, error } = await supabase.from('assignments').insert(rows).select()
  if (error) return res.status(500).json({ code: 'DB_ERROR', message: error.message })
  res.status(201).json(data)
})

router.delete('/:surveyId/assignments/:assignmentId', authenticate, async (req, res) => {
  await supabase.from('assignments').delete().eq('id', req.params.assignmentId)
  res.status(204).send()
})

// ── RESPONSES ─────────────────────────────────────────────────────────────────

router.get('/:surveyId/responses', authenticate, async (req, res) => {
  const { data, error } = await supabase.from('responses')
    .select('*, answers(*)').eq('survey_id', req.params.surveyId)
    .order('started_at', { ascending: false })
  if (error) return res.status(500).json({ code: 'DB_ERROR', message: error.message })
  res.json(data)
})

// GET /surveys/:surveyId/reports
router.get('/:surveyId/reports', authenticate, async (req, res) => {
  const { survey, responses, questions } = await fetchReportData(req.params.surveyId)
  if (!survey) return res.status(404).json({ code: 'NOT_FOUND', message: 'Encuesta no encontrada' })
  if (req.user.role !== 'admin' && survey.created_by !== req.user.id) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Sin acceso' })
  }
  res.json(buildReport(survey, responses, questions))
})

// ── EXPORTS ───────────────────────────────────────────────────────────────────

// GET /surveys/:surveyId/export/pdf
router.get('/:surveyId/export/pdf', authenticate, async (req, res) => {
  const { survey, responses, questions } = await fetchReportData(req.params.surveyId)
  if (!survey) return res.status(404).json({ code: 'NOT_FOUND', message: 'Encuesta no encontrada' })
  if (req.user.role !== 'admin' && survey.created_by !== req.user.id) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Sin acceso' })
  }

  try {
    generatePDF(buildReport(survey, responses, questions), res)
  } catch (err) {
    console.error('Error generando PDF:', err)
    if (!res.headersSent) res.status(500).json({ code: 'EXPORT_ERROR', message: 'Error al generar el PDF' })
  }
})

// GET /surveys/:surveyId/export/excel
router.get('/:surveyId/export/excel', authenticate, async (req, res) => {
  const { survey, responses, questions } = await fetchReportData(req.params.surveyId)
  if (!survey) return res.status(404).json({ code: 'NOT_FOUND', message: 'Encuesta no encontrada' })
  if (req.user.role !== 'admin' && survey.created_by !== req.user.id) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Sin acceso' })
  }

  try {
    await generateExcel(buildReport(survey, responses, questions), res)
  } catch (err) {
    console.error('Error generando Excel:', err)
    if (!res.headersSent) res.status(500).json({ code: 'EXPORT_ERROR', message: 'Error al generar el Excel' })
  }
})

export default router