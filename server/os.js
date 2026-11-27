'use strict';

/**
 * Ordem de Serviço (O.S) do Gestor.
 *
 * Tabelas próprias, com prefixo GESTOR_: o Clipp já tem TB_OS, TB_OS_ITEM, TB_OS_STATUS e
 * TB_OS_HISTORICO (a O.S dele), e TB_PEDIDO_VENDA.ORIGEM já é usada por ele. Nada do Clipp é alterado.
 *
 * - GESTOR_OS / GESTOR_OS_ITEM: cabeçalho (com cópia do cliente no momento da gravação) e itens.
 * - GESTOR_OS_STATUS: colunas do quadro (ícone e cor de lista pronta, ordem, ativo, final).
 * - GESTOR_OS_HISTORICO: troca de status, técnico, envio para a venda e liberação de desconto.
 * - GESTOR_OS_SOLUCAO: base de soluções da lâmpada. GESTOR_OS_MENSAGEM: mensagens do WhatsApp.
 * - GESTOR_OS_FUNC: quem é gerente (libera desconto acima do limite). Técnico vem da função
 *   Técnico do cadastro (TB_FUNC_PAPEL / TB_FUNC_PAPEL_TIPO_SIS), não desta tabela.
 * - GESTOR_OS_CATEGORIA: categorias (ID_PAI vazio) e subcategorias (ID_PAI preenchido).
 * - GESTOR_PEDIDO_ORIGEM: marca o pedido de venda gravado pela O.S, para o Condicional não listar.
 *
 * Envio para a Venda Gerencial: grava nas tabelas do condicional (condicionais.gravarPedidoOS).
 * Adendo: se um dia precisar gravar também a O.S do Clipp (TB_OS, TB_OS_ITEM, TB_OS_OBJETO_OS,
 * TB_OS_CADASTRO), o passo entra em enviarParaVenda, depois do pedido — ver server/os-perfil.js.
 */

const crypto = require('crypto');
const { withDb, query, hasTable, refreshTables, withTransaction, activeTargets, columnExists } = require('./db');
const { loadAppConfig, saveAppConfig, loadUsersConfig } = require('./config');

const NUM_STATUS_PADRAO = [
  { descricao: 'Aberta', icone: 'pasta', cor: '#3b82f6' },
  { descricao: 'Buscar no Cliente', icone: 'carro', cor: '#8b5cf6' },
  { descricao: 'Aguardando Autorização', icone: 'pergunta', cor: '#d4a106' },
  { descricao: 'Aguardando Peças', icone: 'caixa', cor: '#f97316' },
  { descricao: 'Em Andamento', icone: 'chave', cor: '#0d9488' },
  { descricao: 'Finalizada', icone: 'check', cor: '#22a35a' },
  { descricao: 'Entregando', icone: 'caminhao', cor: '#14b8a6' },
  { descricao: 'Concluído e Entregue', icone: 'estrela', cor: '#166534', final: true },
];
const ICONES = ['pasta', 'carro', 'pergunta', 'caixa', 'chave', 'caminhao', 'check', 'relogio', 'cadeado', 'whats', 'monitor', 'tag', 'pessoa', 'ferramenta', 'alerta', 'estrela'];
const CORES = ['#3b82f6', '#8b5cf6', '#d4a106', '#f97316', '#0d9488', '#14b8a6', '#22a35a', '#ec4899', '#ef4444', '#64748b'];
const EVENTOS_MSG = {
  atribuida: 'O.S atribuída ao técnico',
  status: 'Mudança de status',
  previsao: 'Previsão vencendo',
};
const MENSAGEM_PADRAO = 'Olá, {tecnico}! A O.S {numero_os} do cliente {cliente} foi atribuída a você. Equipamento: {equipamento}. Defeito: {defeito}.';
/** Tipos de item (TB_EST_TIPO_ITEM_SIS) aceitos em cada aba. */
const TIPOS_PRODUTO = ['0', '2', '3', '4', '5', '6'];
const TIPOS_SERVICO = ['9'];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function r2(v) {
  return Math.round(num(v) * 100) / 100;
}
function txt(v, max) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return max ? s.slice(0, max) : s;
}
function texto(v, max) {
  const s = String(v ?? '').replace(/\r\n/g, '\n').trim();
  return max ? s.slice(0, max) : s;
}
function sn(v) {
  return v === true || v === 'S' || v === 's' || v === 1 || v === '1' || v === 'true' ? 'S' : 'N';
}
function dataIso(v) {
  if (!v) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dataHoraIso(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return `${dataIso(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function dataBr(iso) {
  const s = dataIso(iso);
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}
function dataHoraBr(v) {
  const s = dataHoraIso(v);
  if (!s) return '';
  return `${dataBr(s)} ${s.slice(11, 16)}`;
}
function dataInformada(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}
function dataHoraInformada(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(v || '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 12), Number(m[5] || 0), 0);
  return Number.isNaN(d.getTime()) ? null : d;
}
function hojeIso() {
  return dataIso(new Date());
}
/** "09", "9" ou " 9" são o mesmo tipo: tira espaço e zero à esquerda. */
function tipoItem(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const semZero = s.replace(/^0+/, '');
  return semZero || '0';
}
function iniciais(nome) {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '';
  const a = partes[0][0] || '';
  const b = partes.length > 1 ? partes[partes.length - 1][0] : (partes[0][1] || '');
  return (a + b).toUpperCase();
}
function semAcento(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/* ------------------------------------------------------------------ */
/* Esquema                                                             */
/* ------------------------------------------------------------------ */

const TABELAS = {
  GESTOR_OS: `
    CREATE TABLE GESTOR_OS (
      ID_OS INTEGER NOT NULL,
      DT_EMISSAO TIMESTAMP,
      TIPO CHAR(1),
      MODALIDADE CHAR(1),
      ID_STATUS INTEGER,
      ID_TECNICO INTEGER,
      QUEM_TROUXE VARCHAR(100),
      ID_CATEGORIA INTEGER,
      ID_SUBCATEGORIA INTEGER,
      EQUIPAMENTO VARCHAR(300),
      DEFEITO VARCHAR(2000),
      SOLUCAO VARCHAR(2000),
      OBS VARCHAR(1000),
      DT_PREVISAO DATE,
      DT_ENTREGA TIMESTAMP,
      ORDEM INTEGER,
      ID_CLIENTE INTEGER,
      CLI_NOME VARCHAR(100),
      CLI_DOC VARCHAR(20),
      CLI_FONE VARCHAR(30),
      CLI_ENDERECO VARCHAR(250),
      CLI_DADOS VARCHAR(6000),
      DESC_GERAL NUMERIC(15,2),
      ACRES_GERAL NUMERIC(15,2),
      FRETE NUMERIC(15,2),
      DESLOCAMENTO NUMERIC(15,2),
      TOTAL_PRODUTOS NUMERIC(15,2),
      TOTAL_SERVICOS NUMERIC(15,2),
      TOTAL NUMERIC(15,2),
      AUTORIZACAO VARCHAR(2000),
      AUTOR_STATUS CHAR(1),
      ID_AUTOR_CONTATO INTEGER,
      ID_BUSCADOR INTEGER,
      ID_ENTREGADOR INTEGER,
      CANCELADA CHAR(1),
      ID_PEDIDO INTEGER,
      DT_ENVIO TIMESTAMP,
      PERFIL VARCHAR(32),
      ORIGEM CHAR(1),
      NUM_PROVISORIO VARCHAR(40),
      ID_USUARIO INTEGER,
      USUARIO VARCHAR(60),
      DT_ALTERACAO TIMESTAMP,
      CONSTRAINT PK_GESTOR_OS PRIMARY KEY (ID_OS)
    )`,
  GESTOR_OS_ITEM: `
    CREATE TABLE GESTOR_OS_ITEM (
      ID_ITEM INTEGER NOT NULL,
      ID_OS INTEGER NOT NULL,
      SEQ INTEGER,
      ID_IDENTIFICADOR INTEGER,
      DESCRICAO VARCHAR(200),
      TIPO CHAR(1),
      UNIDADE VARCHAR(6),
      QTD NUMERIC(15,3),
      VLR_UNIT NUMERIC(15,4),
      DESC_ITEM NUMERIC(15,2),
      ACRES_ITEM NUMERIC(15,2),
      RATEIO_DESC NUMERIC(15,2),
      RATEIO_ACRES NUMERIC(15,2),
      TOTAL NUMERIC(15,2),
      CONSTRAINT PK_GESTOR_OS_ITEM PRIMARY KEY (ID_ITEM)
    )`,
  GESTOR_OS_STATUS: `
    CREATE TABLE GESTOR_OS_STATUS (
      ID_STATUS INTEGER NOT NULL,
      DESCRICAO VARCHAR(60),
      ICONE VARCHAR(20),
      COR VARCHAR(20),
      ORDEM INTEGER,
      ATIVO CHAR(1),
      FINAL CHAR(1),
      CONSTRAINT PK_GESTOR_OS_STATUS PRIMARY KEY (ID_STATUS)
    )`,
  GESTOR_OS_HISTORICO: `
    CREATE TABLE GESTOR_OS_HISTORICO (
      ID INTEGER NOT NULL,
      ID_OS INTEGER NOT NULL,
      DT TIMESTAMP,
      ID_USUARIO INTEGER,
      USUARIO VARCHAR(60),
      ID_STATUS_ANT INTEGER,
      ID_STATUS_NOVO INTEGER,
      EVENTO VARCHAR(300),
      CONSTRAINT PK_GESTOR_OS_HISTORICO PRIMARY KEY (ID)
    )`,
  GESTOR_OS_SOLUCAO: `
    CREATE TABLE GESTOR_OS_SOLUCAO (
      ID INTEGER NOT NULL,
      DEFEITO VARCHAR(2000),
      SOLUCAO VARCHAR(2000),
      EQUIPAMENTO VARCHAR(300),
      ID_OS INTEGER,
      USOS INTEGER,
      DT TIMESTAMP,
      CONSTRAINT PK_GESTOR_OS_SOLUCAO PRIMARY KEY (ID)
    )`,
  GESTOR_OS_MENSAGEM: `
    CREATE TABLE GESTOR_OS_MENSAGEM (
      ID INTEGER NOT NULL,
      TITULO VARCHAR(80),
      TEXTO VARCHAR(1000),
      EVENTO VARCHAR(30),
      ATIVO CHAR(1),
      CONSTRAINT PK_GESTOR_OS_MENSAGEM PRIMARY KEY (ID)
    )`,
  GESTOR_OS_FUNC: `
    CREATE TABLE GESTOR_OS_FUNC (
      ID_FUNCIONARIO INTEGER NOT NULL,
      TECNICO CHAR(1),
      GERENTE CHAR(1),
      CONSTRAINT PK_GESTOR_OS_FUNC PRIMARY KEY (ID_FUNCIONARIO)
    )`,
  GESTOR_OS_CATEGORIA: `
    CREATE TABLE GESTOR_OS_CATEGORIA (
      ID INTEGER NOT NULL,
      ID_PAI INTEGER,
      NOME VARCHAR(80),
      ATIVO CHAR(1),
      CONSTRAINT PK_GESTOR_OS_CATEGORIA PRIMARY KEY (ID)
    )`,
  GESTOR_PEDIDO_ORIGEM: `
    CREATE TABLE GESTOR_PEDIDO_ORIGEM (
      ID_PEDIDO INTEGER NOT NULL,
      ORIGEM VARCHAR(2),
      ID_ORIGEM INTEGER,
      CONSTRAINT PK_GESTOR_PEDIDO_ORIGEM PRIMARY KEY (ID_PEDIDO)
    )`,
};
const GERADORES = ['GESTOR_GEN_OS', 'GESTOR_GEN_OS_ITEM', 'GESTOR_GEN_OS_HIST', 'GESTOR_GEN_OS_SOL', 'GESTOR_GEN_OS_MSG', 'GESTOR_GEN_OS_STATUS', 'GESTOR_GEN_OS_CAT'];

let esquemaPronto = false;

async function ensureOsSchema(db) {
  if (esquemaPronto && Object.keys(TABELAS).every((t) => hasTable(t))) return;
  const tabelas = new Set((await query(db, `
    SELECT TRIM(RDB$RELATION_NAME) AS N FROM RDB$RELATIONS
    WHERE RDB$RELATION_NAME STARTING WITH 'GESTOR_'`)).map((r) => String(r.N).trim()));
  let criou = false;
  for (const [nome, ddl] of Object.entries(TABELAS)) {
    if (tabelas.has(nome)) continue;
    await query(db, ddl);
    criou = true;
  }
  const gens = new Set((await query(db, `
    SELECT TRIM(RDB$GENERATOR_NAME) AS G FROM RDB$GENERATORS
    WHERE RDB$GENERATOR_NAME STARTING WITH 'GESTOR_GEN_OS'`)).map((r) => String(r.G).trim()));
  for (const g of GERADORES) {
    if (!gens.has(g)) await query(db, `CREATE GENERATOR ${g}`);
  }
  if (tabelas.has('GESTOR_OS') || criou) {
    if (!(await columnExists(db, 'GESTOR_OS', 'ID_CATEGORIA'))) await query(db, 'ALTER TABLE GESTOR_OS ADD ID_CATEGORIA INTEGER');
    if (!(await columnExists(db, 'GESTOR_OS', 'ID_SUBCATEGORIA'))) await query(db, 'ALTER TABLE GESTOR_OS ADD ID_SUBCATEGORIA INTEGER');
    if (!(await columnExists(db, 'GESTOR_OS', 'AUTORIZACAO'))) await query(db, 'ALTER TABLE GESTOR_OS ADD AUTORIZACAO VARCHAR(2000)');
    if (!(await columnExists(db, 'GESTOR_OS', 'AUTOR_STATUS'))) await query(db, 'ALTER TABLE GESTOR_OS ADD AUTOR_STATUS CHAR(1)');
    if (!(await columnExists(db, 'GESTOR_OS', 'ID_AUTOR_CONTATO'))) await query(db, 'ALTER TABLE GESTOR_OS ADD ID_AUTOR_CONTATO INTEGER');
    if (!(await columnExists(db, 'GESTOR_OS', 'ID_BUSCADOR'))) await query(db, 'ALTER TABLE GESTOR_OS ADD ID_BUSCADOR INTEGER');
    if (!(await columnExists(db, 'GESTOR_OS', 'ID_ENTREGADOR'))) await query(db, 'ALTER TABLE GESTOR_OS ADD ID_ENTREGADOR INTEGER');
    if (!(await columnExists(db, 'GESTOR_OS', 'CANCELADA'))) await query(db, 'ALTER TABLE GESTOR_OS ADD CANCELADA CHAR(1)');
  }
  if (criou) await refreshTables(db);
  const st = await query(db, 'SELECT COUNT(*) AS N FROM GESTOR_OS_STATUS');
  if (!num(st[0]?.N)) {
    let ordem = 0;
    for (const s of NUM_STATUS_PADRAO) {
      ordem += 1;
      const id = await gerar(db, 'GESTOR_GEN_OS_STATUS');
      await query(db, `
        INSERT INTO GESTOR_OS_STATUS (ID_STATUS, DESCRICAO, ICONE, COR, ORDEM, ATIVO, FINAL)
        VALUES (?, ?, ?, ?, ?, 'S', ?)`, [id, s.descricao, s.icone, s.cor, ordem, s.final ? 'S' : 'N']);
    }
  }
  const msg = await query(db, 'SELECT COUNT(*) AS N FROM GESTOR_OS_MENSAGEM');
  if (!num(msg[0]?.N)) {
    const id = await gerar(db, 'GESTOR_GEN_OS_MSG');
    await query(db, `
      INSERT INTO GESTOR_OS_MENSAGEM (ID, TITULO, TEXTO, EVENTO, ATIVO)
      VALUES (?, ?, ?, 'atribuida', 'S')`, [id, 'O.S atribuída ao técnico', MENSAGEM_PADRAO]);
  }
  await ajustarFluxoStatus(db);
  esquemaPronto = true;
}

/** Buscar pede quem busca. Entregar pede quem entrega. Concluído e Entregue não pede de novo. */
function papelStatus(descricao) {
  const n = semAcento(descricao);
  if (n.includes('buscar')) return 'busca';
  if (n.includes('entreg') && !n.includes('conclu')) return 'entrega';
  return '';
}

function autorStatus(v) {
  const s = String(v || '').trim().toUpperCase();
  return s === 'P' || s === 'A' || s === 'N' ? s : '';
}

function rotuloAutor(v) {
  return { P: 'Pendente', A: 'Autorizada', N: 'Recusada' }[autorStatus(v)] || '';
}

/** Deixa o quadro na ordem do atendimento e só Concluído e Entregue encerra a O.S. */
async function ajustarFluxoStatus(db) {
  let lista = await lerStatus(db);
  const achar = (nome) => lista.find((s) => semAcento(s.descricao) === semAcento(nome));
  if (!achar('Concluído e Entregue')) {
    const id = await gerar(db, 'GESTOR_GEN_OS_STATUS');
    await query(db, `
      INSERT INTO GESTOR_OS_STATUS (ID_STATUS, DESCRICAO, ICONE, COR, ORDEM, ATIVO, FINAL)
      VALUES (?, 'Concluído e Entregue', 'estrela', '#166534', 99, 'S', 'S')`, [id]);
    lista = await lerStatus(db);
  }
  const pipeline = ['Aberta', 'Buscar no Cliente', 'Aguardando Autorização', 'Aguardando Peças', 'Em Andamento', 'Finalizada', 'Entregando', 'Concluído e Entregue'];
  const idsPipe = new Set();
  let ordem = 0;
  for (const nome of pipeline) {
    const s = achar(nome);
    if (!s) continue;
    ordem += 1;
    idsPipe.add(s.id);
    const final = semAcento(nome) === semAcento('Concluído e Entregue') ? 'S' : 'N';
    await query(db, `UPDATE GESTOR_OS_STATUS SET ORDEM = ?, FINAL = ?, ATIVO = 'S' WHERE ID_STATUS = ?`, [ordem, final, s.id]);
  }
  for (const s of lista.filter((x) => !idsPipe.has(x.id)).sort((a, b) => a.ordem - b.ordem || a.id - b.id)) {
    ordem += 1;
    await query(db, 'UPDATE GESTOR_OS_STATUS SET ORDEM = ? WHERE ID_STATUS = ?', [ordem, s.id]);
  }
}

async function gerar(db, gen) {
  const rows = await query(db, `SELECT GEN_ID(${gen}, 1) AS ID FROM RDB$DATABASE`);
  return num(rows[0]?.ID);
}

/** Abre a base com as tabelas da O.S prontas. */
function comBase(fn) {
  return withDb(async (db, appCfg) => {
    await ensureOsSchema(db);
    return fn(db, appCfg);
  });
}

/* ------------------------------------------------------------------ */
/* Cadastros de apoio: status, técnicos, mensagens                     */
/* ------------------------------------------------------------------ */

function mapStatus(r) {
  return {
    id: num(r.ID_STATUS),
    descricao: txt(r.DESCRICAO),
    icone: ICONES.includes(txt(r.ICONE)) ? txt(r.ICONE) : 'pasta',
    cor: /^#[0-9a-f]{6}$/i.test(txt(r.COR)) ? txt(r.COR) : '#64748b',
    ordem: num(r.ORDEM),
    ativo: txt(r.ATIVO) !== 'N',
    final: txt(r.FINAL) === 'S',
  };
}

async function lerStatus(db) {
  return (await query(db, 'SELECT * FROM GESTOR_OS_STATUS ORDER BY ORDEM, ID_STATUS')).map(mapStatus);
}

async function listarStatus() {
  return comBase(async (db) => ({ statuses: await lerStatus(db), icones: ICONES, cores: CORES }));
}

async function salvarStatus(body) {
  const descricao = txt(body?.descricao, 60);
  if (!descricao) throw new Error('Informe a descrição do status.');
  const icone = ICONES.includes(body?.icone) ? body.icone : 'pasta';
  const cor = CORES.includes(String(body?.cor || '').toLowerCase()) ? String(body.cor).toLowerCase() : CORES[CORES.length - 1];
  return comBase(async (db) => {
    let id = num(body?.id);
    if (id) {
      const tem = await query(db, 'SELECT 1 AS OK FROM GESTOR_OS_STATUS WHERE ID_STATUS = ?', [id]);
      if (!tem.length) throw new Error('Status não encontrado.');
      await query(db, `
        UPDATE GESTOR_OS_STATUS SET DESCRICAO = ?, ICONE = ?, COR = ?, ATIVO = ?, FINAL = ?
        WHERE ID_STATUS = ?`, [descricao, icone, cor, sn(body?.ativo !== false), sn(body?.final), id]);
    } else {
      id = await gerar(db, 'GESTOR_GEN_OS_STATUS');
      const max = await query(db, 'SELECT COALESCE(MAX(ORDEM), 0) AS M FROM GESTOR_OS_STATUS');
      await query(db, `
        INSERT INTO GESTOR_OS_STATUS (ID_STATUS, DESCRICAO, ICONE, COR, ORDEM, ATIVO, FINAL)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, [id, descricao, icone, cor, num(max[0]?.M) + 1, sn(body?.ativo !== false), sn(body?.final)]);
    }
    const ativos = (await lerStatus(db)).filter((s) => s.ativo);
    if (!ativos.length) {
      await query(db, "UPDATE GESTOR_OS_STATUS SET ATIVO = 'S' WHERE ID_STATUS = ?", [id]);
      throw new Error('Deixe ao menos um status ativo.');
    }
    return { id, statuses: await lerStatus(db) };
  });
}

