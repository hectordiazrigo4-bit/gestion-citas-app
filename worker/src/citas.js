// Citas del negocio. El servidor valida cliente, servicio, horario y transiciones de estado;
// los solapamientos los impide la base de datos (ver triggers en db/migrations/0004_agenda.sql).

import { HttpError, json, readJson, optionalText, requireBusinessAccess } from "./http.js";
import { parseDateTime, dayBounds, MINUTO } from "./tiempo.js";
import { alCrearCita, alCambiarCita } from "./avisos.js";

const ESTADOS = ["pending", "confirmed", "completed", "cancelled", "no_show"];
const ESTADOS_TERMINALES = ["completed", "no_show"];
const TRANSICIONES = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["completed", "cancelled", "no_show"],
  cancelled: ["pending"],
  completed: [],
  no_show: [],
};
const MAX_DIAS_LISTADO = 62;

export async function listAppointments(request, env, businessId, url) {
  await requireBusinessAccess(request, env, businessId);
  const tz = await businessTimezone(env, businessId);
  const desde = dayBounds(tz, url.searchParams.get("from"));
  const hasta = dayBounds(tz, url.searchParams.get("to"));
  if (hasta.end <= desde.start) throw new HttpError(400, "El rango de fechas no es válido");
  if (hasta.end - desde.start > MAX_DIAS_LISTADO * 24 * 60 * MINUTO) {
    throw new HttpError(400, `Consulta como máximo ${MAX_DIAS_LISTADO} días a la vez`);
  }

  const { results } = await env.DB.prepare(
    `SELECT a.id, a.client_id, a.service_id, a.service_name, a.price_cents, a.starts_at, a.ends_at,
            a.status, a.notes, c.first_name, c.last_name, c.phone
       FROM appointments a
       JOIN clients c ON c.id = a.client_id
      WHERE a.business_id = ? AND a.starts_at < ? AND a.ends_at > ?
      ORDER BY a.starts_at`
  )
    .bind(businessId, hasta.end, desde.start)
    .all();

  return json({ timezone: tz, appointments: results.map(toDto) });
}

export async function createAppointment(request, env, businessId) {
  await requireBusinessAccess(request, env, businessId);
  const tz = await businessTimezone(env, businessId);
  const body = await readJson(request);
  const cita = await crearCita(env, businessId, tz, body);
  return json({ appointment: toDto({ ...cita, client_name: null }) }, 201);
}

