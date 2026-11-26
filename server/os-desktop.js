'use strict';

/**
 * App desktop da O.S (pasta desktop-os, Python + pywebview).
 *
 * - cache(): cópia que cada computador guarda no SQLite para a contingência — clientes, produtos e
 *   serviços, técnicos, status, limites e as O.S em aberto. O app pede de tempos em tempos.
 * - sincronizar(): quando o servidor volta, o app manda as O.S abertas ou alteradas em contingência.
 *   O.S nova ganha o número definitivo (o provisório fica gravado nela). Se a mesma O.S mudou no servidor
 *   depois da cópia, volta como conflito com as duas versões, e o usuário escolhe qual fica.
 * - Instalador: o serviço entrega o instalador mais novo (Baixar aplicativo desktop) e a versão para a
 *   atualização automática. O nome do arquivo leva o endereço do servidor, que o instalador grava.
 */

const fs = require('fs');
const path = require('path');
const { query, activeTargets } = require('./db');
const os = require('./os');

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function txt(v, max) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return max ? s.slice(0, max) : s;
}

/* ------------------------------------------------------------------ */
/* Cópia para a contingência                                           */
/* ------------------------------------------------------------------ */

async function cache() {
  return os._comBase(async (db, appCfg) => {
    const funcionarios = await os._lerFuncionarios(db);
    const statuses = await os._lerStatus(db);
    const finais = statuses.filter((s) => s.final).map((s) => s.id);

    const cli = await query(db, `
      SELECT FIRST 60000 C.ID_CLIENTE, C.NOME, C.DDD_CELUL, C.FONE_CELUL, C.DDD_RESID, C.FONE_RESID, C.DDD_COMER, C.FONE_COMER,
             C.END_LOGRAD, C.END_NUMERO, C.END_BAIRRO, PF.CPF, PJ.CNPJ
      FROM TB_CLIENTE C
      LEFT JOIN TB_CLI_PF PF ON PF.ID_CLIENTE = C.ID_CLIENTE
      LEFT JOIN TB_CLI_PJ PJ ON PJ.ID_CLIENTE = C.ID_CLIENTE
      WHERE C.STATUS = 'A' OR C.STATUS IS NULL
      ORDER BY C.ID_CLIENTE`);
    const clientes = cli.map((r) => ({
      id: num(r.ID_CLIENTE),
      nome: txt(r.NOME),
      documento: os._fmtDoc(txt(r.CNPJ) || txt(r.CPF)),
      telefone: os._fmtFone(os._foneCliente(r)),
      endereco: [txt(r.END_LOGRAD), txt(r.END_NUMERO), txt(r.END_BAIRRO)].filter(Boolean).join(', '),
    }));

    const t = activeTargets(appCfg)[0]?.tables;
    let itens = [];
    if (t) {
      const tipos = [...os._TIPOS.produto, ...os._TIPOS.servico];
      const rows = await query(db, `
        SELECT FIRST 60000 I.ID_IDENTIFICADOR, E.DESCRICAO, E.PRC_VENDA, E.UNI_MEDIDA, (${os._SQL_TIPO}) AS TIPO, P.COD_BARRA, P.REFERENCIA
        FROM ${t.estoque} E
        JOIN ${t.identificador} I ON I.ID_ESTOQUE = E.ID_ESTOQUE
        JOIN ${t.produto} P ON P.ID_IDENTIFICADOR = I.ID_IDENTIFICADOR
        WHERE (E.STATUS = 'A' OR E.STATUS IS NULL) AND (${os._SQL_TIPO}) IN (${tipos.map((x) => `'${x}'`).join(',')})
        ORDER BY I.ID_IDENTIFICADOR`);
      itens = rows.map((r) => ({
        id: num(r.ID_IDENTIFICADOR),
        descricao: txt(r.DESCRICAO),
        servico: txt(r.TIPO) === '9',
        unidade: txt(r.UNI_MEDIDA) || 'UN',
        preco: num(r.PRC_VENDA),
        cod_barras: txt(r.COD_BARRA),
        referencia: txt(r.REFERENCIA),
      }));
    }

    const abertas = await query(db, `
      SELECT ID_OS FROM GESTOR_OS
      WHERE ${finais.length ? `ID_STATUS NOT IN (${finais.join(',')}) OR ID_STATUS IS NULL` : '1 = 1'}
      ORDER BY ID_OS`);
    const ordens = [];
    for (const r of abertas.slice(0, 1500)) {
      const o = await os._lerOs(db, r.ID_OS);
      if (o) ordens.push(o);
    }
    let loja = null;
    try { loja = await require('./condicionais').lojaEmitente(); } catch { loja = null; }
    return {
      gerado_em: new Date().toISOString(),
      loja,
      tema: String(require('./config').loadAppConfig().tema || 'claro'),
      funcionarios,
      statuses,
      clientes,
      itens,
      os: ordens,
      limites: os.lerLimites(),
      perfil: os.perfilServicos(),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Sincronização das O.S da contingência                               */
/* ------------------------------------------------------------------ */

async function jaSincronizada(provisorio) {
  return os._comBase(async (db) => {
    const r = await query(db, 'SELECT FIRST 1 ID_OS FROM GESTOR_OS WHERE NUM_PROVISORIO = ?', [txt(provisorio, 40)]);
    return num(r[0]?.ID_OS) || null;
  });
}

/**
 * itens: [{ provisorio, id?, versao?, forcar?, dados }]. Cada um responde sozinho: um erro não
 * impede os outros. Mandar duas vezes a mesma O.S nova não duplica (procura pelo número provisório).
 */
async function sincronizar(itens, usuario) {
  const lista = Array.isArray(itens) ? itens.slice(0, 500) : [];
  const resultados = [];
  for (const item of lista) {
    const provisorio = txt(item?.provisorio, 40);
    const id = num(item?.id);
    const dados = { ...(item?.dados || {}) };
    delete dados.id;
    delete dados.liberacoes;
    try {
      if (!id) {
        if (!provisorio) throw new Error('O.S da contingência sem número provisório.');
        const existente = await jaSincronizada(provisorio);
        if (existente) {
          resultados.push({ provisorio, status: 'ja_sincronizada', id: existente });
          continue;
        }
        const r = await os.salvar(dados, usuario, { origem: 'C', provisorio });
        resultados.push({ provisorio, status: 'criada', id: r.id, avisos: r.avisos || [] });
      } else {
        const r = await os.salvar({ ...dados, id }, usuario, { origem: 'C', versaoBase: num(item?.versao), forcar: item?.forcar === true });
        resultados.push({ provisorio, status: 'atualizada', id: r.id, avisos: r.avisos || [] });
      }
    } catch (err) {
      if (err.code === 'CONFLITO') {
        resultados.push({ provisorio, status: 'conflito', id, erro: err.message, servidor: err.servidor });
      } else {
        resultados.push({ provisorio, status: 'erro', id: id || null, erro: String(err.message || err) });
      }
    }
  }
  return {
    resultados,
    resumo: {
      criadas: resultados.filter((r) => r.status === 'criada').length,
      atualizadas: resultados.filter((r) => r.status === 'atualizada').length,
      conflitos: resultados.filter((r) => r.status === 'conflito').length,
      erros: resultados.filter((r) => r.status === 'erro').length,
    },
  };
}

/** Usuário escolheu manter a versão do servidor: só registra no histórico. */
async function manterServidor(id, provisorio, usuario) {
  return os._comBase(async (db) => {
    const o = await os._lerOs(db, id);
    if (!o) throw new Error('O.S não encontrada.');
    await os._historico(db, id, usuario, `Alteração da contingência${provisorio ? ` (${provisorio})` : ''} descartada: ficou a versão do servidor`);
    return { id };
  });
}

/* ------------------------------------------------------------------ */
/* Instalador do app desktop                                           */
/* ------------------------------------------------------------------ */

/** Pasta com GestorOS-Setup.exe e versao.json: dentro do serviço instalado ou na pasta de build. */
function pastaInstalador() {
  const candidatos = [];
  if (process.resourcesPath) candidatos.push(path.join(process.resourcesPath, 'desktop'));
  candidatos.push(path.join(__dirname, '..', 'desktop-os', 'saida'));
  return candidatos.find((p) => fs.existsSync(path.join(p, 'versao.json'))) || null;
}

function versaoInstalador() {
  const pasta = pastaInstalador();
  if (!pasta) return null;
  try {
    const v = JSON.parse(fs.readFileSync(path.join(pasta, 'versao.json'), 'utf8').replace(/^\uFEFF/, ''));
    const arquivo = path.join(pasta, String(v.arquivo || 'GestorOS-Setup.exe'));
    if (!fs.existsSync(arquivo)) return null;
    return { versao: txt(v.versao), data: txt(v.data), arquivo, tamanho: fs.statSync(arquivo).size };
  } catch {
    return null;
  }
}

/** Compara "1.2.10" com "1.2.9" número a número. */
function maisNova(a, b) {
  const pa = String(a || '0').split('.').map(num);
  const pb = String(b || '0').split('.').map(num);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

// Computadores com o app aberto (o app avisa a cada poucos minutos). Fica só na memória do serviço.
const presencas = new Map();

function registrarPresenca(ip, { maquina, versao }) {
  presencas.set(String(ip || ''), { maquina: txt(maquina, 60), versao: txt(versao, 20), visto: Date.now() });
}

function presencaDe(ip) {
  const p = presencas.get(String(ip || ''));
  if (!p || Date.now() - p.visto > 7 * 24 * 3600 * 1000) return null;
  return { maquina: p.maquina, versao: p.versao, visto_em: new Date(p.visto).toISOString() };
}

function info(ip) {
  const v = versaoInstalador();
  const instalado = presencaDe(ip);
  return {
    disponivel: !!v,
    versao: v?.versao || '',
    data: v?.data || '',
    tamanho: v?.tamanho || 0,
    instalado,
    atualizar: !!(v && instalado && maisNova(v.versao, instalado.versao)),
  };
}

/** Nome do arquivo com o endereço do serviço, para o instalador já deixar o app configurado. */
function nomeComServidor(host) {
  const limpo = String(host || '').replace(/[^0-9A-Za-z.:-]/g, '').replace(':', '-');
  return limpo ? `GestorOS-Setup_${limpo}.exe` : 'GestorOS-Setup.exe';
}

module.exports = {
  cache, sincronizar, manterServidor, versaoInstalador, info, registrarPresenca, nomeComServidor, maisNova,
};
