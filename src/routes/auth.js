import { Router } from 'express'
import supabase from '../db/supabase.js'
import { authenticate } from '../middleware/auth.js'

const router = Router()

// POST /auth/register
router.post('/register', async (req, res) => {
  const { name, email, password, role = 'respondent' } = req.body
  if (!name || !email || !password) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'name, email y password son requeridos' })
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { name }
  })
  if (error) {
    const status = error.message.includes('already') ? 409 : 400
    return res.status(status).json({ code: 'AUTH_ERROR', message: error.message })
  }

  await supabase.from('profiles').upsert({ id: data.user.id, name, email, role })

  // Sign in to get tokens
  const { data: session, error: signInErr } = await supabase.auth.signInWithPassword({ email, password })
  if (signInErr) return res.status(500).json({ code: 'AUTH_ERROR', message: signInErr.message })

  return res.status(201).json({
    token: session.session.access_token,
    refresh_token: session.session.refresh_token,
    user: { id: data.user.id, name, email, role }
  })
})

// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'email y password son requeridos' })
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Credenciales inválidas' })

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single()

  return res.json({
    token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    user: profile
  })
})

// POST /auth/logout
router.post('/logout', authenticate, async (req, res) => {
  await supabase.auth.admin.signOut(req.token)
  return res.status(204).send()
})

// POST /auth/refresh
router.post('/refresh', async (req, res) => {
  const { refresh_token } = req.body
  if (!refresh_token) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'refresh_token requerido' })

  const { data, error } = await supabase.auth.refreshSession({ refresh_token })
  if (error) return res.status(401).json({ code: 'UNAUTHORIZED', message: error.message })

  return res.json({
    token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    user: data.user
  })
})

export default router
