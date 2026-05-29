# SurveyApp — Backend API
 
Sistema de encuestas y evaluaciones en línea.  
**Stack:** Node.js + Express + Supabase
 
---
## Endpoints
 
### AUTH
 
---
 
#### `POST /auth/register`
Crea una cuenta nueva. El rol por defecto es `creator`.
 
**Body**
```json
{
  "name": "Angel Navarro",
  "email": "angel@ejemplo.com",
  "password": "mipassword123"
}
```
 
**Response `201`**
```json
{
  "token": "eyJ...",
  "refresh_token": "eyJ...",
  "user": {
    "id": "uuid",
    "name": "Angel Navarro",
    "email": "angel@ejemplo.com",
    "role": "creator"
  }
}
```
 
**Errores**
| Status | code | Cuándo |
|--------|------|--------|
| 400 | `VALIDATION_ERROR` | Falta name, email o password |
| 409 | `AUTH_ERROR` | El email ya está registrado |
 
---
 
#### `POST /auth/login`
 
**Body**
```json
{
  "email": "angel@ejemplo.com",
  "password": "mipassword123"
}
```
 
**Response `200`**
```json
{
  "token": "eyJ...",
  "refresh_token": "eyJ...",
  "user": {
    "id": "uuid",
    "name": "Angel Navarro",
    "email": "angel@ejemplo.com",
    "role": "creator",
    "created_at": "2025-01-01T00:00:00Z"
  }
}
```
 
**Errores**
| Status | code | Cuándo |
|--------|------|--------|
| 400 | `VALIDATION_ERROR` | Falta email o password |
| 401 | `UNAUTHORIZED` | Credenciales incorrectas |
 
---
 
#### `POST /auth/logout`
 Requiere token.
 
**Body** — vacío
 
**Response `204`** — sin body
 
---
 
#### `POST /auth/refresh`
Renueva el access token sin necesidad de volver a hacer login.
 
**Body**
```json
{
  "refresh_token": "eyJ..."
}
```
 
**Response `200`**
```json
{
  "token": "eyJ...",
  "refresh_token": "eyJ...",
  "user": { ... }
}
```
 
---
 
### SURVEYS
 
---
 
#### `GET /surveys`
Requiere token. Devuelve solo las encuestas del usuario autenticado (admins ven todas).
 
**Query params opcionales**
| Param | Tipo | Descripción |
|-------|------|-------------|
| `page` | number | Página (default: 1) |
| `limit` | number | Por página (default: 10) |
| `status` | string | Filtrar por `draft`, `active`, `closed`, `archived` |
| `type` | string | Filtrar por `satisfaction`, `academic`, `feedback`, `poll`, `quiz` |
 
**Response `200`**
```json
{
  "data": [
    {
      "id": "uuid",
      "title": "Encuesta de satisfacción",
      "description": "...",
      "type": "satisfaction",
      "status": "active",
      "public_token": "aB3xKm9pQr2w",
      "settings": {
        "allow_anonymous": true,
        "show_progress_bar": true
      },
      "created_by": "uuid",
      "created_at": "2025-01-01T00:00:00Z",
      "updated_at": "2025-01-01T00:00:00Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 5,
    "total_pages": 1,
    "has_next": false,
    "has_prev": false
  }
}
```
 
---
 
#### `POST /surveys`
Requiere token. Crea una encuesta en estado `draft`.
 
**Body**
```json
{
  "title": "Encuesta de satisfacción",
  "description": "Cuéntanos tu experiencia",
  "type": "satisfaction",
  "settings": {
    "allow_anonymous": true,
    "show_progress_bar": true,
    "time_limit_minutes": null,
    "confirmation_message": "¡Gracias por tu respuesta!"
  }
}
```
 
> `title` es el único campo requerido.  
> `type` puede ser: `satisfaction`, `academic`, `feedback`, `poll`, `quiz`
 
**Response `201`** — el objeto survey creado
 
**Errores**
| Status | code | Cuándo |
|--------|------|--------|
| 400 | `VALIDATION_ERROR` | Falta title |
 
---
 
#### `GET /surveys/:surveyId`
Requiere token. Devuelve la encuesta con sus preguntas incluidas.
 
**Response `200`**
```json
{
  "id": "uuid",
  "title": "...",
  "status": "draft",
  "questions": [
    {
      "id": "uuid",
      "survey_id": "uuid",
      "text": "¿Qué tan satisfecho estás?",
      "type": "scale",
      "required": true,
      "order": 1,
      "options": null,
      "scale_config": {
        "min": 1,
        "max": 10,
        "min_label": "Nada satisfecho",
        "max_label": "Muy satisfecho"
      }
    }
  ]
}
```
 
---
 
#### `PUT /surveys/:surveyId`
Requiere token. Actualiza título, descripción, tipo o settings.
 
**Body** — mismos campos que `POST /surveys`, todos opcionales
 
