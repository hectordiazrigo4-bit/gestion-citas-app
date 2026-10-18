// Envío real por proveedor (correo con Resend, WhatsApp con la API oficial de Meta).
// Si falta alguna variable de configuración NO se simula ningún envío: se devuelve configured: false
// y el aviso se queda pendiente hasta que se configure el proveedor.

const RESEND_URL = "https://api.resend.com";
const GRAPH_URL = "https://graph.facebook.com/v20.0";

export function emailConfigurado(env) {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

export function plantillaWhatsapp(env, tipo) {
  return env[`WHATSAPP_TPL_${tipo.toUpperCase()}`] || null;
}

export function whatsappConfigurado(env, tipo) {
  return Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID && plantillaWhatsapp(env, tipo));
}

export async function enviarEmail(env, { to, subject, text }) {
  if (!emailConfigurado(env)) return { configured: false };
  const res = await fetch(`${env.EMAIL_API_URL || RESEND_URL}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text }),
  });
  // El mensaje de error no incluye el destinatario ni el contenido.
  if (!res.ok) throw new Error(`Proveedor de correo: respuesta ${res.status}`);
  return { configured: true };
}

export async function enviarWhatsApp(env, { tipo, to, parametros }) {
  if (!whatsappConfigurado(env, tipo)) return { configured: false };
  const res = await fetch(`${GRAPH_URL}/${env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to.replace(/^\+/, ""),
      type: "template",
      template: {
        name: plantillaWhatsapp(env, tipo),
        language: { code: "es" },
        components: [{ type: "body", parameters: parametros.map((texto) => ({ type: "text", text: String(texto) })) }],
      },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp: respuesta ${res.status}`);
  return { configured: true };
}
