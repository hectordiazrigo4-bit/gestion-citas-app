// Equipo del negocio: invitaciones, roles, profesionales (servicios y horario propio).
// Cada cuenta pertenece a un solo negocio: la invitación crea esa pertenencia.

import { HttpError, json, readJson, requireText, parseEmail, parsePassword, requireBusinessAccess, sessionCookie, SESSION_TTL_MS } from "./http.js";
import { createSessionToken, hashToken, hashPassword, verifyPassword } from "./crypto.js";
import { parseTime, minutesToTime } from "./tiempo.js";

const GESTIONAN = ["owner", "admin"];
const DIA = 24 * 60 * 60 * 1000;
const VALIDEZ_INVITACION = 7 * DIA;
const ROLES_INVITABLES = ["admin", "employee"];

export async function listarEquipo(request, env, businessId) {
  await requireBusinessAccess(request, env, businessId);
  const { results: miembros } = await env.DB.prepare(
    `SELECT m.user_id, m.role, u.name, u.email FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.business_id = ?
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name`
  )
    .bind(businessId)
    .all();
  const { results: servicios } = await env.DB.prepare(
    "SELECT user_id, service_id FROM employee_services WHERE business_id = ?"
  )
    .bind(businessId)
    .all();
  const { results: horarios } = await env.DB.prepare(
    "SELECT user_id, weekday, opens_min, closes_min FROM employee_hours WHERE business_id = ? ORDER BY weekday"
  )
    .bind(businessId)
    .all();

  return json({
    miembros: miembros.map((m) => ({
      user_id: m.user_id,
      name: m.name,
      email: m.email,
      role: m.role,
      services: servicios.filter((s) => s.user_id === m.user_id).map((s) => s.service_id),
      hours: horarios
        .filter((h) => h.user_id === m.user_id)
        .map((h) => ({ weekday: h.weekday, opens: minutesToTime(h.opens_min), closes: minutesToTime(h.closes_min) })),
    })),
  });
}

export async function listarInvitaciones(request, env, businessId) {
  await requireBusinessAccess(request, env, businessId, GESTIONAN);
  const { results } = await env.DB.prepare(
    `SELECT id, role, email, expires_at FROM invitations
      WHERE business_id = ? AND accepted_at IS NULL AND expires_at > ? ORDER BY created_at DESC`
  )
    .bind(businessId, Date.now())
    .all();
  return json({ invitaciones: results.map((i) => ({ id: i.id, role: i.role, email: i.email, expires_at: new Date(i.expires_at).toISOString() })) });
}

