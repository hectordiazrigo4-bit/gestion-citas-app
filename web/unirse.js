const $ = (id) => document.getElementById(id);
const token = new URLSearchParams(location.search).get("t") || "";
const ROL = { admin: "administrador/a", employee: "empleado/a" };

function mostrarError(id, texto) {
  $(id).textContent = texto;
  $(id).hidden = !texto;
}

async function iniciar() {
  if (!token) {
    $("cargandoInvitacion").hidden = true;
    mostrarError("errorInvitacion", "El enlace de invitación no es válido.");
    return;
  }
  try {
    const res = await fetch(`/api/public/invitations/${encodeURIComponent(token)}`);
    const datos = await res.json();
    if (!res.ok) throw new Error(datos.error);
    $("cargandoInvitacion").hidden = true;
    $("textoUnirse").textContent = `Te invitan a unirte a ${datos.negocio} como ${ROL[datos.role]}.`;
    if (datos.email) {
      $("uEmail").value = datos.email;
      $("uEmail").readOnly = true;
    }
    $("formUnirse").hidden = false;
  } catch (err) {
    $("cargandoInvitacion").hidden = true;
    mostrarError("errorInvitacion", err.message);
  }
}

$("formUnirse").addEventListener("submit", async (e) => {
  e.preventDefault();
  const boton = e.submitter;
  boton.disabled = true;
  mostrarError("errorUnirse", "");
  const datos = Object.fromEntries(new FormData(e.target).entries());
  try {
    const res = await fetch(`/api/public/invitations/${encodeURIComponent(token)}/accept`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos),
    });
    const respuesta = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(respuesta.error || "No se ha podido completar la invitación.");
    $("formUnirse").hidden = true;
    $("unidoOk").hidden = false;
  } catch (err) {
    mostrarError("errorUnirse", err.message);
  } finally {
    boton.disabled = false;
  }
});

iniciar();
