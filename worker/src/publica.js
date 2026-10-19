// Reservas online: páginas públicas por negocio, sin sesión.
// Solo exponen servicios activos y huecos libres. Las reservas llegan como "pendientes"
// y el negocio las confirma desde el panel.

import { HttpError, json, readJson, requireText, optionalText, parseOptionalEmail } from "./http.js";
import { parsePhone } from "./clients.js";
import { huecosLibres } from "./disponibilidad.js";
import { crearCita } from "./citas.js";
import { parseDateTime, localParts } from "./tiempo.js";
import { hashToken } from "./crypto.js";

const MAX_RESERVAS_POR_HORA = 10;
const HORA_MS = 60 * 60 * 1000;

export function generarSlug(nombre) {
  const base = String(nombre)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "negocio";
  const sufijo = crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 4);
  return `${base}-${sufijo}`;
}

export async function getPublicBusiness(request, env, slug) {
  const negocio = await negocioPorSlug(env, slug);
  const { results } = await env.DB.prepare(
    "SELECT id, name, description, price_cents, duration_min FROM services WHERE business_id = ? AND active = 1 ORDER BY name"
  )
    .bind(negocio.id)
    .all();

  const profesionales = await env.DB.prepare(
    `SELECT u.id, u.name, es.service_id
       FROM employee_services es
       JOIN users u ON u.id = es.user_id
      WHERE es.business_id = ?`
  )
    .bind(negocio.id)
    .all();
  const porId = new Map();
  for (const r of profesionales.results) {
    if (!porId.has(r.id)) porId.set(r.id, { id: r.id, name: r.name, service_ids: [] });
    porId.get(r.id).service_ids.push(r.service_id);
  }

  return json({
    business: { name: negocio.name, timezone: negocio.timezone, cancel_hours: negocio.cancel_hours },
    professionals: [...porId.values()],
    services: results.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description ?? null,
      price_cents: s.price_cents,
      duration_min: s.duration_min,
    })),
  });
}

export async function getPublicAvailability(request, env, slug, url) {
  const negocio = await negocioPorSlug(env, slug);
  const resultado = await huecosLibres(
    env,
    negocio.id,
    url.searchParams.get("date"),
    url.searchParams.get("service_id") || "",
    url.searchParams.get("employee_id") || null
  );
  return json(resultado);
}

export async function crearReservaPublica(request, env, slug) {
  const negocio = await negocioPorSlug(env, slug);
  await limitarIntentos(request, env, slug);

  const body = await readJson(request);
  if (body.privacy !== true) {
    throw new HttpError(400, "Debes aceptar la política de privacidad para reservar");
  }
  const nombre = requireText(body.first_name, "nombre", 80);
  const apellidos = requireText(body.last_name, "apellidos", 120);
  if (!body.phone) throw new HttpError(400, "Indica tu teléfono para poder contactarte");
  const telefono = parsePhone(body.phone);
  const email = parseOptionalEmail(body.email);
  const notas = optionalText(body.notes, "notas", 500);

  // La hora debe seguir libre según el horario y las citas actuales.
  const inicio = parseDateTime(body.starts, negocio.timezone);
  if (inicio < Date.now()) throw new HttpError(400, "No se puede reservar una hora que ya ha pasado");
  const fecha = fechaLocal(negocio.timezone, inicio);
  const { slots } = await huecosLibres(env, negocio.id, fecha, body.service_id || "");
  if (!slots.some((s) => Date.parse(s) === inicio)) {
    throw new HttpError(409, "Ese hueco ya no está disponible. Elige otra hora.");
  }
  const profesional = await elegirProfesional(env, negocio.id, fecha, body.service_id || "", inicio, body.employee_id || null);

  const clienteId = await clientePorTelefono(env, negocio.id, telefono, { nombre, apellidos, email });
  const cita = await crearCita(
    env,
    negocio.id,
    negocio.timezone,
    {
      client_id: clienteId,
      service_id: body.service_id,
      starts: body.starts,
      status: "pending",
      employee_id: profesional,
      notes: notas ? `Reserva web: ${notas}` : "Reserva web",
    },
    { source: "web", privacyAccepted: true }
  );

  return json(
    {
      appointment: {
        code: cita.id.slice(0, 8).toUpperCase(),
        service_name: cita.service_name,
        starts_at: new Date(cita.starts_at).toISOString(),
        ends_at: new Date(cita.ends_at).toISOString(),
        status: cita.status,
      },
      timezone: negocio.timezone,
      cancel_hours: negocio.cancel_hours,
    },
    201
  );
}

