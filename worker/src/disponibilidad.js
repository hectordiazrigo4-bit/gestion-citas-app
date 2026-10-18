// Horario semanal, bloqueos (descansos, vacaciones) y cálculo de huecos libres.
// Los huecos se calculan en el servidor; la base de datos es la que impide reservar un hueco ocupado.

import { HttpError, json, readJson, optionalText, requireBusinessAccess } from "./http.js";
import { parseDateTime, dayBounds, zonedToUtc, minutesToTime, parseTime, MINUTO } from "./tiempo.js";

const ROLES_QUE_CONFIGURAN = ["owner", "admin"];
const PASO_HUECOS_MIN = 15;
const TIPOS_BLOQUEO = ["bloqueo", "descanso", "vacaciones"];
const ESTADOS_QUE_OCUPAN = "('pending', 'confirmed', 'completed')";

// ---------- Horario semanal ----------

export async function getHours(request, env, businessId) {
  await requireBusinessAccess(request, env, businessId);
  const { results } = await env.DB.prepare(
    "SELECT weekday, opens_min, closes_min FROM working_hours WHERE business_id = ? ORDER BY weekday"
  )
    .bind(businessId)
    .all();

  return json({ hours: results.map(toHoursDto) });
}

export async function saveHours(request, env, businessId) {
  await requireBusinessAccess(request, env, businessId, ROLES_QUE_CONFIGURAN);
  const body = await readJson(request);
  if (!Array.isArray(body.hours)) throw new HttpError(400, "Envía la lista de horarios");
  if (body.hours.length > 7) throw new HttpError(400, "Como máximo hay 7 días");

  const dias = new Set();
  const filas = body.hours.map((dia) => {
    const weekday = Number(dia.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new HttpError(400, "Día de la semana no válido");
    if (dias.has(weekday)) throw new HttpError(400, "Hay un día repetido en el horario");
    dias.add(weekday);
    const opens = parseTime(dia.opens, "apertura");
    const closes = parseTime(dia.closes, "cierre");
    if (closes <= opens) throw new HttpError(400, "La hora de cierre debe ser posterior a la de apertura");
    return { weekday, opens, closes };
  });

  // Reemplaza todo el horario de forma atómica.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM working_hours WHERE business_id = ?").bind(businessId),
    ...filas.map((f) =>
      env.DB.prepare(
        "INSERT INTO working_hours (business_id, weekday, opens_min, closes_min) VALUES (?, ?, ?, ?)"
      ).bind(businessId, f.weekday, f.opens, f.closes)
    ),
  ]);

  return json({ hours: filas.sort((a, b) => a.weekday - b.weekday).map(toHoursDto) });
}

// ---------- Bloqueos (descansos, vacaciones, bloqueos puntuales) ----------

export async function listBlocks(request, env, businessId, url) {
  await requireBusinessAccess(request, env, businessId);
  const tz = await businessTimezone(env, businessId);
  const desde = dayBounds(tz, url.searchParams.get("from")).start;
  const hasta = dayBounds(tz, url.searchParams.get("to")).end;

  const { results } = await env.DB.prepare(
    `SELECT id, kind, starts_at, ends_at, reason FROM blocked_slots
      WHERE business_id = ? AND starts_at < ? AND ends_at > ?
      ORDER BY starts_at`
  )
    .bind(businessId, hasta, desde)
    .all();

  return json({ blocks: results.map(toBlockDto) });
}

export async function createBlock(request, env, businessId) {
  await requireBusinessAccess(request, env, businessId, ROLES_QUE_CONFIGURAN);
  const tz = await businessTimezone(env, businessId);
  const body = await readJson(request);
  const kind = TIPOS_BLOQUEO.includes(body.kind) ? body.kind : null;
  if (!kind) throw new HttpError(400, "Tipo de bloqueo no válido");
  const inicio = parseDateTime(body.starts, tz);
  const fin = parseDateTime(body.ends, tz);
  if (fin <= inicio) throw new HttpError(400, "El final debe ser posterior al inicio");
  const reason = optionalText(body.reason, "motivo", 200);

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      "INSERT INTO blocked_slots (id, business_id, kind, starts_at, ends_at, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(id, businessId, kind, inicio, fin, reason, Date.now())
      .run();
  } catch (err) {
    if (String(err.message).includes("HAY_CITAS_EN_EL_TRAMO")) {
      throw new HttpError(409, "Hay citas activas en ese tramo. Cancélalas o muévelas antes de bloquearlo.");
    }
    throw err;
  }

  return json({ block: toBlockDto({ id, kind, starts_at: inicio, ends_at: fin, reason }) }, 201);
}

export async function deleteBlock(request, env, businessId, blockId) {
  await requireBusinessAccess(request, env, businessId, ROLES_QUE_CONFIGURAN);
  const result = await env.DB.prepare("DELETE FROM blocked_slots WHERE id = ? AND business_id = ?")
    .bind(blockId, businessId)
    .run();
  if (!result.meta.changes) throw new HttpError(404, "Bloqueo no encontrado");

  return json({ ok: true });
}

// ---------- Huecos libres ----------

export async function getAvailability(request, env, businessId, url) {
  await requireBusinessAccess(request, env, businessId);
  return json(
    await huecosLibres(env, businessId, url.searchParams.get("date"), url.searchParams.get("service_id") || "", url.searchParams.get("employee_id") || null)
  );
}

