# Arquitectura

## Decisiones principales

| Necesidad | Solución | Motivo |
|---|---|---|
| Frontend (panel, agenda, reservas públicas) | Cloudflare Pages | Ya se usa Cloudflare; hosting estático gratuito. |
| API y lógica de negocio | Cloudflare Workers | Mismo proveedor, sin servidor propio, coste bajo. |
| Base de datos | Cloudflare D1 (SQLite) | Incluida en Cloudflare, sin coste fijo al empezar. |
| Recordatorios y tareas programadas | Cron Triggers de Workers | Se ejecutan sin tener la app abierta. |
| Correo electrónico | Proveedor transaccional (a elegir en Fase 6) | Requiere dominio verificado. |
| WhatsApp | API oficial de WhatsApp Business (Fase 6) | Requiere plantillas aprobadas y cuenta de negocio. |
| Pagos | Stripe, preparado pero desactivado (Fase 7) | No se cobra nada hasta probarlo. |

Alternativa considerada: Supabase, con Row Level Security (RLS) en la propia base de datos. Es más segura por defecto, pero añade un segundo proveedor. Se mantiene como plan B.

## Aislamiento entre negocios

- Cada tabla de datos del negocio tiene una columna `business_id`.
- El Worker obtiene el negocio del usuario autenticado y **nunca** lo toma de la petición del navegador.
- Todas las consultas filtran por `business_id` en el servidor.
- D1 no tiene RLS, así que esta comprobación debe estar en el código y cubierta por pruebas.

## Un negocio por cuenta

Cada cuenta trabaja con un único negocio. La restricción está en la base de datos (`db/migrations/0002_un_negocio_por_usuario.sql`), así que ningún fallo de la aplicación puede asignar dos negocios a la misma persona. Los empleados se añadirán más adelante como usuarios vinculados al negocio del propietario.

## Permisos por rol

| Acción | Propietario | Administrador | Empleado |
|---|---|---|---|
| Ver agenda, clientes, resumen y equipo | Sí | Sí | Sí |
| Crear, editar y cancelar citas, y registrar cobros | Sí | Sí | Sí |
| Devolver cobros | Sí | Sí | No |
| Servicios, horario del negocio, bloqueos y ajustes | Sí | Sí | No |
| Invitar personas, cambiar su servicio y horario | Sí | Sí | No |
| Cambiar roles y quitar personas | Sí | No | No |
| Cambiar el nombre del negocio y la política de cancelación | Sí | Sí | No |
| Ver el historial de avisos y reintentar fallidos | Sí | Sí | No |

El aislamiento entre negocios se comprueba en el servidor, en cada ruta, y con el mismo criterio: un negocio ajeno responde 404.

## Roles previstos

- **Propietario:** todo el negocio, incluida la facturación.
- **Administrador:** todo excepto la facturación y la eliminación del negocio.
- **Empleado:** su agenda y sus clientes asignados.
- **Cliente:** solo sus propias citas, cuando exista acceso de cliente.

## Secretos y variables de entorno

Nunca se suben al repositorio. Se configuran en Cloudflare (`wrangler secret put NOMBRE`) o en el panel de Pages/Workers.

| Variable | Uso | Fase |
|---|---|---|
| `SESSION_SECRET` | Firma de sesiones | 2 |
| `EMAIL_API_KEY` | Envío de correos | 6 |
| `WHATSAPP_TOKEN` | API de WhatsApp Business | 6 |
| `STRIPE_SECRET_KEY` | Cobros futuros | 7 |

## Estructura del repositorio

```
web/            Frontend
worker/         Código del Worker (API y cron)
db/migrations/  Migraciones de D1
docs/           Documentación
```

## Estado de las fases

- [x] Fase 1: documentación y estructura inicial.
- [x] Fase 2: autenticación, negocios, roles y base de datos (registro, inicio de sesión, sesiones, roles y aislamiento por negocio; pendientes de producción en `docs/despliegue.md`).
- [x] Fase 3: servicios, clientes y calendario (ver [api.md](api.md)).
- [x] Fase 4: horarios, bloqueos, disponibilidad, prevención de solapamientos y página pública de reservas (ver [api.md](api.md)).
- [x] Fase 5: resumen con indicadores reales por día, semana y mes (ver [api.md](api.md)). Los cobros reales quedan para la Fase 7.
- [x] Fase 6: avisos automáticos y lista de espera (ver [api.md](api.md) y [despliegue.md](despliegue.md)). El envío real depende de configurar el correo y WhatsApp.
- [x] Fase 7: equipo con invitaciones, roles, servicios y horario por profesional, agenda por profesional, cobros manuales y devoluciones (ver [api.md](api.md)). Pendiente: integración con Stripe, que no se ha construido.
- [ ] Fase 8: suscripciones, pruebas y despliegue.
