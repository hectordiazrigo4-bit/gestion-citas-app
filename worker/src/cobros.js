// Cobros manuales de citas: efectivo, tarjeta, transferencia u otro, y devoluciones.
// No se guarda ningún dato de tarjeta: solo el medio de pago.
// Los límites se comprueban dentro de la propia escritura, así dos cobros a la vez no superan el precio.

import { HttpError, json, readJson, optionalText, requireBusinessAccess } from "./http.js";

const METODOS = ["efectivo", "tarjeta", "transferencia", "otro"];
const GESTIONAN = ["owner", "admin"];
const IMPORTE_MAXIMO = 100000;
const NETO = "COALESCE(SUM(CASE WHEN kind = 'pago' THEN amount_cents ELSE -amount_cents END), 0)";

export async function listarCobros(request, env, businessId, citaId) {
  await requireBusinessAccess(request, env, businessId);
  const cita = await citaDelNegocio(env, businessId, citaId);
  const { results } = await env.DB.prepare(
    `SELECT id, kind, amount_cents, method, note, paid_at FROM payments
      WHERE appointment_id = ? AND business_id = ? ORDER BY paid_at, created_at`
  )
    .bind(citaId, businessId)
    .all();

  const cobrado = results.reduce((total, p) => total + (p.kind === "pago" ? p.amount_cents : -p.amount_cents), 0);
  return json({
    precio_cents: cita.price_cents,
    cobrado_cents: cobrado,
    pendiente_cents: Math.max(0, cita.price_cents - cobrado),
    cobros: results.map((p) => ({
      id: p.id,
      kind: p.kind,
      amount_cents: p.amount_cents,
      method: p.method,
      note: p.note ?? null,
      paid_at: new Date(p.paid_at).toISOString(),
    })),
  });
}

export async function registrarCobro(request, env, businessId, citaId) {
  const { user } = await requireBusinessAccess(request, env, businessId);
  const cita = await citaDelNegocio(env, businessId, citaId);
  const body = await readJson(request);

  const tipo = body.kind === undefined ? "pago" : body.kind;
  if (tipo !== "pago" && tipo !== "devolucion") throw new HttpError(400, "El tipo de movimiento no es válido");
  if (tipo === "devolucion") {
    // Solo propietario y administrador devuelven dinero.
    await requireBusinessAccess(request, env, businessId, GESTIONAN);
  }
  if (!METODOS.includes(body.method)) throw new HttpError(400, "Elige un medio de pago: efectivo, tarjeta, transferencia u otro");

  const euros = Number(body.amount);
  if (!Number.isFinite(euros) || euros <= 0 || euros > IMPORTE_MAXIMO) {
    throw new HttpError(400, `El importe debe ser mayor que 0 y como máximo ${IMPORTE_MAXIMO} €`);
  }
  const centimos = Math.round(euros * 100);
  const nota = optionalText(body.note, "nota", 200);
  const ahora = Date.now();

  let res;
  if (tipo === "pago") {
    res = await env.DB.prepare(
      `INSERT INTO payments (id, business_id, appointment_id, kind, amount_cents, method, note, created_by, paid_at, created_at)
       SELECT ?, ?, a.id, 'pago', ?, ?, ?, ?, ?, ?
         FROM appointments a
        WHERE a.id = ? AND a.business_id = ? AND a.status <> 'cancelled'
          AND (SELECT ${NETO} FROM payments WHERE appointment_id = a.id) + ? <= a.price_cents`
    )
      .bind(crypto.randomUUID(), businessId, centimos, body.method, nota, user.id, ahora, ahora, citaId, businessId, centimos)
      .run();
  } else {
    res = await env.DB.prepare(
      `INSERT INTO payments (id, business_id, appointment_id, kind, amount_cents, method, note, created_by, paid_at, created_at)
       SELECT ?, ?, a.id, 'devolucion', ?, ?, ?, ?, ?, ?
         FROM appointments a
        WHERE a.id = ? AND a.business_id = ?
          AND (SELECT ${NETO} FROM payments WHERE appointment_id = a.id) >= ?`
    )
      .bind(crypto.randomUUID(), businessId, centimos, body.method, nota, user.id, ahora, ahora, citaId, businessId, centimos)
      .run();
  }

  if (!res.meta.changes) {
    if (tipo === "devolucion") throw new HttpError(400, "No puedes devolver más de lo cobrado en esta cita");
    if (cita.status === "cancelled") throw new HttpError(400, "No se pueden registrar cobros de una cita cancelada");
    throw new HttpError(400, "El cobro supera el precio pendiente de la cita");
  }
  return json({ ok: true }, 201);
}

async function citaDelNegocio(env, businessId, citaId) {
  const cita = await env.DB.prepare("SELECT id, price_cents, status FROM appointments WHERE id = ? AND business_id = ?")
    .bind(citaId, businessId)
    .first();
  if (!cita) throw new HttpError(404, "Cita no encontrada");
  return cita;
}
