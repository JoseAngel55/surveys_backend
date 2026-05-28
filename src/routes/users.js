import { Router } from 'express'
import supabase from '../db/supabase.js'
import { authenticate, requireRole } from '../middleware/auth.js'

const router = Router()

// GET /users
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  const { page = 1, limit = 10, role, search } = req.query
  const offset = (page - 1) * limit

  let query = supabase.from('profiles').select('*', { count: 'exact' })
    .range(offset, offset + Number(limit) - 1)
  if (role) query = query.eq('role', role)
  if (search) query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`)

  const { data, error, count } = await query
  if (error) return res.status(500).json({ code: 'DB_ERROR', message: error.message })

  res.json({
    data, meta: {
      page: Number(page), limit: Number(limit), total: count,
      total_pages: Math.ceil(count / limit),
      has_next: offset + Number(limit) < count, has_prev: page > 1
    }
  })
})

// GET /users/:userId
router.get('/:userId', authenticate, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.id !== req.params.userId) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Sin acceso' })
  }
  const { data, error } = await supabase.from('profiles').select('*').eq('id', req.params.userId).single()
  if (error || !data) return res.status(404).json({ code: 'NOT_FOUND', message: 'Usuario no encontrado' })
  res.json(data)
})

// PUT /users/:userId
router.put('/:userId', authenticate, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.id !== req.params.userId) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Sin acceso' })
  }
  const { name, role } = req.body
  const updates = { updated_at: new Date().toISOString() }
  if (name) updates.name = name
  if (role && req.user.role === 'admin') updates.role = role

  const { data, error } = await supabase.from('profiles').update(updates)
    .eq('id', req.params.userId).select().single()
  if (error || !data) return res.status(404).json({ code: 'NOT_FOUND', message: 'Usuario no encontrado' })
  res.json(data)
})

// DELETE /users/:userId
router.delete('/:userId', authenticate, requireRole('admin'), async (req, res) => {
  await supabase.auth.admin.deleteUser(req.params.userId)
  await supabase.from('profiles').delete().eq('id', req.params.userId)
  res.status(204).send()
})

export default router
