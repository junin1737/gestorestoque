'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getAppDataDir } = require('./config');

// Vazio = controle de licença desligado.
const URL_PADRAO = 'https://painel.smsjrdeveloper.com.br';
const LICENCA_URL = (process.env.GESTOR_LICENCA_URL || URL_PADRAO).replace(/\/+$/, '');
const ATIVO = !!LICENCA_URL;
const INTERVALO_MS = 30 * 60 * 1000;
const RETENTATIVA_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 10000;
/** Tolerância para relógio do Windows voltado para trás antes de considerar burla. */
const FOLGA_RELOGIO_MS = 2 * 60 * 60 * 1000;
const CONTATO = 'MT Automações — (34) 3674-1937';

// Par da LICENCA_PRIVATE_KEY do servidor de licenças (licenca-server/.keys).
const CHAVE_PUBLICA = crypto.createPublicKey(`-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAVzRoulQmBLiOEDO+6ohBDvRKXTPWppJNBfHRLROAlq8=
-----END PUBLIC KEY-----`);

let estado = null;
let identidade = null;
let timer = null;
let verificando = null;

function arquivoEstado() {
  return path.join(getAppDataDir(), 'licenca.json');
}

function carregarEstado() {
  if (estado) return estado;
  try {
    estado = JSON.parse(fs.readFileSync(arquivoEstado(), 'utf8'));
  } catch {
    estado = {};
  }
  return estado;
}

function salvarEstado() {
  const tmp = `${arquivoEstado()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(estado, null, 2), 'utf8');
  fs.renameSync(tmp, arquivoEstado());
}

function versaoGestor() {
  try {
    return require('../package.json').version;
  } catch {
    return '';
  }
}

/** Hora corrigida pela diferença medida contra o servidor na última consulta. */
function agoraCorrigido() {
  return Date.now() + Number(carregarEstado().offset_ms || 0);
}

/** Valida assinatura e formato; devolve o objeto da licença ou lança erro. */
function abrirLicenca(lic) {
  if (!lic || typeof lic.payload !== 'string' || typeof lic.sig !== 'string') throw new Error('Licença em formato inválido.');
  const ok = crypto.verify(null, Buffer.from(lic.payload, 'utf8'), CHAVE_PUBLICA, Buffer.from(lic.sig, 'base64'));
  if (!ok) throw new Error('Assinatura da licença inválida.');
  const dados = JSON.parse(lic.payload);
  if (dados.v !== 1 || !dados.cnpj || !dados.status || !dados.valido_ate || !dados.emitido_em) {
    throw new Error('Licença incompleta.');
  }
  return dados;
}

async function lerIdentidade() {
  const { withDb, query } = require('./db');
  return withDb(async (db, cfg) => {
    const emit = await query(db, 'SELECT FIRST 1 CNPJ, NOME, NOME_FANTA FROM TB_EMITENTE');
    const e = emit[0] || {};
    let nse = '';
    let versaoClipp = '';
    try {
      const sup = await query(db, 'SELECT FIRST 1 NSE_CLIPP, CLIPP FROM RDB$SUP');
      nse = String(sup[0]?.NSE_CLIPP || '').trim();
      versaoClipp = String(sup[0]?.CLIPP || '').trim();
    } catch {
      /* base sem RDB$SUP (ManagePro isolado): identifica só pelo CNPJ */
    }
    return {
      cnpj: String(e.CNPJ || '').replace(/\D/g, ''),
      razao: String(e.NOME || '').trim(),
      fantasia: String(e.NOME_FANTA || '').trim(),
      nse,
      versao_clipp: versaoClipp,
      sistema: cfg.sistema,
    };
  });
}

function aplicarLicenca(lic, { origem }) {
  const dados = abrirLicenca(lic);
  const id = identidade;
  if (id && id.cnpj && dados.cnpj !== id.cnpj) {
    throw new Error(`Esta licença é do CNPJ ${dados.cnpj}, e a base conectada é do CNPJ ${id.cnpj}.`);
  }
  if (id && dados.nse && id.nse && dados.nse !== id.nse) {
    throw new Error('Esta licença é de outra instalação do Clipp (NSE diferente).');
  }
  const st = carregarEstado();
  if (st.licenca) {
    try {
      const atual = abrirLicenca(st.licenca);
      if (origem === 'offline' && new Date(dados.emitido_em) < new Date(atual.emitido_em)) {
        throw new Error('Este código é mais antigo que a licença atual.');
      }
    } catch (e) {
      if (/mais antigo/.test(e.message)) throw e;
    }
  }
  st.licenca = lic;
  if (origem === 'online') {
    // Hora do servidor é a referência: corrige relógio adiantado/atrasado do Windows.
    st.offset_ms = new Date(dados.emitido_em).getTime() - Date.now();
    st.ultimo_visto = new Date(dados.emitido_em).getTime();
  } else {
    st.ultimo_visto = Math.max(Number(st.ultimo_visto || 0), agoraCorrigido());
  }
  salvarEstado();
  return dados;
}

async function verificarAgora() {
  if (!ATIVO) return situacao();
  if (verificando) return verificando;
  verificando = (async () => {
    const st = carregarEstado();
    st.ultima_tentativa = new Date().toISOString();
    try {
      identidade = await lerIdentidade();
      if (!identidade.cnpj) throw new Error('CNPJ do emitente (TB_EMITENTE) não encontrado na base.');
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      let res;
      try {
        res = await fetch(`${LICENCA_URL}/api/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...identidade,
            maquina: os.hostname(),
            versao_gestor: versaoGestor(),
          }),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(t);
      }
      const data = await res.json().catch(() => ({}));
      if (!data.ok || !data.licenca) throw new Error(data.error || `Servidor de licenças respondeu ${res.status}.`);
      aplicarLicenca(data.licenca, { origem: 'online' });
      st.ultimo_contato = new Date().toISOString();
      st.ultimo_erro = null;
    } catch (err) {
      st.ultimo_erro = err.name === 'AbortError' ? 'Servidor de licenças não respondeu.' : err.message;
    } finally {
      st.ultimo_visto = Math.max(Number(st.ultimo_visto || 0), agoraCorrigido());
      salvarEstado();
      verificando = null;
      agendar(st.ultimo_erro ? RETENTATIVA_MS : INTERVALO_MS);
    }
    return situacao();
  })();
  return verificando;
}