async function ordenarStatus(ids) {
  const lista = (ids || []).map(num).filter(Boolean);
  return comBase(async (db) => {
    let ordem = 0;
    for (const id of lista) {
      ordem += 1;
      await query(db, 'UPDATE GESTOR_OS_STATUS SET ORDEM = ? WHERE ID_STATUS = ?', [ordem, id]);
    }
    return { statuses: await lerStatus(db) };
  });
}

function foneFuncionario(r) {
  const ddd = String(r?.DDD ?? '').replace(/\D/g, '');
  const cel = String(r?.CELULAR ?? '').replace(/\D/g, '');
  if (!cel) return '';
  return cel.length >= 10 ? cel : `${ddd}${cel}`;
}

/** Id do papel no cadastro de funcionários (Atendente, Vendedor, Técnico, ...). */
async function idPapel(db, nome) {
  if (!(await columnExists(db, 'TB_FUNC_PAPEL', 'ID_PAPEL'))) return null;
  if (!(await columnExists(db, 'TB_FUNC_PAPEL_TIPO_SIS', 'DESCRICAO'))) return null;
  const rows = await query(db, 'SELECT ID_PAPEL, DESCRICAO FROM TB_FUNC_PAPEL_TIPO_SIS');
  const alvo = semAcento(nome);
  const hit = rows.find((r) => semAcento(r.DESCRICAO) === alvo);
  return hit ? num(hit.ID_PAPEL) : null;
}

async function lerFuncionarios(db) {
  const papelTecnico = await idPapel(db, 'Técnico');
  const tecnicoSql = papelTecnico
    ? `(SELECT FIRST 1 'S' FROM TB_FUNC_PAPEL P WHERE P.ID_FUNCIONARIO = F.ID_FUNCIONARIO AND P.ID_PAPEL = ${papelTecnico})`
    : 'G.TECNICO';
  const rows = await query(db, `
    SELECT F.ID_FUNCIONARIO, F.NOME, F.STATUS, F.DDD, F.CELULAR, G.GERENTE, ${tecnicoSql} AS TECNICO
    FROM TB_FUNCIONARIO F
    LEFT JOIN GESTOR_OS_FUNC G ON G.ID_FUNCIONARIO = F.ID_FUNCIONARIO
    WHERE (F.STATUS = 'A' OR F.STATUS IS NULL) AND F.ID_FUNCIONARIO <> 0
    ORDER BY F.NOME`);
  return rows.map((r) => ({
    id: num(r.ID_FUNCIONARIO),
    nome: txt(r.NOME),
    iniciais: iniciais(r.NOME),
    celular: foneFuncionario(r),
    tecnico: txt(r.TECNICO) === 'S',
    gerente: txt(r.GERENTE) === 'S',
  }));
}

async function listarFuncionarios() {
  return comBase(async (db) => ({ funcionarios: await lerFuncionarios(db) }));
}

async function salvarFuncionario(id, body) {
  const codigo = num(id);
  if (!codigo) throw new Error('Funcionário inválido.');
  return comBase(async (db) => {
    await query(db, `
      UPDATE OR INSERT INTO GESTOR_OS_FUNC (ID_FUNCIONARIO, TECNICO, GERENTE)
      VALUES (?, ?, ?) MATCHING (ID_FUNCIONARIO)`, [codigo, sn(body?.tecnico), sn(body?.gerente)]);
    return { funcionarios: await lerFuncionarios(db) };
  });
}

function mapMensagem(r) {
  return {
    id: num(r.ID),
    titulo: txt(r.TITULO),
    texto: texto(r.TEXTO),
    evento: EVENTOS_MSG[txt(r.EVENTO)] ? txt(r.EVENTO) : 'atribuida',
    ativo: txt(r.ATIVO) !== 'N',
  };
}

async function listarMensagens() {
  return comBase(async (db) => ({
    mensagens: (await query(db, 'SELECT * FROM GESTOR_OS_MENSAGEM ORDER BY ID')).map(mapMensagem),
    eventos: EVENTOS_MSG,
    automaticos: ['atribuida'],
  }));
}

async function salvarMensagem(body) {
  const titulo = txt(body?.titulo, 80);
  const corpo = texto(body?.texto, 1000);
  if (!titulo) throw new Error('Informe o título da mensagem.');
  if (!corpo) throw new Error('Escreva o texto da mensagem.');
  const evento = EVENTOS_MSG[body?.evento] ? body.evento : 'atribuida';
  return comBase(async (db) => {
    let id = num(body?.id);
    if (id) {
      await query(db, 'UPDATE GESTOR_OS_MENSAGEM SET TITULO = ?, TEXTO = ?, EVENTO = ?, ATIVO = ? WHERE ID = ?',
        [titulo, corpo, evento, sn(body?.ativo !== false), id]);
    } else {
      id = await gerar(db, 'GESTOR_GEN_OS_MSG');
      await query(db, 'INSERT INTO GESTOR_OS_MENSAGEM (ID, TITULO, TEXTO, EVENTO, ATIVO) VALUES (?, ?, ?, ?, ?)',
        [id, titulo, corpo, evento, sn(body?.ativo !== false)]);
    }
    return { id };
  });
}

async function excluirMensagem(id) {
  return comBase(async (db) => {
    await query(db, 'DELETE FROM GESTOR_OS_MENSAGEM WHERE ID = ?', [num(id)]);
    return {};
  });
}

/* ------------------------------------------------------------------ */
/* Base de soluções (lâmpada)                                          */
/* ------------------------------------------------------------------ */

const PALAVRAS_VAZIAS = new Set(['que', 'com', 'sem', 'nao', 'para', 'por', 'uma', 'umas', 'uns', 'dos', 'das', 'nos', 'nas', 'esta', 'esta', 'tem', 'mas', 'quando', 'muito', 'pouco', 'mais', 'cliente', 'relata', 'aparelho', 'equipamento', 'ele', 'ela', 'isso', 'esse', 'essa', 'foi', 'ser', 'ter', 'dia', 'dias', 'apos', 'depois']);

function palavras(s) {
  return [...new Set(semAcento(s).split(/[^a-z0-9]+/).filter((p) => p.length >= 3 && !PALAVRAS_VAZIAS.has(p)))];
}

function mapSolucao(r) {
  return {
    id: num(r.ID),
    defeito: texto(r.DEFEITO),
    solucao: texto(r.SOLUCAO),
    equipamento: txt(r.EQUIPAMENTO),
    id_os: num(r.ID_OS) || null,
    usos: num(r.USOS),
    data: dataBr(r.DT),
  };
}

async function listarSolucoes(q) {
  const termo = txt(q, 100);
  return comBase(async (db) => {
    const where = [];
    const params = [];
    for (const p of termo.split(/\s+/).filter(Boolean)) {
      where.push('(UPPER(DEFEITO) CONTAINING UPPER(?) OR UPPER(SOLUCAO) CONTAINING UPPER(?) OR UPPER(EQUIPAMENTO) CONTAINING UPPER(?))');
      params.push(p, p, p);
    }
    const rows = await query(db, `
      SELECT FIRST 300 * FROM GESTOR_OS_SOLUCAO
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY USOS DESC, DT DESC`, params);
    return { solucoes: rows.map(mapSolucao) };
  });
}

/** Defeitos parecidos: conta as palavras em comum (prefixo de 5 letras aceita "liga"/"ligar"), depois os mais usados. */
async function sugerirSolucoes(defeito, equipamento) {
  const alvo = palavras(`${defeito || ''} ${equipamento || ''}`);
  if (!alvo.length) return { solucoes: [], palavras: [] };
  return comBase(async (db) => {
    const rows = await query(db, 'SELECT FIRST 3000 * FROM GESTOR_OS_SOLUCAO ORDER BY USOS DESC');
    const raiz = (p) => p.slice(0, 5);
    const alvoRaiz = new Set(alvo.map(raiz));
    const lista = rows.map((r) => {
      const s = mapSolucao(r);
      const ps = palavras(`${s.defeito} ${s.equipamento}`);
      const comuns = ps.filter((p) => alvoRaiz.has(raiz(p)));
      return { ...s, comuns, pontos: comuns.length };
    }).filter((s) => s.pontos > 0);
    lista.sort((a, b) => b.pontos - a.pontos || b.usos - a.usos);
    return { solucoes: lista.slice(0, 12), palavras: alvo };
  });
}

async function salvarSolucao(id, body) {
  const defeito = texto(body?.defeito, 2000);
  const solucao = texto(body?.solucao, 2000);
  if (!defeito || !solucao) throw new Error('Preencha o defeito e a solução.');
  return comBase(async (db) => {
    let codigo = num(id);
    if (codigo) {
      await query(db, 'UPDATE GESTOR_OS_SOLUCAO SET DEFEITO = ?, SOLUCAO = ?, EQUIPAMENTO = ? WHERE ID = ?',
        [defeito, solucao, txt(body?.equipamento, 300), codigo]);
    } else {
      codigo = await gerar(db, 'GESTOR_GEN_OS_SOL');
      await query(db, `
        INSERT INTO GESTOR_OS_SOLUCAO (ID, DEFEITO, SOLUCAO, EQUIPAMENTO, ID_OS, USOS, DT)
        VALUES (?, ?, ?, ?, NULL, 1, CURRENT_TIMESTAMP)`, [codigo, defeito, solucao, txt(body?.equipamento, 300)]);
    }
    return { id: codigo };
  });
}

async function excluirSolucao(id) {
  return comBase(async (db) => {
    await query(db, 'DELETE FROM GESTOR_OS_SOLUCAO WHERE ID = ?', [num(id)]);
    return {};
  });
}

async function usarSolucao(id) {
  return comBase(async (db) => {
    await query(db, 'UPDATE GESTOR_OS_SOLUCAO SET USOS = COALESCE(USOS, 0) + 1 WHERE ID = ?', [num(id)]);
    return {};
  });
}

