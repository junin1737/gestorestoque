'use strict';

const PERFIS_DASH = [
  { chave: 'dashboard_entradas', perfil: 'MT_ENTRADAS', titulo: 'Dashboard de entradas' },
  { chave: 'dashboard_contador', perfil: 'CONTADOR_ACESSA', titulo: 'Dashboard do contador' },
  { chave: 'dashboard_padrao', perfil: 'PADRAO', titulo: 'Dashboard' },
];

let dashPerfil = '';
let dashSecao = 'resumo';
let dashGeracao = 0;
let dashCacheChave = '';
let dashCacheHtml = '';
let dashFiltros = {};
let dashAba = '';

function dashPerfis() {
  const p = state.usuario?.permissoes || {};
  return PERFIS_DASH.filter((item) => p[item.chave]?.acesso === true).map((item) => item.perfil);
}

function dashTitulo(perfil) {
  return PERFIS_DASH.find((item) => item.perfil === perfil)?.titulo || 'Dashboard';
}

function isoLocal(data) {
  const d = data || new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dia}`;
}

function periodoPadrao() {
  const hoje = new Date();
  return { inicio: isoLocal(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), fim: isoLocal(hoje) };
}

function periodoContador() {
  const hoje = new Date();
  const ini = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  const fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
  return { inicio: isoLocal(ini), fim: isoLocal(fim) };
}

function brl(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function mostrarMenuDash() {
  const tem = {
    PADRAO: dashPerfis().includes('PADRAO'),
    CONTADOR_ACESSA: dashPerfis().includes('CONTADOR_ACESSA'),
    MT_ENTRADAS: dashPerfis().includes('MT_ENTRADAS'),
  };
  const mapa = [
    ['nav-dash-padrao', tem.PADRAO],
    ['nav-dash-contador', tem.CONTADOR_ACESSA],
    ['nav-dash-ncm', tem.CONTADOR_ACESSA],
    ['nav-dash-entradas', tem.MT_ENTRADAS],
    ['nav-dash-padrao-mobile', tem.PADRAO],
    ['nav-dash-contador-mobile', tem.CONTADOR_ACESSA],
    ['nav-dash-entradas-mobile', tem.MT_ENTRADAS],
  ];
  mapa.forEach(([id, visivel]) => {
    const el = document.getElementById(id);
    if (el) el.hidden = !visivel;
  });
}

function mostrarAtalhos(mostrar) {
  const atalhos = document.getElementById('dash-atalhos');
  const painel = document.getElementById('dash-financeiro');
  if (atalhos) atalhos.hidden = !mostrar;
  if (painel) painel.hidden = mostrar;
}

function lerFiltros() {
  const box = document.getElementById('dash-financeiro');
  const tem = box?.querySelector('[data-filtro="inicio"]');
  if (!tem) {
    if (!dashFiltros.inicio) dashFiltros = dashPerfil === 'CONTADOR_ACESSA' ? periodoContador() : periodoPadrao();
    return;
  }
  const valor = (nome) => box.querySelector(`[data-filtro="${nome}"]`)?.value || '';
  dashFiltros = {
    inicio: valor('inicio'),
    fim: valor('fim'),
    grupoId: valor('grupo'),
    tipoItem: valor('tipo'),
    modelo: valor('modelo'),
    ncm: valor('ncm').trim(),
  };
}

function queryDash(extra) {
  lerFiltros();
  const params = new URLSearchParams();
  params.set('perfil', dashPerfil);
  ['inicio', 'fim', 'grupoId', 'tipoItem', 'modelo', 'ncm'].forEach((k) => {
    if (dashFiltros[k]) params.set(k, dashFiltros[k]);
  });
  if (dashAba) params.set('aba', dashAba);
  Object.entries(extra || {}).forEach(([k, v]) => { if (v) params.set(k, v); });
  return params;
}

function card(titulo, valor, detalhe, extra, tom) {
  const cls = tom === 'saida' || tom === 'entrada' ? ` fin-${tom}` : '';
  return `<article class="fin-card${cls}"><span>${esc(titulo)}</span><strong>${esc(valor)}</strong><small>${esc(detalhe || '')}</small>${extra ? `<small class="fin-extra">${esc(extra)}</small>` : ''}</article>`;
}

function linhaFrete(valor) {
  if (valor == null || valor === '') return '';
  return `valor + frete ${brl(valor)}`;
}

function htmlMeses(dados) {
  return `<section id="secao-resumo" class="fin-box"><h2>Entradas x saídas <span>${esc(dados.ano || '')}</span></h2>${barras(dados.porMes || [])}</section>`;
}

function pct(valor) {
  return `${Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function htmlRecortes(dados) {
  return `<section id="secao-grupo" class="fin-box"><h2>Vendas por grupo</h2>${tabelaGrupo(dados.porGrupoVenda, 'das vendas')}</section>
  ${htmlPagamento(dados)}
  <section id="secao-compras" class="fin-box"><h2>Compras por grupo</h2>${tabelaGrupo(dados.porGrupoCompra, 'das compras')}</section>`;
}

function htmlPagamento(dados) {
  const pags = (dados.porPagamento || []).map((r) => `
    <div class="fin-pag"><span>${esc(r.forma)}</span><strong>${brl(r.valor)}</strong><span class="fin-meter"><span style="width:${Math.min(100, r.participacao || 0)}%"></span></span></div>`).join('');
  return `<section id="secao-pagto" class="fin-box"><h2>Vendas por forma de pagamento</h2>${pags || '<p class="hint">Nenhuma movimentação no período</p>'}</section>`;
}

function barras(serie) {
  const lista = serie && serie.length ? serie : [];
  const max = Math.max(1, ...lista.map((d) => Math.max(d.vendido, d.comprado, 0)));
  const cols = lista.map((d) => {
    const altV = d.vendido > 0 ? Math.max(6, Math.round((d.vendido / max) * 100)) : 0;
    const altC = d.comprado > 0 ? Math.max(6, Math.round((d.comprado / max) * 100)) : 0;
    const nome = d.nome || '';
    return `<div class="fin-col" title="${esc(nome)} · recebido ${brl(d.vendido)} · pago ${brl(d.comprado)}"><span class="fin-bars"><span class="fin-bar pago" style="height:${altC}%"></span><span class="fin-bar rec" style="height:${altV}%"></span></span><em>${esc(nome)}</em></div>`;
  }).join('');
  return `<div class="fin-chart">${cols}</div>
    <p class="fin-legenda"><i class="rec"></i> Recebido <i class="pago"></i> Pago</p>`;
}

function tabelaGrupo(linhas, lado) {
  const vendas = lado === 'das vendas';
  const corpo = (linhas || []).map((r) => {
    const margem = Number(r.margem) || 0;
    const ultima = vendas
      ? `<strong class="fin-margem ${margem < 0 ? 'neg' : 'pos'}">${brl(r.margem)}</strong><span class="fin-margem-pct ${margem < 0 ? 'neg' : 'pos'}">${pct(r.margemPct)}</span>`
      : `<span class="fin-part">${esc(r.participacao)}%</span><span class="fin-meter"><span style="width:${Math.min(100, r.participacao || 0)}%"></span></span>`;
    return `<tr>
      <td>${esc(r.grupo)}</td>
      <td>${brl(r.valor)}</td>
      <td>${esc(r.quantidade)}</td>
      ${vendas ? '' : `<td>${esc(r.notas)}</td>`}
      <td>${ultima}</td>
    </tr>`;
  }).join('');
  return `<table class="fin-table"><thead><tr><th>Grupo</th><th>Valor</th><th>Qtd</th>${vendas ? '' : '<th>Notas</th>'}<th>${vendas ? 'Margem' : `% ${esc(lado)}`}</th></tr></thead><tbody>${corpo || `<tr><td colspan="${vendas ? 4 : 5}">Nenhuma movimentação no período</td></tr>`}</tbody></table>`;
}

function htmlFiltros(perfil) {
  const p = dashFiltros.inicio ? dashFiltros : (perfil === 'CONTADOR_ACESSA' ? periodoContador() : periodoPadrao());
  const extra = perfil === 'CONTADOR_ACESSA'
    ? `<label>NCM<input data-filtro="ncm" placeholder="Código" value="${esc(p.ncm || '')}" /></label>`
    : (perfil === 'PADRAO' && dashAba !== 'financeiro'
      ? `<label>Grupo<select data-filtro="grupo"><option value="">Todos</option></select></label>
       <label>Tipo<select data-filtro="tipo">
         <option value="">Todos</option>
         <option value="produto" ${p.tipoItem === 'produto' ? 'selected' : ''}>Produto</option>
         <option value="servico" ${p.tipoItem === 'servico' ? 'selected' : ''}>Serviço</option>
         <option value="outros" ${p.tipoItem === 'outros' ? 'selected' : ''}>Outros</option>
       </select></label>
       <label>Modelo<select data-filtro="modelo">
         <option value="">Todos</option>
         <option value="55" ${p.modelo === '55' ? 'selected' : ''}>55</option>
         <option value="65" ${p.modelo === '65' ? 'selected' : ''}>65</option>
         <option value="GR" ${p.modelo === 'GR' ? 'selected' : ''}>GR</option>
       </select></label>`
      : '');
  const exportar = perfil === 'CONTADOR_ACESSA'
    ? `<button type="button" class="btn" data-exportar="pdf">PDF</button><button type="button" class="btn" data-exportar="xlsx">Excel</button>`
    : '';
  return `<form class="fin-filtros" id="fin-filtros">
    <label>De<input type="date" data-filtro="inicio" value="${esc(p.inicio)}" /></label>
    <label>Até<input type="date" data-filtro="fim" value="${esc(p.fim)}" /></label>
    ${extra}
    <div class="fin-acoes">
      <button type="submit" class="btn">Atualizar</button>
      ${exportar}
    </div>
  </form>`;
}

function htmlAbas(dados) {
  const abas = dados?.abas || [];
  if (abas.length < 2) return '';
  const rotulo = {
    manage: 'Manage',
    vendas: 'Vendas',
    fiscal: 'NFe+NFCe',
    financeiro: 'Financeiro',
  };
  return `<div class="fin-abas" role="tablist">${abas.map((aba) => `
    <button type="button" class="tab ${dados.aba === aba ? 'active' : ''}" data-aba="${aba}">${rotulo[aba] || aba}</button>`).join('')}</div>`;
}

function tabelaContas(linhas, vazio) {
  const corpo = (linhas || []).map((r) => `
    <tr>
      <td>${esc(r.vencimento ? r.vencimento.split('-').reverse().join('/') : '')}</td>
      <td>${esc(r.documento)}</td>
      <td>${esc(r.historico)}</td>
      <td>${brl(r.valor)}</td>
      <td>${esc(r.situacao)}</td>
    </tr>`).join('');
  return `<table class="fin-table"><thead><tr><th>Vencimento</th><th>Documento</th><th>Histórico</th><th>Valor</th><th>Situação</th></tr></thead><tbody>${corpo || `<tr><td colspan="5">${esc(vazio)}</td></tr>`}</tbody></table>`;
}

function htmlFinanceiro(dados) {
  const aviso = `${dados.ignorarCartao ? '<p class="hint">Contas a receber com cartão no histórico estão fora desta aba.</p>' : ''}
  <p class="hint">O dia e o mês dos cards seguem a data Até. A lista usa o período De–Até.</p>`;
  const corte = (lista, total) => (total > (lista || []).length ? `<p class="hint">Mostrando ${(lista || []).length} de ${total}.</p>` : '');
  const receber = `${card('A receber no dia', brl(dados.receberDia), dados.referenciaDia || '', '', 'saida')}
    ${card('A receber no mês', brl(dados.receberMes), dados.referenciaMes || '', '', 'saida')}
    ${card('Recebidas no dia', brl(dados.recebidasDia), dados.referenciaDia || '', '', 'saida')}
    ${card('Recebidas no mês', brl(dados.recebidasMes), dados.referenciaMes || '', '', 'saida')}`;
  const pagar = `${card('A pagar no dia', brl(dados.pagarDia), dados.referenciaDia || '', '', 'entrada')}
    ${card('A pagar no mês', brl(dados.pagarMes), dados.referenciaMes || '', '', 'entrada')}
    ${card('Pagas no dia', brl(dados.pagasDia), dados.referenciaDia || '', '', 'entrada')}
    ${card('Pagas no mês', brl(dados.pagasMes), dados.referenciaMes || '', '', 'entrada')}`;
  return `${htmlAbas(dados)}
  ${aviso}
  <section class="fin-box"><h2>Contas a receber</h2>
    <div class="fin-cards">${receber}</div>
    ${tabelaContas(dados.contasReceber, 'Nenhuma conta a receber no período')}
    ${corte(dados.contasReceber, dados.contasReceberTotal)}
  </section>
  <section class="fin-box"><h2>Contas a pagar</h2>
    <div class="fin-cards">${pagar}</div>
    ${tabelaContas(dados.contasPagar, 'Nenhuma conta a pagar no período')}
    ${corte(dados.contasPagar, dados.contasPagarTotal)}
  </section>`;
}

function htmlConteudo(dados) {
  if (!dados) return '<p class="hint">Carregando…</p>';
  if (dados.aba === 'fiscal') {
    return `${htmlAbas(dados)}
    <div class="fin-cards">
      ${card('Total vendido', brl(dados.totalVendido), `${dados.notasVenda || 0} notas`, linhaFrete(dados.comFrete), 'saida')}
      ${card('Vendido no dia', brl(dados.vendidoDia), 'hoje', linhaFrete(dados.vendidoDiaComFrete), 'saida')}
      ${card('Vendido no mês', brl(dados.vendidoMes), 'mês atual', linhaFrete(dados.vendidoMesComFrete), 'saida')}
      ${card('NFC-e', brl(dados.vendasNfce), 'modelo 65', linhaFrete(dados.comFreteNfce), 'saida')}
      ${card('NF-e', brl(dados.vendasNfe), 'modelo 55', linhaFrete(dados.comFreteNfe), 'saida')}
    </div>
    ${htmlMeses(dados)}
    ${htmlRecortes(dados)}`;
  }
  if (dados.aba === 'financeiro') return htmlFinanceiro(dados);
  if (dados.perfil === 'MT_ENTRADAS') {
    return `<p class="hint">O dia e o mês dos cards seguem a data Até. A lista usa o período De–Até.</p>
    <div class="fin-cards">
      ${card('Entradas do dia', brl(dados.entradasDia), `${dados.referenciaDia || ''} · ${dados.notasDia || 0} notas`, '', 'entrada')}
      ${card('Entradas do mês', brl(dados.entradasMes), `${dados.referenciaMes || ''} · ${dados.notasMes || 0} notas`, '', 'entrada')}
    </div>
    <section id="secao-resumo" class="fin-box"><h2>Compras por grupo</h2>${tabelaGrupo(dados.porGrupo, 'do período')}</section>`;
  }
  if (dados.vazio) return `${htmlAbas(dados)}<p class="fin-vazio">Nenhuma movimentação no período</p>`;
  if (dados.perfil === 'CONTADOR_ACESSA') {
    const ncm = (dados.porNcm || []).map((r) => `<tr><td>${esc(r.ncm)}</td><td>${brl(r.totalVendido)}</td></tr>`).join('');
    const sinal = Number(dados.diferenca) < 0 ? 'entrada' : 'saida';
    return `<div class="fin-cards">
      ${card('Total comprado', brl(dados.totalComprado), `${dados.notasEntrada || 0} notas`, '', 'entrada')}
      ${card('Total vendido', brl(dados.totalVendido), `${dados.notasSaida || 0} notas`, '', 'saida')}
      ${card('Saída - Entrada', brl(dados.diferenca), '', '', sinal)}
    </div>
    <section id="secao-ncm" class="fin-box"><h2>Totalizador por NCM</h2>
      <table class="fin-table"><thead><tr><th>NCM</th><th>Total vendido</th></tr></thead><tbody>${ncm || '<tr><td colspan="2">Nenhuma movimentação no período</td></tr>'}</tbody></table>
    </section>`;
  }
  const separados = dados.aba === 'manage'
    ? `${card('Total Manage', brl(dados.totalVendido), `${dados.notasVenda || 0} notas`, linhaFrete(dados.comFrete), 'saida')}
       ${card('Vendido no dia', brl(dados.vendidoDia), 'hoje', linhaFrete(dados.vendidoDiaComFrete), 'saida')}
       ${card('Vendido no mês', brl(dados.vendidoMes), 'mês atual', linhaFrete(dados.vendidoMesComFrete), 'saida')}`
    : dados.usaGr
      ? `${card('Total vendido', brl(dados.totalVendido), `${dados.notasVenda || 0} notas`, linhaFrete(dados.comFrete), 'saida')}
         ${card('Vendas GR', brl(dados.vendasGerenciais), 'não convertidas', linhaFrete(dados.comFreteGerenciais), 'saida')}
         ${card('Vendas fiscais', brl(dados.vendasFiscais), 'fora da conversão', linhaFrete(dados.comFreteFiscais), 'saida')}`
      : `${card('Total vendido', brl(dados.totalVendido), `${dados.notasVenda || 0} notas`, linhaFrete(dados.comFrete), 'saida')}
         ${card('Vendas fiscais', brl(dados.vendasFiscais), 'modelos 55 e 65', linhaFrete(dados.comFreteFiscais), 'saida')}
         ${card('Vendas gerenciais', brl(dados.vendasGerenciais), 'modelo GR', linhaFrete(dados.comFreteGerenciais), 'saida')}`;
  return `${htmlAbas(dados)}
  <div class="fin-cards">
    ${separados}
    ${card('Total comprado', brl(dados.totalComprado), `${dados.notasEntrada || 0} notas`, '', 'entrada')}
    ${card('Ticket médio', brl(dados.ticketMedio), 'total vendido ÷ notas')}
  </div>
  ${htmlMeses(dados)}
  ${htmlRecortes(dados)}`;
}

function preencherGrupos(dados) {
  const sel = document.querySelector('#dash-financeiro [data-filtro="grupo"]');
  if (!sel) return;
  const atual = sel.value;
  const vistos = new Map();
  (dados.porGrupoVenda || []).concat(dados.porGrupoCompra || []).forEach((r) => {
    if (r.id) vistos.set(String(r.id), r.grupo);
  });
  sel.innerHTML = '<option value="">Todos</option>' + [...vistos.entries()]
    .map(([id, nome]) => `<option value="${esc(id)}">${esc(nome)}</option>`).join('');
  const grupo = dashFiltros.grupoId || atual;
  if (grupo) sel.value = grupo;
}

function rolarSecao() {
  const id = dashSecao === 'ncm' ? 'secao-ncm' : dashSecao === 'grupo' ? 'secao-grupo' : dashSecao === 'tipo' ? 'secao-tipo' : dashSecao === 'compras' ? 'secao-compras' : 'secao-resumo';
  const alvo = document.getElementById(id);
  if (alvo && dashSecao !== 'resumo') alvo.scrollIntoView({ block: 'start' });
}

async function carregarDash() {
  const corpo = document.getElementById('dash-corpo');
  if (!corpo) return;
  const params = queryDash();
  const chave = `${dashPerfil}?${params.toString()}`;
  if (chave === dashCacheChave && dashCacheHtml) {
    corpo.innerHTML = dashCacheHtml;
    ligarFiltros();
    rolarSecao();
    return;
  }
  const geracao = ++dashGeracao;
  corpo.innerHTML = '<p class="hint">Carregando…</p>';
  const res = await api(`/dashboard?${params.toString()}`);
  if (geracao !== dashGeracao) return;
  if (res.code === 'SEM_PERMISSAO' || res.status === 403 || /sem permissão/i.test(res.error || '')) {
    corpo.innerHTML = '<p class="fin-vazio">Sem permissão para este dashboard.</p>';
    return;
  }
  if (!res.ok) {
    corpo.innerHTML = `<p class="fin-vazio">${esc(res.error || 'Falha ao consultar.')}</p>`;
    return;
  }
  if (res.aba) dashAba = res.aba;
  corpo.innerHTML = htmlFiltros(dashPerfil) + htmlConteudo(res);
  preencherGrupos(res);
  ligarFiltros();
  dashCacheChave = chave;
  dashCacheHtml = corpo.innerHTML;
  rolarSecao();
}

function ligarFiltros() {
  const form = document.getElementById('fin-filtros');
  form?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    carregarDash();
  });
  document.querySelectorAll('#dash-financeiro [data-exportar]').forEach((btn) => {
    btn.addEventListener('click', () => exportarDash(btn.dataset.exportar));
  });
  document.querySelectorAll('#dash-financeiro [data-aba]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.aba === dashAba) return;
      dashAba = btn.dataset.aba;
      dashCacheChave = '';
      dashCacheHtml = '';
      carregarDash();
    });
  });
}

