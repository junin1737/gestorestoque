-- Revendas: o Gestor informa o CNPJ da revenda ao solicitar a liberação.
CREATE TABLE revendas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cnpj TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  contato TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
INSERT INTO revendas (id, cnpj, nome, contato, ativo, criado_em, atualizado_em)
VALUES (1, '11863364000111', 'MT Automações', '(34) 3674-1937', 1,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

ALTER TABLE clientes ADD COLUMN revenda_id INTEGER REFERENCES revendas (id);
UPDATE clientes SET revenda_id = 1;
CREATE INDEX IF NOT EXISTS idx_clientes_revenda ON clientes (revenda_id);
