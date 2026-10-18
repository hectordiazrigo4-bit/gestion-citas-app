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
  $("seccionAgenda").hidden = nombre !== "agenda";
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
  return agenda.vista === "semana"
    ? { desde: agenda.fecha, hasta: sumarDias(agenda.fecha, 6) }
    : { desde: agenda.fecha, hasta: agenda.fecha };
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
  pintarCitas(citas.appointments);
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
    } else {
      $("citaFecha").value = agenda.fecha;
      $("citaNotas").value = "";
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
        status: c.status,
      });
    } else {
      await api(ruta, "POST", {
        client_id: $("citaCliente").value,
        service_id: $("citaServicio").value,
        starts: $("citaHueco").value,
        notes: $("citaNotas").value,
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
  agenda.fecha = sumarDias(agenda.fecha, sentido * (agenda.vista === "semana" ? 7 : 1));
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
