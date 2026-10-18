// Avisos automáticos: se encolan al crear o cambiar citas, y un proceso programado
// (Cron Trigger) genera recordatorios y seguimientos y envía la cola con reintentos.
// Los avisos de marketing (reactivación) solo se envían con consentimiento del cliente.

import { HttpError, json, readJson, requireText, requireBusinessAccess } from "./http.js";
import { enviarEmail, enviarWhatsApp, emailConfigurado, whatsappConfigurado } from "./proveedores.js";
import { localParts, MINUTO } from "./tiempo.js";

const HORA = 60 * MINUTO;
const DIA = 24 * HORA;
const MAX_INTENTOS = 5;
const LOTE = 50;
const RETENCION_DIAS = 180;
const TIPOS = ["confirmacion", "recordatorio", "cancelacion", "cambio_hora", "aviso_profesional", "seguimiento", "hueco_libre", "reactivacion"];
const ROLES_QUE_VEN_AVISOS = ["owner", "admin"];

// ---------- Encolado ----------

// Un aviso va por WhatsApp si hay teléfono y la plantilla está aprobada; si no, por correo.
function destinoPara(env, cliente, tipo) {
  if (!cliente) return null;
  if (cliente.phone && whatsappConfigurado(env, tipo)) return { channel: "whatsapp", to: cliente.phone };
  if (cliente.email) return { channel: "email", to: cliente.email };
  return null;
}

async function encolar(env, { businessId, clienteId, citaId, tipo, destino, cuando, dedupe, texto, parametros }) {
  if (!destino) return false;
  const res = await env.DB.prepare(
    `INSERT OR IGNORE INTO notifications
       (id, business_id, client_id, appointment_id, kind, channel, to_address, subject, body, params,
        status, attempts, next_attempt_at, dedupe_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', 0, ?, ?, ?)`
  )
    .bind(crypto.randomUUID(), businessId, clienteId ?? null, citaId ?? null, tipo, destino.channel, destino.to,
      texto.asunto, texto.cuerpo, JSON.stringify(parametros || []), cuando, dedupe, Date.now())
    .run();
  return res.meta.changes > 0;
}

// Llamado desde crearCita (panel y reservas web). Un fallo aquí no debe impedir la reserva.
export async function alCrearCita(env, businessId, tz, cita, origen) {
  const negocio = await datosNegocio(env, businessId);
  const cliente = await datosCliente(env, cita.client_id);
  const cuando = formatoCuando(tz, cita.starts_at);
  const pendiente = cita.status === "pending";
  const texto = textos(pendiente ? "solicitud" : "confirmacion", { negocio: negocio.name, servicio: cita.service_name, cuando, nombre: cliente?.first_name });

  await encolar(env, {
    businessId, clienteId: cita.client_id, citaId: cita.id, tipo: "confirmacion",
    destino: destinoPara(env, cliente, "confirmacion"), cuando: Date.now(),
    dedupe: `confirmacion:${cita.id}`, texto, parametros: [negocio.name, cita.service_name, cuando],
  });

  if (origen === "web") {
    const propietario = await correoPropietario(env, businessId);
    const cuerpo = textos("aviso_profesional", {
      negocio: negocio.name, servicio: cita.service_name, cuando, cliente: cliente ? `${cliente.first_name} ${cliente.last_name}` : "Cliente",
    });
    await encolar(env, {
      businessId, clienteId: cita.client_id, citaId: cita.id, tipo: "aviso_profesional",
      destino: propietario ? { channel: "email", to: propietario } : null, cuando: Date.now(),
      dedupe: `aviso_profesional:${cita.id}`, texto: cuerpo,
    });
  }
}