**Response `200`** — survey actualizado
 
---
 
#### `DELETE /surveys/:surveyId`
Requiere token. Elimina la encuesta y todas sus preguntas/respuestas en cascada.
 
**Response `204`** — sin body
 
---
 
#### `POST /surveys/:surveyId/publish`
Requiere token. Cambia el status a `active` y genera un token público único.  
Si la encuesta ya fue publicada antes, **reutiliza el mismo token** (el enlace no cambia).
 
**Body** — vacío
 
**Response `200`**
```json
{
  "id": "uuid",
  "status": "active",
  "public_token": "aB3xKm9pQr2w",
  "public_url": "https://tu-frontend.com/s/aB3xKm9pQr2w"
}
```
 
> `public_url` es el enlace que se comparte a los respondentes.
 
---
 
#### `POST /surveys/:surveyId/close`
Requiere token. Cierra la encuesta — ya no acepta respuestas nuevas.
 
**Body** — vacío
 
**Response `200`** — survey con `status: "closed"`
 
---
 
#### `POST /surveys/:surveyId/duplicate`
Requiere token. Crea una copia de la encuesta con todas sus preguntas en estado `draft`.
 
**Body** — vacío
 
**Response `201`** — la nueva encuesta copiada (sin public_token)
 
---
 
### QUESTIONS
 
---
 
#### `GET /surveys/:surveyId/questions`
Requiere token. Lista todas las preguntas ordenadas por `order`.
 
**Response `200`** — array de preguntas
 
---
 
#### `POST /surveys/:surveyId/questions`
Requiere token. Agrega una pregunta a la encuesta.
 
**Body**
```json
{
  "text": "¿Recomendarías nuestro servicio?",
  "type": "scale",
  "required": true,
  "order": 1,
  "options": null,
  "scale_config": {
    "min": 1,
    "max": 10,
    "min_label": "No lo recomendaría",
    "max_label": "Lo recomendaría ampliamente"
  }
}
```
 
**Tipos de pregunta disponibles**
 
| type | Descripción | Usa `options` | Usa `scale_config` |
|------|-------------|:---:|:---:|
| `open_text` | Texto libre | — | — |
| `single_choice` | Una opción (radio) | ✓ | — |
| `multiple_choice` | Varias opciones (checkbox) | ✓ | — |
| `checkbox` | Alias de multiple_choice | ✓ | — |
| `scale` | Escala numérica ej. 1–10 | — | ✓ |
| `rating` | Rating de estrellas | — | ✓ |
| `date` | Selector de fecha | — | — |
 
**Formato de `options`**
```json
[
  { "text": "Muy satisfecho", "value": "1" },
  { "text": "Satisfecho",     "value": "2" },
  { "text": "Insatisfecho",   "value": "3" }
]
```
 
**Response `201`** — la pregunta creada
 
---
 
#### `PUT /surveys/:surveyId/questions/:questionId`
Requiere token. Actualiza una pregunta.
 
**Body** — mismos campos que POST, todos opcionales
 
**Response `200`** — pregunta actualizada
 
---
 
#### `DELETE /surveys/:surveyId/questions/:questionId`
Requiere token.
 
**Response `204`** — sin body
 
---
 
#### `PATCH /surveys/:surveyId/questions/reorder`
Requiere token. Reordena todas las preguntas en un solo request.
 
**Body**
```json
{
  "order": [
    "uuid-pregunta-3",
    "uuid-pregunta-1",
    "uuid-pregunta-2"
  ]
}
```
 
> El array contiene los IDs de preguntas en el nuevo orden deseado.
 
**Response `200`**
```json
{ "message": "Orden actualizado" }
```
 
---
 
### RESPONSES & REPORTS
 
---
 
#### `GET /surveys/:surveyId/responses`
Requiere token. Devuelve todas las respuestas con sus answers incluidas.
 
**Response `200`**
```json
[
  {
    "id": "uuid",
    "survey_id": "uuid",
    "respondent_name": "María García",
    "respondent_email": "maria@ejemplo.com",
    "is_complete": true,
    "started_at": "2025-01-15T10:00:00Z",
    "completed_at": "2025-01-15T10:04:32Z",
    "duration_seconds": 272,
    "answers": [
      {
        "id": "uuid",
        "question_id": "uuid",
        "value": "8"
      }
    ]
  }
]
```
 
---
 
#### `GET /surveys/:surveyId/reports`
Requiere token. Devuelve estadísticas agregadas de la encuesta.
 
