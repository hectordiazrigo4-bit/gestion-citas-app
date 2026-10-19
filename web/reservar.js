const $ = (id) => document.getElementById(id);
const slug = new URLSearchParams(location.search).get("n") || "";
const reserva = { negocio: null, servicio: null, dia: null, hueco: null, peticion: 0, profesionales: [] };

// Manifiesto propio del negocio: al instalar, la app abre directamente esta página de reserva.
const enlaceManifiesto = document.querySelector('link[rel="manifest"]');
if (enlaceManifiesto && slug) enlaceManifiesto.href = `/api/public/businesses/${encodeURIComponent(slug)}/manifest`;

// Android y ordenador: el navegador ofrece instalar la app y lo mostramos con un botón.
let eventoInstalar = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  eventoInstalar = e;
  $("bloqueInstalar").hidden = false;
  $("botonInstalar").hidden = false;
});
$("botonInstalar").addEventListener("click", async () => {
  if (!eventoInstalar) return;
  eventoInstalar.prompt();
  await eventoInstalar.userChoice;
  eventoInstalar = null;
  $("botonInstalar").hidden = true;
});

// iPhone no tiene botón de instalación: explicamos los pasos en Safari.
const esIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
const yaInstalada = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
if (esIos && !yaInstalada) {
  $("bloqueInstalar").hidden = false;
  $("ayudaIphone").hidden = false;
}

function euros(centimos) {
  return `${(centimos / 100).toFixed(2).replace(".", ",")} €`;
}

function crear(tag, clase, texto) {
  const el = document.createElement(tag);
  if (clase) el.className = clase;
  if (texto !== undefined && texto !== null) el.textContent = texto;
  return el;
}

async function api(path, method = "GET", body) {
  const options = { method, credentials: "same-origin", headers: {} };
  if (method !== "GET") {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body || {});
  }
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Ha ocurrido un error. Inténtalo de nuevo.");
  return data;
}

function hoyLocal() {
  return new Date().toLocaleDateString("sv-SE");
}

function horaEn(iso, tz) {
  return new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: tz });
}

function fechaEn(iso, tz) {
  return new Date(iso).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: tz });
}

function mostrarError(id, mensaje) {
  $(id).textContent = mensaje;
  $(id).hidden = !mensaje;
}

async function iniciar() {
  if (!slug) {
    $("cargandoReserva").hidden = true;
    mostrarError("errorGeneral", "El enlace de reserva no es válido. Pide al negocio el enlace correcto.");
    return;
  }
  try {
    const { business, services, professionals } = await api(`/api/public/businesses/${encodeURIComponent(slug)}`);
    reserva.negocio = business;
    reserva.profesionales = professionals;
    document.title = `Reservar en ${business.name}`;
    $("nombreNegocioPublico").textContent = business.name;
    $("horasCancelacion").textContent = `Puedes cancelar sin coste hasta ${business.cancel_hours} horas antes.`;
    $("cargandoReserva").hidden = true;

    if (services.length === 0) {
      mostrarError("errorGeneral", "Ahora mismo no hay servicios disponibles para reservar online.");
      return;
    }
    pintarServicios(services);
    $("reservaPaso1").hidden = false;
  } catch (err) {
    $("cargandoReserva").hidden = true;
    mostrarError("errorGeneral", err.message);
  }
}

function pintarServicios(services) {
  const lista = $("listaServiciosPublicos");
  lista.replaceChildren();
  for (const s of services) {
    const boton = crear("button", "servicio-opcion");
    boton.type = "button";
    boton.setAttribute("aria-pressed", "false");
    const textos = crear("div", "elemento-texto");
    textos.append(crear("strong", "", s.name));
    const detalle = [`${s.duration_min} min`, euros(s.price_cents)];
    textos.append(crear("span", "detalle", detalle.join(" · ")));
    if (s.description) textos.append(crear("span", "detalle", s.description));
    boton.append(textos);
    boton.addEventListener("click", () => elegirServicio(s, boton));
    lista.append(boton);
  }
}

