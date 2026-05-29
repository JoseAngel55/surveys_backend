import { Router } from 'express'
import supabase from '../db/supabase.js'

const router = Router()

// GET /public/surveys/:token  — Obtener encuesta pública por token
router.get('/surveys/:token', async (req, res) => {
  const { data: survey, error } = await supabase
    .from('surveys')
    .select('*, questions(*)')
    .eq('public_token', req.params.token)
    .eq('status', 'active')
    .single()

  if (error || !survey) {
    return res.status(404).json({ code: 'NOT_FOUND', message: 'Encuesta no encontrada o no disponible' })
  }

  // Sort questions by order
  survey.questions?.sort((a, b) => (a.order || 0) - (b.order || 0))

  // Check if already responded (by IP as simple guard for anonymous)
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress
  const { data: existing } = await supabase.from('responses')
    .select('id').eq('survey_id', survey.id).eq('respondent_ip', clientIp).limit(1)

  res.json({
    id: survey.id,
    title: survey.title,
    description: survey.description,
    type: survey.type,
    settings: {
      allow_anonymous: survey.settings?.allow_anonymous ?? true,
      show_progress_bar: survey.settings?.show_progress_bar ?? true,
      time_limit_minutes: survey.settings?.time_limit_minutes ?? null,
      confirmation_message: survey.settings?.confirmation_message ?? '¡Gracias por tu respuesta!'
    },
    questions: survey.questions || [],
    already_responded: (existing?.length || 0) > 0
  })
})

// POST /public/surveys/:token/respond  — Enviar respuesta
router.post('/surveys/:token/respond', async (req, res) => {
  const { respondent_name, respondent_email, answers = [], started_at } = req.body
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress

  const { data: survey } = await supabase
    .from('surveys').select('id, status, settings')
    .eq('public_token', req.params.token).single()

  if (!survey) return res.status(404).json({ code: 'NOT_FOUND', message: 'Encuesta no encontrada' })
  if (survey.status !== 'active') return res.status(400).json({ code: 'SURVEY_CLOSED', message: 'Esta encuesta ya no está activa' })

  // Validate time limit if configured
  const timeLimit = survey.settings?.time_limit_minutes
  if (timeLimit && started_at) {
    const elapsed = (new Date() - new Date(started_at)) / 1000 / 60
    if (elapsed > timeLimit) {
      return res.status(400).json({ code: 'TIME_EXPIRED', message: 'El tiempo límite de la encuesta ha expirado' })
    }
  }

  const completedAt = new Date()
  // Use started_at sent from frontend (when user first opened the survey)
  // Fallback: 0 duration if not provided
  const surveyStartedAt = started_at ? new Date(started_at) : completedAt
  const duration = Math.max(0, Math.round((completedAt - surveyStartedAt) / 1000))

  const { data: response, error } = await supabase.from('responses').insert({
    survey_id: survey.id,
    respondent_name: respondent_name || null,
    respondent_email: respondent_email || null,
    respondent_ip: clientIp,
    is_complete: true,
    started_at: surveyStartedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    duration_seconds: duration
  }).select().single()

  if (error) return res.status(500).json({ code: 'DB_ERROR', message: error.message })

  if (answers.length) {
    const answerRows = answers.map(a => ({
      response_id: response.id,
      question_id: a.question_id,
      value: typeof a.value === 'object' ? JSON.stringify(a.value) : String(a.value)
    }))
    await supabase.from('answers').insert(answerRows)
  }

  res.status(201).json({
    response_id: response.id,
    message: survey.settings?.confirmation_message || '¡Gracias por tu respuesta!'
  })
})

export default router