// Huecos libres de un día para un servicio. Lo usan el panel y la página pública de reservas.
// Huecos libres de un día para un servicio.
// Con profesionales asignados al servicio y sin elegir ninguno, se devuelve la unión de los huecos de cada uno.
export async function huecosLibres(env, businessId, fechaTexto, serviceId, employeeId = null) {
  const tz = await businessTimezone(env, businessId);
  const dia = dayBounds(tz, fechaTexto);

  const servicio = await env.DB.prepare(
    "SELECT duration_min, prep_min, active FROM services WHERE id = ? AND business_id = ?"
  )
    .bind(serviceId, businessId)
    .first();
  if (!servicio) throw new HttpError(404, "Servicio no encontrado");
  if (!servicio.active) throw new HttpError(400, "El servicio está inactivo");

  let profesionales;
  if (employeeId) {
    await profesionalQueRealiza(env, businessId, serviceId, employeeId);
    profesionales = [employeeId];
  } else {
    const { results } = await env.DB.prepare(
      "SELECT user_id FROM employee_services WHERE business_id = ? AND service_id = ?"
    )
      .bind(businessId, serviceId)
      .all();
    profesionales = results.length ? results.map((r) => r.user_id) : [null];
  }

  const slots = new Set();
  let hours = null;
  for (const pro of profesionales) {
    const r = await huecosDeUno(env, businessId, tz, dia, servicio, pro);
    for (const s of r.slots) slots.add(s);
    if (r.hours && !hours) hours = r.hours;
  }

  return { timezone: tz, slots: [...slots].sort(), hours };
}

// Comprueba que la persona existe en el negocio y realiza ese servicio.
export async function profesionalQueRealiza(env, businessId, serviceId, userId) {
  const miembro = await env.DB.prepare(
    "SELECT user_id FROM memberships WHERE business_id = ? AND user_id = ?"
  )
    .bind(businessId, userId)
    .first();
  if (!miembro) throw new HttpError(404, "Profesional no encontrado");

  const asignados = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM employee_services WHERE business_id = ? AND service_id = ?"
  )
    .bind(businessId, serviceId)
    .first();
  if (asignados.n === 0) return;

  const realiza = await env.DB.prepare(
    "SELECT 1 AS ok FROM employee_services WHERE business_id = ? AND service_id = ? AND user_id = ?"
  )
    .bind(businessId, serviceId, userId)
    .first();
  if (!realiza) throw new HttpError(400, "Esa persona no realiza este servicio");
}

async function huecosDeUno(env, businessId, tz, dia, servicio, pro) {
  const horario = await horarioDelDia(env, businessId, pro, dia.weekday);
  if (!horario) return { slots: [], hours: null };

  const { y, mo, d } = dia.parts;
  const abre = zonedToUtc(tz, y, mo, d, Math.floor(horario.opens_min / 60), horario.opens_min % 60);
  const cierra = zonedToUtc(tz, y, mo, d, Math.floor(horario.closes_min / 60), horario.closes_min % 60);
  const duracion = (servicio.duration_min + servicio.prep_min) * MINUTO;

  // Citas de la misma persona (o sin asignar) y bloqueos que la afectan.
  const ocupados = await env.DB.prepare(
    `SELECT starts_at AS desde, blocked_until AS hasta FROM appointments
      WHERE business_id = ? AND status IN ${ESTADOS_QUE_OCUPAN}
        AND starts_at < ? AND blocked_until > ? AND employee_id IS ?
     UNION ALL
     SELECT starts_at AS desde, ends_at AS hasta FROM blocked_slots
      WHERE business_id = ? AND starts_at < ? AND ends_at > ? AND (employee_id IS NULL OR employee_id IS ?)`
  )
    .bind(businessId, cierra, abre, pro, businessId, cierra, abre, pro)
    .all();

  const ahora = Date.now();
  const slots = [];
  for (let inicio = abre; inicio + duracion <= cierra; inicio += PASO_HUECOS_MIN * MINUTO) {
    if (inicio < ahora) continue;
    const fin = inicio + duracion;
    const choca = ocupados.results.some((o) => o.desde < fin && o.hasta > inicio);
    if (!choca) slots.push(new Date(inicio).toISOString());
  }

  return {
    slots,
    hours: pro ? null : minutesToTime(horario.opens_min) + "–" + minutesToTime(horario.closes_min),
  };
}

// Horario del profesional si tiene uno propio; si no, el del negocio.
async function horarioDelDia(env, businessId, pro, weekday) {
  if (pro) {
    const propio = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM employee_hours WHERE business_id = ? AND user_id = ?"
    )
      .bind(businessId, pro)
      .first();
    if (propio.n > 0) {
      return env.DB.prepare(
        "SELECT opens_min, closes_min FROM employee_hours WHERE business_id = ? AND user_id = ? AND weekday = ?"
      )
        .bind(businessId, pro, weekday)
        .first();
    }
  }
  return env.DB.prepare("SELECT opens_min, closes_min FROM working_hours WHERE business_id = ? AND weekday = ?")
    .bind(businessId, weekday)
    .first();
}

// ---------- Utilidades ----------

async function businessTimezone(env, businessId) {
  const row = await env.DB.prepare("SELECT timezone FROM businesses WHERE id = ?").bind(businessId).first();
  return row ? row.timezone : "Europe/Madrid";
}

function toHoursDto(row) {
  return {
    weekday: row.weekday,
    opens: minutesToTime(row.opens_min ?? row.opens),
    closes: minutesToTime(row.closes_min ?? row.closes),
  };
}

function toBlockDto(row) {
  return {
    id: row.id,
    kind: row.kind,
    starts_at: new Date(row.starts_at).toISOString(),
    ends_at: new Date(row.ends_at).toISOString(),
    reason: row.reason ?? null,
  };
}
