import { Router } from 'express'
import supabase from '../db/supabase.js'
import { authenticate } from '../middleware/auth.js'

const router = Router()

// GET /groups
router.get('/', authenticate, async (req, res) => {
  const { page = 1, limit = 10 } = req.query
  const offset = (page - 1) * limit
  const { data, error, count } = await supabase.from('groups')
    .select('*', { count: 'exact' }).range(offset, offset + Number(limit) - 1)
  if (error) return res.status(500).json({ code: 'DB_ERROR', message: error.message })
  res.json({ data, meta: { page: Number(page), limit: Number(limit), total: count } })
})

// POST /groups
router.post('/', authenticate, async (req, res) => {
  const { name, description } = req.body
  if (!name) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'name es requerido' })
  const { data, error } = await supabase.from('groups').insert({ name, description, created_by: req.user.id }).select().single()
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
  const { data, error } = await supabase.from('groups').update({ name, description }).eq('id', req.params.groupId).select().single()
  if (error || !data) return res.status(404).json({ code: 'NOT_FOUND', message: 'Grupo no encontrado' })
  res.json(data)
})

// DELETE /groups/:groupId
router.delete('/:groupId', authenticate, async (req, res) => {
  await supabase.from('groups').delete().eq('id', req.params.groupId)
  res.status(204).send()
})

// GET /groups/:groupId/members
router.get('/:groupId/members', authenticate, async (req, res) => {
  const { data, error } = await supabase.from('group_members')
    .select('profiles(*)').eq('group_id', req.params.groupId)
  if (error) return res.status(500).json({ code: 'DB_ERROR', message: error.message })
  res.json(data.map(m => m.profiles))
})

// POST /groups/:groupId/members
router.post('/:groupId/members', authenticate, async (req, res) => {
  const { user_ids } = req.body
  if (!Array.isArray(user_ids)) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'user_ids requerido' })
  const rows = user_ids.map(uid => ({ group_id: req.params.groupId, user_id: uid }))
  await supabase.from('group_members').upsert(rows, { onConflict: 'group_id,user_id' })
  res.json({ message: 'Miembros agregados' })
})

// DELETE /groups/:groupId/members/:userId
router.delete('/:groupId/members/:userId', authenticate, async (req, res) => {
  await supabase.from('group_members').delete()
    .eq('group_id', req.params.groupId).eq('user_id', req.params.userId)
  res.status(204).send()
})

export default router
