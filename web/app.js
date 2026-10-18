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
  for (const boton of document.querySelectorAll(".menu-panel button")) {
    const activa = boton.dataset.seccion === nombre;
    boton.classList.toggle("activa", activa);
    boton.setAttribute("aria-current", activa ? "page" : "false");
  }
  $("seccionInicio").hidden = nombre !== "inicio";
  $("seccionServicios").hidden = nombre !== "servicios";
  $("seccionClientes").hidden = nombre !== "clientes";
  if (nombre === "servicios") cargarServicios();
  if (nombre === "clientes") cargarClientes();
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

document.querySelectorAll(".menu-panel button").forEach((boton) => {
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
