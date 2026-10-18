import { hashPassword, verifyPassword, createSessionToken, hashToken } from "./crypto.js";
import {
  COOKIE_NAME,
  SESSION_TTL_MS,
  HttpError,
  json,
  readJson,
  isJsonRequest,
  requireText,
  parseEmail,
  parsePassword,
  requireUser,
  requireBusinessAccess,
  sessionCookie,
  clearSessionCookie,
  readCookie,
} from "./http.js";
import { listServices, createService, updateService, deleteService } from "./services.js";
import { listClients, createClient, getClient, updateClient, deleteClient } from "./clients.js";
import { listAppointments, createAppointment, updateAppointment } from "./citas.js";
import { getHours, saveHours, listBlocks, createBlock, deleteBlock, getAvailability } from "./disponibilidad.js";
import { generarSlug, getPublicBusiness, getPublicAvailability, crearReservaPublica } from "./publica.js";

const ID = "([0-9a-f-]{36})";
const RUTA_NEGOCIO = new RegExp(`^/api/businesses/${ID}$`);
const RUTA_SERVICIOS = new RegExp(`^/api/businesses/${ID}/services(?:/${ID})?$`);
const RUTA_CLIENTES = new RegExp(`^/api/businesses/${ID}/clients(?:/${ID})?$`);
const RUTA_CITAS = new RegExp(`^/api/businesses/${ID}/appointments(?:/${ID})?$`);
const RUTA_DISPONIBILIDAD = new RegExp(`^/api/businesses/${ID}/availability$`);
const RUTA_HORARIO = new RegExp(`^/api/businesses/${ID}/hours$`);
const RUTA_BLOQUEOS = new RegExp(`^/api/businesses/${ID}/blocks(?:/${ID})?$`);
const RUTA_PUBLICA = /^\/api\/public\/businesses\/([a-z0-9-]{3,80})(\/availability|\/bookings)?$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }
    try {
      return await route(request, env, url);
    } catch (err) {
      if (err instanceof HttpError) {
        return json({ error: err.message }, err.status);
      }
      // Solo se registra el tipo de error, nunca datos personales.
      console.error("error_api", err && err.name);
      return json({ error: "Ha ocurrido un error. Inténtalo de nuevo." }, 500);
    }
  },
};

async function route(request, env, url) {
  const { pathname } = url;
  const method = request.method;

  if (method !== "GET" && !isJsonRequest(request)) {
    // Obligar a JSON evita que un formulario de otra web haga peticiones válidas (protección CSRF).
    throw new HttpError(415, "Formato de petición no admitido");
  }

  if (method === "POST" && pathname === "/api/auth/register") return register(request, env);
  if (method === "POST" && pathname === "/api/auth/login") return login(request, env);
  if (method === "POST" && pathname === "/api/auth/logout") return logout(request, env);
  if (method === "GET" && pathname === "/api/me") return me(request, env);

  let m = pathname.match(RUTA_PUBLICA);
  if (m) {
    const [, slug, accion] = m;
    if (!accion && method === "GET") return getPublicBusiness(request, env, slug);
    if (accion === "/availability" && method === "GET") return getPublicAvailability(request, env, slug, url);
    if (accion === "/bookings" && method === "POST") return crearReservaPublica(request, env, slug);
  }

  m = pathname.match(RUTA_NEGOCIO);
  if (m) {
    if (method === "GET") return getBusiness(request, env, m[1]);
    if (method === "PATCH") return updateBusiness(request, env, m[1]);
  }

  m = pathname.match(RUTA_SERVICIOS);
  if (m) {
    const [, businessId, serviceId] = m;
    if (!serviceId && method === "GET") return listServices(request, env, businessId);
    if (!serviceId && method === "POST") return createService(request, env, businessId);
    if (serviceId && method === "PATCH") return updateService(request, env, businessId, serviceId);
    if (serviceId && method === "DELETE") return deleteService(request, env, businessId, serviceId);
  }

  m = pathname.match(RUTA_CLIENTES);
  if (m) {
    const [, businessId, clientId] = m;
    if (!clientId && method === "GET") return listClients(request, env, businessId, url);
    if (!clientId && method === "POST") return createClient(request, env, businessId);
    if (clientId && method === "GET") return getClient(request, env, businessId, clientId);
    if (clientId && method === "PATCH") return updateClient(request, env, businessId, clientId);
    if (clientId && method === "DELETE") return deleteClient(request, env, businessId, clientId);
  }

  m = pathname.match(RUTA_CITAS);
  if (m) {
    const [, businessId, appointmentId] = m;
    if (!appointmentId && method === "GET") return listAppointments(request, env, businessId, url);
    if (!appointmentId && method === "POST") return createAppointment(request, env, businessId);
    if (appointmentId && method === "PATCH") return updateAppointment(request, env, businessId, appointmentId);
  }

  m = pathname.match(RUTA_DISPONIBILIDAD);
  if (m && method === "GET") return getAvailability(request, env, m[1], url);

  m = pathname.match(RUTA_HORARIO);
  if (m) {
    if (method === "GET") return getHours(request, env, m[1]);
    if (method === "PUT") return saveHours(request, env, m[1]);
  }

  m = pathname.match(RUTA_BLOQUEOS);
  if (m) {
    const [, businessId, blockId] = m;
    if (!blockId && method === "GET") return listBlocks(request, env, businessId, url);
    if (!blockId && method === "POST") return createBlock(request, env, businessId);
    if (blockId && method === "DELETE") return deleteBlock(request, env, businessId, blockId);
  }

  throw new HttpError(404, "No encontrado");
}

