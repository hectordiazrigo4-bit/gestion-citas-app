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
- Eliminar un servicio o un cliente es permanente. Cuando existan citas, los servicios con historial se desactivarán en lugar de borrarse.
