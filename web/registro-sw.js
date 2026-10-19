// Registra el servicio de caché para que la app se pueda instalar y funcionar sin conexión.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
