# Auditoría técnica de CitaPro

Auditoría de solo lectura. No se modificó ningún archivo de la aplicación, ni se desplegó ni se aplicaron migraciones.

Leyenda: **[comprobado]** = verificado en el código o la configuración. **[pendiente]** = requiere una prueba en producción o consultar precios actuales.

## 1. Tecnologías
- Lenguaje: JavaScript (módulos ES) en el Worker y en el frontend. Sin TypeScript. **[comprobado]**
- Plataforma: Cloudflare Workers con Static Assets para `web/`, D1 (SQLite) como base de datos y Cron Triggers para los avisos. **[comprobado]** (`wrangler.toml`)
- Frontend: HTML, CSS y JavaScript sin frameworks ni proceso de compilación. **[comprobado]**
- Dependencias de ejecución: ninguna. Solo `wrangler` como herramienta de desarrollo. **[comprobado]** (`package.json`)
- Criptografía: Web Crypto nativa (PBKDF2-SHA256 con 100.000 iteraciones; SHA-256 para tokens). **[comprobado]**

## 2. Estructura
- `worker/src/`: API (auth y negocio en `index.js`, `http.js`, `crypto.js`, `citas.js`, `disponibilidad.js`, `tiempo.js`, `clientes`, `services.js`, `publica.js`, `avisos.js`, `proveedores.js`, `panel.js`, `equipo.js`, `cobros.js`). **[comprobado]**
- `worker/test/`: 3 archivos de pruebas unitarias (15 pruebas). **[comprobado]**
- `web/`: panel (`index.html`, `app.js`), reserva pública (`reservar.html`, `reservar.js`), invitación (`unirse.html`, `unirse.js`), `styles.css`, `sw.js`, `registro-sw.js`, `manifest.webmanifest`, `_headers`, iconos. **[comprobado]**
- `db/migrations/`: 7 migraciones (0001 a 0007). **[comprobado]**
- `docs/`: arquitectura, API y despliegue. **[comprobado]**
- `.wrangler/` existe en local, está en `.gitignore` y no se versiona. **[comprobado]**

## 3. Comandos
| Acción | Comando | Estado |
|---|---|---|
| Instalar | `npm install` | **[comprobado]** |
| Desarrollo | `npm run dev` | **[comprobado]** |
| Pruebas | `npm test` | **[comprobado]**: 15 pasan |
| Migraciones locales | `npm run db:migrate:local` | **[comprobado]** |
| Migraciones remotas | `npm run db:migrate:remote` | **[comprobado]**: aplicadas y registradas en `d1_migrations` |
| Publicar | Despliegue automático desde GitHub, o `npm run deploy` | **[comprobado]** |

## 4. Base de datos y autenticación
- D1 con 17 tablas y 3 disparadores que impiden solapar citas. **[comprobado]** en producción.
- Aislamiento por negocio: las consultas filtran por `business_id`. Las consultas por `id` lo incluyen; la excepción es `datosCliente` en `avisos.js`, que solo se llama con IDs ya validados. **[comprobado]** (revisión por muestreo)
- Acceso: correo y contraseña. Cookie `HttpOnly`, `Secure`, `SameSite=Lax`, 30 días; el token se guarda como hash. **[comprobado]**
- Las peticiones que cambian datos exigen JSON, lo que bloquea formularios de otras webs. **[comprobado]**
- Roles: propietario, administrador y empleado, comprobados en el servidor. **[comprobado]**

## 5. Servicios externos y costes
| Servicio | Uso | Coste inicial | Estado |
|---|---|---|---|
| Cloudflare Workers | API y web | Plan gratuito | **[pendiente]**: confirmar límites actuales |
| Cloudflare D1 | Base de datos | Plan gratuito | **[pendiente]**: confirmar límites y si Time Travel sirve para copias |
| Cron Triggers | Avisos cada 10 minutos | Incluido | **[pendiente]**: confirmar en el plan |
| Resend | Correo de avisos | Gratis hasta 3.000 correos/mes | **[pendiente]**: no configurado |
| WhatsApp Cloud API (Meta) | Avisos por WhatsApp | Coste por conversación | **[pendiente]**: no configurado; plantillas sin aprobar |
| Stripe | Cobros online | Comisión por transacción | No implementado **[comprobado]** |

## 6. Funcionalidades existentes
- Negocio: registro, nombre, enlace público, horas de cancelación y enlace de reseñas (solo https). **[comprobado]**
- Servicios: alta, edición, activación y borrado (bloqueado si tiene citas). **[comprobado]**
- Clientes: ficha, búsqueda, etiquetas, notas, consentimiento, teléfono único por negocio y gasto total. **[comprobado]**
- Agenda: vistas de día, semana y mes; crear, reprogramar, cancelar y cambiar estado; horario semanal; bloqueos y vacaciones. **[comprobado]**
- Disponibilidad: huecos cada 15 minutos según horario, duración, preparación, citas y bloqueos, con zona horaria `Europe/Madrid`. **[comprobado]**
- Reserva pública: sin sesión, huecos libres, solicitud pendiente, código de confirmación, límite de 10 intentos por hora y por IP, aceptación de privacidad. **[comprobado]**
- Avisos: cola con reintentos, recordatorios, seguimiento, reactivación con consentimiento y lista de espera. **[comprobado]** con proveedor simulado en local. Sin proveedor real quedan pendientes. **[comprobado]**
- Resumen: indicadores por día, semana o mes. **[comprobado]**
- Equipo: invitaciones de un solo uso, roles, servicios y horario por profesional, agenda separada por profesional. **[comprobado]**
- Cobros: registro manual con medio de pago, devoluciones y límites en la base de datos. **[comprobado]**
- App instalable: manifiesto, iconos CitaPro y servicio de caché que no guarda datos. **[comprobado]** en local. Instalación en móvil real **[pendiente]**.

