-- Fase 3: servicios y clientes de cada negocio.
-- Las restricciones (rangos, unicidad) van en la base de datos, no solo en la aplicación.

CREATE TABLE services (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  price_cents  INTEGER NOT NULL CHECK (price_cents >= 0),
  duration_min INTEGER NOT NULL CHECK (duration_min BETWEEN 5 AND 720),
  prep_min     INTEGER NOT NULL DEFAULT 0 CHECK (prep_min BETWEEN 0 AND 240),
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE INDEX idx_services_negocio ON services (business_id, active, name);

CREATE TABLE clients (
  id                TEXT PRIMARY KEY,
  business_id       TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  first_name        TEXT NOT NULL,
  last_name         TEXT NOT NULL,
  phone             TEXT,
  email             TEXT,
  notes             TEXT,
  tags              TEXT NOT NULL DEFAULT '[]',
  marketing_consent INTEGER NOT NULL DEFAULT 0 CHECK (marketing_consent IN (0, 1)),
  consent_at        INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

-- Un mismo teléfono no se repite dentro del mismo negocio (los clientes sin teléfono no cuentan).
CREATE UNIQUE INDEX idx_clientes_telefono_unico ON clients (business_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_clientes_negocio_nombre ON clients (business_id, first_name, last_name);
