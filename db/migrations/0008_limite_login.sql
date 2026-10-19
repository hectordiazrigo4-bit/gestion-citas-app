-- Fase A: límite de intentos de inicio de sesión. Tabla propia para no mezclar
-- ventanas de distinta duración con el límite de reservas públicas.
CREATE TABLE login_intentos (
  clave   TEXT PRIMARY KEY,
  ventana INTEGER NOT NULL,
  cuenta  INTEGER NOT NULL
);

CREATE INDEX idx_login_intentos_ventana ON login_intentos (ventana);
