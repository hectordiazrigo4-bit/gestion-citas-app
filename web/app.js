const $ = (id) => document.getElementById(id);

const ROLES = { owner: "Propietario", admin: "Administrador", employee: "Empleado" };
const ROLES_QUE_GESTIONAN = ["owner", "admin"];

// Estado de la sesión y del negocio actual
const estado = { negocioId: null, rol: null, servicios: [], servicioId: null, clienteId: null };

// Llamada a la API. Siempre envía JSON (lo exige el servidor) y devuelve errores legibles.
async function api(path, method = "GET", body) {
  const options = { method, credentials: "same-origin", headers: {} };
  if (method !== "GET") {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body || {});
  }
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || "Ha ocurrido un error. Inténtalo de nuevo.");
    error.status = res.status;
    throw error;
  }
  return data;
}

function mostrarError(elemento, mensaje) {
  elemento.textContent = mensaje;
  elemento.hidden = !mensaje;
}

function formularioADatos(form) {
  return Object.fromEntries(new FormData(form).entries());
}

// Crea un elemento con texto seguro (nunca innerHTML con datos del usuario).
function crear(tag, clase, texto) {
  const el = document.createElement(tag);
  if (clase) el.className = clase;
  if (texto !== undefined && texto !== null) el.textContent = texto;
  return el;
}

function euros(centimos) {
  return `${(centimos / 100).toFixed(2).replace(".", ",")} €`;
}

function mostrarVista(nombre) {
  $("cargando").hidden = true;
  $("vistaAcceso").hidden = nombre !== "acceso";
  $("vistaPanel").hidden = nombre !== "panel";
}

function mostrarSeccion(nombre) {
  for (const boton of document.querySelectorAll("#menuPanel button")) {
    const activa = boton.dataset.seccion === nombre;
    boton.classList.toggle("activa", activa);
    boton.setAttribute("aria-current", activa ? "page" : "false");
  }
  $("seccionInicio").hidden = nombre !== "inicio";
  $("seccionServicios").hidden = nombre !== "servicios";
  $("seccionClientes").hidden = nombre !== "clientes";
  $("seccionAvisos").hidden = nombre !== "avisos";
  $("seccionEquipo").hidden = nombre !== "equipo";
  if (nombre === "equipo") cargarSeccionEquipo().catch((err) => alert(err.message));
  if (nombre === "avisos") cargarSeccionAvisos();
  $("seccionAgenda").hidden = nombre !== "agenda";
  $("seccionResumen").hidden = nombre !== "resumen";
  if (nombre === "resumen") cargarResumen().catch((err) => alert(err.message));
  if (nombre === "servicios") cargarServicios();
  if (nombre === "clientes") cargarClientes();
  if (nombre === "agenda") cargarAgenda().catch((err) => alert(err.message));
}

// ---------- Acceso ----------

async function cargarPanel() {
  const { user, businesses } = await api("/api/me");
  $("datosUsuario").textContent = `${user.name} · ${user.email}`;

  if (businesses.length === 0) {
    $("nombreNegocio").textContent = "Sin negocio asignado";
    $("rolUsuario").textContent = "-";
    mostrarVista("panel");
    return;
  }

  // Cada cuenta tiene un único negocio (regla de la base de datos).
  const { business } = await api(`/api/businesses/${businesses[0].id}`);
  estado.negocioId = business.id;
  estado.rol = business.role;
  $("nombreNegocio").textContent = business.name;
  $("rolUsuario").textContent = ROLES[business.role] || business.role;
  $("nuevoNombre").value = business.name;
  $("nuevaCancelacion").value = business.cancel_hours;
  $("nuevaResenas").value = business.review_url || "";
  mostrarEnlaceReserva(business.slug);
  $("formNegocio").hidden = !ROLES_QUE_GESTIONAN.includes(business.role);

  const puedeGestionar = ROLES_QUE_GESTIONAN.includes(business.role);
  $("nuevoServicio").hidden = !puedeGestionar;
  // Horario y bloqueos son de propietario y administrador; el resto de la agenda lo ven todos.
  $("tarjetaHorario").hidden = !puedeGestionar;
  $("formBloqueo").hidden = !puedeGestionar;
  mostrarVista("panel");
  mostrarSeccion("inicio");
}

function mostrarPestana(cual) {
  const registro = cual === "registro";
  $("pestanaEntrar").classList.toggle("activa", !registro);
  $("pestanaRegistro").classList.toggle("activa", registro);
  $("pestanaEntrar").setAttribute("aria-selected", String(!registro));
  $("pestanaRegistro").setAttribute("aria-selected", String(registro));
  $("formEntrar").hidden = registro;
  $("formRegistro").hidden = !registro;
  mostrarError($("errorAcceso"), "");
}

$("pestanaEntrar").addEventListener("click", () => mostrarPestana("entrar"));
$("pestanaRegistro").addEventListener("click", () => mostrarPestana("registro"));

$("formEntrar").addEventListener("submit", async (e) => {
  e.preventDefault();
  const boton = e.submitter;
  boton.disabled = true;
  mostrarError($("errorAcceso"), "");
  try {
    await api("/api/auth/login", "POST", formularioADatos(e.target));
    await cargarPanel();
  } catch (err) {
    mostrarError($("errorAcceso"), err.message);
  } finally {
    boton.disabled = false;
  }
});

$("formRegistro").addEventListener("submit", async (e) => {
  e.preventDefault();
  const boton = e.submitter;
  boton.disabled = true;
  mostrarError($("errorAcceso"), "");
  try {
    await api("/api/auth/register", "POST", formularioADatos(e.target));
    await cargarPanel();
  } catch (err) {
    mostrarError($("errorAcceso"), err.message);
  } finally {
    boton.disabled = false;
  }
});

$("btnSalir").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", "POST", {});
  } finally {
    estado.negocioId = null;
    estado.rol = null;
    mostrarVista("acceso");
  }
});

document.querySelectorAll("#menuPanel button").forEach((boton) => {
  boton.addEventListener("click", () => mostrarSeccion(boton.dataset.seccion));
});

// ---------- Inicio: enlace de reserva ----------

function mostrarEnlaceReserva(slug) {
  const enlace = `${location.origin}/reservar.html?n=${encodeURIComponent(slug)}`;
  $("enlaceReserva").value = enlace;
  $("compartirWhatsApp").href = `https://wa.me/?text=${encodeURIComponent("Puedes reservar tu cita aquí: " + enlace)}`;
}

$("copiarEnlace").addEventListener("click", async () => {
  const campo = $("enlaceReserva");
  try {
    await navigator.clipboard.writeText(campo.value);
  } catch {
    campo.select();
    document.execCommand("copy");
  }
  $("okCopiar").hidden = false;
});

