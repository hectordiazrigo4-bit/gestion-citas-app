-- Fase 6: avisos automáticos (confirmaciones, recordatorios, cancelaciones, seguimiento),
-- cola de envíos con reintentos y lista de espera.
-- Los avisos se guardan con el destinatario solo durante el periodo de retención (180 días).

ALTER TABLE businesses ADD COLUMN review_url TEXT;

CREATE TABLE notifications (
  id              TEXT PRIMARY KEY,
  business_id     TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  client_id       TEXT REFERENCES clients (id) ON DELETE CASCADE,
  appointment_id  TEXT REFERENCES appointments (id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('confirmacion', 'recordatorio', 'cancelacion', 'cambio_hora',
                                                 'aviso_profesional', 'seguimiento', 'hueco_libre', 'reactivacion')),
  channel         TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  to_address      TEXT NOT NULL,
  subject         TEXT,
  body            TEXT NOT NULL,
  params          TEXT,
  status          TEXT NOT NULL CHECK (status IN ('pendiente', 'enviado', 'fallido', 'caducado')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error      TEXT,
  dedupe_key      TEXT NOT NULL UNIQUE,
  created_at      INTEGER NOT NULL,
  sent_at         INTEGER
);

CREATE INDEX idx_avisos_cola ON notifications (status, next_attempt_at);
CREATE INDEX idx_avisos_negocio ON notifications (business_id, created_at);

CREATE TABLE waitlist (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  client_id   TEXT NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  service_id  TEXT NOT NULL REFERENCES services (id) ON DELETE CASCADE,
  fecha       TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_lista_espera ON waitlist (business_id, service_id, fecha);
