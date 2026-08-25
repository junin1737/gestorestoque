'use strict';
const express = require('express');
const {
  loadAppConfig,
  saveAppConfig,
  loadUsersConfig,
  saveUsersConfig,
  SUPERVISOR_SENHA,
  MODULOS,
  ensureModulos,
  fullPermissoes,
} = require('./config');
const {
  withDb,
  query,
  connectSmart,
  detach,
  ensureSchema,
  activeTargets,
  blobToDataUrl,
  hasTable,
  refreshTables,
  columnExists,
  getDbMaintenanceInfo,
  releaseDatabase,
  resumeDatabase,
} = require('./db');
const {
  AUDIT_TABLE,
  ensureAuditSchema,
  logProductChanges,
  logProductCreate,
  hasAuditTable,
} = require('./audit');
const { localNow, formatBrDateTime, mapExtractParts, sqlExtractDataHora } = require('./datetime');

const router = express.Router();

function publicUser(u) {
  return {
    id: u.id,
    nome: u.nome,
    supervisor: !!u.supervisor,
    permissoes: u.permissoes,
    temSenha: u.supervisor ? true : !!(u.senha && String(u.senha).length),
  };
}

router.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'gestor-estoque', version: '1.0.0' });
});

router.get('/network', (_req, res) => {
  const os = require('os');
  const { PORT } = require('./config');
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family !== 'IPv4' && net.family !== 4) continue;
      if (net.internal) continue;
      addresses.push({ interface: name, address: net.address, url: `http://${net.address}:${PORT}` });
    }
  }
  const primary = addresses[0] || null;
  res.json({
    ok: true,
    port: PORT,
    hostname: os.hostname(),
    localUrl: `http://127.0.0.1:${PORT}`,
    hostUrl: `http://${os.hostname()}:${PORT}`,
    primaryIp: primary ? primary.address : '127.0.0.1',
    primaryUrl: primary ? primary.url : `http://127.0.0.1:${PORT}`,
    addresses,
  });
});

