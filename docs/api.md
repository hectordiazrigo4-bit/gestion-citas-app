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
