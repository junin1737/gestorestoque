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
let dashUltimo = null;
let dashCartao = null;
let dashRedesenho = 0;

function dashPerfis() {
  const p = state.usuario?.permissoes || {};
  return PERFIS_DASH.filter((item) => {
    if (p[item.chave]?.acesso !== true) return false;
    if (item.perfil === 'MT_ENTRADAS' && !state.pacoteEntrada) return false;
    if (item.perfil === 'CONTADOR_ACESSA' && !state.contadorVinculado && !state.usuario?.contador) return false;
    return true;
  }).map((item) => item.perfil);
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
    osTecnico: valor('os-tecnico'),
    osStatus: valor('os-status'),
    osTipo: valor('os-tipo'),
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
  if (dashAba === 'servicos') {
    if (dashFiltros.osTecnico) params.set('tecnico', dashFiltros.osTecnico);
    if (dashFiltros.osStatus) params.set('status', dashFiltros.osStatus);
    if (dashFiltros.osTipo) params.set('tipoOs', dashFiltros.osTipo);
  }
  Object.entries(extra || {}).forEach(([k, v]) => { if (v) params.set(k, v); });
  return params;
}

/* ---------- Peças comuns (contador e entradas usam o visual antigo) ---------- */

function card(titulo, valor, detalhe, extra, tom) {
  const cls = tom === 'saida' || tom === 'entrada' ? ` fin-${tom}` : '';
  return `<article class="fin-card${cls}"><span>${esc(titulo)}</span><strong>${esc(valor)}</strong><small>${esc(detalhe || '')}</small>${extra ? `<small class="fin-extra">${esc(extra)}</small>` : ''}</article>`;
}