function elegirServicio(servicio, boton) {
  reserva.servicio = servicio;
  reserva.hueco = null;
  for (const b of document.querySelectorAll(".servicio-opcion")) b.setAttribute("aria-pressed", String(b === boton));
  $("diaReserva").min = hoyLocal();
  const posibles = reserva.profesionales.filter((p) => p.service_ids.includes(servicio.id));
  $("bloqueProfesional").hidden = posibles.length === 0;
  $("profesionalReserva").replaceChildren(
    new Option("Cualquiera disponible", ""),
    ...posibles.map((p) => new Option(p.name, p.id))
  );
  $("reservaPaso2").hidden = false;
  $("reservaPaso3").hidden = true;
  if (reserva.dia) cargarHuecos();
  $("reservaPaso2").scrollIntoView({ behavior: "smooth", block: "start" });
}

$("profesionalReserva").addEventListener("change", () => {
  reserva.hueco = null;
  $("reservaPaso3").hidden = true;
  cargarHuecos();
});

$("diaReserva").addEventListener("change", (e) => {
  reserva.dia = e.target.value;
  reserva.hueco = null;
  $("reservaPaso3").hidden = true;
  cargarHuecos();
});

async function cargarHuecos() {
  const lista = $("listaHuecos");
  lista.replaceChildren();
  $("sinHuecos").hidden = true;
  if (!reserva.dia || !reserva.servicio) return;
  // Si el cliente cambia de día mientras se carga, solo cuenta la última petición.
  const peticion = ++reserva.peticion;
  try {
    const { slots, timezone } = await api(
      `/api/public/businesses/${encodeURIComponent(slug)}/availability?date=${reserva.dia}&service_id=${reserva.servicio.id}&employee_id=${encodeURIComponent($("profesionalReserva").value)}`
    );
    if (peticion !== reserva.peticion) return;
    reserva.tz = timezone;
    $("sinHuecos").hidden = slots.length > 0;
    for (const iso of slots) {
      const boton = crear("button", "hueco", horaEn(iso, timezone));
      boton.type = "button";
      boton.addEventListener("click", () => elegirHueco(iso, boton));
      lista.append(boton);
    }
  } catch (err) {
    mostrarError("errorGeneral", err.message);
  }
}

function elegirHueco(iso, boton) {
  reserva.hueco = iso;
  for (const b of document.querySelectorAll(".hueco")) b.setAttribute("aria-pressed", String(b === boton));
  const cuando = `${fechaEn(iso, reserva.tz)} a las ${horaEn(iso, reserva.tz)}`;
  $("resumenReserva").textContent = `${reserva.servicio.name} · ${cuando} · ${euros(reserva.servicio.price_cents)}`;
  $("reservaPaso3").hidden = false;
  $("reservaPaso3").scrollIntoView({ behavior: "smooth", block: "start" });
}

$("reservaPaso3").addEventListener("submit", async (e) => {
  e.preventDefault();
  const boton = e.submitter;
  boton.disabled = true;
  mostrarError("errorReserva", "");
  const form = e.target;
  const datos = Object.fromEntries(new FormData(form).entries());
  try {
    const { appointment, timezone, cancel_hours } = await api(`/api/public/businesses/${encodeURIComponent(slug)}/bookings`, "POST", {
      service_id: reserva.servicio.id,
      starts: reserva.hueco,
      first_name: datos.first_name,
      last_name: datos.last_name,
      phone: datos.phone,
      email: datos.email,
      notes: datos.notes,
      privacy: $("rPrivacidad").checked,
      employee_id: $("profesionalReserva").value || null,
    });
    mostrarConfirmacion(appointment, timezone, cancel_hours);
  } catch (err) {
    mostrarError("errorReserva", err.message);
    if (/ya no está disponible/.test(err.message)) cargarHuecos();
  } finally {
    boton.disabled = false;
  }
});

function mostrarConfirmacion(cita, tz, horas) {
  for (const id of ["reservaPaso1", "reservaPaso2", "reservaPaso3"]) $(id).hidden = true;
  $("textoConfirmacion").textContent =
    `Hemos recibido tu solicitud para ${cita.service_name} el ${fechaEn(cita.starts_at, tz)} a las ${horaEn(cita.starts_at, tz)}. ` +
    "El negocio la revisará y confirmará contigo. Mientras tanto, la hora queda reservada.";
  $("codigoReserva").textContent = cita.code;
  $("condicionesCancelacion").textContent =
    `Para cancelar o cambiar la cita, contacta con el negocio con al menos ${horas} horas de antelación.`;
  $("reservaConfirmada").hidden = false;
  $("reservaConfirmada").scrollIntoView({ behavior: "smooth", block: "start" });
}

iniciar();