/** Ao finalizar com solução: grava na base, ou soma um uso se a mesma solução já existe. */
async function registrarSolucao(db, os) {
  const defeito = texto(os.defeito, 2000);
  const solucao = texto(os.solucao, 2000);
  if (!defeito || !solucao) return;
  // A mesma O.S finalizada de novo só atualiza o texto; a mesma solução vinda de outra O.S soma um uso.
  const daOs = await query(db, 'SELECT FIRST 1 ID FROM GESTOR_OS_SOLUCAO WHERE ID_OS = ?', [os.id]);
  if (daOs.length) {
    await query(db, 'UPDATE GESTOR_OS_SOLUCAO SET SOLUCAO = ?, DEFEITO = ?, EQUIPAMENTO = ?, DT = CURRENT_TIMESTAMP WHERE ID = ?',
      [solucao, defeito, txt(os.equipamento, 300), num(daOs[0].ID)]);
    return;
  }
  const iguais = await query(db, `
    SELECT FIRST 1 ID FROM GESTOR_OS_SOLUCAO
    WHERE UPPER(DEFEITO) = UPPER(?) AND UPPER(SOLUCAO) = UPPER(?)`, [defeito, solucao]);
  if (iguais.length) {
    await query(db, 'UPDATE GESTOR_OS_SOLUCAO SET USOS = COALESCE(USOS, 0) + 1, DT = CURRENT_TIMESTAMP WHERE ID = ?', [num(iguais[0].ID)]);
    return;
  }
  const id = await gerar(db, 'GESTOR_GEN_OS_SOL');
  await query(db, `
    INSERT INTO GESTOR_OS_SOLUCAO (ID, DEFEITO, SOLUCAO, EQUIPAMENTO, ID_OS, USOS, DT)
    VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`, [id, defeito, solucao, txt(os.equipamento, 300), os.id]);
}

/* ------------------------------------------------------------------ */
/* Cliente                                                             */
/* ------------------------------------------------------------------ */

function soDigitos(v) {
  return String(v ?? '').replace(/\D/g, '');
}

function fmtDoc(v) {
  const d = soDigitos(v);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return txt(v);
}

function foneCliente(r) {
  const par = (ddd, n) => {
    const numero = soDigitos(n);
    if (!numero) return '';
    const d = soDigitos(ddd);
    return d && numero.length <= 9 ? `${d}${numero}` : numero;
  };
  return par(r.DDD_CELUL, r.FONE_CELUL) || par(r.DDD_RESID, r.FONE_RESID) || par(r.DDD_COMER, r.FONE_COMER);
}

function fmtFone(v) {
  const d = soDigitos(v);
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return d;
}

