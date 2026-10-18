// Resumen del negocio: indicadores calculados sobre citas, clientes y horarios reales.
// Los importes son de citas completadas; los cobros reales llegarán con la Fase 7.

import { HttpError, json, requireBusinessAccess } from "./http.js";
import { dayBounds, parseDate, localParts, zonedToUtc, MINUTO } from "./tiempo.js";

const ACTIVAS = ["pending", "confirmed", "completed"];
const DIAS_SIN_VOLVER = 90;
const TIPOS = ["day", "week", "month"];

export async function getDashboard(request, env, businessId, url) {
  await requireBusinessAccess(request, env, businessId);
  const tz = await businessTimezone(env, businessId);
  const ahora = Date.now();
  const hoy = fechaEnZona(tz, ahora);

  const tipo = url.searchParams.get("period") || "day";
  if (!TIPOS.includes(tipo)) throw new HttpError(400, "El periodo debe ser día, semana o mes");
  const fecha = url.searchParams.get("date") || hoy;
  const periodo = calcularPeriodo(tz, tipo, fecha);

  const citasPeriodo = await citasEntre(env, businessId, periodo.desdeMs, periodo.hastaMs);
  const noCanceladas = citasPeriodo.filter((c) => c.status !== "cancelled");

  const hoyInicio = dayBounds(tz, hoy).start;
  const hoyFin = dayBounds(tz, hoy).end;
  const citasHoy = (await citasEntre(env, businessId, hoyInicio, hoyFin)).filter((c) => c.status !== "cancelled");

  const proximas = await env.DB.prepare(
    `${SQL_CITAS} WHERE a.business_id = ? AND a.starts_at >= ? AND a.status IN ('pending', 'confirmed')
      ORDER BY a.starts_at LIMIT 5`
  )
    .bind(businessId, ahora)
    .all();

  const clientesNuevos = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM clients WHERE business_id = ? AND created_at >= ? AND created_at < ?"
  )
    .bind(businessId, periodo.desdeMs, periodo.hastaMs)
    .first();

  const recurrentes = await clientesRecurrentes(env, businessId, noCanceladas, periodo.desdeMs);
  const ocupacion = await ocupacionPeriodo(env, businessId, tz, periodo, noCanceladas);
  const inactivos = await clientesInactivos(env, businessId, ahora);
  const pendientesConfirmar = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM appointments WHERE business_id = ? AND status = 'pending' AND starts_at >= ?"
  )
    .bind(businessId, ahora)
    .first();
  const sinCerrar = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM appointments WHERE business_id = ? AND status IN ('pending', 'confirmed') AND ends_at < ?"
  )
    .bind(businessId, ahora)
    .first();

  const porEstado = { pending: 0, confirmed: 0, completed: 0, cancelled: 0, no_show: 0 };
  for (const c of citasPeriodo) porEstado[c.status] += 1;

  return json({
    timezone: tz,
    periodo: { tipo, desde: periodo.desde, hasta: periodo.hasta },
    resumen: {
      citas: noCanceladas.length,
      canceladas: porEstado.cancelled,
      no_presentados: porEstado.no_show,
      clientes_nuevos: clientesNuevos.n,
      clientes_recurrentes: recurrentes,
      ingresos_completadas_cents: noCanceladas
        .filter((c) => c.status === "completed")
        .reduce((total, c) => total + c.price_cents, 0),
      ocupacion_pct: ocupacion,
      por_estado: porEstado,
      servicios_top: topServicios(noCanceladas),
    },
    hoy: citasHoy.map(aDto),
    proximas: proximas.results.map(aDto),
    tareas: {
      citas_por_confirmar: pendientesConfirmar.n,
      citas_sin_cerrar: sinCerrar.n,
      clientes_inactivos: { total: inactivos.length, nombres: inactivos.slice(0, 5).map((c) => c.nombre) },
    },
  });
}

const SQL_CITAS = `SELECT a.id, a.client_id, a.service_name, a.price_cents, a.starts_at, a.ends_at, a.status,
                          c.first_name, c.last_name
                     FROM appointments a JOIN clients c ON c.id = a.client_id`;

async function citasEntre(env, businessId, desdeMs, hastaMs) {
  const { results } = await env.DB.prepare(`${SQL_CITAS} WHERE a.business_id = ? AND a.starts_at >= ? AND a.starts_at < ? ORDER BY a.starts_at`)
    .bind(businessId, desdeMs, hastaMs)
    .all();
  return results;
}

// Clientes que tienen cita en el periodo y ya tenían alguna cita antes.
async function clientesRecurrentes(env, businessId, citas, desdeMs) {
  const enPeriodo = new Set(citas.map((c) => c.client_id));
  if (enPeriodo.size === 0) return 0;
  const { results } = await env.DB.prepare(
    "SELECT DISTINCT client_id FROM appointments WHERE business_id = ? AND starts_at < ? AND status != 'cancelled'"
  )
    .bind(businessId, desdeMs)
    .all();
  return results.filter((r) => enPeriodo.has(r.client_id)).length;
}

