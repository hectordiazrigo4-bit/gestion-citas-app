// Servicios del negocio: nombre, precio, duración y tiempo de preparación.
// Leer lo puede hacer cualquier miembro; cambiarlos, solo propietario y administrador.

import {
  HttpError,
  json,
  readJson,
  requireText,
  optionalText,
  parseIntegerInRange,
  requireBusinessAccess,
} from "./http.js";

const ROLES_QUE_GESTIONAN = ["owner", "admin"];
const PRECIO_MAXIMO = 100000; // euros

export async function listServices(request, env, businessId) {
  await requireBusinessAccess(request, env, businessId);
  const { results } = await env.DB.prepare(
    `SELECT id, name, description, price_cents, duration_min, prep_min, active
       FROM services
      WHERE business_id = ?
      ORDER BY active DESC, name`
  )
    .bind(businessId)
    .all();

  return json({ services: results.map(toDto) });
}

export async function createService(request, env, businessId) {
  await requireBusinessAccess(request, env, businessId, ROLES_QUE_GESTIONAN);
  const data = parseService(await readJson(request));
  const id = crypto.randomUUID();
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO services
       (id, business_id, name, description, price_cents, duration_min, prep_min, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, businessId, data.name, data.description, data.price_cents, data.duration_min, data.prep_min, data.active, now, now)
    .run();

  return json({ service: toDto({ id, ...data }) }, 201);
}

export async function updateService(request, env, businessId, serviceId) {
  await requireBusinessAccess(request, env, businessId, ROLES_QUE_GESTIONAN);
  // Se filtra también por negocio: un servicio de otro negocio se trata como inexistente.
  const existe = await env.DB.prepare("SELECT id FROM services WHERE id = ? AND business_id = ?")
    .bind(serviceId, businessId)
    .first();
  if (!existe) throw new HttpError(404, "Servicio no encontrado");

  const data = parseService(await readJson(request));
  await env.DB.prepare(
    `UPDATE services
        SET name = ?, description = ?, price_cents = ?, duration_min = ?, prep_min = ?, active = ?, updated_at = ?
      WHERE id = ? AND business_id = ?`
  )
    .bind(data.name, data.description, data.price_cents, data.duration_min, data.prep_min, data.active, Date.now(), serviceId, businessId)
    .run();

  return json({ service: toDto({ id: serviceId, ...data }) });
}

export async function deleteService(request, env, businessId, serviceId) {
  await requireBusinessAccess(request, env, businessId, ROLES_QUE_GESTIONAN);
  let result;
  try {
    result = await env.DB.prepare("DELETE FROM services WHERE id = ? AND business_id = ?")
      .bind(serviceId, businessId)
      .run();
  } catch (err) {
    if (String(err.message).includes("FOREIGN KEY")) {
      throw new HttpError(409, "Este servicio tiene citas registradas. Desactívalo en lugar de eliminarlo.");
    }
    throw err;
  }
  if (!result.meta.changes) throw new HttpError(404, "Servicio no encontrado");

  return json({ ok: true });
}

function parseService(body) {
  const precio = Number(body.price);
  if (!Number.isFinite(precio) || precio < 0 || precio > PRECIO_MAXIMO) {
    throw new HttpError(400, `El precio debe estar entre 0 y ${PRECIO_MAXIMO} €`);
  }
  return {
    name: requireText(body.name, "nombre del servicio", 120),
    description: optionalText(body.description, "descripción", 1000),
    price_cents: Math.round(precio * 100),
    duration_min: parseIntegerInRange(body.duration_min, "duración (minutos)", 5, 720),
    prep_min: parseIntegerInRange(body.prep_min ?? 0, "tiempo de preparación (minutos)", 0, 240),
    active: body.active === false ? 0 : 1,
  };
}

function toDto(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    price_cents: row.price_cents,
    duration_min: row.duration_min,
    prep_min: row.prep_min,
    active: row.active === 1 || row.active === true,
  };
}