async function lerCliente(db, idCliente) {
  const temCidade = hasTable('TB_CIDADE_SIS');
  const rows = await query(db, `
    SELECT C.ID_CLIENTE, C.NOME, C.STATUS, C.CONTATO, C.EMAIL_CONT, C.EMAIL_NFE,
           C.DDD_CELUL, C.FONE_CELUL, C.DDD_RESID, C.FONE_RESID, C.DDD_COMER, C.FONE_COMER,
           C.END_CEP, C.END_TIPO, C.END_LOGRAD, C.END_NUMERO, C.END_BAIRRO, C.END_COMPLE, C.ID_CIDADE,
           CAST(C.OBSERVACAO AS VARCHAR(1000)) AS OBS, C.MENSAGEM, C.LIMITE,
           ${temCidade ? 'CID.NOME AS CIDADE, CID.SIGLA_UF AS UF' : 'CAST(NULL AS VARCHAR(60)) AS CIDADE, CAST(NULL AS VARCHAR(2)) AS UF'},
           PF.CPF, PF.IDENTIDADE, PF.DT_NASCTO, PJ.CNPJ, PJ.NOME_FANTA, PJ.INSC_ESTAD
    FROM TB_CLIENTE C
    ${temCidade ? 'LEFT JOIN TB_CIDADE_SIS CID ON CID.ID_CIDADE = C.ID_CIDADE' : ''}
    LEFT JOIN TB_CLI_PF PF ON PF.ID_CLIENTE = C.ID_CLIENTE
    LEFT JOIN TB_CLI_PJ PJ ON PJ.ID_CLIENTE = C.ID_CLIENTE
    WHERE C.ID_CLIENTE = ?`, [num(idCliente)]);
  const r = rows[0];
  if (!r) return null;
  const rua = [txt(r.END_TIPO), txt(r.END_LOGRAD)].filter(Boolean).join(' ');
  const linha1 = [rua, [txt(r.END_NUMERO), txt(r.END_COMPLE)].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const cidade = [txt(r.CIDADE), txt(r.UF)].filter(Boolean).join('/');
  const endereco = [linha1, txt(r.END_BAIRRO), cidade, txt(r.END_CEP) ? `CEP ${txt(r.END_CEP)}` : ''].filter(Boolean).join(' — ');
  const dados = {};
  for (const [k, v] of Object.entries(r)) {
    if (v == null || typeof v === 'function' || Buffer.isBuffer(v)) continue;
    dados[k] = v instanceof Date ? dataIso(v) : (typeof v === 'string' ? v.trim() : v);
  }
  return {
    id: num(r.ID_CLIENTE),
    nome: txt(r.NOME),
    fantasia: txt(r.NOME_FANTA),
    documento: fmtDoc(txt(r.CNPJ) || txt(r.CPF)),
    telefone: foneCliente(r),
    endereco,
    observacao: texto(r.OBS),
    ativo: txt(r.STATUS) !== 'I',
    dados,
  };
}

async function clienteResumo(idCliente) {
  return comBase(async (db) => {
    const cli = await lerCliente(db, idCliente);
    if (!cli) throw new Error('Cliente não encontrado.');
    const abertas = await query(db, `
      SELECT COUNT(*) AS N FROM GESTOR_OS O
      LEFT JOIN GESTOR_OS_STATUS S ON S.ID_STATUS = O.ID_STATUS
      WHERE O.ID_CLIENTE = ? AND COALESCE(S.FINAL, 'N') <> 'S'`, [cli.id]);
    const { dados, ...resto } = cli;
    return { cliente: { ...resto, os_abertas: num(abertas[0]?.N) } };
  });
}

async function buscarClientes(q) {
  const termo = txt(q, 60);
  if (!termo) return { clientes: [] };
  return comBase(async (db) => {
    const digitos = soDigitos(termo);
    let rows;
    if (/^\d+$/.test(termo) && termo.length <= 9) {
      rows = await query(db, `
        SELECT FIRST 12 C.ID_CLIENTE, C.NOME, C.DDD_CELUL, C.FONE_CELUL, C.DDD_RESID, C.FONE_RESID, C.DDD_COMER, C.FONE_COMER, PF.CPF, PJ.CNPJ
        FROM TB_CLIENTE C
        LEFT JOIN TB_CLI_PF PF ON PF.ID_CLIENTE = C.ID_CLIENTE
        LEFT JOIN TB_CLI_PJ PJ ON PJ.ID_CLIENTE = C.ID_CLIENTE
        WHERE C.ID_CLIENTE = ? OR UPPER(C.NOME) CONTAINING UPPER(?)
        ORDER BY CASE WHEN C.ID_CLIENTE = ? THEN 0 ELSE 1 END, C.NOME`, [Number(termo), termo, Number(termo)]);
    } else if (digitos.length === 11 || digitos.length === 14) {
      rows = await query(db, `
        SELECT FIRST 12 C.ID_CLIENTE, C.NOME, C.DDD_CELUL, C.FONE_CELUL, C.DDD_RESID, C.FONE_RESID, C.DDD_COMER, C.FONE_COMER, PF.CPF, PJ.CNPJ
        FROM TB_CLIENTE C
        LEFT JOIN TB_CLI_PF PF ON PF.ID_CLIENTE = C.ID_CLIENTE
        LEFT JOIN TB_CLI_PJ PJ ON PJ.ID_CLIENTE = C.ID_CLIENTE
        WHERE PF.CPF CONTAINING ? OR PJ.CNPJ CONTAINING ? OR PF.CPF = ? OR PJ.CNPJ = ?
        ORDER BY C.NOME`, [digitos, digitos, fmtDoc(digitos), fmtDoc(digitos)]);
    } else {
      const partes = termo.split(/\s+/).filter(Boolean);
      rows = await query(db, `
        SELECT FIRST 12 C.ID_CLIENTE, C.NOME, C.DDD_CELUL, C.FONE_CELUL, C.DDD_RESID, C.FONE_RESID, C.DDD_COMER, C.FONE_COMER, PF.CPF, PJ.CNPJ
        FROM TB_CLIENTE C
        LEFT JOIN TB_CLI_PF PF ON PF.ID_CLIENTE = C.ID_CLIENTE
        LEFT JOIN TB_CLI_PJ PJ ON PJ.ID_CLIENTE = C.ID_CLIENTE
        WHERE ${partes.map(() => 'UPPER(C.NOME) CONTAINING UPPER(?)').join(' AND ')}
        ORDER BY C.NOME`, partes);
    }
    return {
      clientes: rows.map((r) => ({
        id: num(r.ID_CLIENTE),
        nome: txt(r.NOME),
        documento: fmtDoc(txt(r.CNPJ) || txt(r.CPF)),
        telefone: fmtFone(foneCliente(r)),
      })),
    };
  });
}

function semAcento(v) {
  return txt(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function montarCategoria(cat, sub) {
  const nome = txt(cat?.NOME);
  const subnome = txt(sub?.NOME);
  return {
    id_categoria: num(sub ? sub.ID_PAI : cat?.ID) || null,
    id_subcategoria: sub ? num(sub.ID) : null,
    categoria: nome,
    subcategoria: subnome,
    rotulo: subnome ? `${nome} › ${subnome}` : nome,
    nome: subnome || nome,
    detalhe: subnome ? nome : 'Categoria',
  };
}

/** Sem pai, só categorias. Com pai, só as subcategorias daquela categoria. */
async function buscarCategorias(q, pai) {
  const termo = semAcento(q);
  const paiId = num(pai);
  return comBase(async (db) => {
    const rows = await query(db, `
      SELECT C.ID, C.ID_PAI, C.NOME, P.NOME AS PAI
      FROM GESTOR_OS_CATEGORIA C
      LEFT JOIN GESTOR_OS_CATEGORIA P ON P.ID = C.ID_PAI
      WHERE COALESCE(C.ATIVO, 'S') <> 'N'
      ORDER BY COALESCE(P.NOME, C.NOME), C.ID_PAI, C.NOME`);
    const itens = [];
    for (const r of rows) {
      const idPai = num(r.ID_PAI);
      if (paiId) {
        if (idPai !== paiId) continue;
      } else if (idPai) continue;
      const cat = idPai ? { ID: idPai, NOME: r.PAI } : r;
      const sub = idPai ? r : null;
      const item = montarCategoria(cat, sub);
      const alvo = semAcento(item.nome);
      if (termo && !alvo.includes(termo)) continue;
      itens.push(item);
      if (itens.length >= 40) break;
    }
    return { categorias: itens };
  });
}

/** Cria a categoria e, se vier preenchida, a subcategoria. Nome já existente é reaproveitado. */
async function cadastrarCategoria(body) {
  const nome = txt(body?.categoria, 80);
  const subnome = txt(body?.subcategoria, 80);
  if (!nome) throw new Error('Informe a categoria.');
  return comBase(async (db) => {
    const achar = async (pai, texto) => {
      const rows = await query(db, `
        SELECT ID, ID_PAI, NOME FROM GESTOR_OS_CATEGORIA
        WHERE COALESCE(ATIVO, 'S') <> 'N' AND ${pai ? 'ID_PAI = ?' : 'ID_PAI IS NULL'}`, pai ? [pai] : []);
      return rows.find((r) => semAcento(r.NOME) === semAcento(texto)) || null;
    };
    let cat = await achar(null, nome);
    if (!cat) {
      const id = await gerar(db, 'GESTOR_GEN_OS_CAT');
      await query(db, 'INSERT INTO GESTOR_OS_CATEGORIA (ID, ID_PAI, NOME, ATIVO) VALUES (?, NULL, ?, \'S\')', [id, nome]);
      cat = { ID: id, ID_PAI: null, NOME: nome };
    }
    let sub = null;
    if (subnome) {
      sub = await achar(num(cat.ID), subnome);
      if (!sub) {
        const id = await gerar(db, 'GESTOR_GEN_OS_CAT');
        await query(db, 'INSERT INTO GESTOR_OS_CATEGORIA (ID, ID_PAI, NOME, ATIVO) VALUES (?, ?, ?, \'S\')', [id, num(cat.ID), subnome]);
        sub = { ID: id, ID_PAI: num(cat.ID), NOME: subnome };
      }
    }
    return { categoria: montarCategoria(cat, sub) };
  });
}

async function resolverCategoria(db, idCat, idSub) {
  const subId = num(idSub) || null;
  const catId = num(idCat) || null;
  if (!subId && !catId) return { id_categoria: null, id_subcategoria: null };
  if (subId) {
    const rows = await query(db, 'SELECT ID, ID_PAI, NOME FROM GESTOR_OS_CATEGORIA WHERE ID = ? AND COALESCE(ATIVO, \'S\') <> \'N\'', [subId]);
    if (!rows.length || !num(rows[0].ID_PAI)) throw new Error('Subcategoria não encontrada.');
    return { id_categoria: num(rows[0].ID_PAI), id_subcategoria: subId };
  }
  const rows = await query(db, 'SELECT ID FROM GESTOR_OS_CATEGORIA WHERE ID = ? AND ID_PAI IS NULL AND COALESCE(ATIVO, \'S\') <> \'N\'', [catId]);
  if (!rows.length) throw new Error('Categoria não encontrada.');
  return { id_categoria: catId, id_subcategoria: null };
}

async function preencherCategoria(db, os) {
  os.categoria = '';
  os.subcategoria = '';
  if (!os.id_categoria && !os.id_subcategoria) return;
  const ids = [os.id_categoria, os.id_subcategoria].filter(Boolean);
  const rows = await query(db, `SELECT ID, NOME FROM GESTOR_OS_CATEGORIA WHERE ID IN (${ids.map(() => '?').join(',')})`, ids);
  const porId = new Map(rows.map((r) => [num(r.ID), txt(r.NOME)]));
  os.categoria = porId.get(os.id_categoria) || '';
  os.subcategoria = porId.get(os.id_subcategoria) || '';
}

/** Dados do CNPJ pela BrasilAPI (gratuita), já no formato do cadastro de clientes. */
async function consultarCnpj(cnpj) {
  const d = soDigitos(cnpj);
  if (d.length !== 14) throw new Error('Informe um CNPJ com 14 dígitos.');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  let res;
  try {
    res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${d}`, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? 'A consulta do CNPJ demorou demais. Tente de novo ou preencha à mão.' : 'Sem internet para consultar o CNPJ. Preencha à mão.');
  } finally {
    clearTimeout(t);
  }
  if (res.status === 404) throw new Error('CNPJ não encontrado na Receita.');
  if (!res.ok) throw new Error('A consulta do CNPJ não respondeu agora. Tente de novo ou preencha à mão.');
  const j = await res.json();
  const fone = soDigitos(j.ddd_telefone_1 || '');
  const uf = txt(j.uf, 2).toUpperCase();
  const municipio = txt(j.municipio);
  let cidade = null;
  if (municipio && hasTable('TB_CIDADE_SIS')) {
    cidade = await withDb(async (db) => {
      const rows = await query(db, `
        SELECT FIRST 1 ID_CIDADE, NOME, SIGLA_UF FROM TB_CIDADE_SIS
        WHERE UPPER(NOME) = UPPER(?) AND SIGLA_UF = ?`, [municipio, uf]);
      return rows[0] ? { id: num(rows[0].ID_CIDADE), nome: txt(rows[0].NOME), uf: txt(rows[0].SIGLA_UF) } : null;
    }).catch(() => null);
  }
  const tipoRua = txt(j.descricao_tipo_de_logradouro, 15);
  return {
    cnpj: fmtDoc(d),
    nome: txt(j.razao_social, 60),
    fantasia: txt(j.nome_fantasia, 40),
    cep: soDigitos(j.cep),
    end_tipo: tipoRua,
    logradouro: txt(j.logradouro, 40),
    numero: txt(j.numero, 5),
    complemento: txt(j.complemento, 30),
    bairro: txt(j.bairro, 35),
    id_cidade: cidade?.id || null,
    cidade: cidade ? `${cidade.nome}/${cidade.uf}` : [municipio, uf].filter(Boolean).join('/'),
    comercial: fone,
    email: txt(j.email, 70),
    situacao: txt(j.descricao_situacao_cadastral),
  };
}

/* ------------------------------------------------------------------ */
/* Busca de itens                                                      */
/* ------------------------------------------------------------------ */

const SQL_TIPO = `CASE WHEN E.ID_TIPOITEM IS NULL OR TRIM(E.ID_TIPOITEM) = '' THEN NULL
  ELSE COALESCE(NULLIF(TRIM(LEADING '0' FROM TRIM(E.ID_TIPOITEM)), ''), '0') END`;

async function buscarItens(q, aba) {
  const termo = txt(q, 60);
  if (!termo) return { itens: [] };
  const tipos = aba === 'servicos' ? TIPOS_SERVICO : TIPOS_PRODUTO;
  return comBase(async (db, appCfg) => {
    const t = activeTargets(appCfg)[0]?.tables;
    if (!t) return { itens: [] };
    const filtroTipo = `(${SQL_TIPO}) IN (${tipos.map((x) => `'${x}'`).join(',')})`;
    const temCmpl = await columnExists(db, t.produto, 'DESC_CMPL');
    const temInf = await columnExists(db, t.estoque, 'INFCOMPLEMENTAR');
    const temReserv = await columnExists(db, t.produto, 'QTD_RESERV');
    const cmpl = temCmpl ? 'P.DESC_CMPL' : 'CAST(NULL AS VARCHAR(30))';
    const inf = temInf ? 'E.INFCOMPLEMENTAR' : 'CAST(NULL AS VARCHAR(30))';
    const cols = `I.ID_IDENTIFICADOR, E.DESCRICAO, E.PRC_VENDA, E.UNI_MEDIDA, E.ID_TIPOITEM, E.GRADE_SERIE,
      P.COD_BARRA, P.REFERENCIA, ${cmpl} AS DESC_CMPL, P.QTD_ATUAL, ${temReserv ? 'P.QTD_RESERV' : '0'} AS QTD_RESERV,
      N1.DESCRICAO AS COR, N2.DESCRICAO AS TAMANHO`;
    const base = `FROM ${t.estoque} E
      JOIN ${t.identificador} I ON I.ID_ESTOQUE = E.ID_ESTOQUE
      JOIN ${t.produto} P ON P.ID_IDENTIFICADOR = I.ID_IDENTIFICADOR
      LEFT JOIN ${t.nivel1} N1 ON N1.ID_NIVEL1 = P.ID_NIVEL1
      LEFT JOIN ${t.nivel2} N2 ON N2.ID_NIVEL2 = P.ID_NIVEL2
      WHERE (E.STATUS = 'A' OR E.STATUS IS NULL) AND ${filtroTipo}`;
    const vistos = new Map();
    const juntar = (rows, parecido) => {
      for (const r of rows) {
        const id = num(r.ID_IDENTIFICADOR);
        if (!vistos.has(id)) vistos.set(id, { r, parecido });
      }
    };
    const n = Number(termo);
    if (/^\d+$/.test(termo)) {
      const exatos = [];
      const params = [];
      if (Number.isSafeInteger(n) && n <= 2147483647) { exatos.push('I.ID_IDENTIFICADOR = ?'); params.push(n); }
      exatos.push('TRIM(P.COD_BARRA) = ?'); params.push(termo);
      juntar(await query(db, `SELECT FIRST 10 ${cols} ${base} AND (${exatos.join(' OR ')})`, params), false);
    }
    const partes = termo.split(/\s+/).filter(Boolean);
    const cond = partes.map(() => `(UPPER(E.DESCRICAO) CONTAINING UPPER(?) OR UPPER(COALESCE(P.REFERENCIA, '')) CONTAINING UPPER(?)
      OR UPPER(COALESCE(${cmpl}, '')) CONTAINING UPPER(?) OR UPPER(COALESCE(${inf}, '')) CONTAINING UPPER(?))`);
    juntar(await query(db, `SELECT FIRST 25 ${cols} ${base} AND ${cond.join(' AND ')} ORDER BY E.DESCRICAO`,
      partes.flatMap((p) => [p, p, p, p])), false);
    if (vistos.size < 5 && partes.length) {
      // Parecidos: cada palavra pelo começo (4 letras), qualquer uma delas.
      const raizes = partes.map((p) => p.slice(0, Math.min(4, p.length))).filter((p) => p.length >= 3);
      if (raizes.length) {
        juntar(await query(db, `SELECT FIRST 15 ${cols} ${base} AND (${raizes.map(() => 'UPPER(E.DESCRICAO) CONTAINING UPPER(?)').join(' OR ')}) ORDER BY E.DESCRICAO`, raizes), true);
      }
    }
    const itens = [...vistos.values()].slice(0, 30).map(({ r, parecido }) => {
      const tipo = tipoItem(r.ID_TIPOITEM);
      const grade = String(r.GRADE_SERIE || '').trim().toUpperCase() === 'G';
      const descricao = grade ? [txt(r.DESCRICAO), txt(r.COR), txt(r.TAMANHO)].filter(Boolean).join(' - ') : txt(r.DESCRICAO);
      return {
        id_identificador: num(r.ID_IDENTIFICADOR),
        descricao,
        tipo,
        servico: tipo === '9',
        unidade: txt(r.UNI_MEDIDA) || 'UN',
        prc_venda: num(r.PRC_VENDA),
        cod_barras: txt(r.COD_BARRA),
        referencia: txt(r.REFERENCIA),
        complemento: txt(r.DESC_CMPL),
        disponivel: Math.round((num(r.QTD_ATUAL) - num(r.QTD_RESERV)) * 1000) / 1000,
        parecido,
      };
    });
    return { itens };
  });
}

/* ------------------------------------------------------------------ */
/* Cálculo: rateio e totais (o mesmo cálculo roda na tela)             */
/* ------------------------------------------------------------------ */

function baseItem(it) {
  return r2(num(it.qtd) * num(it.vlr_unit) - num(it.desc_item) + num(it.acres_item));
}

/** Divide o valor pelo total de cada item; a sobra dos centavos vai para o item de maior valor. */
function ratear(itens, valor, campo) {
  const total = itens.reduce((s, it) => s + Math.max(0, baseItem(it)), 0);
  for (const it of itens) it[campo] = 0;
  const v = r2(valor);
  if (!(v > 0) || !(total > 0)) return;
  let soma = 0;
  for (const it of itens) {
    it[campo] = r2((v * Math.max(0, baseItem(it))) / total);
    soma = r2(soma + it[campo]);
  }
  const resto = r2(v - soma);
  if (resto) {
    const maior = itens.reduce((a, b) => (baseItem(b) > baseItem(a) ? b : a), itens[0]);
    maior[campo] = r2(maior[campo] + resto);
  }
}

function calcular(os) {
  const itens = (os.itens || []).map((it) => ({ ...it }));
  ratear(itens, os.desc_geral, 'rateio_desc');
  ratear(itens, os.acres_geral, 'rateio_acres');
  let brutoP = 0; let brutoS = 0; let descItens = 0; let acresItens = 0;
  for (const it of itens) {
    const bruto = r2(num(it.qtd) * num(it.vlr_unit));
    if (it.tipo === 'S') brutoS = r2(brutoS + bruto); else brutoP = r2(brutoP + bruto);
    descItens = r2(descItens + num(it.desc_item));
    acresItens = r2(acresItens + num(it.acres_item));
    it.total = r2(baseItem(it) - num(it.rateio_desc) + num(it.rateio_acres));
  }
  const descTotal = r2(descItens + num(os.desc_geral));
  const acresTotal = r2(acresItens + num(os.acres_geral));
  const total = r2(brutoP + brutoS - descTotal + acresTotal + num(os.frete) + num(os.deslocamento));
  return {
    itens,
    totais: {
      bruto_produtos: brutoP,
      bruto_servicos: brutoS,
      desc_produtos: r2(itens.filter((i) => i.tipo !== 'S').reduce((s, i) => s + num(i.desc_item), 0)),
      acres_produtos: r2(itens.filter((i) => i.tipo !== 'S').reduce((s, i) => s + num(i.acres_item), 0)),
      desc_servicos: r2(itens.filter((i) => i.tipo === 'S').reduce((s, i) => s + num(i.desc_item), 0)),
      acres_servicos: r2(itens.filter((i) => i.tipo === 'S').reduce((s, i) => s + num(i.acres_item), 0)),
      desconto_total: descTotal,
      acrescimo_total: acresTotal,
      frete: r2(os.frete),
      deslocamento: r2(os.deslocamento),
      total: Math.max(0, total),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Limites de desconto e liberação                                     */
/* ------------------------------------------------------------------ */

const SEGREDO_LIBERACAO = crypto.randomBytes(32);

function lerLimites() {
  const cfg = loadAppConfig();
  const item = Number(cfg.os_limite_desc_item);
  const geral = Number(cfg.os_limite_desc_geral);
  return {
    item: Number.isFinite(item) && item > 0 ? item : 0,
    geral: Number.isFinite(geral) && geral > 0 ? geral : 0,
  };
}

function salvarLimites(body) {
  const lim = (v) => {
    const n = Number(String(v ?? '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? Math.min(100, Math.round(n * 100) / 100) : 0;
  };
  const atual = loadAppConfig();
  saveAppConfig({ ...atual, os_limite_desc_item: lim(body?.item), os_limite_desc_geral: lim(body?.geral) });
  return lerLimites();
}

function assinar(dados) {
  const corpo = Buffer.from(JSON.stringify(dados)).toString('base64url');
  const sig = crypto.createHmac('sha256', SEGREDO_LIBERACAO).update(corpo).digest('base64url');
  return `${corpo}.${sig}`;
}

function lerLiberacao(token) {
  const [corpo, sig] = String(token || '').split('.');
  if (!corpo || !sig) return null;
  const esperado = crypto.createHmac('sha256', SEGREDO_LIBERACAO).update(corpo).digest('base64url');
  if (esperado.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(sig))) return null;
  try {
    const dados = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
    if (!(dados.exp > Date.now())) return null;
    return dados;
  } catch {
    return null;
  }
}

/** Supervisor (senha do Gestor) ou funcionário marcado como gerente na O.S (senha dele no Gestor). */
async function liberarDesconto({ idUsuario, senha, percentual, escopo }) {
  const { conferirSenhaUsuario } = require('./auth');
  const usuarios = loadUsersConfig(loadAppConfig()).usuarios || [];
  const user = usuarios.find((u) => Number(u.id) === Number(idUsuario));
  if (!user) throw new Error('Escolha quem vai liberar.');
  let pode = !!user.supervisor;
  if (!pode) {
    pode = await comBase(async (db) => {
      const r = await query(db, "SELECT 1 AS OK FROM GESTOR_OS_FUNC WHERE ID_FUNCIONARIO = ? AND GERENTE = 'S'", [Number(user.id)]);
      return r.length > 0;
    });
  }
  if (!pode) throw new Error('Só o supervisor ou um gerente pode liberar o desconto.');
  if (!(await conferirSenhaUsuario(user, String(senha || '')))) throw new Error('Senha incorreta.');
  const pct = Math.min(100, Math.max(0, Math.round(num(percentual) * 100) / 100));
  const dados = {
    escopo: escopo === 'geral' ? 'geral' : 'item',
    pct,
    id: Number(user.id),
    nome: user.supervisor ? 'Supervisor' : txt(user.nome),
    em: new Date().toISOString(),
    exp: Date.now() + 2 * 60 * 60 * 1000,
  };
  return { token: assinar(dados), liberado_por: dados.nome, percentual: pct };
}

/** Confere os descontos contra os limites; devolve as liberações usadas (para o histórico). */
function conferirDescontos(os, liberacoes) {
  const lim = lerLimites();
  const tokens = (liberacoes || []).map(lerLiberacao).filter(Boolean);
  const cobre = (escopo, pct) => tokens.find((t) => t.escopo === escopo && t.pct + 0.0001 >= pct);
  const usadas = new Map();
  if (lim.item > 0) {
    for (const it of os.itens) {
      const bruto = r2(num(it.qtd) * num(it.vlr_unit));
      if (!(bruto > 0) || !(num(it.desc_item) > 0)) continue;
      const pct = Math.round((num(it.desc_item) / bruto) * 10000) / 100;
      if (pct <= lim.item + 0.0001) continue;
      const t = cobre('item', pct);
      if (!t) throw new Error(`O desconto de ${pct.toLocaleString('pt-BR')}% em "${it.descricao}" passa do limite de ${lim.item.toLocaleString('pt-BR')}%. Peça a liberação do supervisor ou gerente.`);
      usadas.set(`item-${t.id}-${t.pct}`, { ...t, aplicado: pct });
    }
  }
  if (lim.geral > 0 && num(os.desc_geral) > 0) {
    const base = os.itens.reduce((s, it) => s + Math.max(0, baseItem(it)), 0);
    const pct = base > 0 ? Math.round((num(os.desc_geral) / base) * 10000) / 100 : 100;
    if (pct > lim.geral + 0.0001) {
      const t = cobre('geral', pct);
      if (!t) throw new Error(`O desconto geral de ${pct.toLocaleString('pt-BR')}% passa do limite de ${lim.geral.toLocaleString('pt-BR')}%. Peça a liberação do supervisor ou gerente.`);
      usadas.set(`geral-${t.id}-${t.pct}`, { ...t, aplicado: pct });
    }
  }
  return [...usadas.values()];
}

/* ------------------------------------------------------------------ */
/* O.S: leitura                                                        */
/* ------------------------------------------------------------------ */

function mapItem(r) {
  return {
    id: num(r.ID_ITEM),
    seq: num(r.SEQ),
    id_identificador: num(r.ID_IDENTIFICADOR),
    descricao: txt(r.DESCRICAO),
    tipo: txt(r.TIPO) === 'S' ? 'S' : 'P',
    unidade: txt(r.UNIDADE) || 'UN',
    qtd: num(r.QTD),
    vlr_unit: num(r.VLR_UNIT),
    desc_item: num(r.DESC_ITEM),
    acres_item: num(r.ACRES_ITEM),
    rateio_desc: num(r.RATEIO_DESC),
    rateio_acres: num(r.RATEIO_ACRES),
    total: num(r.TOTAL),
  };
}

function mapOs(r, funcs, statuses) {
  const tec = funcs?.get(num(r.ID_TECNICO));
  const st = statuses?.get(num(r.ID_STATUS));
  const previsao = dataIso(r.DT_PREVISAO);
  return {
    id: num(r.ID_OS),
    numero: num(r.ID_OS),
    emissao: dataHoraIso(r.DT_EMISSAO),
    emissao_br: dataHoraBr(r.DT_EMISSAO),
    tipo: txt(r.TIPO) === 'E' ? 'E' : 'I',
    modalidade: txt(r.MODALIDADE) === 'R' ? 'R' : 'P',
    id_status: num(r.ID_STATUS),
    status: st || null,
    id_tecnico: num(r.ID_TECNICO) || null,
    tecnico: tec ? { id: tec.id, nome: tec.nome, iniciais: tec.iniciais } : null,
    quem_trouxe: txt(r.QUEM_TROUXE),
    id_categoria: num(r.ID_CATEGORIA) || null,
    id_subcategoria: num(r.ID_SUBCATEGORIA) || null,
    categoria: '',
    subcategoria: '',
    equipamento: txt(r.EQUIPAMENTO),
    defeito: texto(r.DEFEITO),
    autorizacao: texto(r.AUTORIZACAO),
    autor_status: autorStatus(r.AUTOR_STATUS),
    autor_rotulo: rotuloAutor(r.AUTOR_STATUS),
    id_autor_contato: num(r.ID_AUTOR_CONTATO) || null,
    autor_contato: funcs?.get(num(r.ID_AUTOR_CONTATO))?.nome || '',
    id_buscador: num(r.ID_BUSCADOR) || null,
    id_entregador: num(r.ID_ENTREGADOR) || null,
    buscador: funcs?.get(num(r.ID_BUSCADOR))?.nome || '',
    entregador: funcs?.get(num(r.ID_ENTREGADOR))?.nome || '',
    solucao: texto(r.SOLUCAO),
    obs: texto(r.OBS),
    previsao,
    entrega: dataHoraIso(r.DT_ENTREGA),
    cancelada: txt(r.CANCELADA) === 'S',
    importada: false,
    atrasada: !!previsao && previsao < hojeIso() && !(st?.final) && txt(r.CANCELADA) !== 'S',
    ordem: num(r.ORDEM),
    id_cliente: num(r.ID_CLIENTE) || null,
    cliente: {
      id: num(r.ID_CLIENTE) || null,
      nome: txt(r.CLI_NOME),
      documento: txt(r.CLI_DOC),
      telefone: txt(r.CLI_FONE),
      endereco: txt(r.CLI_ENDERECO),
    },
    desc_geral: num(r.DESC_GERAL),
    acres_geral: num(r.ACRES_GERAL),
    frete: num(r.FRETE),
    deslocamento: num(r.DESLOCAMENTO),
    total: num(r.TOTAL),
    id_pedido: num(r.ID_PEDIDO) || null,
    enviado_em: dataHoraBr(r.DT_ENVIO),
    perfil: txt(r.PERFIL),
    usuario: txt(r.USUARIO),
    origem: txt(r.ORIGEM) === 'C' ? 'C' : 'S',
    num_provisorio: txt(r.NUM_PROVISORIO),
    versao: r.DT_ALTERACAO instanceof Date ? r.DT_ALTERACAO.getTime() : 0,
  };
}

async function mapasApoio(db) {
  const funcs = new Map((await lerFuncionarios(db)).map((f) => [f.id, f]));
  // Técnico que deixou de ser ativo continua com nome na O.S antiga.
  const statuses = await lerStatus(db);
  return { funcs, statuses, porId: new Map(statuses.map((s) => [s.id, s])) };
}

function lista(v) {
  if (Array.isArray(v)) return v;
  if (v == null || v === '') return [];
  return String(v).split(',');
}

async function listar(filtros = {}) {
  return comBase(async (db) => {
    const { funcs, statuses, porId } = await mapasApoio(db);
    const where = [];
    const params = [];
    const ids = (k) => lista(filtros[k]).map(num).filter(Boolean);
    const st = ids('status');
    if (st.length) where.push(`O.ID_STATUS IN (${st.map(() => '?').join(',')})`), params.push(...st);
    const tec = ids('tecnico');
    if (tec.length) where.push(`O.ID_TECNICO IN (${tec.map(() => '?').join(',')})`), params.push(...tec);
    if (filtros.semTecnico === '1') where.push('O.ID_TECNICO IS NULL');
    if (['I', 'E'].includes(filtros.tipo)) where.push('O.TIPO = ?'), params.push(filtros.tipo);
    if (['P', 'R'].includes(filtros.modalidade)) where.push('O.MODALIDADE = ?'), params.push(filtros.modalidade);
    const periodo = (col, de, ate, comHora) => {
      const d1 = dataInformada(filtros[de]);
      const d2 = dataInformada(filtros[ate]);
      if (d1) where.push(`CAST(${col} AS DATE) >= ?`), params.push(dataIso(d1));
      if (d2) where.push(`CAST(${col} AS DATE) <= ?`), params.push(dataIso(d2));
      return comHora;
    };
    periodo('O.DT_EMISSAO', 'emissaoDe', 'emissaoAte');
    periodo('O.DT_PREVISAO', 'previsaoDe', 'previsaoAte');
    periodo('O.DT_ENTREGA', 'entregaDe', 'entregaAte');
    const cli = txt(filtros.cliente, 60);
    if (cli) {
      if (/^\d+$/.test(cli)) where.push('(O.ID_CLIENTE = ? OR UPPER(O.CLI_NOME) CONTAINING UPPER(?))'), params.push(Number(cli), cli);
      else where.push('UPPER(O.CLI_NOME) CONTAINING UPPER(?)'), params.push(cli);
    }
    for (const [campo, col] of [['quemTrouxe', 'O.QUEM_TROUXE'], ['equipamento', 'O.EQUIPAMENTO'], ['defeito', 'O.DEFEITO']]) {
      const v = txt(filtros[campo], 100);
      if (v) where.push(`UPPER(COALESCE(${col}, '')) CONTAINING UPPER(?)`), params.push(v);
    }
    const busca = txt(filtros.q, 100);
    if (busca) {
      for (const p of busca.split(/\s+/).filter(Boolean)) {
        const numero = /^\d+$/.test(p) ? Number(p) : -1;
        where.push(`(O.ID_OS = ? OR UPPER(COALESCE(O.CLI_NOME, '')) CONTAINING UPPER(?) OR UPPER(COALESCE(O.EQUIPAMENTO, '')) CONTAINING UPPER(?)
          OR UPPER(COALESCE(O.DEFEITO, '')) CONTAINING UPPER(?) OR UPPER(COALESCE(O.QUEM_TROUXE, '')) CONTAINING UPPER(?))`);
        params.push(numero, p, p, p, p);
      }
    }
    // Finalizadas antigas não lotam o quadro: sem filtro de data, mostra as dos últimos 30 dias.
    const finais = statuses.filter((s) => s.final).map((s) => s.id);
    const temData = ['emissaoDe', 'emissaoAte', 'entregaDe', 'entregaAte', 'previsaoDe', 'previsaoAte'].some((k) => filtros[k]);
    if (finais.length && !temData && !busca && !cli) {
      where.push(`(O.ID_STATUS NOT IN (${finais.join(',')}) OR O.DT_ALTERACAO >= ?)`);
      const d = new Date(); d.setDate(d.getDate() - 30);
      params.push(dataIso(d));
    }
    const rows = await query(db, `
      SELECT FIRST 600 O.ID_OS, O.DT_EMISSAO, O.TIPO, O.MODALIDADE, O.ID_STATUS, O.ID_TECNICO, O.QUEM_TROUXE,
             O.EQUIPAMENTO, O.DT_PREVISAO, O.DT_ENTREGA, O.ORDEM, O.ID_CLIENTE, O.CLI_NOME, O.ID_PEDIDO, O.TOTAL, O.CANCELADA,
             CASE WHEN O.ID_PEDIDO IS NOT NULL AND (
               EXISTS (SELECT 1 FROM TB_PEDIDO_VENDA P JOIN TB_PED_VENDA_STATUS S ON S.ID_STATUS = P.ID_STATUS
                 WHERE P.ID_PEDIDO = O.ID_PEDIDO AND UPPER(COALESCE(S.DESCRICAO, '')) CONTAINING 'FINAL')
               OR EXISTS (SELECT 1 FROM TB_PED_VENDA_ITEM I JOIN TB_PED_VENDA_NFVENDA N ON N.ID_ITEMPED = I.ID_ITEMPED
                 WHERE I.ID_PEDIDO = O.ID_PEDIDO)
             ) THEN 'S' ELSE 'N' END AS IMPORTADA
      FROM GESTOR_OS O
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY O.ORDEM, O.ID_OS DESC`, params);
    const cards = rows.map((r) => {
      const os = mapOs(r, funcs, porId);
      return {
        id: os.id,
        tipo: os.tipo,
        modalidade: os.modalidade,
        id_status: os.id_status,
        tecnico: os.tecnico,
        id_tecnico: os.id_tecnico,
        cliente: os.cliente.nome,
        equipamento: os.equipamento,
        quem_trouxe: os.quem_trouxe,
        previsao: os.previsao,
        atrasada: os.atrasada,
        ordem: os.ordem,
        enviada: !!os.id_pedido,
        cancelada: os.cancelada,
        importada: txt(r.IMPORTADA) === 'S',
      };
    });
    return {
      statuses,
      tecnicos: [...funcs.values()].filter((f) => f.tecnico),
      os: cards,
      perfil: perfilServicos(),
    };
  });
}

function perfilServicos() {
  try {
    const s = require('./licenca').situacao().servicos || {};
    return { ativo: s.ativo === true, perfil: s.perfil || '', nome: s.nome || '' };
  } catch {
    return { ativo: false, perfil: '', nome: '' };
  }
}

async function lerOs(db, id) {
  const rows = await query(db, 'SELECT * FROM GESTOR_OS WHERE ID_OS = ?', [num(id)]);
  if (!rows.length) return null;
  const { funcs, porId } = await mapasApoio(db);
  const os = mapOs(rows[0], funcs, porId);
  os.itens = (await query(db, 'SELECT * FROM GESTOR_OS_ITEM WHERE ID_OS = ? ORDER BY SEQ, ID_ITEM', [os.id])).map(mapItem);
  const calc = calcular(os);
  os.totais = calc.totais;
  os.historico = (await query(db, 'SELECT FIRST 200 * FROM GESTOR_OS_HISTORICO WHERE ID_OS = ? ORDER BY DT DESC, ID DESC', [os.id])).map((h) => ({
    data: dataHoraBr(h.DT),
    usuario: txt(h.USUARIO),
    status_ant: porId.get(num(h.ID_STATUS_ANT)) || null,
    status_novo: porId.get(num(h.ID_STATUS_NOVO)) || null,
    evento: txt(h.EVENTO),
  }));
  if (os.id_cliente) {
    const cli = await lerCliente(db, os.id_cliente);
    if (cli) os.cliente.observacao = cli.observacao;
  }
  await preencherCategoria(db, os);
  os.importada = os.id_pedido ? await require('./condicionais').pedidoImportado(db, os.id_pedido) : false;
  return os;
}

async function detalhe(id) {
  return comBase(async (db) => {
    const os = await lerOs(db, id);
    if (!os) throw new Error('O.S não encontrada.');
    return { os };
  });
}

/* ------------------------------------------------------------------ */
/* O.S: gravação                                                       */
/* ------------------------------------------------------------------ */

async function historico(db, idOs, usuario, evento, ant, novo) {
  const id = await gerar(db, 'GESTOR_GEN_OS_HIST');
  await query(db, `
    INSERT INTO GESTOR_OS_HISTORICO (ID, ID_OS, DT, ID_USUARIO, USUARIO, ID_STATUS_ANT, ID_STATUS_NOVO, EVENTO)
    VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)`, [
    id, idOs, usuario?.id ?? null, txt(usuario?.nome, 60) || null, ant || null, novo || null, txt(evento, 300) || null,
  ]);
}

function lerItensEntrada(lista) {
  return (lista || []).map((it, i) => {
    const qtdBruta = num(it.qtd);
    const tipo = it.tipo === 'S' ? 'S' : 'P';
    const qtd = tipo === 'S' ? (qtdBruta > 0 ? qtdBruta : 1) : qtdBruta;
    const vlr = Math.max(0, num(it.vlr_unit));
    const bruto = r2(qtd * vlr);
    return {
      seq: i + 1,
      id_identificador: num(it.id_identificador),
      descricao: txt(it.descricao, 200),
      tipo,
      unidade: txt(it.unidade, 6) || 'UN',
      qtd,
      vlr_unit: vlr,
      desc_item: Math.min(bruto, Math.max(0, r2(it.desc_item))),
      acres_item: Math.max(0, r2(it.acres_item)),
    };
  }).filter((it) => it.id_identificador > 0 && it.qtd > 0);
}

/** Confere no cadastro se cada item está na aba certa (produto x serviço). */
async function conferirTiposItens(db, appCfg, itens) {
  if (!itens.length) return;
  const t = activeTargets(appCfg)[0]?.tables;
  if (!t) return;
  const ids = [...new Set(itens.map((i) => i.id_identificador))];
  const rows = await query(db, `
    SELECT I.ID_IDENTIFICADOR, E.ID_TIPOITEM, E.DESCRICAO FROM ${t.identificador} I
    JOIN ${t.estoque} E ON E.ID_ESTOQUE = I.ID_ESTOQUE
    WHERE I.ID_IDENTIFICADOR IN (${ids.map(() => '?').join(',')})`, ids);
  const tipos = new Map(rows.map((r) => [num(r.ID_IDENTIFICADOR), tipoItem(r.ID_TIPOITEM)]));
  for (const it of itens) {
    if (!tipos.has(it.id_identificador)) throw new Error(`Item ${it.id_identificador} não existe mais no estoque.`);
    const tipo = tipos.get(it.id_identificador);
    if (it.tipo === 'S' && !TIPOS_SERVICO.includes(tipo)) throw new Error(`"${it.descricao}" não é serviço no cadastro. Inclua na aba Produtos.`);
    if (it.tipo === 'P' && !TIPOS_PRODUTO.includes(tipo)) throw new Error(`"${it.descricao}" não é produto aceito na O.S (tipo ${tipo || 'vazio'}).`);
  }
}

/**
 * Grava a O.S. opcoes (só a sincronização do app desktop usa):
 * - origem 'C' e provisorio: O.S aberta em contingência, com o número provisório do computador.
 * - versaoBase: versão (DT_ALTERACAO) que o computador tinha; se a do servidor mudou, recusa com code CONFLITO.
 */
async function salvar(body, usuario, opcoes = {}) {
  const id = num(body?.id);
  const entrada = {
    tipo: body?.tipo === 'E' ? 'E' : 'I',
    modalidade: body?.modalidade === 'R' ? 'R' : 'P',
    id_status: num(body?.id_status),
    id_tecnico: num(body?.id_tecnico) || null,
    quem_trouxe: txt(body?.quem_trouxe, 100),
    equipamento: txt(body?.equipamento, 300),
    defeito: texto(body?.defeito, 2000),
    solucao: texto(body?.solucao, 2000),
    obs: texto(body?.obs, 1000),
    previsao: dataInformada(body?.previsao),
    entrega: dataHoraInformada(body?.entrega),
    id_cliente: num(body?.id_cliente),
    desc_geral: Math.max(0, r2(body?.desc_geral)),
    acres_geral: Math.max(0, r2(body?.acres_geral)),
    frete: Math.max(0, r2(body?.frete)),
    deslocamento: Math.max(0, r2(body?.deslocamento)),
    id_categoria: Object.prototype.hasOwnProperty.call(body || {}, 'id_categoria') ? (num(body.id_categoria) || null) : undefined,
    id_subcategoria: Object.prototype.hasOwnProperty.call(body || {}, 'id_subcategoria') ? (num(body.id_subcategoria) || null) : undefined,
    autorizacao: Object.prototype.hasOwnProperty.call(body || {}, 'autorizacao') ? texto(body.autorizacao, 2000) : undefined,
    autor_status: Object.prototype.hasOwnProperty.call(body || {}, 'autor_status') ? autorStatus(body.autor_status) : undefined,
    id_autor_contato: Object.prototype.hasOwnProperty.call(body || {}, 'id_autor_contato') ? (num(body.id_autor_contato) || null) : undefined,
    id_colaborador: num(body?.id_colaborador) || null,
    itens: lerItensEntrada(body?.itens),
  };
  if (!entrada.id_cliente) throw new Error('Escolha o cliente.');
  if (!entrada.equipamento) throw new Error('Descreva o equipamento.');
  if (!entrada.defeito) throw new Error('Descreva o defeito apresentado.');
  return comBase(async (db, appCfg) => {
    const { porId, funcs } = await mapasApoio(db);
    const atual = id ? await lerOs(db, id) : null;
    if (id && !atual) throw new Error('O.S não encontrada.');
    if (atual?.cancelada) throw new Error('O.S cancelada não pode ser editada.');
    if (atual?.importada) throw new Error('O.S importada não pode ser editada.');
    if (atual && opcoes.versaoBase && !opcoes.forcar && atual.versao !== num(opcoes.versaoBase)) {
      const err = new Error(`A O.S ${id} foi alterada no servidor depois da cópia da contingência.`);
      err.code = 'CONFLITO';
      err.servidor = atual;
      throw err;
    }
    if (!entrada.id_status || !porId.has(entrada.id_status)) {
      entrada.id_status = atual?.id_status || [...porId.values()].filter((s) => s.ativo)[0]?.id;
    }
    if (entrada.id_tecnico && !funcs.get(entrada.id_tecnico)?.tecnico && entrada.id_tecnico !== atual?.id_tecnico) {
      throw new Error('Escolha um funcionário com a função Técnico no cadastro.');
    }
    const enviada = !!atual?.id_pedido;
    if (enviada) {
      // Depois de ir para a venda, itens, valores e cliente ficam como foram enviados.
      entrada.itens = atual.itens;
      entrada.id_cliente = atual.id_cliente;
      entrada.desc_geral = atual.desc_geral;
      entrada.acres_geral = atual.acres_geral;
      entrada.frete = atual.frete;
      entrada.deslocamento = atual.deslocamento;
    } else {
      await conferirTiposItens(db, appCfg, entrada.itens);
    }
    const calc = calcular(entrada);
    const liberacoes = enviada ? [] : conferirDescontos({ ...entrada, itens: calc.itens }, body?.liberacoes);
    const statusNovo = porId.get(entrada.id_status);
    if (statusNovo?.final && !entrada.entrega) entrada.entrega = new Date();
    const cat = await resolverCategoria(
      db,
      entrada.id_categoria === undefined ? atual?.id_categoria : entrada.id_categoria,
      entrada.id_subcategoria === undefined ? atual?.id_subcategoria : entrada.id_subcategoria,
    );
    entrada.id_categoria = cat.id_categoria;
    entrada.id_subcategoria = cat.id_subcategoria;
    if (entrada.autorizacao === undefined) entrada.autorizacao = atual?.autorizacao || '';
    if (entrada.autor_status === undefined) entrada.autor_status = atual?.autor_status || '';
    if (entrada.id_autor_contato === undefined) entrada.id_autor_contato = atual?.id_autor_contato || null;
    let cli = null;
    if (!atual || atual.id_cliente !== entrada.id_cliente) {
      cli = await lerCliente(db, entrada.id_cliente);
      if (!cli) throw new Error('Cliente não encontrado.');
    }
    const perfil = perfilServicos().perfil || null;
    const avisos = [];
    const resultado = await withTransaction(db, async (tx) => {
      let codigo = id;
      const cab = [
        entrada.tipo, entrada.modalidade, entrada.id_status, entrada.id_tecnico, entrada.quem_trouxe || null,
        entrada.equipamento, entrada.defeito, entrada.solucao || null, entrada.obs || null,
        entrada.previsao, entrada.entrega, entrada.id_cliente,
        entrada.desc_geral, entrada.acres_geral, entrada.frete, entrada.deslocamento,
        calc.totais.bruto_produtos, calc.totais.bruto_servicos, calc.totais.total,
        entrada.id_categoria, entrada.id_subcategoria,
        entrada.autorizacao || null, entrada.autor_status || null,
      ];
      if (!codigo) {
        codigo = await gerar(tx, 'GESTOR_GEN_OS');
        const ordem = await query(tx, 'SELECT COALESCE(MAX(ORDEM), 0) + 1 AS O FROM GESTOR_OS WHERE ID_STATUS = ?', [entrada.id_status]);
        await query(tx, `
          INSERT INTO GESTOR_OS (
            ID_OS, DT_EMISSAO, TIPO, MODALIDADE, ID_STATUS, ID_TECNICO, QUEM_TROUXE, EQUIPAMENTO, DEFEITO, SOLUCAO, OBS,
            DT_PREVISAO, DT_ENTREGA, ID_CLIENTE, DESC_GERAL, ACRES_GERAL, FRETE, DESLOCAMENTO,
            TOTAL_PRODUTOS, TOTAL_SERVICOS, TOTAL, ID_CATEGORIA, ID_SUBCATEGORIA, AUTORIZACAO, AUTOR_STATUS, ORDEM, PERFIL, ORIGEM, ID_USUARIO, USUARIO, DT_ALTERACAO
          ) VALUES (?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`, [
          codigo, ...cab, num(ordem[0]?.O) || 1, perfil, opcoes.origem === 'C' ? 'C' : 'S', usuario?.id ?? null, txt(usuario?.nome, 60) || null,
        ]);
        if (opcoes.origem === 'C' && opcoes.provisorio) {
          await query(tx, 'UPDATE GESTOR_OS SET NUM_PROVISORIO = ? WHERE ID_OS = ?', [txt(opcoes.provisorio, 40), codigo]);
          await historico(tx, codigo, usuario, `O.S aberta em contingência como ${txt(opcoes.provisorio, 40)} e sincronizada`, null, entrada.id_status);
        } else {
          await historico(tx, codigo, usuario, 'O.S aberta', null, entrada.id_status);
        }
      } else {
        let ordemSql = '';
        const extra = [];
        if (atual.id_status !== entrada.id_status) {
          const ordem = await query(tx, 'SELECT COALESCE(MAX(ORDEM), 0) + 1 AS O FROM GESTOR_OS WHERE ID_STATUS = ?', [entrada.id_status]);
          ordemSql = ', ORDEM = ?';
          extra.push(num(ordem[0]?.O) || 1);
        }
        await query(tx, `
          UPDATE GESTOR_OS SET
            TIPO = ?, MODALIDADE = ?, ID_STATUS = ?, ID_TECNICO = ?, QUEM_TROUXE = ?, EQUIPAMENTO = ?, DEFEITO = ?, SOLUCAO = ?, OBS = ?,
            DT_PREVISAO = ?, DT_ENTREGA = ?, ID_CLIENTE = ?, DESC_GERAL = ?, ACRES_GERAL = ?, FRETE = ?, DESLOCAMENTO = ?,
            TOTAL_PRODUTOS = ?, TOTAL_SERVICOS = ?, TOTAL = ?, ID_CATEGORIA = ?, ID_SUBCATEGORIA = ?, AUTORIZACAO = ?, AUTOR_STATUS = ?, DT_ALTERACAO = CURRENT_TIMESTAMP${ordemSql}
          WHERE ID_OS = ?`, [...cab, ...extra, codigo]);
        if (atual.id_status !== entrada.id_status) {
          await historico(tx, codigo, usuario, `Status: ${porId.get(atual.id_status)?.descricao || '—'} → ${statusNovo?.descricao || '—'}`, atual.id_status, entrada.id_status);
        }
        if (opcoes.origem === 'C') {
          await historico(tx, codigo, usuario, opcoes.forcar
            ? 'Alteração feita em contingência sincronizada (escolhida no lugar da versão do servidor)'
            : 'Alteração feita em contingência sincronizada');
        }
      }
      if (cli) {
        await query(tx, `
          UPDATE GESTOR_OS SET CLI_NOME = ?, CLI_DOC = ?, CLI_FONE = ?, CLI_ENDERECO = ?, CLI_DADOS = ?
          WHERE ID_OS = ?`, [
          txt(cli.nome, 100), txt(cli.documento, 20) || null, txt(cli.telefone, 30) || null, txt(cli.endereco, 250) || null,
          JSON.stringify(cli.dados).slice(0, 6000), codigo,
        ]);
      }
      if (!enviada) {
        await query(tx, 'DELETE FROM GESTOR_OS_ITEM WHERE ID_OS = ?', [codigo]);
        for (const it of calc.itens) {
          const idItem = await gerar(tx, 'GESTOR_GEN_OS_ITEM');
          await query(tx, `
            INSERT INTO GESTOR_OS_ITEM (
              ID_ITEM, ID_OS, SEQ, ID_IDENTIFICADOR, DESCRICAO, TIPO, UNIDADE, QTD, VLR_UNIT,
              DESC_ITEM, ACRES_ITEM, RATEIO_DESC, RATEIO_ACRES, TOTAL
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            idItem, codigo, it.seq, it.id_identificador, it.descricao, it.tipo, it.unidade, it.qtd, it.vlr_unit,
            it.desc_item, it.acres_item, it.rateio_desc, it.rateio_acres, it.total,
          ]);
        }
      }
      for (const l of liberacoes) {
        await historico(tx, codigo, usuario,
          `Desconto ${l.escopo === 'geral' ? 'geral' : 'no item'} de ${l.aplicado.toLocaleString('pt-BR')}% liberado por ${l.nome} em ${dataHoraBr(l.em)} (até ${l.pct.toLocaleString('pt-BR')}%)`);
      }
      const trocouTecnico = (atual?.id_tecnico || null) !== entrada.id_tecnico;
      if (trocouTecnico) {
        const nome = entrada.id_tecnico ? funcs.get(entrada.id_tecnico)?.nome : '';
        await historico(tx, codigo, usuario, nome ? `Técnico ${nome} vinculado` : 'Técnico removido');
      }
      if (entrada.id_autor_contato) {
        await query(tx, 'UPDATE GESTOR_OS SET ID_AUTOR_CONTATO = ? WHERE ID_OS = ?', [entrada.id_autor_contato, codigo]);
      } else if (atual?.id_autor_contato) {
        await query(tx, 'UPDATE GESTOR_OS SET ID_AUTOR_CONTATO = NULL WHERE ID_OS = ?', [codigo]);
      }
      const mudouAutor = !atual || atual.autorizacao !== entrada.autorizacao || atual.autor_status !== entrada.autor_status
        || (atual?.id_autor_contato || null) !== (entrada.id_autor_contato || null);
      if (atual && mudouAutor && (entrada.autorizacao || entrada.autor_status || entrada.id_autor_contato)) {
        const rot = rotuloAutor(entrada.autor_status);
        const contato = entrada.id_autor_contato ? funcs.get(entrada.id_autor_contato)?.nome : '';
        await historico(tx, codigo, usuario, `Autorização solicitada${rot ? ` (${rot})` : ''}${contato ? ` — contato ${contato}` : ''}${entrada.autorizacao ? `: ${entrada.autorizacao.slice(0, 180)}` : ''}`);
      }
      let colaborador = null;
      const papel = papelStatus(statusNovo?.descricao);
      if (papel && (!atual || atual.id_status !== entrada.id_status)) {
        colaborador = await gravarColaborador(tx, codigo, papel, entrada.id_colaborador, usuario, funcs);
      }
      return { codigo, trocouTecnico, colaborador, papel };
    });
    if (statusNovo?.final && entrada.solucao) {
      try { await registrarSolucao(db, { ...entrada, id: resultado.codigo }); } catch (err) { avisos.push(`A solução não entrou na base de soluções: ${err.message}`); }
    }
    if (resultado.trocouTecnico && entrada.id_tecnico) {
      avisos.push(...await avisarTecnico(db, resultado.codigo, usuario));
    }
    if (resultado.colaborador) {
      avisos.push(...await avisarColaborador(db, resultado.codigo, resultado.colaborador.id, resultado.papel, usuario));
    }
    return { id: resultado.codigo, avisos };
  });
}

