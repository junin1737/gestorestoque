'use strict';

const { withDb, query } = require('./db');

function onlyDigits(v) {
  return String(v || '').replace(/\D/g, '');
}

/** Ramo "Transportes" do Clipp: só fornecedores ativos desse ramo aparecem como transportador. */
const RAMO_TRANSPORTES = 34;

function formatCnpj(digits) {
  const d = onlyDigits(digits);
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length !== 14) return digits || '';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

const docValido = (d) => d.length === 14 || d.length === 11;
const SQL_DOC = `REPLACE(REPLACE(REPLACE(REPLACE(F.CNPJ, '.', ''), '/', ''), '-', ''), ' ', '')`;

function formatCep(digits) {
  const d = onlyDigits(digits);
  if (d.length !== 8) return digits || '';
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

function parseFone(fone) {
  const d = onlyDigits(fone);
  if (d.length <= 8) return { ddd: '', fone: d };
  if (d.length === 9) return { ddd: '', fone: d };
  if (d.length === 10) return { ddd: d.slice(0, 2), fone: d.slice(2) };
  return { ddd: d.slice(0, 2), fone: d.slice(2) };
}

function mapRowToCadastro(row) {
  if (!row) return null;
  const cid = row.ID_CIDADE != null ? String(row.ID_CIDADE).trim() : '';
  return {
    id_fornec: Number(row.ID_FORNEC),
    nome: String(row.NOME || '').trim(),
    nome_fanta: String(row.NOME_FANTA || '').trim(),
    cnpj: String(row.CNPJ || '').trim(),
    insc_estad: String(row.INSC_ESTAD || '').trim(),
    insc_munic: String(row.INSC_MUNIC || '').trim(),
    end_cep: String(row.END_CEP || '').trim(),
    end_tipo: String(row.END_TIPO || '').trim(),
    end_lograd: String(row.END_LOGRAD || '').trim(),
    end_numero: String(row.END_NUMERO ?? '').trim(),
    end_comple: String(row.END_COMPLE || '').trim(),
    end_bairro: String(row.END_BAIRRO || '').trim(),
    id_cidade: cid || null,
    municipio: String(row.MUNICIPIO || '').trim(),
    uf: String(row.UF || '').trim(),
    ddd_comer: String(row.DDD_COMER || '').trim(),
    fone_comer: String(row.FONE_COMER || '').trim(),
    ddd_celul: String(row.DDD_CELUL || '').trim(),
    fone_celul: String(row.FONE_CELUL || '').trim(),
    ddd_fax: String(row.DDD_FAX || '').trim(),
    fone_fax: String(row.FONE_FAX || '').trim(),
    fone_0800: String(row.FONE_0800 || '').trim(),
    email_cont: String(row.EMAIL_CONT || '').trim(),
    email_nfe: String(row.EMAIL_NFE || '').trim(),
    site: String(row.SITE || '').trim(),
    observacao: (() => {
      const o = row.OBSERVACAO;
      if (o == null) return '';
      if (typeof o === 'string') return o.trim();
      if (typeof o === 'number') return String(o);
      return '';
    })(),
    produtor_rural: String(row.PRODUTOR_RURAL || 'N').trim().toUpperCase() === 'S',
    status: String(row.STATUS || 'A').trim(),
    id_ramo: row.ID_RAMO != null ? Number(row.ID_RAMO) : null,
  };
}

function mapEmitToCadastro(emit, ide) {
  const end = emit?.enderEmit || emit?.enderDest || {};
  const fone = parseFone(end.fone || emit?.fone);
  const nNF = ide?.nNF || '';
  const serie = ide?.serie || '';
  const obsBase = nNF
    ? `Cadastro incluído automaticamente, através de arquivo XML (NFe). Nota fiscal/Série: ${nNF}/${serie}`
    : 'Cadastro incluído automaticamente, através de arquivo XML (NFe).';
  return {
    id_fornec: null,
    nome: String(emit?.xNome || '').trim(),
    nome_fanta: String(emit?.xFant || emit?.xNome || '').trim(),
    cnpj: formatCnpj(emit?.CNPJ || emit?.CPF),
    insc_estad: String(emit?.IE || '').trim(),
    insc_munic: String(emit?.IM || '').trim(),
    end_cep: formatCep(end.CEP),
    end_tipo: String(end.xTipo || '').trim(),
    end_lograd: String(end.xLgr || '').trim(),
    end_numero: String(end.nro ?? '').trim(),
    end_comple: String(end.xCpl || '').trim(),
    end_bairro: String(end.xBairro || '').trim(),
    id_cidade: end.cMun ? String(end.cMun).trim() : null,
    municipio: String(end.xMun || '').trim(),
    uf: String(end.UF || '').trim(),
    ddd_comer: fone.ddd,
    fone_comer: fone.fone,
    ddd_celul: '',
    fone_celul: '',
    ddd_fax: '',
    fone_fax: '',
    fone_0800: '',
    email_cont: String(emit?.email || '').trim(),
    email_nfe: String(emit?.email || '').trim(),
    site: '',
    observacao: obsBase,
    produtor_rural: false,
    status: 'A',
  };
}

async function lookupCidade(db, { id_cidade, municipio, uf }) {
  if (id_cidade) {
    const byId = await query(db, `
      SELECT FIRST 1 ID_CIDADE, NOME, SIGLA_UF
      FROM TB_CIDADE_SIS WHERE ID_CIDADE = ?`, [String(id_cidade).trim()]);
    if (byId[0]) {
      return {
        id_cidade: String(byId[0].ID_CIDADE).trim(),
        municipio: String(byId[0].NOME || '').trim(),
        uf: String(byId[0].SIGLA_UF || '').trim(),
      };
    }
  }
  const mun = String(municipio || '').trim();
  const sigla = String(uf || '').trim();
  if (mun && sigla) {
    const byNome = await query(db, `
      SELECT FIRST 1 ID_CIDADE, NOME, SIGLA_UF
      FROM TB_CIDADE_SIS
      WHERE UPPER(TRIM(NOME)) = UPPER(?) AND UPPER(TRIM(SIGLA_UF)) = UPPER(?)`, [mun, sigla]);
    if (byNome[0]) {
      return {
        id_cidade: String(byNome[0].ID_CIDADE).trim(),
        municipio: String(byNome[0].NOME || '').trim(),
        uf: String(byNome[0].SIGLA_UF || '').trim(),
      };
    }
  }
  return { id_cidade: id_cidade || null, municipio: mun, uf: sigla };
}

/**
 * Fornecedor pelo CNPJ/CPF. O Clipp mantém um cadastro separado (ramo Transportes) quando a mesma
 * empresa também transporta: para fornecedor da nota, prefere o cadastro que não é de transporte.
 */
async function buscarPorCnpj(cnpj) {
  const digits = onlyDigits(cnpj);
  if (!docValido(digits)) return null;
  return withDb(async (db) => {
    const rows = await query(db, `
      SELECT FIRST 1 F.*, C.NOME AS MUNICIPIO, C.SIGLA_UF AS UF
      FROM TB_FORNECEDOR F
      LEFT JOIN TB_CIDADE_SIS C ON C.ID_CIDADE = F.ID_CIDADE
      WHERE ${SQL_DOC} = ?
      ORDER BY CASE WHEN F.ID_RAMO = ${RAMO_TRANSPORTES} THEN 1 ELSE 0 END,
               CASE WHEN F.STATUS = 'A' OR F.STATUS IS NULL THEN 0 ELSE 1 END,
               F.ID_FORNEC`, [digits]);
    return mapRowToCadastro(rows[0]);
  });
}

/** Transportador como o Clipp aceita na nota: fornecedor ativo do ramo Transportes. */
async function buscarTransportador(doc) {
  const digits = onlyDigits(doc);
  if (!docValido(digits)) return null;
  return withDb(async (db) => {
    const rows = await query(db, `
      SELECT FIRST 1 F.*, C.NOME AS MUNICIPIO, C.SIGLA_UF AS UF
      FROM TB_FORNECEDOR F
      LEFT JOIN TB_CIDADE_SIS C ON C.ID_CIDADE = F.ID_CIDADE
      WHERE ${SQL_DOC} = ? AND F.ID_RAMO = ${RAMO_TRANSPORTES} AND F.STATUS = 'A'
      ORDER BY F.ID_FORNEC`, [digits]);
    return mapRowToCadastro(rows[0]);
  });
}

async function buscarFornecedores(q) {
  const term = String(q || '').trim();
  if (!term) return [];
  const digits = onlyDigits(term);
  return withDb(async (db) => {
    const params = [];
    let where = `(F.STATUS = 'A' OR F.STATUS IS NULL)`;
    if (digits.length >= 8) {
      where += ` AND REPLACE(REPLACE(REPLACE(F.CNPJ, '.', ''), '/', ''), '-', '') CONTAINING ?`;
      params.push(digits);
    } else {
      where += ` AND (UPPER(F.NOME) CONTAINING UPPER(?) OR UPPER(F.NOME_FANTA) CONTAINING UPPER(?))`;
      params.push(term, term);
    }
    const rows = await query(db, `
      SELECT FIRST 20 F.ID_FORNEC, F.NOME, F.NOME_FANTA, F.CNPJ, F.INSC_ESTAD, F.END_CEP, F.STATUS,
             C.NOME AS MUNICIPIO, C.SIGLA_UF AS UF
      FROM TB_FORNECEDOR F
      LEFT JOIN TB_CIDADE_SIS C ON C.ID_CIDADE = F.ID_CIDADE
      WHERE ${where}
      ORDER BY F.NOME`, params);
    return rows.map((r) => mapRowToCadastro(r));
  });
}

async function getFornecedorById(id) {
  const idFornec = Number(id);
  if (!idFornec) return null;
  return withDb(async (db) => {
    const rows = await query(db, `
      SELECT F.*, C.NOME AS MUNICIPIO, C.SIGLA_UF AS UF
      FROM TB_FORNECEDOR F
      LEFT JOIN TB_CIDADE_SIS C ON C.ID_CIDADE = F.ID_CIDADE
      WHERE F.ID_FORNEC = ?`, [idFornec]);
    return mapRowToCadastro(rows[0]);
  });
}

async function resolverNaImportacao(xml) {
  const emit = xml?.emit || {};
  const ide = xml?.ide || {};
  const cnpj = onlyDigits(emit.CNPJ || emit.CPF);
  let cadastro = mapEmitToCadastro(emit, ide);
  let id_fornec = null;
  let origem = 'xml';

  if (docValido(cnpj)) {
    const found = await buscarPorCnpj(cnpj);
    if (found?.id_fornec) {
      id_fornec = found.id_fornec;
      cadastro = found;
      origem = 'cadastro';
    }
  }

  return withDb(async (db) => {
    const cidade = await lookupCidade(db, cadastro);
    cadastro = { ...cadastro, ...cidade };
    return {
      id_fornec,
      origem,
      cadastro,
      criar_novo: !id_fornec,
      xml_emit: emit,
    };
  });
}

/** `transportador: true` cadastra no ramo Transportes (o Clipp exige isso para aceitar na nota). */
async function cadastrarFornecedor(cadastro, meta = {}, { transportador = false } = {}) {
  const c = cadastro || {};
  const nome = String(c.nome || '').trim();
  if (!nome) throw new Error('Informe a razão social do fornecedor.');
  const cnpjDigits = onlyDigits(c.cnpj);
  if (!docValido(cnpjDigits)) throw new Error('CNPJ/CPF inválido para cadastro do fornecedor.');

  const existente = transportador ? await buscarTransportador(cnpjDigits) : await buscarPorCnpj(cnpjDigits);
  if (existente?.id_fornec) {
    return { id_fornec: existente.id_fornec, cadastro: existente, ja_existia: true };
  }

  return withDb(async (db) => {
    const cidade = await lookupCidade(db, c);
    const genRows = await query(db, 'SELECT GEN_ID(GEN_TB_FORNEC_ID, 1) AS ID FROM RDB$DATABASE');
    const idFornec = Number(genRows[0].ID);
    const obs = String(c.observacao || '').trim()
      || `Cadastro incluído automaticamente, através de arquivo XML (NFe). Nota fiscal/Série: ${meta.nNF || '—'}/${meta.serie || '—'}`;

    await query(db, `
      INSERT INTO TB_FORNECEDOR (
        ID_FORNEC, NOME, NOME_FANTA, CNPJ, INSC_ESTAD, INSC_MUNIC,
        END_CEP, END_TIPO, END_LOGRAD, END_BAIRRO, END_NUMERO, END_COMPLE,
        DDD_COMER, FONE_COMER, DDD_CELUL, FONE_CELUL, DDD_FAX, FONE_FAX, FONE_0800,
        EMAIL_CONT, EMAIL_NFE, SITE, STATUS, ID_CIDADE, ID_PAIS, OBSERVACAO, PRODUTOR_RURAL, ID_RAMO
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'A', ?, ?, ?, ?, ?)`, [
      idFornec,
      nome,
      String(c.nome_fanta || '').trim() || null,
      formatCnpj(cnpjDigits),
      String(c.insc_estad || '').trim() || null,
      String(c.insc_munic || '').trim() || null,
      formatCep(c.end_cep) || null,
      String(c.end_tipo || '').trim() || null,
      String(c.end_lograd || '').trim() || null,
      String(c.end_bairro || '').trim() || null,
      String(c.end_numero ?? '').trim() || null,
      String(c.end_comple || '').trim() || null,
      String(c.ddd_comer || '').trim() || null,
      String(c.fone_comer || '').trim() || null,
      String(c.ddd_celul || '').trim() || null,
      String(c.fone_celul || '').trim() || null,
      String(c.ddd_fax || '').trim() || null,
      String(c.fone_fax || '').trim() || null,
      String(c.fone_0800 || '').trim() || null,
      String(c.email_cont || '').trim() || null,
      String(c.email_nfe || '').trim() || null,
      String(c.site || '').trim() || null,
      cidade.id_cidade || null,
      '1058',
      obs,
      c.produtor_rural ? 'S' : 'N',
      transportador ? RAMO_TRANSPORTES : null,
    ]);

    const cad = await getFornecedorById(idFornec);
    return { id_fornec: idFornec, cadastro: cad, ja_existia: false };
  });
}

module.exports = {
  onlyDigits,
  formatCnpj,
  mapEmitToCadastro,
  mapRowToCadastro,
  RAMO_TRANSPORTES,
  buscarPorCnpj,
  buscarTransportador,
  buscarFornecedores,
  getFornecedorById,
  resolverNaImportacao,
  cadastrarFornecedor,
};
