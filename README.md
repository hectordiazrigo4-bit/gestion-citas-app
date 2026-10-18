# Gestión de citas y clientes

Aplicación web SaaS para negocios que trabajan con citas: peluquerías, centros de estética, estudios de tatuajes, fisioterapeutas, entrenadores personales y profesionales independientes.

Cada negocio tiene sus datos completamente separados. Se usa desde móvil, tablet y ordenador.

## Estado actual

Fase 1 en curso: documentación de la arquitectura y estructura inicial del proyecto. Todavía no hay funcionalidades.

## Fases previstas

1. Análisis y documentación de la arquitectura.
2. Autenticación, negocios, roles y base de datos.
3. Servicios, clientes y calendario.
4. Reservas online y prevención de solapamientos.
5. Dashboard y estadísticas.
6. Recordatorios y automatizaciones reales.
7. Empleados, pagos y permisos avanzados.
8. Suscripciones, pruebas y despliegue.

Más detalle en [docs/arquitectura.md](docs/arquitectura.md).

## Estructura de carpetas

```
web/            Interfaz (HTML, CSS, JavaScript): panel, agenda y reservas públicas
worker/         API y tareas programadas (Cloudflare Workers)
db/migrations/  Cambios de la base de datos (D1), numerados y revisables
docs/           Documentación del proyecto
```

## Requisitos

- Cuenta de Cloudflare (Pages, Workers y D1 tienen plan gratuito para empezar).
- Node.js 20 o superior, para ejecutar las herramientas de desarrollo.

## Secretos

Las claves privadas (API de correo, WhatsApp, Stripe) nunca van en el código ni en el repositorio. Se guardan como variables de entorno o secretos de Cloudflare. Ver la sección correspondiente en `docs/arquitectura.md`.
