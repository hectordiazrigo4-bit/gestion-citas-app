-- Fase 2: usuarios, negocios, pertenencias con rol y sesiones.
-- Las fechas se guardan como milisegundos desde 1970 (entero), para comparar sin ambigüedades.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE businesses (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Un usuario puede pertenecer a varios negocios, con un rol distinto en cada uno.
CREATE TABLE memberships (
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'employee')),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, business_id)
);

CREATE INDEX idx_memberships_business ON memberships (business_id);

-- Solo se guarda el hash del token de sesión, nunca el token.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions (user_id);
