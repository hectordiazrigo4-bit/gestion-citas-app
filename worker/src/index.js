import { hashPassword, verifyPassword, createSessionToken, hashToken } from "./crypto.js";

const COOKIE_NAME = "sid";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días
const MAX_BODY_CHARS = 10 * 1024;
const ROLES_QUE_EDITAN_NEGOCIO = ["owner", "admin"];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

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

  const businessMatch = pathname.match(/^\/api\/businesses\/([0-9a-f-]{36})$/);
  if (businessMatch) {
    const businessId = businessMatch[1];
    if (method === "GET") return getBusiness(request, env, businessId);
    if (method === "PATCH") return updateBusiness(request, env, businessId);
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
  const now = Date.now();
  const passwordHash = await hashPassword(password);
  const session = await newSession(env, userId, now);

  // Todo en una sola transacción: si algo falla, no queda usuario sin negocio.
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)"
      ).bind(userId, email, passwordHash, name, now),
      env.DB.prepare("INSERT INTO businesses (id, name, created_at) VALUES (?, ?, ?)").bind(
        businessId,
        businessName,
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
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(session.tokenHash, user.id, session.createdAt, session.expiresAt)
    .run();

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

// ---------- Negocios (aislamiento y roles en el servidor) ----------

async function getBusiness(request, env, businessId) {
  const user = await requireUser(request, env);
  const membership = await findMembership(env, user.id, businessId);
  // Si no es miembro se responde como si el negocio no existiera.
  if (!membership) throw new HttpError(404, "Negocio no encontrado");

  const business = await env.DB.prepare("SELECT id, name, created_at FROM businesses WHERE id = ?")
    .bind(businessId)
    .first();

  return json({ business: { ...business, role: membership.role } });
}

async function updateBusiness(request, env, businessId) {
  const user = await requireUser(request, env);
  const membership = await findMembership(env, user.id, businessId);
  if (!membership) throw new HttpError(404, "Negocio no encontrado");
  if (!ROLES_QUE_EDITAN_NEGOCIO.includes(membership.role)) {
    throw new HttpError(403, "No tienes permiso para cambiar los datos del negocio");
  }

  const body = await readJson(request);
  const name = requireText(body.name, "nombre del negocio", 120);
  await env.DB.prepare("UPDATE businesses SET name = ? WHERE id = ?").bind(name, businessId).run();

  return json({ business: { id: businessId, name, role: membership.role } });
}

// ---------- Utilidades ----------

async function requireUser(request, env) {
  const token = readCookie(request, COOKIE_NAME);
  if (!token) throw new HttpError(401, "Inicia sesión para continuar");

  const tokenHash = await hashToken(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`
  )
    .bind(tokenHash)
    .first();

  if (!row) throw new HttpError(401, "Inicia sesión para continuar");
  if (row.expires_at < Date.now()) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
    throw new HttpError(401, "La sesión ha caducado. Vuelve a iniciar sesión.");
  }
  return { id: row.id, email: row.email, name: row.name };
}

function findMembership(env, userId, businessId) {
  return env.DB.prepare("SELECT role FROM memberships WHERE user_id = ? AND business_id = ?")
    .bind(userId, businessId)
    .first();
}

async function newSession(env, userId, now) {
  const token = createSessionToken();
  const tokenHash = await hashToken(token);
  const createdAt = now;
  const expiresAt = now + SESSION_TTL_MS;
  const statement = env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(tokenHash, userId, createdAt, expiresAt);
  return { token, tokenHash, createdAt, expiresAt, statement };
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) throw new HttpError(413, "La petición es demasiado grande");
  if (!text) return {};
  try {
    const data = JSON.parse(text);
    return data && typeof data === "object" ? data : {};
  } catch {
    throw new HttpError(400, "Los datos enviados no son válidos");
  }
}

function isJsonRequest(request) {
  return (request.headers.get("content-type") || "").toLowerCase().startsWith("application/json");
}

function requireText(value, campo, maxLength) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maxLength) {
    throw new HttpError(400, `Revisa el campo ${campo} (máximo ${maxLength} caracteres)`);
  }
  return text;
}

function parseEmail(value) {
  const email = requireText(value, "correo", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "El correo electrónico no es válido");
  }
  return email;
}

function parsePassword(value) {
  if (typeof value !== "string" || value.length < 10 || value.length > 200) {
    throw new HttpError(400, "La contraseña debe tener entre 10 y 200 caracteres");
  }
  return value;
}

function readCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function sessionCookie(token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function json(body, status = 200, setCookie) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (setCookie) headers["Set-Cookie"] = setCookie;
  return new Response(JSON.stringify(body), { status, headers });
}
