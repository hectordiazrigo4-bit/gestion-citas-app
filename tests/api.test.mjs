// Pruebas de la API contra un servidor en marcha (npm run dev).
// Uso: npm run dev (en otra terminal) y después npm run test:api.
// Cada ejecución crea su propio negocio y sus propios correos, así que se puede repetir.

import { test } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.API_URL || "http://localhost:8787";
const PASSWORD = "contraseña-segura-123";
const sufijo = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
// Cada ejecución usa IPs distintas para que el límite de intentos no afecte a otras pruebas.
const ipAleatoria = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

async function peticion(method, path, { body, cookie, ip } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  if (ip) headers["cf-connecting-ip"] = ip;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const texto = await res.text();
  let datos = null;
  try { datos = JSON.parse(texto); } catch { /* respuesta no JSON (p. ej. exportación) */ }
  const cookieNueva = res.headers.get("set-cookie");
  return {
    status: res.status,
    datos,
    texto,
    headers: res.headers,
    cookie: cookieNueva ? cookieNueva.split(";")[0] : null,
  };
}

// Crea una cuenta con su negocio y devuelve la cookie de sesión.
async function cuentaNueva(nombre) {
  const correo = `${nombre}-${sufijo}@ejemplo.com`;
  const reg = await peticion("POST", "/api/auth/register", {
    body: { name: nombre, email: correo, password: PASSWORD, businessName: `Negocio ${nombre} ${sufijo}` },
    ip: ipAleatoria(),
  });
  assert.equal(reg.status, 201, "el registro debe funcionar");
  return { cookie: reg.cookie, negocioId: reg.datos.businessId, correo };
}

test("el login se bloquea tras 10 fallos del mismo correo", async () => {
  const correo = `limite-${sufijo}@ejemplo.com`;
  const ip = ipAleatoria();
  for (let i = 1; i <= 10; i++) {
    const res = await peticion("POST", "/api/auth/login", { body: { email: correo, password: "incorrecta-000000" }, ip });
    assert.equal(res.status, 401, `intento ${i} debe ser un fallo normal`);
  }
  const bloqueado = await peticion("POST", "/api/auth/login", { body: { email: correo, password: "incorrecta-000000" }, ip });
  assert.equal(bloqueado.status, 429);
  assert.match(bloqueado.datos.error, /15 minutos/);
});

test("un fallo de login de otro correo no bloquea la cuenta", async () => {
  const otro = await cuentaNueva("otro");
  const res = await peticion("POST", "/api/auth/login", { body: { email: otro.correo, password: PASSWORD }, ip: ipAleatoria() });
  assert.equal(res.status, 200);
});

test("la ficha del cliente muestra historial y cifras", async () => {
  const cuenta = await cuentaNueva("historial");
  const cliente = await peticion("POST", `/api/businesses/${cuenta.negocioId}/clients`, {
    body: { first_name: "Ana", last_name: "Prueba", phone: "600111222" },
    cookie: cuenta.cookie,
  });
  assert.equal(cliente.status, 201);
  const ficha = await peticion("GET", `/api/businesses/${cuenta.negocioId}/clients/${cliente.datos.client.id}`, { cookie: cuenta.cookie });
  assert.equal(ficha.status, 200);
  assert.deepEqual(ficha.datos.client.citas, []);
  assert.equal(ficha.datos.client.ultima_visita, null);
  assert.equal(ficha.datos.client.proxima_cita, null);
  assert.equal(ficha.datos.client.total_gastado_cents, 0);
});

test("exportar y anonimizar un cliente", async () => {
  const cuenta = await cuentaNueva("rgpd");
  const base = `/api/businesses/${cuenta.negocioId}/clients`;
  const creado = await peticion("POST", base, {
    body: { first_name: "Luis", last_name: "Exporta", phone: "600333444", email: "luis@ejemplo.com", notes: "Alérgico", tags: ["vip"], marketing_consent: true },
    cookie: cuenta.cookie,
  });
  const id = creado.datos.client.id;

  const exportado = await peticion("GET", `${base}/${id}/export`, { cookie: cuenta.cookie });
  assert.equal(exportado.status, 200);
  assert.match(exportado.headers.get("content-disposition"), /attachment/);
  assert.equal(exportado.datos.cliente.nombre, "Luis");
  assert.equal(exportado.datos.cliente.correo, "luis@ejemplo.com");

  const anonimizado = await peticion("POST", `${base}/${id}/anonymize`, { body: {}, cookie: cuenta.cookie });
  assert.equal(anonimizado.status, 200);

  const despues = await peticion("GET", `${base}/${id}`, { cookie: cuenta.cookie });
  const c = despues.datos.client;
  assert.equal(c.first_name, "Anonimizado");
  assert.equal(c.last_name, "");
  assert.equal(c.phone, null);
  assert.equal(c.email, null);
  assert.equal(c.notes, null);
  assert.deepEqual(c.tags, []);
  assert.equal(c.marketing_consent, false);
});

test("un negocio ajeno no puede exportar ni anonimizar", async () => {
  const dueno = await cuentaNueva("dueno");
  const otro = await cuentaNueva("intruso");
  const creado = await peticion("POST", `/api/businesses/${dueno.negocioId}/clients`, {
    body: { first_name: "Marta", last_name: "Privada", phone: "600555666" },
    cookie: dueno.cookie,
  });
  const id = creado.datos.client.id;

  const exportado = await peticion("GET", `/api/businesses/${dueno.negocioId}/clients/${id}/export`, { cookie: otro.cookie });
  assert.equal(exportado.status, 404);
  const anonimizado = await peticion("POST", `/api/businesses/${dueno.negocioId}/clients/${id}/anonymize`, { body: {}, cookie: otro.cookie });
  assert.equal(anonimizado.status, 404);
});
