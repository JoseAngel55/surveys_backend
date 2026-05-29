import { Router } from 'express'
import { nanoid } from 'nanoid'
import supabase from '../db/supabase.js'
import { authenticate } from '../middleware/auth.js'

const router = Router()

// GET /groups
router.get('/', authenticate, async (req, res) => {
  const { page = 1, limit = 50 } = req.query
  const offset = (page - 1) * limit

  let query = supabase.from('groups')
    .select('*, profiles!groups_created_by_fkey(id, name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + Number(limit) - 1)

  // Non-admins only see groups they created
  if (req.user.role !== 'admin') {
    query = query.eq('created_by', req.user.id)
  }

  const { data, error, count } = await query
  if (error) return res.status(500).json({ code: 'DB_ERROR', message: error.message })
  res.json({ data, meta: { page: Number(page), limit: Number(limit), total: count } })
})

// POST /groups
router.post('/', authenticate, async (req, res) => {
  const { name, description } = req.body
  if (!name) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'name es requerido' })
  const { data, error } = await supabase.from('groups')
    .insert({ name, description, created_by: req.user.id })
    .select().single()
  if (error) return res.status(500).json({ code: 'DB_ERROR', message: error.message })
  res.status(201).json(data)
})

// GET /groups/:groupId
router.get('/:groupId', authenticate, async (req, res) => {
  const { data, error } = await supabase.from('groups').select('*').eq('id', req.params.groupId).single()
  if (error || !data) return res.status(404).json({ code: 'NOT_FOUND', message: 'Grupo no encontrado' })
  res.json(data)
})

// PUT /groups/:groupId
router.put('/:groupId', authenticate, async (req, res) => {
  const { name, description } = req.body
  const { data, error } = await supabase.from('groups')
    .update({ name, description }).eq('id', req.params.groupId).select().single()
  if (error || !data) return res.status(404).json({ code: 'NOT_FOUND', message: 'Grupo no encontrado' })
  res.json(data)
})

// DELETE /groups/:groupId
router.delete('/:groupId', authenticate, async (req, res) => {
  await supabase.from('groups').delete().eq('id', req.params.groupId)
  res.status(204).send()
})

// GET /groups/:groupId/members — con info de asignaciones activas
router.get('/:groupId/members', authenticate, async (req, res) => {
  const { data, error } = await supabase.from('group_members')
    .select('joined_at, profiles(id, name, email, role)')
    .eq('group_id', req.params.groupId)
  if (error) return res.status(500).json({ code: 'DB_ERROR', message: error.message })
  res.json(data.map(m => ({ ...m.profiles, joined_at: m.joined_at })))
})

// POST /groups/:groupId/members — acepta user_ids o emails
router.post('/:groupId/members', authenticate, async (req, res) => {
  const { user_ids = [], emails = [] } = req.body
  const results = { added: [], created: [], errors: [] }

  // Process user_ids directly
  if (user_ids.length) {
    const rows = user_ids.map(uid => ({ group_id: req.params.groupId, user_id: uid }))
    await supabase.from('group_members').upsert(rows, { onConflict: 'group_id,user_id' })
    results.added.push(...user_ids)
  }

  // Process emails — create user accounts if they don't exist
  for (const email of emails) {
    const cleanEmail = email.trim().toLowerCase()
    if (!cleanEmail) continue

    // Check if profile already exists
    const { data: existing } = await supabase.from('profiles')
      .select('id').eq('email', cleanEmail).single()

    let userId = existing?.id

    if (!userId) {
      // Create auth user with a random password — they'll use the survey link directly
      const tempPassword = nanoid(16)
      const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
        email: cleanEmail,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { name: cleanEmail.split('@')[0] }
      })

      if (createErr) {
        results.errors.push({ email: cleanEmail, error: createErr.message })
        continue
      }

      // Profile is auto-created by trigger, but upsert to ensure it
      await supabase.from('profiles').upsert({
        id: newUser.user.id,
        name: cleanEmail.split('@')[0],
        email: cleanEmail,
        role: 'respondent'
      })

      userId = newUser.user.id
      results.created.push(cleanEmail)
    } else {
      results.added.push(cleanEmail)
    }

    // Add to group
    await supabase.from('group_members')
      .upsert({ group_id: req.params.groupId, user_id: userId }, { onConflict: 'group_id,user_id' })
  }

  res.json(results)
})

