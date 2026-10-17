-- Momento em que o painel marcou o cliente como bloqueado.
-- O Gestor só recebe o bloqueio 20 minutos depois.
ALTER TABLE clientes ADD COLUMN bloqueado_em TEXT;
