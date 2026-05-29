import 'dotenv/config'
import express from 'express'
import cors from 'cors'

import authRoutes from './routes/auth.js'
import userRoutes from './routes/users.js'
import groupRoutes from './routes/groups.js'
import surveyRoutes from './routes/surveys.js'
import publicRoutes from './routes/public.js'
import publicAssignmentRoutes from './routes/public_assignments.js'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}))
app.use(express.json())

// Routes
app.use('/auth', authRoutes)
app.use('/users', userRoutes)
app.use('/groups', groupRoutes)
app.use('/surveys', surveyRoutes)
app.use('/public', publicRoutes)
app.use('/public/a', publicAssignmentRoutes)

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }))

// 404
app.use((req, res) => res.status(404).json({ code: 'NOT_FOUND', message: `Ruta ${req.method} ${req.path} no encontrada` }))

// Error handler
app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Error interno del servidor' })
})

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`)
})