// Llamado desde updateAppointment cuando cambia el estado o la hora.
export async function alCambiarCita(env, businessId, tz, antes, despues) {
  const negocio = await datosNegocio(env, businessId);
  const cliente = await datosCliente(env, despues.client_id);
  const cuando = formatoCuando(tz, despues.starts_at);

  if (despues.status === "cancelled" && antes.status !== "cancelled") {
    const texto = textos("cancelacion", { negocio: negocio.name, servicio: despues.service_name, cuando });
    await encolar(env, {
      businessId, clienteId: despues.client_id, citaId: despues.id, tipo: "cancelacion",
      destino: destinoPara(env, cliente, "cancelacion"), cuando: Date.now(),
      dedupe: `cancelacion:${despues.id}`, texto, parametros: [negocio.name, despues.service_name, cuando],
    });
    await avisarHuecoLibre(env, businessId, tz, despues);
    return;
  }

  const activa = despues.status === "pending" || despues.status === "confirmed";
  if (activa && antes.starts_at !== despues.starts_at) {
    const texto = textos("cambio_hora", { negocio: negocio.name, servicio: despues.service_name, cuando });
    await encolar(env, {
      businessId, clienteId: despues.client_id, citaId: despues.id, tipo: "cambio_hora",
      destino: destinoPara(env, cliente, "cambio_hora"), cuando: Date.now(),
      dedupe: `cambio_hora:${despues.id}:${despues.starts_at}`, texto, parametros: [negocio.name, despues.service_name, cuando],
    });
  }
}

// Cuando se libera un hueco, avisa a quien esperaba ese servicio ese día (máximo 5 personas).
async function avisarHuecoLibre(env, businessId, tz, cita) {
  const negocio = await datosNegocio(env, businessId);
  const fecha = fechaLocal(tz, cita.starts_at);
  const { results } = await env.DB.prepare(
    `SELECT id, client_id FROM waitlist
      WHERE business_id = ? AND service_id = ? AND fecha = ?
      ORDER BY created_at LIMIT 5`
  )
    .bind(businessId, cita.service_id, fecha)
    .all();

  const cuando = formatoCuando(tz, cita.starts_at);
  for (const entrada of results) {
    const cliente = await datosCliente(env, entrada.client_id);
    const texto = textos("hueco_libre", { negocio: negocio.name, servicio: cita.service_name, cuando });
    await encolar(env, {
      businessId, clienteId: entrada.client_id, citaId: cita.id, tipo: "hueco_libre",
      destino: destinoPara(env, cliente, "hueco_libre"), cuando: Date.now(),
      dedupe: `hueco_libre:${entrada.id}:${cita.id}`, texto, parametros: [negocio.name, cita.service_name, cuando],
    });
  }
}

// ---------- Proceso programado (Cron Trigger) ----------

export async function ejecutarAvisos(env, ahora = Date.now()) {
  await generarRecordatorios(env, ahora);
  await generarSeguimientos(env, ahora);
  await generarReactivaciones(env, ahora);
  const enviados = await procesarCola(env, ahora);
  await env.DB.prepare("DELETE FROM notifications WHERE created_at < ?").bind(ahora - RETENCION_DIAS * DIA).run();
  return enviados;
}

// Recordatorio: citas que empiezan entre 23 y 24 horas desde ahora. Cada cita entra una sola vez.
async function generarRecordatorios(env, ahora) {
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.business_id, a.client_id, a.service_name, a.starts_at, b.name AS negocio, b.timezone
       FROM appointments a JOIN businesses b ON b.id = a.business_id
      WHERE a.status IN ('pending', 'confirmed') AND a.starts_at >= ? AND a.starts_at < ?`
  )
    .bind(ahora + 23 * HORA, ahora + DIA)
    .all();

  for (const c of results) {
    const cliente = await datosCliente(env, c.client_id);
    const cuando = formatoCuando(c.timezone, c.starts_at);
    await encolar(env, {
      businessId: c.business_id, clienteId: c.client_id, citaId: c.id, tipo: "recordatorio",
      destino: destinoPara(env, cliente, "recordatorio"), cuando: ahora,
      dedupe: `recordatorio:${c.id}`, texto: textos("recordatorio", { negocio: c.negocio, servicio: c.service_name, cuando }),
      parametros: [c.negocio, c.service_name, cuando],
    });
  }
}

// Seguimiento: a las visitas completadas en las últimas 48 horas. La reseña solo se pide con consentimiento.
async function generarSeguimientos(env, ahora) {
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.business_id, a.client_id, b.name AS negocio, b.review_url, c.marketing_consent
       FROM appointments a
       JOIN businesses b ON b.id = a.business_id
       JOIN clients c ON c.id = a.client_id
      WHERE a.status = 'completed' AND a.ends_at >= ? AND a.ends_at < ?`
  )
    .bind(ahora - 2 * DIA, ahora)
    .all();

  for (const c of results) {
    const cliente = await datosCliente(env, c.client_id);
    const reseña = c.review_url && c.marketing_consent === 1 ? c.review_url : null;
    await encolar(env, {
      businessId: c.business_id, clienteId: c.client_id, citaId: c.id, tipo: "seguimiento",
      destino: destinoPara(env, cliente, "seguimiento"), cuando: ahora,
      dedupe: `seguimiento:${c.id}`, texto: textos("seguimiento", { negocio: c.negocio, reseña }),
      parametros: [c.negocio],
    });
  }
}

