// Clientes del negocio. Son datos personales: cada consulta se filtra por negocio
// y en las respuestas solo se devuelven los campos necesarios.

import {
  HttpError,
  json,
  readJson,
  requireText,
  optionalText,
  parseOptionalEmail,
  requireBusinessAccess,
  escapeLike,
} from "./http.js";

const LIMITE_LISTA = 50;
const MAX_ETIQUETAS = 10;
const MAX_ETIQUETA = 30;

export async function listClients(request, env, businessId, url) {
  await requireBusinessAccess(request, env, businessId);

  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const params = [businessId];
  let sql = `SELECT id, first_name, last_name, phone, email, tags, marketing_consent
               FROM clients
              WHERE business_id = ?`;

  if (q) {
    const like = `%${escapeLike(q)}%`;
    sql += ` AND (first_name LIKE ? ESCAPE '\\' OR last_name LIKE ? ESCAPE '\\'
              OR phone LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')`;
    params.push(like, like, like, like);
  }
  sql += " ORDER BY first_name, last_name LIMIT ?";
  params.push(LIMITE_LISTA);

  const { results } = await env.DB.prepare(sql).bind(...params).all();
  return json({ clients: results.map(toListDto) });
}

export async function getClient(request, env, businessId, clientId) {
  await requireBusinessAccess(request, env, businessId);
  const row = await findClient(env, businessId, clientId);
  return json({ client: toDto(row) });
}

export async function createClient(request, env, businessId) {
  await requireBusinessAccess(request, env, businessId);
  const data = parseClient(await readJson(request));
  const id = crypto.randomUUID();
  const now = Date.now();
  const consentAt = data.marketing_consent ? now : null;

  try {
    await env.DB.prepare(
      `INSERT INTO clients
         (id, business_id, first_name, last_name, phone, email, notes, tags,
          marketing_consent, consent_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(id, businessId, data.first_name, data.last_name, data.phone, data.email, data.notes,
        JSON.stringify(data.tags), data.marketing_consent ? 1 : 0, consentAt, now, now)
      .run();
  } catch (err) {
    throw telefonoDuplicado(err);
  }

  return json({ client: toDto(storedRow(id, data, consentAt, now)) }, 201);
}

export async function updateClient(request, env, businessId, clientId) {
  await requireBusinessAccess(request, env, businessId);
  const actual = await findClient(env, businessId, clientId);
  const data = parseClient(await readJson(request));

  // La fecha de consentimiento solo cambia cuando cambia el propio consentimiento.
  let consentAt = null;
  if (data.marketing_consent) {
    consentAt = actual.marketing_consent ? actual.consent_at : Date.now();
  }

  try {
    await env.DB.prepare(
      `UPDATE clients
          SET first_name = ?, last_name = ?, phone = ?, email = ?, notes = ?, tags = ?,
              marketing_consent = ?, consent_at = ?, updated_at = ?
        WHERE id = ? AND business_id = ?`
    )
      .bind(data.first_name, data.last_name, data.phone, data.email, data.notes, JSON.stringify(data.tags),
        data.marketing_consent ? 1 : 0, consentAt, Date.now(), clientId, businessId)
      .run();
  } catch (err) {
    throw telefonoDuplicado(err);
  }

  return json({ client: toDto(storedRow(clientId, data, consentAt, actual.created_at)) });
}

export async function deleteClient(request, env, businessId, clientId) {
  await requireBusinessAccess(request, env, businessId);
  const result = await env.DB.prepare("DELETE FROM clients WHERE id = ? AND business_id = ?")
    .bind(clientId, businessId)
    .run();
  if (!result.meta.changes) throw new HttpError(404, "Cliente no encontrado");

  return json({ ok: true });
}

async function findClient(env, businessId, clientId) {
  const row = await env.DB.prepare(
    `SELECT id, first_name, last_name, phone, email, notes, tags,
            marketing_consent, consent_at, created_at
       FROM clients
      WHERE id = ? AND business_id = ?`
  )
    .bind(clientId, businessId)
    .first();
  if (!row) throw new HttpError(404, "Cliente no encontrado");
  return row;
}

// Un mismo teléfono no puede repetirse dentro del negocio (lo garantiza un índice único).
function telefonoDuplicado(err) {
  if (String(err.message).includes("UNIQUE")) {
    return new HttpError(409, "Ya existe un cliente con ese teléfono en tu negocio");
  }
  return err;
}

function parseClient(body) {
  const consent = body.marketing_consent === true;
  return {
    first_name: requireText(body.first_name, "nombre", 80),
    last_name: requireText(body.last_name, "apellidos", 120),
    phone: parsePhone(body.phone),
    email: parseOptionalEmail(body.email),
    notes: optionalText(body.notes, "notas", 2000),
    tags: parseTags(body.tags),
    marketing_consent: consent,
  };
}

// Guarda el teléfono en formato internacional (+34…) para que el mismo número
// escrito de distintas formas no se pueda duplicar. Sin prefijo, se asume España (+34).
function parsePhone(value) {
  const raw = optionalText(value, "teléfono", 20);
  if (raw === null) return null;
  let numero = raw.replace(/[\s.-]/g, "");
  if (numero.startsWith("00")) numero = `+${numero.slice(2)}`;
  if (/^[0-9]{9}$/.test(numero)) numero = `+34${numero}`;
  if (!/^\+[0-9]{8,15}$/.test(numero)) {
    throw new HttpError(400, "El teléfono no es válido (escribe 9 cifras o el número con prefijo, p. ej. +34)");
  }
  return numero;
}

function parseTags(value) {
  if (value === undefined || value === null || value === "") return [];
  if (!Array.isArray(value)) throw new HttpError(400, "Las etiquetas deben enviarse como lista");
  if (value.length > MAX_ETIQUETAS) throw new HttpError(400, `Máximo ${MAX_ETIQUETAS} etiquetas`);
  return value.map((etiqueta) => requireText(etiqueta, "etiqueta", MAX_ETIQUETA));
}

// Forma de la fila tal como queda guardada, para devolver la misma respuesta que una lectura.
function storedRow(id, data, consentAt, createdAt) {
  return {
    id,
    ...data,
    marketing_consent: data.marketing_consent ? 1 : 0,
    consent_at: consentAt,
    tags: JSON.stringify(data.tags),
    created_at: createdAt,
  };
}

function parseTagsStored(text) {
  try {
    const list = JSON.parse(text || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function toListDto(row) {
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    phone: row.phone ?? null,
    email: row.email ?? null,
    tags: parseTagsStored(row.tags),
    marketing_consent: row.marketing_consent === 1,
  };
}

function toDto(row) {
  return {
    ...toListDto(row),
    notes: row.notes ?? null,
    consent_at: row.consent_at ?? null,
    created_at: row.created_at ?? null,
  };
}
