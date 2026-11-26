'use strict';

function num(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function xml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function celula(valor, tipo) {
  const t = tipo || (typeof valor === 'number' ? 'Number' : 'String');
  const texto = t === 'Number' ? String(Number(valor) || 0) : xml(valor);
  return `<Cell><Data ss:Type="${t}">${texto}</Data></Cell>`;
}

function linha(valores) {
  return `<Row>${valores.map((v) => (typeof v === 'number' ? celula(v, 'Number') : celula(v, 'String'))).join('')}</Row>`;
}

function planilha(nome, linhas, filtro) {
  const auto = filtro
    ? `<AutoFilter x:Range="R1C1:R${linhas.length}C${filtro}" xmlns="urn:schemas-microsoft-com:office:excel"/>`
    : '';
  return `<Worksheet ss:Name="${xml(nome)}"><Table>${linhas.join('')}</Table>${auto}</Worksheet>`;
}

function excelContador(dados, detalhe, meta) {
  const resumo = [
    linha(['Empresa', meta.empresa || '']),
    linha(['Usuário', meta.usuario || '']),
    linha(['Gerado em', meta.geradoEm || '']),
    linha(['Período', `${dados.periodo.inicio} a ${dados.periodo.fim}`]),
    linha(['NCM', meta.filtros?.ncm || 'Todos']),
    linha([]),
    linha(['Total comprado', Number(dados.totalComprado) || 0]),
    linha(['Total vendido', Number(dados.totalVendido) || 0]),
    linha(['Diferença', Number(dados.diferenca) || 0]),
    linha(['Notas de entrada', Number(dados.notasEntrada) || 0]),
    linha(['Notas de saída', Number(dados.notasSaida) || 0]),
    linha(['Itens comprados', Number(dados.itensComprados) || 0]),
    linha(['Itens vendidos', Number(dados.itensVendidos) || 0]),
  ];
  const ncm = [
    linha(['NCM', 'Total vendido']),
    ...(dados.porNcm || []).map((r) => linha([r.ncm, Number(r.totalVendido) || 0])),
    linha(['Total', Number(dados.totalVendido) || 0]),
  ];
  const det = [
    linha(['Natureza', 'Nota', 'Data', 'Item', 'NCM', 'Quantidade', 'Valor']),
    ...(detalhe || []).map((r) => linha([
      r.natureza, r.nota, r.data, r.item, r.ncm, Number(r.quantidade) || 0, Number(r.valor) || 0,
    ])),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${planilha('Resumo', resumo)}
${planilha('NCM', ncm, 2)}
${planilha('Detalhado', det, 7)}
</Workbook>`;
}

function escaparPdf(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, ' ');
}

function pdfBuffer(linhas) {
  const blocos = [];
  for (let i = 0; i < Math.max(linhas.length, 1); i += 46) {
    blocos.push(linhas.slice(i, i + 46));
  }
  if (!blocos.length) blocos.push(['Sem dados']);
  const partes = [];
  const xref = [0];
  let cursor = 0;
  function add(texto) {
    xref.push(cursor);
    const buf = Buffer.from(texto, 'latin1');
    partes.push(buf);
    cursor += buf.length;
  }
  const cabeca = '%PDF-1.4\n';
  partes.push(Buffer.from(cabeca, 'latin1'));
  cursor = cabeca.length;
  const kids = blocos.map((_, i) => `${5 + i * 2} 0 R`);
  add('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  add(`2 0 obj\n<< /Type /Pages /Count ${blocos.length} /Kids [${kids.join(' ')}] >>\nendobj\n`);
  add('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n');
  blocos.forEach((pagina, i) => {
    const comandos = ['BT', '/F1 11 Tf', '48 800 Td', '15 TL'];
    pagina.forEach((texto, n) => {
      const t = escaparPdf(texto).slice(0, 105);
      comandos.push(n === 0 ? `(${t}) Tj` : `T* (${t}) Tj`);
    });
    comandos.push('ET');
    const stream = comandos.join('\n');
    const conteudo = 4 + i * 2;
    const paginaId = conteudo + 1;
    add(`${conteudo} 0 obj\n<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream\nendobj\n`);
    add(`${paginaId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${conteudo} 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n`);
  });
  const inicioXref = cursor;
  let tabela = `xref\n0 ${xref.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < xref.length; i += 1) {
    tabela += `${String(xref[i]).padStart(10, '0')} 00000 n \n`;
  }
  tabela += `trailer\n<< /Size ${xref.length} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF`;
  partes.push(Buffer.from(tabela, 'latin1'));
  return Buffer.concat(partes);
}

function pdfContador(dados, meta) {
  const linhas = [
    meta.empresa || 'Empresa',
    'Dashboard do contador',
    `Usuario: ${meta.usuario || ''}`,
    `Gerado em: ${meta.geradoEm || ''}`,
    `Periodo: ${dados.periodo?.inicio || ''} a ${dados.periodo?.fim || ''}`,
    `Filtro NCM: ${meta.filtros?.ncm || 'Todos'}`,
    '',
    `Total comprado: ${num(dados.totalComprado)}`,
    `Total vendido: ${num(dados.totalVendido)}`,
    `Diferenca: ${num(dados.diferenca)}`,
    `Notas de entrada: ${dados.notasEntrada || 0}`,
    `Notas de saida: ${dados.notasSaida || 0}`,
    `Itens comprados: ${num(dados.itensComprados)}`,
    `Itens vendidos: ${num(dados.itensVendidos)}`,
    '',
    'NCM    Total vendido',
  ];
  for (const r of dados.porNcm || []) linhas.push(`${r.ncm}    ${num(r.totalVendido)}`);
  linhas.push('');
  linhas.push(`Total geral vendido: ${num(dados.totalVendido)}`);
  return pdfBuffer(linhas);
}

const MESES_LONGOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

/* Largura aproximada no Helvetica (unidades de 1/1000 do tamanho), para alinhar valores à direita. */
const LARG_HELV = { ' ': 278, ',': 278, '.': 278, '-': 333, R: 722, $: 556, '/': 278, ':': 278 };

function largura(texto, tam, negrito) {
  let soma = 0;
  for (const ch of String(texto)) soma += LARG_HELV[ch] ?? (negrito ? 600 : 556);
  return (soma * tam) / 1000;
}

function pdfPagina(comandos, fontes) {
  const partes = [];
  const xref = [0];
  let cursor = 0;
  function add(texto) {
    xref.push(cursor);
    const buf = Buffer.from(texto, 'latin1');
    partes.push(buf);
    cursor += buf.length;
  }
  const cabeca = '%PDF-1.4\n';
  partes.push(Buffer.from(cabeca, 'latin1'));
  cursor = cabeca.length;
  const stream = comandos.join('\n');
  add('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  add('2 0 obj\n<< /Type /Pages /Count 1 /Kids [5 0 R] >>\nendobj\n');
  add(`3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /${fontes[0]} /Encoding /WinAnsiEncoding >>\nendobj\n`);
  add(`4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /${fontes[1]} /Encoding /WinAnsiEncoding >>\nendobj\n`);
  add('5 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 6 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>\nendobj\n');
  add(`6 0 obj\n<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream\nendobj\n`);
  const inicioXref = cursor;
  let tabela = `xref\n0 ${xref.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < xref.length; i += 1) tabela += `${String(xref[i]).padStart(10, '0')} 00000 n \n`;
  tabela += `trailer\n<< /Size ${xref.length} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF`;
  partes.push(Buffer.from(tabela, 'latin1'));
  return Buffer.concat(partes);
}

/* Receitas x despesas por mês: entrou, saiu e sobrou, com o total do ano. */
function pdfReceitasDespesas(serie, meta) {
  const cmd = [];
  const cor = (rgb) => `${rgb.map((c) => (c / 255).toFixed(3)).join(' ')} rg`;
  const PRETO = [30, 30, 30];
  const CINZA = [110, 110, 110];
  const VERDE = [22, 120, 70];
  const VERMELHO = [190, 40, 40];
  function texto(x, y, t, tam = 10, negrito = false, rgb = PRETO, direita = false) {
    const s = escaparPdf(t);
    const px = direita ? x - largura(t, tam, negrito) : x;
    cmd.push(`BT ${cor(rgb)} /${negrito ? 'F2' : 'F1'} ${tam} Tf ${px.toFixed(2)} ${y.toFixed(2)} Td (${s}) Tj ET`);
  }
  function faixa(y, h, rgb) {
    cmd.push(`${cor(rgb)} 48 ${y.toFixed(2)} 499 ${h.toFixed(2)} re f`);
  }
  function linhaH(y, rgb = [210, 210, 210], esp = 0.6) {
    cmd.push(`${rgb.map((c) => (c / 255).toFixed(3)).join(' ')} RG ${esp} w 48 ${y.toFixed(2)} m 547 ${y.toFixed(2)} l S`);
  }
  const brl = (v) => `R$ ${num(v)}`;
  texto(48, 792, meta.empresa || 'Empresa', 16, true);
  texto(48, 772, `Receitas x Despesas - ${meta.ano || ''}`, 12, true, CINZA);
  texto(48, 756, `Gerado em ${meta.geradoEm || ''}${meta.usuario ? ` por ${meta.usuario}` : ''}`, 9, false, CINZA);
  const COL = { mes: 56, entrou: 300, saiu: 420, sobrou: 539 };
  let y = 722;
  faixa(y - 7, 22, [238, 241, 245]);
  texto(COL.mes, y, 'Mês', 10, true);
  texto(COL.entrou, y, 'Entrou', 10, true, PRETO, true);
  texto(COL.saiu, y, 'Saiu', 10, true, PRETO, true);
  texto(COL.sobrou, y, 'Sobrou', 10, true, PRETO, true);
  y -= 26;
  let tEnt = 0;
  let tSai = 0;
  for (const m of serie || []) {
    const ent = Number(m.vendido) || 0;
    const sai = Number(m.comprado) || 0;
    const sob = Math.round((ent - sai) * 100) / 100;
    tEnt += ent;
    tSai += sai;
    texto(COL.mes, y, MESES_LONGOS[(Number(m.mes) || 0) - 1] || m.nome || '', 10);
    texto(COL.entrou, y, brl(ent), 10, false, PRETO, true);
    texto(COL.saiu, y, brl(sai), 10, false, PRETO, true);
    texto(COL.sobrou, y, brl(sob), 10, true, sob < 0 ? VERMELHO : VERDE, true);
    linhaH(y - 8);
    y -= 24;
  }
  const tSob = Math.round((tEnt - tSai) * 100) / 100;
  y -= 4;
  linhaH(y + 14, [120, 120, 120], 1);
  texto(COL.mes, y, `Total ${meta.ano || ''}`, 11, true);
  texto(COL.entrou, y, brl(tEnt), 11, true, PRETO, true);
  texto(COL.saiu, y, brl(tSai), 11, true, PRETO, true);
  texto(COL.sobrou, y, brl(tSob), 11, true, tSob < 0 ? VERMELHO : VERDE, true);
  y -= 34;
  texto(48, y, 'Entrou: receitas (vendas). Saiu: despesas (compras). Sobrou: entrou menos saiu.', 8.5, false, CINZA);
  return pdfPagina(cmd, ['Helvetica', 'Helvetica-Bold']);
}

module.exports = { excelContador, pdfContador, pdfReceitasDespesas };
