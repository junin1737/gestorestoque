import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const ncm = process.argv[2] || '';
const crt = Number(process.argv[3] || 3);

const nucleos = [
  'C:/Program Files/ConsultaCClassTrib/app/dist/core/src/index.js',
  'C:/Work/Pessoal/Projetos/RT/dist/core/src/index.js',
];
const bases = [
  process.env.RTC_DB || '',
  'C:/ProgramData/ConsultaCClassTrib/data/calculadora-rtc.db',
].filter(Boolean);

function achar(lista) {
  return lista.find((p) => p && fs.existsSync(p)) || '';
}

const nucleo = achar(nucleos);
const arquivo = achar(bases);
if (!nucleo || !arquivo) {
  process.stdout.write(JSON.stringify({
    ok: false,
    error: 'A base oficial da Receita não está nesta máquina.',
  }));
  process.exit(0);
}

const { abrirBaseRtc, consultarCClassTrib, sugestaoAutomatica } = await import(pathToFileURL(nucleo).href);
if (ncm === '--info') {
  const aberta = abrirBaseRtc(arquivo);
  const info = aberta.info();
  aberta.fechar();
  process.stdout.write(JSON.stringify({ ok: true, base: info }));
  process.exit(0);
}
const base = abrirBaseRtc(arquivo);
try {
  const resultado = consultarCClassTrib(base, { ncm, crt: crt || null, data: new Date().toISOString().slice(0, 10) });
  process.stdout.write(JSON.stringify({ ok: true, ...resultado, sugestao: sugestaoAutomatica(resultado) }));
} catch (err) {
  process.stdout.write(JSON.stringify({ ok: false, error: err?.message || 'Falha ao consultar a base da Receita.' }));
} finally {
  base.fechar();
}
