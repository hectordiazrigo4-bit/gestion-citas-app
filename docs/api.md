# API de la aplicación

Todas las rutas están bajo `/api`. Las respuestas son JSON. Los errores devuelven `{ "error": "mensaje en español" }`.

Las peticiones que cambian datos (`POST`, `PATCH`, `DELETE`) deben enviar `Content-Type: application/json`. Cualquier otro formato responde `415`.

Todas las rutas de negocio exigen sesión. Un negocio al que no perteneces responde `404`.

## Cuenta

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/register` | Crea usuario, negocio (rol propietario) e inicia sesión. Body: `name`, `email`, `password`, `businessName`. |
| POST | `/api/auth/login` | Inicia sesión. Body: `email`, `password`. |
| POST | `/api/auth/logout` | Cierra la sesión actual. |
| GET | `/api/me` | Usuario actual y su negocio. |

## Negocio

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| GET | `/api/businesses/:id` | Todos | Datos del negocio y tu rol. |
| PATCH | `/api/businesses/:id` | Propietario, administrador | Cambia el nombre. Body: `name`. |

## Servicios

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| GET | `/api/businesses/:id/services` | Todos | Lista de servicios. |
| POST | `/api/businesses/:id/services` | Propietario, administrador | Crea un servicio. |
| PATCH | `/api/businesses/:id/services/:sid` | Propietario, administrador | Edita un servicio (envía todos los campos). |
| DELETE | `/api/businesses/:id/services/:sid` | Propietario, administrador | Elimina un servicio. |

Campos de un servicio: `name` (obligatorio, máx. 120), `description` (opcional, máx. 1000), `price` en euros (0 a 100.000), `duration_min` (5 a 720), `prep_min` (0 a 240), `active` (por defecto `true`). La respuesta devuelve el precio en céntimos como `price_cents`.

## Clientes

Todos los miembros del negocio pueden gestionar clientes.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/businesses/:id/clients?q=texto` | Lista de clientes (máx. 50), con búsqueda por nombre, teléfono o correo. |
| POST | `/api/businesses/:id/clients` | Crea un cliente. |
| GET | `/api/businesses/:id/clients/:cid` | Ficha completa del cliente. |
| PATCH | `/api/businesses/:id/clients/:cid` | Edita un cliente (envía todos los campos). |
| DELETE | `/api/businesses/:id/clients/:cid` | Elimina un cliente. |

Campos de un cliente: `first_name` y `last_name` (obligatorios), `phone` (se guarda en formato +34…; sin prefijo se asume España), `email`, `notes`, `tags` (lista, máx. 10), `marketing_consent` (booleano). Dentro de un mismo negocio no puede haber dos clientes con el mismo teléfono (`409`).

## Notas

- Un negocio solo puede ser consultado o modificado por sus miembros; los identificadores se comprueban siempre dentro del negocio.
- Eliminar un cliente o un servicio es permanente. Si tiene citas registradas, la respuesta es `409`: para un servicio, desactívalo; para un cliente, conserva su historial.

## Horario semanal

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| GET | `/api/businesses/:id/hours` | Todos | Días abiertos y su horario. Sin fila = cerrado. |
| PUT | `/api/businesses/:id/hours` | Propietario, administrador | Reemplaza el horario completo. Body: `hours: [{ weekday, opens, closes }]` (weekday 0 = domingo, horas `HH:MM`). |

## Bloqueos (descansos, vacaciones y bloqueos puntuales)

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| GET | `/api/businesses/:id/blocks?from=AAAA-MM-DD&to=AAAA-MM-DD` | Todos | Bloqueos que caen en el periodo. |
| POST | `/api/businesses/:id/blocks` | Propietario, administrador | Crea un bloqueo. Body: `kind` (`descanso`, `vacaciones`, `bloqueo`), `starts`, `ends`, `reason`. |
| DELETE | `/api/businesses/:id/blocks/:bid` | Propietario, administrador | Quita un bloqueo. |

No se puede bloquear un tramo que ya tiene citas activas (`409`).

