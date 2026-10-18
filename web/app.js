const $ = (id) => document.getElementById(id);

// Llamada a la API. Siempre envía JSON (lo exige el servidor) y devuelve error con mensaje legible.
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

function mostrarVista(nombre) {
  $("cargando").hidden = true;
  $("vistaAcceso").hidden = nombre !== "acceso";
  $("vistaPanel").hidden = nombre !== "panel";
}

const ROLES = { owner: "Propietario", admin: "Administrador", employee: "Empleado" };

async function cargarPanel() {
  const { user, businesses } = await api("/api/me");
  if (businesses.length === 0) {
    // Caso raro: cuenta sin negocio. Se muestra la situación en lugar de un panel vacío.
    $("datosUsuario").textContent = `${user.name} (${user.email})`;
    $("nombreNegocio").textContent = "Sin negocio asignado";
    $("rolUsuario").textContent = "-";
    mostrarVista("panel");
    return;
  }

  // De momento se usa el primer negocio. Más adelante habrá selector si el usuario tiene varios.
  const negocio = businesses[0];
  const { business } = await api(`/api/businesses/${negocio.id}`);

  $("nombreNegocio").textContent = business.name;
  $("rolUsuario").textContent = ROLES[business.role] || business.role;
  $("datosUsuario").textContent = `${user.name} · ${user.email}`;
  $("nuevoNombre").value = business.name;
  $("formNegocio").dataset.businessId = business.id;
  $("formNegocio").dataset.role = business.role;

  const puedeEditar = ["owner", "admin"].includes(business.role);
  $("formNegocio").hidden = !puedeEditar;
  mostrarVista("panel");
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

$("formNegocio").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const boton = e.submitter;
  boton.disabled = true;
  mostrarError($("errorNegocio"), "");
  $("okNegocio").hidden = true;
  try {
    const { business } = await api(`/api/businesses/${form.dataset.businessId}`, "PATCH", formularioADatos(form));
    $("nombreNegocio").textContent = business.name;
    $("okNegocio").hidden = false;
  } catch (err) {
    mostrarError($("errorNegocio"), err.message);
  } finally {
    boton.disabled = false;
  }
});

$("btnSalir").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", "POST", {});
  } finally {
    mostrarVista("acceso");
  }
});

(async function iniciar() {
  try {
    await cargarPanel();
  } catch (err) {
    // 401 significa que no hay sesión: se muestra el acceso.
    mostrarVista("acceso");
  }
})();