router.get('/qrcode', async (req, res) => {
  try {
    const QRCode = require('qrcode');
    const data = String(req.query.data || '').trim();
    if (!data) return res.json({ ok: false, error: 'Informe data=' });
    const dataUrl = await QRCode.toDataURL(data, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 280,
      color: { dark: '#111111', light: '#ffffff' },
    });
    res.json({ ok: true, dataUrl, data });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.post('/shutdown', (req, res) => {
  const raw = req.socket?.remoteAddress || req.ip || '';
  const isLocal =
    raw === '127.0.0.1' ||
    raw === '::1' ||
    raw === '::ffff:127.0.0.1' ||
    raw.endsWith('127.0.0.1');
  if (!isLocal) return res.status(403).json({ ok: false, error: 'Somente no servidor local.' });
  res.json({ ok: true });
  setTimeout(() => process.exit(0), 300);
});

router.get('/config', (_req, res) => {
  const cfg = loadAppConfig();
  res.json({
    ok: true,
    config: {
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      sistema: cfg.sistema,
      tema: cfg.tema,
    },
    modulos: MODULOS,
  });
});

router.post('/config', (req, res) => {
  const current = loadAppConfig();
  const body = req.body || {};
  const next = {
    ...current,
    host: body.host || current.host,
    port: Number(body.port) || current.port,
    database: body.database || current.database,
    user: 'SYSDBA',
    password: 'masterkey',
    sistema: body.sistema || current.sistema,
    tema: body.tema || current.tema,
  };
  saveAppConfig(next);
  res.json({ ok: true, config: { ...next, password: undefined } });
});

router.post('/connect', async (req, res) => {
  try {
    const current = loadAppConfig();
    const body = req.body || {};
    const cfg = {
      ...current,
      host: body.host || current.host,
      port: Number(body.port) || current.port,
      database: body.database || current.database,
      user: 'SYSDBA',
      password: 'masterkey',
      sistema: body.sistema || current.sistema,
    };
    saveAppConfig(cfg);

    const { db, fbVersion } = await connectSmart(cfg);
    try {
      await ensureSchema(db);
      await refreshTables(db);
      const emitenteRows = await query(
        db,
        `SELECT FIRST 1 NOME_FANTA, NOME, LOGO FROM TB_EMITENTE`
      );
      const e = emitenteRows[0] || {};
      const logo = await blobToDataUrl(e.LOGO);
      res.json({
        ok: true,
        fbVersion,
        sistema: cfg.sistema,
        database: cfg.database,
        hasManagePro: hasTable('TB_ESTOQUE_2'),
        emitente: {
          nome_fanta: String(e.NOME_FANTA || e.NOME || '').trim(),
          logo,
        },
      });
    } finally {
      await detach(db);
    }
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.get('/emitente', async (_req, res) => {
  try {
    const data = await withDb(async (db) => {
      const rows = await query(db, `SELECT FIRST 1 NOME_FANTA, NOME, LOGO FROM TB_EMITENTE`);
      const e = rows[0] || {};
      const logo = await blobToDataUrl(e.LOGO);
      return {
        nome_fanta: String(e.NOME_FANTA || e.NOME || '').trim(),
        logo,
      };
    });
    res.json({ ok: true, emitente: data });
  } catch (err) {
    res.json({ ok: false, error: err.message, emitente: { nome_fanta: '', logo: null } });
  }
});

router.get('/funcionarios', async (_req, res) => {
  try {
    const appCfg = loadAppConfig();
    const usersCfg = loadUsersConfig(appCfg);
    const rows = await withDb(async (db) =>
      query(
        db,
        `SELECT ID_FUNCIONARIO, NOME, STATUS
         FROM TB_FUNCIONARIO
         WHERE STATUS = 'A' OR STATUS IS NULL OR ID_FUNCIONARIO = 0
         ORDER BY NOME`
      )
    );

    const byId = new Map(usersCfg.usuarios.map((u) => [Number(u.id), u]));
    let changed = false;
    for (const r of rows) {
      const id = Number(r.ID_FUNCIONARIO);
      const nome = String(r.NOME || '').trim();
      if (!byId.has(id)) {
        usersCfg.usuarios.push({
          id,
          nome,
          senha: id === 0 ? SUPERVISOR_SENHA : '',
          supervisor: id === 0,
          permissoes: id === 0 ? fullPermissoes() : ensureModulos({}),
        });
        changed = true;
      } else {
        const u = byId.get(id);
        if (u.nome !== nome && !u.supervisor) {
          u.nome = nome;
          changed = true;
        }
      }
    }
    if (changed) saveUsersConfig(appCfg, usersCfg);

    const list = loadUsersConfig(appCfg).usuarios
      .filter((u) => u.supervisor || rows.some((r) => Number(r.ID_FUNCIONARIO) === Number(u.id)))
      .map(publicUser);

    res.json({ ok: true, funcionarios: list });
  } catch (err) {
    const appCfg = loadAppConfig();
    const list = loadUsersConfig(appCfg).usuarios.map(publicUser);
    res.json({ ok: false, error: err.message, funcionarios: list });
  }
});

router.post('/login', (req, res) => {
  const appCfg = loadAppConfig();
  const cfg = loadUsersConfig(appCfg);
  const id = Number(req.body && req.body.id);
  const senha = String((req.body && req.body.senha) || '');
  const user = cfg.usuarios.find((u) => Number(u.id) === id);
  if (!user) return res.json({ ok: false, error: 'Usuário não encontrado.' });
  const expected = user.supervisor ? SUPERVISOR_SENHA : String(user.senha || '');
  if (!expected) return res.json({ ok: false, error: 'Defina a senha deste usuário em Usuários.' });
  if (expected !== senha) return res.json({ ok: false, error: 'Senha incorreta.' });
  res.json({
    ok: true,
    usuario: publicUser(user.supervisor ? { ...user, senha: SUPERVISOR_SENHA, permissoes: fullPermissoes() } : user),
  });
});

router.get('/usuarios', (req, res) => {
  const appCfg = loadAppConfig();
  const cfg = loadUsersConfig(appCfg);
  res.json({ ok: true, usuarios: cfg.usuarios.map(publicUser), modulos: MODULOS });
});

router.post('/usuarios', (req, res) => {
  const appCfg = loadAppConfig();
  const cfg = loadUsersConfig(appCfg);
  const { supervisorSenha, usuarios } = req.body || {};
  if (String(supervisorSenha || '') !== SUPERVISOR_SENHA) {
    return res.json({ ok: false, error: 'Senha de supervisor inválida.' });
  }
  const currentById = new Map(cfg.usuarios.map((u) => [Number(u.id), u]));
  cfg.usuarios = (usuarios || []).map((u) => {
    const prev = currentById.get(Number(u.id));
    if (u.supervisor) {
      return {
        id: 0,
        nome: u.nome || 'SUPERVISOR',
        senha: SUPERVISOR_SENHA,
        supervisor: true,
        permissoes: fullPermissoes(),
      };
    }
    const senhaNova = u.senha !== undefined && u.senha !== '' ? String(u.senha) : (prev ? prev.senha : '');
    return {
      id: Number(u.id),
      nome: String(u.nome || '').trim(),
      senha: senhaNova,
      supervisor: false,
      permissoes: ensureModulos(u.permissoes),
    };
  });
  if (!cfg.usuarios.some((u) => u.supervisor)) {
    cfg.usuarios.unshift({
      id: 0,
      nome: 'SUPERVISOR',
      senha: SUPERVISOR_SENHA,
      supervisor: true,
      permissoes: fullPermissoes(),
    });
  }
  saveUsersConfig(appCfg, cfg);
  res.json({ ok: true, usuarios: cfg.usuarios.map(publicUser) });
});

function mapProdutoRow(r) {
  return {
    id_estoque: Number(r.ID_ESTOQUE),
    id_identificador: Number(r.ID_IDENTIFICADOR),
    descricao: String(r.DESCRICAO || '').trim(),
    id_grupo: r.ID_GRUPO == null ? null : Number(r.ID_GRUPO),
    grupo: String(r.GRUPO || '').trim(),
    uni_medida: String(r.UNI_MEDIDA || '').trim(),
    prc_venda: Number(r.PRC_VENDA || 0),
    prc_custo: Number(r.PRC_CUSTO || 0),
    qtd_atual: Number(r.QTD_ATUAL || 0),
    cod_barras: String(r.COD_BARRAS || r.COD_BARRA || '').trim(),
    referencia: String(r.REFERENCIA || '').trim(),
    desc_cmpl: String(r.DESC_CMPL || '').trim(),
    grade_serie: String(r.GRADE_SERIE || 'N').trim().toUpperCase(),
    controla_lote: String(r.CONTROLA_LOTE_VENDA || 'N').trim().toUpperCase() === 'S',
    id_nivel1: r.ID_NIVEL1 == null ? null : Number(r.ID_NIVEL1),
    id_nivel2: r.ID_NIVEL2 == null ? null : Number(r.ID_NIVEL2),
    cor: String(r.COR || '').trim(),
    tamanho: String(r.TAMANHO || '').trim(),
    status: String(r.STATUS || 'A').trim().toUpperCase() === 'I' ? 'I' : 'A',
  };
}

async function findProdutoPorBarras(db, appCfg, code, exceptIdIdentificador) {
  const barra = String(code || '').trim();
  if (!barra) return null;
  for (const target of activeTargets(appCfg)) {
    const t = target.tables;
    if (!hasTable(t.produto)) continue;
    const params = [barra];
    let sql = `SELECT FIRST 1 I.ID_IDENTIFICADOR, E.ID_ESTOQUE, E.DESCRICAO, P.COD_BARRA
       FROM ${t.produto} P
       JOIN ${t.identificador} I ON I.ID_IDENTIFICADOR = P.ID_IDENTIFICADOR
       JOIN ${t.estoque} E ON E.ID_ESTOQUE = I.ID_ESTOQUE
      WHERE TRIM(CAST(P.COD_BARRA AS VARCHAR(60))) = ?`;
    if (exceptIdIdentificador) {
      sql += ' AND I.ID_IDENTIFICADOR <> ?';
      params.push(Number(exceptIdIdentificador));
    }
    const rows = await query(db, sql, params);
    if (!rows.length) continue;
    const r = rows[0];
    return {
      id_identificador: Number(r.ID_IDENTIFICADOR),
      id_estoque: Number(r.ID_ESTOQUE),
      descricao: String(r.DESCRICAO || '').trim(),
      cod_barras: String(r.COD_BARRA || '').trim(),
    };
  }
  return null;
}

function mensagemBarrasDuplicado(item) {
  const nome = item && item.descricao ? ` no produto “${item.descricao}”` : '';
  return `Este código de barras já está cadastrado${nome}.`;
}

async function nextTableId(db, generatorName, tableName, idColumn) {
  if (generatorName) {
    try {
      const rows = await query(db, `SELECT GEN_ID(${generatorName}, 1) AS ID FROM RDB$DATABASE`);
      const id = Number(rows[0].ID);
      if (Number.isFinite(id) && id > 0) return id;
    } catch {
      /* fallback MAX */
    }
  }
  const max = await query(
    db,
    `SELECT COALESCE(MAX(${idColumn}), 0) + 1 AS ID FROM ${tableName}`
  );
  return Number(max[0].ID);
}

router.get('/estoque', async (req, res) => {
  try {
    const busca = String(req.query.q || '').trim();
    const statusFiltro = String(req.query.status || 'A').trim().toUpperCase();
    const data = await withDb(async (db, appCfg) => {
      const targets = activeTargets(appCfg);
      const t = targets[0].tables;
      const where = [];
      const params = [];
      if (busca) {
        const soNumero = /^\d+$/.test(busca);
        const porBarras = String(req.query.barras || '') === '1' || (soNumero && busca.length > 5);
        if (porBarras && busca.length > 5) {
          where.push(`(
            TRIM(CAST(P.COD_BARRA AS VARCHAR(60))) = ?
            OR TRIM(CAST(P.COD_BARRA AS VARCHAR(60))) CONTAINING ?
          )`);
          params.push(busca, busca);
        } else if (soNumero) {
          where.push(`(
            I.ID_IDENTIFICADOR = ?
            OR CAST(I.ID_IDENTIFICADOR AS VARCHAR(20)) STARTING WITH ?
          )`);
          params.push(Number(busca), busca);
        } else {
          where.push(`(
            UPPER(E.DESCRICAO) CONTAINING UPPER(?)
            OR UPPER(P.COD_BARRA) CONTAINING UPPER(?)
            OR UPPER(P.REFERENCIA) CONTAINING UPPER(?)
          )`);
          params.push(busca, busca, busca);
        }
      }
      if (statusFiltro === 'I') {
        where.push(`E.STATUS = 'I'`);
      } else if (statusFiltro === 'ALL' || statusFiltro === '*') {
        /* todos */
      } else {
        where.push(`(E.STATUS = 'A' OR E.STATUS IS NULL)`);
      }
      const orderBy = busca && /^\d+$/.test(busca) && busca.length <= 5
        ? 'I.ID_IDENTIFICADOR ASC'
        : 'E.ID_ESTOQUE DESC, I.ID_IDENTIFICADOR DESC';
      const sql = `
        SELECT FIRST 200
          E.ID_ESTOQUE, I.ID_IDENTIFICADOR, E.DESCRICAO, E.ID_GRUPO,
          G.DESCRICAO AS GRUPO, E.UNI_MEDIDA, E.PRC_VENDA, E.PRC_CUSTO,
          P.QTD_ATUAL, P.COD_BARRA AS COD_BARRAS, P.REFERENCIA, P.DESC_CMPL,
          E.GRADE_SERIE, P.CONTROLA_LOTE_VENDA, P.ID_NIVEL1, P.ID_NIVEL2,
          N1.DESCRICAO AS COR, N2.DESCRICAO AS TAMANHO, E.STATUS
        FROM ${t.estoque} E
        JOIN ${t.identificador} I ON I.ID_ESTOQUE = E.ID_ESTOQUE
        JOIN ${t.produto} P ON P.ID_IDENTIFICADOR = I.ID_IDENTIFICADOR
        LEFT JOIN ${t.grupo} G ON G.ID_GRUPO = E.ID_GRUPO
        LEFT JOIN ${t.nivel1} N1 ON N1.ID_NIVEL1 = P.ID_NIVEL1
        LEFT JOIN ${t.nivel2} N2 ON N2.ID_NIVEL2 = P.ID_NIVEL2
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY ${orderBy}`;
      const rows = await query(db, sql, params);
      return rows.map(mapProdutoRow);
    });
    res.json({ ok: true, itens: data });
  } catch (err) {
    res.json({ ok: false, error: err.message, itens: [] });
  }
});

router.get('/estoque/codigo-barras', async (req, res) => {
  const code = String(req.query.code || '').trim();
  if (!code) return res.json({ ok: true, item: null });
  try {
    const item = await withDb((db, appCfg) => findProdutoPorBarras(db, appCfg, code));
    res.json({ ok: true, item });
  } catch (err) {
    res.json({ ok: false, error: err.message, item: null });
  }
});

router.get('/estoque/:idIdentificador/tributacao', async (req, res) => {
  try {
    const notasMod = require('./importacao-notas');
    const data = await notasMod.getSugestaoTributoEstoque(req.params.idIdentificador);
    res.json({ ok: true, ...data });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.get('/estoque/:idIdentificador', async (req, res) => {
  try {
    const id = Number(req.params.idIdentificador);
    const data = await withDb(async (db, appCfg) => {
      const t = activeTargets(appCfg)[0].tables;
      const rows = await query(
        db,
        `SELECT
          E.ID_ESTOQUE, I.ID_IDENTIFICADOR, E.DESCRICAO, E.ID_GRUPO,
          G.DESCRICAO AS GRUPO, E.UNI_MEDIDA, E.PRC_VENDA, E.PRC_CUSTO,
          P.QTD_ATUAL, P.COD_BARRA AS COD_BARRAS, P.REFERENCIA, P.DESC_CMPL,
          E.GRADE_SERIE, P.CONTROLA_LOTE_VENDA, P.ID_NIVEL1, P.ID_NIVEL2,
          N1.DESCRICAO AS COR, N2.DESCRICAO AS TAMANHO, E.STATUS
        FROM ${t.estoque} E
        JOIN ${t.identificador} I ON I.ID_ESTOQUE = E.ID_ESTOQUE
        JOIN ${t.produto} P ON P.ID_IDENTIFICADOR = I.ID_IDENTIFICADOR
        LEFT JOIN ${t.grupo} G ON G.ID_GRUPO = E.ID_GRUPO
        LEFT JOIN ${t.nivel1} N1 ON N1.ID_NIVEL1 = P.ID_NIVEL1
        LEFT JOIN ${t.nivel2} N2 ON N2.ID_NIVEL2 = P.ID_NIVEL2
        WHERE I.ID_IDENTIFICADOR = ?`,
        [id]
      );
      if (!rows.length) return null;
      const item = mapProdutoRow(rows[0]);
      try {
        const fiscal = await importacaoNotas.getProdutoFiscal(id);
        if (fiscal) {
          item.ncm = fiscal.ncm;
          item.cest = fiscal.cest;
          item.anp = fiscal.anp;
          item.trib_nfe = fiscal.trib_nfe;
          item.trib_nfce = fiscal.trib_nfce;
          item.cfop = fiscal.cfop;
          item.csosn = fiscal.csosn;
        }
      } catch { /* ignore */ }
      item.lotes = [];
      item.seriais = [];
      if (item.controla_lote) {
        item.lotes = (await query(
          db,
          `SELECT ID_LOTE, NUM_LOTE, DT_VALIDAD, DT_FABRICACAO, QTD_ATUAL
           FROM ${t.lote} WHERE ID_IDENTIFICADOR = ? ORDER BY DT_VALIDAD`,
          [id]
        )).map((l) => ({
          id_lote: Number(l.ID_LOTE),
          num_lote: String(l.NUM_LOTE || '').trim(),
          dt_validade: l.DT_VALIDAD,
          dt_fabricacao: l.DT_FABRICACAO,
          qtd_atual: Number(l.QTD_ATUAL || 0),
        }));
      }
      if (item.grade_serie === 'S') {
        item.seriais = (await query(
          db,
          `SELECT ID_SERIAL, NUM_SERIAL, STATUS
           FROM ${t.serial} WHERE ID_IDENTIFICADOR = ? ORDER BY NUM_SERIAL`,
          [id]
        )).map((s) => ({
          id_serial: Number(s.ID_SERIAL),
          num_serial: String(s.NUM_SERIAL || '').trim(),
          status: String(s.STATUS || 'A').trim(),
        }));
      }
      return item;
    });
    if (!data) return res.json({ ok: false, error: 'Produto não encontrado.' });
    res.json({ ok: true, item: data });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.get('/grupos', async (_req, res) => {
  try {
    const data = await withDb(async (db, appCfg) => {
      const t = activeTargets(appCfg)[0].tables;
      const rows = await query(db, `SELECT ID_GRUPO, DESCRICAO FROM ${t.grupo} ORDER BY DESCRICAO`);
      return rows.map((r) => ({ id_grupo: Number(r.ID_GRUPO), descricao: String(r.DESCRICAO || '').trim() }));
    });
    res.json({ ok: true, grupos: data });
  } catch (err) {
    res.json({ ok: false, error: err.message, grupos: [] });
  }
});

router.get('/unidades', async (_req, res) => {
  try {
    const data = await withDb(async (db) => {
      const rows = await query(
        db,
        `SELECT UNIDADE, DESCRICAO
         FROM TB_UNI_MEDIDA
         WHERE STATUS = 'A' OR STATUS IS NULL
         ORDER BY DESCRICAO`
      );
      return rows.map((r) => ({
        unidade: String(r.UNIDADE || '').trim(),
        descricao: String(r.DESCRICAO || '').trim(),
      }));
    });
    res.json({ ok: true, unidades: data });
  } catch (err) {
    res.json({ ok: false, error: err.message, unidades: [] });
  }
});

router.post('/estoque', async (req, res) => {
  try {
    const body = req.body || {};
    const descricao = String(body.descricao || '').trim();
    if (!descricao) return res.json({ ok: false, error: 'Informe a descrição do produto.' });
    const uni = String(body.uni_medida || 'UN').trim() || 'UN';
    const prcVenda = Number(body.prc_venda != null ? body.prc_venda : 0.01) || 0.01;
    const prcCusto = body.prc_custo != null && body.prc_custo !== '' ? Number(body.prc_custo) : null;
    const qtd = Number(body.qtd_atual != null ? body.qtd_atual : 0) || 0;
    const idGrupo = body.id_grupo === '' || body.id_grupo == null ? null : Number(body.id_grupo);
    const codBarras = String(body.cod_barras || '').trim();
    const referencia = String(body.referencia || '').trim();
    const descCmpl = String(body.desc_cmpl || '').trim();
    const gradeSerie = String(body.grade_serie || 'N').trim().toUpperCase() || 'N';
    const usuarioNome = String(body.usuarioNome || 'usuário').trim();
    const idFuncionario = Number(body.idFuncionario || 0);

    const created = await withDb(async (db, appCfg) => {
      if (codBarras) {
        const dup = await findProdutoPorBarras(db, appCfg, codBarras);
        if (dup) throw new Error(mensagemBarrasDuplicado(dup));
      }
      const targets = activeTargets(appCfg);
      // IDs separados: em grade vários identificadores compartilham o mesmo ID_ESTOQUE
      const tPrimary = targets[0].tables;
      const idEstoque = await nextTableId(db, tPrimary.genEstoque, tPrimary.estoque, 'ID_ESTOQUE');
      const idIdentificador = await nextTableId(
        db,
        tPrimary.genIdentificador,
        tPrimary.identificador,
        'ID_IDENTIFICADOR'
      );

      let first = null;
      for (const target of targets) {
        const t = target.tables;
        await query(
          db,
          `INSERT INTO ${t.estoque}
            (ID_ESTOQUE, DESCRICAO, STATUS, ID_GRUPO, UNI_MEDIDA, PRC_VENDA, PRC_CUSTO, GRADE_SERIE, ID_TIPOITEM, FRACIONADO)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, '0', 'N')`,
          [
            idEstoque,
            descricao,
            String(body.status || 'A').trim().toUpperCase() === 'I' ? 'I' : 'A',
            idGrupo,
            uni,
            prcVenda,
            prcCusto,
            gradeSerie,
          ]
        );
        await query(
          db,
          `INSERT INTO ${t.identificador} (ID_IDENTIFICADOR, ID_ESTOQUE) VALUES (?, ?)`,
          [idIdentificador, idEstoque]
        );
        await query(
          db,
          `INSERT INTO ${t.produto}
            (ID_IDENTIFICADOR, QTD_ATUAL, COD_BARRA, REFERENCIA, DESC_CMPL, CONTROLA_LOTE_VENDA, STATUS)
           VALUES (?, ?, ?, ?, ?, 'N', 'A')`,
          [idIdentificador, qtd, codBarras || null, referencia || null, descCmpl || null]
        );
        if (!first) first = { id_estoque: idEstoque, id_identificador: idIdentificador };
      }
      if (first) {
        try {
          await logProductCreate(db, {
            id_identificador: first.id_identificador,
            id_estoque: first.id_estoque,
            descricao,
            id_funcionario: idFuncionario,
            usuario: usuarioNome,
            detalhe: [
              `Descrição: ${descricao}`,
              `Unidade: ${uni}`,
              `Venda: ${prcVenda}`,
              prcCusto != null ? `Custo: ${prcCusto}` : null,
              `Qtd: ${qtd}`,
              codBarras ? `Barras: ${codBarras}` : null,
              `Estoque #${idEstoque} / Ident. #${idIdentificador}`,
            ].filter(Boolean).join(' | '),
          });
        } catch (e) {
          console.warn('Falha ao auditar cadastro:', e.message);
        }
      }
      return first;
    });

    res.json({ ok: true, item: created });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.post('/grupos', async (req, res) => {
  try {
    const descricao = String((req.body && req.body.descricao) || '').trim();
    if (!descricao) return res.json({ ok: false, error: 'Informe a descrição do grupo.' });
    const grupo = await withDb(async (db, appCfg) => {
      const targets = activeTargets(appCfg);
      let created = null;
      for (const target of targets) {
        const t = target.tables;
        if (!hasTable(t.grupo.replace(/_2$/, '')) && target.manage) continue;
        if (!hasTable(t.grupo) && target.manage) continue;
        const genRows = await query(db, `SELECT GEN_ID(${t.genGrupo}, 1) AS ID FROM RDB$DATABASE`);
        const id = Number(genRows[0].ID);
        await query(db, `INSERT INTO ${t.grupo} (ID_GRUPO, DESCRICAO) VALUES (?, ?)`, [id, descricao]);
        created = { id_grupo: id, descricao };
      }
      return created;
    });
    res.json({ ok: true, grupo });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.put('/estoque/:idIdentificador', async (req, res) => {
  try {
    const id = Number(req.params.idIdentificador);
    const body = req.body || {};
    const usuarioNome = String(body.usuarioNome || 'usuário').trim();
    const idFuncionario = Number(body.idFuncionario || 0);
    const result = await withDb(async (db, appCfg) => {
      const barra = body.cod_barras !== undefined ? String(body.cod_barras || '').trim() : '';
      if (barra) {
        const dup = await findProdutoPorBarras(db, appCfg, barra, id);
        if (dup) throw new Error(mensagemBarrasDuplicado(dup));
      }
      const targets = activeTargets(appCfg);
      let updated = null;
      let snapshotAntes = null;
      let snapshotDepois = null;

      for (const target of targets) {
        const t = target.tables;
        const cur = await query(
          db,
          `SELECT E.ID_ESTOQUE, E.DESCRICAO, E.ID_GRUPO, E.UNI_MEDIDA, E.PRC_VENDA, E.PRC_CUSTO,
                  E.GRADE_SERIE, E.STATUS, P.QTD_ATUAL, P.PRC_MEDIO, P.COD_BARRA, P.REFERENCIA, P.DESC_CMPL,
                  P.CONTROLA_LOTE_VENDA, P.ID_NIVEL1, P.ID_NIVEL2
           FROM ${t.estoque} E
           JOIN ${t.identificador} I ON I.ID_ESTOQUE = E.ID_ESTOQUE
           JOIN ${t.produto} P ON P.ID_IDENTIFICADOR = I.ID_IDENTIFICADOR
           WHERE I.ID_IDENTIFICADOR = ?`,
          [id]
        );
        if (!cur.length) continue;
        const row = cur[0];
        const idEstoque = Number(row.ID_ESTOQUE);
        const qtdAntiga = Number(row.QTD_ATUAL || 0);
        const prcMedio = Number(row.PRC_MEDIO || row.PRC_CUSTO || 0);
        const statusAtual = String(row.STATUS || 'A').trim().toUpperCase() === 'I' ? 'I' : 'A';

        const antes = {
          descricao: String(row.DESCRICAO || '').trim(),
          id_grupo: row.ID_GRUPO == null ? null : Number(row.ID_GRUPO),
          uni_medida: String(row.UNI_MEDIDA || '').trim(),
          prc_venda: Number(row.PRC_VENDA || 0),
          prc_custo: Number(row.PRC_CUSTO || 0),
          grade_serie: String(row.GRADE_SERIE || 'N').trim().toUpperCase(),
          status: statusAtual,
          qtd_atual: qtdAntiga,
          cod_barras: String(row.COD_BARRA || '').trim(),
          referencia: String(row.REFERENCIA || '').trim(),
          desc_cmpl: String(row.DESC_CMPL || '').trim(),
          controla_lote: String(row.CONTROLA_LOTE_VENDA || 'N').trim().toUpperCase() === 'S',
          id_nivel1: row.ID_NIVEL1 == null ? null : Number(row.ID_NIVEL1),
          id_nivel2: row.ID_NIVEL2 == null ? null : Number(row.ID_NIVEL2),
        };
        if (!snapshotAntes) snapshotAntes = { ...antes, id_estoque: idEstoque };

        const estSets = [];
        const estParams = [];
        if (body.descricao !== undefined) { estSets.push('DESCRICAO = ?'); estParams.push(String(body.descricao)); }
        if (body.id_grupo !== undefined) {
          estSets.push('ID_GRUPO = ?');
          estParams.push(body.id_grupo === null || body.id_grupo === '' ? null : Number(body.id_grupo));
        }
        if (body.uni_medida !== undefined) { estSets.push('UNI_MEDIDA = ?'); estParams.push(String(body.uni_medida)); }
        if (body.cfop !== undefined) { estSets.push('CFOP = ?'); estParams.push(String(body.cfop || '').trim() || null); }
        if (body.cfop_nf !== undefined) { estSets.push('CFOP_NF = ?'); estParams.push(String(body.cfop_nf || '').trim() || null); }
        if (body.cst_pis !== undefined) { estSets.push('CST_PIS = ?'); estParams.push(String(body.cst_pis || '').trim() || null); }
        if (body.cst_cofins !== undefined) { estSets.push('CST_COFINS = ?'); estParams.push(String(body.cst_cofins || '').trim() || null); }
        if (body.pis !== undefined) { estSets.push('PIS = ?'); estParams.push(Number(body.pis || 0)); }
        if (body.cofins !== undefined) { estSets.push('COFINS = ?'); estParams.push(Number(body.cofins || 0)); }
        if (body.id_cti !== undefined) { estSets.push('ID_CTI = ?'); estParams.push(String(body.id_cti || '').trim() || null); }
        if (body.id_cti_cfe !== undefined) { estSets.push('ID_CTI_CFE = ?'); estParams.push(String(body.id_cti_cfe || '').trim() || null); }
        if (body.prc_venda !== undefined) { estSets.push('PRC_VENDA = ?'); estParams.push(Number(body.prc_venda)); }
        if (body.prc_custo !== undefined) { estSets.push('PRC_CUSTO = ?'); estParams.push(Number(body.prc_custo)); }
        if (body.grade_serie !== undefined) { estSets.push('GRADE_SERIE = ?'); estParams.push(String(body.grade_serie)); }
        let statusNovo = null;
        if (body.status !== undefined) {
          statusNovo = String(body.status).trim().toUpperCase() === 'I' ? 'I' : 'A';
          estSets.push('STATUS = ?');
          estParams.push(statusNovo);
        }
        if (estSets.length) {
          estParams.push(idEstoque);
          await query(db, `UPDATE ${t.estoque} SET ${estSets.join(', ')} WHERE ID_ESTOQUE = ?`, estParams);
        }

        const prodSets = [];
        const prodParams = [];
        if (body.cod_barras !== undefined) { prodSets.push('COD_BARRA = ?'); prodParams.push(String(body.cod_barras)); }
        if (body.referencia !== undefined) { prodSets.push('REFERENCIA = ?'); prodParams.push(String(body.referencia)); }
        if (body.desc_cmpl !== undefined) { prodSets.push('DESC_CMPL = ?'); prodParams.push(String(body.desc_cmpl)); }
        if (body.cst !== undefined) { prodSets.push('CST = ?'); prodParams.push(String(body.cst || '').trim() || null); }
        if (body.csosn !== undefined) { prodSets.push('CSOSN = ?'); prodParams.push(String(body.csosn || '').trim() || null); }
        if (body.cst_cfe !== undefined) { prodSets.push('CST_CFE = ?'); prodParams.push(String(body.cst_cfe || '').trim() || null); }
        if (body.csosn_cfe !== undefined) { prodSets.push('CSOSN_CFE = ?'); prodParams.push(String(body.csosn_cfe || '').trim() || null); }
        if (body.ncm !== undefined) { prodSets.push('COD_NCM = ?'); prodParams.push(String(body.ncm || '').replace(/\D/g, '').slice(0, 8) || null); }
        if (body.cest !== undefined) { prodSets.push('COD_CEST = ?'); prodParams.push(String(body.cest || '').replace(/\D/g, '').slice(0, 7) || null); }
        if (body.id_nivel1 !== undefined) {
          prodSets.push('ID_NIVEL1 = ?');
          prodParams.push(body.id_nivel1 === '' || body.id_nivel1 == null ? null : Number(body.id_nivel1));
        }
        if (body.id_nivel2 !== undefined) {
          prodSets.push('ID_NIVEL2 = ?');
          prodParams.push(body.id_nivel2 === '' || body.id_nivel2 == null ? null : Number(body.id_nivel2));
        }
        if (body.controla_lote !== undefined) {
          prodSets.push('CONTROLA_LOTE_VENDA = ?');
          prodParams.push(body.controla_lote ? 'S' : 'N');
        }
        const novaQtd = body.qtd_atual !== undefined ? Number(body.qtd_atual) : null;
        if (novaQtd !== null) { prodSets.push('QTD_ATUAL = ?'); prodParams.push(novaQtd); }
        if (prodSets.length) {
          prodParams.push(id);
          await query(db, `UPDATE ${t.produto} SET ${prodSets.join(', ')} WHERE ID_IDENTIFICADOR = ?`, prodParams);
        }

        if (novaQtd !== null && novaQtd !== qtdAntiga && hasTable(t.saldo)) {
          let nextId;
          try {
            const gen = await query(db, `SELECT GEN_ID(${t.genSaldo}, 1) AS ID FROM RDB$DATABASE`);
            nextId = Number(gen[0].ID);
          } catch {
            const max = await query(db, `SELECT COALESCE(MAX(ID),0)+1 AS ID FROM ${t.saldo}`);
            nextId = Number(max[0].ID);
          }
          const obs = `Alterado via painel - ${usuarioNome}`;
          const agora = localNow();
          try {
            await query(
              db,
              `INSERT INTO ${t.saldo}
                (ID, DATA, ID_IDENTIFICADOR, SALDO_ANTIGO, SALDO_NOVO, PRC_MEDIO, HORA, ID_FUNCIONARIO, OBSERVACAO)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [nextId, agora.dataSql, id, qtdAntiga, novaQtd, prcMedio, agora.horaSql, idFuncionario || 0, obs]
            );
          } catch (e) {
            if (String(e.message || '').includes('OBSERVACAO')) {
              await query(
                db,
                `INSERT INTO ${t.saldo}
                  (ID, DATA, ID_IDENTIFICADOR, SALDO_ANTIGO, SALDO_NOVO, PRC_MEDIO, HORA, ID_FUNCIONARIO)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [nextId, agora.dataSql, id, qtdAntiga, novaQtd, prcMedio, agora.horaSql, idFuncionario || 0]
              );
            } else throw e;
          }
        }

        if (!snapshotDepois) {
          snapshotDepois = {
            ...antes,
            ...(body.descricao !== undefined ? { descricao: String(body.descricao) } : {}),
            ...(body.id_grupo !== undefined ? { id_grupo: body.id_grupo === null || body.id_grupo === '' ? null : Number(body.id_grupo) } : {}),
            ...(body.uni_medida !== undefined ? { uni_medida: String(body.uni_medida) } : {}),
            ...(body.prc_venda !== undefined ? { prc_venda: Number(body.prc_venda) } : {}),
            ...(body.prc_custo !== undefined ? { prc_custo: Number(body.prc_custo) } : {}),
            ...(body.grade_serie !== undefined ? { grade_serie: String(body.grade_serie) } : {}),
            ...(body.cod_barras !== undefined ? { cod_barras: String(body.cod_barras) } : {}),
            ...(body.referencia !== undefined ? { referencia: String(body.referencia) } : {}),
            ...(body.desc_cmpl !== undefined ? { desc_cmpl: String(body.desc_cmpl) } : {}),
            ...(body.id_nivel1 !== undefined ? { id_nivel1: body.id_nivel1 === '' || body.id_nivel1 == null ? null : Number(body.id_nivel1) } : {}),
            ...(body.id_nivel2 !== undefined ? { id_nivel2: body.id_nivel2 === '' || body.id_nivel2 == null ? null : Number(body.id_nivel2) } : {}),
            ...(body.controla_lote !== undefined ? { controla_lote: !!body.controla_lote } : {}),
            ...(statusNovo != null ? { status: statusNovo } : {}),
            ...(novaQtd !== null ? { qtd_atual: novaQtd } : {}),
          };
        }

        updated = { id_identificador: id, id_estoque: idEstoque };
      }

      if (updated && (body.trib_nfe || body.trib_nfce)) {
        try {
          const { upsertEstTributosReforma } = require('./importacao-gravar');
          await upsertEstTributosReforma(db, id, {
            trib_nfe: body.trib_nfe || {},
            trib_nfce: body.trib_nfce || {},
          });
        } catch (e) {
          console.warn('Reforma tributária (cadastro):', e.message);
        }
      }

      if (updated && snapshotAntes && snapshotDepois) {
        try {
          await logProductChanges(db, {
            antes: snapshotAntes,
            depois: snapshotDepois,
            id_identificador: updated.id_identificador,
            id_estoque: updated.id_estoque,
            id_funcionario: idFuncionario,
            usuario: usuarioNome,
          });
        } catch (e) {
          console.warn('Falha ao auditar alteração:', e.message);
        }
      }
      return updated;
    });
    if (!result) return res.json({ ok: false, error: 'Produto não encontrado nas tabelas do modo configurado.' });
    res.json({ ok: true, item: result });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

function mapSaldoAlteracao(r) {
  const antigo = Number(r.SALDO_ANTIGO || 0);
  const novo = Number(r.SALDO_NOVO || 0);
  const parts = mapExtractParts(r);
  return {
    id: `q-${Number(r.ID)}`,
    origem: 'saldo',
    tipo: 'quantidade',
    data: r.DATA,
    hora: r.HORA,
    data_hora: formatBrDateTime(r.DATA, r.HORA, parts),
    id_identificador: Number(r.ID_IDENTIFICADOR),
    id_estoque: Number(r.ID_ESTOQUE),
    descricao: String(r.DESCRICAO || '').trim(),
    uni_medida: String(r.UNI_MEDIDA || '').trim(),
    cod_barras: String(r.COD_BARRAS || '').trim(),
    saldo_antigo: antigo,
    saldo_novo: novo,
    diferenca: novo - antigo,
    resumo: 'Quantidade',
    detalhe: `${antigo} → ${novo}`,
    id_funcionario: Number(r.ID_FUNCIONARIO || 0),
    funcionario: String(r.FUNCIONARIO || '').trim() || (Number(r.ID_FUNCIONARIO) === 0 ? 'SUPERVISOR' : '—'),
    observacao: String(r.OBSERVACAO || '').trim(),
  };
}

function mapGestorAlteracao(r) {
  const parts = mapExtractParts(r);
  return {
    id: `g-${Number(r.ID)}`,
    origem: 'gestor',
    tipo: String(r.TIPO || 'ficha').trim().toLowerCase(),
    data: r.DATA,
    hora: r.HORA,
    data_hora: formatBrDateTime(r.DATA, r.HORA, parts),
    id_identificador: Number(r.ID_IDENTIFICADOR),
    id_estoque: Number(r.ID_ESTOQUE),
    descricao: String(r.DESCRICAO || '').trim(),
    uni_medida: String(r.UNI_MEDIDA || '').trim(),
    cod_barras: String(r.COD_BARRAS || '').trim(),
    saldo_antigo: null,
    saldo_novo: null,
    diferenca: null,
    resumo: String(r.RESUMO || '').trim(),
    detalhe: String(r.DETALHE || '').trim(),
    id_funcionario: Number(r.ID_FUNCIONARIO || 0),
    funcionario: String(r.FUNCIONARIO || r.USUARIO || '').trim() || (Number(r.ID_FUNCIONARIO) === 0 ? 'SUPERVISOR' : '—'),
    observacao: String(r.OBSERVACAO || '').trim(),
  };
}

router.get('/alteracoes', async (req, res) => {
  try {
    const idUsuario = Number(req.query.idUsuario || 0);
    const supervisor = String(req.query.supervisor || '') === '1' || String(req.query.supervisor || '') === 'true';
    const todos = supervisor && (String(req.query.todos || '') === '1' || String(req.query.todos || '') === 'true');
    const dias = Math.min(365, Math.max(1, Number(req.query.dias) || 30));
    const busca = String(req.query.q || '').trim();
    const tipo = String(req.query.tipo || 'todos').trim().toLowerCase();

    const data = await withDb(async (db, appCfg) => {
      const t = activeTargets(appCfg)[0].tables;
      const itens = [];

      const wantQty = tipo === 'todos' || tipo === 'quantidade';
      const wantGestor = tipo === 'todos' || ['ficha', 'precos', 'cadastro'].includes(tipo);
      const wantNotas = tipo === 'todos' || tipo === 'notas';

      if (wantQty && hasTable(t.saldo)) {
        const hasObs = await columnExists(db, t.saldo, 'OBSERVACAO');
        const where = [`S.DATA >= DATEADD(-${dias} DAY TO CURRENT_DATE)`];
        const params = [];
        if (!todos) {
          where.push('S.ID_FUNCIONARIO = ?');
          params.push(idUsuario || 0);
        }
        if (busca) {
          where.push(`(
            UPPER(E.DESCRICAO) CONTAINING UPPER(?)
            OR UPPER(COALESCE(F.NOME, '')) CONTAINING UPPER(?)
            OR CAST(E.ID_ESTOQUE AS VARCHAR(20)) CONTAINING ?
            ${hasObs ? 'OR UPPER(COALESCE(S.OBSERVACAO, \'\')) CONTAINING UPPER(?)' : ''}
          )`);
          params.push(busca, busca, busca);
          if (hasObs) params.push(busca);
        }
        const obsSelect = hasObs ? 'S.OBSERVACAO' : `CAST(NULL AS VARCHAR(200)) AS OBSERVACAO`;
        const extract = sqlExtractDataHora('S.DATA', 'S.HORA');
        const rows = await query(
          db,
          `SELECT FIRST 400
            S.ID, S.DATA, S.HORA, S.ID_IDENTIFICADOR,
            S.SALDO_ANTIGO, S.SALDO_NOVO, S.ID_FUNCIONARIO,
            ${obsSelect},
            ${extract},
            E.ID_ESTOQUE, E.DESCRICAO, E.UNI_MEDIDA,
            P.COD_BARRA AS COD_BARRAS,
            F.NOME AS FUNCIONARIO
          FROM ${t.saldo} S
          JOIN ${t.identificador} I ON I.ID_IDENTIFICADOR = S.ID_IDENTIFICADOR
          JOIN ${t.estoque} E ON E.ID_ESTOQUE = I.ID_ESTOQUE
          JOIN ${t.produto} P ON P.ID_IDENTIFICADOR = I.ID_IDENTIFICADOR
          LEFT JOIN TB_FUNCIONARIO F ON F.ID_FUNCIONARIO = S.ID_FUNCIONARIO
          WHERE ${where.join(' AND ')}
          ORDER BY S.DATA DESC, S.HORA DESC, S.ID DESC`,
          params
        );
        itens.push(...rows.map(mapSaldoAlteracao));
      }

      if (wantGestor) {
        try {
          if (!hasAuditTable()) await ensureAuditSchema(db);
        } catch { /* ignore */ }
        if (hasAuditTable()) {
          const where = [`A.DATA >= DATEADD(-${dias} DAY TO CURRENT_DATE)`];
          const params = [];
          if (tipo !== 'todos') {
            where.push('A.TIPO = ?');
            params.push(tipo);
          }
          if (!todos) {
            where.push('A.ID_FUNCIONARIO = ?');
            params.push(idUsuario || 0);
          }
          if (busca) {
            where.push(`(
              UPPER(COALESCE(E.DESCRICAO, '')) CONTAINING UPPER(?)
              OR UPPER(COALESCE(A.USUARIO, '')) CONTAINING UPPER(?)
              OR UPPER(COALESCE(A.RESUMO, '')) CONTAINING UPPER(?)
              OR UPPER(COALESCE(A.DETALHE, '')) CONTAINING UPPER(?)
              OR CAST(A.ID_ESTOQUE AS VARCHAR(20)) CONTAINING ?
            )`);
            params.push(busca, busca, busca, busca, busca);
          }
          const extract = sqlExtractDataHora('A.DATA', 'A.HORA');
          const rows = await query(
            db,
            `SELECT FIRST 400
              A.ID, A.DATA, A.HORA, A.ID_IDENTIFICADOR, A.ID_ESTOQUE,
              A.TIPO, A.RESUMO, A.DETALHE, A.ID_FUNCIONARIO, A.USUARIO, A.OBSERVACAO,
              ${extract},
              E.DESCRICAO, E.UNI_MEDIDA, P.COD_BARRA AS COD_BARRAS,
              F.NOME AS FUNCIONARIO
            FROM ${AUDIT_TABLE} A
            LEFT JOIN ${t.identificador} I ON I.ID_IDENTIFICADOR = A.ID_IDENTIFICADOR
            LEFT JOIN ${t.estoque} E ON E.ID_ESTOQUE = COALESCE(I.ID_ESTOQUE, A.ID_ESTOQUE)
            LEFT JOIN ${t.produto} P ON P.ID_IDENTIFICADOR = A.ID_IDENTIFICADOR
            LEFT JOIN TB_FUNCIONARIO F ON F.ID_FUNCIONARIO = A.ID_FUNCIONARIO
            WHERE ${where.join(' AND ')}
            ORDER BY A.DATA DESC, A.HORA DESC, A.ID DESC`,
            params
          );
          itens.push(...rows.map(mapGestorAlteracao));
        }
      }

      if (wantNotas) {
        try {
          const nfRows = await query(db, `
            SELECT FIRST 200
              N.ID_NFCOMPRA, N.NF_NUMERO, N.NF_SERIE, N.DT_ENTRADA, N.DT_EMISSAO, N.STATUS,
              F.NOME_FANTA AS FORNEC_FANTA, F.NOME AS FORNEC_NOME
            FROM TB_NFCOMPRA N
            LEFT JOIN TB_FORNECEDOR F ON F.ID_FORNEC = N.ID_FORNEC
            WHERE N.DT_ENTRADA >= DATEADD(-${dias} DAY TO CURRENT_DATE)
              AND UPPER(TRIM(COALESCE(N.STATUS, ''))) <> 'C'
            ORDER BY N.DT_ENTRADA DESC, N.ID_NFCOMPRA DESC`);
          itens.push(...nfRows.map((r) => ({
            id: `nf-${Number(r.ID_NFCOMPRA)}`,
            origem: 'nota',
            tipo: 'notas',
            data: r.DT_ENTRADA,
            hora: null,
            data_hora: null,
            id_identificador: null,
            id_estoque: Number(r.ID_NFCOMPRA),
            descricao: `NF ${r.NF_NUMERO}/${String(r.NF_SERIE || '').trim()}`,
            uni_medida: '',
            cod_barras: '',
            saldo_antigo: null,
            saldo_novo: null,
            diferenca: null,
            resumo: String(r.FORNEC_FANTA || r.FORNEC_NOME || '').trim() || 'Nota lançada',
            detalhe: `Emissão ${r.DT_EMISSAO || '—'} · status ${String(r.STATUS || '').trim() || '—'}`,
            id_funcionario: 0,
            funcionario: '—',
            observacao: '',
          })));
        } catch (e) {
          console.warn('Alterações notas lançadas:', e.message);
        }
      }

      itens.sort((a, b) => {
        const da = new Date(a.data || 0).getTime();
        const db_ = new Date(b.data || 0).getTime();
        if (db_ !== da) return db_ - da;
        return String(b.hora || '').localeCompare(String(a.hora || ''));
      });
      return itens.slice(0, 400);
    });

    res.json({ ok: true, itens: data, dias, tipo, escopo: todos ? 'todos' : 'usuario' });
  } catch (err) {
    res.json({ ok: false, error: err.message, itens: [] });
  }
});

router.get('/niveis', async (_req, res) => {
  try {
    const data = await withDb(async (db, appCfg) => {
      const t = activeTargets(appCfg)[0].tables;
      const nivel1 = (await query(db, `SELECT ID_NIVEL1, DESCRICAO FROM ${t.nivel1} ORDER BY DESCRICAO`))
        .map((r) => ({ id: Number(r.ID_NIVEL1), descricao: String(r.DESCRICAO || '').trim() }));
      const nivel2 = (await query(db, `SELECT ID_NIVEL2, DESCRICAO FROM ${t.nivel2} ORDER BY DESCRICAO`))
        .map((r) => ({ id: Number(r.ID_NIVEL2), descricao: String(r.DESCRICAO || '').trim() }));
      return { nivel1, nivel2 };
    });
    res.json({ ok: true, ...data });
  } catch (err) {
    res.json({ ok: false, error: err.message, nivel1: [], nivel2: [] });
  }
});

const importacaoStaging = require('./importacao-staging');
const importacaoFornecedor = require('./importacao-fornecedor');
const importacaoParams = require('./importacao-params');
const importacaoNotas = require('./importacao-notas');

function importacaoSupervisorOk(req) {
  const q = req.query?.supervisor;
  const b = req.body?.supervisor;
  return q === '1' || q === 'true' || q === true || b === true || b === '1' || b === 'true';
}

function guardImportacaoSupervisor(req, res) {
  if (importacaoSupervisorOk(req)) return true;
  const uid = Number(req.query?.usuarioId ?? req.body?.usuarioId);
  if (Number.isFinite(uid)) {
    try {
      const users = loadUsersConfig(loadAppConfig());
      const u = (users.usuarios || []).find((x) => Number(x.id) === uid);
      if (u?.supervisor || u?.permissoes?.importacao?.acesso) return true;
    } catch { /* ignore */ }
  }
  res.json({ ok: false, error: 'Sem permissão para notas de entrada.' });
  return false;
}

router.get('/importacao/sessoes', (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    res.json({ ok: true, sessoes: importacaoStaging.listSessoes() });
  } catch (err) {
    res.json({ ok: false, error: err.message, sessoes: [] });
  }
});

router.get('/importacao/notas', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    const notas = await importacaoNotas.listNotasCadastradas({
      de: req.query.de,
      ate: req.query.ate,
      nfNumero: req.query.nf || req.query.nnf || req.query.numero,
      fornecedor: req.query.fornecedor || req.query.forn || '',
      dataCampo: req.query.data_campo || req.query.dataCampo || 'entrada',
    });
    let sessoes = importacaoStaging.listSessoes();
    const nnf = String(req.query.nf || req.query.nnf || req.query.numero || '').replace(/\D/g, '');
    const fornQ = String(req.query.fornecedor || req.query.forn || '').trim().toLowerCase();
    if (nnf) {
      sessoes = sessoes.filter((s) => String(s.xml?.ide?.nNF || '').includes(nnf));
    }
    if (fornQ) {
      sessoes = sessoes.filter((s) => {
        const nome = `${s.xml?.emit?.xFant || ''} ${s.xml?.emit?.xNome || ''} ${s.fornecedor?.cadastro?.nome_fanta || ''} ${s.fornecedor?.cadastro?.nome || ''}`.toLowerCase();
        return nome.includes(fornQ);
      });
    }
    const de = String(req.query.de || '').slice(0, 10);
    const ate = String(req.query.ate || '').slice(0, 10);
    if (!nnf && de && ate) {
      sessoes = sessoes.filter((s) => {
        const d = String(s.xml?.ide?.dhEmi || s.createdAt || '').slice(0, 10);
        return d >= de && d <= ate;
      });
    }
    const confirmadas = importacaoStaging.listSessoesConfirmadas();
    res.json({ ok: true, notas, sessoes, confirmadas });
  } catch (err) {
    res.json({ ok: false, error: err.message, notas: [], sessoes: [] });
  }
});

router.get('/importacao/formas-pagto', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    res.json({ ok: true, itens: await importacaoNotas.listFormasPagto() });
  } catch (err) {
    res.json({ ok: false, error: err.message, itens: [] });
  }
});

router.get('/importacao/parcelamentos', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    res.json({
      ok: true,
      itens: await importacaoNotas.listParcelamentos(req.query.id_fmapgto || req.query.idFmapgto),
    });
  } catch (err) {
    res.json({ ok: false, error: err.message, itens: [] });
  }
});

router.get('/importacao/nf-duplicada', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    const dup = await importacaoNotas.findNfDuplicada({
      chave: req.query.chave,
      nfNumero: req.query.nf || req.query.nnf,
      serie: req.query.serie,
      idFornec: req.query.id_fornec,
      cnpj: req.query.cnpj,
    });
    res.json({ ok: true, duplicada: !!dup, nota: dup || null });
  } catch (err) {
    res.json({ ok: false, error: err.message, duplicada: false, nota: null });
  }
});

router.get('/importacao/params/cfop', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    const itens = await importacaoParams.listCfopConv();
    res.json({
      ok: true,
      itens,
      csosn_padrao: importacaoParams.getCsosnPadrao(),
      saida: importacaoParams.getSaidaPadrao(),
      conversoes: importacaoParams.listConversoes(),
    });
  } catch (err) {
    res.json({ ok: false, error: err.message, itens: [], csosn_padrao: '102', saida: null });
  }
});

router.put('/importacao/params/cfop', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    const itens = await importacaoParams.saveCfopConv(req.body?.itens || []);
    const csosn = importacaoParams.setCsosnPadrao(req.body?.csosn_padrao);
    const saida = req.body?.saida != null
      ? importacaoParams.setSaidaPadrao(req.body.saida)
      : importacaoParams.getSaidaPadrao();
    const conversoes = req.body?.conversoes != null
      ? importacaoParams.saveConversoes(req.body.conversoes)
      : importacaoParams.listConversoes();
    res.json({ ok: true, itens, csosn_padrao: csosn, saida, conversoes });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.get('/importacao/unidades', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    res.json({ ok: true, itens: await importacaoNotas.listUnidades(req.query.q) });
  } catch (err) {
    res.json({ ok: false, error: err.message, itens: [] });
  }
});

router.post('/importacao/unidades', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    const item = await importacaoNotas.cadastrarUnidade(req.body || {});
    res.json({ ok: true, item });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.get('/importacao/naturezas', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    res.json({ ok: true, itens: await importacaoNotas.listNaturezas(req.query.q) });
  } catch (err) {
    res.json({ ok: false, error: err.message, itens: [] });
  }
});

router.get('/importacao/class-trib', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    res.json({ ok: true, itens: await importacaoNotas.listClassTrib(req.query.q, req.query.id) });
  } catch (err) {
    res.json({ ok: false, error: err.message, itens: [] });
  }
});

router.get('/importacao/cst-icms', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    res.json({ ok: true, itens: await importacaoNotas.listCstIcms(req.query.q) });
  } catch (err) {
    res.json({ ok: false, error: err.message, itens: [] });
  }
});

router.get('/importacao/csosn', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    res.json({ ok: true, itens: await importacaoNotas.listCsosn(req.query.q) });
  } catch (err) {
    res.json({ ok: false, error: err.message, itens: [] });
  }
});