function pct(valor) {
  return `${Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
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
  const opc = (lista, atual) => (lista || []).map((o) => `<option value="${esc(o.id)}" ${String(o.id) === String(atual || '') ? 'selected' : ''}>${esc(o.nome || o.descricao)}</option>`).join('');
  const filtrosOs = `<label>Técnico<select data-filtro="os-tecnico"><option value="">Todos</option>${opc(dashUltimo?.tecnicos, p.osTecnico)}<option value="sem" ${p.osTecnico === 'sem' ? 'selected' : ''}>Sem técnico</option></select></label>
       <label>Status<select data-filtro="os-status"><option value="">Todos</option>${opc(dashUltimo?.statuses, p.osStatus)}</select></label>
       <label>Tipo<select data-filtro="os-tipo"><option value="">Todos</option>
         <option value="I" ${p.osTipo === 'I' ? 'selected' : ''}>Interna</option>
         <option value="E" ${p.osTipo === 'E' ? 'selected' : ''}>Externa</option>
       </select></label>`;
  const extra = perfil === 'PADRAO' && dashAba === 'servicos' ? filtrosOs : perfil === 'CONTADOR_ACESSA'
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

/* ---------- Dashboard padrão: Resumo, Vendas e Financeiro ---------- */

const ROTULO_ABA = { manage: 'Manage', resumo: 'Resumo', vendas: 'Vendas', servicos: 'Serviços', financeiro: 'Financeiro' };
/* Primeira cor é a do tema (logo); as demais são fixas e validadas para daltonismo. */
const CORES_SERIE = ['var(--d-acc)', '#eb6834', '#1baf7a', '#eda100', '#6250d6', '#e87ba4'];
const LINHAS_VISIVEIS = 8;

function num(valor, casas = 0) {
  return Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function pct1(valor) {
  return `${num(valor, 1)}%`;
}

function dataBr(iso) {
  return iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';
}

function milhar(valor) {
  const v = Number(valor) || 0;
  return Math.abs(v) >= 1000 ? `${num(v / 1000, 1)} mil` : num(v, 2);
}

function kpi(titulo, valor, detalhe, opc = {}) {
  return `<article class="dash-kpi${opc.destaque ? ' destaque' : ''}">
    <span>${esc(titulo)}</span>
    <strong class="${opc.tom || ''}">${esc(valor)}</strong>
    <small>${esc(detalhe || '')}</small>
  </article>`;
}

function caixa(titulo, sub, corpo, cls = '') {
  return `<section class="dash-box ${cls}">
    <header><h2>${esc(titulo)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</header>
    ${corpo}
  </section>`;
}

function barra(parte, maximo, tom = '') {
  const w = maximo > 0 ? Math.max(0, Math.min(100, (Number(parte) / maximo) * 100)) : 0;
  return `<span class="dash-barra"><i class="${tom}" style="width:${w.toFixed(1)}%"></i></span>`;
}

function verTodos(total) {
  return total > LINHAS_VISIVEIS
    ? `<button type="button" class="dash-ver" data-ver-todos data-qtd="${total}">Ver todos (${total})</button>`
    : '';
}

function quantidade(qtd, unidade) {
  const un = String(unidade || '').trim().toLowerCase();
  const casas = Number(qtd) % 1 ? (un === 'kg' ? 2 : 3) : 0;
  return `${num(qtd, casas)}${un ? ` ${un}` : ''}`;
}

function htmlAbas(dados) {
  const abas = dados?.abas || [];
  if (abas.length < 2) return '';
  return `<div class="dash-abas" role="tablist">${abas.map((aba) => `
    <button type="button" role="tab" aria-selected="${dados.aba === aba}" class="${dados.aba === aba ? 'ativa' : ''}" data-aba="${aba}">${esc(ROTULO_ABA[aba] || aba)}</button>`).join('')}</div>`;
}

/* ----- Resumo ----- */

function cardsResumo(d) {
  const base = [
    kpi('Vendido hoje', brl(d.vendidoDia), 'dia atual', { destaque: true }),
    kpi('Vendido no mês', brl(d.vendidoMes), 'mês atual', { destaque: true }),
  ];
  if (d.aba === 'manage') {
    base.push(kpi('Total Manage', brl(d.totalVendido), `${num(d.notasVenda)} notas`));
  } else if (d.usaGr) {
    base.push(
      kpi('Total vendido', brl(d.totalVendido), `${num(d.notasVenda)} notas no período`),
      kpi('Vendas fiscais', brl(d.vendasFiscais), 'NFC-e e NF-e'),
      kpi('Vendas GR', brl(d.vendasGerenciais), 'não convertidas'),
    );
  } else {
    base.push(
      kpi('Total vendido', brl(d.totalVendido), `${num(d.notasVenda)} notas no período`),
      kpi('Vendas fiscais', brl(d.vendasFiscais), 'modelos 55 e 65'),
      kpi('Vendas gerenciais', brl(d.vendasGerenciais), 'modelo GR'),
    );
  }
  if (d.servicosPeriodo) {
    const sv = d.servicosPeriodo;
    base.push(kpi('Serviços', brl(sv.valor), `${num(sv.vendas)} ${sv.vendas === 1 ? 'venda GR' : 'vendas GR'} com serviço`));
  }
  base.push(
    kpi('Total comprado', brl(d.totalComprado), `${num(d.notasEntrada)} notas de entrada`),
    kpi('Ticket médio', brl(d.ticketMedio), 'total vendido ÷ notas'),
  );
  return `<div class="dash-kpis">${base.join('')}</div>`;
}

function htmlGruposVenda(linhas) {
  const lista = linhas || [];
  const max = Math.max(0, ...lista.map((r) => Number(r.valor) || 0));
  const corpo = lista.map((r, i) => {
    const margem = Number(r.margem) || 0;
    return `<tr class="${i >= LINHAS_VISIVEIS ? 'dash-extra' : ''}">
      <td><div class="nome">${esc(r.grupo)}</div>${barra(r.valor, max)}</td>
      <td class="num">${brl(r.valor)}</td>
      <td class="num some-mobile">${num(r.quantidade, Number(r.quantidade) % 1 ? 2 : 0)}</td>
      <td class="num"><strong class="${margem < 0 ? 'neg' : 'pos'}">${brl(margem)}</strong><small>${pct1(r.margemPct)}</small></td>
    </tr>`;
  }).join('');
  if (!corpo) return '<p class="dash-vazio">Nenhuma venda no período</p>';
  return `<table class="dash-tabela"><thead><tr><th>Grupo</th><th class="num">Vendido</th><th class="num some-mobile">Qtd</th><th class="num">Margem</th></tr></thead><tbody>${corpo}</tbody></table>${verTodos(lista.length)}`;
}

function htmlGruposCompra(linhas) {
  const lista = linhas || [];
  const max = Math.max(0, ...lista.map((r) => Number(r.valor) || 0));
  const corpo = lista.map((r, i) => `<tr class="${i >= LINHAS_VISIVEIS ? 'dash-extra' : ''}">
      <td><div class="nome">${esc(r.grupo)}</div>${barra(r.valor, max, 'neutro')}</td>
      <td class="num">${brl(r.valor)}</td>
      <td class="num some-mobile">${num(r.notas)}</td>
      <td class="num">${pct(r.participacao)}</td>
    </tr>`).join('');
  if (!corpo) return '<p class="dash-vazio">Nenhuma compra no período</p>';
  return `<table class="dash-tabela"><thead><tr><th>Grupo</th><th class="num">Comprado</th><th class="num some-mobile">Notas</th><th class="num">% das compras</th></tr></thead><tbody>${corpo}</tbody></table>${verTodos(lista.length)}`;
}

function htmlPagamentos(linhas) {
  const lista = linhas || [];
  if (!lista.length) return '<p class="dash-vazio">Nenhuma movimentação no período</p>';
  return `<ul class="dash-rank">${lista.map((r) => `
    <li style="grid-template-columns:minmax(0,1fr) auto">
      <span class="n"><b>${esc(r.forma)}</b><small>${pct1(r.participacao)} do vendido</small>${barra(r.participacao, 100)}</span>
      <span class="v">${brl(r.valor)}</span>
    </li>`).join('')}</ul>`;
}

function htmlResumo(d) {
  return `${cardsResumo(d)}
  <div class="dash-grade">
    ${caixa('Vendas por grupo', 'Valor vendido e margem em R$ e %', htmlGruposVenda(d.porGrupoVenda))}
    ${caixa('Formas de pagamento', 'Participação no total vendido', htmlPagamentos(d.porPagamento))}
  </div>
  ${caixa('Compras por grupo', 'Notas de entrada no período', htmlGruposCompra(d.porGrupoCompra))}`;
}

/* ----- Vendas ----- */

function htmlRankVendedores(lista) {
  if (!lista.length) return '<p class="dash-vazio">Nenhuma venda no período</p>';
  const max = Number(lista[0].valor) || 0;
  return `<ul class="dash-rank">${lista.map((v, i) => `
    <li class="${i >= LINHAS_VISIVEIS ? 'dash-extra' : ''}">
      <span class="pos-rank">${i + 1}º</span>
      <span class="n"><b title="${esc(v.nome)}">${esc(v.nome)}</b><small>${num(v.notas)} ${v.notas === 1 ? 'nota' : 'notas'} · ticket ${brl(v.ticket)}</small>${barra(v.valor, max)}</span>
      <span class="v">${brl(v.valor)}<small>${pct1(v.participacao)}</small></span>
    </li>`).join('')}</ul>${verTodos(lista.length)}`;
}

function htmlRankProdutos(lista, campo) {
  if (!lista.length) return '<p class="dash-vazio">Nenhuma venda no período</p>';
  const max = Math.max(0, ...lista.map((p) => Number(p[campo]) || 0));
  const lucro = campo === 'lucro';
  return `<ul class="dash-rank">${lista.map((p, i) => `
    <li>
      <span class="pos-rank">${i + 1}º</span>
      <span class="n"><b title="${esc(p.nome)}">${esc(p.nome)}</b><small>${lucro ? `vendido ${brl(p.valor)}` : quantidade(p.quantidade, p.unidade)}</small>${barra(p[campo], max, lucro ? 'pos' : '')}</span>
      <span class="v ${lucro ? (p.lucro < 0 ? 'neg' : 'pos') : ''}">${brl(p[campo])}</span>
    </li>`).join('')}</ul>`;
}

function htmlVendas(d) {
  const canc = d.cancelamentos || {};
  const inut = d.inutilizacoes || {};
  const lucro = Number(d.lucroBruto) || 0;
  return `<div class="dash-kpis">
    ${kpi('Valor vendido', brl(d.valorVendido), `fiscal + gerencial · ${num(d.notasVenda)} notas`, { destaque: true })}
    ${kpi('Custo das vendas', brl(d.custo), 'custo da nota ou do cadastro')}
    ${kpi('Lucro bruto', brl(lucro), `margem de ${pct1(d.margemPct)}`, { destaque: true, tom: lucro < 0 ? 'neg' : 'pos' })}
    ${kpi('Cancelamentos', brl(canc.valor), `${num(canc.notas)} ${canc.notas === 1 ? 'nota cancelada' : 'notas canceladas'}`)}
    ${kpi('Inutilizações', `${num(inut.notas)} ${inut.notas === 1 ? 'nota' : 'notas'}`, `${brl(inut.valor)} em itens`)}
  </div>
  <div class="dash-grade">
    ${caixa('Vendas por vendedor', 'Valor vendido no período', '<div class="dash-grafico" data-grafico="vendedores"></div>')}
    ${caixa('Ranking de vendedores', 'Valor, notas e ticket médio', htmlRankVendedores(d.vendedores || []))}
  </div>
  <div class="dash-grade meio">
    ${caixa('Produtos mais vendidos', 'Por valor vendido no período', htmlRankProdutos(d.maisVendidos || [], 'valor'))}
    ${caixa('Produtos que mais deram lucro', 'Lucro bruto em R$ (venda − custo)', htmlRankProdutos(d.maisLucro || [], 'lucro'))}
  </div>`;
}

/* ----- Serviços (O.S) ----- */

function htmlOsStatus(lista) {
  const itens = (lista || []).filter((s) => s.quantidade > 0 || !s.final);
  if (!itens.length) return '<p class="dash-vazio">Nenhuma O.S</p>';
  const max = Math.max(1, ...itens.map((s) => s.quantidade));
  return `<ul class="dash-rank">${itens.map((s) => `
    <li style="grid-template-columns:minmax(0,1fr) auto">
      <span class="n"><b><i class="dash-ponto" style="background:${esc(s.cor)}"></i>${esc(s.nome)}</b><small>${s.final ? 'finalizadas no período' : 'em aberto agora'}</small>
        <span class="dash-barra"><i style="width:${((s.quantidade / max) * 100).toFixed(1)}%;background:${esc(s.cor)}"></i></span></span>
      <span class="v">${num(s.quantidade)}</span>
    </li>`).join('')}</ul>`;
}

function htmlOsTecnicos(lista) {
  if (!lista.length) return '<p class="dash-vazio">Nenhuma venda com serviço no período</p>';
  const max = Math.max(0, ...lista.map((t) => Number(t.valor) || 0));
  return `<ul class="dash-rank">${lista.map((t, i) => `
    <li class="${i >= LINHAS_VISIVEIS ? 'dash-extra' : ''}">
      <span class="pos-rank">${i + 1}º</span>
      <span class="n"><b title="${esc(t.nome)}">${esc(t.nome)}</b><small>${num(t.vendas)} ${t.vendas === 1 ? 'venda' : 'vendas'} · serviços ${brl(t.servicos)}</small>${barra(t.valor, max)}</span>
      <span class="v">${brl(t.valor)}</span>
    </li>`).join('')}</ul>${verTodos(lista.length)}`;
}

function htmlServicos(d) {
  const total = (Number(d.faturamentoServicos) || 0) + (Number(d.faturamentoProdutos) || 0);
  return `<div class="dash-kpis">
    ${kpi('Faturamento de serviços', brl(d.faturamentoServicos), 'mão de obra nas vendas GR', { destaque: true })}
    ${kpi('Produtos nessas vendas', brl(d.faturamentoProdutos), `total ${brl(total)}`)}
    ${kpi('Vendas com serviço', num(d.vendas), `ticket médio ${brl(d.ticket)}`)}
    ${kpi('O.S em aberto', num(d.abertas), d.atrasadas ? `${num(d.atrasadas)} com previsão vencida` : 'nenhuma atrasada', { tom: d.atrasadas ? 'neg' : '' })}
    ${kpi('Finalizadas no período', num(d.finalizadas), 'pela data de entrega')}
  </div>
  <div class="dash-grade meio">
    ${caixa('O.S por status', 'Abertas agora e finalizadas no período', htmlOsStatus(d.porStatus))}
    ${caixa('Faturamento por técnico', 'Vendas GR que vieram de uma O.S', htmlOsTecnicos(d.porTecnico || []))}
  </div>
  <div class="dash-grade meio">
    ${caixa('Serviços mais vendidos', 'Por valor no período', htmlRankProdutos(d.maisServicos || [], 'valor'))}
    ${caixa('Produtos mais usados', 'Produtos das vendas com serviço', htmlRankProdutos(d.maisProdutos || [], 'valor'))}
  </div>
  <p class="dash-vazio">Valores das vendas modelo GR com pelo menos um serviço, inclusive as já convertidas em nota. Os filtros de técnico, status e tipo consideram só as vendas que vieram de uma O.S.</p>`;
}

/* ----- Financeiro ----- */

function nomePlano(p) {
  return [p.codigo, p.plano].filter(Boolean).join(' · ') || 'Sem plano de contas';
}

function htmlRosca(itens) {
  const lista = (itens || []).filter((i) => Number(i.valor) > 0);
  const total = lista.reduce((s, i) => s + Number(i.valor), 0);
  if (!total) return '';
  const visiveis = lista.slice(0, CORES_SERIE.length);
  const resto = lista.slice(CORES_SERIE.length).reduce((s, i) => s + Number(i.valor), 0);
  const fatias = visiveis.map((i, n) => ({ nome: i.nome, valor: Number(i.valor), cor: CORES_SERIE[n] }));
  if (resto > 0) fatias.push({ nome: 'Outros', valor: resto, cor: 'var(--d-neutro)' });
  let ang = -Math.PI / 2;
  const r = 1;
  const ri = 0.62;
  const ponto = (a, raio) => `${(Math.cos(a) * raio).toFixed(4)} ${(Math.sin(a) * raio).toFixed(4)}`;
  const paths = fatias.map((f) => {
    const frac = f.valor / total;
    if (frac >= 0.999) {
      return `<path style="fill:${f.cor}" fill-rule="evenodd" d="M 1 0 A 1 1 0 1 1 -1 0 A 1 1 0 1 1 1 0 Z M ${ri} 0 A ${ri} ${ri} 0 1 0 -${ri} 0 A ${ri} ${ri} 0 1 0 ${ri} 0 Z"><title>${esc(f.nome)}: ${brl(f.valor)}</title></path>`;
    }
    const fim = ang + frac * Math.PI * 2;
    const vao = Math.min(0.02, (fim - ang) / 4);
    const grande = frac > 0.5 ? 1 : 0;
    const d = `M ${ponto(ang, r)} A ${r} ${r} 0 ${grande} 1 ${ponto(fim - vao, r)} L ${ponto(fim - vao, ri)} A ${ri} ${ri} 0 ${grande} 0 ${ponto(ang, ri)} Z`;
    ang = fim;
    return `<path style="fill:${f.cor}" d="${d}"><title>${esc(f.nome)}: ${brl(f.valor)}</title></path>`;
  }).join('');
  return `<div class="dash-rosca">
    <svg viewBox="-1.05 -1.05 2.1 2.1" role="img" aria-label="Distribuição">${paths}
      <text x="0" y="0.08" text-anchor="middle" font-size="0.22" font-weight="700" style="fill:var(--text)">${esc(milhar(total))}</text></svg>
    <ul>${fatias.map((f) => `<li><i style="background:${f.cor}"></i><span>${esc(f.nome)}</span><b>${pct1((f.valor / total) * 100)}</b></li>`).join('')}</ul>
  </div>`;
}

function htmlLinhasLanc(linhas, rotulo) {
  return `<div class="dash-lanc">${(linhas || []).map((l) => `
    <div><span>${esc(rotulo(l))}</span><b>${brl(l.valor)}</b></div>`).join('')}</div>`;
}

function htmlPlanoDetalhe(p, linhas, rotulo, extra) {
  return `<details>
    <summary><span>${esc(nomePlano(p))}</span><b>${brl(p.valorVisivel ?? p.total)}</b></summary>
    ${htmlLinhasLanc(linhas, rotulo)}${extra || ''}
  </details>`;
}

const rotuloPago = (l) => `${dataBr(l.data)} · ${l.historico || 'sem histórico'}`;
const rotuloTitulo = (t) => `vence ${dataBr(t.vencimento)} · doc. ${t.documento || '—'}${t.historico ? ` · ${t.historico}` : ''}`;

function htmlRealizado(d) {
  const receitas = d.receitas || [];
  const saidas = d.saidas || [];
  const resultado = Number(d.resultado) || 0;
  const fora = (d.planosFora || []).length
    ? `<p class="dash-vazio">Despesas pagas não incluem ${esc(d.planosFora.join(', '))}: esse custo já está nas vendas.</p>`
    : '';
  const listaReceitas = receitas.length
    ? `<div class="dash-arvore">${receitas.map((p) => htmlPlanoDetalhe(p, p.linhas, rotuloPago)).join('')}</div>`
    : '<p class="dash-vazio">Nenhum recebimento no período</p>';
  const listaDespesas = saidas.length
    ? `<div class="dash-arvore">${saidas.map((g) => `<details>
        <summary><span>${esc(g.centro)}</span><b>${brl(g.total)}</b></summary>
        ${(g.planos || []).map((p) => htmlPlanoDetalhe(p, p.linhas, rotuloPago)).join('')}
      </details>`).join('')}</div>`
    : '<p class="dash-vazio">Nenhum pagamento no período</p>';
  return `<h3 class="dash-bloco">Realizado <small>recebido e pago no período</small></h3>
  <div class="dash-kpis">
    ${kpi('Receitas recebidas', brl(d.totalEntradas), 'pela data do recebimento', { destaque: true })}
    ${kpi('Despesas pagas', brl(d.totalSaidas), 'pela data do pagamento')}
    ${kpi('Resultado realizado', brl(resultado), 'receitas − despesas', { destaque: true, tom: resultado < 0 ? 'neg' : 'pos' })}
  </div>
  <div class="dash-grade meio">
    ${caixa('Receitas por plano de contas', 'Toque no plano para ver os lançamentos', `${htmlRosca(receitas.map((p) => ({ nome: nomePlano(p), valor: p.total })))}${listaReceitas}`)}
    ${caixa('Despesas por centro de custo', 'Centro de custo › plano de contas › lançamentos', `${htmlRosca(saidas.map((g) => ({ nome: g.centro, valor: g.total })))}${listaDespesas}${fora}`)}
  </div>`;
}

function valorComCartao(item, comCartao) {
  return comCartao ? Number(item.total) || 0 : (Number(item.total) || 0) - (Number(item.cartao) || 0);
}

function htmlPlanosAbertos(planos, comCartao) {
  return planos.map((p) => {
    const valor = valorComCartao(p, comCartao);
    if (valor <= 0.004) return '';
    const titulos = (p.titulos || []).filter((t) => comCartao || !t.cartao);
    const qtd = comCartao ? p.quantidade : p.quantidade - (p.quantidadeCartao || 0);
    const faltam = qtd - titulos.length;
    const extra = faltam > 0 ? `<p class="dash-vazio" style="margin-left:2rem">+ ${num(faltam)} títulos não listados</p>` : '';
    return htmlPlanoDetalhe({ ...p, valorVisivel: valor }, titulos, rotuloTitulo, extra);
  }).join('');
}

function htmlRealizar(d, comCartao) {
  const a = d.aRealizar;
  if (!a) return `<h3 class="dash-bloco">A realizar</h3><p class="dash-vazio">${esc(d.erroRealizar || 'Contas em aberto indisponíveis.')}</p>`;
  const receber = valorComCartao(a.receber, comCartao);
  const pagar = Number(a.pagar.total) || 0;
  const saldo = receber - pagar;
  const vr = a.vencidosReceber || {};
  const vp = a.vencidosPagar || {};
  const vencRec = valorComCartao(vr, comCartao);
  const qtdVencRec = comCartao ? vr.quantidade : (vr.quantidade || 0) - (vr.quantidadeCartao || 0);
  const subReceber = Number(a.receber.cartao) > 0
    ? (comCartao ? `inclui ${brl(a.receber.cartao)} de cartão` : `sem cartão · ${brl(a.receber.cartao)} fora`)
    : 'títulos em aberto';
  const listaReceber = htmlPlanosAbertos(a.receber.planos || [], comCartao);
  const cartaoFora = !comCartao && Number(a.receber.cartao) > 0
    ? `<div class="dash-linha-extra"><span>Cartão fora da soma (histórico contém “cartão”)</span><b>${brl(a.receber.cartao)}</b></div>`
    : '';
  const vencidoRecHtml = vencRec > 0
    ? `<div class="dash-linha-extra"><span>Vencidos antes do período · ${num(qtdVencRec)} títulos</span><b>${brl(vencRec)}</b></div>`
    : '';
  const listaPagar = (a.pagar.centros || []).map((g) => `<details>
      <summary><span>${esc(g.centro)}</span><b>${brl(g.total)}</b></summary>
      ${htmlPlanosAbertos(g.planos || [], true)}
    </details>`).join('');
  const vencidoPagHtml = Number(vp.total) > 0
    ? `<div class="dash-linha-extra"><span>Vencidos antes do período · ${num(vp.quantidade)} títulos</span><b>${brl(vp.total)}</b></div>`
    : '';
  return `<h3 class="dash-bloco">A realizar <small>títulos em aberto com vencimento no período</small></h3>
  <div class="dash-kpis">
    ${kpi('A receber', brl(receber), subReceber, { destaque: true })}
    ${kpi('A pagar', brl(pagar), 'contas a pagar em aberto')}
    ${kpi('Saldo previsto', brl(saldo), 'a receber − a pagar', { destaque: true, tom: saldo < 0 ? 'neg' : 'pos' })}
  </div>
  <div class="dash-grade meio">
    ${caixa('Contas a receber por plano de contas', 'Saldo em aberto por plano', `<div class="dash-arvore">${listaReceber || '<p class="dash-vazio">Nada a receber no período</p>'}</div>${cartaoFora}${vencidoRecHtml}`)}
    ${caixa('Contas a pagar por centro de custo', 'Centro de custo › plano de contas › títulos', `<div class="dash-arvore">${listaPagar || '<p class="dash-vazio">Nada a pagar no período</p>'}</div>${vencidoPagHtml}`)}
  </div>`;
}

function htmlFinanceiro(d) {
  if (dashCartao === null) dashCartao = d.considerarCartao !== false;
  const erro = d.erro ? `<p class="dash-aviso">${esc(d.erro)}</p>` : '';
  return `<div class="dash-topo">
    <label class="dash-switch"><input type="checkbox" data-cartao ${dashCartao ? 'checked' : ''} /><span class="trilho"></span>Considerar cartão no contas a receber</label>
  </div>
  ${erro}
  ${d.erro ? '' : htmlRealizado(d)}
  <div id="dash-realizar">${htmlRealizar(d, dashCartao)}</div>
  ${caixa(`Receitas x Despesas · ${d.ano || ''}`, 'Vendas e compras por mês · passe o mouse (ou toque) no mês para ver os valores', `<div class="dash-grafico dash-grafico-mensal" data-grafico="mensal"></div>
    <div class="dash-rodape-grafico">
      <div class="dash-legenda"><span><i style="background:var(--d-acc)"></i>Receitas (vendas)</span><span><i style="background:var(--d-neutro)"></i>Despesas (compras)</span></div>
      <button type="button" class="btn dash-btn-exportar" data-exportar-mensal>Exportar valores (PDF)</button>
    </div>`)}`;
}

function htmlPadrao(d) {
  if (d.vazio && d.aba !== 'financeiro') return `${htmlAbas(d)}<p class="dash-vazio">${esc(d.mensagem || 'Nenhuma movimentação no período')}</p>`;
  if (d.aba === 'financeiro') return `${htmlAbas(d)}${htmlFinanceiro(d)}`;
  if (d.aba === 'vendas') return `${htmlAbas(d)}${htmlVendas(d)}`;
  if (d.aba === 'servicos') return `${htmlAbas(d)}${htmlServicos(d)}`;
  return `${htmlAbas(d)}${htmlResumo(d)}`;
}

/* ----- Gráficos (desenhados na largura real, para o texto não encolher no celular) ----- */

function grafico3d(el, lista) {
  const largura = el.clientWidth;
  if (!largura) return;
  const mostrar = (lista || []).slice(0, LINHAS_VISIVEIS);
  if (!mostrar.length) {
    el.innerHTML = '<p class="dash-vazio">Nenhuma venda no período</p>';
    return;
  }
  const estreito = largura < 480;
  const dx = estreito ? 9 : 14;
  const dy = estreito ? 6 : 9;
  const esq = estreito ? 4 : 12;
  const W = Math.max(280, largura - dx);
  const H = estreito ? 300 : 400;
  const base = H - 50;
  const topo = 48;
  const fs = estreito ? 10.5 : 12.5;
  const max = Math.max(1, ...mostrar.map((v) => Number(v.valor) || 0));
  const passo = (W - esq * 2) / mostrar.length;
  const larg = Math.min(56, passo * 0.56);
  let g = '';
  for (let k = 0; k <= 4; k += 1) {
    const y = base - ((base - topo) * k) / 4;
    g += `<line x1="${esq}" x2="${W - esq}" y1="${y}" y2="${y}" style="stroke:var(--d-linha)" stroke-width="1"/>`;
  }
  g += `<polygon points="${esq},${base} ${W - esq},${base} ${W - esq + dx},${base - dy} ${esq + dx},${base - dy}" style="fill:var(--d-suave)"/>`;
  mostrar.forEach((v, i) => {
    const valor = Number(v.valor) || 0;
    const h = Math.max(3, ((base - topo) * valor) / max);
    const x = esq + passo * i + (passo - larg) / 2;
    const y = base - h;
    const primeiro = String(v.nome || '').trim().split(/\s+/)[0] || '—';
    const nome = primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase();
    g += `<g><title>${esc(v.nome)}: ${brl(valor)}</title>
      <polygon points="${x + larg},${y} ${x + larg + dx},${y - dy} ${x + larg + dx},${base - dy} ${x + larg},${base}" style="fill:var(--d-acc-esc)"/>
      <rect x="${x}" y="${y}" width="${larg}" height="${h}" rx="2" style="fill:var(--d-acc)"/>
      <polygon points="${x},${y} ${x + dx},${y - dy} ${x + larg + dx},${y - dy} ${x + larg},${y}" style="fill:var(--d-acc-cl)"/>
      <text x="${x + larg / 2 + dx / 2}" y="${y - dy - 6}" text-anchor="middle" font-size="${fs}" font-weight="700" style="fill:var(--text)">${esc(milhar(valor))}</text>
      <text x="${x + larg / 2}" y="${base + 20}" text-anchor="middle" font-size="${fs}" style="fill:var(--muted)">${esc(nome)}</text>
    </g>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W + dx} ${H}" role="img" aria-label="Vendas por vendedor">${g}</svg>`;
}