// Ocupación: minutos con cita frente a minutos de horario abierto, descontando bloqueos.
async function ocupacionPeriodo(env, businessId, tz, periodo, citas) {
  const horas = await env.DB.prepare("SELECT weekday, opens_min, closes_min FROM working_hours WHERE business_id = ?")
    .bind(businessId)
    .all();
  const porDia = new Map(horas.results.map((h) => [h.weekday, h]));
  if (porDia.size === 0) return null;

  const bloqueos = await env.DB.prepare(
    "SELECT starts_at, ends_at FROM blocked_slots WHERE business_id = ? AND starts_at < ? AND ends_at > ?"
  )
    .bind(businessId, periodo.hastaMs, periodo.desdeMs)
    .all();

  const ventanas = [];
  let disponible = 0;
  for (let f = periodo.desde; f <= periodo.hasta; f = sumarDias(f, 1)) {
    const { y, mo, d } = parseDate(f);
    const h = porDia.get(new Date(Date.UTC(y, mo - 1, d)).getUTCDay());
    if (!h) continue;
    const inicio = zonedToUtc(tz, y, mo, d, Math.floor(h.opens_min / 60), h.opens_min % 60);
    const fin = zonedToUtc(tz, y, mo, d, Math.floor(h.closes_min / 60), h.closes_min % 60);
    ventanas.push([inicio, fin]);
    let libre = fin - inicio;
    for (const b of bloqueos.results) libre -= solape(inicio, fin, b.starts_at, b.ends_at);
    disponible += Math.max(libre, 0);
  }
  if (disponible === 0) return null;

  let ocupado = 0;
  for (const c of citas) {
    for (const [ini, fin] of ventanas) ocupado += solape(ini, fin, c.starts_at, c.ends_at);
  }
  return Math.min(100, Math.round((ocupado / disponible) * 100));
}

// Clientes cuya última cita completada es anterior al límite.
async function clientesInactivos(env, businessId, ahora) {
  const limite = ahora - DIAS_SIN_VOLVER * 24 * 60 * MINUTO;
  const { results } = await env.DB.prepare(
    `SELECT a.client_id, c.first_name, c.last_name, MAX(a.starts_at) AS ultima
       FROM appointments a JOIN clients c ON c.id = a.client_id
      WHERE a.business_id = ? AND a.status = 'completed'
      GROUP BY a.client_id
     HAVING ultima < ?
      ORDER BY ultima`
  )
    .bind(businessId, limite)
    .all();
  return results.map((r) => ({ nombre: `${r.first_name} ${r.last_name}` }));
}

function topServicios(citas) {
  const cuenta = new Map();
  for (const c of citas) cuenta.set(c.service_name, (cuenta.get(c.service_name) || 0) + 1);
  return [...cuenta.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([nombre, veces]) => ({ nombre, veces }));
}

function calcularPeriodo(tz, tipo, fecha) {
  const base = dayBounds(tz, fecha);
  let desde = fecha;
  let hasta = fecha;
  if (tipo === "week") {
    desde = sumarDias(fecha, -((base.weekday + 6) % 7));
    hasta = sumarDias(desde, 6);
  } else if (tipo === "month") {
    const { y, mo } = base.parts;
    const ultimo = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    desde = `${y}-${String(mo).padStart(2, "0")}-01`;
    hasta = `${y}-${String(mo).padStart(2, "0")}-${String(ultimo).padStart(2, "0")}`;
  }
  return { desde, hasta, desdeMs: dayBounds(tz, desde).start, hastaMs: dayBounds(tz, hasta).end };
}

function sumarDias(fecha, n) {
  const { y, mo, d } = parseDate(fecha);
  const x = new Date(Date.UTC(y, mo - 1, d + n));
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}-${String(x.getUTCDate()).padStart(2, "0")}`;
}

function fechaEnZona(tz, ms) {
  const p = localParts(tz, ms);
  return `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

function solape(a1, a2, b1, b2) {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

async function businessTimezone(env, businessId) {
  const row = await env.DB.prepare("SELECT timezone FROM businesses WHERE id = ?").bind(businessId).first();
  return row ? row.timezone : "Europe/Madrid";
}

function aDto(c) {
  return {
    id: c.id,
    starts_at: new Date(c.starts_at).toISOString(),
    ends_at: new Date(c.ends_at).toISOString(),
    client_name: `${c.first_name} ${c.last_name}`,
    service_name: c.service_name,
    price_cents: c.price_cents,
    status: c.status,
  };
}