router.get('/importacao/anp', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    res.json({ ok: true, itens: await importacaoNotas.listAnp(req.query.q) });
  } catch (err) {
    res.json({ ok: false, error: err.message, itens: [] });
  }
});

router.get('/importacao/cest', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    res.json({
      ok: true,
      itens: await importacaoNotas.listCest(req.query.q, req.query.ncm),
    });
  } catch (err) {
    res.json({ ok: false, error: err.message, itens: [] });
  }
});

router.get('/importacao/taxa-uf', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    res.json({ ok: true, itens: await importacaoNotas.listTaxaUf(req.query.q) });
  } catch (err) {
    res.json({ ok: false, error: err.message, itens: [] });
  }
});

router.get('/importacao/cfop', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    res.json({ ok: true, itens: await importacaoNotas.listCfopSis(req.query.q) });
  } catch (err) {
    res.json({ ok: false, error: err.message, itens: [] });
  }
});

router.get('/importacao/cst-pis', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    res.json({ ok: true, itens: await importacaoNotas.listCstPis(req.query.q) });
  } catch (err) {
    res.json({ ok: false, error: err.message, itens: [] });
  }
});

router.get('/importacao/cst-cofins', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    res.json({ ok: true, itens: await importacaoNotas.listCstCofins(req.query.q) });
  } catch (err) {
    res.json({ ok: false, error: err.message, itens: [] });
  }
});

