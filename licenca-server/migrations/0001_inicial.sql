-- status: pendente (novo, aguardando liberação) | liberado | bloqueado
CREATE TABLE IF NOT EXISTS clientes (
  cnpj TEXT PRIMARY KEY,
  razao TEXT,
  fantasia TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  pago_ate TEXT,
  mensagem TEXT,
  observacao TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  ultimo_contato TEXT
);

CREATE TABLE IF NOT EXISTS instalacoes (
  cnpj TEXT NOT NULL,
  nse TEXT NOT NULL,
  maquina TEXT,
  versao_gestor TEXT,
  versao_clipp TEXT,
  sistema TEXT,
  ip TEXT,
  primeiro_contato TEXT NOT NULL,
  ultimo_contato TEXT NOT NULL,
  PRIMARY KEY (cnpj, nse)
);

CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cnpj TEXT NOT NULL,
  tipo TEXT NOT NULL,
  detalhe TEXT,
  criado_em TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_eventos_cnpj ON eventos (cnpj, id DESC);