/** Grava quem busca ou entrega e deixa o nome no histórico. */
async function gravarColaborador(tx, idOs, papel, idFunc, usuario, funcs) {
  const f = funcs.get(num(idFunc));
  if (!f) throw new Error(papel === 'busca' ? 'Escolha quem vai buscar o equipamento.' : 'Escolha quem vai entregar.');
  const coluna = papel === 'busca' ? 'ID_BUSCADOR' : 'ID_ENTREGADOR';
  await query(tx, `UPDATE GESTOR_OS SET ${coluna} = ? WHERE ID_OS = ?`, [f.id, idOs]);
  await historico(tx, idOs, usuario, `${f.nome} vai ${papel === 'busca' ? 'buscar no cliente' : 'entregar'}`);
  return f;
}

/** Avisa no WhatsApp o colaborador escolhido para buscar ou entregar. */
async function avisarColaborador(db, idOs, idFunc, papel, usuario) {
  const os = await lerOs(db, idOs);
  if (!os) return [];
  const f = await query(db, 'SELECT NOME, DDD, CELULAR FROM TB_FUNCIONARIO WHERE ID_FUNCIONARIO = ?', [idFunc]);
  const nome = txt(f[0]?.NOME) || 'O colaborador';
  const fone = foneFuncionario(f[0]);
  const acao = papel === 'busca' ? 'buscar o equipamento no cliente' : 'entregar o equipamento';
  if (!fone) return [`${nome} não tem celular no cadastro de funcionários. O aviso não foi enviado.`];
  const textoMsg = `O.S ${os.id} — ${os.cliente?.nome || 'cliente'}. Você foi indicado para ${acao}. Equipamento: ${os.equipamento || '—'}.`;
  const rotulo = `Aviso de ${papel === 'busca' ? 'busca' : 'entrega'} enviado no WhatsApp para ${nome}`;
  try {
    const r = await enviarOuEnfileirar({ numero: fone, texto: textoMsg, idOs: os.id, rotulo, usuario });
    if (r.enfileirada) return [`Sem internet agora: o aviso para ${nome} vai sair pelo WhatsApp quando a conexão voltar.`];
    await historico(db, os.id, usuario, rotulo);
    return [`Aviso enviado no WhatsApp para ${nome}.`];
  } catch (err) {
    return [`O aviso para ${nome} não saiu pelo WhatsApp: ${err.message}`];
  }
}