router.get('/importacao/cst-ipi', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    res.json({ ok: true, itens: await importacaoNotas.listCstIpi(req.query.q) });
  } catch (err) {
    res.json({ ok: false, error: err.message, itens: [] });
  }
});

router.get('/importacao/emitente-fiscal', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    res.json({ ok: true, ...(await importacaoNotas.getEmitenteFiscal()) });
  } catch (err) {
    res.json({ ok: false, error: err.message, simples: false });
  }
});

router.get('/importacao/produto-fiscal/:id', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    const item = await importacaoNotas.getProdutoFiscal(req.params.id);
    if (!item) return res.json({ ok: false, error: 'Produto não encontrado' });
    const conversao = importacaoParams.findConversao(null, req.params.id);
    res.json({ ok: true, item, conversao });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

const importacaoEstoqueFornec = require('./importacao-estoque-fornec');
const importacaoRegra = require('./importacao-regra');

router.get('/importacao/estoque-fornecedor', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    const item = await importacaoEstoqueFornec.buscarEstoqueFornecedor({
      idFornec: req.query.id_fornec,
      idIdentificador: req.query.id_identificador,
      codFornecedor: req.query.cod_fornecedor,
    });
    res.json({ ok: true, item });
  } catch (err) {
    res.json({ ok: false, error: err.message, item: null });
  }
});

