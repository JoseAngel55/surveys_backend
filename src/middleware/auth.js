import supabase from '../db/supabase.js'

export async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Token requerido' })
  }

  const token = authHeader.split(' ')[1]
  const { data: { user }, error } = await supabase.auth.getUser(token)

  if (error || !user) {
    return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Token inválido o expirado' })
  }

  // Fetch profile with role
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  req.user = { ...user, ...profile }
  req.token = token
  next()
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'No tienes permiso para esta acción' })
    }
    next()
  }
}
