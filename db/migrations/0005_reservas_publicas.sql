-- Fase 4 (reservas online): enlace público por negocio, política de cancelación,
-- origen de cada cita, constancia de la aceptación de privacidad y límite de intentos.

ALTER TABLE businesses ADD COLUMN slug TEXT;
ALTER TABLE businesses ADD COLUMN cancel_hours INTEGER NOT NULL DEFAULT 24 CHECK (cancel_hours BETWEEN 0 AND 168);

-- Los negocios ya existentes reciben un identificador provisional; el propietario puede cambiarlo más adelante.
UPDATE businesses SET slug = 'negocio-' || lower(hex(randomblob(4))) WHERE slug IS NULL;
CREATE UNIQUE INDEX idx_negocios_slug ON businesses (slug);

ALTER TABLE appointments ADD COLUMN source TEXT NOT NULL DEFAULT 'panel' CHECK (source IN ('panel', 'web'));
ALTER TABLE appointments ADD COLUMN privacy_accepted_at INTEGER;

-- Contador por ventana de tiempo. La clave es un hash, nunca la IP en claro.
CREATE TABLE rate_limits (
  clave   TEXT PRIMARY KEY,
  ventana INTEGER NOT NULL,
  cuenta  INTEGER NOT NULL
);

CREATE INDEX idx_rate_limits_ventana ON rate_limits (ventana);