// Con profesional elegido, se usa ese. Si no, se asigna el primero que tenga libre ese hueco.
async function elegirProfesional(env, businessId, fecha, serviceId, inicio, elegido) {
  if (elegido) {
    const { slots } = await huecosLibres(env, businessId, fecha, serviceId, elegido);
    if (!slots.some((s) => Date.parse(s) === inicio)) throw new HttpError(409, "Ese profesional no tiene libre esa hora");
    return elegido;
  }
  const { results } = await env.DB.prepare("SELECT user_id FROM employee_services WHERE business_id = ? AND service_id = ? ORDER BY user_id")
    .bind(businessId, serviceId)
    .all();
  if (results.length === 0) return null;
  for (const r of results) {
    const { slots } = await huecosLibres(env, businessId, fecha, serviceId, r.user_id);
    if (slots.some((s) => Date.parse(s) === inicio)) return r.user_id;
  }
  throw new HttpError(409, "Ese hueco ya no está disponible. Elige otra hora.");
}

// Reutiliza la ficha si el teléfono ya existe en el negocio; si no, crea una nueva.
async function clientePorTelefono(env, businessId, telefono, { nombre, apellidos, email }) {
  const existente = await env.DB.prepare("SELECT id FROM clients WHERE business_id = ? AND phone = ?")
    .bind(businessId, telefono)
    .first();
  if (existente) return existente.id;

  const id = crypto.randomUUID();
  const now = Date.now();
  try {
    await env.DB.prepare(
      `INSERT INTO clients (id, business_id, first_name, last_name, phone, email, tags, marketing_consent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '[]', 0, ?, ?)`
    )
      .bind(id, businessId, nombre, apellidos, telefono, email, now, now)
      .run();
    return id;
  } catch (err) {
    // Otra reserva creó la ficha a la vez: se usa esa.
    if (String(err.message).includes("UNIQUE")) {
      const creada = await env.DB.prepare("SELECT id FROM clients WHERE business_id = ? AND phone = ?")
        .bind(businessId, telefono)
        .first();
      if (creada) return creada.id;
    }
    throw err;
  }
}

// Limita las reservas por IP y negocio. Solo se guarda un hash de la IP.
async function limitarIntentos(request, env, slug) {
  const ip = request.headers.get("cf-connecting-ip") || "sin-ip";
  const clave = await hashToken(`${slug}|${ip}`);
  const ventana = Math.floor(Date.now() / HORA_MS);

  await env.DB.prepare(
    `INSERT INTO rate_limits (clave, ventana, cuenta) VALUES (?, ?, 1)
     ON CONFLICT (clave) DO UPDATE SET
       cuenta = CASE WHEN rate_limits.ventana = excluded.ventana THEN rate_limits.cuenta + 1 ELSE 1 END,
       ventana = excluded.ventana`
  )
    .bind(clave, ventana)
    .run();
  await env.DB.prepare("DELETE FROM rate_limits WHERE ventana < ?").bind(ventana - 2).run();

  const fila = await env.DB.prepare("SELECT cuenta FROM rate_limits WHERE clave = ?").bind(clave).first();
  if (fila && fila.cuenta > MAX_RESERVAS_POR_HORA) {
    throw new HttpError(429, "Has hecho demasiados intentos. Inténtalo más tarde o contacta con el negocio.");
  }
}

async function negocioPorSlug(env, slug) {
  const negocio = await env.DB.prepare("SELECT id, name, timezone, cancel_hours FROM businesses WHERE slug = ?")
    .bind(slug)
    .first();
  if (!negocio) throw new HttpError(404, "Negocio no encontrado");
  return negocio;
}

function fechaLocal(timezone, ms) {
  const p = localParts(timezone, ms);
  return `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

// Manifiesto de instalación propio de cada negocio: la app instalada abre directamente su página de reserva.
export async function getPublicManifest(request, env, slug) {
  const negocio = await negocioPorSlug(env, slug);
  const manifiesto = {
    id: `/reservar.html?n=${slug}`,
    name: `Reservar en ${negocio.name}`,
    short_name: negocio.name.slice(0, 12),
    start_url: `/reservar.html?n=${slug}`,
    scope: "/reservar.html",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f5f5f2",
    theme_color: "#0f6e56",
    lang: "es",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
  return new Response(JSON.stringify(manifiesto), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
