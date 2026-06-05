# SurveyApp — Backend API

Sistema de encuestas y evaluaciones en línea con soporte multilenguaje, tipado de preguntas extendido, asignaciones por grupo y exportación de reportes.

**Stack:** Node.js + Express + Supabase

---

## Tabla de contenido

- [Requisitos](#requisitos)
- [Instalación y configuración](#instalación-y-configuración)
- [Variables de entorno](#variables-de-entorno)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Roles y permisos](#roles-y-permisos)
- [Tipos de encuesta](#tipos-de-encuesta)
- [Tipos de preguntas](#tipos-de-preguntas)
- [Endpoints](#endpoints)
- [Flujo completo](#flujo-completo)
- [Mejoras planificadas](#mejoras-planificadas)

---

## Requisitos

- Node.js **18+**
- Cuenta y proyecto en [Supabase](https://supabase.com)
- `npm` o `yarn`

---

## Instalación y configuración

```bash
# 1. Clonar el repositorio
git clone https://github.com/tu-usuario/surveys_backend.git
cd surveys_backend

# 2. Instalar dependencias
npm install

# 3. Copiar el archivo de variables de entorno
cp .env.example .env
# → Edita .env con tus credenciales (ver sección siguiente)

# 4. Levantar en modo desarrollo
npm run dev

# 5. O en producción
npm start
```

El servidor estará disponible en `http://localhost:3001` (o el puerto que definas en `PORT`).

---

## Variables de entorno

Crea un archivo `.env` en la raíz del proyecto con las siguientes variables:

```env
# Puerto del servidor (opcional, default: 3001)
PORT=3001

# URL del frontend (para CORS y generación de enlaces públicos)
FRONTEND_URL=http://localhost:5173

# Supabase — se obtienen en Settings → API del dashboard de tu proyecto
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...   # service_role key (nunca la expongas en el cliente)

# Resend — para envío de correos (invitaciones, notificaciones)
RESEND_API_KEY=re_...
```

> **Seguridad:** `SUPABASE_SERVICE_KEY` tiene acceso total a la base de datos. Nunca la uses en el frontend ni la incluyas en repositorios públicos.

---

## Estructura del proyecto

```
surveys_backend/
├── src/
│   ├── db/
│   │   └── supabase.js          # Cliente Supabase
│   ├── middleware/
│   │   └── auth.js              # Autenticación JWT y control de roles
│   ├── routes/
│   │   ├── auth.js              # Registro, login, logout, refresh
│   │   ├── surveys.js           # CRUD encuestas, preguntas, reportes y exports
│   │   ├── groups.js            # Grupos, miembros y asignaciones por grupo
│   │   ├── users.js             # Gestión de usuarios (admin)
│   │   ├── public.js            # Encuestas públicas (sin auth)
│   │   └── public_assignments.js # Encuestas por token de asignación (sin auth)
│   ├── utils/
│   │   └── reportGenerator.js   # Generación de PDF y Excel
│   └── index.js                 # Entry point
├── .env.example
├── package.json
└── README.md
```

---

## Roles y permisos

| Rol | Descripción |
|-----|-------------|
| `admin` | Acceso total: ve y gestiona todos los recursos de cualquier usuario |
| `creator` | Crea y gestiona sus propias encuestas y grupos |
| `respondent` | Solo puede responder encuestas asignadas |

El rol por defecto al registrarse es `creator`. Solo un `admin` puede cambiar el rol de otro usuario.

---

## Tipos de encuesta

El campo `type` de una encuesta define su propósito y determina qué tipos de preguntas tienen sentido incluir, si las preguntas admiten calificación automática y cómo se presentan los resultados.

| `type` | Descripción | ¿Admite calificación? | Preguntas recomendadas |
|--------|-------------|:---:|------------------------|
| `satisfaction` | Medir satisfacción de clientes o usuarios | No | `scale`, `rating`, `single_choice`, `open_text` |
| `feedback` | Recopilar opiniones y sugerencias libres | No | `open_text`, `multiple_choice`, `rating` |
| `poll` | Votación o consulta de opinión rápida | No | `single_choice`, `multiple_choice` |
| `academic` | Evaluación educativa con respuestas correctas e incorrectas | **Sí** | `single_choice`, `multiple_choice`, `open_text`, `date` |
| `quiz` | Cuestionario de conocimiento o trivia | **Sí** | `single_choice`, `multiple_choice`, `scale` |

### Calificación en encuestas `academic` y `quiz`

Cuando el `type` de la encuesta es `academic` o `quiz`, cada pregunta de tipo `single_choice` o `multiple_choice` puede definir una **respuesta correcta** y un **puntaje**. El sistema calculará automáticamente la calificación del respondente al completar la encuesta.

Para habilitar la calificación, cada opción dentro de `options` acepta los campos adicionales `is_correct` y `score`:

```json
{
  "text": "¿Cuánto es 2 + 2?",
  "type": "single_choice",
  "required": true,
  "order": 1,
  "options": [
    { "text": "3",  "value": "3",  "is_correct": false, "score": 0 },
    { "text": "4",  "value": "4",  "is_correct": true,  "score": 10 },
    { "text": "5",  "value": "5",  "is_correct": false, "score": 0 },
    { "text": "22", "value": "22", "is_correct": false, "score": 0 }
  ],
  "grading_config": {
    "max_score": 10,
    "partial_credit": false
  }
}
```

El campo `grading_config` se puede añadir en cualquier pregunta calificable:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `max_score` | number | Puntaje máximo posible para esta pregunta |
| `partial_credit` | boolean | Si `true`, en `multiple_choice` se otorgan puntos parciales por cada opción correcta seleccionada |

La calificación final del respondente se incluye en `GET /surveys/:surveyId/responses` y en el reporte (`GET /surveys/:surveyId/reports`) bajo el campo `score_summary` cuando el tipo de encuesta es `academic` o `quiz`:

```json
{
  "score_summary": {
    "max_possible_score": 100,
    "avg_score": 72.5,
    "pass_rate": 68.4,
    "score_distribution": [
      { "range": "0-49",  "count": 5  },
      { "range": "50-69", "count": 8  },
      { "range": "70-89", "count": 14 },
      { "range": "90-100","count": 11 }
    ]
  }
}
```

> **Nota de implementación:** `is_correct`, `score` y `grading_config` son campos planificados que deben añadirse al schema de la tabla `questions` y procesarse en `buildReport()` dentro de `reportGenerator.js`.

---

## Tipos de preguntas

Al crear preguntas (`POST /surveys/:surveyId/questions`) se debe indicar el campo `type`. La tabla a continuación describe cada tipo, qué campos adicionales acepta y cómo se almacena la respuesta.

| `type` | Descripción | Usa `options` | Usa `scale_config` | Formato de `value` |
|--------|-------------|:---:|:---:|-----|
| `open_text` | Texto libre | — | — | String plano |
| `single_choice` | Una sola opción (radio button) | ✓ | — | String con el `value` seleccionado |
| `multiple_choice` | Varias opciones (checkbox) | ✓ | — | JSON string: `"[\"opt1\",\"opt3\"]"` |
| `checkbox` | Alias de `multiple_choice` | ✓ | — | JSON string: `"[\"opt1\",\"opt3\"]"` |
| `scale` | Escala numérica personalizable (ej. 1–10) | — | ✓ | String numérico: `"8"` |
| `rating` | Rating de estrellas | — | ✓ | String numérico: `"4"` |
| `date` | Selector de fecha | — | — | ISO date string: `"2025-06-15"` |

**Formato de `options`** (para `single_choice`, `multiple_choice`, `checkbox`):
```json
[
  { "text": "Muy satisfecho", "value": "5" },
  { "text": "Satisfecho",     "value": "4" },
  { "text": "Neutral",        "value": "3" },
  { "text": "Insatisfecho",   "value": "2" },
  { "text": "Muy insatisfecho","value": "1" }
]
```

**Formato de `scale_config`** (para `scale` y `rating`):
```json
{
  "min": 1,
  "max": 10,
  "min_label": "Nada satisfecho",
  "max_label": "Muy satisfecho"
}
```

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

Ver la sección [Tipos de preguntas](#tipos-de-preguntas) para referencia completa de todos los tipos disponibles y sus campos.

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
  "total_responses": 38,
  "complete_responses": 35,
  "total_questions": 5,
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

#### `GET /surveys/:surveyId/export/pdf`
Requiere token. Descarga el reporte de la encuesta en formato PDF.

**Response** — archivo `.pdf` como `attachment`

---

#### `GET /surveys/:surveyId/export/excel`
Requiere token. Descarga el reporte en formato Excel con hojas para resumen, actividad por día, preguntas y respuestas abiertas.

**Response** — archivo `.xlsx` como `attachment`

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
| 400 | `TIME_EXPIRED` | El tiempo límite de la encuesta ha expirado |

---

### ASSIGNMENTS (encuestas por token personal)

Los assignments permiten enviar un enlace único e intransferible a cada respondente. A diferencia del enlace público, este enlace:
- Identifica al respondente automáticamente
- Solo puede usarse una vez
- Puede tener fecha de vencimiento (`due_date`)
- Se marca como completado al responder, invalidando el enlace

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

#### `GET /public/a/:token`
Sin auth. Devuelve la encuesta asignada al respondente por su token único.

**Response `200`** — encuesta con datos del respondente pre-llenados

**Errores**
| Status | code | Cuándo |
|--------|------|--------|
| 404 | `NOT_FOUND` | Token inválido |
| 410 | `ALREADY_COMPLETED` | Ya fue respondida |
| 410 | `EXPIRED` | El plazo venció |
| 410 | `SURVEY_CLOSED` | La encuesta no está activa |

---

#### `POST /public/a/:token/respond`
Sin auth. Envía las respuestas para una encuesta asignada. Marca el token como usado.

**Body** — igual que `POST /public/surveys/:token/respond`

**Response `201`** — `{ response_id, message }`

---

### GROUPS

---

#### `GET /groups`
Requiere token. Lista los grupos del usuario autenticado (admins ven todos).

---

#### `POST /groups`
Requiere token. Crea un grupo.

**Body**
```json
{
  "name": "Equipo de ventas",
  "description": "Vendedores de la región norte"
}
```

---

#### `GET /groups/:groupId`
Requiere token.

---

#### `PUT /groups/:groupId`
Requiere token. Actualiza nombre o descripción.

---

#### `DELETE /groups/:groupId`
Requiere token.

---

#### `GET /groups/:groupId/members`
Requiere token. Lista los miembros del grupo con su fecha de ingreso.

---

#### `POST /groups/:groupId/members`
Requiere token. Agrega miembros por `user_ids` o `emails`.

Si se pasa un email que no existe en el sistema, **se crea la cuenta automáticamente** con rol `respondent`.

**Body**
```json
{
  "user_ids": ["uuid-1"],
  "emails": ["nuevo@ejemplo.com", "otro@ejemplo.com"]
}
```

**Response `200`**
```json
{
  "added": ["uuid-1", "nuevo@ejemplo.com"],
  "created": ["otro@ejemplo.com"],
  "errors": []
}
```

---

#### `DELETE /groups/:groupId/members/:userId`
Requiere token.

---

#### `POST /groups/:groupId/assign`
Requiere token. Asigna una encuesta a **todos los miembros del grupo**, generando un token único por persona.

**Body**
```json
{
  "survey_id": "uuid",
  "due_date": "2025-02-01T23:59:59Z"
}
```

**Response `201`**
```json
{
  "survey_id": "uuid",
  "survey_title": "Encuesta de satisfacción",
  "group_id": "uuid",
  "total_assigned": 12,
  "assignments": [
    {
      "assignment_id": "uuid",
      "user_id": "uuid",
      "email": "persona@ejemplo.com",
      "access_token": "xxxxxxxxxxxxxxxxxxxx",
      "survey_link": "https://tu-frontend.com/a/xxxxxxxxxxxxxxxxxxxx"
    }
  ]
}
```

---

#### `GET /groups/:groupId/assignments`
Requiere token. Ver estado de todas las asignaciones del grupo (completadas, pendientes, vencidas).

**Query params opcionales**
| Param | Tipo | Descripción |
|-------|------|-------------|
| `survey_id` | uuid | Filtrar por encuesta específica |

---

### USERS (admin)

---

#### `GET /users`
Requiere token + rol `admin`. Lista todos los usuarios con paginación y búsqueda.

**Query params opcionales:** `page`, `limit`, `role`, `search`

---

#### `GET /users/:userId`
Requiere token. Un usuario puede ver su propio perfil; admins pueden ver cualquiera.

---

#### `PUT /users/:userId`
Requiere token. Actualiza nombre. Solo admins pueden cambiar el `role`.

---

#### `DELETE /users/:userId`
Requiere token + rol `admin`. Elimina la cuenta de Supabase Auth y el perfil.

---

## Flujo completo

```
1. POST /auth/register              → obtener token
2. POST /surveys                    → crear encuesta (status: draft)
3. POST /surveys/:id/questions      → agregar preguntas (repetir por cada una)
4. POST /surveys/:id/publish        → activar y obtener public_url

── Opción A: enlace público (anónimo) ──────────────────────────────────────
5a. Compartir public_url
    GET  /public/surveys/:token         → ver la encuesta
    POST /public/surveys/:token/respond → enviar respuesta

── Opción B: asignación por grupo (nominada) ───────────────────────────────
5b. POST /groups                        → crear grupo
    POST /groups/:id/members            → agregar miembros (por email o user_id)
    POST /groups/:id/assign             → generar enlaces únicos por persona
    → Compartir cada survey_link al respondente correspondiente
    GET  /public/a/:token               → ver encuesta asignada
    POST /public/a/:token/respond       → enviar respuesta (invalida el token)

6. GET /surveys/:id/reports         → ver métricas y estadísticas
7. GET /surveys/:id/export/pdf      → descargar reporte PDF
8. GET /surveys/:id/export/excel    → descargar reporte Excel
```

---

## Mejoras planificadas

### Soporte multilenguaje (i18n)
Actualmente los mensajes de error y confirmación están en español. Se planea:
- Añadir soporte para `Accept-Language` en el header de cada request
- Extraer todos los strings a archivos de traducción (`es`, `en`, `pt`)
- Permitir que `confirmation_message` se defina por idioma dentro de `settings`

### Identificación mejorada de tipo de preguntas
- Validación estricta en el backend: si `type` es `single_choice` o `multiple_choice`, rechazar si `options` está vacío
- Si `type` es `scale` o `rating`, validar que `scale_config` tenga `min` y `max` numéricos
- Añadir el tipo `matrix` para agrupar sub-preguntas bajo una misma escala
- Añadir el tipo `nps` como variante de `scale` con rango fijo 0–10 y etiquetas estándar

### Notificaciones por correo
- Al asignar una encuesta, enviar automáticamente el enlace único al email del respondente (usando Resend)
- Notificación al creador cuando se alcanza un umbral de respuestas configurable
- Recordatorio automático a respondentes que no han completado antes de la `due_date`

### Lógica condicional en preguntas
- Permitir mostrar/ocultar preguntas según la respuesta de una pregunta anterior (`skip logic`)
- Configuración en `settings` por pregunta: `show_if: { question_id, operator, value }`

### Mejoras de seguridad y límites
- Rate limiting por IP en los endpoints públicos (`/public/*`)
- Opción `max_responses` en `settings` para cerrar la encuesta automáticamente al alcanzar el límite
- Soporte para `allow_multiple_responses: false` basado en email además de IP

### Dashboard y analítica
- Endpoint `GET /dashboard` con resumen de encuestas activas, respuestas totales del día y tasa de completado
- Filtros de fecha en `GET /surveys/:id/reports` para analizar rangos específicos

### Mejoras en reportes exportados
- Incluir gráficas de barras en el PDF para preguntas de opción múltiple
- Hoja adicional en Excel con respuestas individuales detalladas (una fila por respondente)
- Exportación en formato CSV para integración con herramientas externas

### Validaciones adicionales
- `required: true` en preguntas debe validarse antes de guardar la respuesta en el backend, no solo en el frontend
- Validar que el `order` de preguntas sea único dentro de la misma encuesta