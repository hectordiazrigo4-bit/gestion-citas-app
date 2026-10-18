-- Fase 7: equipo (invitaciones, horario y servicios por profesional), cobros manuales
-- y agenda por profesional. Sin profesional asignado, la cita sigue el calendario del negocio.

-- Cada profesional tiene su propia agenda: las citas solo se solapan con las de la misma persona
-- (o entre citas sin profesional). Los bloqueos sin profesional afectan a todos.
ALTER TABLE appointments ADD COLUMN employee_id TEXT REFERENCES users (id);
ALTER TABLE blocked_slots ADD COLUMN employee_id TEXT REFERENCES users (id) ON DELETE CASCADE;

DROP TRIGGER citas_no_solapan_al_crear;
DROP TRIGGER citas_no_solapan_al_cambiar;
DROP TRIGGER bloqueos_sin_citas_activas;

CREATE TRIGGER citas_no_solapan_al_crear
BEFORE INSERT ON appointments
WHEN NEW.status IN ('pending', 'confirmed', 'completed')
 AND (
   EXISTS (SELECT 1 FROM appointments a
            WHERE a.business_id = NEW.business_id
              AND a.status IN ('pending', 'confirmed', 'completed')
              AND a.starts_at < NEW.blocked_until AND a.blocked_until > NEW.starts_at
              AND a.employee_id IS NEW.employee_id)
   OR EXISTS (SELECT 1 FROM blocked_slots b
               WHERE b.business_id = NEW.business_id
                 AND b.starts_at < NEW.blocked_until AND b.ends_at > NEW.starts_at
                 AND (b.employee_id IS NULL OR b.employee_id IS NEW.employee_id))
 )
BEGIN
  SELECT RAISE(ABORT, 'HORARIO_OCUPADO');
END;

CREATE TRIGGER citas_no_solapan_al_cambiar
BEFORE UPDATE ON appointments
WHEN NEW.status IN ('pending', 'confirmed', 'completed')
 AND (
   EXISTS (SELECT 1 FROM appointments a
            WHERE a.business_id = NEW.business_id AND a.id <> NEW.id
              AND a.status IN ('pending', 'confirmed', 'completed')
              AND a.starts_at < NEW.blocked_until AND a.blocked_until > NEW.starts_at
              AND a.employee_id IS NEW.employee_id)
   OR EXISTS (SELECT 1 FROM blocked_slots b
               WHERE b.business_id = NEW.business_id
                 AND b.starts_at < NEW.blocked_until AND b.ends_at > NEW.starts_at
                 AND (b.employee_id IS NULL OR b.employee_id IS NEW.employee_id))
 )
BEGIN
  SELECT RAISE(ABORT, 'HORARIO_OCUPADO');
END;

CREATE TRIGGER bloqueos_sin_citas_activas
BEFORE INSERT ON blocked_slots
WHEN EXISTS (SELECT 1 FROM appointments a
              WHERE a.business_id = NEW.business_id
                AND a.status IN ('pending', 'confirmed', 'completed')
                AND a.starts_at < NEW.ends_at AND a.blocked_until > NEW.starts_at
                AND (NEW.employee_id IS NULL OR a.employee_id IS NEW.employee_id))
BEGIN
  SELECT RAISE(ABORT, 'HAY_CITAS_EN_EL_TRAMO');
END;

-- Horario individual del profesional (sin filas = horario del negocio).
CREATE TABLE employee_hours (
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens_min   INTEGER NOT NULL CHECK (opens_min BETWEEN 0 AND 1439),
  closes_min  INTEGER NOT NULL CHECK (closes_min BETWEEN 1 AND 1440 AND closes_min > opens_min),
  PRIMARY KEY (business_id, user_id, weekday)
);

-- Servicios que puede realizar cada profesional (sin filas para un servicio = cualquiera).
CREATE TABLE employee_services (
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  service_id  TEXT NOT NULL REFERENCES services (id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, service_id)
);

-- Invitaciones de un solo uso. Solo se guarda el hash del enlace.
CREATE TABLE invitations (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('admin', 'employee')),
  email        TEXT COLLATE NOCASE,
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   INTEGER NOT NULL,
  accepted_at  INTEGER,
  created_at   INTEGER NOT NULL
);

-- Cobros manuales. Los importes se guardan siempre en positivo; el tipo indica si suman o restan.
-- No se guarda ningún dato de tarjeta: solo el medio de pago.
CREATE TABLE payments (
  id             TEXT PRIMARY KEY,
  business_id    TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  appointment_id TEXT NOT NULL REFERENCES appointments (id),
  kind           TEXT NOT NULL CHECK (kind IN ('pago', 'devolucion')),
  amount_cents   INTEGER NOT NULL CHECK (amount_cents > 0),
  method         TEXT NOT NULL CHECK (method IN ('efectivo', 'tarjeta', 'transferencia', 'otro')),
  note           TEXT,
  created_by     TEXT REFERENCES users (id),
  paid_at        INTEGER NOT NULL,
  created_at     INTEGER NOT NULL
);

CREATE INDEX idx_pagos_cita ON payments (appointment_id);
CREATE INDEX idx_pagos_negocio_fecha ON payments (business_id, paid_at);
