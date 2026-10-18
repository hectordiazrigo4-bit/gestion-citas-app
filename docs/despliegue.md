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

## Crear la base de datos en Cloudflare (una sola vez)

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

- Límite de intentos de inicio de sesión (protección frente a fuerza bruta).
- Recuperación de contraseña.
- Verificación del correo al registrarse.
- Copias de seguridad automáticas de D1 (revisar el plan de Cloudflare).
