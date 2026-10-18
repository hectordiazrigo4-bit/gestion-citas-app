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
- [ ] Fase 3: servicios, clientes y calendario.
- [ ] Fase 4: reservas online y prevención de solapamientos.
- [ ] Fase 5: dashboard y estadísticas.
- [ ] Fase 6: recordatorios y automatizaciones.
- [ ] Fase 7: empleados, pagos y permisos avanzados.
- [ ] Fase 8: suscripciones, pruebas y despliegue.
