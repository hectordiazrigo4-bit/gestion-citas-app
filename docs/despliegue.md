# Despliegue y uso en local

## Probar en tu ordenador

1. Instala las dependencias (una sola vez):
   ```
   npm install
   ```
2. Aplica la base de datos local (repetir cuando haya migraciones nuevas):
   ```
   npm run db:migrate:local
   ```
3. Arranca la app:
   ```
   npm run dev
   ```
4. Abre `http://localhost:8787` en el navegador.
5. Pruebas automáticas:
   ```
   npm test
   ```
6. Pruebas de la API (con la app arrancada en el paso 3, en otra terminal):
   ```
   npm run test:api
   ```

## Base de datos en Cloudflare

La base `gestion-citas` (región Europa Occidental) ya está creada en tu cuenta y tiene aplicadas las migraciones 0001 a 0007. Su identificador está en `wrangler.toml`. Si algún día hay que crear otra, sigue estos pasos:

1. Entra en `https://dash.cloudflare.com` y ve a **Storage & Databases → D1 SQL Database**.
2. Pulsa **Create Database**, nombre `gestion-citas`, y confirma.
3. Copia el **Database ID** que aparece en la página de la base de datos.
4. Pega ese ID en `wrangler.toml`, en `database_id`, sustituyendo `REEMPLAZAR_CON_ID_DE_D1`.
5. Aplica las migraciones a la base de datos real:
   ```
   npm run db:migrate:remote
   ```

## Publicar

```
npm run deploy
```

En esta fase no hace falta ningún secreto: las sesiones usan tokens aleatorios guardados como hash en D1.

## Notas de seguridad

- Las contraseñas se guardan con PBKDF2-SHA256 (100.000 iteraciones) y sal aleatoria.
- Las sesiones usan una cookie `HttpOnly`, `Secure` y `SameSite=Lax`, con caducidad de 30 días. En la base de datos solo se guarda el hash del token.
- Las peticiones que cambian datos deben ser JSON. Así un formulario de otra web no puede actuar en nombre del usuario.
- Un usuario solo ve sus negocios. Si pide uno ajeno, la respuesta es `404`, igual que si no existiera.
- Los roles se comprueban en el servidor, nunca solo en la pantalla.

## Pendiente antes de producción

- Revisar `web/privacidad.html`: es un borrador con datos entre corchetes que deben completarse y revisarse con un asesor legal. La casilla de reservas enlaza a esa página.
- Confirmaciones por correo y WhatsApp de las reservas: llegan en la Fase 6, cuando se configuren el proveedor de correo y la API de WhatsApp. Hasta entonces la página muestra la confirmación en pantalla y no se simula ningún envío.
- Aplicar también las migraciones 0002 a 0008 en la base real (`npm run db:migrate:remote`). La 0008 es imprescindible para el inicio de sesión: sin ella la app responde con error al entrar.
- Límite de intentos de inicio de sesión: 10 intentos fallidos por correo y 30 por IP cada 15 minutos (ya implementado).
- Derechos del cliente: exportar sus datos en JSON y anonimizar la ficha desde el panel (ya implementado).
- Recuperación de contraseña.
- Verificación del correo al registrarse.
- Copias de seguridad automáticas de D1 (revisar el plan de Cloudflare).

## Avisos automáticos (correo y WhatsApp)

Las claves se configuran como secretos. Nunca se suben al repositorio. Para probar en local, pásalas con `--var` o en `.dev.vars` (ese archivo está en `.gitignore`).

En Cloudflare, por cada secreto: `npx wrangler secret put NOMBRE` y pegar el valor.

| Variable | Qué es |
|---|---|
| `RESEND_API_KEY` | Clave de API de Resend (plan gratuito: 3.000 correos al mes). |
| `EMAIL_FROM` | Remitente. Debe ser un dominio verificado en Resend, p. ej. `Avisos <avisos@tudominio.com>`. |
| `WHATSAPP_TOKEN` | Token de acceso de la API de WhatsApp Cloud (Meta). |
| `WHATSAPP_PHONE_ID` | Identificador del número de WhatsApp Business. |
| `WHATSAPP_TPL_CONFIRMACION`, `WHATSAPP_TPL_RECORDATORIO`, `WHATSAPP_TPL_CANCELACION`, `WHATSAPP_TPL_CAMBIO_HORA`, `WHATSAPP_TPL_HUECO_LIBRE` | Nombre de cada plantilla aprobada en Meta. Sus parámetros, en este orden: negocio, servicio, fecha y hora. |
| `WHATSAPP_TPL_SEGUIMIENTO`, `WHATSAPP_TPL_REACTIVACION` | Plantillas con un único parámetro: el nombre del negocio. |

Notas:

- Las plantillas de WhatsApp deben crearse y aprobarse en Meta antes de usarse. Mientras no estén aprobadas, esos avisos van por correo si el cliente tiene correo.
- El correo de avisos al negocio (reservas web) siempre va por correo.
- Sin ninguna clave configurada, los avisos quedan en la cola como **pendientes**. El panel lo indica.
- Antes de publicar, la política de privacidad y los textos legales deben revisarse.
- Cron: el proceso se ejecuta cada 10 minutos (`[triggers]` en `wrangler.toml`).