## 7. Problemas encontrados

### Críticos
1. **Sin límite de intentos al iniciar sesión.** No hay protección frente a fuerza bruta en `/api/auth/login`. **[comprobado]**
2. **Conflicto con el derecho de supresión (RGPD).** Un cliente con citas no se puede borrar (409) y no hay anonimización. No hay exportación de datos ni borrado de cuenta de usuario. **[comprobado]**
3. **Falta la política de privacidad publicada.** La casilla de reserva la menciona, pero no existe la página. **[comprobado]**
4. **Despliegue sin revisión ni entorno de pruebas.** Cada cambio en `main` se publica en producción automáticamente, y solo hay una base de datos. **[comprobado]**

### Importantes
5. **La ficha del cliente no muestra su historial de citas.** Solo muestra contacto, gasto total y etiquetas. **[comprobado]**
6. **Las pruebas de integración no están en el repositorio.** Solo hay 15 pruebas unitarias versionadas. **[comprobado]**
7. **Reservas web sin verificación del teléfono.** Cualquiera puede reservar con el teléfono de otra persona, y la reserva queda asociada a su ficha. **[comprobado]** (riesgo bajo-medio)
8. **Protección limitada contra abuso en la reserva pública.** El límite es por IP y no hay CAPTCHA. **[comprobado]**
9. **Sin cambio ni recuperación de contraseña, ni cierre de todas las sesiones.** **[comprobado]**
10. **Entorno local.** Al cambiar el identificador de la base, la base local queda vacía y hay que ejecutar `npm run db:migrate:local`. **[comprobado]**

### Menores
11. **Diseño en tablet y escritorio sin revisar.** Solo se ha revisado móvil de 390 píxeles. **[pendiente]**
12. **Accesibilidad sin auditar.** **[pendiente]**
13. **Perfil del negocio básico.** No tiene dirección, teléfono de contacto ni logotipo. **[comprobado]**
14. **Cabeceras de seguridad solo en la web estática.** Las respuestas JSON no llevan CSP, lo que es aceptable. Falta confirmar que `_headers` se aplica en producción. **[pendiente]**

## 8. Funcionalidades reutilizables
- Motor de disponibilidad y solapamientos (`disponibilidad.js`, `tiempo.js` y los disparadores de la base).
- Control de acceso centralizado (`requireBusinessAccess` en `http.js`).
- Cola de avisos con reintentos (`avisos.js`, `proveedores.js`).
- Página pública de reserva (base de la app del cliente).
- Manifiesto y servicio de caché por negocio (`publica.js`, `sw.js`).

## 9. Plan por fases
- **Fase A (endurecimiento antes de abrir a clientes reales):** límite de intentos de login; política de privacidad publicada y enlazada; anonimización y exportación de datos del cliente; entorno de pruebas separado y revisión antes de `main`; verificación del teléfono en reservas web; historial de citas en la ficha; pruebas de integración en el repositorio.
- **Fase B (experiencia del cliente):** cuenta de cliente con teléfono o correo, próximas citas e historial, y petición de cancelar o cambiar dentro del plazo.
- **Fase C (activación):** Resend con dominio verificado; plantillas de WhatsApp aprobadas; Stripe solo si se decide cobrar online.
- **Fase D (calidad):** revisión en tablet y escritorio, auditoría de accesibilidad y perfil completo del negocio.

## 10. Archivos por fase
- **A:** `worker/src/index.js` (límite de login), `worker/src/clients.js` (anonimizar y exportar), `worker/src/publica.js` (verificación de teléfono), `web/reservar.html` y `web/app.js` (historial y enlace a privacidad), `worker/test/` (pruebas de integración), `wrangler.toml` (entorno de pruebas), nueva página de privacidad.
- **B:** nuevos `worker/src/cuentas-cliente.js` y `web/cliente.html`; `worker/src/index.js`; nueva migración en `db/migrations/`.
- **C:** `wrangler.toml` y secretos; `worker/src/proveedores.js` solo si cambia la API.
- **D:** `web/styles.css`, `web/index.html`, `web/reservar.html`, `worker/src/clients.js` o `publica.js` (perfil del negocio).

## 11. Pruebas antes de publicar
- Unitarias y de integración del Worker, incluidas las de API.
- Login con varios intentos fallidos.
- Solapamientos con peticiones simultáneas en un entorno de pruebas.
- Aislamiento entre dos negocios.
- Reserva pública completa desde móvil real (Android e iPhone).
- Instalación de la app en móvil real.
- Aviso real con el proveedor configurado.
- Restauración de copia de seguridad.
- Cabeceras de seguridad en producción.