// Crea una cita validada. Lo usan el panel y las reservas públicas.
// Si hay un solapamiento, la base de datos lo rechaza y aquí se traduce a 409.
export async function crearCita(env, businessId, tz, body, { source = "panel", privacyAccepted = false } = {}) {
  const datos = await validarCita(env, businessId, tz, body, Date.now());
  const id = crypto.randomUUID();
  const now = Date.now();
  try {
    await env.DB.prepare(
      `INSERT INTO appointments
         (id, business_id, client_id, service_id, service_name, price_cents, starts_at, ends_at,
          blocked_until, status, notes, source, privacy_accepted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(id, businessId, datos.client_id, datos.service_id, datos.service_name, datos.price_cents,
        datos.starts_at, datos.ends_at, datos.blocked_until, datos.status, datos.notes, source,
        privacyAccepted ? now : null, now, now)
      .run();
  } catch (err) {
    throw errorDeHorario(err);
  }

  try {
    await alCrearCita(env, businessId, tz, { id, ...datos }, source);
  } catch (err) {
    // Un fallo al preparar el aviso no debe anular la cita.
    console.error("error_aviso", err && err.name);
  }
  return { id, ...datos };
}

export async function updateAppointment(request, env, businessId, appointmentId) {
  await requireBusinessAccess(request, env, businessId);
  const tz = await businessTimezone(env, businessId);
  const actual = await env.DB.prepare(
    "SELECT id, status, client_id, service_id, starts_at FROM appointments WHERE id = ? AND business_id = ?"
  )
    .bind(appointmentId, businessId)
    .first();
  if (!actual) throw new HttpError(404, "Cita no encontrada");

  const body = await readJson(request);
  const nuevoEstado = body.status === undefined ? actual.status : body.status;
  if (!ESTADOS.includes(nuevoEstado)) throw new HttpError(400, "Estado de cita no válido");

  if (nuevoEstado !== actual.status && !TRANSICIONES[actual.status].includes(nuevoEstado)) {
    throw new HttpError(400, `No se puede cambiar una cita de «${etiquetaEstado(actual.status)}» a «${etiquetaEstado(nuevoEstado)}»`);
  }

  // Las citas terminadas o no presentadas solo admiten cambiar las notas.
  if (ESTADOS_TERMINALES.includes(actual.status)) {
    const notas = optionalText(body.notes, "notas", 2000);
    await env.DB.prepare("UPDATE appointments SET notes = ?, updated_at = ? WHERE id = ? AND business_id = ?")
      .bind(notas, Date.now(), appointmentId, businessId)
      .run();
    return json({ ok: true });
  }

  const datos = await validarCita(env, businessId, tz, { ...body, status: nuevoEstado }, Date.now(), actual);
  try {
    await env.DB.prepare(
      `UPDATE appointments
          SET client_id = ?, service_id = ?, service_name = ?, price_cents = ?, starts_at = ?, ends_at = ?,
              blocked_until = ?, status = ?, notes = ?, updated_at = ?
        WHERE id = ? AND business_id = ?`
    )
      .bind(datos.client_id, datos.service_id, datos.service_name, datos.price_cents, datos.starts_at,
        datos.ends_at, datos.blocked_until, datos.status, datos.notes, Date.now(), appointmentId, businessId)
      .run();
  } catch (err) {
    throw errorDeHorario(err);
  }

  try {
    await alCambiarCita(
      env,
      businessId,
      tz,
      { id: appointmentId, status: actual.status, starts_at: actual.starts_at },
      { id: appointmentId, status: datos.status, starts_at: datos.starts_at, client_id: datos.client_id, service_id: datos.service_id, service_name: datos.service_name }
    );
  } catch (err) {
    console.error("error_aviso", err && err.name);
  }

  return json({ appointment: toDto({ id: appointmentId, ...datos, client_name: null }) });
}

// Valida los datos de una cita y devuelve la fila lista para guardar.
// Si se pasa "actual", las fechas solo se revisan como futuras cuando cambian.
async function validarCita(env, businessId, tz, body, ahora, actual = null) {
  const estado = body.status === undefined ? "confirmed" : body.status;
  if (!ESTADOS.includes(estado)) throw new HttpError(400, "Estado de cita no válido");

  const clientId = typeof body.client_id === "string" ? body.client_id : "";
  const serviceId = typeof body.service_id === "string" ? body.service_id : "";
  const inicio = parseDateTime(body.starts, tz);
  if (!actual || inicio !== actual.starts_at) {
    if (inicio < ahora) throw new HttpError(400, "No se pueden crear o mover citas al pasado");
  }

  const cliente = await env.DB.prepare("SELECT id FROM clients WHERE id = ? AND business_id = ?")
    .bind(clientId, businessId)
    .first();
  if (!cliente) throw new HttpError(404, "Cliente no encontrado");

  const servicio = await env.DB.prepare(
    "SELECT id, name, duration_min, prep_min, price_cents, active FROM services WHERE id = ? AND business_id = ?"
  )
    .bind(serviceId, businessId)
    .first();
  if (!servicio) throw new HttpError(404, "Servicio no encontrado");
  if (!servicio.active && (!actual || serviceId !== actual.service_id)) {
    throw new HttpError(400, "El servicio está inactivo y no admite nuevas citas");
  }

  const finServicio = inicio + servicio.duration_min * MINUTO;
  return {
    client_id: clientId,
    service_id: serviceId,
    service_name: servicio.name,
    price_cents: servicio.price_cents,
    starts_at: inicio,
    ends_at: finServicio,
    blocked_until: finServicio + servicio.prep_min * MINUTO,
    status: estado,
    notes: optionalText(body.notes, "notas", 2000),
  };
}

// Los solapamientos los detecta un trigger de la base de datos y llegan aquí como HORARIO_OCUPADO.
function errorDeHorario(err) {
  if (String(err.message).includes("HORARIO_OCUPADO")) {
    return new HttpError(409, "Ese horario ya está ocupado o bloqueado");
  }
  return err;
}

async function businessTimezone(env, businessId) {
  const row = await env.DB.prepare("SELECT timezone FROM businesses WHERE id = ?").bind(businessId).first();
  return row ? row.timezone : "Europe/Madrid";
}

export function etiquetaEstado(estado) {
  return {
    pending: "pendiente",
    confirmed: "confirmada",
    completed: "completada",
    cancelled: "cancelada",
    no_show: "no presentado",
  }[estado];
}

function toDto(row) {
  return {
    id: row.id,
    client_id: row.client_id,
    client_name: row.client_name ?? (row.first_name ? `${row.first_name} ${row.last_name}` : null),
    phone: row.phone ?? null,
    service_id: row.service_id,
    service_name: row.service_name,
    price_cents: row.price_cents,
    starts_at: new Date(row.starts_at).toISOString(),
    ends_at: new Date(row.ends_at).toISOString(),
    blocked_until: row.blocked_until ? new Date(row.blocked_until).toISOString() : undefined,
    status: row.status,
    notes: row.notes ?? null,
  };
}
