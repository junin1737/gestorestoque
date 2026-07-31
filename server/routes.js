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
  blobToBase64,
  hasTable,
  refreshTables,
} = require('./db');

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
      const logo = blobToBase64(e.LOGO);
      res.json({
        ok: true,
        fbVersion,
        sistema: cfg.sistema,
        database: cfg.database,
        hasManagePro: hasTable('TB_ESTOQUE_2'),
        emitente: {
          nome_fanta: String(e.NOME_FANTA || e.NOME || '').trim(),
          logo: logo ? `data:image/png;base64,${logo}` : null,
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
      const logo = blobToBase64(e.LOGO);
      return {
        nome_fanta: String(e.NOME_FANTA || e.NOME || '').trim(),
        logo: logo ? `data:image/png;base64,${logo}` : null,
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
        ORDER BY E.DESCRICAO`;
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
      for (const target of targets) {
        const t = target.tables;
        const cur = await query(
          db,
          `SELECT E.ID_ESTOQUE, E.PRC_VENDA, E.PRC_CUSTO, P.QTD_ATUAL, P.PRC_MEDIO
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
            const hasObs = true;
            try {
              await query(
                db,
                `INSERT INTO ${t.saldo}
                  (ID, DATA, ID_IDENTIFICADOR, SALDO_ANTIGO, SALDO_NOVO, PRC_MEDIO, HORA, ID_FUNCIONARIO, OBSERVACAO)
                 VALUES (?, CURRENT_DATE, ?, ?, ?, ?, CURRENT_TIME, ?, ?)`,
                [nextId, id, qtdAntiga, novaQtd, prcMedio, idFuncionario || 0, obs]
              );
            } catch (e) {
              if (String(e.message || '').includes('OBSERVACAO')) {
                await query(
                  db,
                  `INSERT INTO ${t.saldo}
                    (ID, DATA, ID_IDENTIFICADOR, SALDO_ANTIGO, SALDO_NOVO, PRC_MEDIO, HORA, ID_FUNCIONARIO)
                   VALUES (?, CURRENT_DATE, ?, ?, ?, ?, CURRENT_TIME, ?)`,
                  [nextId, id, qtdAntiga, novaQtd, prcMedio, idFuncionario || 0]
                );
              } else throw e;
            }
            void hasObs;
          }
        updated = { id_identificador: id, id_estoque: idEstoque };
      }
      return updated;
    });
    if (!result) return res.json({ ok: false, error: 'Produto não encontrado nas tabelas do modo configurado.' });
    res.json({ ok: true, item: result });
  } catch (err) {
    res.json({ ok: false, error: err.message });
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
