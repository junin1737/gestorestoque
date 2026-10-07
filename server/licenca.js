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
/** Liberado: bloqueio/liberação feitos no painel chegam ao Gestor em até 2 minutos. */
const INTERVALO_MS = 2 * 60 * 1000;
const RETENTATIVA_MS = 5 * 60 * 1000;
/** Cadastro aguardando aprovação/bloqueado: consulta mais seguido para liberar logo após aprovar no painel. */
const AGUARDANDO_MS = 60 * 1000;
/** Sem base conectada ainda (primeira abertura): tenta de novo em pouco tempo. */
const SEM_BASE_MS = 30 * 1000;
const TIMEOUT_MS = 10000;
/** Tolerância para relógio do Windows voltado para trás antes de considerar burla. */
const FOLGA_RELOGIO_MS = 2 * 60 * 60 * 1000;
const CONTATO = 'MT Automações — (34) 3674-1937';
/** Nome da aplicação no painel de licenças (o mesmo painel atende outras aplicações). */
const APLICACAO = 'GestorEstoque';

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

/** Link /t/ do acesso online, quando esta edição tem túnel conectado. A edição local não tem. */
function urlAcessoAtual() {
  try {
    const link = require('./tunel').linkEstavel();
    return link || undefined;
  } catch {
    return undefined;
  }
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
  if (dados.app && dados.app !== APLICACAO) throw new Error(`Esta licença é da aplicação ${dados.app}, não do ${APLICACAO}.`);
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

/** Sem licença guardada e sem pedido feito: nada é enviado ao servidor de licenças até pedirem a liberação. */
function aguardandoPedido() {
  const st = carregarEstado();
  return !st.licenca && !st.solicitado;
}

function cnpjValido(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const dv = (n) => {
    let soma = 0;
    let peso = n - 7;
    for (let i = 0; i < n; i++) {
      soma += Number(d[i]) * peso;
      peso = peso === 2 ? 9 : peso - 1;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

/** Pedido de liberação feito ao abrir o painel (tela de serviço), com o CNPJ da revenda. */
async function solicitar(revendaCnpj) {
  const rev = String(revendaCnpj || '').replace(/\D/g, '');
  if (!cnpjValido(rev)) throw new Error('Informe um CNPJ de revenda válido.');
  const st = carregarEstado();
  st.solicitado = true;
  st.revenda_cnpj = rev;
  salvarEstado();
  return verificarAgora();
}

async function verificarAgora() {
  if (!ATIVO) return situacao();
  if (verificando) return verificando;
  if (aguardandoPedido()) {
    try { identidade = await lerIdentidade(); } catch { /* sem base ainda */ }
    return situacao();
  }
  verificando = (async () => {
    const st = carregarEstado();
    st.ultima_tentativa = new Date().toISOString();
    let semBase = false;
    try {
      try {
        identidade = await lerIdentidade();
      } catch (e) {
        semBase = true;
        throw e;
      }
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
            aplicacao: APLICACAO,
            maquina: os.hostname(),
            versao_gestor: versaoGestor(),
            revenda_cnpj: st.revenda_cnpj || undefined,
            url: urlAcessoAtual(),
          }),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(t);
      }
      const data = await res.json().catch(() => ({}));
      if (!data.ok || !data.licenca) {
        // Pedido recusado pelo servidor (ex.: revenda não cadastrada): volta a aguardar um novo pedido.
        if (res.status === 400 && !st.licenca) st.solicitado = false;
        throw new Error(data.error || `Servidor de licenças respondeu ${res.status}.`);
      }
      aplicarLicenca(data.licenca, { origem: 'online' });
      st.solicitado_em = data.solicitado_em || null;
      st.ultimo_contato = new Date().toISOString();
      st.ultimo_erro = null;
    } catch (err) {
      st.ultimo_erro = err.name === 'AbortError' ? 'Servidor de licenças não respondeu.' : err.message;
    } finally {
      st.ultimo_visto = Math.max(Number(st.ultimo_visto || 0), agoraCorrigido());
      salvarEstado();
      verificando = null;
      let proxima = INTERVALO_MS;
      if (semBase) proxima = SEM_BASE_MS;
      else if (st.ultimo_erro) proxima = RETENTATIVA_MS;
      else if (!situacao().liberado) proxima = AGUARDANDO_MS;
      if (!aguardandoPedido()) agendar(proxima);
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
    aplicacao: APLICACAO,
    maquina: os.hostname(),
    fantasia: identidade?.fantasia || identidade?.razao || null,
    cnpj: identidade?.cnpj || null,
    nse: identidade?.nse || null,
    ultimo_contato: st.ultimo_contato || null,
    ultima_tentativa: st.ultima_tentativa || null,
    ultimo_erro: st.ultimo_erro || null,
    revenda_cnpj: st.revenda_cnpj || null,
    contato: CONTATO,
  };
  let dados = null;
  try {
    dados = st.licenca ? abrirLicenca(st.licenca) : null;
  } catch {
    dados = null;
  }
  if (!dados && aguardandoPedido()) {
    return {
      ...base,
      liberado: false,
      status: 'nao_solicitado',
      mensagem: 'Este computador ainda não foi registrado. Clique em "Abrir painel" (ou no endereço do painel) na tela do Gestor Estoque, no computador servidor, para solicitar a liberação.',
    };
  }
  if (!dados) {
    const nunca = !st.ultima_tentativa || (verificando && !st.ultimo_contato);
    return {
      ...base,
      liberado: false,
      status: nunca ? 'verificando' : 'sem_licenca',
      mensagem: nunca
        ? 'Verificando licença…'
        : `Não foi possível registrar este computador no servidor de licenças${st.ultimo_erro ? ` (${st.ultimo_erro})` : ''}. Confira a internet do computador servidor e clique em Verificar agora, ou solicite o registro à ${CONTATO}.`,
    };
  }
  const out = {
    ...base,
    cnpj: base.cnpj || dados.cnpj,
    tipo: dados.tipo,
    pago_ate: dados.pago_ate || null,
    teste: !!dados.teste,
    valido_ate: dados.valido_ate,
    emitido_em: dados.emitido_em,
  };
  if (identidade?.cnpj && dados.cnpj !== identidade.cnpj) {
    return { ...out, liberado: false, status: 'outro_cnpj', mensagem: `A licença guardada é de outro CNPJ. Verificando a base atual… Se persistir, contate a ${CONTATO}.` };
  }
  if (dados.status === 'pendente') {
    return {
      ...out,
      liberado: false,
      status: 'pendente',
      solicitado_em: st.solicitado_em || null,
      mensagem: `Cadastro solicitado${st.solicitado_em ? ` em ${fmtData(st.solicitado_em)}` : ''}. Aguardando aprovação da ${CONTATO}. Assim que for aprovado, o sistema libera sozinho em até 1 minuto.`,
    };
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

/**
 * Hash PBKDF2 da senha do supervisor vindo da licença assinada (padrão do painel ou própria do cliente).
 * null = painel ainda sem senha definida (ou controle de licença desligado): vale a senha legada.
 */
function hashSupervisor() {
  if (!ATIVO) return null;
  try {
    const st = carregarEstado();
    const dados = st.licenca ? abrirLicenca(st.licenca) : null;
    const sup = dados?.sup;
    if (sup && sup.alg === 'pbkdf2-sha256' && sup.salt && sup.hash && Number(sup.iter) > 0) return sup;
  } catch { /* licença inválida: sem hash */ }
  return null;
}

/** Identifica a versão da senha do supervisor (invalida sessões quando o hash muda). */
function versaoSupervisor() {
  const sup = hashSupervisor();
  return sup ? crypto.createHash('sha256').update(`${sup.salt}:${sup.hash}`).digest('hex').slice(0, 16) : 'legado';
}

async function conferirSenhaSupervisor(senha, senhaLegada) {
  const sup = hashSupervisor();
  const informada = String(senha || '');
  if (!sup) {
    const a = Buffer.from(informada);
    const b = Buffer.from(String(senhaLegada || ''));
    return a.length === b.length && b.length > 0 && crypto.timingSafeEqual(a, b);
  }
  const esperado = Buffer.from(sup.hash, 'base64');
  const calc = await new Promise((resolve, reject) => {
    crypto.pbkdf2(informada, Buffer.from(sup.salt, 'base64'), Number(sup.iter), esperado.length, 'sha256',
      (err, out) => (err ? reject(err) : resolve(out)));
  });
  return calc.length === esperado.length && crypto.timingSafeEqual(calc, esperado);
}

/** Licença assinada ({payload, sig}) para apresentar ao servidor de acesso online; null se não liberada. */
function licencaAssinada() {
  if (!situacao().liberado) return null;
  const lic = carregarEstado().licenca;
  return lic && lic.payload && lic.sig ? { payload: lic.payload, sig: lic.sig } : null;
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
  /^\/online(\/|$)/,
  /^\/database\//,
  /^\/fiscal\//,
  /^\/dispositivos/,
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
  if (aguardandoPedido()) {
    setTimeout(() => { verificarAgora().catch(() => {}); }, 3000).unref?.();
    return;
  }
  agendar(3000);
}

module.exports = {
  LICENCA_URL,
  APLICACAO,
  lerIdentidade,
  iniciar,
  verificarAgora,
  solicitar,
  situacao,
  aplicarCodigoOffline,
  guardLicenca,
  licencaAssinada,
  hashSupervisor,
  versaoSupervisor,
  conferirSenhaSupervisor,
};