## Disponibilidad

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/businesses/:id/availability?date=AAAA-MM-DD&service_id=ID` | Huecos libres del día para ese servicio, cada 15 minutos, en ISO UTC. Tiene en cuenta el horario, las citas activas, los bloqueos, la duración y el tiempo de preparación. |

## Citas

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/businesses/:id/appointments?from=AAAA-MM-DD&to=AAAA-MM-DD` | Citas del periodo (máx. 62 días), con nombre del cliente y del servicio. |
| POST | `/api/businesses/:id/appointments` | Crea una cita. Body: `client_id`, `service_id`, `starts`, `status` (`confirmed` por defecto, o `pending`), `notes`. |
| PATCH | `/api/businesses/:id/appointments/:aid` | Cambia estado, hora, cliente, servicio o notas (envía todos los campos). |

`starts` acepta hora local del negocio (`AAAA-MM-DDTHH:MM`) o ISO con zona (el valor que devuelve la disponibilidad).

Estados y transiciones permitidas:

- pendiente → confirmada o cancelada
- confirmada → completada, cancelada o no presentado
- cancelada → pendiente (reactivar)
- completada y no presentado son definitivas. Solo permiten cambiar las notas.

Solapamientos: una cita activa (pendiente, confirmada o completada) ocupa desde su inicio hasta el fin del servicio más el tiempo de preparación. Dos citas no pueden solaparse, y una cita tampoco puede caer dentro de un bloqueo. Esta regla la aplica la base de datos con triggers (`db/migrations/0004_agenda.sql`), así que se cumple aunque la aplicación falle. Si el hueco está ocupado, la respuesta es `409`.

## Reservas públicas (sin sesión)

Cada negocio tiene un identificador público (`slug`), que aparece en el enlace de reserva: `/reservar.html?n=SLUG`. Estas rutas solo exponen servicios activos y huecos libres; nunca datos de clientes ni de otras citas.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/public/businesses/:slug` | Nombre, zona horaria, horas de cancelación y servicios activos. |
| GET | `/api/public/businesses/:slug/availability?date=AAAA-MM-DD&service_id=ID` | Huecos libres del día para ese servicio. |
| POST | `/api/public/businesses/:slug/bookings` | Solicita una cita. Body: `service_id`, `starts` (ISO de un hueco), `first_name`, `last_name`, `phone`, `email` (opcional), `notes` (opcional), `privacy: true`. |

- Las reservas web entran como **pendientes**. El negocio las confirma desde la agenda.
- Si el teléfono ya existe en el negocio, la reserva usa esa ficha; no se crea un cliente duplicado.
- Antes de guardar, se vuelve a comprobar que el hueco sigue libre (`409` si ya no lo está) y la base de datos vuelve a impedir solapamientos.
- Límite: 10 intentos de reserva por hora y por IP para cada negocio (`429`). Solo se guarda un hash de la IP.

La propietaria puede cambiar las horas de cancelación con `PATCH /api/businesses/:id` (campo `cancel_hours`, entre 0 y 168).

## Resumen del negocio

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| GET | `/api/businesses/:id/dashboard?period=day\|week\|month&date=AAAA-MM-DD` | Todos | Indicadores del periodo que contiene `date` (semana de lunes a domingo; mes completo). |

Respuesta:

- `resumen`: `citas` (sin canceladas), `canceladas`, `no_presentados`, `clientes_nuevos` (fichas creadas en el periodo), `clientes_recurrentes` (clientes con cita en el periodo que ya tenían citas antes), `ingresos_completadas_cents` (suma del precio de las citas completadas), `ocupacion_pct` (minutos con cita frente a minutos de horario abierto, descontando bloqueos; `null` si no hay horario), `por_estado` y `servicios_top`.
- `hoy`: citas de hoy sin canceladas.
- `proximas`: las 5 siguientes pendientes o confirmadas.
- `tareas`: `citas_por_confirmar`, `citas_sin_cerrar` (pasadas y todavía pendientes o confirmadas) y `clientes_inactivos` (última cita completada hace más de 90 días).

Los ingresos son de citas completadas, no de cobros. Los cobros registrados llegarán con la Fase 7.

## Avisos y lista de espera

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| GET | `/api/businesses/:id/notifications` | Propietario, administrador | Estado de la configuración de correo y WhatsApp, y los últimos 100 avisos. El destinatario aparece enmascarado. |
| POST | `/api/businesses/:id/notifications/:nid/retry` | Propietario, administrador | Vuelve a enviar un aviso fallido. |
| GET | `/api/businesses/:id/waitlist` | Todos | Lista de espera. |
| POST | `/api/businesses/:id/waitlist` | Todos | Añade a una persona. Body: `client_id`, `service_id`, `date` (AAAA-MM-DD). |
| DELETE | `/api/businesses/:id/waitlist/:wid` | Todos | Quita a una persona de la lista de espera. |

`PATCH /api/businesses/:id` acepta también `review_url` (solo `https://`, máximo 300 caracteres; vacío para quitarlo).

