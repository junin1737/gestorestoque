'use strict';

const DIAS = [0, 1, 2, 3, 4, 5, 6];

function modeloPadrao() {
  return {
    id: 'gondola-110x30',
    tipo: 'gondola',
    nome: 'Gôndola 110×30',
    larguraMm: 110,
    alturaMm: 30,
    fundo: '#ffe14a',
    tinta: '#1a1a1a',
    mostrarEmpresa: false,
    mostrarDescricao: true,
    abreviarDescricao: false,
    maxDescricao: 42,
    mostrarReferencia: true,
    mostrarBarras: true,
    mostrarIdentificador: true,
    mostrarPreco: true,
    mostrarOferta: true,
    mostrarUnidade: false,
  };
}

function corHex(v, fallback) {
  const s = String(v || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : fallback;
}

function clamp(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function bool(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

function sanitizarModelo(bruto, idForcado) {
  const base = modeloPadrao();
  const src = bruto && typeof bruto === 'object' ? bruto : {};
  const idBruto = String(idForcado || src.id || '').trim().toLowerCase();
  const id = /^[a-z0-9][a-z0-9_-]{2,40}$/.test(idBruto) ? idBruto : '';
  const tipo = String(src.tipo || 'gondola').trim().toLowerCase();
  return {
    id,
    tipo: /^[a-z0-9_-]{3,20}$/.test(tipo) ? tipo : 'gondola',
    nome: String(src.nome || base.nome).trim().slice(0, 60) || base.nome,
    larguraMm: clamp(src.larguraMm, 40, 200, base.larguraMm),
    alturaMm: clamp(src.alturaMm, 15, 120, base.alturaMm),
    fundo: corHex(src.fundo, base.fundo),
    tinta: corHex(src.tinta, base.tinta),
    mostrarEmpresa: bool(src.mostrarEmpresa),
    mostrarDescricao: src.mostrarDescricao === undefined ? true : bool(src.mostrarDescricao),
    abreviarDescricao: bool(src.abreviarDescricao),
    maxDescricao: Math.round(clamp(src.maxDescricao, 8, 80, base.maxDescricao)),
    mostrarReferencia: src.mostrarReferencia === undefined ? true : bool(src.mostrarReferencia),
    mostrarBarras: src.mostrarBarras === undefined ? true : bool(src.mostrarBarras),
    mostrarIdentificador: src.mostrarIdentificador === undefined ? true : bool(src.mostrarIdentificador),
    mostrarPreco: src.mostrarPreco === undefined ? true : bool(src.mostrarPreco),
    mostrarOferta: src.mostrarOferta === undefined ? true : bool(src.mostrarOferta),
    mostrarUnidade: bool(src.mostrarUnidade),
  };
}

function lerModelos(loadAppConfig) {
  const cfg = loadAppConfig();
  const lista = Array.isArray(cfg.etiquetas?.modelos) ? cfg.etiquetas.modelos : [];
  const modelos = lista.map((m) => sanitizarModelo(m)).filter((m) => m.id);
  return modelos.length ? modelos : [modeloPadrao()];
}

function gravarModelos(loadAppConfig, saveAppConfig, modelos) {
  const current = loadAppConfig();
  saveAppConfig({ ...current, etiquetas: { modelos } });
}

function isoDe(v) {
  if (!v) return '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

function dataLocal(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
}

function hojeIso() {
  return isoDe(new Date());
}

function diasDe(v) {
  const lista = Array.isArray(v) ? v : String(v || '').split(',');
  const dias = [...new Set(lista.map((n) => Number(n)).filter((n) => DIAS.includes(n)))];
  dias.sort((a, b) => a - b);
  return dias;
}

function descricaoExibicao(descricao, grade, cor, tamanho) {
  const base = String(descricao || '').trim();
  if (String(grade || '').trim().toUpperCase() !== 'G') return base;
  return [base, String(cor || '').trim(), String(tamanho || '').trim()].filter(Boolean).join(' - ');
}

function vigenciaDe(inicio, fim, dias) {
  const hoje = hojeIso();
  const dia = new Date().getDay();
  if (inicio && inicio > hoje) return 'agendada';
  if (fim && fim < hoje) return 'encerrada';
  if (dias.length && !dias.includes(dia)) return 'fora-do-dia';
  return 'vigor';
}

function podeGravarPreco(auth, usuario) {
  const n = auth.nivel(usuario, 'estoque', 'precos');
  return n === 'editar' || n === 'total';
}

function montar(router, deps) {
  const {
    withDb, query, activeTargets, hasTable, refreshTables, nextGenId,
    loadAppConfig, saveAppConfig, auth,
  } = deps;
  const ler = auth.exigirModulo('estoque');

  async function ensureOferta(db) {
    const tem = await query(db, `
      SELECT 1 AS OK FROM RDB$RELATIONS WHERE TRIM(RDB$RELATION_NAME) = 'GESTOR_OFERTA'`);
    if (!tem.length) {
      await query(db, `
        CREATE TABLE GESTOR_OFERTA (
          ID_OFERTA INTEGER NOT NULL,
          ID_IDENTIFICADOR INTEGER NOT NULL,
          PRC_PROMO NUMERIC(15,2) NOT NULL,
          DT_INICIO DATE,
          DT_FIM DATE,
          DIAS_SEMANA VARCHAR(20),
          ATIVO CHAR(1) DEFAULT 'S',
          CONSTRAINT PK_GESTOR_OFERTA PRIMARY KEY (ID_OFERTA)
        )`);
    }
    try {
      const gen = await query(db, `
        SELECT 1 AS OK FROM RDB$GENERATORS WHERE TRIM(RDB$GENERATOR_NAME) = 'GEN_GESTOR_OFERTA_ID'`);
      if (!gen.length) await query(db, 'CREATE GENERATOR GEN_GESTOR_OFERTA_ID');
    } catch (err) {
      if (!/already exists|already defined|unsuccessful metadata/i.test(String(err?.message || err))) throw err;
    }
    await refreshTables(db);
  }

  function tabelas(appCfg) {
    return activeTargets(appCfg)[0].tables;
  }

  function mapProduto(r, oferta) {
    const descricao = descricaoExibicao(r.DESCRICAO, r.GRADE_SERIE, r.COR, r.TAMANHO);
    return {
      id_estoque: Number(r.ID_ESTOQUE),
      id_identificador: Number(r.ID_IDENTIFICADOR),
      descricao,
      referencia: String(r.REFERENCIA || '').trim(),
      cod_barras: String(r.COD_BARRAS || r.COD_BARRA || '').trim(),
      uni_medida: String(r.UNI_MEDIDA || '').trim(),
      prc_venda: Number(r.PRC_VENDA || 0),
      grupo: String(r.GRUPO || '').trim(),
      oferta: oferta || null,
    };
  }

  async function ofertasPorIdentificador(db, ids) {
    if (!ids.length || !hasTable('GESTOR_OFERTA')) return new Map();
    const rows = await query(db, `
      SELECT ID_OFERTA, ID_IDENTIFICADOR, PRC_PROMO, DT_INICIO, DT_FIM, DIAS_SEMANA
      FROM GESTOR_OFERTA
      WHERE ATIVO = 'S' AND ID_IDENTIFICADOR IN (${ids.map(() => '?').join(',')})`, ids);
    const mapa = new Map();
    for (const r of rows) {
      const inicio = isoDe(r.DT_INICIO);
      const fim = isoDe(r.DT_FIM);
      const dias = diasDe(r.DIAS_SEMANA);
      if (vigenciaDe(inicio, fim, dias) !== 'vigor') continue;
      const id = Number(r.ID_IDENTIFICADOR);
      const atual = mapa.get(id);
      const oferta = {
        id_oferta: Number(r.ID_OFERTA),
        prc_promo: Number(r.PRC_PROMO || 0),
      };
      if (!atual || oferta.id_oferta > atual.id_oferta) mapa.set(id, oferta);
    }
    return mapa;
  }

  router.get('/etiquetas/modelos', ler, (_req, res) => {
    res.json({ ok: true, modelos: lerModelos(loadAppConfig) });
  });

  router.put('/etiquetas/modelos', ler, (req, res) => {
    const lista = Array.isArray(req.body?.modelos) ? req.body.modelos : null;
    if (!lista || !lista.length) {
      return res.json({ ok: false, error: 'Informe ao menos um modelo de etiqueta.' });
    }
    const modelos = [];
    const ids = new Set();
    for (const bruto of lista.slice(0, 30)) {
      let modelo = sanitizarModelo(bruto);
      if (!modelo.id || ids.has(modelo.id)) {
        modelo = sanitizarModelo(bruto, `gondola-${Date.now().toString(36)}${modelos.length}`);
      }
      if (ids.has(modelo.id)) continue;
      ids.add(modelo.id);
      modelos.push(modelo);
    }
    if (!modelos.length) return res.json({ ok: false, error: 'Nenhum modelo válido.' });
    gravarModelos(loadAppConfig, saveAppConfig, modelos);
    res.json({ ok: true, modelos });
  });

  router.get('/etiquetas/produtos', ler, async (req, res) => {
    try {
      const q = String(req.query.q || '').trim().slice(0, 80);
      const inteiro = (nome) => {
        const n = Number(String(req.query[nome] || '').trim());
        return Number.isInteger(n) && n > 0 ? n : null;
      };
      let idDe = inteiro('idDe');
      let idAte = inteiro('idAte');
      if (idDe != null && idAte != null && idDe > idAte) [idDe, idAte] = [idAte, idDe];
      const grupos = [...new Set(String(req.query.grupos || '').split(',')
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n > 0))].slice(0, 40);
      if (!q && idDe == null && idAte == null && !grupos.length) {
        return res.json({ ok: true, itens: [] });
      }
      const data = await withDb(async (db, appCfg) => {
        const t = tabelas(appCfg);
        const where = [`(E.STATUS = 'A' OR E.STATUS IS NULL)`];
        const params = [];
        if (q) {
          for (const termo of q.split(/\s+/).filter(Boolean)) {
            where.push(`(
              UPPER(E.DESCRICAO) CONTAINING UPPER(?)
              OR UPPER(COALESCE(P.REFERENCIA, '')) CONTAINING UPPER(?)
              OR UPPER(COALESCE(P.COD_BARRA, '')) CONTAINING UPPER(?)
              OR CAST(I.ID_IDENTIFICADOR AS VARCHAR(20)) CONTAINING ?
              OR CAST(E.ID_ESTOQUE AS VARCHAR(20)) CONTAINING ?
            )`);
            params.push(termo, termo, termo, termo, termo);
          }
        }
        if (idDe != null && idAte != null) {
          where.push('I.ID_IDENTIFICADOR BETWEEN ? AND ?');
          params.push(idDe, idAte);
        } else if (idDe != null) {
          where.push('I.ID_IDENTIFICADOR >= ?');
          params.push(idDe);
        } else if (idAte != null) {
          where.push('I.ID_IDENTIFICADOR <= ?');
          params.push(idAte);
        }
        if (grupos.length) {
          where.push(`E.ID_GRUPO IN (${grupos.map(() => '?').join(',')})`);
          params.push(...grupos);
        }
        const rows = await query(db, `
          SELECT FIRST 400
            E.ID_ESTOQUE, I.ID_IDENTIFICADOR, E.DESCRICAO, E.UNI_MEDIDA, E.PRC_VENDA,
            G.DESCRICAO AS GRUPO, P.COD_BARRA AS COD_BARRAS, P.REFERENCIA,
            E.GRADE_SERIE, N1.DESCRICAO AS COR, N2.DESCRICAO AS TAMANHO
          FROM ${t.estoque} E
          JOIN ${t.identificador} I ON I.ID_ESTOQUE = E.ID_ESTOQUE
          JOIN ${t.produto} P ON P.ID_IDENTIFICADOR = I.ID_IDENTIFICADOR
          LEFT JOIN ${t.grupo} G ON G.ID_GRUPO = E.ID_GRUPO
          LEFT JOIN ${t.nivel1} N1 ON N1.ID_NIVEL1 = P.ID_NIVEL1
          LEFT JOIN ${t.nivel2} N2 ON N2.ID_NIVEL2 = P.ID_NIVEL2
          WHERE ${where.join(' AND ')}
          ORDER BY I.ID_IDENTIFICADOR`, params);
        const ofertas = await ofertasPorIdentificador(db, rows.map((r) => Number(r.ID_IDENTIFICADOR)));
        return rows.map((r) => mapProduto(r, ofertas.get(Number(r.ID_IDENTIFICADOR)) || null));
      });
      res.json({ ok: true, itens: data });
    } catch (err) {
      res.json({ ok: false, error: err.message, itens: [] });
    }
  });

  function mapOferta(r) {
    const inicio = isoDe(r.DT_INICIO);
    const fim = isoDe(r.DT_FIM);
    const dias = diasDe(r.DIAS_SEMANA);
    return {
      id_oferta: Number(r.ID_OFERTA),
      id_identificador: Number(r.ID_IDENTIFICADOR),
      id_estoque: r.ID_ESTOQUE == null ? null : Number(r.ID_ESTOQUE),
      descricao: descricaoExibicao(r.DESCRICAO, r.GRADE_SERIE, r.COR, r.TAMANHO),
      referencia: String(r.REFERENCIA || '').trim(),
      cod_barras: String(r.COD_BARRA || '').trim(),
      prc_venda: Number(r.PRC_VENDA || 0),
      prc_promo: Number(r.PRC_PROMO || 0),
      inicio,
      fim,
      dias,
      vigencia: vigenciaDe(inicio, fim, dias),
    };
  }

  router.get('/ofertas', ler, async (_req, res) => {
    try {
      const ofertas = await withDb(async (db, appCfg) => {
        await ensureOferta(db);
        const t = tabelas(appCfg);
        const rows = await query(db, `
          SELECT FIRST 500
            O.ID_OFERTA, O.ID_IDENTIFICADOR, O.PRC_PROMO, O.DT_INICIO, O.DT_FIM, O.DIAS_SEMANA,
            E.ID_ESTOQUE, E.DESCRICAO, E.PRC_VENDA, E.GRADE_SERIE,
            P.REFERENCIA, P.COD_BARRA, N1.DESCRICAO AS COR, N2.DESCRICAO AS TAMANHO
          FROM GESTOR_OFERTA O
          LEFT JOIN ${t.identificador} I ON I.ID_IDENTIFICADOR = O.ID_IDENTIFICADOR
          LEFT JOIN ${t.estoque} E ON E.ID_ESTOQUE = I.ID_ESTOQUE
          LEFT JOIN ${t.produto} P ON P.ID_IDENTIFICADOR = I.ID_IDENTIFICADOR
          LEFT JOIN ${t.nivel1} N1 ON N1.ID_NIVEL1 = P.ID_NIVEL1
          LEFT JOIN ${t.nivel2} N2 ON N2.ID_NIVEL2 = P.ID_NIVEL2
          WHERE O.ATIVO = 'S'
          ORDER BY O.DT_INICIO, O.ID_OFERTA DESC`);
        return rows.map(mapOferta);
      });
      res.json({ ok: true, ofertas });
    } catch (err) {
      res.json({ ok: false, error: err.message, ofertas: [] });
    }
  });

  function lerCorpoOferta(body) {
    const idIdentificador = Number(body?.id_identificador);
    const prc = Math.round(Number(body?.prc_promo) * 100) / 100;
    const inicio = dataLocal(body?.inicio);
    const fim = dataLocal(body?.fim);
    const dias = diasDe(body?.dias);
    if (!Number.isInteger(idIdentificador) || idIdentificador <= 0) throw new Error('Selecione o produto.');
    if (!Number.isFinite(prc) || prc <= 0 || prc > 999999.99) throw new Error('Informe o preço promocional.');
    if (!inicio || !fim) throw new Error('Informe o período da oferta.');
    if (isoDe(inicio) > isoDe(fim)) throw new Error('A data inicial não pode passar da data final.');
    return {
      idIdentificador,
      prc,
      inicio,
      fim,
      dias: dias.join(','),
    };
  }

  async function produtoExiste(db, appCfg, id) {
    const t = tabelas(appCfg);
    const rows = await query(db, `
      SELECT FIRST 1 I.ID_IDENTIFICADOR
      FROM ${t.identificador} I
      WHERE I.ID_IDENTIFICADOR = ?`, [id]);
    return rows.length > 0;
  }

  router.post('/ofertas', ler, async (req, res) => {
    try {
      if (!podeGravarPreco(auth, req.usuario)) {
        return res.json({ ok: false, error: 'Sem permissão para gravar preço promocional.' });
      }
      const corpo = lerCorpoOferta(req.body);
      const oferta = await withDb(async (db, appCfg) => {
        await ensureOferta(db);
        if (!(await produtoExiste(db, appCfg, corpo.idIdentificador))) throw new Error('Produto não encontrado.');
        const id = await nextGenId(db, 'GEN_GESTOR_OFERTA_ID', 'GESTOR_OFERTA', 'ID_OFERTA');
        await query(db, `
          INSERT INTO GESTOR_OFERTA
            (ID_OFERTA, ID_IDENTIFICADOR, PRC_PROMO, DT_INICIO, DT_FIM, DIAS_SEMANA, ATIVO)
          VALUES (?, ?, ?, ?, ?, ?, 'S')`, [
          id, corpo.idIdentificador, corpo.prc, corpo.inicio, corpo.fim, corpo.dias || null,
        ]);
        return id;
      });
      res.json({ ok: true, id_oferta: oferta });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });

  router.put('/ofertas/:id', ler, async (req, res) => {
    try {
      if (!podeGravarPreco(auth, req.usuario)) {
        return res.json({ ok: false, error: 'Sem permissão para gravar preço promocional.' });
      }
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.json({ ok: false, error: 'Oferta inválida.' });
      const corpo = lerCorpoOferta(req.body);
      await withDb(async (db, appCfg) => {
        await ensureOferta(db);
        if (!(await produtoExiste(db, appCfg, corpo.idIdentificador))) throw new Error('Produto não encontrado.');
        const atual = await query(db, 'SELECT FIRST 1 ID_OFERTA FROM GESTOR_OFERTA WHERE ID_OFERTA = ? AND ATIVO = \'S\'', [id]);
        if (!atual.length) throw new Error('Oferta não encontrada.');
        await query(db, `
          UPDATE GESTOR_OFERTA
          SET ID_IDENTIFICADOR = ?, PRC_PROMO = ?, DT_INICIO = ?, DT_FIM = ?, DIAS_SEMANA = ?
          WHERE ID_OFERTA = ?`, [
          corpo.idIdentificador, corpo.prc, corpo.inicio, corpo.fim, corpo.dias || null, id,
        ]);
      });
      res.json({ ok: true, id_oferta: id });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });

  router.delete('/ofertas/:id', ler, async (req, res) => {
    try {
      if (!podeGravarPreco(auth, req.usuario)) {
        return res.json({ ok: false, error: 'Sem permissão para remover a oferta.' });
      }
      const id = Number(req.params.id);
      await withDb(async (db) => {
        await ensureOferta(db);
        await query(db, `UPDATE GESTOR_OFERTA SET ATIVO = 'N' WHERE ID_OFERTA = ?`, [id]);
      });
      res.json({ ok: true });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  });
}

module.exports = { montar };
