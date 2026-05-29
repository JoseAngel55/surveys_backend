import { Router } from 'express'
import supabase from '../db/supabase.js'

const router = Router()

// GET /public/a/:token — Obtener encuesta asignada por token único de asignación
router.get('/:token', async (req, res) => {
  const { token } = req.params

  // Buscar la asignación por access_token
  const { data: assignment, error: assignErr } = await supabase
    .from('assignments')
    .select('*, surveys(*, questions(*))')
    .eq('access_token', token)
    .single()

  if (assignErr || !assignment) {
    return res.status(404).json({ code: 'NOT_FOUND', message: 'Enlace de encuesta no encontrado' })
  }

  // Verificar si ya fue completada
  if (assignment.completed_at) {
    return res.status(410).json({ code: 'ALREADY_COMPLETED', message: 'Esta encuesta ya fue respondida' })
  }

  // Verificar vencimiento
  if (assignment.due_date && new Date(assignment.due_date) < new Date()) {
    return res.status(410).json({ code: 'EXPIRED', message: 'El plazo de esta encuesta ha vencido' })
  }

  const survey = assignment.surveys
  if (!survey || survey.status !== 'active') {
    return res.status(410).json({ code: 'SURVEY_CLOSED', message: 'Esta encuesta ya no está activa' })
  }

  // Ordenar preguntas
  survey.questions?.sort((a, b) => (a.order || 0) - (b.order || 0))

  // Obtener info del usuario asignado si existe
  let respondentInfo = {}
  if (assignment.user_id) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('name, email')
      .eq('id', assignment.user_id)
      .single()
    if (profile) respondentInfo = profile
  }

  res.json({
    assignment_id: assignment.id,
    survey_id: survey.id,
    title: survey.title,
    description: survey.description,
    type: survey.type,
    due_date: assignment.due_date,
    settings: {
      allow_anonymous: survey.settings?.allow_anonymous ?? false,
      show_progress_bar: survey.settings?.show_progress_bar ?? true,
      time_limit_minutes: survey.settings?.time_limit_minutes ?? null,
      confirmation_message: survey.settings?.confirmation_message ?? '¡Gracias por tu respuesta!'
    },
    questions: survey.questions || [],
    respondent: respondentInfo
  })
})

// POST /public/a/:token/respond — Enviar respuesta a encuesta asignada
router.post('/:token/respond', async (req, res) => {
  const { token } = req.params
  const { respondent_name, respondent_email, answers = [], started_at } = req.body

  // Buscar asignación
  const { data: assignment, error: assignErr } = await supabase
    .from('assignments')
    .select('*, surveys(id, status, settings)')
    .eq('access_token', token)
    .single()

  if (assignErr || !assignment) {
    return res.status(404).json({ code: 'NOT_FOUND', message: 'Enlace no encontrado' })
  }

  // Validaciones de estado
  if (assignment.completed_at) {
    return res.status(410).json({ code: 'ALREADY_COMPLETED', message: 'Esta encuesta ya fue respondida' })
  }
  if (assignment.due_date && new Date(assignment.due_date) < new Date()) {
    return res.status(410).json({ code: 'EXPIRED', message: 'El plazo de esta encuesta ha vencido' })
  }

  const survey = assignment.surveys
  if (!survey || survey.status !== 'active') {
    return res.status(410).json({ code: 'SURVEY_CLOSED', message: 'Esta encuesta ya no está activa' })
  }

  // Validar límite de tiempo si aplica
  const timeLimit = survey.settings?.time_limit_minutes
  if (timeLimit && started_at) {
    const elapsed = (new Date() - new Date(started_at)) / 1000 / 60
    if (elapsed > timeLimit) {
      return res.status(400).json({ code: 'TIME_EXPIRED', message: 'El tiempo límite ha expirado' })
    }
  }

  const completedAt = new Date()
  const surveyStartedAt = started_at ? new Date(started_at) : completedAt
  const duration = Math.max(0, Math.round((completedAt - surveyStartedAt) / 1000))

  // Obtener info del usuario asignado
  let finalName = respondent_name || null
  let finalEmail = respondent_email || null
  if (assignment.user_id) {
    const { data: profile } = await supabase
      .from('profiles').select('name, email').eq('id', assignment.user_id).single()
    if (profile) { finalName = finalName || profile.name; finalEmail = finalEmail || profile.email }
  }

  // Crear respuesta
  const { data: response, error: respErr } = await supabase.from('responses').insert({
    survey_id: survey.id,
    respondent_id: assignment.user_id || null,
    respondent_name: finalName,
    respondent_email: finalEmail,
    respondent_ip: req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress,
    is_complete: true,
    started_at: surveyStartedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    duration_seconds: duration
  }).select().single()

  if (respErr) return res.status(500).json({ code: 'DB_ERROR', message: respErr.message })

  // Guardar respuestas
  if (answers.length) {
    const answerRows = answers.map(a => ({
      response_id: response.id,
      question_id: a.question_id,
      value: typeof a.value === 'object' ? JSON.stringify(a.value) : String(a.value)
    }))
    await supabase.from('answers').insert(answerRows)
  }

  // Marcar asignación como completada — el token ya no funcionará
  await supabase.from('assignments')
    .update({ completed_at: completedAt.toISOString() })
    .eq('id', assignment.id)

  res.status(201).json({
    response_id: response.id,
    message: survey.settings?.confirmation_message || '¡Gracias por tu respuesta!'
  })
})

export default router