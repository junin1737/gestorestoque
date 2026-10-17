'use strict';

const { withDb, withTransaction, query, nextGenId, columnExists } = require('./db');

const PAIS_BRASIL = '1058';

function txt(v, max) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return max ? s.slice(0, max) : s;
}

function digitos(v) {
  return String(v ?? '').replace(/\D/g, '');
}

function dataIso(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Data inválida.');
  return s;
}

function cpf(v) {
  const d = digitos(v);
  if (!d) return null;
  if (d.length !== 11) throw new Error('CPF incompleto.');
  return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

function cnpj(v) {
  const d = digitos(v);
  if (!d) return null;
  if (d.length !== 14) throw new Error('CNPJ incompleto.');
  return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

function cep(v) {
  const d = digitos(v);
  if (!d) return null;
  if (d.length !== 8) throw new Error('CEP incompleto.');
  return d.replace(/(\d{5})(\d{3})/, '$1-$2');
}

/** DDD fica na coluna de 2; o restante cabe no telefone de 13. */
function fone(v) {
  const bruto = String(v ?? '').trim();
  const d = digitos(bruto);
  if (!d) return { ddd: null, numero: null };
  if (d.length >= 10) return { ddd: d.slice(0, 2), numero: d.slice(2, 15) };
  return { ddd: null, numero: bruto.slice(0, 13) };
}

function status(v) {
  return String(v || '').trim().toUpperCase() === 'I' ? 'I' : 'A';
}

function idNum(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function montarFiltro(q, situacao, pessoa) {
  const where = [];
  const params = [];
  if (situacao === 'A' || situacao === 'I') {
    where.push(`TRIM(C.STATUS) = ?`);
    params.push(situacao);
  }
  if (pessoa === 'pf') where.push(`TRIM(COALESCE(PF.CPF, '')) <> ''`);
  else if (pessoa === 'pj') where.push(`TRIM(COALESCE(PJ.CNPJ, '')) <> ''`);
  const termo = String(q || '').trim();
  if (termo) {
    const nums = digitos(termo);
    const soNumero = nums.length >= 1 && nums.length === termo.replace(/[\s.\-/]/g, '').length;
    if (soNumero) {
      const idOk = /^\d+$/.test(termo) && Number(termo) > 0 && Number(termo) <= 2147483647;
      where.push(`(
        ${idOk ? 'C.ID_CLIENTE = ? OR ' : ''}
        REPLACE(REPLACE(REPLACE(TRIM(COALESCE(PF.CPF, '')), '.', ''), '-', ''), '/', '') CONTAINING ?
        OR REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(PJ.CNPJ, '')), '.', ''), '-', ''), '/', ''), ' ', '') CONTAINING ?
        OR REPLACE(COALESCE(C.FONE_CELUL, ''), ' ', '') CONTAINING ?
        OR REPLACE(COALESCE(C.FONE_RESID, ''), ' ', '') CONTAINING ?
        OR REPLACE(COALESCE(C.FONE_COMER, ''), ' ', '') CONTAINING ?
        OR UPPER(C.NOME) CONTAINING UPPER(?)
        OR UPPER(COALESCE(PJ.NOME_FANTA, '')) CONTAINING UPPER(?)
      )`);
      if (idOk) params.push(Number(termo));
      params.push(nums, nums, nums, nums, nums, termo, termo);
    } else {
      const partes = termo.split(/\s+/).map((p) => p.trim()).filter(Boolean);
      for (const p of partes) {
        where.push(`(
          UPPER(C.NOME) CONTAINING UPPER(?)
          OR UPPER(COALESCE(PJ.NOME_FANTA, '')) CONTAINING UPPER(?)
          OR UPPER(COALESCE(C.CONTATO, '')) CONTAINING UPPER(?)
        )`);
        params.push(p, p, p);
      }
    }
  }
  return { where, params };
}

function mapLista(r) {
  return {
    id: Number(r.ID_CLIENTE),
    nome: String(r.NOME || '').trim(),
    fantasia: String(r.NOME_FANTA || '').trim(),
    status: String(r.STATUS || '').trim(),
    cpf: String(r.CPF || '').trim(),
    cnpj: String(r.CNPJ || '').trim(),
    cidade: String(r.CIDADE || '').trim(),
    uf: String(r.UF || '').trim(),
    fone: [String(r.DDD_CELUL || '').trim(), String(r.FONE_CELUL || '').trim()].filter(Boolean).join(' '),
  };
}

async function listar({ q, status: situacao, pessoa } = {}) {
  return withDb(async (db) => {
    const sit = String(situacao || 'A').trim().toUpperCase();
    const pes = String(pessoa || '').trim().toLowerCase();
    const filtro = montarFiltro(q, sit === 'TODOS' || sit === '' ? '' : sit, pes);
    const rows = await query(db, `
      SELECT FIRST 80 C.ID_CLIENTE, C.NOME, C.STATUS, C.DDD_CELUL, C.FONE_CELUL,
             PF.CPF, PJ.CNPJ, PJ.NOME_FANTA, CID.NOME AS CIDADE, CID.SIGLA_UF AS UF
      FROM TB_CLIENTE C
      LEFT JOIN TB_CLI_PF PF ON PF.ID_CLIENTE = C.ID_CLIENTE
      LEFT JOIN TB_CLI_PJ PJ ON PJ.ID_CLIENTE = C.ID_CLIENTE
      LEFT JOIN TB_CIDADE_SIS CID ON CID.ID_CIDADE = C.ID_CIDADE
      ${filtro.where.length ? `WHERE ${filtro.where.join(' AND ')}` : ''}
      ORDER BY C.ID_CLIENTE DESC`, filtro.params);
    return { itens: rows.map(mapLista), limite: 80 };
  });
}

async function opcoes() {
  return withDb(async (db) => {
    const tipos = await query(db, `SELECT ID_TIPO, DESCRICAO FROM TB_CLI_TIPO_SIS ORDER BY DESCRICAO`);
    const enderecos = await query(db, `SELECT ID_TIPOEND, DESCRICAO FROM TB_CLI_END_TIPO_SIS ORDER BY ID_TIPOEND`);
    return {
      tipos: tipos.map((r) => ({ id: Number(r.ID_TIPO), descricao: String(r.DESCRICAO || '').trim() })),
      enderecos: enderecos.map((r) => ({ id: Number(r.ID_TIPOEND), descricao: String(r.DESCRICAO || '').trim() })),
    };
  });
}

async function cidades(q, uf) {
  const termo = String(q || '').trim();
  const estado = String(uf || '').trim().toUpperCase();
  if (termo.length < 2) return [];
  const porUf = /^[A-Z]{2}$/.test(estado);
  return withDb(async (db) => {
    const rows = await query(db, `
      SELECT FIRST 15 ID_CIDADE, NOME, SIGLA_UF
      FROM TB_CIDADE_SIS
      WHERE UPPER(NOME) CONTAINING UPPER(?)
        ${porUf ? 'AND UPPER(TRIM(SIGLA_UF)) = ?' : ''}
      ORDER BY NOME`, porUf ? [termo, estado] : [termo]);
    return rows.map((r) => ({
      id: Number(r.ID_CIDADE),
      nome: String(r.NOME || '').trim(),
      uf: String(r.SIGLA_UF || '').trim(),
    }));
  });
}

function mapDetalhe(r, enderecos, contatos, referencias) {
  const cpfVal = String(r.CPF || '').trim();
  const cnpjVal = String(r.CNPJ || '').trim();
  return {
    id: Number(r.ID_CLIENTE),
    nome: String(r.NOME || '').trim(),
    status: String(r.STATUS || 'A').trim() || 'A',
    id_tipo: r.ID_TIPO == null ? null : Number(r.ID_TIPO),
    pessoa: cnpjVal ? 'pj' : 'pf',
    contato: String(r.CONTATO || '').trim(),
    email: String(r.EMAIL_CONT || '').trim(),
    email_nfe: String(r.EMAIL_NFE || '').trim(),
    celular: [String(r.DDD_CELUL || '').trim(), String(r.FONE_CELUL || '').trim()].filter(Boolean).join(' '),
    residencial: [String(r.DDD_RESID || '').trim(), String(r.FONE_RESID || '').trim()].filter(Boolean).join(' '),
    comercial: [String(r.DDD_COMER || '').trim(), String(r.FONE_COMER || '').trim()].filter(Boolean).join(' '),
    cep: String(r.END_CEP || '').trim(),
    end_tipo: String(r.END_TIPO || '').trim(),
    logradouro: String(r.END_LOGRAD || '').trim(),
    numero: String(r.END_NUMERO || '').trim(),
    bairro: String(r.END_BAIRRO || '').trim(),
    complemento: String(r.END_COMPLE || '').trim(),
    id_cidade: r.ID_CIDADE == null ? null : Number(r.ID_CIDADE),
    cidade: String(r.CIDADE || '').trim(),
    uf: String(r.UF || '').trim(),
    cpf: cpfVal,
    identidade: String(r.IDENTIDADE || '').trim(),
    nascimento: r.DT_NASCTO ? String(r.DT_NASCTO).slice(0, 10) : '',
    profissao: String(r.PROFISSAO || '').trim(),
    nome_pai: String(r.NOME_PAI || '').trim(),
    nome_mae: String(r.NOME_MAE || '').trim(),
    cnpj: cnpjVal,
    fantasia: String(r.NOME_FANTA || '').trim(),
    insc_estadual: String(r.INSC_ESTAD || '').trim(),
    insc_municipal: String(r.INSC_MUNIC || '').trim(),
    suframa: String(r.INSC_SUFRAMA || '').trim(),
    ind_ie: String(r.IND_IE_DEST || '').trim(),
    enderecos,
    contatos,
    referencias,
  };
}

async function detalhe(id) {
  const codigo = idNum(id);
  if (!codigo) throw new Error('Cliente inválido.');
  return withDb(async (db) => {
    const rows = await query(db, `
      SELECT C.ID_CLIENTE, C.NOME, C.STATUS, C.ID_TIPO, C.CONTATO, C.EMAIL_CONT, C.EMAIL_NFE,
             C.DDD_CELUL, C.FONE_CELUL, C.DDD_RESID, C.FONE_RESID, C.DDD_COMER, C.FONE_COMER,
             C.END_CEP, C.END_TIPO, C.END_LOGRAD, C.END_NUMERO, C.END_BAIRRO, C.END_COMPLE, C.ID_CIDADE,
             CID.NOME AS CIDADE, CID.SIGLA_UF AS UF,
             PF.CPF, PF.IDENTIDADE, PF.DT_NASCTO, PF.PROFISSAO, PF.NOME_PAI, PF.NOME_MAE,
             PJ.CNPJ, PJ.NOME_FANTA, PJ.INSC_ESTAD, PJ.INSC_MUNIC, PJ.INSC_SUFRAMA, PJ.IND_IE_DEST
      FROM TB_CLIENTE C
      LEFT JOIN TB_CLI_PF PF ON PF.ID_CLIENTE = C.ID_CLIENTE
      LEFT JOIN TB_CLI_PJ PJ ON PJ.ID_CLIENTE = C.ID_CLIENTE
      LEFT JOIN TB_CIDADE_SIS CID ON CID.ID_CIDADE = C.ID_CIDADE
      WHERE C.ID_CLIENTE = ?`, [codigo]);
    if (!rows.length) throw new Error('Cliente não encontrado.');
    const enderecos = await query(db, `
      SELECT E.ID_CLI_END_CMPL, E.ID_TIPOEND, E.END_CEP, E.END_TIPO, E.END_LOGRAD, E.END_NUMERO,
             E.END_BAIRRO, E.END_COMPLE, E.ID_CIDADE, CID.NOME AS CIDADE, CID.SIGLA_UF AS UF
      FROM TB_CLI_END_CMPL E
      LEFT JOIN TB_CIDADE_SIS CID ON CID.ID_CIDADE = E.ID_CIDADE
      WHERE E.ID_CLIENTE = ?
      ORDER BY E.ID_CLI_END_CMPL`, [codigo]);
    const contatos = await query(db, `
      SELECT ID_OUTROS_CONTATOS, NOME, FONE, EMAIL
      FROM TB_OUTROS_CONTATOS
      WHERE ID_CLIENTE = ?
      ORDER BY ID_OUTROS_CONTATOS`, [codigo]);
    const referencias = await query(db, `
      SELECT REFERENCIA, DDD_REFER, FONE
      FROM TB_CLI_REFERENCIA
      WHERE ID_CLIENTE = ?
      ORDER BY REFERENCIA`, [codigo]);
    return mapDetalhe(rows[0], enderecos.map((e) => ({
      id: Number(e.ID_CLI_END_CMPL),
      tipoend: Number(e.ID_TIPOEND) || 2,
      cep: String(e.END_CEP || '').trim(),
      end_tipo: String(e.END_TIPO || '').trim(),
      logradouro: String(e.END_LOGRAD || '').trim(),
      numero: String(e.END_NUMERO || '').trim(),
      bairro: String(e.END_BAIRRO || '').trim(),
      complemento: String(e.END_COMPLE || '').trim(),
      id_cidade: e.ID_CIDADE == null ? null : Number(e.ID_CIDADE),
      cidade: String(e.CIDADE || '').trim(),
      uf: String(e.UF || '').trim(),
    })), contatos.map((c) => ({
      id: Number(c.ID_OUTROS_CONTATOS),
      nome: String(c.NOME || '').trim(),
      fone: String(c.FONE || '').trim(),
      email: String(c.EMAIL || '').trim(),
    })), referencias.map((c) => ({
      nome: String(c.REFERENCIA || '').trim(),
      fone: [String(c.DDD_REFER || '').trim(), String(c.FONE || '').trim()].filter(Boolean).join(' '),
    })));
  });
}

async function documentoLivre(db, tabela, coluna, valor, idAtual) {
  if (!valor) return;
  const rows = await query(db, `
    SELECT FIRST 1 C.ID_CLIENTE, C.NOME
    FROM ${tabela} D
    JOIN TB_CLIENTE C ON C.ID_CLIENTE = D.ID_CLIENTE
    WHERE TRIM(D.${coluna}) = ? AND C.ID_CLIENTE <> ?`, [valor, idAtual || 0]);
  if (rows.length) {
    throw new Error(`${coluna === 'CPF' ? 'CPF' : 'CNPJ'} já cadastrado em ${String(rows[0].NOME || '').trim() || 'outro cliente'}.`);
  }
}

async function gravarFilhos(tx, id, body, docPf, docPj) {
  const pessoa = body.pessoa === 'pj' ? 'pj' : 'pf';
  const nascto = dataIso(body.nascimento);
  const pfVals = [docPf, txt(body.identidade, 16), nascto, txt(body.profissao, 30), txt(body.nome_pai, 60), txt(body.nome_mae, 60)];
  const temPf = await query(tx, `SELECT 1 AS OK FROM TB_CLI_PF WHERE ID_CLIENTE = ?`, [id]);
  if (temPf.length) {
    await query(tx, `
      UPDATE TB_CLI_PF
      SET CPF = ?, IDENTIDADE = ?, DT_NASCTO = ?, PROFISSAO = ?, NOME_PAI = ?, NOME_MAE = ?
      WHERE ID_CLIENTE = ?`, [...pfVals, id]);
  } else if (pessoa === 'pf' || docPf) {
    await query(tx, `
      INSERT INTO TB_CLI_PF (ID_CLIENTE, CPF, IDENTIDADE, DT_NASCTO, PROFISSAO, NOME_PAI, NOME_MAE)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [id, ...pfVals]);
  }
  const ie = ['1', '2', '9'].includes(String(body.ind_ie || '')) ? String(body.ind_ie) : null;
  const pjParams = [
    docPj,
    txt(body.fantasia, 40),
    txt(body.insc_estadual, 16),
    txt(body.insc_municipal, 16),
    txt(body.suframa, 9),
    ie,
    id,
  ];
  const temPj = await query(tx, `SELECT 1 AS OK FROM TB_CLI_PJ WHERE ID_CLIENTE = ?`, [id]);
  if (temPj.length) {
    await query(tx, `
      UPDATE TB_CLI_PJ
      SET CNPJ = ?, NOME_FANTA = ?, INSC_ESTAD = ?, INSC_MUNIC = ?, INSC_SUFRAMA = ?, IND_IE_DEST = ?
      WHERE ID_CLIENTE = ?`, pjParams);
  } else if (pessoa === 'pj' || docPj) {
    await query(tx, `
      INSERT INTO TB_CLI_PJ (ID_CLIENTE, CNPJ, NOME_FANTA, INSC_ESTAD, INSC_MUNIC, INSC_SUFRAMA, IND_IE_DEST)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [id, docPj, pjParams[1], pjParams[2], pjParams[3], pjParams[4], ie]);
  }

  await query(tx, `DELETE FROM TB_CLI_END_CMPL WHERE ID_CLIENTE = ?`, [id]);
  for (const end of Array.isArray(body.enderecos) ? body.enderecos : []) {
    const logradouro = txt(end.logradouro, 40);
    if (!logradouro && !txt(end.cep, 9)) continue;
    const idEnd = await nextGenId(tx, 'GEN_TB_CLI_END_CMPL', 'TB_CLI_END_CMPL', 'ID_CLI_END_CMPL');
    const tipoend = Number(end.tipoend) === 1 ? 1 : 2;
    await query(tx, `
      INSERT INTO TB_CLI_END_CMPL (
        ID_CLI_END_CMPL, ID_CLIENTE, ID_TIPOEND, END_CEP, END_TIPO, END_LOGRAD, END_NUMERO, END_BAIRRO, END_COMPLE, ID_CIDADE
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      idEnd, id, tipoend, cep(end.cep), txt(end.end_tipo, 15), logradouro, txt(end.numero, 5),
      txt(end.bairro, 35), txt(end.complemento, 30), idNum(end.id_cidade),
    ]);
  }

  await query(tx, `DELETE FROM TB_OUTROS_CONTATOS WHERE ID_CLIENTE = ?`, [id]);
  for (const c of Array.isArray(body.contatos) ? body.contatos : []) {
    const nome = txt(c.nome, 60);
    if (!nome) continue;
    const idC = await nextGenId(tx, 'GEN_TB_OUTROS_CONTATOS_ID', 'TB_OUTROS_CONTATOS', 'ID_OUTROS_CONTATOS');
    await query(tx, `
      INSERT INTO TB_OUTROS_CONTATOS (ID_OUTROS_CONTATOS, ID_CLIENTE, NOME, FONE, EMAIL, ATIVO)
      VALUES (?, ?, ?, ?, ?, 'S')`, [idC, id, nome, txt(c.fone, 15), txt(c.email, 100)]);
  }

  await query(tx, `DELETE FROM TB_CLI_REFERENCIA WHERE ID_CLIENTE = ?`, [id]);
  for (const r of Array.isArray(body.referencias) ? body.referencias : []) {
    const nome = txt(r.nome, 40);
    if (!nome) continue;
    const tel = fone(r.fone);
    await query(tx, `
      INSERT INTO TB_CLI_REFERENCIA (ID_CLIENTE, REFERENCIA, DDD_REFER, FONE)
      VALUES (?, ?, ?, ?)`, [id, nome, tel.ddd, tel.numero]);
  }
}

function camposCliente(body) {
  const nome = txt(body.nome, 60);
  if (!nome) throw new Error('Informe o nome do cliente.');
  const cel = fone(body.celular);
  const res = fone(body.residencial);
  const com = fone(body.comercial);
  return {
    nome,
    status: status(body.status),
    idTipo: idNum(body.id_tipo),
    contato: txt(body.contato, 35),
    email: txt(body.email, 70),
    emailNfe: txt(body.email_nfe, 70),
    cel, res, com,
    cep: cep(body.cep),
    endTipo: txt(body.end_tipo, 15),
    logradouro: txt(body.logradouro, 40),
    numero: txt(body.numero, 5),
    bairro: txt(body.bairro, 35),
    complemento: txt(body.complemento, 30),
    idCidade: idNum(body.id_cidade),
  };
}

async function salvar(body) {
  const dados = camposCliente(body || {});
  const docPf = cpf(body?.cpf);
  const docPj = cnpj(body?.cnpj);
  const idInformado = idNum(body?.id);
  return withDb(async (db) => withTransaction(db, async (tx) => {
    await documentoLivre(tx, 'TB_CLI_PF', 'CPF', docPf, idInformado);
    await documentoLivre(tx, 'TB_CLI_PJ', 'CNPJ', docPj, idInformado);
    if (dados.idCidade) {
      const cid = await query(tx, `SELECT 1 AS OK FROM TB_CIDADE_SIS WHERE ID_CIDADE = ?`, [dados.idCidade]);
      if (!cid.length) throw new Error('Cidade não encontrada. Escolha uma da lista.');
    }
    let id = idInformado;
    const valores = [
      dados.nome, dados.status, dados.idTipo, dados.contato, dados.email, dados.emailNfe,
      dados.cel.ddd, dados.cel.numero, dados.res.ddd, dados.res.numero, dados.com.ddd, dados.com.numero,
      dados.cep, dados.endTipo, dados.logradouro, dados.numero, dados.bairro, dados.complemento, dados.idCidade,
    ];
    if (id) {
      const tem = await query(tx, `SELECT 1 AS OK FROM TB_CLIENTE WHERE ID_CLIENTE = ?`, [id]);
      if (!tem.length) throw new Error('Cliente não encontrado.');
      await query(tx, `
        UPDATE TB_CLIENTE SET
          NOME = ?, STATUS = ?, ID_TIPO = ?, CONTATO = ?, EMAIL_CONT = ?, EMAIL_NFE = ?,
          DDD_CELUL = ?, FONE_CELUL = ?, DDD_RESID = ?, FONE_RESID = ?, DDD_COMER = ?, FONE_COMER = ?,
          END_CEP = ?, END_TIPO = ?, END_LOGRAD = ?, END_NUMERO = ?, END_BAIRRO = ?, END_COMPLE = ?, ID_CIDADE = ?
        WHERE ID_CLIENTE = ?`, [...valores, id]);
    } else {
      id = await nextGenId(tx, 'GEN_TB_CLIENTE_ID', 'TB_CLIENTE', 'ID_CLIENTE');
      const marcaAtualizacao = await columnExists(tx, 'TB_CLIENTE', 'UPDATED_INTEGRADORA');
      await query(tx, `
        INSERT INTO TB_CLIENTE (
          ID_CLIENTE, NOME, STATUS, ID_TIPO, CONTATO, EMAIL_CONT, EMAIL_NFE,
          DDD_CELUL, FONE_CELUL, DDD_RESID, FONE_RESID, DDD_COMER, FONE_COMER,
          END_CEP, END_TIPO, END_LOGRAD, END_NUMERO, END_BAIRRO, END_COMPLE, ID_CIDADE,
          ID_PAIS, DT_CADASTRO${marcaAtualizacao ? ', UPDATED_INTEGRADORA' : ''}
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_DATE${marcaAtualizacao ? ', CURRENT_DATE' : ''})`, [
        id, ...valores, PAIS_BRASIL,
      ]);
    }
    await gravarFilhos(tx, id, body || {}, docPf, docPj);
    return { id };
  }));
}

module.exports = {
  montarFiltro,
  listar,
  opcoes,
  cidades,
  detalhe,
  salvar,
};