// Reactivación: clientes con consentimiento cuya última visita cumplió 90 días en la última hora.
// Así cada cliente recibe el aviso una sola vez.
async function generarReactivaciones(env, ahora) {
  const { results } = await env.DB.prepare(
    `SELECT a.business_id, a.client_id, MAX(a.starts_at) AS ultima, b.name AS negocio
       FROM appointments a JOIN businesses b ON b.id = a.business_id
      WHERE a.status = 'completed'
      GROUP BY a.business_id, a.client_id
     HAVING ultima >= ? AND ultima < ?`
  )
    .bind(ahora - 91 * DIA, ahora - 90 * DIA)
    .all();

  for (const r of results) {
    const cliente = await datosCliente(env, r.client_id);
    if (!cliente || cliente.marketing_consent !== 1) continue;
    await encolar(env, {
      businessId: r.business_id, clienteId: r.client_id, tipo: "reactivacion",
      destino: destinoPara(env, cliente, "reactivacion"), cuando: ahora,
      dedupe: `reactivacion:${r.client_id}:${r.ultima}`, texto: textos("reactivacion", { negocio: r.negocio }),
      parametros: [r.negocio],
    });
  }
}

async function procesarCola(env, ahora) {
  const { results } = await env.DB.prepare(
    `SELECT n.id, n.kind, n.channel, n.to_address, n.subject, n.body, n.params, n.attempts, n.appointment_id, a.starts_at
       FROM notifications n
       LEFT JOIN appointments a ON a.id = n.appointment_id
      WHERE n.status = 'pendiente' AND n.next_attempt_at <= ?
      ORDER BY n.next_attempt_at
      LIMIT ?`
  )
    .bind(ahora, LOTE)
    .all();

  let enviados = 0;
  for (const n of results) {
    // Un recordatorio de una cita que ya ha empezado no tiene sentido.
    if (n.kind === "recordatorio" && n.starts_at !== null && n.starts_at < ahora) {
      await actualizarAviso(env, n.id, "caducado", { error: "La cita ya ha empezado" });
      continue;
    }
    // Sin proveedor configurado el aviso queda pendiente: no se marca como enviado.
    if (n.channel === "email" && !emailConfigurado(env)) continue;
    if (n.channel === "whatsapp" && !whatsappConfigurado(env, n.kind)) continue;

    try {
      if (n.channel === "email") {
        await enviarEmail(env, { to: n.to_address, subject: n.subject, text: n.body });
      } else {
        await enviarWhatsApp(env, { tipo: n.kind, to: n.to_address, parametros: JSON.parse(n.params || "[]") });
      }
      await actualizarAviso(env, n.id, "enviado", { sentAt: Date.now() });
      enviados += 1;
    } catch (err) {
      const intentos = n.attempts + 1;
      const espera = Math.min(2 ** intentos, 24) * 5 * MINUTO;
      if (intentos >= MAX_INTENTOS) {
        await actualizarAviso(env, n.id, "fallido", { intentos, error: err.message });
      } else {
        await env.DB.prepare(
          "UPDATE notifications SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?"
        )
          .bind(intentos, ahora + espera, err.message, n.id)
          .run();
      }
    }
  }
  return enviados;
}

