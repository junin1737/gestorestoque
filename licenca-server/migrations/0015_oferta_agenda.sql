CREATE TABLE IF NOT EXISTS oferta_agenda (
  id TEXT PRIMARY KEY,
  loja_id TEXT NOT NULL,
  oferta_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  forma TEXT NOT NULL,
  quando TEXT NOT NULL,
  image_url TEXT NOT NULL,
  caption TEXT,
  link TEXT,
  status TEXT NOT NULL,
  creation_id TEXT,
  post_id TEXT,
  erro TEXT,
  tentativa_em TEXT,
  criado_em TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_oferta_agenda_slot ON oferta_agenda (loja_id, oferta_id, slot_id, forma);
CREATE INDEX IF NOT EXISTS idx_oferta_agenda_quando ON oferta_agenda (status, quando);
