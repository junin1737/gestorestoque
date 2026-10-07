-- Segredo da instalação do Gestor (hash SHA-256). O primeiro Gestor que se apresenta com ele fica sendo
-- a instalação da empresa; só ela registra o endereço de acesso online e responde por matriz/filial.
ALTER TABLE clientes ADD COLUMN segredo_hash TEXT;
