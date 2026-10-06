-- Teste grátis: cliente novo entra liberado com pago_ate = hoje + dias_teste (config); em_teste marca o período.
ALTER TABLE clientes ADD COLUMN em_teste INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO config (chave, valor, atualizado_em)
VALUES ('dias_teste', '7', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
