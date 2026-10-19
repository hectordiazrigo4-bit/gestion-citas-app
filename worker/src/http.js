// Utilidades compartidas por todas las rutas de la API: respuestas, validación,
// sesión y comprobación de permisos sobre un negocio.

import { hashToken } from "./crypto.js";

export const COOKIE_NAME = "sid";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días
const MAX_BODY_CHARS = 10 * 1024;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(body, status = 200, setCookie) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (setCookie) headers["Set-Cookie"] = setCookie;
  return new Response(JSON.stringify(body), { status, headers });
}

export async function readJson(request) {
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

export function isJsonRequest(request) {
  return (request.headers.get("content-type") || "").toLowerCase().startsWith("application/json");
}

export function requireText(value, campo, maxLength) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maxLength) {
    throw new HttpError(400, `Revisa el campo ${campo} (máximo ${maxLength} caracteres)`);
  }
  return text;
}

// Devuelve null si el campo opcional viene vacío.
export function optionalText(value, campo, maxLength) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new HttpError(400, `Revisa el campo ${campo}`);
  const text = value.trim();
  if (!text) return null;
  if (text.length > maxLength) {
    throw new HttpError(400, `Revisa el campo ${campo} (máximo ${maxLength} caracteres)`);
  }
  return text;
}

export function parseEmail(value) {
  const email = requireText(value, "correo", 254).toLowerCase();
  if (!isValidEmail(email)) throw new HttpError(400, "El correo electrónico no es válido");
  return email;
}

export function parseOptionalEmail(value) {
  const email = optionalText(value, "correo", 254);
  if (email === null) return null;
  const lower = email.toLowerCase();
  if (!isValidEmail(lower)) throw new HttpError(400, "El correo electrónico no es válido");
  return lower;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function parsePassword(value) {
  if (typeof value !== "string" || value.length < 10 || value.length > 200) {
    throw new HttpError(400, "La contraseña debe tener entre 10 y 200 caracteres");
  }
  return value;
}

export function parseIntegerInRange(value, campo, min, max) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `El campo ${campo} debe ser un número entero entre ${min} y ${max}`);
  }
  return n;
}

// Escapa los comodines de LIKE para que la búsqueda sea literal.
export function escapeLike(text) {
  return text.replace(/[\\%_]/g, "\\$&");
}

export function readCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export function sessionCookie(token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function requireUser(request, env) {
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

// Punto único de control de acceso a recursos de un negocio.
// Si el usuario no pertenece al negocio se responde 404 (no se revela que exista).
// Si se indican roles, el usuario debe tener uno de ellos (si no, 403).
export async function requireBusinessAccess(request, env, businessId, roles = null) {
  const user = await requireUser(request, env);
  const membership = await env.DB.prepare(
    "SELECT role FROM memberships WHERE user_id = ? AND business_id = ?"
  )
    .bind(user.id, businessId)
    .first();

  if (!membership) throw new HttpError(404, "Negocio no encontrado");
  if (roles && !roles.includes(membership.role)) {
    throw new HttpError(403, "No tienes permiso para realizar esta acción");
  }
  return { user, role: membership.role };
}

// Límite de intentos de inicio de sesión: 10 por correo y 30 por IP en ventanas de 15 minutos.
// Solo se guarda un hash de correo e IP.
const VENTANA_LOGIN_MS = 15 * 60 * 1000;
const MAX_LOGIN_POR_CORREO = 10;
const MAX_LOGIN_POR_IP = 30;

export async function superaLimiteLogin(request, env, correo) {
  const ip = request.headers.get("cf-connecting-ip") || "sin-ip";
  const ventana = Math.floor(Date.now() / VENTANA_LOGIN_MS);
  const porCorreo = await contarIntento(env, `correo|${correo}`, ventana);
  const porIp = await contarIntento(env, `ip|${ip}`, ventana);
  await env.DB.prepare("DELETE FROM login_intentos WHERE ventana < ?").bind(ventana - 2).run();
  return porCorreo > MAX_LOGIN_POR_CORREO || porIp > MAX_LOGIN_POR_IP;
}

async function contarIntento(env, clave, ventana) {
  const hash = await hashToken(clave);
  await env.DB.prepare(
    `INSERT INTO login_intentos (clave, ventana, cuenta) VALUES (?, ?, 1)
     ON CONFLICT (clave) DO UPDATE SET
       cuenta = CASE WHEN login_intentos.ventana = excluded.ventana THEN login_intentos.cuenta + 1 ELSE 1 END,
       ventana = excluded.ventana`
  )
    .bind(hash, ventana)
    .run();
  const fila = await env.DB.prepare("SELECT cuenta FROM login_intentos WHERE clave = ?").bind(hash).first();
  return fila ? fila.cuenta : 0;
}