Avisos que se generan:

- **Confirmación** al crear una cita (o solicitud, si la reserva viene de la web).
- **Aviso al negocio** por correo cuando llega una reserva web.
- **Cambio de hora** y **cancelación**, cuando se modifica una cita.
- **Hueco libre** para la lista de espera, cuando se cancela una cita de ese servicio ese día.
- **Recordatorio** entre 23 y 24 horas antes de la cita.
- **Seguimiento** en las 48 horas posteriores a una visita completada. Incluye el enlace de reseñas solo si el cliente ha aceptado comunicaciones.
- **Reactivación** a los 90 días sin visita, solo con consentimiento de comunicaciones.

Los avisos se procesan cada 10 minutos (Cron Trigger). Si falla un envío se reintenta hasta 5 veces con espera creciente. Sin proveedor configurado quedan pendientes y no se gasta ningún intento. Los avisos se borran a los 180 días.

## Equipo

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| GET | `/api/businesses/:id/team` | Todos | Miembros con su rol, servicios que realizan y horario propio. |
| GET | `/api/businesses/:id/invitations` | Propietario, administrador | Invitaciones pendientes. |
| POST | `/api/businesses/:id/invitations` | Propietario, administrador | Crea una invitación. Body: `role` (`admin` o `employee`), `email` (opcional). Devuelve el enlace una sola vez. |
| DELETE | `/api/businesses/:id/invitations/:iid` | Propietario, administrador | Anula una invitación pendiente. |
| GET | `/api/public/invitations/:token` | Pública | Nombre del negocio y rol que se ofrece. |
| POST | `/api/public/invitations/:token/accept` | Pública | Acepta la invitación. Body: `email`, `password` y, si la cuenta es nueva, `name`. Crea la sesión. |
| PATCH | `/api/businesses/:id/members/:uid` | Propietario | Cambia el rol a `admin` o `employee`. El rol del propietario no se cambia. |
| DELETE | `/api/businesses/:id/members/:uid` | Propietario | Quita a la persona del negocio. No se puede si tiene citas próximas asignadas. |
| PUT | `/api/businesses/:id/members/:uid/services` | Propietario, administrador | Servicios que realiza. Sin ninguno, puede realizar cualquiera. Body: `service_ids`. |
| PUT | `/api/businesses/:id/members/:uid/hours` | Propietario, administrador | Horario propio. Sin días, usa el del negocio. Body: `hours` (igual que el horario del negocio). |

Cada cuenta pertenece a un solo negocio. Un enlace de invitación sirve una sola vez y caduca a los 7 días. Si la invitación tiene correo, solo puede aceptarla esa persona.

## Agenda por profesional

- Las citas aceptan `employee_id`. Sin profesional, la cita queda sin asignar.
- Cada profesional tiene su propia agenda: dos citas solo se solapan si son de la misma persona (o ambas sin asignar). Los bloqueos sin profesional afectan a todos.
- `GET /availability` acepta `employee_id`. Sin él, si el servicio tiene profesionales asignados, devuelve la unión de sus huecos.
- La reserva pública acepta `employee_id` opcional. Si no se elige, se asigna a la primera persona que tenga libre ese hueco.

## Cobros

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| GET | `/api/businesses/:id/appointments/:aid/payments` | Todos | Cobros de la cita, cobrado y pendiente. |
| POST | `/api/businesses/:id/appointments/:aid/payments` | Todos (devoluciones: propietario y administrador) | Registra un cobro o una devolución. Body: `amount` (€), `method` (`efectivo`, `tarjeta`, `transferencia`, `otro`), `kind` (`pago` o `devolucion`), `note` (opcional). |

- No se puede cobrar más del precio de la cita, ni devolver más de lo cobrado. Los límites se comprueban dentro de la misma escritura en la base de datos.
- No se registran cobros de citas canceladas.
- No se guarda ningún dato de tarjeta: solo el medio de pago.
- El gasto total de cada clienta aparece en su ficha (`total_gastado_cents`).
- El resumen incluye `ingresos_cobrados_cents` y `pagos_pendientes_cents`.