/** Troca de status pelo quadro (arrastar ou escolher no card). Vai para o fim da coluna nova. */
async function mudarStatus(id, idStatus, usuario, idColaborador) {
  return comBase(async (db) => {
    const os = await lerOs(db, id);
    if (!os) throw new Error('O.S não encontrada.');
    if (os.cancelada) throw new Error('O.S cancelada não muda de etapa.');
    if (os.importada) throw new Error('O.S importada não pode ser editada.');
    const { porId, funcs } = await mapasApoio(db);
    const novo = porId.get(num(idStatus));
    if (!novo || !novo.ativo) throw new Error('Status inválido.');
    if (novo.id === os.id_status) return { id: os.id, avisos: [] };
    const papel = papelStatus(novo.descricao);
    let colaborador = null;
    await withTransaction(db, async (tx) => {
      const ordem = await query(tx, 'SELECT COALESCE(MAX(ORDEM), 0) + 1 AS O FROM GESTOR_OS WHERE ID_STATUS = ?', [novo.id]);
      await query(tx, `
        UPDATE GESTOR_OS SET ID_STATUS = ?, ORDEM = ?, DT_ALTERACAO = CURRENT_TIMESTAMP
          ${novo.final && !os.entrega ? ', DT_ENTREGA = CURRENT_TIMESTAMP' : ''}
        WHERE ID_OS = ?`, [novo.id, num(ordem[0]?.O) || 1, os.id]);
      await historico(tx, os.id, usuario, `Status: ${os.status?.descricao || '—'} → ${novo.descricao}`, os.id_status, novo.id);
      if (papel) colaborador = await gravarColaborador(tx, os.id, papel, idColaborador, usuario, funcs);
    });
    const avisos = [];
    if (novo.final && os.solucao) {
      try { await registrarSolucao(db, os); } catch (err) { avisos.push(`A solução não entrou na base: ${err.message}`); }
    }
    if (colaborador) avisos.push(...await avisarColaborador(db, os.id, colaborador.id, papel, usuario));
    return { id: os.id, avisos, final: novo.final, enviada: !!os.id_pedido };
  });
}