// ---------- Inicio: nombre del negocio ----------

$("formNegocio").addEventListener("submit", async (e) => {
  e.preventDefault();
  const boton = e.submitter;
  boton.disabled = true;
  mostrarError($("errorNegocio"), "");
  $("okNegocio").hidden = true;
  try {
    const { business } = await api(`/api/businesses/${estado.negocioId}`, "PATCH", formularioADatos(e.target));
    $("nombreNegocio").textContent = business.name;
    $("okNegocio").hidden = false;
  } catch (err) {
    mostrarError($("errorNegocio"), err.message);
  } finally {
    boton.disabled = false;
  }
});

// ---------- Servicios ----------

const formServicio = $("formServicio");

async function cargarServicios() {
  const { services } = await api(`/api/businesses/${estado.negocioId}/services`);
  estado.servicios = services;
  const lista = $("listaServicios");
  lista.replaceChildren();
  $("vacioServicios").hidden = services.length > 0;

  for (const s of services) {
    const li = crear("li", "elemento");
    const textos = crear("div", "elemento-texto");
    textos.append(crear("strong", "", s.name));
    const detalle = `${euros(s.price_cents)} · ${s.duration_min} min${s.prep_min ? ` + ${s.prep_min} min de preparación` : ""}`;
    textos.append(crear("span", "detalle", detalle));
    li.append(textos);
    if (!s.active) li.append(crear("span", "insignia", "Inactivo"));
    if (ROLES_QUE_GESTIONAN.includes(estado.rol)) {
      li.classList.add("pulsable");
      li.tabIndex = 0;
      li.addEventListener("click", () => abrirServicio(s.id));
      li.addEventListener("keydown", (e) => { if (e.key === "Enter") abrirServicio(s.id); });
    }
    lista.append(li);
  }
}

function abrirServicio(id) {
  const s = estado.servicios.find((x) => x.id === id);
  if (!s) return;
  estado.servicioId = id;
  $("tituloFormServicio").textContent = "Editar servicio";
  $("svNombre").value = s.name;
  $("svDescripcion").value = s.description || "";
  $("svPrecio").value = (s.price_cents / 100).toFixed(2);
  $("svDuracion").value = s.duration_min;
  $("svPrep").value = s.prep_min;
  $("svActivo").checked = s.active;
  $("eliminarServicio").hidden = false;
  mostrarError($("errorServicio"), "");
  formServicio.hidden = false;
  formServicio.scrollIntoView({ behavior: "smooth", block: "start" });
}

function nuevoServicio() {
  estado.servicioId = null;
  formServicio.reset();
  $("svPrep").value = 0;
  $("svActivo").checked = true;
  $("tituloFormServicio").textContent = "Nuevo servicio";
  $("eliminarServicio").hidden = true;
  mostrarError($("errorServicio"), "");
  formServicio.hidden = false;
  $("svNombre").focus();
}

function cerrarFormServicio() {
  formServicio.hidden = true;
  estado.servicioId = null;
}

$("nuevoServicio").addEventListener("click", nuevoServicio);
$("cancelarServicio").addEventListener("click", cerrarFormServicio);

formServicio.addEventListener("submit", async (e) => {
  e.preventDefault();
  const boton = e.submitter;
  boton.disabled = true;
  mostrarError($("errorServicio"), "");
  const datos = formularioADatos(formServicio);
  datos.active = $("svActivo").checked;
  const ruta = `/api/businesses/${estado.negocioId}/services`;
  try {
    if (estado.servicioId) {
      await api(`${ruta}/${estado.servicioId}`, "PATCH", datos);
    } else {
      await api(ruta, "POST", datos);
    }
    cerrarFormServicio();
    await cargarServicios();
  } catch (err) {
    mostrarError($("errorServicio"), err.message);
  } finally {
    boton.disabled = false;
  }
});

$("eliminarServicio").addEventListener("click", async () => {
  const nombre = $("svNombre").value;
  if (!confirm(`¿Eliminar el servicio «${nombre}»? Esta acción no se puede deshacer.`)) return;
  try {
    await api(`/api/businesses/${estado.negocioId}/services/${estado.servicioId}`, "DELETE");
    cerrarFormServicio();
    await cargarServicios();
  } catch (err) {
    mostrarError($("errorServicio"), err.message);
  }
});

// ---------- Clientes ----------

const formCliente = $("formCliente");
let temporizadorBusqueda = null;

async function cargarClientes() {
  const q = $("buscarCliente").value.trim();
  const url = `/api/businesses/${estado.negocioId}/clients${q ? `?q=${encodeURIComponent(q)}` : ""}`;
  const { clients } = await api(url);
  const lista = $("listaClientes");
  lista.replaceChildren();
  $("vacioClientes").hidden = clients.length > 0;

  for (const c of clients) {
    const li = crear("li", "elemento pulsable");
    li.tabIndex = 0;
    const textos = crear("div", "elemento-texto");
    textos.append(crear("strong", "", `${c.first_name} ${c.last_name}`));
    const contacto = [c.phone, c.email].filter(Boolean).join(" · ");
    if (contacto) textos.append(crear("span", "detalle", contacto));
    if (c.tags.length) textos.append(crear("span", "detalle", c.tags.join(", ")));
    li.append(textos);
    if (c.marketing_consent) li.append(crear("span", "insignia", "Acepta comunicaciones"));
    li.addEventListener("click", () => abrirCliente(c.id));
    li.addEventListener("keydown", (e) => { if (e.key === "Enter") abrirCliente(c.id); });
    lista.append(li);
  }
}

async function abrirCliente(id) {
  try {
    const { client } = await api(`/api/businesses/${estado.negocioId}/clients/${id}`);
    estado.clienteId = id;
    $("tituloFormCliente").textContent = "Editar cliente";
    $("clNombre").value = client.first_name;
    $("clApellidos").value = client.last_name;
    $("clTelefono").value = client.phone || "";
    $("clEmail").value = client.email || "";
    $("clEtiquetas").value = client.tags.join(", ");
    $("clNotas").value = client.notes || "";
    $("clConsent").checked = client.marketing_consent;
    $("eliminarCliente").hidden = false;
    mostrarError($("errorCliente"), "");
    formCliente.hidden = false;
    formCliente.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    alert(err.message);
  }
}

function nuevoCliente() {
  estado.clienteId = null;
  formCliente.reset();
  $("tituloFormCliente").textContent = "Nuevo cliente";
  $("eliminarCliente").hidden = true;
  mostrarError($("errorCliente"), "");
  formCliente.hidden = false;
  $("clNombre").focus();
}

function cerrarFormCliente() {
  formCliente.hidden = true;
  estado.clienteId = null;
}

$("nuevoCliente").addEventListener("click", nuevoCliente);
$("cancelarCliente").addEventListener("click", cerrarFormCliente);