function agendar(ms) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { verificarAgora().catch(() => {}); }, ms);
  timer.unref?.();
}

function fmtData(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
}

/** Situação atual a partir da licença guardada (sem rede). */
function situacao() {
  if (!ATIVO) return { liberado: true, status: 'desativado', mensagem: null, contato: CONTATO };
  const st = carregarEstado();
  const base = {
    cnpj: identidade?.cnpj || null,
    nse: identidade?.nse || null,
    ultimo_contato: st.ultimo_contato || null,
    ultima_tentativa: st.ultima_tentativa || null,
    ultimo_erro: st.ultimo_erro || null,
    contato: CONTATO,
  };
  let dados = null;
  try {
    dados = st.licenca ? abrirLicenca(st.licenca) : null;
  } catch {
    dados = null;
  }
  if (!dados) {
    const nunca = !st.ultima_tentativa || (verificando && !st.ultimo_contato);
    return {
      ...base,
      liberado: false,
      status: nunca ? 'verificando' : 'sem_licenca',
      mensagem: nunca
        ? 'Verificando licença…'
        : `Não foi possível validar a licença${st.ultimo_erro ? ` (${st.ultimo_erro})` : ''}. Confira a internet do computador servidor ou contate a ${CONTATO}.`,
    };
  }
  const out = {
    ...base,
    cnpj: base.cnpj || dados.cnpj,
    tipo: dados.tipo,
    pago_ate: dados.pago_ate || null,
    valido_ate: dados.valido_ate,
    emitido_em: dados.emitido_em,
  };
  if (identidade?.cnpj && dados.cnpj !== identidade.cnpj) {
    return { ...out, liberado: false, status: 'outro_cnpj', mensagem: `A licença guardada é de outro CNPJ. Verificando a base atual… Se persistir, contate a ${CONTATO}.` };
  }
  if (dados.status !== 'liberado') {
    return { ...out, liberado: false, status: dados.status, mensagem: dados.mensagem || `Acesso bloqueado. Contate a ${CONTATO}.` };
  }
  const agora = agoraCorrigido();
  if (agora + FOLGA_RELOGIO_MS < Number(st.ultimo_visto || 0)) {
    return { ...out, liberado: false, status: 'relogio', mensagem: 'A data/hora deste computador está atrasada. Acerte o relógio do Windows e clique em Verificar novamente.' };
  }
  if (agora > new Date(dados.valido_ate).getTime()) {
    const venceuPagamento = dados.pago_ate
      && Math.abs(new Date(dados.valido_ate).getTime() - new Date(`${dados.pago_ate}T23:59:59-03:00`).getTime()) < 1000;
    const msg = venceuPagamento
      ? `Licença vencida em ${fmtData(dados.valido_ate)}. Contate a ${CONTATO}.`
      : `O computador servidor está sem contato com o servidor de licenças desde ${fmtData(st.ultimo_contato || dados.emitido_em)}. Confira a internet ou contate a ${CONTATO}.`;
    return { ...out, liberado: false, status: 'expirado', mensagem: msg };
  }
  return { ...out, liberado: true, status: 'liberado', mensagem: dados.mensagem || null };
}

/** Cola o código gerado no painel de licenças (cliente sem internet). */
async function aplicarCodigoOffline(codigo) {
  const raw = String(codigo || '').trim().replace(/\s+/g, '');
  if (!raw.startsWith('MTL1.')) throw new Error('Código de licença inválido.');
  let lic;
  try {
    lic = JSON.parse(Buffer.from(raw.slice(5), 'base64url').toString('utf8'));
  } catch {
    throw new Error('Código de licença inválido.');
  }
  identidade = await lerIdentidade();
  aplicarLicenca(lic, { origem: 'offline' });
  return situacao();
}

/** Rotas liberadas mesmo com licença bloqueada (tela de login/bloqueio e tela de serviço). */
const ROTAS_LIVRES = [
  /^\/licenca(\/|$)/,
  /^\/health$/,
  /^\/network$/,
  /^\/qrcode$/,
  /^\/shutdown$/,
  /^\/config$/,
  /^\/tema$/,
  /^\/emitente$/,
  /^\/connect$/,
  /^\/database\//,
  /^\/fiscal\//,
];

function guardLicenca(req, res, next) {
  if (ROTAS_LIVRES.some((re) => re.test(req.path))) return next();
  const sit = situacao();
  if (sit.liberado) return next();
  res.status(423).json({ ok: false, code: 'LICENCA_BLOQUEADA', error: sit.mensagem, licenca: sit });
}

function iniciar() {
  if (!ATIVO) return;
  carregarEstado();
  agendar(3000);
}

module.exports = {
  LICENCA_URL,
  iniciar,
  verificarAgora,
  situacao,
  aplicarCodigoOffline,
  guardLicenca,
};