// DELETE /groups/:groupId/members/:userId
router.delete('/:groupId/members/:userId', authenticate, async (req, res) => {
  await supabase.from('group_members').delete()
    .eq('group_id', req.params.groupId).eq('user_id', req.params.userId)
  res.status(204).send()
})

// POST /groups/:groupId/assign — Asignar encuesta a todo el grupo
// Genera un access_token único por cada miembro
router.post('/:groupId/assign', authenticate, async (req, res) => {
  const { survey_id, due_date } = req.body
  if (!survey_id) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'survey_id es requerido' })

  // Verificar que la encuesta existe y pertenece al usuario
  const { data: survey } = await supabase.from('surveys')
    .select('id, title, status, created_by').eq('id', survey_id).single()
  if (!survey) return res.status(404).json({ code: 'NOT_FOUND', message: 'Encuesta no encontrada' })
  if (req.user.role !== 'admin' && survey.created_by !== req.user.id) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Sin acceso a esta encuesta' })
  }

  // Obtener miembros del grupo
  const { data: members } = await supabase.from('group_members')
    .select('user_id, profiles(email)').eq('group_id', req.params.groupId)

  if (!members?.length) {
    return res.status(400).json({ code: 'EMPTY_GROUP', message: 'El grupo no tiene miembros' })
  }

  // Eliminar asignaciones anteriores de esta encuesta para este grupo para evitar duplicados
  await supabase.from('assignments')
    .delete()
    .eq('survey_id', survey_id)
    .eq('group_id', req.params.groupId)

  // Crear una asignación por usuario (token único por persona)
  const rows = members.map(m => ({
    survey_id,
    user_id: m.user_id,
    group_id: req.params.groupId,
    due_date: due_date || null,
    access_token: nanoid(20)
  }))

  const { data, error } = await supabase.from('assignments').insert(rows).select()
  if (error) return res.status(500).json({ code: 'DB_ERROR', message: error.message })

  // Construir URLs para cada miembro
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
  const assignments = data.map(a => {
    const member = members.find(m => m.user_id === a.user_id)
    return {
      assignment_id: a.id,
      user_id: a.user_id,
      email: member?.profiles?.email,
      access_token: a.access_token,
      survey_link: `${baseUrl}/a/${a.access_token}`
    }
  })

  res.status(201).json({
    survey_id,
    survey_title: survey.title,
    group_id: req.params.groupId,
    total_assigned: assignments.length,
    assignments
  })
})

// GET /groups/:groupId/assignments — Ver estado de asignaciones de un grupo
router.get('/:groupId/assignments', authenticate, async (req, res) => {
  const { survey_id } = req.query

  let query = supabase.from('assignments')
    .select('id, access_token, due_date, assigned_at, completed_at, survey_id, user_id, profiles(name, email), surveys(title, status)')
    .eq('group_id', req.params.groupId)
    .order('assigned_at', { ascending: false })

  if (survey_id) query = query.eq('survey_id', survey_id)

  const { data, error } = await query
  if (error) return res.status(500).json({ code: 'DB_ERROR', message: error.message })

  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
  const result = (data || []).map(a => ({
    id: a.id,
    survey_id: a.survey_id,
    survey_title: a.surveys?.title,
    survey_status: a.surveys?.status,
    user_id: a.user_id,
    name: a.profiles?.name,
    email: a.profiles?.email,
    due_date: a.due_date,
    assigned_at: a.assigned_at,
    completed_at: a.completed_at,
    is_completed: Boolean(a.completed_at),
    is_expired: a.due_date ? new Date(a.due_date) < new Date() : false,
    survey_link: `${baseUrl}/a/${a.access_token}`
  }))

  res.json(result)
})

export default router