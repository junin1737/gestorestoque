ALTER TABLE clientes ADD COLUMN ig_usuario TEXT;
ALTER TABLE clientes ADD COLUMN ig_user_id TEXT;
ALTER TABLE clientes ADD COLUMN ig_token TEXT;
ALTER TABLE clientes ADD COLUMN ig_token_expira TEXT;

CREATE TABLE IF NOT EXISTS alteracao_fila (
  id TEXT PRIMARY KEY,
  loja_id TEXT NOT NULL,
  produto_id TEXT NOT NULL,
  campo TEXT NOT NULL,
  valor_visto TEXT,
  valor_novo TEXT,
  periodo TEXT,
  usuario TEXT,
  criado_em TEXT NOT NULL,
  status TEXT NOT NULL,
  resultado TEXT
);

CREATE INDEX IF NOT EXISTS idx_fila_loja ON alteracao_fila (loja_id, status, criado_em);

CREATE TABLE IF NOT EXISTS catalogo_copia (
  loja_id TEXT NOT NULL,
  produto_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  PRIMARY KEY (loja_id, produto_id)
);

CREATE TABLE IF NOT EXISTS produto_foto (
  loja_id TEXT NOT NULL,
  produto_id TEXT NOT NULL,
  ean TEXT,
  chave_r2 TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  PRIMARY KEY (loja_id, produto_id)
);