$("buscarCliente").addEventListener("input", () => {
  clearTimeout(temporizadorBusqueda);
  temporizadorBusqueda = setTimeout(() => cargarClientes().catch((err) => alert(err.message)), 300);
});

formCliente.addEventListener("submit", async (e) => {
  e.preventDefault();
  const boton = e.submitter;
  boton.disabled = true;
  mostrarError($("errorCliente"), "");
  const datos = formularioADatos(formCliente);
  datos.tags = datos.tags ? datos.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
  datos.marketing_consent = $("clConsent").checked;
  const ruta = `/api/businesses/${estado.negocioId}/clients`;
  try {
    if (estado.clienteId) {
      await api(`${ruta}/${estado.clienteId}`, "PATCH", datos);
    } else {
      await api(ruta, "POST", datos);
    }
    cerrarFormCliente();
    await cargarClientes();
  } catch (err) {
    mostrarError($("errorCliente"), err.message);
  } finally {
    boton.disabled = false;
  }
});

$("eliminarCliente").addEventListener("click", async () => {
  const nombre = `${$("clNombre").value} ${$("clApellidos").value}`.trim();
  if (!confirm(`¿Eliminar a ${nombre}? Se borrarán sus datos y no se podrá recuperar.`)) return;
  try {
    await api(`/api/businesses/${estado.negocioId}/clients/${estado.clienteId}`, "DELETE");
    cerrarFormCliente();
    await cargarClientes();
  } catch (err) {
    mostrarError($("errorCliente"), err.message);
  }
});

// ---------- Inicio de la aplicación ----------

(async function iniciar() {
  try {
    await cargarPanel();
  } catch (err) {
    // 401 significa que no hay sesión: se muestra el acceso.
    mostrarVista("acceso");
  }
})();

// ---------- Agenda ----------

const ESTADO_TEXTO = {
  pending: "Pendiente",
  confirmed: "Confirmada",
  completed: "Completada",
  cancelled: "Cancelada",
  no_show: "No presentado",
};
// Espejo de las transiciones del servidor, solo para mostrar los botones adecuados.
const SIGUIENTES_ESTADOS = {
  pending: [["confirmed", "Confirmar"], ["cancelled", "Cancelar cita"]],
  confirmed: [["completed", "Marcar como completada"], ["no_show", "No se ha presentado"], ["cancelled", "Cancelar cita"]],
  cancelled: [["pending", "Reactivar como pendiente"]],
  completed: [],
  no_show: [],
};
const TIPO_BLOQUEO = { descanso: "Descanso", vacaciones: "Vacaciones", bloqueo: "Bloqueo" };
const DIAS_SEMANA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

const agenda = { fecha: hoyLocal(), vista: "dia", tz: "Europe/Madrid", citaActual: null, horarioCargado: false };

function hoyLocal() {
  return new Date().toLocaleDateString("sv-SE");
}

