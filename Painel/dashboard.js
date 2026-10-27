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

function linhaFrete() {
  return '';
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

const CORES_PIZZA = ['#1f9d55', '#2f6fed', '#e23d3d', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#4f46e5', '#ea580c', '#0f766e', '#9333ea'];

function itensPizza(lista, nomeDe) {
  return (lista || [])
    .map((item) => ({ nome: nomeDe(item), total: Number(item.total) || 0 }))
    .filter((item) => item.total !== 0);
}

function planosDaPizza(grupos) {
  const map = new Map();
  (grupos || []).forEach((g) => {
    (g.planos || []).forEach((p) => {
      const nome = [p.codigo, p.plano].filter(Boolean).join(' · ') || 'Sem plano de contas';
      map.set(nome, (map.get(nome) || 0) + (Number(p.total) || 0));
    });
  });
  return [...map.entries()]
    .map(([nome, total]) => ({ nome, total }))
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

function htmlPizza(id, itens) {
  const lista = itens || [];
  const total = lista.reduce((s, item) => s + Math.abs(item.total), 0);
  if (!total) return '<p class="fin-vazio">Sem valores para o gráfico</p>';
  let ang = -Math.PI / 2;
  const fatias = lista.map((item, i) => {
    const frac = Math.abs(item.total) / total;
    const fim = ang + frac * Math.PI * 2;
    const cor = CORES_PIZZA[i % CORES_PIZZA.length];
    let path = '';
    if (frac >= 0.999) {
      path = '<circle cx="0" cy="0" r="1"></circle>';
    } else {
      const x1 = Math.cos(ang).toFixed(4);
      const y1 = Math.sin(ang).toFixed(4);
      const x2 = Math.cos(fim).toFixed(4);
      const y2 = Math.sin(fim).toFixed(4);
      const grande = frac > 0.5 ? 1 : 0;
      path = `<path d="M 0 0 L ${x1} ${y1} A 1 1 0 ${grande} 1 ${x2} ${y2} Z"></path>`;
    }
    ang = fim;
    const pct = (frac * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return { path, cor, nome: item.nome, pct, total: item.total };
  });
  const desenhos = fatias.map((f) => f.path.replace('<path ', `<path fill="${f.cor}" `).replace('<circle ', `<circle fill="${f.cor}" `)).join('');
  const legenda = fatias.map((f) => `
    <li><i style="background:${f.cor}"></i><span>${esc(f.nome)}</span><strong>${brl(f.total)}</strong><em>${f.pct}%</em></li>`).join('');
  return `<figure class="dre-pizza" id="${id}">
    <svg viewBox="-1.05 -1.05 2.1 2.1" role="img" aria-label="Gráfico de pizza">${desenhos}</svg>
    <ul class="dre-legenda">${legenda}</ul>
  </figure>`;
}

function htmlLadoDre(prefixo, titulo, total, grupos, tom) {
  const cls = tom === 'saida' ? 'fin-valor-saida' : 'fin-valor-entrada';
  const centros = (grupos || []).map((g, i) => {
    const planos = (g.planos || []).map((p, j) => {
      const nome = [p.codigo, p.plano].filter(Boolean).join(' · ');
      const linhas = (p.linhas || []).map((l) => `
        <tr>
          <td>${esc(l.data ? l.data.split('-').reverse().join('/') : '')}</td>
          <td>${esc(l.historico || '')}</td>
          <td class="${cls}">${brl(l.valor)}</td>
        </tr>`).join('');
      const idPlano = `${prefixo}-p-${i}-${j}`;
      return `<div class="dre-plano">
        <div class="dre-nivel">
          <button type="button" class="dre-mais" data-dre-abre="${idPlano}" aria-expanded="false">+</button>
          <span>${esc(nome)}</span>
          <strong class="${cls}">${brl(p.total)}</strong>
        </div>
        <div id="${idPlano}" hidden>
          <table class="fin-table dre-linhas"><tbody>${linhas}</tbody></table>
        </div>
      </div>`;
    }).join('');
    const idCentro = `${prefixo}-c-${i}`;
    return `<article class="dre-centro">
      <div class="dre-nivel">
        <button type="button" class="dre-mais" data-dre-abre="${idCentro}" aria-expanded="false">+</button>
        <h3>${esc(g.centro)}</h3>
        <strong class="${cls}">${brl(g.total)}</strong>
      </div>
      <div id="${idCentro}" hidden>${planos}</div>
    </article>`;
  }).join('');
  const idLista = `${prefixo}-lista`;
  const idCentroPizza = `${prefixo}-pizza-centro`;
  const idPlanoPizza = `${prefixo}-pizza-plano`;
  return `<section class="fin-box dre-lado">
    <div class="dre-nivel dre-topo">
      <button type="button" class="dre-mais" data-dre-abre="${idLista}" aria-expanded="false">+</button>
      <h2>${esc(titulo)} <span class="${cls}">${brl(total)}</span></h2>
    </div>
    <div id="${idLista}" hidden>
      ${centros || '<p class="fin-vazio">Nenhuma movimentação no período</p>'}
    </div>
    ${htmlPizza(idCentroPizza, itensPizza(grupos, (g) => g.centro))}
    <div id="${idPlanoPizza}" hidden>${htmlPizza(`${idPlanoPizza}-g`, planosDaPizza(grupos))}</div>
    <button type="button" class="btn dre-troca" data-dre-pizza="${prefixo}" data-modo="centro">Mostrar por plano de contas</button>
  </section>`;
}

function htmlFinanceiro(dados) {
  if (dados.erro) return `${htmlAbas(dados)}<p class="fin-vazio">${esc(dados.erro)}</p>`;
  const resultado = Number(dados.resultado) || 0;
  return `${htmlAbas(dados)}
  <p class="hint">Valores pela data do pagamento. Mercadorias para Revenda entra nas entradas, porque é a receita. Nas saídas esse custo fica de fora, porque já está no CMV.</p>
  <div class="fin-cards">
    ${card('Entradas', brl(dados.totalEntradas), 'recebido no período', '', 'saida')}
    ${card('Saídas', brl(dados.totalSaidas), 'pago no período', '', 'entrada')}
    ${card('Entradas − saídas', brl(resultado), 'no período', '', resultado < 0 ? 'entrada' : 'saida')}
  </div>
  <div class="dre-split">
    ${htmlLadoDre('ent', 'Entradas', dados.totalEntradas, dados.entradas, 'saida')}
    ${htmlLadoDre('sai', 'Saídas', dados.totalSaidas, dados.saidas, 'entrada')}
  </div>`;
}

function htmlConteudo(dados) {
  if (!dados) return '<p class="hint">Carregando…</p>';
  if (dados.aba === 'fiscal') {
    return `${htmlAbas(dados)}
    <div class="fin-cards">
      ${card('Total vendido', brl(dados.totalVendido), `${dados.notasVenda || 0} notas`, linhaFrete(dados.comFrete), 'saida')}
      ${card('Total comprado', brl(dados.totalComprado), `${dados.notasEntrada || 0} notas`, '', 'entrada')}
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
  const diaMes = `${card('Vendido no dia', brl(dados.vendidoDia), 'hoje', '', 'saida')}
       ${card('Vendido no mês', brl(dados.vendidoMes), 'mês atual', '', 'saida')}`;
  const separados = dados.aba === 'manage'
    ? `${diaMes}
       ${card('Total Manage', brl(dados.totalVendido), `${dados.notasVenda || 0} notas`, '', 'saida')}`
    : dados.usaGr
      ? `${diaMes}
         ${card('Total vendido', brl(dados.totalVendido), `${dados.notasVenda || 0} notas no período`, '', 'saida')}
         ${card('Vendas GR', brl(dados.vendasGerenciais), 'não convertidas', '', 'saida')}
         ${card('Vendas fiscais', brl(dados.vendasFiscais), 'NFC-e e NF-e', '', 'saida')}`
      : `${diaMes}
         ${card('Total vendido', brl(dados.totalVendido), `${dados.notasVenda || 0} notas no período`, '', 'saida')}
         ${card('Vendas fiscais', brl(dados.vendasFiscais), 'modelos 55 e 65', '', 'saida')}
         ${card('Vendas gerenciais', brl(dados.vendasGerenciais), 'modelo GR', '', 'saida')}`;
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
  document.querySelectorAll('#dash-financeiro [data-dre-abre]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const alvo = document.getElementById(btn.dataset.dreAbre);
      if (!alvo) return;
      alvo.hidden = !alvo.hidden;
      const aberto = !alvo.hidden;
      btn.textContent = aberto ? '−' : '+';
      btn.setAttribute('aria-expanded', aberto ? 'true' : 'false');
    });
  });
  document.querySelectorAll('#dash-financeiro [data-dre-pizza]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const prefixo = btn.dataset.drePizza;
      const porPlano = btn.dataset.modo !== 'plano';
      const centro = document.getElementById(`${prefixo}-pizza-centro`);
      const plano = document.getElementById(`${prefixo}-pizza-plano`);
      if (centro) centro.hidden = porPlano;
      if (plano) plano.hidden = !porPlano;
      btn.dataset.modo = porPlano ? 'plano' : 'centro';
      btn.textContent = porPlano ? 'Mostrar por centro de custo' : 'Mostrar por plano de contas';
    });
  });
  document.querySelectorAll('#dash-financeiro [data-fin-painel]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const alvo = document.getElementById(btn.dataset.finPainel);
      if (!alvo) return;
      alvo.hidden = !alvo.hidden;
      const aberto = !alvo.hidden;
      btn.setAttribute('aria-expanded', aberto ? 'true' : 'false');
      btn.textContent = aberto ? btn.dataset.finOcultar : btn.dataset.finMostrar;
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