async function exportarDash(formato) {
  const params = queryDash({ formato });
  const res = await fetch(`/api/dashboard/exportar?${params.toString()}`, { credentials: 'same-origin' });
  if (!res.ok) {
    let msg = 'Falha ao exportar.';
    try { msg = (await res.json()).error || msg; } catch { /* arquivo */ }
    showMsg(msg);
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = formato === 'pdf' ? 'contador.pdf' : 'contador.xls';
  a.click();
  URL.revokeObjectURL(url);
}

function abrirDash(origem) {
  const lista = dashPerfis();
  if (!lista.length) return false;
  const anterior = dashPerfil;
  if (origem?.perfil && lista.includes(origem.perfil)) dashPerfil = origem.perfil;
  if (!lista.includes(dashPerfil)) dashPerfil = lista[0];
  if (origem?.secao) dashSecao = origem.secao;
  if (dashPerfil !== anterior) {
    dashFiltros = {};
    dashAba = '';
    dashCacheChave = '';
    dashCacheHtml = '';
  }
  const titulo = document.getElementById('page-title');
  const sub = document.getElementById('page-sub');
  if (titulo) titulo.textContent = dashTitulo(dashPerfil);
  if (sub) sub.textContent = lista.length > 1 ? 'Escolha o dashboard no seletor' : 'Movimento do período';
  mostrarAtalhos(false);
  const painel = document.getElementById('dash-financeiro');
  const corpo = painel?.querySelector('#dash-corpo');
  if (corpo && dashPerfil === anterior && anterior) {
    const sel = document.getElementById('fin-perfil');
    if (sel) sel.value = dashPerfil;
    const carregando = /Carregando/.test(corpo.textContent || '');
    if (carregando || dashCacheHtml) {
      if (dashCacheHtml) rolarSecao();
      return true;
    }
  }
  const seletor = lista.length > 1
    ? `<label class="fin-seletor">Dashboard<select id="fin-perfil">${lista.map((p) => `<option value="${p}" ${p === dashPerfil ? 'selected' : ''}>${esc(dashTitulo(p))}</option>`).join('')}</select></label>`
    : '';
  if (painel) painel.innerHTML = seletor + '<div id="dash-corpo"><p class="hint">Carregando…</p></div>';
  document.getElementById('fin-perfil')?.addEventListener('change', (ev) => {
    dashPerfil = ev.target.value;
    dashSecao = 'resumo';
    dashFiltros = {};
    dashAba = '';
    dashCacheChave = '';
    dashCacheHtml = '';
    const tituloEl = document.getElementById('page-title');
    if (tituloEl) tituloEl.textContent = dashTitulo(dashPerfil);
    carregarDash();
  });
  carregarDash();
  return true;
}

function limparCacheDash() {
  dashCacheChave = '';
  dashCacheHtml = '';
}

window.Dashboard = { mostrarMenuDash, mostrarAtalhos, abrirDash, dashPerfis, limparCacheDash };
