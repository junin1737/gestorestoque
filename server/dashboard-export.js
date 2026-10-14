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

module.exports = { excelContador, pdfContador };
