CREATE TABLE IF NOT EXISTS oferta_usuarios (
  id TEXT PRIMARY KEY,
  cnpj TEXT NOT NULL,
  aplicacao TEXT NOT NULL,
  nome TEXT NOT NULL,
  login TEXT NOT NULL,
  senha_hash TEXT NOT NULL,
  administrador INTEGER NOT NULL DEFAULT 0,
  senha_inicial INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_oferta_usuario_login ON oferta_usuarios (cnpj, aplicacao, login);
