-- Fase 4: horarios, bloqueos, citas y prevención de solapamientos.
-- Los tiempos se guardan en milisegundos UTC. La zona horaria del negocio se usa para interpretar horas locales.

ALTER TABLE businesses ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Europe/Madrid';

-- Horario de apertura por día de la semana (0 = domingo ... 6 = sábado). Sin fila = cerrado.
CREATE TABLE working_hours (
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens_min   INTEGER NOT NULL CHECK (opens_min BETWEEN 0 AND 1439),
  closes_min  INTEGER NOT NULL CHECK (closes_min BETWEEN 1 AND 1440 AND closes_min > opens_min),
  PRIMARY KEY (business_id, weekday)
);

-- Descansos, vacaciones y bloqueos puntuales.
CREATE TABLE blocked_slots (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('bloqueo', 'descanso', 'vacaciones')),
  starts_at   INTEGER NOT NULL,
  ends_at     INTEGER NOT NULL CHECK (ends_at > starts_at),
  reason      TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_bloqueos_negocio_inicio ON blocked_slots (business_id, starts_at);

-- Citas. Cada cita guarda una copia del servicio y del precio en el momento de reservar.
-- ends_at: fin del servicio. blocked_until: fin del servicio más el tiempo de preparación.
CREATE TABLE appointments (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  client_id    TEXT NOT NULL REFERENCES clients (id),
  service_id   TEXT NOT NULL REFERENCES services (id),
  service_name TEXT NOT NULL,
  price_cents  INTEGER NOT NULL CHECK (price_cents >= 0),
  starts_at    INTEGER NOT NULL,
  ends_at      INTEGER NOT NULL CHECK (ends_at > starts_at),
  blocked_until INTEGER NOT NULL CHECK (blocked_until >= ends_at),
  status       TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')),
  notes        TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE INDEX idx_citas_negocio_inicio ON appointments (business_id, starts_at);

-- Garantía en la base de datos: una cita activa no puede solaparse con otra cita activa
-- ni con un bloqueo. D1 ejecuta cada escritura de forma atómica, así que dos reservas
-- simultáneas no pueden colarse en el mismo hueco.

CREATE TRIGGER citas_no_solapan_al_crear
BEFORE INSERT ON appointments
WHEN NEW.status IN ('pending', 'confirmed', 'completed')
 AND (
   EXISTS (SELECT 1 FROM appointments a
            WHERE a.business_id = NEW.business_id
              AND a.status IN ('pending', 'confirmed', 'completed')
              AND a.starts_at < NEW.blocked_until AND a.blocked_until > NEW.starts_at)
   OR EXISTS (SELECT 1 FROM blocked_slots b
               WHERE b.business_id = NEW.business_id
                 AND b.starts_at < NEW.blocked_until AND b.ends_at > NEW.starts_at)
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
              AND a.starts_at < NEW.blocked_until AND a.blocked_until > NEW.starts_at)
   OR EXISTS (SELECT 1 FROM blocked_slots b
               WHERE b.business_id = NEW.business_id
                 AND b.starts_at < NEW.blocked_until AND b.ends_at > NEW.starts_at)
 )
BEGIN
  SELECT RAISE(ABORT, 'HORARIO_OCUPADO');
END;

-- No se puede bloquear un tramo que ya tiene citas activas: primero hay que cancelarlas o moverlas.
CREATE TRIGGER bloqueos_sin_citas_activas
BEFORE INSERT ON blocked_slots
WHEN EXISTS (SELECT 1 FROM appointments a
              WHERE a.business_id = NEW.business_id
                AND a.status IN ('pending', 'confirmed', 'completed')
                AND a.starts_at < NEW.ends_at AND a.blocked_until > NEW.starts_at)
BEGIN
  SELECT RAISE(ABORT, 'HAY_CITAS_EN_EL_TRAMO');
END;