/** Ordem dentro da coluna: lista completa de ids na ordem nova (arrastar ou setas). */
async function reordenar(idStatus, ids) {
  const lista = (ids || []).map(num).filter(Boolean);
  return comBase(async (db) => {
    let ordem = 0;
    for (const id of lista) {
      ordem += 1;
      await query(db, 'UPDATE GESTOR_OS SET ORDEM = ? WHERE ID_OS = ? AND ID_STATUS = ?', [ordem, id, num(idStatus)]);
    }
    return {};
  });
}

async function vincularTecnico(id, idTecnico, usuario) {
  return comBase(async (db) => {
    const os = await lerOs(db, id);
    if (!os) throw new Error('O.S não encontrada.');
    if (os.cancelada || os.importada) throw new Error(os.importada ? 'O.S importada não pode ser editada.' : 'O.S cancelada não pode ser editada.');
    const { funcs } = await mapasApoio(db);
    const novo = num(idTecnico) || null;
    if (novo && !funcs.get(novo)?.tecnico) throw new Error('Escolha um funcionário com a função Técnico no cadastro.');
    if (novo === os.id_tecnico) return { id: os.id, avisos: [] };
    await withTransaction(db, async (tx) => {
      await query(tx, 'UPDATE GESTOR_OS SET ID_TECNICO = ?, DT_ALTERACAO = CURRENT_TIMESTAMP WHERE ID_OS = ?', [novo, os.id]);
      await historico(tx, os.id, usuario, novo ? `Técnico ${funcs.get(novo).nome} vinculado` : 'Técnico removido');
    });
    const avisos = novo ? await avisarTecnico(db, os.id, usuario) : [];
    return { id: os.id, avisos };
  });
}

function preencherVariaveis(modelo, os, extra = {}) {
  const valores = {
    numero_os: String(os.id),
    cliente: os.cliente?.nome || '',
    tecnico: extra.tecnico || os.tecnico?.nome || '',
    equipamento: os.equipamento || '',
    defeito: os.defeito || '',
    previsao: os.previsao ? dataBr(os.previsao) : 'sem previsão',
    status: os.status?.descricao || '',
    quem_trouxe: os.quem_trouxe || '',
  };
  return String(modelo || '').replace(/\{(\w+)\}/g, (m, k) => (k in valores ? valores[k] : m));
}

/* ------------------------------------------------------------------ */
/* WhatsApp: sem internet, a mensagem vai para uma fila                */
/* ------------------------------------------------------------------ */

function semInternet(err) {
  const codigo = String(err?.cause?.code || err?.code || '');
  if (['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT'].includes(codigo)) return true;
  if (err?.name === 'TypeError' && /fetch failed/i.test(String(err.message))) return true;
  return codigo === 'EVOLUTION' && /não respondeu/i.test(String(err?.message));
}

function lerFila() {
  const fila = loadAppConfig().os_fila_whatsapp;
  return Array.isArray(fila) ? fila : [];
}

function gravarFila(fila) {
  saveAppConfig({ ...loadAppConfig(), os_fila_whatsapp: fila.slice(-200) });
}

/** Envia agora; se a internet estiver fora, guarda na fila e devolve { enfileirada: true }. */
async function enviarOuEnfileirar({ numero, texto, idOs, rotulo, usuario }) {
  try {
    await require('./whatsapp').enviarTexto({ numero, texto });
    return { enfileirada: false };
  } catch (err) {
    if (!semInternet(err)) throw err;
    gravarFila([...lerFila(), {
      numero, texto, id_os: idOs || null, rotulo: rotulo || '', usuario: usuario ? { id: usuario.id ?? null, nome: usuario.nome || '' } : null,
      em: new Date().toISOString(), tentativas: 0,
    }]);
    return { enfileirada: true };
  }
}

let filaRodando = false;
/** Tenta mandar o que ficou na fila. Para no primeiro sinal de internet fora. */
async function processarFilaWhatsapp() {
  if (filaRodando) return { enviadas: 0, restantes: lerFila().length };
  filaRodando = true;
  let enviadas = 0;
  try {
    let fila = lerFila();
    while (fila.length) {
      const m = fila[0];
      try {
        await require('./whatsapp').enviarTexto({ numero: m.numero, texto: m.texto });
        enviadas += 1;
        fila = fila.slice(1);
        gravarFila(fila);
        if (m.id_os && m.rotulo) {
          try {
            await comBase((db) => historico(db, m.id_os, m.usuario, `${m.rotulo} (saiu da fila do WhatsApp)`));
          } catch { /* o histórico não segura a fila */ }
        }
      } catch (err) {
        if (semInternet(err)) break;
        // Erro que não é de conexão (número inválido, WhatsApp desconectado): tenta mais 4 vezes e descarta.
        m.tentativas = num(m.tentativas) + 1;
        fila = m.tentativas >= 5 ? fila.slice(1) : [...fila.slice(1), m];
        gravarFila(fila);
        if (m.tentativas < 5) break;
      }
    }
    return { enviadas, restantes: fila.length };
  } finally {
    filaRodando = false;
  }
}

/** Mensagem automática ao técnico vinculado. Sem celular no cadastro, avisa e não envia. */
async function avisarTecnico(db, idOs, usuario) {
  const os = await lerOs(db, idOs);
  if (!os?.id_tecnico) return [];
  const msgs = (await query(db, "SELECT * FROM GESTOR_OS_MENSAGEM WHERE EVENTO = 'atribuida' AND ATIVO = 'S' ORDER BY ID")).map(mapMensagem);
  if (!msgs.length) return [];
  const f = await query(db, 'SELECT NOME, DDD, CELULAR FROM TB_FUNCIONARIO WHERE ID_FUNCIONARIO = ?', [os.id_tecnico]);
  const nome = txt(f[0]?.NOME);
  const fone = foneFuncionario(f[0]);
  if (!fone) return [`${nome || 'O técnico'} não tem celular no cadastro de funcionários. A mensagem não foi enviada.`];
  const textoMsg = preencherVariaveis(msgs[0].texto, os, { tecnico: nome });
  try {
    const r = await enviarOuEnfileirar({ numero: fone, texto: textoMsg, idOs: os.id, rotulo: `Aviso enviado no WhatsApp para ${nome}`, usuario });
    if (r.enfileirada) return [`Sem internet agora: o aviso para ${nome} vai sair pelo WhatsApp quando a conexão voltar.`];
    await historico(db, os.id, usuario, `Aviso enviado no WhatsApp para ${nome}`);
    return [`Aviso enviado no WhatsApp para ${nome}.`];
  } catch (err) {
    return [`O aviso para ${nome} não saiu pelo WhatsApp: ${err.message}`];
  }
}

/** Cancela a O.S: vai para a coluna concluída, com a marca de cancelada. O pedido ainda não importado fica Reprovado. */
async function cancelar(id, usuario) {
  return comBase(async (db) => {
    const os = await lerOs(db, id);
    if (!os) throw new Error('O.S não encontrada.');
    if (os.cancelada) return { id: os.id, avisos: [] };
    if (os.importada) throw new Error('O.S importada não pode ser cancelada.');
    const statuses = await lerStatus(db);
    const final = statuses.find((s) => s.final && s.ativo) || statuses.find((s) => semAcento(s.descricao) === semAcento('Concluído e Entregue'));
    if (!final) throw new Error('Não há uma coluna de concluída para receber a O.S cancelada.');
    if (os.id_pedido) await require('./condicionais').reprovar(os.id_pedido);
    await withTransaction(db, async (tx) => {
      const ordem = await query(tx, 'SELECT COALESCE(MAX(ORDEM), 0) + 1 AS O FROM GESTOR_OS WHERE ID_STATUS = ?', [final.id]);
      await query(tx, `
        UPDATE GESTOR_OS SET CANCELADA = 'S', ID_STATUS = ?, ORDEM = ?, DT_ALTERACAO = CURRENT_TIMESTAMP
        WHERE ID_OS = ?`, [final.id, num(ordem[0]?.O) || 1, os.id]);
      await historico(tx, os.id, usuario, 'O.S cancelada', os.id_status, final.id);
    });
    return { id: os.id, avisos: [] };
  });
}

/** Envia para a Venda Gerencial: grava como pedido (tabelas do condicional) e trava os itens. */
async function enviarParaVenda(id, usuario) {
  const dados = await comBase(async (db) => {
    const os = await lerOs(db, id);
    if (!os) throw new Error('O.S não encontrada.');
    if (os.cancelada) throw new Error('O.S cancelada não pode ser concluída.');
    if (os.importada) throw new Error('O.S importada não pode ser editada.');
    if (os.id_pedido) throw new Error(`Esta O.S já foi enviada para a venda (pedido ${os.id_pedido}).`);
    return os;
  });
  const calc = calcular(dados);
  const obs = [`O.S ${dados.id}`, dados.equipamento].filter(Boolean).join(' · ');
  const validade = dados.previsao ? dataInformada(dados.previsao) : null;
  const gravado = await require('./condicionais').gravarPedidoOS({
    idCliente: dados.id_cliente,
    idVendedor: dados.id_tecnico || (Number(usuario?.id) > 0 ? Number(usuario.id) : null),
    obs,
    validade: validade && validade >= new Date(new Date().setHours(0, 0, 0, 0)) ? validade : new Date(),
    frete: r2(num(dados.frete) + num(dados.deslocamento)),
    itens: calc.itens.map((it) => ({
      id_identificador: it.id_identificador,
      descricao: it.descricao,
      qtd: it.qtd,
      prc: it.vlr_unit,
      desconto: r2(num(it.desc_item) + num(it.rateio_desc)),
      acrescimo: r2(num(it.acres_item) + num(it.rateio_acres)),
      servico: it.tipo === 'S',
    })),
    depois: async (tx, idPedido) => {
      const ja = await query(tx, 'SELECT ID_PEDIDO FROM GESTOR_OS WHERE ID_OS = ?', [dados.id]);
      if (num(ja[0]?.ID_PEDIDO)) throw new Error(`Esta O.S já foi enviada para a venda (pedido ${num(ja[0].ID_PEDIDO)}).`);
      await query(tx, `
        UPDATE OR INSERT INTO GESTOR_PEDIDO_ORIGEM (ID_PEDIDO, ORIGEM, ID_ORIGEM)
        VALUES (?, 'OS', ?) MATCHING (ID_PEDIDO)`, [idPedido, dados.id]);
      await query(tx, `
        UPDATE GESTOR_OS SET ID_PEDIDO = ?, DT_ENVIO = CURRENT_TIMESTAMP, DT_ALTERACAO = CURRENT_TIMESTAMP
        WHERE ID_OS = ?`, [idPedido, dados.id]);
      await historico(tx, dados.id, usuario, `Serviço concluído — pedido ${idPedido} na venda gerencial`);
    },
  });
  return { id: dados.id, id_pedido: gravado.id };
}

