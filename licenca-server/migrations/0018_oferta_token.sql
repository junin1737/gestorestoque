ALTER TABLE clientes ADD COLUMN oferta_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_oferta_token ON clientes (oferta_token);
