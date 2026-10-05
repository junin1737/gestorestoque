-- Hash PBKDF2 da senha do supervisor: padrão (config) ou própria do cliente (clientes.sup_hash).
-- A senha em texto nunca chega ao servidor: o painel calcula o hash no navegador.
CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT,
  atualizado_em TEXT
);

ALTER TABLE clientes ADD COLUMN sup_hash TEXT;
ALTER TABLE clientes ADD COLUMN sup_atualizado_em TEXT;