export async function crearInvitacion(request, env, businessId) {
  await requireBusinessAccess(request, env, businessId, GESTIONAN);
  const body = await readJson(request);
  if (!ROLES_INVITABLES.includes(body.role)) throw new HttpError(400, "El rol debe ser administrador o empleado");
  const email = body.email ? parseEmail(body.email) : null;

  const token = createSessionToken();
  const id = crypto.randomUUID();
  const ahora = Date.now();
  await env.DB.prepare(
    "INSERT INTO invitations (id, business_id, role, email, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(id, businessId, body.role, email, await hashToken(token), ahora + VALIDEZ_INVITACION, ahora)
    .run();

  // El enlace se muestra una sola vez; solo se guarda su hash.
  const origen = new URL(request.url).origin;
  return json({ id, enlace: `${origen}/unirse.html?t=${token}`, expires_at: new Date(ahora + VALIDEZ_INVITACION).toISOString() }, 201);
}

export async function quitarInvitacion(request, env, businessId, invitacionId) {
  await requireBusinessAccess(request, env, businessId, GESTIONAN);
  const result = await env.DB.prepare("DELETE FROM invitations WHERE id = ? AND business_id = ? AND accepted_at IS NULL")
    .bind(invitacionId, businessId)
    .run();
  if (!result.meta.changes) throw new HttpError(404, "Invitación no encontrada");
  return json({ ok: true });
}

// Datos visibles de una invitación antes de aceptarla (sin datos del negocio más allá del nombre).
export async function verInvitacion(request, env, token) {
  const inv = await invitacionValida(env, token);
  const negocio = await env.DB.prepare("SELECT name FROM businesses WHERE id = ?").bind(inv.business_id).first();
  return json({ negocio: negocio.name, role: inv.role, email: inv.email ? inv.email : null });
}

// Acepta la invitación. Si el correo no tiene cuenta, la crea; si la tiene, pide su contraseña.
export async function aceptarInvitacion(request, env, token) {
  const inv = await invitacionValida(env, token);
  const body = await readJson(request);
  const email = parseEmail(body.email);
  if (inv.email && inv.email !== email) throw new HttpError(400, "Esta invitación es para otro correo electrónico");

  const existente = await env.DB.prepare("SELECT id, name, password_hash FROM users WHERE email = ?").bind(email).first();
  const password = typeof body.password === "string" ? body.password : "";
  let userId;
  let nombre;
  let crearUsuario = null;
  if (existente) {
    if (!(await verifyPassword(password, existente.password_hash))) {
      throw new HttpError(401, "Contraseña incorrecta. Si ya tienes cuenta, usa tu contraseña actual.");
    }
    userId = existente.id;
    nombre = existente.name;
  } else {
    nombre = requireText(body.name, "nombre", 100);
    const valida = parsePassword(body.password);
    userId = crypto.randomUUID();
    const ahora = Date.now();
    crearUsuario = env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, name, created_at)
       SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM invitations WHERE token_hash = ? AND accepted_at IS NULL AND expires_at > ?)`
    ).bind(userId, email, await hashPassword(valida), nombre, ahora, await hashToken(token), ahora);
  }

  const ahora = Date.now();
  const sesionToken = createSessionToken();
  const tokenHash = await hashToken(token);
  const sentencias = [];
  if (crearUsuario) sentencias.push(crearUsuario);
  sentencias.push(
    env.DB.prepare(
      `INSERT INTO memberships (user_id, business_id, role, created_at)
       SELECT ?, business_id, role, ? FROM invitations
        WHERE token_hash = ? AND accepted_at IS NULL AND expires_at > ?
          AND EXISTS (SELECT 1 FROM users WHERE id = ?)`
    ).bind(userId, ahora, tokenHash, ahora, userId),
    env.DB.prepare("UPDATE invitations SET accepted_at = ? WHERE token_hash = ? AND accepted_at IS NULL").bind(ahora, tokenHash),
    env.DB.prepare(
      `INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
       SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM memberships WHERE user_id = ?)`
    ).bind(await hashToken(sesionToken), userId, ahora, ahora + SESSION_TTL_MS, userId)
  );

  try {
    await env.DB.batch(sentencias);
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      throw new HttpError(409, "Esta cuenta ya pertenece a otro negocio. Crea una cuenta nueva para unirte.");
    }
    throw err;
  }

  const comprobacion = await env.DB.prepare("SELECT 1 AS ok FROM sessions WHERE token_hash = ?").bind(await hashToken(sesionToken)).first();
  if (!comprobacion) throw new HttpError(400, "Esta invitación ya no es válida");

  return json({ user: { id: userId, email, name: nombre } }, 201, sessionCookie(sesionToken));
}

export async function cambiarRol(request, env, businessId, usuarioId) {
  await requireBusinessAccess(request, env, businessId, ["owner"]);
  const body = await readJson(request);
  if (!ROLES_INVITABLES.includes(body.role)) throw new HttpError(400, "El rol debe ser administrador o empleado");
  const miembro = await miembroDelNegocio(env, businessId, usuarioId);
  if (miembro.role === "owner") throw new HttpError(400, "El rol del propietario no se puede cambiar");
  await env.DB.prepare("UPDATE memberships SET role = ? WHERE user_id = ? AND business_id = ?")
    .bind(body.role, usuarioId, businessId)
    .run();
  return json({ ok: true, role: body.role });
}

export async function quitarMiembro(request, env, businessId, usuarioId) {
  await requireBusinessAccess(request, env, businessId, ["owner"]);
  const miembro = await miembroDelNegocio(env, businessId, usuarioId);
  if (miembro.role === "owner") throw new HttpError(400, "El propietario no se puede quitar del negocio");

  const pendientes = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM appointments WHERE business_id = ? AND employee_id = ? AND status IN ('pending', 'confirmed') AND starts_at >= ?"
  )
    .bind(businessId, usuarioId, Date.now())
    .first();
  if (pendientes.n > 0) {
    throw new HttpError(409, "Tiene citas próximas asignadas. Reasígnalas o cancélalas antes de quitarla.");
  }

  await env.DB.batch([
    env.DB.prepare("DELETE FROM employee_services WHERE user_id = ? AND business_id = ?").bind(usuarioId, businessId),
    env.DB.prepare("DELETE FROM employee_hours WHERE user_id = ? AND business_id = ?").bind(usuarioId, businessId),
    env.DB.prepare("UPDATE appointments SET employee_id = NULL WHERE employee_id = ? AND business_id = ?").bind(usuarioId, businessId),
    env.DB.prepare("DELETE FROM memberships WHERE user_id = ? AND business_id = ?").bind(usuarioId, businessId),
  ]);
  return json({ ok: true });
}

export async function guardarServiciosMiembro(request, env, businessId, usuarioId) {
  await requireBusinessAccess(request, env, businessId, GESTIONAN);
  await miembroDelNegocio(env, businessId, usuarioId);
  const body = await readJson(request);
  if (!Array.isArray(body.service_ids)) throw new HttpError(400, "Envía la lista de servicios");

  const ids = [...new Set(body.service_ids.map(String))];
  for (const id of ids) {
    const existe = await env.DB.prepare("SELECT id FROM services WHERE id = ? AND business_id = ?").bind(id, businessId).first();
    if (!existe) throw new HttpError(404, "Servicio no encontrado");
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM employee_services WHERE user_id = ? AND business_id = ?").bind(usuarioId, businessId),
    ...ids.map((id) =>
      env.DB.prepare("INSERT INTO employee_services (business_id, user_id, service_id) VALUES (?, ?, ?)").bind(businessId, usuarioId, id)
    ),
  ]);
  return json({ ok: true, service_ids: ids });
}

// Horario propio. Enviar una lista vacía devuelve al horario del negocio.
export async function guardarHorarioMiembro(request, env, businessId, usuarioId) {
  await requireBusinessAccess(request, env, businessId, GESTIONAN);
  await miembroDelNegocio(env, businessId, usuarioId);
  const body = await readJson(request);
  if (!Array.isArray(body.hours) || body.hours.length > 7) throw new HttpError(400, "Envía la lista de horarios (máximo 7 días)");

  const dias = new Set();
  const filas = body.hours.map((dia) => {
    const weekday = Number(dia.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || dias.has(weekday)) {
      throw new HttpError(400, "Día de la semana no válido o repetido");
    }
    dias.add(weekday);
    const opens = parseTime(dia.opens, "apertura");
    const closes = parseTime(dia.closes, "cierre");
    if (closes <= opens) throw new HttpError(400, "La hora de cierre debe ser posterior a la de apertura");
    return { weekday, opens, closes };
  });

  await env.DB.batch([
    env.DB.prepare("DELETE FROM employee_hours WHERE user_id = ? AND business_id = ?").bind(usuarioId, businessId),
    ...filas.map((f) =>
      env.DB.prepare(
        "INSERT INTO employee_hours (business_id, user_id, weekday, opens_min, closes_min) VALUES (?, ?, ?, ?, ?)"
      ).bind(businessId, usuarioId, f.weekday, f.opens, f.closes)
    ),
  ]);
  return json({ ok: true });
}

async function miembroDelNegocio(env, businessId, usuarioId) {
  const miembro = await env.DB.prepare("SELECT role FROM memberships WHERE user_id = ? AND business_id = ?")
    .bind(usuarioId, businessId)
    .first();
  if (!miembro) throw new HttpError(404, "Persona no encontrada en el negocio");
  return miembro;
}

async function invitacionValida(env, token) {
  const inv = await env.DB.prepare(
    "SELECT id, business_id, role, email, expires_at, accepted_at FROM invitations WHERE token_hash = ?"
  )
    .bind(await hashToken(String(token || "")))
    .first();
  if (!inv) throw new HttpError(404, "La invitación no existe o ya no es válida");
  if (inv.accepted_at) throw new HttpError(400, "Esta invitación ya se ha utilizado");
  if (inv.expires_at < Date.now()) throw new HttpError(400, "La invitación ha caducado. Pide una nueva al negocio.");
  return inv;
}
