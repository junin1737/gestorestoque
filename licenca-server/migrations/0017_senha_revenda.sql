ALTER TABLE revendas ADD COLUMN senha_hash TEXT;
ALTER TABLE revendas ADD COLUMN senha_temporaria INTEGER NOT NULL DEFAULT 0;
ALTER TABLE revendas ADD COLUMN senha_atualizado_em TEXT;