async function actualizarAviso(env, id, status, { sentAt = null, error = null, intentos = null } = {}) {
  await env.DB.prepare(
    `UPDATE notifications
        SET status = ?, sent_at = ?, last_error = ?, attempts = COALESCE(?, attempts)
      WHERE id = ?`
  )
    .bind(status, sentAt, error, intentos, id)
    .run();
}

// ---------- Rutas de la API ----------

export async function listarAvisos(request, env, businessId) {
  await requireBusinessAccess(request, env, businessId, ROLES_QUE_VEN_AVISOS);
  const { results } = await env.DB.prepare(
    `SELECT id, kind, channel, to_address, subject, status, attempts, last_error, created_at, sent_at
       FROM notifications WHERE business_id = ? ORDER BY created_at DESC LIMIT 100`
  )
    .bind(businessId)
    .all();

  return json({
    configuracion: { correo: emailConfigurado(env), whatsapp: Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID) },
    avisos: results.map((n) => ({
      id: n.id,
      kind: n.kind,
      channel: n.channel,
      destino: enmascarar(n.to_address),
      subject: n.subject,
      status: n.status,
      attempts: n.attempts,
      last_error: n.last_error,
      created_at: new Date(n.created_at).toISOString(),
      sent_at: n.sent_at ? new Date(n.sent_at).toISOString() : null,
    })),
  });
}

export async function reintentarAviso(request, env, businessId, avisoId) {
  await requireBusinessAccess(request, env, businessId, ROLES_QUE_VEN_AVISOS);
  const result = await env.DB.prepare(
    "UPDATE notifications SET status = 'pendiente', attempts = 0, next_attempt_at = ?, last_error = NULL WHERE id = ? AND business_id = ? AND status = 'fallido'"
  )
    .bind(Date.now(), avisoId, businessId)
    .run();
  if (!result.meta.changes) throw new HttpError(404, "Aviso no encontrado o no se puede reintentar");
  return json({ ok: true });
}

export async function listarEspera(request, env, businessId) {
  await requireBusinessAccess(request, env, businessId);
  const { results } = await env.DB.prepare(
    `SELECT w.id, w.fecha, w.client_id, w.service_id, c.first_name, c.last_name, s.name AS service_name
       FROM waitlist w
       JOIN clients c ON c.id = w.client_id
       JOIN services s ON s.id = w.service_id
      WHERE w.business_id = ?
      ORDER BY w.fecha, w.created_at`
  )
    .bind(businessId)
    .all();
  return json({
    espera: results.map((w) => ({
      id: w.id,
      fecha: w.fecha,
      client_id: w.client_id,
      client_name: `${w.first_name} ${w.last_name}`,
      service_id: w.service_id,
      service_name: w.service_name,
    })),
  });
}

