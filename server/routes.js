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
      user: cfg.user,
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
    user: body.user || current.user,
    sistema: body.sistema || current.sistema,
    tema: body.tema || current.tema,
  };
  if (body.password !== undefined && body.password !== '') next.password = body.password;
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
      user: body.user || current.user,
      sistema: body.sistema || current.sistema,
    };
    if (body.password) cfg.password = body.password;
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
    status: String(r.STATUS || 'A').trim(),
  };
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
    const data = await withDb(async (db, appCfg) => {
      const targets = activeTargets(appCfg);
      const t = targets[0].tables;
      const where = [];
      const params = [];
      if (busca) {
        where.push(`(
          UPPER(E.DESCRICAO) CONTAINING UPPER(?)
          OR UPPER(P.COD_BARRA) CONTAINING UPPER(?)
          OR UPPER(P.REFERENCIA) CONTAINING UPPER(?)
          OR CAST(E.ID_ESTOQUE AS VARCHAR(20)) CONTAINING ?
          OR CAST(I.ID_IDENTIFICADOR AS VARCHAR(20)) CONTAINING ?
        )`);
        params.push(busca, busca, busca, busca, busca);
      }
      where.push(`(E.STATUS = 'A' OR E.STATUS IS NULL)`);
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
        WHERE ${where.join(' AND ')}
        ORDER BY E.ID_ESTOQUE DESC, I.ID_IDENTIFICADOR DESC`;
      const rows = await query(db, sql, params);
      return rows.map(mapProdutoRow);
    });
    res.json({ ok: true, itens: data });
  } catch (err) {
    res.json({ ok: false, error: err.message, itens: [] });
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
           VALUES (?, ?, 'A', ?, ?, ?, ?, ?, '0', 'N')`,
          [idEstoque, descricao, idGrupo, uni, prcVenda, prcCusto, gradeSerie]
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
      const targets = activeTargets(appCfg);
      let updated = null;
      let snapshotAntes = null;
      let snapshotDepois = null;

      for (const target of targets) {
        const t = target.tables;
        const cur = await query(
          db,
          `SELECT E.ID_ESTOQUE, E.DESCRICAO, E.ID_GRUPO, E.UNI_MEDIDA, E.PRC_VENDA, E.PRC_CUSTO,
                  E.GRADE_SERIE, P.QTD_ATUAL, P.PRC_MEDIO, P.COD_BARRA, P.REFERENCIA, P.DESC_CMPL,
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

        const antes = {
          descricao: String(row.DESCRICAO || '').trim(),
          id_grupo: row.ID_GRUPO == null ? null : Number(row.ID_GRUPO),
          uni_medida: String(row.UNI_MEDIDA || '').trim(),
          prc_venda: Number(row.PRC_VENDA || 0),
          prc_custo: Number(row.PRC_CUSTO || 0),
          grade_serie: String(row.GRADE_SERIE || 'N').trim().toUpperCase(),
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
        if (body.prc_venda !== undefined) { estSets.push('PRC_VENDA = ?'); estParams.push(Number(body.prc_venda)); }
        if (body.prc_custo !== undefined) { estSets.push('PRC_CUSTO = ?'); estParams.push(Number(body.prc_custo)); }
        if (body.grade_serie !== undefined) { estSets.push('GRADE_SERIE = ?'); estParams.push(String(body.grade_serie)); }
        if (estSets.length) {
          estParams.push(idEstoque);
          await query(db, `UPDATE ${t.estoque} SET ${estSets.join(', ')} WHERE ID_ESTOQUE = ?`, estParams);
        }

        const prodSets = [];
        const prodParams = [];
        if (body.cod_barras !== undefined) { prodSets.push('COD_BARRA = ?'); prodParams.push(String(body.cod_barras)); }
        if (body.referencia !== undefined) { prodSets.push('REFERENCIA = ?'); prodParams.push(String(body.referencia)); }
        if (body.desc_cmpl !== undefined) { prodSets.push('DESC_CMPL = ?'); prodParams.push(String(body.desc_cmpl)); }
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
            ...(novaQtd !== null ? { qtd_atual: novaQtd } : {}),
          };
        }

        updated = { id_identificador: id, id_estoque: idEstoque };
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

module.exports = router;