// ---------- Autenticación ----------

async function register(request, env) {
  const body = await readJson(request);
  const name = requireText(body.name, "nombre", 100);
  const email = parseEmail(body.email);
  const password = parsePassword(body.password);
  const businessName = requireText(body.businessName, "nombre del negocio", 120);

  const userId = crypto.randomUUID();
  const businessId = crypto.randomUUID();
  const slug = generarSlug(businessName);
  const now = Date.now();
  const passwordHash = await hashPassword(password);
  const session = await newSession(env, userId, now);

  // Todo en una sola transacción: si algo falla, no queda usuario sin negocio.
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)"
      ).bind(userId, email, passwordHash, name, now),
      env.DB.prepare("INSERT INTO businesses (id, name, slug, created_at) VALUES (?, ?, ?, ?)").bind(
        businessId,
        businessName,
        slug,
        now
      ),
      env.DB.prepare(
        "INSERT INTO memberships (user_id, business_id, role, created_at) VALUES (?, ?, 'owner', ?)"
      ).bind(userId, businessId, now),
      session.statement,
    ]);
  } catch (err) {
    // No se indica si el correo ya existe, para no revelar qué cuentas hay.
    if (String(err.message).includes("UNIQUE")) {
      throw new HttpError(409, "No se ha podido crear la cuenta. Si ya tienes una, inicia sesión.");
    }
    throw err;
  }

  return json({ user: { id: userId, email, name }, businessId }, 201, sessionCookie(session.token));
}

async function login(request, env) {
  const body = await readJson(request);
  const email = parseEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";

  const user = await env.DB.prepare("SELECT id, email, name, password_hash FROM users WHERE email = ?")
    .bind(email)
    .first();

  if (!user) {
    // Se calcula igualmente un hash para tardar lo mismo que con un usuario existente.
    await hashPassword(password);
    throw new HttpError(401, "Correo o contraseña incorrectos");
  }
  if (!(await verifyPassword(password, user.password_hash))) {
    throw new HttpError(401, "Correo o contraseña incorrectos");
  }

  const session = await newSession(env, user.id, Date.now());
  await session.statement.run();

  return json({ user: { id: user.id, email: user.email, name: user.name } }, 200, sessionCookie(session.token));
}

async function logout(request, env) {
  const token = readCookie(request, COOKIE_NAME);
  if (token) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await hashToken(token)).run();
  }
  return json({ ok: true }, 200, clearSessionCookie());
}

async function me(request, env) {
  const user = await requireUser(request, env);
  const { results } = await env.DB.prepare(
    `SELECT b.id, b.name, m.role
       FROM memberships m
       JOIN businesses b ON b.id = m.business_id
      WHERE m.user_id = ?
      ORDER BY b.name`
  )
    .bind(user.id)
    .all();

  return json({ user: { id: user.id, email: user.email, name: user.name }, businesses: results });
}

// ---------- Negocio ----------

async function getBusiness(request, env, businessId) {
  const { role } = await requireBusinessAccess(request, env, businessId);
  const business = await env.DB.prepare("SELECT id, name, slug, cancel_hours, created_at FROM businesses WHERE id = ?")
    .bind(businessId)
    .first();

  return json({ business: { ...business, role } });
}

async function updateBusiness(request, env, businessId) {
  const { role } = await requireBusinessAccess(request, env, businessId, ["owner", "admin"]);
  const body = await readJson(request);
  const name = requireText(body.name, "nombre del negocio", 120);
  const horasCancelacion = body.cancel_hours === undefined ? 24 : Number(body.cancel_hours);
  if (!Number.isInteger(horasCancelacion) || horasCancelacion < 0 || horasCancelacion > 168) {
    throw new HttpError(400, "Las horas de cancelación deben ser un número entero entre 0 y 168");
  }
  await env.DB.prepare("UPDATE businesses SET name = ?, cancel_hours = ? WHERE id = ?")
    .bind(name, horasCancelacion, businessId)
    .run();

  return json({ business: { id: businessId, name, cancel_hours: horasCancelacion, role } });
}

// ---------- Sesiones ----------

async function newSession(env, userId, now) {
  const token = createSessionToken();
  const tokenHash = await hashToken(token);
  const expiresAt = now + SESSION_TTL_MS;
  const statement = env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(tokenHash, userId, now, expiresAt);
  return { token, statement };
}