/* ------------------------------------------------------------------ */
/* Impressão e WhatsApp                                                */
/* ------------------------------------------------------------------ */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function money(n) {
  return num(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function qtdTxt(n) {
  return num(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

async function impressao(id) {
  return comBase(async (db) => {
    const os = await lerOs(db, id);
    if (!os) throw new Error('O.S não encontrada.');
    return os;
  });
}

function htmlImpressao(os, loja, opcoes = {}) {
  const formato = ['a4', 'meia', '80'].includes(opcoes.formato) ? opcoes.formato : 'a4';
  if (opcoes.modelo === 'historico') return htmlHistorico(os, loja);
  const fechamento = opcoes.modelo === 'fechamento';
  const termico = formato === '80';
  const meia = formato === 'meia';
  const page = termico
    ? '@page { size: 80mm auto; margin: 3mm; }'
    : '@page { size: A4 portrait; margin: 8mm; }';
  const tela = termico
    ? 'width:72mm;margin:8px auto;padding:3mm;font-size:11.5px;font-family:Consolas,monospace;background:#fff;'
    : 'margin:0;padding:0;background:#e8edf2;font-size:12.5px;';
  const t = os.totais || calcular(os).totais;
  const linhasTot = [
    ['Produtos', t.bruto_produtos],
    ['Serviços', t.bruto_servicos],
    ['Desconto', -t.desconto_total],
    ['Acréscimo', t.acrescimo_total],
    ['Frete', t.frete],
    ['Deslocamento', t.deslocamento],
  ].filter(([, v]) => Math.abs(v) > 0.004);
  const endereco = String(loja?.endereco || '').split('\n').filter(Boolean).map((l) => `<div>${esc(l)}</div>`).join('');
  const tipoTxt = `${os.tipo === 'E' ? 'Externa' : 'Interna'} · ${os.modalidade === 'R' ? 'Remota' : 'Presencial'}`;
  const itens = os.itens || [];
  const corpoItens = !fechamento || !itens.length ? '' : termico
    ? `<div class="sep"></div>${itens.map((it) => `<div>${it.tipo === 'S' ? 'SERV ' : ''}${esc(it.descricao)}</div>
        <div class="lin"><span>${qtdTxt(it.qtd)} x ${money(it.vlr_unit)}</span><span>${money(it.total)}</span></div>`).join('')}`
    : `<h3>Produtos e serviços</h3><table><thead><tr><th>Descrição</th><th class="n">Qtd</th><th class="n">Unitário</th><th class="n">Total</th></tr></thead><tbody>
        ${itens.map((it) => `<tr><td>${it.tipo === 'S' ? '<b>Serviço</b> — ' : ''}${esc(it.descricao)}</td><td class="n">${qtdTxt(it.qtd)}</td><td class="n">${money(it.vlr_unit)}</td><td class="n">${money(it.total)}</td></tr>`).join('')}
      </tbody></table>`;
  const totaisHtml = !fechamento ? '' : termico
    ? `<div class="sep"></div>${linhasTot.map(([n, v]) => `<div class="lin"><span>${n}</span><span>${v < 0 ? '-' : ''}${money(Math.abs(v))}</span></div>`).join('')}
       <div class="lin g"><span>TOTAL</span><span>${money(t.total)}</span></div>`
    : `<div class="tot">${linhasTot.map(([n, v]) => `<div><span>${n}</span><span>${v < 0 ? '− ' : ''}${money(Math.abs(v))}</span></div>`).join('')}
       <div class="g"><span>Total</span><span>${money(t.total)}</span></div></div>`;
  const campo = (rotulo, valor) => (valor ? `<div><span class="r">${rotulo}</span><br>${esc(valor)}</div>` : '');
  const campoLargo = (rotulo, valor) => (valor ? `<div class="largo"><span class="r">${rotulo}</span><br>${esc(valor)}</div>` : '');
  const bloco = (rotulo, valor, alto) => (valor || alto ? `<h3>${rotulo}</h3><div class="bloco${alto ? ' alto' : ''}">${esc(valor || '')}</div>` : '');
  const marca = loja?.logo
    ? `<img class="logo" src="${esc(loja.logo)}" alt="Logo" />`
    : '<div class="logo vazio" aria-hidden="true"></div>';
  const rotAutor = [os.autor_rotulo, os.autor_contato ? `contato ${os.autor_contato}` : ''].filter(Boolean).join(' · ');
  const autor = os.autorizacao || rotAutor
    ? `${rotAutor ? `${rotAutor}${os.autorizacao ? ' — ' : ''}` : ''}${os.autorizacao || ''}`
    : '';
  const cab = termico
    ? `<div class="cab-t">${marca}<div><b style="font-size:13px">${esc(loja?.nome || 'Loja')}</b>${endereco}${loja?.telefone ? `<div>${esc(loja.telefone)}</div>` : ''}</div></div>
       <div class="sep"></div><div style="text-align:center"><b style="font-size:14px">O.S ${os.id} — ${fechamento ? 'FECHAMENTO' : 'ABERTURA'}</b><br>${esc(os.emissao_br)}</div><div class="sep"></div>`
    : `<header class="cab">${marca}<div class="loja"><h1>${esc(loja?.nome || 'Loja')}</h1><div class="end">${endereco}${loja?.telefone ? `<div>${esc(loja.telefone)}</div>` : ''}</div></div>
       <div class="os"><span class="r">${fechamento ? 'Fechamento' : 'Abertura'}</span><b>O.S ${os.id}</b><span>${esc(os.emissao_br)}</span></div></header>`;
  const dadosCli = termico
    ? `Cliente: ${esc(os.cliente?.nome || '—')}${os.cliente?.documento ? `<br>Doc.: ${esc(os.cliente.documento)}` : ''}${os.cliente?.telefone ? `<br>Fone: ${esc(fmtFone(os.cliente.telefone))}` : ''}
       <br>Equip.: ${esc(os.equipamento)}${os.categoria ? `<br>Categoria: ${esc(os.subcategoria ? `${os.categoria} › ${os.subcategoria}` : os.categoria)}` : ''}${os.quem_trouxe ? `<br>Trouxe: ${esc(os.quem_trouxe)}` : ''}${os.tecnico ? `<br>Técnico: ${esc(os.tecnico.nome)}` : ''}
       ${os.previsao ? `<br>Previsão: ${dataBr(os.previsao)}` : ''}${fechamento && os.entrega ? `<br>Entrega: ${dataHoraBr(os.entrega)}` : ''}
       <div class="sep"></div>Defeito: ${esc(os.defeito)}${autor ? `<br>Autorização${rotAutor ? ` (${esc(rotAutor)})` : ''}: ${esc(os.autorizacao)}` : ''}${fechamento && os.solucao ? `<br>Solução: ${esc(os.solucao)}` : ''}`
    : `<h3>Cliente</h3><div class="bloco grade">${campo('Nome', os.cliente?.nome)}${campo('CPF/CNPJ', os.cliente?.documento)}${campo('Telefone', fmtFone(os.cliente?.telefone))}${campo('Endereço', os.cliente?.endereco)}</div>
       <h3>Atendimento</h3><div class="bloco grade">${campo('Tipo', tipoTxt)}${campo('Técnico', os.tecnico?.nome)}${campo('Categoria', os.subcategoria ? `${os.categoria} › ${os.subcategoria}` : os.categoria)}${campo('Quem trouxe', os.quem_trouxe)}${campo('Previsão', dataBr(os.previsao))}${fechamento ? campo('Entrega', dataHoraBr(os.entrega)) : ''}${campoLargo('Equipamento', os.equipamento)}${campo('Defeito apresentado', os.defeito)}${campo(`Autorização solicitada${rotAutor ? ` · ${rotAutor}` : ''}`, os.autorizacao)}</div>${fechamento ? bloco('Solução', os.solucao) : ''}${os.obs ? bloco('Observações', os.obs) : ''}`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>O.S ${os.id}</title>
<style>
  ${page}
  body{color:#152033;box-sizing:border-box;font-family:Segoe UI,Arial,sans-serif;${tela}}
  .folha{width:210mm;min-height:297mm;margin:12px auto;background:#fff;box-shadow:0 8px 28px rgba(21,32,51,.12)}
  .miolo{padding:8mm 10mm;box-sizing:border-box}
  .folha.meia .miolo{height:auto;min-height:148.5mm;overflow:visible;position:relative}
  .folha.meia .miolo:after{content:'';position:absolute;left:0;right:0;top:148.5mm;border-top:1px dashed #c5ced8;pointer-events:none}
  .logo{width:32mm;height:18mm;object-fit:contain;object-position:left center;flex:none}
  .logo.vazio{border:1px dashed #d5dde6;border-radius:4px}
  .cab-t{display:flex;align-items:center;gap:8px;text-align:left}
  .cab-t .logo{width:16mm;height:12mm}
  .cab{display:flex;align-items:flex-start;gap:12px;border-bottom:2px solid #152033;padding-bottom:8px}
  .cab .loja{flex:1;min-width:0}
  .cab h1{margin:0;font-size:${meia ? '16px' : '19px'}} .end{font-size:11px;color:#5c6b7a;margin-top:3px}
  .par{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:start}
  .par h3{margin-top:12px}
  .os{text-align:right;white-space:nowrap} .os b{display:block;font-size:${formato === 'meia' ? '18px' : '22px'}}
  .r{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:#5c6b7a}
  h3{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#5c6b7a;margin:14px 0 5px}
  .bloco{border:1px solid #dfe4ea;border-radius:7px;padding:8px 10px;white-space:pre-wrap}
  .bloco.alto{min-height:70px} .grade{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 18px;white-space:normal}
  .grade .largo{grid-column:1 / -1}
  .folha.meia h3{margin:7px 0 3px} .folha.meia .bloco{padding:6px 8px} .folha.meia .assina{margin-top:14px;gap:18px} .folha.meia .termo{margin-top:8px}
  .folha.meia.fechamento .miolo{height:auto;overflow:visible;border-bottom:0}
  .folha.meia.fechamento .miolo:after{content:none}
  table{width:100%;border-collapse:collapse;font-size:11.5px} th{text-align:left;font-size:10px;text-transform:uppercase;color:#5c6b7a;border-bottom:1px solid #cfd6de;padding:4px}
  td{border-bottom:1px solid #eef1f4;padding:5px 4px} .n{text-align:right;white-space:nowrap}
  .tot{margin-left:auto;width:250px;margin-top:8px} .tot div{display:flex;justify-content:space-between;padding:2px 0}
  .tot .g{border-top:2px solid #152033;margin-top:4px;padding-top:5px;font-size:15px;font-weight:700}
  .assina{display:grid;grid-template-columns:1fr 1fr;gap:36px;margin-top:46px;text-align:center;font-size:11px;color:#5c6b7a}
  .assina div{border-top:1px solid #152033;padding-top:5px}
  .sep{border-top:1px dashed #000;margin:7px 0} .lin{display:flex;justify-content:space-between;gap:8px} .lin.g{font-weight:700;font-size:14px;margin-top:3px}
  .termo{font-size:10.5px;color:#5c6b7a;margin-top:12px}
  button{margin:12px;padding:8px 14px;font:inherit}
  @media print {
    body{background:#fff}
    button{display:none}
    .folha{width:auto;min-height:0;margin:0;box-shadow:none}
    .folha.meia .miolo{height:auto;min-height:0;overflow:visible}
    .folha.meia .miolo:after{top:140.5mm}
    .folha.meia.fechamento .miolo:after{content:none}
  }
</style></head><body>
<button type="button" onclick="if(parent!==window){parent.postMessage({tipo:'gestor-imprimir'}, location.origin)}else{window.print()}">Imprimir / Salvar PDF</button>
${termico ? `${cab}` : `<div class="folha${meia ? ' meia' : ''}${fechamento ? ' fechamento' : ''}"><div class="miolo">${cab}`}
${dadosCli}
${corpoItens}
${totaisHtml}
${!fechamento && !termico ? '<p class="termo">O orçamento é informado antes da execução do serviço. Equipamento não retirado em até 90 dias após o aviso de conclusão poderá ter a destinação prevista em lei.</p>' : ''}
${termico ? '<div class="sep" style="margin-bottom:26px"></div><div style="border-top:1px solid #000;text-align:center;padding-top:3px">Assinatura do cliente</div>'
    : `<div class="assina"><div>${fechamento ? 'Recebi o equipamento em ordem' : 'Assinatura do cliente'}</div><div>${esc(loja?.nome || 'Loja')}${os.tecnico ? ` — ${esc(os.tecnico.nome)}` : ''}</div></div></div></div>`}
</body></html>`;
}

function htmlHistorico(os, loja) {
  const linhas = [...(os.historico || [])].reverse();
  const marca = loja?.logo
    ? `<img class="logo" src="${esc(loja.logo)}" alt="Logo" />`
    : '<div class="logo vazio" aria-hidden="true"></div>';
  const itens = linhas.length
    ? linhas.map((h) => `<tr><td>${esc(h.data)}</td><td>${esc(h.usuario || '—')}</td><td>${esc(h.evento || '')}${h.status_novo?.descricao ? ` <b>${esc(h.status_novo.descricao)}</b>` : ''}</td></tr>`).join('')
    : '<tr><td colspan="3">Sem registros</td></tr>';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Histórico O.S ${os.id}</title>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  body{margin:0;background:#e8edf2;color:#152033;font-family:Segoe UI,Arial,sans-serif;font-size:12.5px}
  .folha{width:210mm;min-height:297mm;margin:12px auto;background:#fff}
  .miolo{padding:10mm}
  .logo{width:32mm;height:18mm;object-fit:contain;object-position:left center;flex:none}
  .logo.vazio{border:1px dashed #d5dde6;border-radius:4px}
  .cab{display:flex;align-items:flex-start;gap:12px;border-bottom:2px solid #152033;padding-bottom:8px}
  .cab .loja{flex:1} .cab h1{margin:0;font-size:18px} .os{text-align:right} .os b{display:block;font-size:20px}
  table{width:100%;border-collapse:collapse;margin-top:14px} th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e6ebf0;vertical-align:top}
  th{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#5c6b7a}
  button{margin:12px;padding:8px 14px;font:inherit}
  @media print { body{background:#fff} button{display:none} .folha{width:auto;min-height:0;margin:0} }
</style></head><body>
<button type="button" onclick="if(parent!==window){parent.postMessage({tipo:'gestor-imprimir'}, location.origin)}else{window.print()}">Imprimir / Salvar PDF</button>
<div class="folha"><div class="miolo">
<header class="cab">${marca}<div class="loja"><h1>${esc(loja?.nome || 'Loja')}</h1><div>Histórico da O.S</div></div>
<div class="os"><b>O.S ${os.id}</b><span>${esc(os.cliente?.nome || '')}</span></div></header>
<table><thead><tr><th>Quando</th><th>Quem</th><th>O que aconteceu</th></tr></thead><tbody>${itens}</tbody></table>
</div></div></body></html>`;
}

function textoWhatsapp(os, modelo) {
  const fechamento = modelo === 'fechamento';
  const t = os.totais || calcular(os).totais;
  const linhas = [
    `*O.S ${os.id}* — ${fechamento ? 'fechamento' : 'abertura'}`,
    `Cliente: ${os.cliente?.nome || ''}`,
    `Equipamento: ${os.equipamento}`,
    `Defeito: ${os.defeito}`,
  ];
  if (os.autorizacao || os.autor_rotulo) linhas.push(`Autorização solicitada${os.autor_rotulo ? ` (${os.autor_rotulo})` : ''}: ${os.autorizacao || '—'}`);
  if (os.previsao) linhas.push(`Previsão: ${dataBr(os.previsao)}`);
  if (fechamento) {
    if (os.solucao) linhas.push(`Solução: ${os.solucao}`);
    for (const it of os.itens || []) linhas.push(`• ${it.descricao} — ${qtdTxt(it.qtd)} × ${money(it.vlr_unit)} = ${money(it.total)}`);
    if (t.desconto_total > 0) linhas.push(`Desconto: ${money(t.desconto_total)}`);
    if (t.acrescimo_total > 0) linhas.push(`Acréscimo: ${money(t.acrescimo_total)}`);
    if (t.frete > 0) linhas.push(`Frete: ${money(t.frete)}`);
    if (t.deslocamento > 0) linhas.push(`Deslocamento: ${money(t.deslocamento)}`);
    linhas.push(`*Total: ${money(t.total)}*`);
  }
  return linhas.filter(Boolean).join('\n');
}

async function enviarWhatsapp(id, { numero, modelo }, usuario) {
  const fone = soDigitos(numero);
  if (fone.length < 10) throw new Error('Confira o celular do cliente (DDD + número).');
  return comBase(async (db) => {
    const os = await lerOs(db, id);
    if (!os) throw new Error('O.S não encontrada.');
    const rotulo = `${modelo === 'fechamento' ? 'Fechamento' : 'Abertura'} enviado no WhatsApp para ${fmtFone(fone)}`;
    const r = await enviarOuEnfileirar({ numero: fone, texto: textoWhatsapp(os, modelo), idOs: os.id, rotulo, usuario });
    if (r.enfileirada) return { ok: true, enfileirada: true, aviso: 'Sem internet agora: a mensagem vai sair quando a conexão voltar.' };
    await historico(db, os.id, usuario, rotulo);
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ */
/* Triggers do Clipp: a atualização do Clipp pode reescrever a reserva */
/* ------------------------------------------------------------------ */

async function conferirTriggersClipp() {
  const rows = await withDb((db) => query(db, `
    SELECT TRIM(RDB$TRIGGER_NAME) AS N, RDB$TRIGGER_INACTIVE AS I, CAST(RDB$TRIGGER_SOURCE AS VARCHAR(32000)) AS S
    FROM RDB$TRIGGERS
    WHERE TRIM(RDB$RELATION_NAME) IN ('TB_PEDIDO_VENDA', 'TB_PED_VENDA_ITEM') AND COALESCE(RDB$SYSTEM_FLAG, 0) = 0
    ORDER BY 1`));
  const assinatura = crypto.createHash('sha256')
    .update(rows.map((r) => `${r.N}|${r.I}|${String(r.S || '').replace(/\s+/g, ' ')}`).join('\n'))
    .digest('hex');
  const cfg = loadAppConfig();
  if (cfg.os_triggers_clipp === assinatura) return { mudou: false };
  const primeira = !cfg.os_triggers_clipp;
  saveAppConfig({ ...cfg, os_triggers_clipp: assinatura, os_triggers_clipp_em: new Date().toISOString() });
  return { mudou: !primeira, primeira };
}

module.exports = {
  ICONES,
  CORES,
  listar,
  detalhe,
  salvar,
  mudarStatus,
  reordenar,
  vincularTecnico,
  enviarParaVenda,
  cancelar,
  listarStatus,
  salvarStatus,
  ordenarStatus,
  listarFuncionarios,
  salvarFuncionario,
  listarMensagens,
  salvarMensagem,
  excluirMensagem,
  listarSolucoes,
  sugerirSolucoes,
  salvarSolucao,
  excluirSolucao,
  usarSolucao,
  clienteResumo,
  buscarClientes,
  buscarCategorias,
  cadastrarCategoria,
  consultarCnpj,
  buscarItens,
  lerLimites,
  salvarLimites,
  liberarDesconto,
  impressao,
  htmlImpressao,
  textoWhatsapp,
  enviarWhatsapp,
  conferirTriggersClipp,
  perfilServicos,
  _calcular: calcular,
  processarFilaWhatsapp,
  _comBase: comBase,
  _mapasApoio: mapasApoio,
  _lerOs: lerOs,
  _historico: historico,
  _lerFuncionarios: lerFuncionarios,
  _lerStatus: lerStatus,
  _foneCliente: foneCliente,
  _fmtDoc: fmtDoc,
  _fmtFone: fmtFone,
  _SQL_TIPO: SQL_TIPO,
  _TIPOS: { produto: TIPOS_PRODUTO, servico: TIPOS_SERVICO },
};