function sumarDias(fecha, dias) {
  const d = new Date(`${fecha}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toLocaleDateString("sv-SE");
}

function horaEn(iso, tz) {
  return new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: tz });
}

function diaEn(iso, tz) {
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: tz });
}

function fechaLarga(fecha) {
  return new Date(`${fecha}T12:00:00`).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
}

function rangoAgenda() {
  if (agenda.vista === "semana") return { desde: agenda.fecha, hasta: sumarDias(agenda.fecha, 6) };
  if (agenda.vista === "mes") {
    const [y, m] = agenda.fecha.split("-").map(Number);
    const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const mm = String(m).padStart(2, "0");
    return { desde: `${y}-${mm}-01`, hasta: `${y}-${mm}-${String(ultimo).padStart(2, "0")}` };
  }
  return { desde: agenda.fecha, hasta: agenda.fecha };
}

function sumarMeses(fecha, meses) {
  const [y, m, d] = fecha.split("-").map(Number);
  const destino = new Date(Date.UTC(y, m - 1 + meses, 1));
  const ultimoDia = new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0)).getUTCDate();
  const dia = Math.min(d, ultimoDia);
  const mm = String(destino.getUTCMonth() + 1).padStart(2, "0");
  return `${destino.getUTCFullYear()}-${mm}-${String(dia).padStart(2, "0")}`;
}

async function cargarAgenda() {
  const { desde, hasta } = rangoAgenda();
  const q = `from=${desde}&to=${hasta}`;
  const [citas, bloques] = await Promise.all([
    api(`/api/businesses/${estado.negocioId}/appointments?${q}`),
    api(`/api/businesses/${estado.negocioId}/blocks?${q}`),
  ]);
  agenda.tz = citas.timezone;
  $("agFecha").value = agenda.fecha;
  const mes = agenda.vista === "mes";
  $("calendarioMes").hidden = !mes;
  $("tituloPeriodo").hidden = !mes;
  $("listaCitas").hidden = mes;
  $("vacioCitas").hidden = true;
  if (mes) {
    pintarMes(citas.appointments, desde);
  } else {
    pintarCitas(citas.appointments);
  }
  pintarBloqueos(bloques.blocks);
  if (ROLES_QUE_GESTIONAN.includes(estado.rol) && !agenda.horarioCargado) await cargarHorario();
}

function pintarCitas(citas) {
  const lista = $("listaCitas");
  lista.replaceChildren();
  $("vacioCitas").hidden = citas.length > 0;
  let diaAnterior = null;

  for (const c of citas) {
    const dia = diaEn(c.starts_at, agenda.tz);
    if (agenda.vista === "semana" && dia !== diaAnterior) {
      lista.append(crear("li", "dia-cabecera", fechaLarga(dia)));
      diaAnterior = dia;
    }
    const li = crear("li", `elemento pulsable${c.status === "cancelled" ? " cancelada" : ""}`);
    li.tabIndex = 0;
    const textos = crear("div", "elemento-texto");
    textos.append(crear("strong", "", `${horaEn(c.starts_at, agenda.tz)} · ${c.client_name || "Cliente"}`));
    textos.append(crear("span", "detalle", `${c.service_name} · ${euros(c.price_cents)}`));
    li.append(textos);
    li.append(crear("span", "insignia", ESTADO_TEXTO[c.status]));
    li.addEventListener("click", () => mostrarDetalleCita(c));
    li.addEventListener("keydown", (e) => { if (e.key === "Enter") mostrarDetalleCita(c); });
    lista.append(li);
  }
}

// Cuadrícula del mes: número de citas por día. Pulsar un día abre su vista de día.
function pintarMes(citas, desde) {
  const [y, m] = desde.split("-").map(Number);
  $("tituloPeriodo").textContent = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("es-ES", { month: "long", year: "numeric", timeZone: "UTC" });

  const porDia = new Map();
  for (const c of citas) {
    if (c.status === "cancelled") continue;
    const dia = diaEn(c.starts_at, agenda.tz);
    porDia.set(dia, (porDia.get(dia) || 0) + 1);
  }

  const contenedor = $("calendarioMes");
  contenedor.replaceChildren();
  for (const nombre of ["L", "M", "X", "J", "V", "S", "D"]) contenedor.append(crear("span", "cabecera-dia", nombre));

  const primerDia = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0 = domingo
  const huecos = (primerDia + 6) % 7;
  for (let i = 0; i < huecos; i++) contenedor.append(crear("span", "celda-vacia"));

  const diasDelMes = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const hoy = hoyLocal();
  for (let d = 1; d <= diasDelMes; d++) {
    const fecha = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const total = porDia.get(fecha) || 0;
    const boton = crear("button", "celda-dia");
    boton.type = "button";
    boton.append(crear("span", "numero-dia", String(d)));
    if (total) boton.append(crear("span", "contador", String(total)));
    boton.setAttribute("aria-label", `${fecha}: ${total} ${total === 1 ? "cita" : "citas"}`);
    if (fecha === hoy) boton.classList.add("hoy");
    if (total) boton.classList.add("con-citas");
    boton.addEventListener("click", () => {
      agenda.fecha = fecha;
      agenda.vista = "dia";
      document.querySelectorAll("[data-vista]").forEach((b) => b.classList.toggle("activa", b.dataset.vista === "dia"));
      cargarAgenda().catch((err) => alert(err.message));
    });
    contenedor.append(boton);
  }
}

function pintarBloqueos(bloques) {
  const lista = $("listaBloqueos");
  lista.replaceChildren();
  $("vacioBloqueos").hidden = bloques.length > 0;
  const puedeBorrar = ROLES_QUE_GESTIONAN.includes(estado.rol);

  for (const b of bloques) {
    const li = crear("li", "elemento");
    const textos = crear("div", "elemento-texto");
    textos.append(crear("strong", "", `${TIPO_BLOQUEO[b.kind]}${b.reason ? ` · ${b.reason}` : ""}`));
    textos.append(crear("span", "detalle", `${new Date(b.starts_at).toLocaleString("es-ES", { timeZone: agenda.tz, dateStyle: "short", timeStyle: "short" })} → ${new Date(b.ends_at).toLocaleString("es-ES", { timeZone: agenda.tz, dateStyle: "short", timeStyle: "short" })}`));
    li.append(textos);
    if (puedeBorrar) {
      const borrar = crear("button", "pequeno peligro-pequeno", "Quitar");
      borrar.type = "button";
      borrar.addEventListener("click", () => quitarBloqueo(b));
      li.append(borrar);
    }
    lista.append(li);
  }
}

async function quitarBloqueo(bloque) {
  if (!confirm("¿Quitar este bloqueo? Los huecos volverán a estar disponibles.")) return;
  try {
    await api(`/api/businesses/${estado.negocioId}/blocks/${bloque.id}`, "DELETE", {});
    await cargarAgenda();
  } catch (err) {
    alert(err.message);
  }
}

// ---------- Detalle y estados ----------

function mostrarDetalleCita(c) {
  agenda.citaActual = c;
  const dia = diaEn(c.starts_at, agenda.tz);
  $("detalleTitulo").textContent = c.client_name || "Cita";
  const cuando = `${fechaLarga(dia)} · ${horaEn(c.starts_at, agenda.tz)}–${horaEn(c.ends_at, agenda.tz)}`;
  const partes = [c.service_name, cuando, euros(c.price_cents), ESTADO_TEXTO[c.status]];
  if (c.phone) partes.push(c.phone);
  if (c.employee_name) partes.splice(1, 0, `Profesional: ${c.employee_name}`);
  $("detalleTexto").textContent = partes.join(" · ") + (c.notes ? `\nNotas: ${c.notes}` : "");
  $("detalleTexto").style.whiteSpace = "pre-line";

  const acciones = $("accionesCita");
  acciones.replaceChildren();
  for (const [nuevo, texto] of SIGUIENTES_ESTADOS[c.status]) {
    const boton = crear("button", "pequeno", texto);
    boton.type = "button";
    boton.addEventListener("click", () => cambiarEstado(c, nuevo));
    acciones.append(boton);
  }
  const terminada = c.status === "completed" || c.status === "no_show";
  $("cambiarHora").hidden = terminada;
  cargarCobros(c.id).catch((err) => mostrarError($("errorCobro"), err.message));
  mostrarError($("errorCita"), "");
  $("detalleCita").hidden = false;
  $("detalleCita").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function cambiarEstado(c, nuevo) {
  if (nuevo === "cancelled" && !confirm("¿Cancelar esta cita? El hueco quedará libre.")) return;
  try {
    await api(`/api/businesses/${estado.negocioId}/appointments/${c.id}`, "PATCH", {
      client_id: c.client_id,
      service_id: c.service_id,
      starts: c.starts_at,
      notes: c.notes,
      status: nuevo,
    });
    $("detalleCita").hidden = true;
    await cargarAgenda();
  } catch (err) {
    mostrarError($("errorCita"), err.message);
    $("detalleCita").hidden = false;
  }
}

// ---------- Crear y reprogramar ----------

async function rellenarSelectores() {
  const [{ clients }, { services }] = await Promise.all([
    api(`/api/businesses/${estado.negocioId}/clients`),
    api(`/api/businesses/${estado.negocioId}/services`),
  ]);
  await rellenarProfesionales();
  $("citaCliente").replaceChildren(...clients.map((c) => new Option(`${c.first_name} ${c.last_name}`, c.id)));
  $("citaServicio").replaceChildren(...services.filter((s) => s.active).map((s) => new Option(`${s.name} · ${euros(s.price_cents)}`, s.id)));
}

async function abrirFormCita(cita) {
  try {
    await rellenarSelectores();
    agenda.editando = cita || null;
    $("tituloFormCita").textContent = cita ? "Cambiar fecha u hora" : "Nueva cita";
    // El estado solo se elige al crear; después se cambia desde el detalle de la cita.
    $("citaEstado").hidden = !!cita;
    $("citaEstado").previousElementSibling.hidden = !!cita;
    $("citaCliente").disabled = !!cita;
    if (cita) {
      $("citaCliente").value = cita.client_id;
      $("citaServicio").value = cita.service_id;
      $("citaFecha").value = diaEn(cita.starts_at, agenda.tz);
      $("citaNotas").value = cita.notes || "";
      $("citaProfesional").value = cita.employee_id || "";
    } else {
      $("citaFecha").value = agenda.fecha;
      $("citaNotas").value = "";
      $("citaProfesional").value = "";
      $("citaEstado").value = "confirmed";
    }
    mostrarError($("errorFormCita"), "");
    $("formCita").hidden = false;
    await cargarHuecos();
    $("formCita").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    alert(err.message);
  }
}

async function cargarHuecos() {
  const select = $("citaHueco");
  const servicio = $("citaServicio").value;
  const fecha = $("citaFecha").value;
  select.replaceChildren();
  if (!servicio || !fecha) return;

  const { slots, timezone } = await api(`/api/businesses/${estado.negocioId}/availability?date=${fecha}&service_id=${servicio}`);
  agenda.tz = timezone;
  // Al reprogramar, la hora actual de la cita puede aparecer como ocupada por ella misma: se añade igualmente.
  const actual = agenda.editando && diaEn(agenda.editando.starts_at, timezone) === fecha ? agenda.editando.starts_at : null;
  const horas = actual && !slots.includes(actual) ? [actual, ...slots] : slots;
  for (const iso of horas) {
    const texto = horaEn(iso, timezone) + (iso === actual ? " (hora actual)" : "");
    select.append(new Option(texto, iso));
  }
  if (actual) select.value = actual;
  if (horas.length === 0) select.append(new Option("Sin huecos libres ese día", "", true, true));
  $("citaHueco").required = horas.length > 0;
}

$("nuevaCita").addEventListener("click", () => abrirFormCita(null));
$("cambiarHora").addEventListener("click", () => abrirFormCita(agenda.citaActual));
$("cancelarCita").addEventListener("click", () => { $("formCita").hidden = true; agenda.editando = null; });
$("citaFecha").addEventListener("change", () => cargarHuecos().catch((err) => mostrarError($("errorFormCita"), err.message)));
$("citaServicio").addEventListener("change", () => cargarHuecos().catch((err) => mostrarError($("errorFormCita"), err.message)));

$("formCita").addEventListener("submit", async (e) => {
  e.preventDefault();
  const boton = e.submitter;
  boton.disabled = true;
  mostrarError($("errorFormCita"), "");
  const ruta = `/api/businesses/${estado.negocioId}/appointments`;
  try {
    if (agenda.editando) {
      const c = agenda.editando;
      await api(`${ruta}/${c.id}`, "PATCH", {
        client_id: c.client_id,
        service_id: $("citaServicio").value,
        starts: $("citaHueco").value,
        notes: $("citaNotas").value,
        employee_id: $("citaProfesional").value || null,
        status: c.status,
      });
    } else {
      await api(ruta, "POST", {
        client_id: $("citaCliente").value,
        service_id: $("citaServicio").value,
        starts: $("citaHueco").value,
        notes: $("citaNotas").value,
        employee_id: $("citaProfesional").value || null,
        status: $("citaEstado").value,
      });
    }
    $("formCita").hidden = true;
    agenda.editando = null;
    $("detalleCita").hidden = true;
    await cargarAgenda();
  } catch (err) {
    mostrarError($("errorFormCita"), err.message);
  } finally {
    boton.disabled = false;
  }
});

// ---------- Navegación de fechas ----------

$("agFecha").addEventListener("change", (e) => {
  agenda.fecha = e.target.value;
  cargarAgenda().catch((err) => alert(err.message));
});
$("diaAnterior").addEventListener("click", () => cambiarFecha(-1));
$("diaSiguiente").addEventListener("click", () => cambiarFecha(1));
$("hoy").addEventListener("click", () => { agenda.fecha = hoyLocal(); cargarAgenda().catch((err) => alert(err.message)); });

function cambiarFecha(sentido) {
  agenda.fecha = agenda.vista === "mes"
    ? sumarMeses(agenda.fecha, sentido)
    : sumarDias(agenda.fecha, sentido * (agenda.vista === "semana" ? 7 : 1));
  cargarAgenda().catch((err) => alert(err.message));
}

document.querySelectorAll("[data-vista]").forEach((boton) => {
  boton.addEventListener("click", () => {
    agenda.vista = boton.dataset.vista;
    document.querySelectorAll("[data-vista]").forEach((b) => b.classList.toggle("activa", b === boton));
    cargarAgenda().catch((err) => alert(err.message));
  });
});

// ---------- Bloqueos ----------

$("formBloqueo").addEventListener("submit", async (e) => {
  e.preventDefault();
  const boton = e.submitter;
  boton.disabled = true;
  mostrarError($("errorBloqueo"), "");
  try {
    await api(`/api/businesses/${estado.negocioId}/blocks`, "POST", {
      kind: $("blTipo").value,
      starts: $("blInicio").value,
      ends: $("blFin").value,
      reason: $("blMotivo").value,
    });
    e.target.reset();
    await cargarAgenda();
  } catch (err) {
    mostrarError($("errorBloqueo"), err.message);
  } finally {
    boton.disabled = false;
  }
});

// ---------- Horario semanal ----------

async function cargarHorario() {
  const { hours } = await api(`/api/businesses/${estado.negocioId}/hours`);
  const configurado = new Map(hours.map((h) => [h.weekday, h]));
  const contenedor = $("filasHorario");
  contenedor.replaceChildren();
  for (const dia of [1, 2, 3, 4, 5, 6, 0]) {
    const actual = configurado.get(dia);
    const fila = crear("div", "fila-horario");
    const casilla = document.createElement("input");
    casilla.type = "checkbox";
    casilla.checked = !!actual;
    casilla.dataset.dia = dia;
    casilla.id = `diaAbierto${dia}`;
    const etiqueta = crear("label", "casilla", DIAS_SEMANA[dia]);
    etiqueta.prepend(casilla);
    etiqueta.htmlFor = casilla.id;
    const apertura = crear("input");
    apertura.type = "time";
    apertura.value = actual ? actual.opens : "09:00";
    apertura.dataset.apertura = dia;
    const cierre = crear("input");
    cierre.type = "time";
    cierre.value = actual ? actual.closes : "18:00";
    cierre.dataset.cierre = dia;
    fila.append(etiqueta, apertura, cierre);
    contenedor.append(fila);
  }
  agenda.horarioCargado = true;
}

$("guardarHorario").addEventListener("click", async () => {
  mostrarError($("errorHorario"), "");
  $("okHorario").hidden = true;
  const dias = [];
  for (const casilla of document.querySelectorAll("#filasHorario input[type=checkbox]")) {
    if (!casilla.checked) continue;
    const dia = casilla.dataset.dia;
    dias.push({
      weekday: Number(dia),
      opens: document.querySelector(`[data-apertura="${dia}"]`).value,
      closes: document.querySelector(`[data-cierre="${dia}"]`).value,
    });
  }
  try {
    await api(`/api/businesses/${estado.negocioId}/hours`, "PUT", { hours: dias });
    $("okHorario").hidden = false;
  } catch (err) {
    mostrarError($("errorHorario"), err.message);
  }
});

// ---------- Resumen ----------

const resumen = { periodo: "day", fecha: hoyLocal(), tz: "Europe/Madrid" };
const ESTADO_RESUMEN = { pending: "Pendiente", confirmed: "Confirmada", completed: "Completada", cancelled: "Cancelada", no_show: "No presentado" };

async function cargarResumen() {
  const datos = await api(`/api/businesses/${estado.negocioId}/dashboard?period=${resumen.periodo}&date=${resumen.fecha}`);
  resumen.tz = datos.timezone;
  pintarResumen(datos);
}

function fechaCorta(fecha) {
  return new Date(`${fecha}T12:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

function pintarResumen(datos) {
  const r = datos.resumen;
  const { desde, hasta, tipo } = datos.periodo;
  $("resumenFecha").value = resumen.fecha;
  $("resumenPeriodo").textContent = tipo === "day" ? fechaLarga(desde) : `${fechaCorta(desde)} – ${fechaCorta(hasta)}`;

  const indicadores = [
    ["Citas", r.citas],
    ["Canceladas", r.canceladas],
    ["No presentados", r.no_presentados],
    ["Clientes nuevos", r.clientes_nuevos],
    ["Clientes recurrentes", r.clientes_recurrentes],
    ["Cobrado", euros(r.ingresos_cobrados_cents)],
    ["Pendiente de cobro", euros(r.pagos_pendientes_cents)],
    ["Ingresos de completadas", euros(r.ingresos_completadas_cents)],
    ["Ocupación", r.ocupacion_pct === null ? "Sin horario" : `${r.ocupacion_pct} %`],
  ];
  const cuadro = $("resumenIndicadores");
  cuadro.replaceChildren();
  for (const [etiqueta, valor] of indicadores) {
    const tarjeta = crear("div", "kpi");
    tarjeta.append(crear("span", "etiqueta", etiqueta), crear("strong", "kpi-valor", String(valor)));
    cuadro.append(tarjeta);
  }

  // Servicios: barra proporcional al más pedido
  const contenedor = $("resumenServicios");
  contenedor.replaceChildren();
  const maximo = Math.max(1, ...r.servicios_top.map((s) => s.veces));
  for (const s of r.servicios_top) {
    const fila = crear("div", "servicio-barra");
    fila.append(crear("span", "", `${s.nombre} (${s.veces})`));
    const barra = crear("div", "barra");
    const relleno = crear("span");
    relleno.style.width = `${Math.round((s.veces / maximo) * 100)}%`;
    barra.append(relleno);
    fila.append(barra);
    contenedor.append(fila);
  }
  $("vacioServiciosResumen").hidden = r.servicios_top.length > 0;

  pintarListaCitas($("resumenHoy"), datos.hoy, false);
  $("vacioHoy").hidden = datos.hoy.length > 0;
  pintarListaCitas($("resumenProximas"), datos.proximas, true);
  $("vacioProximas").hidden = datos.proximas.length > 0;

  const t = datos.tareas;
  const tareas = $("resumenTareas");
  tareas.replaceChildren();
  const pendientes = [
    [t.citas_por_confirmar, "citas pendientes de confirmar", "Ver agenda"],
    [t.citas_sin_cerrar, "citas pasadas sin marcar como completadas o no presentadas", "Ver agenda"],
    [t.clientes_inactivos.total, `clientes sin volver en más de 90 días${t.clientes_inactivos.nombres.length ? ": " + t.clientes_inactivos.nombres.join(", ") : ""}`, null],
  ];
  for (const [cantidad, texto, accion] of pendientes) {
    const li = crear("li", "elemento");
    li.append(crear("span", "", `${cantidad} ${texto}`));
    if (cantidad > 0 && accion) {
      const boton = crear("button", "pequeno", accion);
      boton.type = "button";
      boton.addEventListener("click", () => mostrarSeccion("agenda"));
      li.append(boton);
    }
    tareas.append(li);
  }
}

function pintarListaCitas(lista, citas, conFecha) {
  lista.replaceChildren();
  for (const c of citas) {
    const li = crear("li", `elemento${c.status === "cancelled" ? " cancelada" : ""}`);
    const textos = crear("div", "elemento-texto");
    const hora = horaEn(c.starts_at, resumen.tz);
    const cuando = conFecha ? `${fechaCorta(diaEn(c.starts_at, resumen.tz))} · ${hora}` : hora;
    textos.append(crear("strong", "", `${cuando} · ${c.client_name}`));
    textos.append(crear("span", "detalle", `${c.service_name} · ${euros(c.price_cents)}`));
    li.append(textos, crear("span", "insignia", ESTADO_RESUMEN[c.status]));
    lista.append(li);
  }
}

document.querySelectorAll("[data-periodo]").forEach((boton) => {
  boton.addEventListener("click", () => {
    resumen.periodo = boton.dataset.periodo;
    document.querySelectorAll("[data-periodo]").forEach((b) => b.classList.toggle("activa", b === boton));
    cargarResumen().catch((err) => alert(err.message));
  });
});

function moverResumen(sentido) {
  if (resumen.periodo === "month") resumen.fecha = sumarMeses(resumen.fecha, sentido);
  else if (resumen.periodo === "week") resumen.fecha = sumarDias(resumen.fecha, 7 * sentido);
  else resumen.fecha = sumarDias(resumen.fecha, sentido);
  cargarResumen().catch((err) => alert(err.message));
}

$("resumenAnterior").addEventListener("click", () => moverResumen(-1));
$("resumenSiguiente").addEventListener("click", () => moverResumen(1));
$("resumenFecha").addEventListener("change", (e) => {
  resumen.fecha = e.target.value;
  cargarResumen().catch((err) => alert(err.message));
});

// ---------- Avisos y lista de espera ----------

const TIPO_AVISO = {
  confirmacion: "Confirmación",
  recordatorio: "Recordatorio 24 h",
  cancelacion: "Cancelación",
  cambio_hora: "Cambio de hora",
  aviso_profesional: "Aviso al negocio",
  seguimiento: "Seguimiento",
  hueco_libre: "Hueco libre",
  reactivacion: "Reactivación",
};
const ESTADO_AVISO = { pendiente: "Pendiente de envío", enviado: "Enviado", fallido: "Fallido", caducado: "Caducado" };

async function cargarAvisos() {
  const { configuracion, avisos } = await api(`/api/businesses/${estado.negocioId}/notifications`);
  const estadoBox = $("estadoAvisos");
  estadoBox.replaceChildren();
  const correo = configuracion.correo ? "Correo: configurado" : "Correo: sin configurar";
  const wa = configuracion.whatsapp ? "WhatsApp: configurado" : "WhatsApp: sin configurar";
  estadoBox.append(crear("p", "etiqueta", `${correo} · ${wa}`));
  if (!configuracion.correo && !configuracion.whatsapp) {
    estadoBox.append(crear("p", "alerta", "Los avisos quedan en cola como pendientes hasta que se configure un proveedor. Nada se marca como enviado sin envío real."));
  }

  const lista = $("listaAvisos");
  lista.replaceChildren();
  $("vacioAvisos").hidden = avisos.length > 0;
  for (const a of avisos) {
    const li = crear("li", "elemento");
    const textos = crear("div", "elemento-texto");
    textos.append(crear("strong", "", `${TIPO_AVISO[a.kind] || a.kind} · ${a.destino}`));
    const detalle = [ESTADO_AVISO[a.status], a.channel === "whatsapp" ? "WhatsApp" : "Correo"];
    if (a.attempts) detalle.push(`${a.attempts} intento(s)`);
    if (a.last_error) detalle.push(a.last_error);
    textos.append(crear("span", "detalle", detalle.join(" · ")));
    li.append(textos);
    if (a.status === "fallido") {
      const reintentar = crear("button", "pequeno", "Reintentar");
      reintentar.type = "button";
      reintentar.addEventListener("click", async () => {
        try {
          await api(`/api/businesses/${estado.negocioId}/notifications/${a.id}/retry`, "POST", {});
          await cargarAvisos();
        } catch (err) {
          alert(err.message);
        }
      });
      li.append(reintentar);
    } else {
      li.append(crear("span", "insignia", ESTADO_AVISO[a.status]));
    }
    lista.append(li);
  }
}

async function cargarEspera() {
  const { espera } = await api(`/api/businesses/${estado.negocioId}/waitlist`);
  const lista = $("listaEspera");
  lista.replaceChildren();
  $("vacioEspera").hidden = espera.length > 0;
  for (const e of espera) {
    const li = crear("li", "elemento");
    const textos = crear("div", "elemento-texto");
    textos.append(crear("strong", "", e.client_name));
    textos.append(crear("span", "detalle", `${e.service_name} · ${e.fecha}`));
    li.append(textos);
    const quitar = crear("button", "pequeno peligro-pequeno", "Quitar");
    quitar.type = "button";
    quitar.addEventListener("click", async () => {
      try {
        await api(`/api/businesses/${estado.negocioId}/waitlist/${e.id}`, "DELETE", {});
        await cargarEspera();
      } catch (err) {
        alert(err.message);
      }
    });
    li.append(quitar);
    lista.append(li);
  }
}

async function rellenarEspera() {
  const [{ clients }, { services }] = await Promise.all([
    api(`/api/businesses/${estado.negocioId}/clients`),
    api(`/api/businesses/${estado.negocioId}/services`),
  ]);
  $("esperaCliente").replaceChildren(...clients.map((c) => new Option(`${c.first_name} ${c.last_name}`, c.id)));
  $("esperaServicio").replaceChildren(...services.filter((s) => s.active).map((s) => new Option(s.name, s.id)));
  $("esperaFecha").value = hoyLocal();
}

$("formEspera").addEventListener("submit", async (e) => {
  e.preventDefault();
  const boton = e.submitter;
  boton.disabled = true;
  mostrarError($("errorEspera"), "");
  try {
    await api(`/api/businesses/${estado.negocioId}/waitlist`, "POST", {
      client_id: $("esperaCliente").value,
      service_id: $("esperaServicio").value,
      date: $("esperaFecha").value,
    });
    await cargarEspera();
  } catch (err) {
    mostrarError($("errorEspera"), err.message);
  } finally {
    boton.disabled = false;
  }
});

async function cargarSeccionAvisos() {
  try {
    await cargarAvisos();
  } catch (err) {
    // Solo propietario y administrador ven el historial de avisos.
    $("listaAvisos").replaceChildren();
    $("estadoAvisos").replaceChildren(crear("p", "nota", err.message));
    $("vacioAvisos").hidden = true;
  }
  await rellenarEspera();
  await cargarEspera();
}

// ---------- Equipo ----------

const ROL_TEXTO = { owner: "Propietario/a", admin: "Administrador/a", employee: "Empleado/a" };
const DIAS_TEXTO = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const equipo = { miembros: [], servicios: [], seleccionado: null };

async function cargarSeccionEquipo() {
  const { miembros } = await api(`/api/businesses/${estado.negocioId}/team`);
  equipo.miembros = miembros;
  const { services } = await api(`/api/businesses/${estado.negocioId}/services`);
  equipo.servicios = services;
  const lista = $("listaEquipo");
  lista.replaceChildren();
  const gestiona = ROLES_QUE_GESTIONAN.includes(estado.rol);
  for (const m of miembros) {
    const li = crear("li", `elemento${gestiona && m.role !== "owner" ? " pulsable" : ""}`);
    const textos = crear("div", "elemento-texto");
    textos.append(crear("strong", "", m.name));
    textos.append(crear("span", "detalle", `${m.email} · ${ROL_TEXTO[m.role]}`));
    li.append(textos);
    if (gestiona && m.role !== "owner") {
      li.tabIndex = 0;
      li.addEventListener("click", () => abrirMiembro(m));
      li.addEventListener("keydown", (e) => { if (e.key === "Enter") abrirMiembro(m); });
    }
    lista.append(li);
  }
  $("tarjetaInvitar").hidden = !gestiona;
  if (gestiona) await cargarInvitaciones();
}

async function cargarInvitaciones() {
  const { invitaciones } = await api(`/api/businesses/${estado.negocioId}/invitations`);
  const lista = $("listaInvitaciones");
  lista.replaceChildren();
  $("vacioInvitaciones").hidden = invitaciones.length > 0;
  for (const i of invitaciones) {
    const li = crear("li", "elemento");
    const textos = crear("div", "elemento-texto");
    textos.append(crear("strong", "", `${ROL_TEXTO[i.role]}${i.email ? ` · ${i.email}` : ""}`));
    textos.append(crear("span", "detalle", `Caduca el ${new Date(i.expires_at).toLocaleDateString("es-ES")}`));
    li.append(textos);
    const quitar = crear("button", "pequeno peligro-pequeno", "Anular");
    quitar.type = "button";
    quitar.addEventListener("click", async () => {
      try {
        await api(`/api/businesses/${estado.negocioId}/invitations/${i.id}`, "DELETE", {});
        await cargarInvitaciones();
      } catch (err) {
        alert(err.message);
      }
    });
    li.append(quitar);
    lista.append(li);
  }
}

$("crearInvitacion").addEventListener("click", async () => {
  mostrarError($("errorInvitar"), "");
  try {
    const { enlace } = await api(`/api/businesses/${estado.negocioId}/invitations`, "POST", {
      role: $("invRol").value,
      email: $("invCorreo").value,
    });
    $("enlaceNuevo").value = enlace;
    $("enlaceInvitacion").hidden = false;
    $("invCorreo").value = "";
    await cargarInvitaciones();
  } catch (err) {
    mostrarError($("errorInvitar"), err.message);
  }
});

$("copiarInvitacion").addEventListener("click", async () => {
  const campo = $("enlaceNuevo");
  try {
    await navigator.clipboard.writeText(campo.value);
  } catch {
    campo.select();
    document.execCommand("copy");
  }
  alert("Enlace copiado. Envíaselo a la persona invitada.");
});

function abrirMiembro(m) {
  equipo.seleccionado = m;
  $("tituloMiembro").textContent = m.name;
  $("miRol").value = m.role;
  const contenedor = $("miServicios");
  contenedor.replaceChildren();
  for (const s of equipo.servicios) {
    const etiqueta = crear("label", "casilla", s.name);
    const casilla = document.createElement("input");
    casilla.type = "checkbox";
    casilla.value = s.id;
    casilla.checked = m.services.includes(s.id);
    etiqueta.prepend(casilla);
    contenedor.append(etiqueta);
  }
  pintarHorarioEditable($("miHorario"), m.hours);
  $("quitarMiembro").hidden = false;
  mostrarError($("errorMiembro"), "");
  $("okMiembro").hidden = true;
  $("tarjetaMiembro").hidden = false;
  $("tarjetaMiembro").scrollIntoView({ behavior: "smooth", block: "start" });
}

// Horario editable: una fila por día con casilla de abierto y horas.
function pintarHorarioEditable(contenedor, horas) {
  const configurado = new Map(horas.map((h) => [h.weekday, h]));
  contenedor.replaceChildren();
  for (const dia of [1, 2, 3, 4, 5, 6, 0]) {
    const actual = configurado.get(dia);
    const fila = crear("div", "fila-horario");
    const casilla = document.createElement("input");
    casilla.type = "checkbox";
    casilla.checked = !!actual;
    casilla.dataset.dia = dia;
    const etiqueta = crear("label", "casilla", DIAS_TEXTO[dia]);
    etiqueta.prepend(casilla);
    const apertura = crear("input");
    apertura.type = "time";
    apertura.value = actual ? actual.opens : "09:00";
    apertura.dataset.apertura = dia;
    const cierre = crear("input");
    cierre.type = "time";
    cierre.value = actual ? actual.closes : "18:00";
    cierre.dataset.cierre = dia;
    fila.append(etiqueta, apertura, cierre);
    contenedor.append(fila);
  }
}

function leerHorarioEditable(contenedor) {
  const dias = [];
  for (const casilla of contenedor.querySelectorAll("input[type=checkbox]")) {
    if (!casilla.checked) continue;
    const dia = casilla.dataset.dia;
    dias.push({
      weekday: Number(dia),
      opens: contenedor.querySelector(`[data-apertura="${dia}"]`).value,
      closes: contenedor.querySelector(`[data-cierre="${dia}"]`).value,
    });
  }
  return dias;
}

$("guardarMiembro").addEventListener("click", async () => {
  const m = equipo.seleccionado;
  mostrarError($("errorMiembro"), "");
  $("okMiembro").hidden = true;
  try {
    const base = `/api/businesses/${estado.negocioId}/members/${m.user_id}`;
    if (m.role !== "owner" && $("miRol").value !== m.role) {
      await api(base, "PATCH", { role: $("miRol").value });
    }
    const servicios = [...$("miServicios").querySelectorAll("input:checked")].map((c) => c.value);
    await api(`${base}/services`, "PUT", { service_ids: servicios });
    await api(`${base}/hours`, "PUT", { hours: leerHorarioEditable($("miHorario")) });
    $("okMiembro").hidden = false;
    await cargarSeccionEquipo();
  } catch (err) {
    mostrarError($("errorMiembro"), err.message);
  }
});

$("quitarMiembro").addEventListener("click", async () => {
  const m = equipo.seleccionado;
  if (!confirm(`¿Quitar a ${m.name} del negocio? Dejará de tener acceso al panel.`)) return;
  try {
    await api(`/api/businesses/${estado.negocioId}/members/${m.user_id}`, "DELETE", {});
    $("tarjetaMiembro").hidden = true;
    await cargarSeccionEquipo();
  } catch (err) {
    mostrarError($("errorMiembro"), err.message);
  }
});

// ---------- Cobros de una cita ----------

async function cargarCobros(citaId) {
  const datos = await api(`/api/businesses/${estado.negocioId}/appointments/${citaId}/payments`);
  $("resumenCobros").textContent = `Precio ${euros(datos.precio_cents)} · Cobrado ${euros(datos.cobrado_cents)} · Pendiente ${euros(datos.pendiente_cents)}`;
  const lista = $("listaCobros");
  lista.replaceChildren();
  const etiquetaMetodo = { efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transferencia", otro: "Otro" };
  for (const c of datos.cobros) {
    const li = crear("li", "elemento");
    const textos = crear("div", "elemento-texto");
    const signo = c.kind === "pago" ? "" : "−";
    textos.append(crear("strong", "", `${signo}${euros(c.amount_cents)} · ${c.kind === "pago" ? "Cobro" : "Devolución"}`));
    textos.append(crear("span", "detalle", `${etiquetaMetodo[c.method]}${c.note ? ` · ${c.note}` : ""} · ${new Date(c.paid_at).toLocaleDateString("es-ES")}`));
    li.append(textos);
    lista.append(li);
  }
  $("cobroTipo").querySelector("option[value=devolucion]").disabled = !ROLES_QUE_GESTIONAN.includes(estado.rol);
  return datos;
}

$("formCobro").addEventListener("submit", async (e) => {
  e.preventDefault();
  const boton = e.submitter;
  boton.disabled = true;
  mostrarError($("errorCobro"), "");
  try {
    await api(`/api/businesses/${estado.negocioId}/appointments/${agenda.citaActual.id}/payments`, "POST", {
      amount: $("cobroImporte").value,
      method: $("cobroMetodo").value,
      kind: $("cobroTipo").value,
      note: $("cobroNota").value,
    });
    e.target.reset();
    await cargarCobros(agenda.citaActual.id);
    await cargarAgenda();
  } catch (err) {
    mostrarError($("errorCobro"), err.message);
  } finally {
    boton.disabled = false;
  }
});

// ---------- Profesional en la cita ----------

async function rellenarProfesionales() {
  const { miembros } = await api(`/api/businesses/${estado.negocioId}/team`);
  const select = $("citaProfesional");
  select.replaceChildren(new Option("Sin asignar", ""), ...miembros.map((m) => new Option(m.name, m.user_id)));
}