function graficoMensal(el, serie) {
  const largura = el.clientWidth;
  if (!largura) return;
  const meses = serie || [];
  const W = Math.max(280, largura);
  const H = W < 480 ? 220 : 260;
  const base = H - 36;
  const topo = 16;
  const esq = 58;
  const maior = Math.max(1, ...meses.map((m) => Math.max(Number(m.vendido) || 0, Number(m.comprado) || 0)));
  const passoEixo = 10 ** Math.floor(Math.log10(maior));
  const max = Math.ceil(maior / passoEixo) * passoEixo;
  const passo = (W - esq - 8) / Math.max(1, meses.length);
  const bw = Math.min(22, passo * 0.34);
  let g = '';
  for (let k = 0; k <= 4; k += 1) {
    const v = (max * k) / 4;
    const y = base - ((base - topo) * k) / 4;
    g += `<line x1="${esq}" x2="${W - 8}" y1="${y}" y2="${y}" style="stroke:var(--d-linha)"/>
      <text x="${esq - 8}" y="${y + 4}" text-anchor="end" font-size="11" style="fill:var(--muted)">${esc(v >= 1000 ? `${num(v / 1000)} mil` : num(v))}</text>`;
  }
  meses.forEach((m, i) => {
    const cx = esq + passo * i + passo / 2;
    const hr = ((base - topo) * (Number(m.vendido) || 0)) / max;
    const hd = ((base - topo) * (Number(m.comprado) || 0)) / max;
    g += `<g class="dash-mes" data-mes="${i}">
      <rect class="dash-mes-fundo" x="${esq + passo * i + 2}" y="${topo - 6}" width="${Math.max(0, passo - 4)}" height="${base - topo + 30}" rx="6"/>
      <rect x="${cx - bw - 1}" y="${base - hr}" width="${bw}" height="${hr}" rx="3" style="fill:var(--d-acc)"/>
      <rect x="${cx + 1}" y="${base - hd}" width="${bw}" height="${hd}" rx="3" style="fill:var(--d-neutro)"/>
      <text x="${cx}" y="${base + 18}" text-anchor="middle" font-size="11.5" style="fill:var(--muted)">${esc(m.nome)}</text>
    </g>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Receitas e despesas por mês">${g}</svg><div class="dash-dica" hidden></div>`;
  ligarDicaMensal(el, meses);
}

/* Dica do gráfico mensal: entrou, saiu e sobrou do mês sob o mouse (ou tocado no celular). */
function ligarDicaMensal(el, meses) {
  const dica = el.querySelector('.dash-dica');
  const svg = el.querySelector('svg');
  if (!dica || !svg) return;
  let atual = null;
  function esconder() {
    dica.hidden = true;
    atual?.classList.remove('ativo');
    atual = null;
  }
  function mostrar(grupo, ev) {
    const m = meses[Number(grupo.dataset.mes)];
    if (!m) return;
    if (atual !== grupo) {
      atual?.classList.remove('ativo');
      grupo.classList.add('ativo');
      atual = grupo;
      const ent = Number(m.vendido) || 0;
      const sai = Number(m.comprado) || 0;
      const sob = Math.round((ent - sai) * 100) / 100;
      dica.innerHTML = `<b>${esc(m.nome)}${dashUltimo?.ano ? ` · ${esc(dashUltimo.ano)}` : ''}</b>
        <span><i style="background:var(--d-acc)"></i>Entrou<strong>${esc(brl(ent))}</strong></span>
        <span><i style="background:var(--d-neutro)"></i>Saiu<strong>${esc(brl(sai))}</strong></span>
        <span class="dash-dica-sobra ${sob < 0 ? 'neg' : 'pos'}">Sobrou<strong>${esc(brl(sob))}</strong></span>`;
      dica.hidden = false;
    }
    const caixaEl = el.getBoundingClientRect();
    const r = grupo.querySelector('.dash-mes-fundo').getBoundingClientRect();
    const larg = dica.offsetWidth;
    let x = r.left - caixaEl.left + r.width / 2 - larg / 2;
    x = Math.max(0, Math.min(caixaEl.width - larg, x));
    const y = ev && ev.clientY ? ev.clientY - caixaEl.top - dica.offsetHeight - 14 : 4;
    dica.style.left = `${x}px`;
    dica.style.top = `${Math.max(0, y)}px`;
  }
  svg.addEventListener('mousemove', (ev) => {
    const grupo = ev.target.closest?.('.dash-mes');
    if (grupo) mostrar(grupo, ev);
    else esconder();
  });
  svg.addEventListener('mouseleave', esconder);
  svg.addEventListener('click', (ev) => {
    const grupo = ev.target.closest?.('.dash-mes');
    if (!grupo) return esconder();
    if (grupo === atual && ev.pointerType && ev.pointerType !== 'mouse') return esconder();
    return mostrar(grupo, ev);
  });
}

function desenharGraficos() {
  const d = dashUltimo;
  if (!d) return;
  document.querySelectorAll('#dash-financeiro [data-grafico]').forEach((el) => {
    if (el.dataset.grafico === 'vendedores') grafico3d(el, d.vendedores);
    if (el.dataset.grafico === 'mensal') graficoMensal(el, d.porMes);
  });
}

window.addEventListener('resize', () => {
  clearTimeout(dashRedesenho);
  dashRedesenho = setTimeout(() => {
    if (!document.querySelector('#dash-financeiro [data-grafico]')) return;
    desenharGraficos();
    const corpo = document.getElementById('dash-corpo');
    if (corpo && dashCacheChave) dashCacheHtml = corpo.innerHTML;
  }, 200);
});

/* ---------- Contador e entradas ---------- */

function htmlConteudo(dados) {
  if (!dados) return '<p class="hint">Carregando…</p>';
  if (dados.perfil === 'PADRAO') return htmlPadrao(dados);
  if (dados.perfil === 'MT_ENTRADAS') {
    return `<p class="hint">O dia e o mês dos cards seguem a data Até. A lista usa o período De–Até.</p>
    <div class="fin-cards">
      ${card('Entradas do dia', brl(dados.entradasDia), `${dados.referenciaDia || ''} · ${dados.notasDia || 0} notas`, '', 'entrada')}
      ${card('Entradas do mês', brl(dados.entradasMes), `${dados.referenciaMes || ''} · ${dados.notasMes || 0} notas`, '', 'entrada')}
    </div>
    <section id="secao-resumo" class="fin-box"><h2>Compras por grupo</h2>${tabelaGrupo(dados.porGrupo, 'do período')}</section>`;
  }
  if (dados.vazio) return '<p class="fin-vazio">Nenhuma movimentação no período</p>';
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
  dashUltimo = res;
  const conteudo = htmlFiltros(dashPerfil) + htmlConteudo(res);
  corpo.innerHTML = res.perfil === 'PADRAO' ? `<div class="dash">${conteudo}</div>` : conteudo;
  preencherGrupos(res);
  desenharGraficos();
  ligarFiltros();
  dashCacheChave = chave;
  dashCacheHtml = corpo.innerHTML;
  rolarSecao();
}

function guardarCache() {
  const corpo = document.getElementById('dash-corpo');
  if (corpo && dashCacheChave) dashCacheHtml = corpo.innerHTML;
}

function ligarFiltros() {
  const form = document.getElementById('fin-filtros');
  form?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    dashCacheChave = '';
    dashCacheHtml = '';
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
  document.querySelectorAll('#dash-financeiro [data-ver-todos]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const box = btn.closest('.dash-box');
      if (!box) return;
      const aberto = box.classList.toggle('aberto');
      btn.textContent = aberto ? 'Mostrar menos' : `Ver todos (${btn.dataset.qtd})`;
      guardarCache();
    });
  });
  document.querySelectorAll('#dash-financeiro [data-exportar-mensal]').forEach((btn) => {
    btn.addEventListener('click', () => exportarMensal(btn));
  });
  document.querySelectorAll('#dash-financeiro [data-cartao]').forEach((chk) => {
    chk.addEventListener('change', () => {
      dashCartao = chk.checked;
      chk.toggleAttribute('checked', dashCartao);
      const alvo = document.getElementById('dash-realizar');
      if (alvo && dashUltimo) alvo.innerHTML = htmlRealizar(dashUltimo, dashCartao);
      guardarCache();
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
  await salvarDash(blob, formato === 'pdf' ? 'contador.pdf' : 'contador.xls');
}

/** Navegador baixa; o APK manda para o compartilhar do Android. */
async function salvarDash(blob, nome) {
  if (window.ExportarTabela?.salvarArquivo) {
    if (!(await window.ExportarTabela.salvarArquivo(blob, nome))) showMsg('Atualize o aplicativo para salvar arquivos pelo celular.');
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportarMensal(btn) {
  const texto = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Gerando…';
  try {
    const params = queryDash();
    const res = await fetch(`/api/dashboard/receitas-despesas.pdf?${params.toString()}`, { credentials: 'same-origin' });
    if (!res.ok) {
      let msg = 'Falha ao exportar.';
      try { msg = (await res.json()).error || msg; } catch { /* arquivo */ }
      showMsg(msg);
      return;
    }
    const blob = await res.blob();
    await salvarDash(blob, `receitas-despesas-${dashUltimo?.ano || ''}.pdf`);
  } catch {
    showMsg('Falha ao exportar.');
  } finally {
    btn.disabled = false;
    btn.textContent = texto;
  }
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
