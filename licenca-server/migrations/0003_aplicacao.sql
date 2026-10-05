-- Uma licença por empresa + aplicação (o mesmo painel atende outras aplicações além do GestorEstoque).
CREATE TABLE clientes_v2 (
  cnpj TEXT NOT NULL,
  aplicacao TEXT NOT NULL DEFAULT 'GestorEstoque',
  razao TEXT,
  fantasia TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  pago_ate TEXT,
  mensagem TEXT,
  observacao TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  ultimo_contato TEXT,
  sup_hash TEXT,
  sup_atualizado_em TEXT,
  PRIMARY KEY (cnpj, aplicacao)
);
INSERT INTO clientes_v2 (cnpj, aplicacao, razao, fantasia, status, pago_ate, mensagem, observacao,
  criado_em, atualizado_em, ultimo_contato, sup_hash, sup_atualizado_em)
SELECT cnpj, 'GestorEstoque', razao, fantasia, status, pago_ate, mensagem, observacao,
  criado_em, atualizado_em, ultimo_contato, sup_hash, sup_atualizado_em
FROM clientes;
DROP TABLE clientes;
ALTER TABLE clientes_v2 RENAME TO clientes;

CREATE TABLE instalacoes_v2 (
  cnpj TEXT NOT NULL,
  aplicacao TEXT NOT NULL DEFAULT 'GestorEstoque',
  nse TEXT NOT NULL,
  maquina TEXT,
  versao_gestor TEXT,
  versao_clipp TEXT,
  sistema TEXT,
  ip TEXT,
  primeiro_contato TEXT NOT NULL,
  ultimo_contato TEXT NOT NULL,
  PRIMARY KEY (cnpj, aplicacao, nse)
);
INSERT INTO instalacoes_v2 (cnpj, aplicacao, nse, maquina, versao_gestor, versao_clipp, sistema, ip,
  primeiro_contato, ultimo_contato)
SELECT cnpj, 'GestorEstoque', nse, maquina, versao_gestor, versao_clipp, sistema, ip,
  primeiro_contato, ultimo_contato
FROM instalacoes;
DROP TABLE instalacoes;
ALTER TABLE instalacoes_v2 RENAME TO instalacoes;

ALTER TABLE eventos ADD COLUMN aplicacao TEXT;
UPDATE eventos SET aplicacao = 'GestorEstoque' WHERE cnpj <> '*';
CREATE INDEX IF NOT EXISTS idx_eventos_app ON eventos (cnpj, aplicacao, id DESC);
