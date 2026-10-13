-- Contador é global: um escritório atende várias empresas. Cada cliente tem no máximo um.
CREATE TABLE IF NOT EXISTS contadores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  tipo_doc TEXT NOT NULL,
  documento TEXT NOT NULL UNIQUE,
  crc TEXT,
  email TEXT NOT NULL UNIQUE,
  telefone TEXT,
  senha_hash TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

ALTER TABLE clientes ADD COLUMN contador_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_clientes_contador ON clientes (contador_id);