export async function anadirEspera(request, env, businessId) {
  await requireBusinessAccess(request, env, businessId);
  const body = await readJson(request);
  const fecha = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;
  if (!fecha) throw new HttpError(400, "Indica el día (AAAA-MM-DD)");
  const cliente = await env.DB.prepare("SELECT id FROM clients WHERE id = ? AND business_id = ?")
    .bind(String(body.client_id || ""), businessId)
    .first();
  if (!cliente) throw new HttpError(404, "Cliente no encontrado");
  const servicio = await env.DB.prepare("SELECT id FROM services WHERE id = ? AND business_id = ?")
    .bind(String(body.service_id || ""), businessId)
    .first();
  if (!servicio) throw new HttpError(404, "Servicio no encontrado");

  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO waitlist (id, business_id, client_id, service_id, fecha, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(id, businessId, cliente.id, servicio.id, fecha, Date.now())
    .run();
  return json({ ok: true, id }, 201);
}

export async function quitarEspera(request, env, businessId, esperaId) {
  await requireBusinessAccess(request, env, businessId);
  const result = await env.DB.prepare("DELETE FROM waitlist WHERE id = ? AND business_id = ?")
    .bind(esperaId, businessId)
    .run();
  if (!result.meta.changes) throw new HttpError(404, "Entrada no encontrada");
  return json({ ok: true });
}

// ---------- Textos y utilidades ----------

export function textos(tipo, d) {
  const saludo = d.nombre ? `Hola ${d.nombre}, ` : "Hola, ";
  const firma = `Un saludo, ${d.negocio}.`;
  const plantillas = {
    solicitud: {
      asunto: `Hemos recibido tu solicitud en ${d.negocio}`,
      cuerpo: `${saludo}hemos recibido tu solicitud de ${d.servicio} para el ${d.cuando}. El negocio la revisará y te confirmará la cita.\n\n${firma}`,
    },
    confirmacion: {
      asunto: `Cita confirmada en ${d.negocio}`,
      cuerpo: `${saludo}tu cita de ${d.servicio} está confirmada para el ${d.cuando}.\n\n${firma}`,
    },
    recordatorio: {
      asunto: `Recordatorio: mañana tienes cita en ${d.negocio}`,
      cuerpo: `${saludo}te recordamos tu cita de ${d.servicio} el ${d.cuando}.\n\n${firma}`,
    },
    cancelacion: {
      asunto: `Cita cancelada en ${d.negocio}`,
      cuerpo: `${saludo}tu cita de ${d.servicio} del ${d.cuando} ha sido cancelada. Si quieres reservar otra hora, contacta con nosotros.\n\n${firma}`,
    },
    cambio_hora: {
      asunto: `Tu cita en ${d.negocio} ha cambiado de hora`,
      cuerpo: `${saludo}tu cita de ${d.servicio} se ha cambiado al ${d.cuando}.\n\n${firma}`,
    },
    aviso_profesional: {
      asunto: `Nueva reserva web: ${d.cliente}`,
      cuerpo: `Nueva solicitud de cita desde la página de reservas: ${d.cliente}, ${d.servicio}, ${d.cuando}. Confírmala desde la agenda del panel.`,
    },
    seguimiento: {
      asunto: `Gracias por tu visita a ${d.negocio}`,
      cuerpo: `${saludo}gracias por venir a ${d.negocio}. Esperamos verte pronto.${d.reseña ? `\n\n¿Nos dejas tu opinión? ${d.reseña}` : ""}\n\n${firma}`,
    },
    hueco_libre: {
      asunto: `Se ha liberado un hueco en ${d.negocio}`,
      cuerpo: `Se ha liberado un hueco de ${d.servicio} el ${d.cuando}. Si te interesa, contacta con ${d.negocio} cuanto antes.`,
    },
    reactivacion: {
      asunto: `Te echamos de menos en ${d.negocio}`,
      cuerpo: `Hace tiempo que no te vemos en ${d.negocio}. Cuando quieras, contacta con nosotros para reservar tu próxima cita.\n\n${firma}`,
    },
  };
  return plantillas[tipo];
}

async function datosNegocio(env, businessId) {
  return env.DB.prepare("SELECT name, timezone, review_url FROM businesses WHERE id = ?").bind(businessId).first();
}

async function datosCliente(env, clienteId) {
  return env.DB.prepare(
    "SELECT first_name, last_name, phone, email, marketing_consent FROM clients WHERE id = ?"
  )
    .bind(clienteId)
    .first();
}

async function correoPropietario(env, businessId) {
  const fila = await env.DB.prepare(
    `SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.business_id = ? AND m.role = 'owner' LIMIT 1`
  )
    .bind(businessId)
    .first();
  return fila ? fila.email : null;
}

function formatoCuando(tz, ms) {
  return new Date(ms).toLocaleString("es-ES", { timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

function fechaLocal(tz, ms) {
  const p = localParts(tz, ms);
  return `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

function enmascarar(correo) {
  if (correo.includes("@")) {
    const [usuario, dominio] = correo.split("@");
    return `${usuario.slice(0, 2)}***@${dominio}`;
  }
  return `${correo.slice(0, 3)}***${correo.slice(-2)}`;
}

export { TIPOS };