**Response `200`**
```json
{
  "survey_id": "uuid",
  "survey_title": "Encuesta de satisfacción",
  "total_assigned": 50,
  "total_responses": 38,
  "completion_rate": 76.0,
  "avg_duration_seconds": 245,
  "first_response_at": "2025-01-10T08:00:00Z",
  "last_response_at": "2025-01-15T17:30:00Z",
  "responses_by_day": [
    { "date": "2025-01-10", "count": 12 },
    { "date": "2025-01-11", "count": 9 }
  ],
  "questions_summary": [
    {
      "question_id": "uuid",
      "question_text": "¿Qué tan satisfecho estás?",
      "question_type": "scale",
      "response_count": 38,
      "skip_count": 0,
      "numeric_stats": {
        "min": 3,
        "max": 10,
        "mean": 7.84,
        "median": 8,
        "std_deviation": 1.52
      }
    },
    {
      "question_id": "uuid",
      "question_text": "¿Cómo nos encontraste?",
      "question_type": "single_choice",
      "response_count": 35,
      "skip_count": 3,
      "option_stats": [
        { "option_text": "Redes sociales", "count": 18, "percentage": 51.4 },
        { "option_text": "Recomendación",  "count": 12, "percentage": 34.3 },
        { "option_text": "Google",         "count": 5,  "percentage": 14.3 }
      ]
    },
    {
      "question_id": "uuid",
      "question_text": "¿Qué mejorarías?",
      "question_type": "open_text",
      "response_count": 30,
      "skip_count": 8,
      "open_answers": [
        "El tiempo de respuesta del soporte",
        "La interfaz podría ser más intuitiva"
      ]
    }
  ]
}
```
 
---
 
### PUBLIC (sin autenticación)
 
---
 
#### `GET /public/surveys/:token`
Sin auth. Devuelve la encuesta para ser respondida.  
Solo funciona si el status es `active`.
 
**Response `200`**
```json
{
  "id": "uuid",
  "title": "Encuesta de satisfacción",
  "description": "Cuéntanos tu experiencia",
  "type": "satisfaction",
  "settings": {
    "allow_anonymous": true,
    "show_progress_bar": true,
    "time_limit_minutes": null,
    "confirmation_message": "¡Gracias por tu respuesta!"
  },
  "questions": [ ... ],
  "already_responded": false
}
```
 
> `already_responded: true` si esa IP ya envió una respuesta antes.
 
**Errores**
| Status | code | Cuándo |
|--------|------|--------|
| 404 | `NOT_FOUND` | Token inválido o encuesta no activa |
 
---
 
#### `POST /public/surveys/:token/respond`
Sin auth. Envía las respuestas del formulario.
 
**Body**
```json
{
  "respondent_name": "Juan Pérez",
  "respondent_email": "juan@ejemplo.com",
  "started_at": "2025-01-15T10:00:00.000Z",
  "answers": [
    {
      "question_id": "uuid-pregunta-1",
      "value": "8"
    },
    {
      "question_id": "uuid-pregunta-2",
      "value": "Redes sociales"
    },
    {
      "question_id": "uuid-pregunta-3",
      "value": "[\"opcion1\",\"opcion3\"]"
    }
  ]
}
```
 
> `respondent_name` y `respondent_email` son opcionales si `allow_anonymous: true`.  
> `started_at` es el ISO timestamp de cuando el usuario abrió el formulario — se usa para calcular el tiempo de respuesta.  
> Para preguntas de opción múltiple, `value` es un JSON string del array de valores seleccionados.
 
**Response `201`**
```json
{
  "response_id": "uuid",
  "message": "¡Gracias por tu respuesta!"
}
```
 
**Errores**
| Status | code | Cuándo |
|--------|------|--------|
| 404 | `NOT_FOUND` | Token no existe |
| 400 | `SURVEY_CLOSED` | La encuesta no está activa |
 
---
 
### ASSIGNMENTS
 
---
 
#### `GET /surveys/:surveyId/assignments`
Requiere token. Lista los usuarios y grupos asignados a la encuesta.
 
**Response `200`** — array de assignments con datos de usuario/grupo
 
---
 
#### `POST /surveys/:surveyId/assignments`
Requiere token. Asigna la encuesta a usuarios o grupos específicos.
 
**Body**
```json
{
  "user_ids": ["uuid-user-1", "uuid-user-2"],
  "group_ids": ["uuid-group-1"],
  "due_date": "2025-02-01T23:59:59Z"
}
```
 
**Response `201`** — array de assignments creados
 
---
 
#### `DELETE /surveys/:surveyId/assignments/:assignmentId`
Requiere token.
 
**Response `204`** — sin body
 
---
 
## Flujo completo
 
```
1. POST /auth/register          → obtener token
2. POST /surveys                → crear encuesta (status: draft)
3. POST /surveys/:id/questions  → agregar preguntas (repetir por cada una)
4. POST /surveys/:id/publish    → activar y obtener public_url
5. Compartir public_url         → cualquier persona puede responder
   GET  /public/surveys/:token  → ver la encuesta
   POST /public/surveys/:token/respond → enviar respuesta
6. GET  /surveys/:id/reports    → ver métricas y estadísticas
```
 
---