router.post('/importacao/estoque-fornecedor', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    const item = await importacaoEstoqueFornec.upsertEstoqueFornecedor(req.body || {});
    res.json({ ok: true, item });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.get('/importacao/regra-tributo', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    const item = await importacaoRegra.buscarRegra({
      idFornec: req.query.id_fornec,
      idIdentificador: req.query.id_identificador,
      codFornecedor: req.query.cod_fornecedor,
      cfopEntrada: req.query.cfop_entrada,
    });
    res.json({ ok: true, item });
  } catch (err) {
    res.json({ ok: false, error: err.message, item: null });
  }
});

router.post('/importacao/regra-tributo', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    const item = await importacaoRegra.salvarRegra(req.body || {});
    res.json({ ok: true, item });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

const importacaoCancel = require('./importacao-cancel');

router.post('/importacao/sessoes', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    const body = req.body || {};
    const chave = String(body.chave || '').replace(/\D/g, '');
    const out = await importacaoStaging.createSessao({
      chave,
      xmlText: body.xmlText || body.xml || null,
      xmlPath: body.xmlPath || null,
      allowDemo: !!body.allowDemo || !!body.demo,
    });
    if (!out.ok) return res.json(out);
    const forn = await importacaoFornecedor.resolverNaImportacao(out.sessao.xml);
    importacaoStaging.setFornecedor(out.sessao.id, forn);
    const sessao = await importacaoStaging.aplicarVinculosSessao(out.sessao.id);
    const ide = sessao?.xml?.ide || {};
    const emit = sessao?.xml?.emit || {};
    let avisoDuplicada = null;
    try {
      const dup = await importacaoNotas.findNfDuplicada({
        chave: sessao?.chave || chave,
        nfNumero: ide.nNF,
        serie: ide.serie,
        idFornec: forn?.id_fornec,
        cnpj: emit.CNPJ || forn?.cadastro?.cnpj,
      });
      if (dup) avisoDuplicada = dup.aviso;
    } catch (_) { /* base sem NFCOMPRA / falha pontual */ }
    res.json({ ok: true, sessao, fonte: out.fonte, avisoDuplicada, sefazErro: out.sefazErro || null });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.delete('/importacao/sessoes/:id', (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    res.json(importacaoStaging.deleteSessao(req.params.id));
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.post('/importacao/sessoes/:id/cancelar', (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    res.json(importacaoStaging.cancelarSessaoConfirmada(req.params.id));
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.get('/importacao/notas/:idNfcompra/resumo', async (req, res) => {
  const okImp = importacaoSupervisorOk(req);
  let okAlt = false;
  if (!okImp) {
    const uid = Number(req.query?.usuarioId ?? req.body?.usuarioId);
    try {
      const users = loadUsersConfig(loadAppConfig());
      const u = (users.usuarios || []).find((x) => Number(x.id) === uid);
      okAlt = !!(u?.supervisor || u?.permissoes?.importacao?.acesso || u?.permissoes?.alteracoes?.acesso);
    } catch { /* ignore */ }
  }
  if (!okImp && !okAlt) {
    res.json({ ok: false, error: 'Sem permissão para ver o resumo da nota.' });
    return;
  }
  try {
    const nota = await importacaoNotas.getNotaResumo(req.params.idNfcompra);
    if (!nota) return res.json({ ok: false, error: 'Nota não encontrada' });
    res.json({ ok: true, nota });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.get('/importacao/notas/:idNfcompra/danfe', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    const nota = await importacaoNotas.getNotaById(req.params.idNfcompra);
    if (!nota) {
      res.status(404).type('html').send('<p>Nota não encontrada</p>');
      return;
    }
    const chave = String(nota.nfe_origem || '').replace(/\D/g, '');
    if (chave.length !== 44) {
      res.status(400).type('html').send('<p>Esta nota não possui chave de acesso para o DANFE.</p>');
      return;
    }
    const { xml } = await importacaoStaging.resolveXmlPayload({ chave, allowDemo: false });
    const sessao = {
      chave,
      xml,
      itens: (xml.itens || []).map((xi) => ({ xml: xi, sistema: {} })),
      financeiro: { parcelas: xml.cobr?.dup || [] },
    };
    const { renderDanfeHtml } = require('./importacao-danfe');
    res.type('html').send(renderDanfeHtml(sessao));
  } catch (err) {
    res.status(500).type('html').send(`<p>Erro: ${String(err.message || err)}</p>`);
  }
});

router.post('/importacao/notas/:idNfcompra/editar', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    const nota = await importacaoNotas.getNotaById(req.params.idNfcompra);
    if (!nota) {
      res.json({ ok: false, error: 'Nota não encontrada.' });
      return;
    }
    const chave = String(nota.nfe_origem || '').replace(/\D/g, '');
    if (chave.length !== 44) {
      res.json({ ok: false, error: 'Esta nota não tem chave de acesso para reabrir a conferência.' });
      return;
    }
    const out = await importacaoStaging.createSessao({
      chave,
      editarIdNfcompra: Number(nota.id_nfcompra),
      allowDemo: false,
    });
    res.json(out);
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.post('/importacao/notas/:idNfcompra/cancelar', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    const result = await importacaoCancel.cancelarNfCompra(req.params.idNfcompra, {
      usuario: req.body?.usuarioNome || 'Supervisor',
      idFuncionario: Number(req.body?.idFuncionario || 0),
    });
    importacaoStaging.marcarSessoesCanceladasPorNf({
      idNfcompra: result.id_nfcompra,
      chave: result.chave,
    });
    const contas = Number(result.contas_pagar_zeradas || 0);
    const msg = result.ja_cancelada
      ? (contas
        ? `NF ${result.nf_numero} já estava cancelada. ${contas} conta(s) a pagar residual(is) zerada(s). Pode reimportar.`
        : `NF ${result.nf_numero} já estava cancelada. Pode reimportar esta chave.`)
      : `NF ${result.nf_numero} cancelada. Estoque estornado e ${contas} conta(s) a pagar zerada(s). Pode reimportar esta chave.`;
    res.json({
      ok: true,
      ...result,
      message: msg,
    });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.post('/importacao/sessoes/manual', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    const out = await importacaoStaging.createSessaoManual(req.body || {});
    res.json(out);
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.post('/importacao/sessoes/:id/itens', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    const out = await importacaoStaging.addItemManual(req.params.id, req.body || {});
    res.json(out);
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.put('/importacao/sessoes/:id/cabecalho', (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    res.json(importacaoStaging.updateCabecalho(req.params.id, req.body || {}));
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.get('/importacao/sessoes/:id', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    let sessao = importacaoStaging.getSessao(req.params.id);
    if (!sessao) return res.json({ ok: false, error: 'Sessão não encontrada' });
    if (!sessao.fornecedor && sessao.xml) {
      const forn = await importacaoFornecedor.resolverNaImportacao(sessao.xml);
      importacaoStaging.setFornecedor(sessao.id, forn);
      sessao = await importacaoStaging.aplicarVinculosSessao(sessao.id);
    }
    res.json({ ok: true, sessao });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.get('/importacao/sessoes/:id/danfe', (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    const sessao = importacaoStaging.getSessao(req.params.id);
    if (!sessao) {
      res.status(404).type('html').send('<p>Sessão não encontrada</p>');
      return;
    }
    const { renderDanfeHtml } = require('./importacao-danfe');
    res.type('html').send(renderDanfeHtml(sessao));
  } catch (err) {
    res.status(500).type('html').send(`<p>Erro: ${String(err.message || err)}</p>`);
  }
});

router.get('/importacao/fornecedores', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    const itens = await importacaoFornecedor.buscarFornecedores(req.query.q);
    res.json({ ok: true, itens });
  } catch (err) {
    res.json({ ok: false, error: err.message, itens: [] });
  }
});

router.put('/importacao/sessoes/:id/fornecedor', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    const body = req.body || {};
    const patch = {};
    if (body.cadastro) patch.cadastro = body.cadastro;
    if (body.id_fornec !== undefined) {
      const id = body.id_fornec ? Number(body.id_fornec) : null;
      patch.id_fornec = id;
      patch.criar_novo = !id;
      patch.origem = id ? 'manual' : 'xml';
      if (id) {
        const cad = await importacaoFornecedor.getFornecedorById(id);
        if (cad) patch.cadastro = cad;
      } else {
        const sessaoAtual = importacaoStaging.getSessao(req.params.id);
        const forn = await importacaoFornecedor.resolverNaImportacao(sessaoAtual?.xml || {});
        patch.cadastro = forn.cadastro;
      }
    }
    if (body.criar_novo !== undefined) patch.criar_novo = !!body.criar_novo;
    const out = importacaoStaging.updateFornecedor(req.params.id, patch);
    if (out?.ok && patch.id_fornec) {
      const sessao = await importacaoStaging.aplicarVinculosSessao(req.params.id);
      return res.json({ ok: true, sessao });
    }
    res.json(out);
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.post('/importacao/sessoes/:id/fornecedor/cadastrar', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    const sessao = importacaoStaging.getSessao(req.params.id);
    if (!sessao) return res.json({ ok: false, error: 'Sessão não encontrada' });
    const cadastro = req.body?.cadastro || sessao.fornecedor?.cadastro;
    const ide = sessao.xml?.ide || {};
    const result = await importacaoFornecedor.cadastrarFornecedor(cadastro, {
      nNF: ide.nNF,
      serie: ide.serie,
    });
    importacaoStaging.updateFornecedor(req.params.id, {
      id_fornec: result.id_fornec,
      criar_novo: false,
      origem: result.ja_existia ? 'cadastro' : 'novo',
      cadastro: result.cadastro,
    });
    const sessaoAtual = await importacaoStaging.aplicarVinculosSessao(req.params.id);
    res.json({
      ok: true,
      sessao: sessaoAtual,
      message: result.ja_existia
        ? 'Fornecedor já existia no cadastro e foi vinculado.'
        : `Fornecedor cadastrado (cód. ${result.id_fornec}).`,
    });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.put('/importacao/sessoes/:id/itens/:nItem', (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    const out = importacaoStaging.updateItem(req.params.id, req.params.nItem, req.body || {});
    res.json(out);
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.post('/importacao/sessoes/:id/conferir-todos', (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    res.json(importacaoStaging.conferirTodosItens(req.params.id));
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.put('/importacao/sessoes/:id/financeiro', (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    const out = importacaoStaging.updateFinanceiro(req.params.id, req.body || {});
    res.json(out);
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.post('/importacao/sessoes/:id/financeiro/sugerir', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    const out = await importacaoStaging.sugerirFinanceiroSessao(req.params.id);
    res.json(out);
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.post('/importacao/sessoes/:id/confirmar', async (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    const out = await importacaoStaging.confirmarSessao(req.params.id, {
      usuario: req.body?.usuarioNome || 'Supervisor',
      idFuncionario: Number(req.body?.idFuncionario || 0),
    });
    res.json(out);
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.get('/importacao/produtos', (req, res) => {
  if (!guardImportacaoSupervisor(req, res)) return;
  try {
    res.json({ ok: true, itens: importacaoStaging.buscarProdutos(req.query.q) });
  } catch (err) {
    res.json({ ok: false, error: err.message, itens: [] });
  }
});

router.get('/database/status', (_req, res) => {
  const cfg = loadAppConfig();
  res.json({
    ok: true,
    database: cfg.database,
    ...getDbMaintenanceInfo(),
  });
});

router.post('/database/liberar', async (_req, res) => {
  try {
    const out = await releaseDatabase();
    res.json(out);
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.post('/database/retomar', (_req, res) => {
  res.json(resumeDatabase());
});

router.get('/fiscal/config', (_req, res) => {
  try {
    const certificado = require('./certificado');
    res.json({ ok: true, fiscal: certificado.publicFiscalConfig() });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.post('/fiscal/config', (req, res) => {
  try {
    const certificado = require('./certificado');
    const body = req.body || {};
    certificado.saveFiscalConfig({
      tipo: body.tipo,
      arquivoPfx: body.arquivoPfx,
      certStore: body.certStore,
      thumbprint: body.thumbprint,
      ambiente: body.ambiente,
      senha: body.senha,
    });
    res.json({ ok: true, fiscal: certificado.publicFiscalConfig() });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

router.get('/fiscal/certificados', async (_req, res) => {
  try {
    const certificado = require('./certificado');
    const itens = await certificado.listWindowsCertificates();
    res.json({ ok: true, itens });
  } catch (err) {
    res.json({ ok: false, error: err.message, itens: [] });
  }
});

router.post('/fiscal/testar', async (req, res) => {
  try {
    const certificado = require('./certificado');
    const body = req.body || {};
    let emitenteCnpj = '';
    try {
      const data = await withDb(async (db) => {
        const rows = await query(db, 'SELECT FIRST 1 CNPJ FROM TB_EMITENTE');
        return rows[0]?.CNPJ ? String(rows[0].CNPJ).replace(/\D/g, '') : '';
      });
      emitenteCnpj = data;
    } catch {
      /* base offline */
    }
    const out = await certificado.testFiscalConfig({
      tipo: body.tipo,
      arquivoPfx: body.arquivoPfx,
      thumbprint: body.thumbprint,
      certStore: body.certStore,
      ambiente: body.ambiente,
      senha: body.senha,
      emitenteCnpj,
    });
    res.json(out);
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

module.exports = router;
