/**
 * Ordem de Serviço — quadro kanban, tela da O.S, mensagens padrão, base de soluções, status e técnicos.
 * Fala só com /api/os (server/os-http.js). As regras e os cálculos valem no servidor; aqui o cálculo
 * é repetido só para mostrar os totais enquanto o usuário digita.
 */
const Servicos = (() => {
  let deps = {};
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const api = (...a) => (deps.api ? deps.api(...a) : Promise.resolve({ ok: false, error: 'Painel ainda não iniciou.' }));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const qtdTxt = (n) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
  const msg = (t) => (deps.showMsg ? deps.showMsg(t) : window.alert(t));
  const usuario = () => deps.getUsuario?.() || null;

  function numTela(v) {
    if (typeof v === 'number') return v;
    const s = String(v ?? '').trim().replace(/[R$\s%]/g, '');
    if (!s) return 0;
    const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
    return Number.isFinite(n) ? n : 0;
  }
  const moedaCampo = (n) => (Number(n) ? Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
  function dataBr(iso) {
    const s = String(iso || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
  }
  const diaMes = (iso) => dataBr(iso).slice(0, 5);
  function fmtFone(v) {
    const d = String(v || '').replace(/\D/g, '');
    if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    return d;
  }

  /* ---------- Ícones (traço único, lista fechada) ---------- */
  const ICONES = {
    pasta: '<path d="M3 18V6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1"/><path d="M3 18l2.4-7a2 2 0 0 1 1.9-1.4H22l-2.6 8.1A2 2 0 0 1 17.5 19H4a1 1 0 0 1-1-1z"/>',
    carro: '<path d="M3 16v-3l2-5a2 2 0 0 1 1.9-1.3h10.2A2 2 0 0 1 19 8l2 5v3z"/><path d="M5 16v2.5h3V16M16 16v2.5h3V16M7 12.5h.01M17 12.5h.01M5.5 11h13"/>',
    pergunta: '<circle cx="12" cy="12" r="9.5"/><path d="M9.2 9.2a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.6-2.8 2.6M12 16.8h.01"/>',
    caixa: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8M7.5 5.5l9 5"/>',
    chave: '<path d="M14.7 6.3a4 4 0 0 0-5.3 5.3L3.5 17.5a1.4 1.4 0 0 0 0 2l1 1a1.4 1.4 0 0 0 2 0l5.9-5.9a4 4 0 0 0 5.3-5.3l-2.5 2.5-2.3-.5-.5-2.3z"/>',
    caminhao: '<path d="M2 6h12v10H2zM14 9.5h4l3.5 3.5v3H14"/><circle cx="6" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/>',
    check: '<circle cx="12" cy="12" r="9.5"/><path d="M8 12.3l2.8 2.8L16.2 9"/>',
    relogio: '<circle cx="12" cy="12" r="9.5"/><path d="M12 7v5l3.2 2"/>',
    cadeado: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
    whats: '<path d="M20.5 11.6a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.3-4.5a8.5 8.5 0 1 1 15.7-4.4z"/><path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.6-2-1-1 .8c-1-.5-1.9-1.4-2.4-2.4l.8-1-1-2z"/>',
    monitor: '<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8.5 21h7M12 17v4"/>',
    tag: '<path d="M20.5 12.5l-8 8a1.5 1.5 0 0 1-2.1 0L3 13V3h10l7.5 7.4a1.5 1.5 0 0 1 0 2.1z"/><path d="M7.5 7.5h.01"/>',
    pessoa: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    ferramenta: '<path d="M4 20l6-6M14.5 3.5l6 6-3 3-6-6zM9.5 14.5l-3 3"/>',
    alerta: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17h.01"/>',
    estrela: '<path d="M12 3.5l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6L3.4 9.8l6-.7z"/>',
    lampada: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1.1 1.3 1.1 2.2h5c0-.9.5-1.7 1.1-2.2A6 6 0 0 0 12 3z"/>',
    busca: '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5l-4.6-4.6"/>',
    mais: '<path d="M12 5v14M5 12h14"/>',
    impressora: '<path d="M6 9V3h12v6M6 17H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    cima: '<path d="M6 15l6-6 6 6"/>',
    baixo: '<path d="M6 9l6 6 6-6"/>',
    esq: '<path d="M15 6l-6 6 6 6"/>',
    pontos: '<path d="M5 12h.01M12 12h.01M19 12h.01"/>',
    lapis: '<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-4-4L4 16z"/>',
    lixo: '<path d="M4 7h16M9.5 7V4.5h5V7M6 7l1 13h10l1-13"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    copiar: '<rect x="8" y="8" width="13" height="13" rx="2.5"/><path d="M16 8V5.5A2.5 2.5 0 0 0 13.5 3h-8A2.5 2.5 0 0 0 3 5.5v8A2.5 2.5 0 0 0 5.5 16H8"/>',
    globo: '<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5c2.6 2.8 3.8 6 3.8 9.5s-1.2 6.7-3.8 9.5c-2.6-2.8-3.8-6-3.8-9.5S9.4 5.3 12 2.5z"/>',
    venda: '<path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/><circle cx="10" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/>',
    filtro: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    baixar: '<path d="M12 3v12M7 10l5 5 5-5M4 19h16"/>',
  };
  const ic = (n, cls = '') => `<svg class="oi ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONES[n] || ICONES.pasta}</svg>`;

  /* ---------- Estado ---------- */
  const st = {
    view: 'quadro',
    dados: null, // resposta de /os (statuses, tecnicos, os)
    filtros: { q: '', tecnico: '', tipo: '', modalidade: '', status: '' },
    maisFiltros: false,
    os: null, // O.S aberta na tela
    aba: 'P',
    itemSel: -1,
    liberacoes: [],
    limites: { item: 0, geral: 0 },
    tecnicos: [],
    statuses: [],
    sujo: false,
    gravando: false,
    podeTecnicos: false,
  };
  let raiz = null;

  function raizEl() {
    raiz = raiz || $('#os-raiz');
    return raiz;
  }

  /* ---------- Janelas ---------- */
  function janela(html, { classe = '', aoAbrir } = {}) {
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      dlg.className = `os-dlg ${classe}`;
      dlg.innerHTML = html;
      document.body.appendChild(dlg);
      let valor;
      const fechar = (v) => { valor = v; if (dlg.open) dlg.close(); };
      dlg.addEventListener('close', () => { dlg.remove(); resolve(valor); });
      dlg.addEventListener('click', (e) => {
        const b = e.target.closest('[data-fechar]');
        if (b) fechar(b.dataset.fechar === '' ? undefined : b.dataset.fechar);
      });
      dlg.showModal();
      aoAbrir?.(dlg, fechar);
    });
  }

  function confirmar(titulo, texto, { sim = 'Sim', nao = 'Não', icone = 'pergunta' } = {}) {
    return janela(`<div class="corpo"><div class="circ">${ic(icone, 'g')}</div><h2>${esc(titulo)}</h2><p>${esc(texto)}</p></div>
      <footer><button type="button" data-fechar="nao">${esc(nao)}</button><button type="button" data-fechar="sim">${esc(sim)}</button></footer>`,
    { classe: 'alerta' }).then((v) => v === 'sim');
  }

  function avisar(avisos) {
    const lista = (avisos || []).filter(Boolean);
    if (lista.length) msg(lista.join(' '));
  }

  async function imprimir(id, formato, modelo) {
    if (await imprimirNoApp(id, formato, modelo)) return;
    const url = `/api/os/${encodeURIComponent(id)}/impressao?formato=${encodeURIComponent(formato)}&modelo=${encodeURIComponent(modelo)}`;
    const dlg = $('#dlg-danfe');
    const frame = $('#dlg-danfe-frame');
    const barra = dlg?.querySelector('.dlg-danfe-bar strong');
    if (dlg && frame && typeof dlg.showModal === 'function') {
      if (barra) barra.textContent = `O.S ${id}`;
      frame.removeAttribute('srcdoc');
      frame.src = url;
      if (!dlg.open) dlg.showModal();
      return;
    }
    window.open(url, '_blank', 'noopener');
  }

  /* ---------- Cálculo (mesmo do servidor) ---------- */
  const baseItem = (it) => r2(Number(it.qtd) * Number(it.vlr_unit) - Number(it.desc_item || 0) + Number(it.acres_item || 0));
  function ratear(itens, valor, campo) {
    const total = itens.reduce((s, it) => s + Math.max(0, baseItem(it)), 0);
    itens.forEach((it) => { it[campo] = 0; });
    const v = r2(valor);
    if (!(v > 0) || !(total > 0)) return;
    let soma = 0;
    for (const it of itens) { it[campo] = r2((v * Math.max(0, baseItem(it))) / total); soma = r2(soma + it[campo]); }
    const resto = r2(v - soma);
    if (resto) {
      const maior = itens.reduce((a, b) => (baseItem(b) > baseItem(a) ? b : a), itens[0]);
      maior[campo] = r2(maior[campo] + resto);
    }
  }
  function calcular(os) {
    const itens = os.itens;
    ratear(itens, os.desc_geral, 'rateio_desc');
    ratear(itens, os.acres_geral, 'rateio_acres');
    const t = { bp: 0, bs: 0, dp: 0, ds: 0, ap: 0, as: 0 };
    for (const it of itens) {
      const bruto = r2(it.qtd * it.vlr_unit);
      if (it.tipo === 'S') { t.bs = r2(t.bs + bruto); t.ds = r2(t.ds + Number(it.desc_item || 0)); t.as = r2(t.as + Number(it.acres_item || 0)); } else { t.bp = r2(t.bp + bruto); t.dp = r2(t.dp + Number(it.desc_item || 0)); t.ap = r2(t.ap + Number(it.acres_item || 0)); }
      it.total = r2(baseItem(it) - it.rateio_desc + it.rateio_acres);
    }
    const desc = r2(t.dp + t.ds + Number(os.desc_geral || 0));
    const acres = r2(t.ap + t.as + Number(os.acres_geral || 0));
    return {
      ...t,
      desconto: desc,
      acrescimo: acres,
      frete: r2(os.frete),
      deslocamento: r2(os.deslocamento),
      total: Math.max(0, r2(t.bp + t.bs - desc + acres + Number(os.frete || 0) + Number(os.deslocamento || 0))),
    };
  }

  /* ---------- Cabeçalho do módulo ---------- */
  const ABAS = [['quadro', 'Quadro'], ['solucoes', 'Soluções'], ['status', 'Status'], ['tecnicos', 'Técnicos']];
  function abasVisiveis() {
    return ABAS.filter(([k]) => k !== 'tecnicos' || st.podeTecnicos);
  }
  function abasHtml() {
    return `<div class="os-topo"><div class="os-seg" role="tablist">${abasVisiveis().map(([k, n]) => `<button type="button" role="tab" data-os-view="${k}" class="${st.view === k ? 'on' : ''}" aria-selected="${st.view === k}">${n}</button>`).join('')}</div>
      <span class="os-esp"></span>${mostrarBotaoApp() ? `<button type="button" class="ob os-btn-app" data-os-app>${ic('monitor', 'p')}Aplicativo desktop</button>` : ''}<button type="button" class="ob pri" data-os-nova>${ic('mais', 'p')}Nova O.S</button></div>`;
  }

  /* ---------- App desktop ---------- */
  /** Dentro do app desktop (pywebview) a tela é a mesma; o app se identifica no user agent. */
  function noAppDesktop() {
    return /GestorOS-Desktop/i.test(navigator.userAgent) || !!window.pywebview;
  }
  function appNativo() {
    return noAppDesktop() ? (window.pywebview?.api || null) : null;
  }
  function mostrarBotaoApp() {
    return !noAppDesktop() && !window.GestorApp && !window.__GESTOR_APP__;
  }

  async function abrirAppDesktop() {
    const r = await api('/desktop/info');
    if (!r.ok) { msg(r.error || 'Não foi possível consultar o aplicativo desktop.'); return; }
    if (!r.disponivel) {
      await janela(`<div class="corpo"><div class="circ">${ic('monitor', 'g')}</div><h2>Aplicativo desktop</h2>
        <p>O instalador do aplicativo ainda não veio nesta versão do Gestor. Ele chega junto com a próxima atualização do serviço.</p></div>
        <footer><button type="button" data-fechar="ok">Entendi</button></footer>`, { classe: 'alerta' });
      return;
    }
    const mb = (Number(r.tamanho) / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    const data = r.data ? String(r.data).slice(0, 10).split('-').reverse().join('/') : '';
    const inst = r.instalado;
    const situacao = inst
      ? `<p class="os-app-sit">Este computador já tem o aplicativo${inst.versao ? `, versão ${esc(inst.versao)}` : ''}.${r.atualizar ? ' <b>Há uma versão nova.</b>' : ''}</p>`
      : '';
    const onde = r.acesso === 'online'
      ? `O download funciona no acesso online. Instalado no computador da loja, o aplicativo fala com o servidor em ${esc(r.servidor || '')}.`
      : `Roda nos computadores da loja e fala com este serviço pela rede (${esc(r.servidor || '')}).`;
    await janela(`<header><div><h2>Aplicativo desktop da O.S</h2><p>Versão ${esc(r.versao)}${data ? ` · ${esc(data)}` : ''} · ${esc(mb)} MB</p></div><span class="os-esp"></span><button type="button" class="ob ico sm" data-fechar="" aria-label="Fechar">${ic('x', 'p')}</button></header>
      <div class="corpo os-app-corpo">
        <p>${onde} Se a internet cair, continua funcionando; se o servidor cair, entra em contingência e sincroniza depois.</p>
        <ul class="os-app-lista"><li>O instalador já vem com o endereço do servidor.</li><li>Ícone no menu Iniciar e na área de trabalho.</li><li>Imprime direto na impressora escolhida, inclusive a de 80 mm.</li><li>Atualiza sozinho quando sair versão nova.</li></ul>
        ${situacao}
      </div>
      <footer>${inst ? '<a class="ob" href="gestoros://abrir">Abrir aplicativo</a>' : ''}<a class="ob pri" href="/api/desktop/baixar" download>${ic('baixar', 'p')}${inst && r.atualizar ? 'Atualizar' : 'Baixar instalador'}</a></footer>`);
  }

  /** No app desktop, a impressão vai direto para a impressora escolhida, sem a tela do navegador. */
  async function imprimirNoApp(id, formato, modelo) {
    const nat = appNativo();
    if (!nat || typeof nat.imprimir_os !== 'function') return false;
    try {
      const r = await nat.imprimir_os(Number(id), formato, modelo);
      if (r && r.ok) { msg(r.mensagem || `O.S ${id} enviada para a impressora.`); return true; }
      if (r && r.error) msg(r.error);
      return !!(r && r.tratado);
    } catch {
      return false;
    }
  }

  /* ================================================================== */
  /* Quadro                                                              */
  /* ================================================================== */

  function queryFiltros() {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(st.filtros)) if (v) p.set(k, v);
    return p.toString();
  }

  async function carregarQuadro() {
    const res = await api(`/os?${queryFiltros()}`);
    if (!res.ok) {
      raizEl().innerHTML = `<div class="os">${abasHtml()}<p class="os-vazio">${esc(res.error || 'Não foi possível abrir as O.S.')}</p></div>`;
      return;
    }
    st.dados = res;
    st.statuses = res.statuses;
    st.tecnicos = res.tecnicos;
    renderQuadro();
  }

  function cardHtml(o) {
    const tec = o.tecnico
      ? `<button type="button" class="os-av" data-os-tec="${o.id}" title="Técnico: ${esc(o.tecnico.nome)} — trocar">${esc(o.tecnico.iniciais)}</button>`
      : `<button type="button" class="os-av vazio" data-os-tec="${o.id}" title="Vincular técnico">+</button>`;
    return `<article class="os-card${o.cancelada ? ' cancelada' : (o.atrasada ? ' atrasada' : '')}" draggable="${o.cancelada || o.importada ? 'false' : 'true'}" tabindex="0" data-os-card="${o.id}" data-status="${o.id_status}" data-importada="${o.importada ? '1' : '0'}">
      <div class="l1"><span class="n">O.S ${o.id}</span><span class="tp">${o.tipo === 'E' ? 'Externa' : 'Interna'} · ${o.modalidade === 'R' ? 'Remota' : 'Presencial'}</span>
        <span class="acoes"><button type="button" data-os-subir="${o.id}" title="Subir prioridade">${ic('cima')}</button><button type="button" data-os-descer="${o.id}" title="Descer prioridade">${ic('baixo')}</button><button type="button" data-os-menu="${o.id}" title="Status e técnico">${ic('pontos')}</button></span></div>
      <div class="cli">${esc(o.cliente || '—')}</div>
      <div class="eq">${ic('monitor', 'p')}<span>${esc(o.equipamento || '')}</span></div>
      <div class="l3">${tec}${o.previsao ? `<span class="prev">${ic('cal', 'p')}${o.atrasada ? 'Venceu ' : ''}${diaMes(o.previsao)}</span>` : '<span class="prev">sem previsão</span>'}
        ${o.cancelada ? '<span class="canc">Cancelada</span>' : (o.enviada ? '<span class="env" title="Já está na venda gerencial">na venda</span>' : '')}</div>
    </article>`;
  }

  function renderQuadro() {
    const d = st.dados;
    const ativos = d.statuses.filter((s) => s.ativo);
    const total = d.os.length;
    const atrasadas = d.os.filter((o) => o.atrasada).length;
    const f = st.filtros;
    const opt = (v, t, atual) => `<option value="${esc(v)}" ${String(atual) === String(v) ? 'selected' : ''}>${esc(t)}</option>`;
    const filtros = `<div class="os-filtros">
      <label class="os-busca">${ic('busca', 'p')}<input class="oc" type="search" data-os-f="q" value="${esc(f.q)}" placeholder="Número, cliente, equipamento, defeito, quem trouxe…" aria-label="Buscar O.S" /></label>
      <select class="oc" data-os-f="tecnico" aria-label="Técnico">${opt('', 'Técnico: todos', f.tecnico)}${d.tecnicos.map((t) => opt(t.id, t.nome, f.tecnico)).join('')}</select>
      <select class="oc" data-os-f="status" aria-label="Status">${opt('', 'Status: todos', f.status)}${ativos.map((s) => opt(s.id, s.descricao, f.status)).join('')}</select>
      <select class="oc" data-os-f="tipo" aria-label="Tipo">${opt('', 'Tipo: todos', f.tipo)}${opt('I', 'Interna', f.tipo)}${opt('E', 'Externa', f.tipo)}</select>
      <select class="oc" data-os-f="modalidade" aria-label="Modalidade">${opt('', 'Modalidade: todas', f.modalidade)}${opt('P', 'Presencial', f.modalidade)}${opt('R', 'Remota', f.modalidade)}</select>
      <button type="button" class="ob sm" data-os-maisf aria-expanded="${st.maisFiltros}">${ic('filtro', 'p')}Mais filtros</button>
      <span class="os-esp"></span><span class="os-legenda">${total} O.S${atrasadas ? ` · ${atrasadas} atrasada${atrasadas > 1 ? 's' : ''}` : ''}</span>
    </div>
    ${st.maisFiltros ? `<div class="os-mais-filtros">
      ${[['emissao', 'Emissão'], ['previsao', 'Previsão'], ['entrega', 'Entrega']].map(([k, n]) => `<div class="os-campo"><span>${n} de / até</span><div class="par">
        <input class="oc" type="date" data-os-f="${k}De" value="${esc(f[`${k}De`] || '')}" aria-label="${n} de" /><input class="oc" type="date" data-os-f="${k}Ate" value="${esc(f[`${k}Ate`] || '')}" aria-label="${n} até" /></div></div>`).join('')}
      <div class="os-campo"><span>Cliente (código ou nome)</span><input class="oc" data-os-f="cliente" value="${esc(f.cliente || '')}" /></div>
      <div class="os-campo"><span>Quem trouxe</span><input class="oc" data-os-f="quemTrouxe" value="${esc(f.quemTrouxe || '')}" /></div>
      <div class="os-campo"><span>Equipamento</span><input class="oc" data-os-f="equipamento" value="${esc(f.equipamento || '')}" /></div>
      <div class="os-campo"><span>Defeito</span><input class="oc" data-os-f="defeito" value="${esc(f.defeito || '')}" /></div>
      <div class="os-campo"><span>&nbsp;</span><button type="button" class="ob" data-os-limpar>Limpar filtros</button></div>
    </div>` : ''}`;
    const cols = ativos.map((s) => {
      const lista = d.os.filter((o) => o.id_status === s.id).sort((a, b) => a.ordem - b.ordem || b.id - a.id);
      return `<section class="os-col" style="--h:${esc(s.cor)}" data-os-col="${s.id}" aria-label="${esc(s.descricao)}">
        <header><span class="os-icost">${ic(s.icone)}</span><h3 title="${esc(s.descricao)}">${esc(s.descricao)}</h3><span class="qtd">${lista.length}</span></header>
        ${lista.map(cardHtml).join('') || '<div class="vazio">Nenhuma O.S</div>'}
      </section>`;
    }).join('');
    raizEl().innerHTML = `<div class="os">${abasHtml()}${filtros}<div class="os-quadro">${cols}</div></div>`;
    ligarQuadro();
  }

  let timerBusca = 0;
  function ligarQuadro() {
    const r = raizEl();
    $$('[data-os-f]', r).forEach((el) => {
      const ev = el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input';
      el.addEventListener(ev, () => {
        st.filtros[el.dataset.osF] = el.value.trim();
        clearTimeout(timerBusca);
        timerBusca = setTimeout(async () => {
          const foco = document.activeElement?.dataset?.osF;
          await carregarQuadro();
          if (foco) { const de = $(`[data-os-f="${foco}"]`, raizEl()); if (de) { de.focus(); if (de.setSelectionRange && de.type === 'search') de.setSelectionRange(de.value.length, de.value.length); } }
        }, ev === 'input' ? 350 : 0);
      });
    });
    $('[data-os-maisf]', r)?.addEventListener('click', () => { st.maisFiltros = !st.maisFiltros; renderQuadro(); });
    $('[data-os-limpar]', r)?.addEventListener('click', () => { st.filtros = { q: '', tecnico: '', tipo: '', modalidade: '', status: '' }; carregarQuadro(); });
    const usaToque = !!(window.__GESTOR_APP__ || window.matchMedia?.('(pointer: coarse)')?.matches);
    $$('.os-card', r).forEach((card) => {
      if (usaToque) card.draggable = false;
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        if (card.dataset.osArraste === '1') { card.dataset.osArraste = ''; return; }
        abrirOs(Number(card.dataset.osCard));
      });
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === card) abrirOs(Number(card.dataset.osCard)); });
      card.addEventListener('dragstart', (e) => {
        if (usaToque || card.classList.contains('cancelada') || card.dataset.importada === '1') { e.preventDefault(); return; }
        card.classList.add('arrastando');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.dataset.osCard);
      });
      card.addEventListener('dragend', () => card.classList.remove('arrastando'));
    });
    $$('.os-col', r).forEach((col) => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('alvo'); });
      col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('alvo'); });
      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.classList.remove('alvo');
        const id = Number(e.dataTransfer.getData('text/plain'));
        if (!id) return;
        const idStatus = Number(col.dataset.osCol);
        const cards = $$('.os-card', col).filter((c) => Number(c.dataset.osCard) !== id);
        let pos = cards.length;
        for (let i = 0; i < cards.length; i += 1) {
          const b = cards[i].getBoundingClientRect();
          if (e.clientY < b.top + b.height / 2) { pos = i; break; }
        }
        const ids = cards.map((c) => Number(c.dataset.osCard));
        ids.splice(pos, 0, id);
        await moverCard(id, idStatus, ids);
      });
    });
    $$('[data-os-subir],[data-os-descer]', r).forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(b.dataset.osSubir || b.dataset.osDescer);
      const card = b.closest('.os-card');
      const col = card.closest('.os-col');
      const ids = $$('.os-card', col).map((c) => Number(c.dataset.osCard));
      const i = ids.indexOf(id);
      const j = b.dataset.osSubir ? i - 1 : i + 1;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      await moverCard(id, Number(col.dataset.osCol), ids);
    }));
    $$('[data-os-tec]', r).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); menuCard(Number(b.dataset.osTec), b, 'tecnico'); }));
    $$('[data-os-menu]', r).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); menuCard(Number(b.dataset.osMenu), b, 'tudo'); }));
    if (usaToque) ligarArrasteToque(r);
  }

  /** No celular o arraste nativo do navegador recarrega a WebView e volta para o login. Segura o card e solta na coluna. */
  function ligarArrasteToque(r) {
    const quadro = $('.os-quadro', r);
    if (!quadro) return;
    let press = null;
    let arrastando = null;
    let timer = 0;
    const limparAlvo = () => $$('.os-col.alvo', quadro).forEach((c) => c.classList.remove('alvo'));
    const soltarPress = () => { clearTimeout(timer); timer = 0; press = null; };
    const encerrar = () => {
      soltarPress();
      if (arrastando) arrastando.card.classList.remove('arrastando');
      arrastando = null;
      quadro.classList.remove('os-arraste');
      limparAlvo();
    };
    const colunaEm = (x, y) => document.elementFromPoint(x, y)?.closest?.('.os-col') || null;
    quadro.addEventListener('pointerdown', (e) => {
      const card = e.target.closest?.('.os-card');
      if (!card || e.target.closest('button')) return;
      if (card.classList.contains('cancelada') || card.dataset.importada === '1') return;
      press = { id: Number(card.dataset.osCard), card, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
      timer = setTimeout(() => {
        if (!press) return;
        arrastando = press;
        press = null;
        arrastando.card.classList.add('arrastando');
        quadro.classList.add('os-arraste');
        try { arrastando.card.setPointerCapture(arrastando.pointerId); } catch { /* o dedo segue no quadro */ }
      }, 280);
    });
    quadro.addEventListener('pointermove', (e) => {
      if (press && (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 12)) soltarPress();
      if (!arrastando || e.pointerId !== arrastando.pointerId) return;
      e.preventDefault();
      arrastando.x = e.clientX;
      arrastando.y = e.clientY;
      const col = colunaEm(e.clientX, e.clientY);
      $$('.os-col', quadro).forEach((c) => c.classList.toggle('alvo', c === col));
      const b = quadro.getBoundingClientRect();
      if (e.clientX < b.left + 56) quadro.scrollLeft -= 18;
      else if (e.clientX > b.right - 56) quadro.scrollLeft += 18;
    }, { passive: false });
    const soltar = (e) => {
      if (press && e.pointerId === press.pointerId) soltarPress();
      if (!arrastando || e.pointerId !== arrastando.pointerId) return;
      const dados = arrastando;
      const col = colunaEm(e.clientX, e.clientY);
      dados.card.dataset.osArraste = '1';
      encerrar();
      if (!col) return;
      const id = dados.id;
      const idStatus = Number(col.dataset.osCol);
      const cards = $$('.os-card', col).filter((c) => Number(c.dataset.osCard) !== id);
      let pos = cards.length;
      for (let i = 0; i < cards.length; i += 1) {
        const box = cards[i].getBoundingClientRect();
        if (e.clientY < box.top + box.height / 2) { pos = i; break; }
      }
      const ids = cards.map((c) => Number(c.dataset.osCard));
      ids.splice(pos, 0, id);
      moverCard(id, idStatus, ids);
    };
    quadro.addEventListener('pointerup', soltar);
    quadro.addEventListener('pointercancel', (e) => {
      if ((press && e.pointerId === press.pointerId) || (arrastando && e.pointerId === arrastando.pointerId)) encerrar();
    });
    quadro.addEventListener('contextmenu', (e) => { if (e.target.closest('.os-card')) e.preventDefault(); });
  }

  function papelStatus(descricao) {
    const n = String(descricao || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (n.includes('buscar')) return 'busca';
    if (n.includes('entreg') && !n.includes('conclu')) return 'entrega';
    return '';
  }

  function tipoEtapa(s) {
    const n = String(s?.descricao || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (n.includes('conclu')) return 'concluido';
    if (n.includes('entreg')) return 'entregando';
    if (n.includes('final')) return 'finalizada';
    if (n.includes('andamento')) return 'andamento';
    if (n.includes('peca')) return 'peca';
    if (n.includes('autoriz')) return 'autorizacao';
    if (n.includes('buscar')) return 'buscar';
    if (n.includes('abert')) return 'aberta';
    return '';
  }

  function proximaEtapa(atual) {
    const segue = {
      aberta: 'buscar', buscar: 'andamento', autorizacao: 'andamento', peca: 'andamento',
      andamento: 'finalizada', finalizada: 'entregando', entregando: 'concluido',
    };
    const alvo = segue[tipoEtapa(atual)];
    if (!alvo) return null;
    return (st.statuses || []).filter((s) => s.ativo).find((s) => tipoEtapa(s) === alvo) || null;
  }

  function etapaExigeItem(s) {
    const t = tipoEtapa(s);
    return t === 'finalizada' || t === 'entregando' || t === 'concluido';
  }

  function podeMoverPara(origem, destino) {
    if (!origem || !destino || origem.id === destino.id) return true;
    const o = tipoEtapa(origem);
    const d = tipoEtapa(destino);
    if (o === 'concluido') return false;
    if (o === 'finalizada') return d === 'entregando';
    if (o === 'entregando') return d === 'concluido';
    if (d === 'entregando' || d === 'concluido') return false;
    return true;
  }

  async function escolherColaborador(papel) {
    const res = await api('/os/funcionarios');
    const lista = res.funcionarios || [];
    if (!lista.length) { msg('Nenhum funcionário ativo no cadastro.'); return null; }
    const titulo = papel === 'busca' ? 'Quem vai buscar?' : 'Quem vai entregar?';
    const texto = papel === 'busca'
      ? 'Essa pessoa é avisada no WhatsApp para buscar o equipamento no cliente.'
      : 'Essa pessoa é avisada no WhatsApp para entregar o equipamento.';
    const escolhido = await janela(`<header><div><h2>${titulo}</h2><p>${texto}</p></div><span class="os-esp"></span><button type="button" class="ob ico sm" data-fechar="" aria-label="Fechar">${ic('x', 'p')}</button></header>
      <div class="corpo"><div class="os-campo"><label for="os-colab">Colaborador</label><select class="oc" id="os-colab">${lista.map((f) => `<option value="${f.id}">${esc(f.nome)}</option>`).join('')}</select></div></div>
      <footer><button type="button" class="ob" data-fechar="">Cancelar</button><button type="button" class="ob pri" id="colab-ok">Confirmar</button></footer>`, {
      aoAbrir: (dlg, fechar) => {
        $('#colab-ok', dlg).addEventListener('click', () => fechar(Number($('#os-colab', dlg).value) || null));
      },
    });
    return Number(escolhido) || null;
  }

  async function trocarEntregador() {
    if (!st.os?.id) { msg('Grave a O.S antes de trocar quem entrega.'); return; }
    const idc = await escolherColaborador('entrega');
    if (!idc) return;
    const res = await api(`/os/${st.os.id}/entregador`, { method: 'POST', body: { id_colaborador: idc } });
    if (!res.ok) { msg(res.error || 'Não foi possível trocar quem entrega.'); return; }
    avisar(res.avisos);
    const det = await api(`/os/${st.os.id}`);
    if (det.ok) { st.os = det.os; st.sujo = false; renderOs(); }
  }

  async function escolherBusca() {
    const res = await api('/os/funcionarios');
    const lista = res.funcionarios || [];
    return janela(`<header><div><h2>Buscar no cliente</h2><p>Se o equipamento já chegou, registre quem trouxe. Senão, escolha quem vai buscar.</p></div></header>
      <div class="corpo">
        <div class="os-seg" id="busca-modo"><button type="button" data-v="buscar" class="on">Alguém vai buscar</button><button type="button" data-v="empresa">Já se encontra na empresa</button></div>
        <div class="os-campo" id="busca-func"><label for="os-colab">Quem vai buscar</label><select class="oc" id="os-colab">${lista.map((f) => `<option value="${f.id}">${esc(f.nome)}</option>`).join('') || '<option value="">Nenhum funcionário ativo</option>'}</select></div>
        <div class="os-campo" id="busca-quem" hidden><label for="busca-nome">Quem trouxe</label><input class="oc" id="busca-nome" maxlength="100" placeholder="Nome de quem entregou o equipamento" /></div>
      </div>
      <footer><button type="button" class="ob" data-fechar="">Cancelar</button><button type="button" class="ob pri" id="busca-ok">Confirmar</button></footer>`, {
      aoAbrir: (dlg, fechar) => {
        let modo = 'buscar';
        $$('#busca-modo button', dlg).forEach((b) => b.addEventListener('click', () => {
          modo = b.dataset.v;
          $$('#busca-modo button', dlg).forEach((x) => x.classList.toggle('on', x === b));
          $('#busca-func', dlg).hidden = modo !== 'buscar';
          $('#busca-quem', dlg).hidden = modo !== 'empresa';
          if (modo === 'empresa') $('#busca-nome', dlg).focus();
        }));
        $('#busca-ok', dlg).addEventListener('click', () => {
          if (modo === 'empresa') {
            const quem = $('#busca-nome', dlg).value.trim();
            if (!quem) { msg('Informe quem trouxe o equipamento.'); $('#busca-nome', dlg).focus(); return; }
            fechar({ na_empresa: true, quem_trouxe: quem, id_colaborador: null });
            return;
          }
          const idc = Number($('#os-colab', dlg).value) || null;
          if (!idc) { msg('Nenhum funcionário ativo no cadastro.'); return; }
          fechar({ na_empresa: false, quem_trouxe: '', id_colaborador: idc });
        });
      },
    });
  }

  async function confirmarDestino(origem, destino) {
    if (!podeMoverPara(origem, destino)) {
      msg('Depois de finalizada a O.S só segue para a próxima etapa.');
      return null;
    }
    if (st.view === 'os' && etapaExigeItem(destino) && !(st.os?.itens || []).length) {
      msg('Informe ao menos um produto ou serviço para finalizar. O valor pode ser zero.');
      return null;
    }
    if (tipoEtapa(destino) === 'buscar' && tipoEtapa(origem) === 'aberta') {
      const r = await escolherBusca();
      if (!r || typeof r !== 'object') return null;
      if (r.na_empresa) {
        const andamento = (st.statuses || []).find((s) => s.ativo && tipoEtapa(s) === 'andamento');
        if (andamento) r.id_status = andamento.id;
      }
      return r;
    }
    const papel = papelStatus(destino?.descricao);
    if (papel && origem?.id !== destino?.id) {
      const idc = await escolherColaborador(papel);
      if (!idc) return null;
      return { id_colaborador: idc, na_empresa: false, quem_trouxe: '' };
    }
    return { id_colaborador: null, na_empresa: false, quem_trouxe: '' };
  }

  async function oferecerConclusao(id, enviada) {
    if (enviada) return;
    if (st.view === 'os' && st.os?.id === id && !(st.os.itens || []).length) {
      msg('Informe ao menos um produto ou serviço para finalizar. O valor pode ser zero.');
      return;
    }
    const ok = await confirmar('Concluir serviço?', 'A O.S vira um pedido para o Clipp importar na venda. Os produtos ficam reservados e os itens não podem mais ser alterados.', { sim: 'Concluir serviço', nao: 'Agora não', icone: 'venda' });
    if (ok) await enviarVenda(id, true);
  }

  async function pedirAutorizacao() {
    const res = await api('/os/funcionarios');
    const lista = res.funcionarios || [];
    if (!lista.length) { msg('Nenhum funcionário ativo no cadastro.'); return null; }
    const texto = '';
    return janela(`<header><div><h2>Autorização</h2><p>Quem falou com o cliente e o que foi combinado.</p></div></header>
      <div class="corpo">
        <div class="os-campo"><label for="aut-func">Funcionário que entrou em contato</label><select class="oc" id="aut-func">${lista.map((f) => `<option value="${f.id}">${esc(f.nome)}</option>`).join('')}</select></div>
        <div class="os-campo"><label for="aut-desc">Detalhes da autorização</label><textarea class="oc" id="aut-desc" maxlength="2000" style="min-height:110px" placeholder="Falei com o cliente por WhatsApp e me autorizou a abertura do equipamento.">${esc(texto)}</textarea></div>
        <label class="os-linha" style="padding:11px 13px;border-radius:12px;background:var(--os-fill)"><span>Enviar para a próxima etapa</span><span class="os-esp"></span><button type="button" class="os-chave on" id="aut-prox" aria-pressed="true" aria-label="Enviar para a próxima etapa"></button></label>
      </div>
      <footer><button type="button" class="ob" data-fechar="">Cancelar</button><button type="button" class="ob pri" id="aut-ok">Confirmar</button></footer>`, {
      aoAbrir: (dlg, fechar) => {
        $('#aut-prox', dlg).addEventListener('click', (e) => {
          e.preventDefault();
          e.currentTarget.classList.toggle('on');
          e.currentTarget.setAttribute('aria-pressed', e.currentTarget.classList.contains('on'));
        });
        const ok = () => {
          const descricao = $('#aut-desc', dlg).value.trim();
          if (!descricao) { msg('Informe os detalhes da autorização. Ex.: Falei com o cliente por WhatsApp e me autorizou a abertura do equipamento.'); $('#aut-desc', dlg).focus(); return; }
          const sel = $('#aut-func', dlg);
          const funcionario = Number(sel.value) || null;
          if (!funcionario) { msg('Escolha quem entrou em contato.'); return; }
          fechar({ descricao, funcionario, nome: sel.selectedOptions[0]?.textContent || '', proxima: $('#aut-prox', dlg).classList.contains('on') });
        };
        $('#aut-ok', dlg).addEventListener('click', ok);
      },
    });
  }

  async function prepararProxima() {
    const atual = statusDe(st.os.id_status);
    const prox = proximaEtapa(atual);
    if (!prox) { msg('Não há próxima etapa.'); return false; }
    const extra = await confirmarDestino(atual, prox);
    if (!extra) return false;
    const destino = extra.id_status ? (statusDe(extra.id_status) || prox) : prox;
    st.os.id_status = destino.id;
    st.os.id_colaborador_pendente = extra.id_colaborador || null;
    st.os.na_empresa = !!extra.na_empresa;
    if (extra.quem_trouxe) st.os.quem_trouxe = extra.quem_trouxe;
    const sel = $('#os-status');
    if (sel) sel.value = String(destino.id);
    return true;
  }

  async function moverCard(id, idStatus, ids) {
    const atual = st.dados.os.find((o) => o.id === id);
    if (atual && atual.id_status !== idStatus) {
      const origem = statusDe(atual.id_status);
      const destino = (st.dados.statuses || st.statuses || []).find((s) => s.id === idStatus);
      const extra = await confirmarDestino(origem, destino);
      if (!extra) return carregarQuadro();
      const idNovo = extra.id_status || idStatus;
      const destinoReal = (st.dados.statuses || st.statuses || []).find((s) => s.id === idNovo) || destino;
      const res = await api(`/os/${id}/status`, { method: 'POST', body: { id_status: idNovo, ...extra } });
      if (!res.ok) { msg(res.error || 'Não foi possível mudar o status.'); return carregarQuadro(); }
      avisar(res.avisos);
      if (idNovo === idStatus) await api('/os/ordem', { method: 'POST', body: { id_status: idStatus, ids } });
      await carregarQuadro();
      const etapa = tipoEtapa(destinoReal);
      if (res.final) await perguntarFechamento(id, res.enviada);
      else if (!res.enviada && (etapa === 'finalizada' || etapa === 'entregando')) await oferecerConclusao(id, false);
      return undefined;
    }
    await api('/os/ordem', { method: 'POST', body: { id_status: idStatus, ids } });
    return carregarQuadro();
  }

  function fecharMenu() {
    $$('.os-menu').forEach((m) => m.remove());
    document.removeEventListener('click', fecharMenu, true);
  }

  function menuCard(id, ancora, modo) {
    fecharMenu();
    const o = st.dados.os.find((x) => x.id === id);
    if (!o) return;
    const m = document.createElement('div');
    m.className = 'os-menu';
    m.setAttribute('role', 'menu');
    const origem = statusDe(o.id_status);
    const status = modo === 'tudo'
      ? `<p>Mudar status</p>${st.dados.statuses.filter((s) => s.ativo && (s.id === o.id_status || podeMoverPara(origem, s))).map((s) => `<button type="button" role="menuitem" data-st="${s.id}" class="${s.id === o.id_status ? 'on' : ''}" style="--h:${esc(s.cor)}"><span class="os-icost" style="width:24px;height:24px">${ic(s.icone, 'p')}</span>${esc(s.descricao)}</button>`).join('')}`
      : '';
    const tecs = `<p>Técnico</p>${st.dados.tecnicos.map((t) => `<button type="button" role="menuitem" data-tec="${t.id}" class="${t.id === o.id_tecnico ? 'on' : ''}"><span class="os-av" style="width:22px;height:22px">${esc(t.iniciais)}</span>${esc(t.nome)}</button>`).join('') || '<p style="text-transform:none;font-weight:500">Nenhum técnico. Marque a função Técnico no cadastro de funcionários.</p>'}
      ${o.id_tecnico ? '<button type="button" role="menuitem" data-tec="0">Remover técnico</button>' : ''}`;
    m.innerHTML = status + tecs;
    document.body.appendChild(m);
    const b = ancora.getBoundingClientRect();
    const larg = m.offsetWidth;
    m.style.left = `${Math.max(8, Math.min(window.innerWidth - larg - 8, b.left))}px`;
    const alto = m.offsetHeight;
    m.style.top = `${b.bottom + alto + 8 > window.innerHeight ? Math.max(8, b.top - alto - 6) : b.bottom + 6}px`;
    m.addEventListener('click', async (e) => {
      const bt = e.target.closest('button');
      if (!bt) return;
      e.stopPropagation();
      fecharMenu();
      if (bt.dataset.st) {
        const ids = st.dados.os.filter((x) => x.id_status === Number(bt.dataset.st) && x.id !== id).sort((a, c) => a.ordem - c.ordem).map((x) => x.id);
        ids.push(id);
        await moverCard(id, Number(bt.dataset.st), ids);
      } else if (bt.dataset.tec != null) {
        const res = await api(`/os/${id}/tecnico`, { method: 'POST', body: { id_tecnico: Number(bt.dataset.tec) || null } });
        if (!res.ok) msg(res.error || 'Não foi possível vincular o técnico.');
        else avisar(res.avisos);
        carregarQuadro();
      }
    });
    setTimeout(() => document.addEventListener('click', fecharMenu, true), 0);
    m.querySelector('button')?.focus();
  }

  async function perguntarFechamento(id, enviada) {
    await janelaImprimir(id, 'fechamento', { titulo: `O.S ${id} finalizada`, texto: 'Deseja imprimir ou enviar o fechamento?', oferecerVenda: !enviada });
  }

  /* ================================================================== */
  /* Tela da O.S                                                         */
  /* ================================================================== */

  function novaOs() {
    const ativos = st.statuses.filter((s) => s.ativo);
    return {
      id: 0,
      tipo: 'I',
      modalidade: 'P',
      id_status: ativos[0]?.id || 0,
      id_tecnico: null,
      quem_trouxe: '',
      id_categoria: null,
      id_subcategoria: null,
      categoria: '',
      subcategoria: '',
      equipamento: '',
      defeito: '',
      autorizacao: '',
      autor_status: '',
      id_autor_contato: null,
      autor_contato: '',
      solucao: '',
      obs: '',
      previsao: '',
      entrega: '',
      id_cliente: null,
      cliente: { id: null, nome: '', documento: '', telefone: '', endereco: '', observacao: '' },
      itens: [],
      desc_geral: 0,
      acres_geral: 0,
      frete: 0,
      deslocamento: 0,
      historico: [],
      id_pedido: null,
    };
  }

  async function garantirApoio() {
    if (!st.statuses.length || !st.dados) {
      const res = await api('/os?status=-1');
      if (res.ok) { st.statuses = res.statuses; st.tecnicos = res.tecnicos; }
    }
    const cfg = await api('/os/config');
    if (cfg.ok) st.limites = cfg.limites;
  }

  async function abrirOs(id) {
    await garantirApoio();
    if (id) {
      const res = await api(`/os/${id}`);
      if (!res.ok) { msg(res.error || 'O.S não encontrada.'); return; }
      st.os = res.os;
    } else {
      st.os = novaOs();
    }
    st.view = 'os';
    st.aba = 'P';
    st.itemSel = -1;
    st.liberacoes = [];
    st.sujo = false;
    st.statusGravado = st.os.id ? st.os.id_status : null;
    renderOs();
  }

  function travada() {
    return !!st.os?.id_pedido;
  }

  function statusDe(id) {
    return st.statuses.find((s) => s.id === Number(id)) || null;
  }

  function pillHtml(s) {
    if (!s) return '';
    return `<span class="os-pill" style="--h:${esc(s.cor)}">${ic(s.icone)}${esc(s.descricao)}</span>`;
  }

  function renderOs() {
    const o = st.os;
    const tr = travada();
    const s = statusDe(o.id_status);
    const tecnicosOpc = st.tecnicos.filter((t) => t.tecnico !== false);
    if (o.id_tecnico && !tecnicosOpc.some((t) => t.id === o.id_tecnico) && o.tecnico) tecnicosOpc.push({ id: o.id_tecnico, nome: o.tecnico.nome });
    const seg = (campo, opcoes) => `<div class="os-seg" role="group">${opcoes.map(([v, n]) => `<button type="button" data-seg="${campo}" data-v="${v}" class="${o[campo] === v ? 'on' : ''}" aria-pressed="${o[campo] === v}">${n}</button>`).join('')}</div>`;
    const cab = `<section class="os-grupo"><header><div class="os-cab-os"><h2>${o.id ? `O.S ${o.id}` : 'Nova O.S'}</h2>${pillHtml(s)}</div><span class="os-esp"></span>
        <span class="os-legenda">${o.id ? `Emitida em ${esc(o.emissao_br || '')}${o.usuario ? ` · por ${esc(o.usuario)}` : ''}` : 'O número sai ao gravar'}</span></header>
      <div class="corpo"><div class="os-g4">
        <div class="os-campo"><span>Tipo</span>${seg('tipo', [['I', 'Interna'], ['E', 'Externa']])}</div>
        <div class="os-campo"><span>Modalidade</span>${seg('modalidade', [['P', 'Presencial'], ['R', 'Remota']])}</div>
        <div class="os-campo"><label for="os-status">Status</label><select class="oc" id="os-status">${st.statuses.filter((x) => (x.ativo || x.id === o.id_status) && (x.id === o.id_status || podeMoverPara(s, x))).map((x) => `<option value="${x.id}" ${x.id === o.id_status ? 'selected' : ''}>${esc(x.descricao)}</option>`).join('')}</select></div>
        <div class="os-campo"><label for="os-tec-cod">Técnico responsável</label><div class="os-linha" style="align-items:stretch"><input class="oc" id="os-tec-cod" inputmode="numeric" value="${esc(o.id_tecnico || '')}" placeholder="Nº" title="Número do técnico" style="width:84px;flex:none" ${tr ? 'disabled' : ''} /><select class="oc" id="os-tecnico" style="flex:1;min-width:0" ${tr ? 'disabled' : ''}><option value="">Sem técnico</option>${tecnicosOpc.map((t) => `<option value="${t.id}" ${t.id === o.id_tecnico ? 'selected' : ''}>${esc(t.nome)}</option>`).join('')}</select></div></div>
        <div class="os-campo"><label for="os-previsao">Previsão</label><input class="oc" id="os-previsao" type="date" value="${esc(o.previsao || '')}" /></div>
        <div class="os-campo"><label for="os-entrega">Entrega</label><input class="oc" id="os-entrega" type="datetime-local" value="${esc((o.entrega || '').slice(0, 16))}" /></div>
        <div class="os-campo os-combo"><label for="os-cat">Categoria</label><div class="os-com-mais"><input class="oc" id="os-cat" autocomplete="off" placeholder="Ex.: Computador" value="${esc(o.categoria || '')}" /><button type="button" class="ob ico" id="os-cat-mais" title="Cadastrar categoria" aria-label="Cadastrar categoria">${ic('mais', 'p')}</button></div><div class="os-combo-lista" id="os-cat-lista" hidden></div></div>
        <div class="os-campo os-combo"><label for="os-sub">Subcategoria</label><div class="os-com-mais"><input class="oc" id="os-sub" autocomplete="off" placeholder="Notebook, Desktop, All in One" value="${esc(o.subcategoria || '')}" ${o.id_categoria ? '' : 'disabled'} /><button type="button" class="ob ico" id="os-sub-mais" title="Cadastrar subcategoria" aria-label="Cadastrar subcategoria" ${o.id_categoria ? '' : 'disabled'}>${ic('mais', 'p')}</button></div><div class="os-combo-lista" id="os-sub-lista" hidden></div></div>
      </div>
      ${tipoEtapa(s) === 'entregando' ? `<div class="os-campo" style="margin-top:12px"><label>Quem vai entregar</label><div class="os-linha" style="align-items:stretch"><input class="oc" value="${esc(o.entregador || 'Ninguém definido')}" disabled /><button type="button" class="ob" data-os-trocar-entrega ${tr || o.cancelada || o.importada ? 'disabled' : ''}>Trocar e avisar</button></div><p class="os-legenda" style="margin:6px 0 0">Se outro colaborador for levar, troque aqui. Ele recebe o aviso no WhatsApp.</p></div>` : ''}
      </div></section>`;
    const c = o.cliente || {};
    const cli = `<section class="os-grupo"><header><h2>Cliente</h2><span class="os-esp"></span>${tr ? '' : `<button type="button" class="ob sm" data-os-cadcli>${ic('mais', 'p')}Cadastrar cliente</button>`}</header>
      <div class="corpo">
        <div style="display:grid;grid-template-columns:110px minmax(0,1fr) 200px;gap:12px" class="os-cli-grade">
          <div class="os-campo"><label for="os-cli-cod">Código</label><input class="oc" id="os-cli-cod" inputmode="numeric" value="${esc(o.id_cliente || '')}" ${tr ? 'disabled' : ''} /></div>
          <div class="os-campo os-combo"><label for="os-cli-nome">Nome</label><input class="oc" id="os-cli-nome" autocomplete="off" placeholder="Digite o nome, CPF ou CNPJ" value="${esc(c.nome || '')}" ${tr ? 'disabled' : ''} /><div class="os-combo-lista" id="os-cli-lista" hidden></div></div>
          <div class="os-campo"><span>CPF/CNPJ</span><input class="oc" value="${esc(c.documento || '')}" disabled /></div>
        </div>
        ${c.nome ? `<div class="os-legenda">${[fmtFone(c.telefone), c.endereco].filter(Boolean).map(esc).join(' · ') || 'Sem telefone e endereço no cadastro'}</div>` : ''}
        ${c.observacao ? `<div class="os-aviso-cli">${ic('alerta', 'p')}${esc(c.observacao)}</div>` : ''}
        ${c.os_abertas && !o.id ? `<div class="os-legenda">Este cliente tem ${c.os_abertas} O.S em aberto.</div>` : ''}
      </div></section>`;
    const eq = `<section class="os-grupo"><header><h2>Equipamento e defeito</h2></header><div class="corpo">
        <div class="os-campo"><label for="os-equip">Equipamento</label><input class="oc" id="os-equip" maxlength="300" value="${esc(o.equipamento)}" placeholder="Marca, modelo, cor e acessórios que vieram junto" />${o.quem_trouxe ? `<p class="os-legenda" style="margin:6px 0 0">Quem trouxe: ${esc(o.quem_trouxe)}</p>` : ''}</div>
        <div class="os-g2">
          <div class="os-campo"><label for="os-defeito">Defeito apresentado</label><div class="os-linha" style="align-items:flex-start">
            <textarea class="oc" id="os-defeito" maxlength="2000" style="flex:1">${esc(o.defeito)}</textarea>
            <button type="button" class="os-lamp" data-os-lamp title="Sugerir soluções de defeitos parecidos" aria-label="Sugerir soluções">${ic('lampada', 'g')}</button></div></div>
          <div class="os-campo"><label for="os-autorizacao">Autorização solicitada</label>
            <textarea class="oc" id="os-autorizacao" maxlength="2000" placeholder="O que será proposto para o cliente autorizar">${esc(o.autorizacao || '')}</textarea>
            <div class="os-seg" id="os-autor" style="margin-top:8px">${[['','Sem status'],['P','Pendente'],['A','Autorizada'],['N','Recusada']].map(([v, n]) => `<button type="button" data-autor="${v}" class="${(o.autor_status || '') === v ? 'on' : ''}">${n}</button>`).join('')}</div>
            ${o.autor_contato ? `<p class="os-legenda" style="margin:6px 0 0">Contato: ${esc(o.autor_contato)}</p>` : ''}
          </div>
        </div>
        <div class="os-campo"><label for="os-solucao">Solução</label><textarea class="oc" id="os-solucao" maxlength="2000" placeholder="O que foi feito para resolver o problema">${esc(o.solucao)}</textarea></div>
        <div class="os-campo"><label for="os-obs">Observações</label><textarea class="oc" id="os-obs" maxlength="1000" style="min-height:52px">${esc(o.obs)}</textarea></div>
      </div></section>`;
    raizEl().innerHTML = `<div class="os">
      <div class="os-topo"><button type="button" class="ob ghost" data-os-voltar>${ic('esq', 'p')}Quadro</button><span class="os-esp"></span>
        ${o.cancelada ? `<span class="os-cancelada-tag">${ic('x', 'p')}Cancelada</span>` : ''}
        ${o.importada ? `<span class="os-travada">${ic('cadeado', 'p')}Importada na venda. Não pode ser editada nem cancelada.</span>` : (tr ? `<span class="os-travada">${ic('venda', 'p')}Na venda gerencial · pedido ${o.id_pedido}</span>` : '')}</div>
      <div class="os-edit"><div>${cab}${cli}${eq}<section class="os-grupo" id="os-itens"></section><section class="os-grupo" id="os-totais"></section></div>
      <aside class="os-lateral" style="display:grid;gap:14px" id="os-lateral"></aside></div></div>`;
    renderItens();
    renderTotais();
    renderLateral();
    ligarOs();
  }

  function renderItens() {
    const o = st.os;
    calcular(o);
    const tr = travada();
    const lista = o.itens.map((it, i) => ({ it, i })).filter(({ it }) => it.tipo === st.aba);
    const np = o.itens.filter((i) => i.tipo === 'P').length;
    const ns = o.itens.filter((i) => i.tipo === 'S').length;
    const sel = lista.some((x) => x.i === st.itemSel);
    const linhas = lista.map(({ it, i }) => {
      const ajuste = r2(Number(it.acres_item || 0) + Number(it.rateio_acres || 0) - Number(it.desc_item || 0) - Number(it.rateio_desc || 0));
      return `<tr data-item="${i}" class="${i === st.itemSel ? 'sel' : ''}"><td class="os-legenda">${it.id_identificador}</td>
        <td><b style="font-weight:600">${esc(it.descricao)}</b>${it.tipo === 'S' ? '<span class="sub">Serviço</span>' : `<span class="sub">${esc(it.unidade || 'UN')}</span>`}</td>
        ${it.tipo === 'P' ? `<td class="n">${qtdTxt(it.qtd)}</td>` : ''}<td class="n">${money(it.vlr_unit)}</td>
        <td class="n os-legenda">${ajuste ? `${ajuste < 0 ? '− ' : '+ '}${money(Math.abs(ajuste))}` : '—'}</td><td class="n"><b>${money(it.total)}</b></td></tr>`;
    }).join('');
    const vazio = `<tr class="vazia"><td colspan="6">${st.aba === 'P' ? 'Nenhum produto. Use Incluir produto.' : 'Nenhum serviço. Use Incluir serviço.'}</td></tr>`;
    $('#os-itens').innerHTML = `<header class="os-itens-topo"><div class="os-seg os-abas-item" role="tablist"><button type="button" data-aba="P" class="${st.aba === 'P' ? 'on' : ''}">Produtos<b>${np}</b></button><button type="button" data-aba="S" class="${st.aba === 'S' ? 'on' : ''}">Serviços<b>${ns}</b></button></div>
      ${tr ? '<span class="os-legenda">Itens travados: a O.S já foi para a venda</span>' : `<div class="os-itens-acoes">
      <button type="button" class="ob sm" data-os-item-alt ${sel ? '' : 'disabled'}>${ic('lapis', 'p')}Alterar</button>
      <button type="button" class="ob sm perigo" data-os-item-exc ${sel ? '' : 'disabled'}>${ic('lixo', 'p')}Excluir</button>
      <button type="button" class="ob sm" data-os-item-inc="P">${ic('mais', 'p')}Incluir produto</button>
      <button type="button" class="ob sm pri" data-os-item-inc="S">${ic('mais', 'p')}Incluir serviço</button></div>`}</header>
      <div class="corpo"><div class="os-tabela-wrap"><table class="os-tabela"><thead><tr><th>Cód.</th><th>Descrição</th>${st.aba === 'P' ? '<th class="n">Qtd</th>' : ''}<th class="n">${st.aba === 'P' ? 'Unitário' : 'Valor'}</th><th class="n">Desc./Acrésc.</th><th class="n">Total</th></tr></thead>
      <tbody>${linhas || vazio}</tbody></table></div>
      ${Number(o.desc_geral) || Number(o.acres_geral) ? '<p class="os-legenda" style="margin:0">O desconto e o acréscimo geral estão rateados entre produtos e serviços pelo valor de cada um. A diferença de centavos vai para o item de maior valor.</p>' : ''}</div>`;
  }

  function renderTotais() {
    const o = st.os;
    const tr = travada();
    const t = calcular(o);
    const campo = (id, rotulo, valor, cadeado) => `<div class="os-campo"><label for="${id}">${rotulo}</label><input class="oc num" id="${id}" inputmode="decimal" placeholder="0,00" value="${esc(moedaCampo(valor))}" ${tr ? 'disabled' : ''} ${cadeado ? `title="Acima de ${cadeado}% pede senha"` : ''} /></div>`;
    const tiles = [
      ['Bruto produtos', t.bp], ['Bruto serviços', t.bs],
      ['Desconto total', -t.desconto], ['Acréscimo total', t.acrescimo],
    ];
    $('#os-totais').innerHTML = `<header><h2>Totais</h2><span class="os-esp"></span><span class="os-legenda">${st.limites.geral ? `Desconto geral acima de ${st.limites.geral.toLocaleString('pt-BR')}% pede senha` : ''}</span></header>
      <div class="corpo"><div class="os-g4">
        ${campo('os-desc-geral', 'Desconto geral', o.desc_geral, st.limites.geral)}
        ${campo('os-acres-geral', 'Acréscimo geral', o.acres_geral)}
        ${campo('os-frete', 'Frete', o.frete)}
        ${campo('os-desloc', 'Deslocamento', o.deslocamento)}
      </div>
      <div class="os-tiles">${tiles.map(([n, v]) => `<div class="os-tile${v < 0 ? ' neg' : ''}"><span class="os-legenda">${n}</span><b>${v < 0 ? `− ${money(-v)}` : money(v)}</b></div>`).join('')}</div></div>`;
    ligarTotais();
  }

  function renderLateral() {
    const o = st.os;
    const t = calcular(o);
    const linhas = [
      ['Produtos', t.bp], ['Serviços', t.bs], ['Desconto total', -t.desconto], ['Acréscimo total', t.acrescimo],
      ['Frete', t.frete], ['Deslocamento', t.deslocamento],
    ].filter(([, v]) => Math.abs(v) > 0.004);
    const tr = travada();
    const hist = (o.historico || []).map((h) => `<div>${h.status_novo ? pillHtml(h.status_novo) : ''}<span>${esc(h.evento || '')}</span><small>${esc(h.data)}${h.usuario ? ` · ${esc(h.usuario)}` : ''}</small></div>`).join('');
    $('#os-lateral').innerHTML = `<section class="os-grupo"><header><h2>Resumo</h2></header><div class="corpo"><div class="os-totais">
        ${linhas.map(([n, v]) => `<div class="l${v < 0 ? ' neg' : ''}">${n} <b>${v < 0 ? `− ${money(-v)}` : money(v)}</b></div>`).join('') || '<div class="l">Nenhum item ainda <b></b></div>'}
        <div class="grande"><span>Total da O.S</span><b>${money(t.total)}</b></div></div></div></section>
      <div class="os-acoes-lat">
        <button type="button" class="ob pri" data-os-gravar ${st.gravando ? 'disabled' : ''}>${st.gravando ? 'Gravando…' : 'Gravar O.S'}</button>
        <button type="button" class="ob" data-os-imprimir ${o.id ? '' : 'disabled'}>${ic('impressora', 'p')}Imprimir</button>
        <button type="button" class="ob" data-os-hist ${o.id ? '' : 'disabled'}>${ic('impressora', 'p')}Imprimir histórico</button>
        <button type="button" class="ob" data-os-whats ${o.id ? '' : 'disabled'}>${ic('whats', 'p')}WhatsApp</button>
        ${tr || o.importada || o.cancelada ? '' : `<button type="button" class="ob largo" data-os-venda ${o.id && o.itens.length ? '' : 'disabled'} title="Grava o pedido para o Clipp concluir a venda">${ic('venda', 'p')}Concluir serviço</button>`}
        ${o.id && !o.cancelada && !o.importada ? `<button type="button" class="ob perigo" data-os-cancelar>${ic('x', 'p')}Cancelar O.S</button>` : ''}
      </div>
      ${o.id ? `<section class="os-grupo"><header><h2>Histórico</h2></header><div class="corpo"><div class="os-hist">${hist || '<span class="os-legenda">Sem registros</span>'}</div></div></section>` : ''}`;
    ligarLateral();
  }

  function marcarSujo() {
    st.sujo = true;
  }

  function tecnicoPorNumero(valor, confirmar) {
    const bruto = String(valor ?? '').trim();
    if (!bruto) return { id: null, ok: true };
    const id = Number(bruto);
    if (!id) return { ok: false };
    const lista = (st.tecnicos || []).filter((t) => t.tecnico !== false);
    const exato = lista.find((t) => t.id === id);
    const temMaior = lista.some((t) => String(t.id).startsWith(bruto) && String(t.id).length > bruto.length);
    if (temMaior && !confirmar) return { ok: false, aguardar: true };
    if (exato) return { id, ok: true, t: exato };
    return { ok: false };
  }

  function pintarTecnico(id) {
    const sel = $('#os-tecnico');
    const cod = $('#os-tec-cod');
    if (sel) sel.value = id ? String(id) : '';
    if (cod && document.activeElement !== cod) cod.value = id ? String(id) : '';
  }

  async function aplicarTecnico(valor, opcoes = {}) {
    const achou = tecnicoPorNumero(valor, !opcoes.silencioso);
    if (achou.aguardar) return;
    if (!achou.ok) {
      if (!opcoes.silencioso) msg('Técnico não encontrado.');
      pintarTecnico(st.os?.id_tecnico || null);
      return;
    }
    const id = achou.id || null;
    if ((st.os.id_tecnico || null) === id) {
      pintarTecnico(id);
      return;
    }
    if (st.os.cancelada || st.os.importada || travada()) {
      msg('Esta O.S não pode mais trocar o técnico.');
      pintarTecnico(st.os.id_tecnico || null);
      return;
    }
    const antes = st.os.id_tecnico || null;
    st.os.id_tecnico = id;
    st.os.tecnico = achou.t ? { id: achou.t.id, nome: achou.t.nome, iniciais: achou.t.iniciais } : null;
    pintarTecnico(id);
    if (!st.os.id) {
      marcarSujo();
      return;
    }
    const res = await api(`/os/${st.os.id}/tecnico`, { method: 'POST', body: { id_tecnico: id } });
    if (!res.ok) {
      st.os.id_tecnico = antes;
      const antigo = (st.tecnicos || []).find((t) => t.id === antes);
      st.os.tecnico = antigo ? { id: antigo.id, nome: antigo.nome, iniciais: antigo.iniciais } : st.os.tecnico;
      pintarTecnico(antes);
      msg(res.error || 'Não foi possível atualizar o técnico.');
      return;
    }
    avisar(res.avisos);
    const det = await api(`/os/${st.os.id}`);
    if (det.ok) {
      st.os.historico = det.os.historico;
      st.os.tecnico = det.os.tecnico;
      st.os.id_tecnico = det.os.id_tecnico;
      renderLateral();
    }
  }

  function lerCabecalho() {
    const o = st.os;
    if (!$('#os-equip')) return;
    o.id_status = Number($('#os-status').value) || o.id_status;
    o.id_tecnico = Number($('#os-tecnico').value) || null;
    o.previsao = $('#os-previsao').value;
    o.entrega = $('#os-entrega').value;
    o.equipamento = $('#os-equip').value.trim();
    o.defeito = $('#os-defeito').value.trim();
    o.autorizacao = $('#os-autorizacao')?.value.trim() || '';
    o.solucao = $('#os-solucao').value.trim();
    o.obs = $('#os-obs').value.trim();
  }

  function ligarOs() {
    const r = raizEl();
    $('[data-os-voltar]', r).addEventListener('click', async () => {
      lerCabecalho();
      if (st.sujo && !(await confirmar('Sair sem gravar?', 'As alterações desta O.S ainda não foram gravadas.', { sim: 'Sair', nao: 'Continuar aqui' }))) return;
      irPara('quadro');
    });
    $$('[data-seg]', r).forEach((b) => b.addEventListener('click', () => {
      st.os[b.dataset.seg] = b.dataset.v;
      $$(`[data-seg="${b.dataset.seg}"]`, r).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
      marcarSujo();
    }));
    $$('#os-status, #os-previsao, #os-entrega, #os-equip, #os-defeito, #os-autorizacao, #os-solucao, #os-obs', r)
      .forEach((el) => el?.addEventListener('input', marcarSujo));
    const selTec = $('#os-tecnico', r);
    const codTec = $('#os-tec-cod', r);
    let tecTimer = 0;
    selTec?.addEventListener('change', () => aplicarTecnico(selTec.value));
    codTec?.addEventListener('input', () => {
      clearTimeout(tecTimer);
      tecTimer = setTimeout(() => aplicarTecnico(codTec.value, { silencioso: true }), 400);
    });
    codTec?.addEventListener('change', () => { clearTimeout(tecTimer); aplicarTecnico(codTec.value); });
    codTec?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      clearTimeout(tecTimer);
      aplicarTecnico(codTec.value);
    });
    $('[data-os-trocar-entrega]', r)?.addEventListener('click', trocarEntregador);
    $$('#os-autor button', r).forEach((b) => b.addEventListener('click', async () => {
      const novo = b.dataset.autor || '';
      if (novo === 'P' && st.os.autor_status !== 'P') {
        lerCabecalho();
        if (!st.os.autorizacao) {
          msg('Descreva a solicitação de autorização.');
          $('#os-autorizacao')?.focus();
          return;
        }
        st.os.autor_status = 'P';
        $$('#os-autor button', r).forEach((x) => x.classList.toggle('on', x === b));
        const coluna = (st.statuses || []).find((s) => s.ativo && tipoEtapa(s) === 'autorizacao');
        if (coluna && podeMoverPara(statusDe(st.os.id_status), coluna)) {
          st.os.id_status = coluna.id;
          const sel = $('#os-status', r);
          if (sel && ![...sel.options].some((op) => op.value === String(coluna.id))) {
            const opt = document.createElement('option');
            opt.value = String(coluna.id);
            opt.textContent = coluna.descricao;
            sel.appendChild(opt);
          }
          if (sel) sel.value = String(coluna.id);
        }
        marcarSujo();
        const enviar = await confirmar('Enviar a solicitação para o cliente?', 'A O.S vai para Aguardando Autorização. A mensagem sai pelo WhatsApp da loja.', { sim: 'Enviar', nao: 'Agora não', icone: 'whats' });
        const id = await gravar({ ficar: true });
        if (!id) return;
        if (enviar) await janelaWhats(id, 'autorizacao');
        irPara('quadro');
        return;
      }
      if (novo === 'A' && st.os.autor_status !== 'A') {
        const pedido = await pedirAutorizacao();
        if (!pedido) return;
        st.os.autor_status = 'A';
        const proposta = ($('#os-autorizacao')?.value || '').trim();
        st.os.autorizacao = proposta && proposta !== pedido.descricao ? `${proposta}\n${pedido.descricao}` : pedido.descricao;
        st.os.id_autor_contato = pedido.funcionario;
        st.os.autor_contato = pedido.nome || '';
        if ($('#os-autorizacao')) $('#os-autorizacao').value = pedido.descricao;
        $$('#os-autor button', r).forEach((x) => x.classList.toggle('on', x.dataset.autor === 'A'));
        marcarSujo();
        st.proximaPerguntada = true;
        if (pedido.proxima) await prepararProxima();
        if (st.os.id) await gravar();
        return;
      }
      st.os.autor_status = novo;
      $$('#os-autor button', r).forEach((x) => x.classList.toggle('on', x === b));
      marcarSujo();
    }));
    $('#os-status', r).addEventListener('change', async () => {
      const anterior = st.os.id_status;
      const novoId = Number($('#os-status').value);
      if (novoId !== anterior) {
        const extra = await confirmarDestino(statusDe(anterior), statusDe(novoId));
        if (!extra) { $('#os-status').value = String(anterior || ''); return; }
        st.os.id_colaborador_pendente = extra.id_colaborador || null;
        st.os.na_empresa = !!extra.na_empresa;
        if (extra.quem_trouxe) st.os.quem_trouxe = extra.quem_trouxe;
        if (extra.id_status && extra.id_status !== novoId) {
          const selSt = $('#os-status');
          if (selSt && ![...selSt.options].some((o) => Number(o.value) === extra.id_status)) {
            const coluna = statusDe(extra.id_status);
            if (coluna) {
              const opt = document.createElement('option');
              opt.value = String(coluna.id);
              opt.textContent = coluna.descricao;
              selSt.appendChild(opt);
            }
          }
          if (selSt) selSt.value = String(extra.id_status);
          st.os.id_status = extra.id_status;
        } else st.os.id_status = novoId;
      } else st.os.id_status = novoId;
      const cab = $('.os-cab-os', r);
      cab.querySelector('.os-pill')?.remove();
      cab.insertAdjacentHTML('beforeend', pillHtml(statusDe(st.os.id_status)));
      marcarSujo();
    });
    $('[data-os-lamp]', r).addEventListener('click', abrirLampada);
    $('[data-os-cadcli]', r)?.addEventListener('click', cadastroRapido);
    ligarCliente();
    ligarCategoria();
    ligarItens();
    if (st.os.cancelada || st.os.importada) {
      $$('input, textarea, select, button', r).forEach((el) => {
        if (el.matches('[data-os-voltar], [data-os-imprimir], [data-os-hist], [data-fechar]')) return;
        el.disabled = true;
      });
    }
  }

  function ligarCombo({ campo, lista, mais, atual, url, aoEscolher, aoLimpar, cadastrar, vazio }) {
    if (!campo || !lista) return;
    let timer = 0;
    let itens = [];
    let sel = -1;
    const pintar = () => {
      lista.innerHTML = itens.map((c, i) => `<button type="button" data-i="${i}" class="${i === sel ? 'sel' : ''}">${esc(c.nome)}<small>${esc(c.detalhe)}</small></button>`).join('')
        || `<div class="os-legenda" style="padding:8px 10px">${vazio}</div>`;
      lista.hidden = false;
    };
    const buscar = async (q) => {
      const res = await api(url(q));
      itens = res.categorias || [];
      sel = itens.length ? 0 : -1;
      pintar();
    };
    campo.addEventListener('focus', () => { if (!campo.disabled) buscar(campo.value.trim() === atual() ? '' : campo.value.trim()); });
    campo.addEventListener('input', () => {
      clearTimeout(timer);
      if (!campo.value.trim()) aoLimpar();
      timer = setTimeout(() => buscar(campo.value.trim() === atual() ? '' : campo.value.trim()), 200);
    });
    campo.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { lista.hidden = true; return; }
      if (lista.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(itens.length - 1, sel + 1); pintar(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); pintar(); }
      if (e.key === 'Enter' && itens[sel]) { e.preventDefault(); lista.hidden = true; aoEscolher(itens[sel]); }
    });
    lista.addEventListener('mousedown', (e) => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      e.preventDefault();
      lista.hidden = true;
      aoEscolher(itens[Number(b.dataset.i)]);
    });
    campo.addEventListener('blur', () => {
      setTimeout(() => { lista.hidden = true; }, 150);
      if (!campo.value.trim()) aoLimpar();
      else if (campo.value.trim() !== atual()) campo.value = atual();
    });
    mais?.addEventListener('mousedown', () => {
      const v = campo.value.trim();
      campo.dataset.rascunho = v && v !== atual() ? v : '';
    });
    mais?.addEventListener('click', () => { if (!mais.disabled) cadastrar(campo.dataset.rascunho || ''); });
  }

  function ligarCategoria() {
    const sub = $('#os-sub');
    const maisSub = $('#os-sub-mais');
    const liberarSub = (ligado) => {
      if (sub) sub.disabled = !ligado;
      if (maisSub) maisSub.disabled = !ligado;
    };
    ligarCombo({
      campo: $('#os-cat'),
      lista: $('#os-cat-lista'),
      mais: $('#os-cat-mais'),
      atual: () => st.os.categoria || '',
      url: (q) => `/os/categorias?q=${encodeURIComponent(q)}`,
      vazio: 'Nenhuma categoria. Use o + para cadastrar.',
      aoEscolher: (item) => {
        st.os.id_categoria = item.id_categoria;
        st.os.categoria = item.categoria;
        st.os.id_subcategoria = null;
        st.os.subcategoria = '';
        const campo = $('#os-cat');
        if (campo) campo.value = item.categoria;
        if (sub) sub.value = '';
        liberarSub(true);
        marcarSujo();
      },
      aoLimpar: () => {
        st.os.id_categoria = null;
        st.os.categoria = '';
        st.os.id_subcategoria = null;
        st.os.subcategoria = '';
        if (sub) sub.value = '';
        liberarSub(false);
        marcarSujo();
      },
      cadastrar: (rascunho) => cadastrarCategoria(rascunho, false),
    });
    ligarCombo({
      campo: sub,
      lista: $('#os-sub-lista'),
      mais: maisSub,
      atual: () => st.os.subcategoria || '',
      url: (q) => `/os/categorias?pai=${encodeURIComponent(st.os.id_categoria || '')}&q=${encodeURIComponent(q)}`,
      vazio: 'Nenhuma subcategoria nesta categoria. Use o + para cadastrar.',
      aoEscolher: (item) => {
        st.os.id_subcategoria = item.id_subcategoria;
        st.os.subcategoria = item.subcategoria;
        if (sub) sub.value = item.subcategoria;
        marcarSujo();
      },
      aoLimpar: () => {
        st.os.id_subcategoria = null;
        st.os.subcategoria = '';
        marcarSujo();
      },
      cadastrar: (rascunho) => cadastrarCategoria(rascunho, true),
    });
  }

  async function cadastrarCategoria(rascunho, sub) {
    if (sub && !st.os.id_categoria) { msg('Escolha a categoria antes da subcategoria.'); return; }
    const criado = await janela(`<header><div><h2>${sub ? 'Cadastrar subcategoria' : 'Cadastrar categoria'}</h2><p>${sub ? `Entra em ${esc(st.os.categoria)}.` : 'Ex.: Computador. As subcategorias (Notebook, Desktop) entram depois, nesta categoria.'}</p></div><span class="os-esp"></span><button type="button" class="ob ico sm" data-fechar="" aria-label="Fechar">${ic('x', 'p')}</button></header>
      <div class="corpo">
        <div class="os-campo"><label for="cat-nome">${sub ? 'Subcategoria' : 'Categoria'}</label><input class="oc" id="cat-nome" maxlength="80" value="${esc(rascunho || '')}" /></div>
        <div class="os-erro" id="cat-erro"></div>
      </div>
      <footer><button type="button" class="ob" data-fechar="">Cancelar</button><button type="button" class="ob pri" id="cat-ok">Cadastrar</button></footer>`, {
      aoAbrir: (dlg, fechar) => {
        const nome = $('#cat-nome', dlg);
        const erro = $('#cat-erro', dlg);
        nome.focus();
        const salvar = async () => {
          erro.textContent = '';
          const body = sub
            ? { categoria: st.os.categoria, subcategoria: nome.value }
            : { categoria: nome.value };
          const res = await api('/os/categorias', { method: 'POST', body });
          if (!res.ok) { erro.textContent = res.error || 'Não foi possível cadastrar.'; return; }
          fechar(res.categoria);
        };
        $('#cat-ok', dlg).addEventListener('click', salvar);
        dlg.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); salvar(); } });
      },
    });
    if (!criado?.id_categoria) return;
    if (sub) {
      st.os.id_subcategoria = criado.id_subcategoria;
      st.os.subcategoria = criado.subcategoria;
      const campo = $('#os-sub');
      if (campo) campo.value = criado.subcategoria || '';
    } else {
      st.os.id_categoria = criado.id_categoria;
      st.os.categoria = criado.categoria;
      st.os.id_subcategoria = null;
      st.os.subcategoria = '';
      const campo = $('#os-cat');
      if (campo) campo.value = criado.categoria || '';
      const campoSub = $('#os-sub');
      if (campoSub) { campoSub.value = ''; campoSub.disabled = false; }
      const maisSub = $('#os-sub-mais');
      if (maisSub) maisSub.disabled = false;
    }
    marcarSujo();
  }

  /* ---------- Cliente ---------- */
  async function escolherCliente(id) {
    const res = await api(`/os/clientes/${encodeURIComponent(id)}`);
    if (!res.ok) { msg(res.error || 'Cliente não encontrado.'); return; }
    lerCabecalho();
    st.os.id_cliente = res.cliente.id;
    st.os.cliente = { ...res.cliente };
    marcarSujo();
    renderOs();
    $('#os-equip')?.focus();
  }

  function ligarCliente() {
    const cod = $('#os-cli-cod');
    const nome = $('#os-cli-nome');
    const lista = $('#os-cli-lista');
    if (!cod || !nome) return;
    const carregarCod = () => {
      const v = Number(cod.value);
      if (v && v !== st.os.id_cliente) escolherCliente(v);
    };
    cod.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); carregarCod(); } });
    cod.addEventListener('change', carregarCod);
    let timer = 0;
    let itens = [];
    let sel = -1;
    const pintar = () => {
      lista.innerHTML = itens.map((c, i) => `<button type="button" data-cli="${c.id}" class="${i === sel ? 'sel' : ''}">${esc(c.nome)}<small>${[`Cód. ${c.id}`, c.documento, c.telefone].filter(Boolean).map(esc).join(' · ')}</small></button>`).join('')
        || '<div class="os-legenda" style="padding:8px 10px">Nenhum cliente encontrado. Use Cadastrar cliente.</div>';
      lista.hidden = false;
    };
    nome.addEventListener('input', () => {
      clearTimeout(timer);
      const q = nome.value.trim();
      if (q.length < 2) { lista.hidden = true; return; }
      timer = setTimeout(async () => {
        const res = await api(`/os/clientes?q=${encodeURIComponent(q)}`);
        itens = res.clientes || [];
        sel = itens.length ? 0 : -1;
        pintar();
      }, 280);
    });
    nome.addEventListener('keydown', (e) => {
      if (lista.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(itens.length - 1, sel + 1); pintar(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); pintar(); }
      if (e.key === 'Enter' && itens[sel]) { e.preventDefault(); lista.hidden = true; escolherCliente(itens[sel].id); }
      if (e.key === 'Escape') lista.hidden = true;
    });
    nome.addEventListener('blur', () => setTimeout(() => { lista.hidden = true; }, 180));
    lista.addEventListener('mousedown', (e) => {
      const b = e.target.closest('[data-cli]');
      if (!b) return;
      e.preventDefault();
      lista.hidden = true;
      escolherCliente(Number(b.dataset.cli));
    });
  }

  async function cadastroRapido() {
    const salvo = await janela(`<header><div><h2>Cadastro rápido de cliente</h2><p>Com CNPJ, os dados vêm da Receita pela BrasilAPI. Com CPF, preencha à mão.</p></div><span class="os-esp"></span><button type="button" class="ob ico sm" data-fechar="" aria-label="Fechar">${ic('x', 'p')}</button></header>
      <div class="corpo">
        <div class="os-linha" style="flex-wrap:wrap;align-items:flex-end">
          <div class="os-campo"><span>Pessoa</span><div class="os-seg" id="cr-pessoa"><button type="button" data-p="pf" class="on">Física</button><button type="button" data-p="pj">Jurídica</button></div></div>
          <div class="os-campo" style="flex:1"><label for="cr-doc" id="cr-doc-rot">CPF</label><input class="oc" id="cr-doc" inputmode="numeric" /></div>
          <button type="button" class="ob" id="cr-buscar" hidden>${ic('globo', 'p')}Buscar CNPJ</button>
        </div>
        <div class="os-aviso" id="cr-info" hidden></div>
        <div class="os-g2"><div class="os-campo"><label for="cr-nome">Nome / razão social</label><input class="oc" id="cr-nome" maxlength="60" /></div>
          <div class="os-campo"><label for="cr-fant">Nome fantasia</label><input class="oc" id="cr-fant" maxlength="40" /></div></div>
        <div class="os-g2"><div class="os-campo"><label for="cr-cel">Celular</label><input class="oc" id="cr-cel" inputmode="tel" placeholder="(00) 00000-0000" /></div>
          <div class="os-campo"><label for="cr-cep">CEP</label><input class="oc" id="cr-cep" inputmode="numeric" maxlength="9" /></div></div>
        <div style="display:grid;grid-template-columns:minmax(0,1fr) 90px;gap:12px"><div class="os-campo"><label for="cr-rua">Logradouro</label><input class="oc" id="cr-rua" maxlength="40" /></div>
          <div class="os-campo"><label for="cr-num">Nº</label><input class="oc" id="cr-num" maxlength="5" /></div></div>
        <div class="os-g2"><div class="os-campo"><label for="cr-bairro">Bairro</label><input class="oc" id="cr-bairro" maxlength="35" /></div>
          <div class="os-campo"><span>Cidade/UF</span><input class="oc" id="cr-cidade" disabled placeholder="Preenchida pelo CNPJ ou no cadastro completo" /></div></div>
        <div class="os-erro" id="cr-erro"></div>
      </div>
      <footer><button type="button" class="ob" data-fechar="">Cancelar</button><button type="button" class="ob pri" id="cr-salvar">Salvar e usar na O.S</button></footer>`, {
      aoAbrir: (dlg, fechar) => {
        let pessoa = 'pf';
        let extra = {};
        const doc = $('#cr-doc', dlg);
        $$('#cr-pessoa button', dlg).forEach((b) => b.addEventListener('click', () => {
          pessoa = b.dataset.p;
          $$('#cr-pessoa button', dlg).forEach((x) => x.classList.toggle('on', x === b));
          $('#cr-doc-rot', dlg).textContent = pessoa === 'pj' ? 'CNPJ' : 'CPF';
          $('#cr-buscar', dlg).hidden = pessoa !== 'pj';
        }));
        const buscar = async () => {
          const info = $('#cr-info', dlg);
          info.hidden = false;
          info.className = 'os-aviso';
          info.textContent = 'Consultando o CNPJ na Receita (BrasilAPI)…';
          const res = await api(`/os/cnpj/${encodeURIComponent(doc.value.replace(/\D/g, ''))}`);
          if (!res.ok) { info.textContent = res.error || 'Não foi possível consultar.'; return; }
          const e = res.empresa;
          $('#cr-nome', dlg).value = e.nome; $('#cr-fant', dlg).value = e.fantasia; $('#cr-cep', dlg).value = e.cep;
          $('#cr-rua', dlg).value = e.logradouro; $('#cr-num', dlg).value = e.numero; $('#cr-bairro', dlg).value = e.bairro;
          $('#cr-cidade', dlg).value = e.cidade || '';
          if (e.comercial && !$('#cr-cel', dlg).value) $('#cr-cel', dlg).value = e.comercial;
          extra = { end_tipo: e.end_tipo, complemento: e.complemento, id_cidade: e.id_cidade, email: e.email, comercial: e.comercial };
          info.className = 'os-aviso ok';
          info.textContent = `Dados preenchidos pela Receita${e.situacao ? ` (situação: ${e.situacao})` : ''}. Confira antes de salvar.`;
        };
        $('#cr-buscar', dlg).addEventListener('click', buscar);
        doc.addEventListener('keydown', (e) => { if (e.key === 'Enter' && pessoa === 'pj') { e.preventDefault(); buscar(); } });
        $('#cr-salvar', dlg).addEventListener('click', async () => {
          const erro = $('#cr-erro', dlg);
          const nome = $('#cr-nome', dlg).value.trim();
          if (!nome) { erro.textContent = 'Informe o nome.'; return; }
          const body = {
            nome, pessoa, status: 'A',
            [pessoa === 'pj' ? 'cnpj' : 'cpf']: doc.value,
            fantasia: $('#cr-fant', dlg).value.trim(),
            celular: $('#cr-cel', dlg).value,
            cep: $('#cr-cep', dlg).value,
            logradouro: $('#cr-rua', dlg).value.trim(),
            numero: $('#cr-num', dlg).value.trim(),
            bairro: $('#cr-bairro', dlg).value.trim(),
            ...extra,
          };
          const res = await api('/clientes', { method: 'POST', body });
          if (!res.ok) { erro.textContent = res.error || 'Não foi possível cadastrar.'; return; }
          fechar(String(res.id || res.cliente?.id || ''));
        });
        doc.focus();
      },
    });
    if (salvo) escolherCliente(Number(salvo));
  }

  /* ---------- Lâmpada ---------- */
  async function abrirLampada() {
    lerCabecalho();
    const o = st.os;
    if (!o.defeito && !o.equipamento && !o.id_categoria) { msg('Descreva o defeito para buscar soluções parecidas.'); return; }
    const catOs = [o.categoria, o.subcategoria].filter(Boolean).join(' › ');
    const res = await api(`/os/solucoes/sugerir?defeito=${encodeURIComponent(o.defeito || '')}&equipamento=${encodeURIComponent(o.equipamento || '')}&categoria=${encodeURIComponent(o.id_categoria || '')}&subcategoria=${encodeURIComponent(o.id_subcategoria || '')}`);
    if (!res.ok) { msg(res.error || 'Não foi possível buscar soluções.'); return; }
    const lista = res.solucoes || [];
    const escolhida = await janela(`<header><span class="circ" style="background:color-mix(in srgb,#d4a106 18%,transparent);color:color-mix(in srgb,#d4a106 70%,var(--text))">${ic('lampada')}</span>
      <div><h2>Soluções parecidas</h2><p>${lista.length ? `${catOs ? `Categoria ${esc(catOs)}. ` : ''}Palavras em comum com o defeito: ${(res.palavras || []).slice(0, 6).map((p) => `<b>${esc(p)}</b>`).join(', ') || 'a mesma categoria'}` : `Nenhuma solução parecida${catOs ? ` em ${esc(catOs)}` : ''} ainda. Elas entram quando uma O.S desta categoria é finalizada com a solução preenchida.`}</p></div>
      <span class="os-esp"></span><button type="button" class="ob ico sm" data-fechar="" aria-label="Fechar">${ic('x', 'p')}</button></header>
      <div class="corpo">${lista.map((s) => `<div class="os-sug"><div class="os-linha"><b style="font-weight:650">${esc(s.defeito)}</b><span class="os-esp"></span><span class="os-chip">Usada ${s.usos}×</span></div>
        <p>${esc(s.solucao)}</p><div class="os-linha"><span class="os-legenda">${[s.categoria, s.subcategoria].filter(Boolean).join(' › ') || (s.id_os ? `O.S ${s.id_os}` : 'Cadastrada à mão')}${s.equipamento ? ` · ${esc(s.equipamento)}` : ''}</span><span class="os-esp"></span>
        <button type="button" class="ob sm pri" data-fechar="${s.id}">${ic('copiar', 'p')}Usar esta solução</button></div></div>`).join('')}</div>`);
    const s = lista.find((x) => String(x.id) === String(escolhida));
    if (!s) return;
    const campo = $('#os-solucao');
    campo.value = campo.value.trim() ? `${campo.value.trim()}\n${s.solucao}` : s.solucao;
    st.os.solucao = campo.value;
    marcarSujo();
    api(`/os/solucoes/${s.id}/usar`, { method: 'POST', body: {} });
    campo.focus();
  }

  /* ---------- Itens ---------- */
  function ligarItens() {
    const box = $('#os-itens');
    $$('[data-aba]', box).forEach((b) => b.addEventListener('click', () => { st.aba = b.dataset.aba; st.itemSel = -1; renderItens(); ligarItens(); }));
    $$('tr[data-item]', box).forEach((tr) => {
      tr.addEventListener('click', () => { st.itemSel = Number(tr.dataset.item); renderItens(); ligarItens(); });
      tr.addEventListener('dblclick', () => { if (!travada()) janelaItem(Number(tr.dataset.item)); });
    });
    $$('[data-os-item-inc]', box).forEach((b) => b.addEventListener('click', () => {
      st.aba = b.dataset.osItemInc === 'S' ? 'S' : 'P';
      janelaItem(-1);
    }));
    $('[data-os-item-alt]', box)?.addEventListener('click', () => janelaItem(st.itemSel));
    $('[data-os-item-exc]', box)?.addEventListener('click', async () => {
      const it = st.os.itens[st.itemSel];
      if (!it || !(await confirmar('Excluir item?', it.descricao, { sim: 'Excluir', nao: 'Cancelar', icone: 'lixo' }))) return;
      st.os.itens.splice(st.itemSel, 1);
      st.itemSel = -1;
      marcarSujo();
      atualizarValores();
    });
  }

  function atualizarValores() {
    renderItens();
    ligarItens();
    renderTotais();
    renderLateral();
  }

  /** Pede usuário e senha de quem libera; devolve o token (ou nada se cancelar). */
  async function pedirLiberacao(percentual, escopo, limite) {
    const res = await api('/os/liberadores');
    const libs = res.liberadores || [{ id: 0, nome: 'Supervisor' }];
    return janela(`<header><span class="circ">${ic('cadeado')}</span><div><h2>Liberar desconto</h2><p>${percentual.toLocaleString('pt-BR')}% passa do limite de ${limite.toLocaleString('pt-BR')}% ${escopo === 'geral' ? 'do desconto geral' : 'no item'}.</p></div></header>
      <div class="corpo">
        <div class="os-campo"><label for="lb-usu">Quem libera (supervisor ou gerente)</label><select class="oc" id="lb-usu">${libs.map((l) => `<option value="${l.id}">${esc(l.nome)}</option>`).join('')}</select></div>
        <div class="os-campo"><label for="lb-senha">Senha</label><input class="oc" id="lb-senha" type="password" autocomplete="off" /></div>
        <p class="os-legenda" style="margin:0">Fica registrado na O.S quem liberou, quando e o percentual.</p>
        <div class="os-erro" id="lb-erro"></div>
      </div>
      <footer><button type="button" class="ob" data-fechar="">Cancelar</button><button type="button" class="ob pri" id="lb-ok">Liberar</button></footer>`, {
      aoAbrir: (dlg, fechar) => {
        const ok = async () => {
          const r = await api('/os/liberar', { method: 'POST', body: { id_usuario: Number($('#lb-usu', dlg).value), senha: $('#lb-senha', dlg).value, percentual, escopo } });
          if (!r.ok) { $('#lb-erro', dlg).textContent = r.error || 'Não liberado.'; $('#lb-senha', dlg).select(); return; }
          st.liberacoes.push(r.token);
          fechar(r.token);
        };
        $('#lb-ok', dlg).addEventListener('click', ok);
        $('#lb-senha', dlg).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
        $('#lb-senha', dlg).focus();
      },
    });
  }

  async function janelaItem(indice) {
    const editando = indice >= 0 ? { ...st.os.itens[indice] } : null;
    const servico = editando ? editando.tipo === 'S' : st.aba === 'S';
    const nomeTipo = servico ? 'serviço' : 'produto';
    let escolhido = editando ? { id_identificador: editando.id_identificador, descricao: editando.descricao, unidade: editando.unidade, prc_venda: editando.vlr_unit } : null;
    const resultado = await janela(`<header><div><h2>${editando ? 'Alterar' : 'Incluir'} ${nomeTipo}</h2><p>Busca por código, código de barras, descrição, referência ou descrição complementar</p></div><span class="os-esp"></span><button type="button" class="ob ico sm" data-fechar="" aria-label="Fechar">${ic('x', 'p')}</button></header>
      <div class="corpo">
        <div class="os-campo"><input class="oc" id="it-busca" type="search" placeholder="Pesquisar ${nomeTipo}" autocomplete="off" value="${esc(editando?.descricao || '')}" ${editando ? 'disabled' : ''} aria-label="Pesquisar" /></div>
        <div class="os-res" id="it-res" hidden></div>
        <div class="os-g4" id="it-campos">
          ${servico ? '' : `<div class="os-campo"><label for="it-qtd">Quantidade</label><input class="oc num" id="it-qtd" inputmode="decimal" value="${esc(editando ? qtdTxt(editando.qtd) : '1')}" /></div>`}
          <div class="os-campo"><label for="it-vlr">${servico ? 'Valor do serviço' : 'Unitário'}</label><input class="oc num" id="it-vlr" inputmode="decimal" value="${esc(moedaCampo(editando?.vlr_unit))}" /></div>
          <div class="os-campo"><span style="display:flex;align-items:center;gap:6px">Desconto<span class="os-esp"></span><span class="os-modo" data-modo="desc"><button type="button" data-m="v" class="on">R$</button><button type="button" data-m="p">%</button></span></span><input class="oc num" id="it-desc" inputmode="decimal" value="${esc(moedaCampo(editando?.desc_item))}" /></div>
          <div class="os-campo"><span style="display:flex;align-items:center;gap:6px">Acréscimo<span class="os-esp"></span><span class="os-modo" data-modo="acres"><button type="button" data-m="v" class="on">R$</button><button type="button" data-m="p">%</button></span></span><input class="oc num" id="it-acres" inputmode="decimal" value="${esc(moedaCampo(editando?.acres_item))}" /></div>
        </div>
        <div class="os-total-item"><span class="os-legenda">Total do ${nomeTipo}</span><b id="it-total">${money(0)}</b></div>
        <div class="os-erro" id="it-erro"></div>
      </div>
      <footer><button type="button" class="ob" data-fechar="">Cancelar</button><button type="button" class="ob pri" id="it-ok">${editando ? 'Salvar' : 'Incluir'}</button></footer>`, {
      aoAbrir: (dlg, fechar) => {
        const modos = { desc: 'v', acres: 'v' };
        const busca = $('#it-busca', dlg);
        const res = $('#it-res', dlg);
        let itens = [];
        let sel = -1;
        const valores = () => {
          const qtd = servico ? 1 : numTela($('#it-qtd', dlg).value);
          const vlr = numTela($('#it-vlr', dlg).value);
          const bruto = r2(qtd * vlr);
          const conv = (campo, modo) => { const n = numTela($(campo, dlg).value); return modo === 'p' ? r2((bruto * n) / 100) : r2(n); };
          const desc = Math.min(bruto, conv('#it-desc', modos.desc));
          const acres = conv('#it-acres', modos.acres);
          return { qtd, vlr, bruto, desc, acres, total: r2(bruto - desc + acres) };
        };
        const atualizar = () => { $('#it-total', dlg).textContent = money(valores().total); };
        const pintar = () => {
          res.hidden = !itens.length && !busca.value.trim();
          res.innerHTML = itens.map((p, i) => `<button type="button" data-i="${i}" class="${i === sel ? 'sel' : ''}"><div><b style="font-weight:600">${esc(p.descricao)}</b>
            <small>${[p.id_identificador, p.cod_barras, p.referencia ? `Ref. ${p.referencia}` : '', p.complemento, p.parecido ? 'parecido' : ''].filter(Boolean).map(esc).join(' · ')}</small></div>
            <div class="v">${money(p.prc_venda)}${servico ? '' : `<small class="${p.disponivel > 0 ? '' : 'sem'}">${p.disponivel > 0 ? `${qtdTxt(p.disponivel)} disponíveis` : 'sem estoque'}</small>`}</div></button>`).join('')
            || `<div class="os-legenda" style="padding:10px">Nenhum ${nomeTipo} encontrado.</div>`;
        };
        const escolher = (p) => {
          escolhido = p;
          busca.value = p.descricao;
          res.hidden = true;
          $('#it-vlr', dlg).value = moedaCampo(p.prc_venda);
          atualizar();
          ($('#it-qtd', dlg) || $('#it-vlr', dlg)).select();
        };
        let timer = 0;
        const consultar = async (mostrar) => {
          const q = busca.value.trim();
          if (!q || !dlg.isConnected) return;
          const r = await api(`/os/itens?aba=${servico ? 'servicos' : 'produtos'}&q=${encodeURIComponent(q)}&_=${Date.now()}`);
          if (!dlg.isConnected || busca.value.trim() !== q) return;
          if (!r.ok) {
            itens = [];
            res.hidden = false;
            res.innerHTML = `<div class="os-legenda" style="padding:10px">${esc(r.error || 'Não foi possível buscar.')}</div>`;
            return;
          }
          itens = r.itens || [];
          if (sel >= itens.length) sel = itens.length ? 0 : -1;
          if (itens.length && sel < 0) sel = 0;
          if (mostrar || !res.hidden) pintar();
        };
        const noFoco = () => consultar(true);
        const vivo = setInterval(() => consultar(false), 3000);
        dlg.addEventListener('close', () => { clearInterval(vivo); window.removeEventListener('focus', noFoco); });
        window.addEventListener('focus', noFoco);
        busca.addEventListener('input', () => {
          escolhido = null;
          clearTimeout(timer);
          const q = busca.value.trim();
          if (!q) { itens = []; res.hidden = true; return; }
          timer = setTimeout(() => consultar(true), 260);
        });
        busca.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(itens.length - 1, sel + 1); pintar(); }
          if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); pintar(); }
          if (e.key === 'Enter') { e.preventDefault(); if (itens[sel]) escolher(itens[sel]); }
        });
        res.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) escolher(itens[Number(b.dataset.i)]); });
        $$('.os-modo', dlg).forEach((g) => g.addEventListener('click', (e) => {
          const b = e.target.closest('[data-m]');
          if (!b) return;
          modos[g.dataset.modo] = b.dataset.m;
          $$('button', g).forEach((x) => x.classList.toggle('on', x === b));
          atualizar();
        }));
        $$('#it-campos input', dlg).forEach((i) => i.addEventListener('input', atualizar));
        $$('#it-campos input', dlg).forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#it-ok', dlg).click(); } }));
        $('#it-ok', dlg).addEventListener('click', async () => {
          const erro = $('#it-erro', dlg);
          if (!escolhido) { erro.textContent = `Pesquise e escolha o ${nomeTipo} na lista.`; return; }
          const v = valores();
          if (!(v.qtd > 0)) { erro.textContent = 'Informe a quantidade.'; return; }
          if (!(v.vlr > 0)) { erro.textContent = `Informe o valor do ${nomeTipo}.`; return; }
          const pct = v.bruto > 0 ? Math.round((v.desc / v.bruto) * 10000) / 100 : 0;
          if (st.limites.item > 0 && pct > st.limites.item + 0.0001) {
            const tem = await liberacaoValida('item', pct);
            if (!tem) {
              const token = await pedirLiberacao(pct, 'item', st.limites.item);
              if (!token) { erro.textContent = 'Desconto acima do limite sem liberação.'; return; }
            }
          }
          fechar({
            id_identificador: escolhido.id_identificador,
            descricao: escolhido.descricao,
            unidade: escolhido.unidade || 'UN',
            tipo: servico ? 'S' : 'P',
            qtd: v.qtd,
            vlr_unit: v.vlr,
            desc_item: v.desc,
            acres_item: v.acres,
          });
        });
        atualizar();
        if (!editando) busca.focus(); else ($('#it-qtd', dlg) || $('#it-vlr', dlg)).select();
      },
    });
    if (!resultado || typeof resultado !== 'object') return;
    if (editando) st.os.itens[indice] = { ...editando, ...resultado };
    else { st.os.itens.push(resultado); st.itemSel = st.os.itens.length - 1; }
    marcarSujo();
    atualizarValores();
  }

  /** As liberações guardadas na tela já cobrem este percentual? (o servidor confere de verdade ao gravar) */
  async function liberacaoValida(escopo, pct) {
    for (const t of st.liberacoes) {
      try {
        const dados = JSON.parse(atob(String(t).split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
        if (dados.escopo === escopo && dados.pct + 0.0001 >= pct && dados.exp > Date.now()) return true;
      } catch { /* token inválido: pede de novo */ }
    }
    return false;
  }

  /* ---------- Totais ---------- */
  function ligarTotais() {
    const campos = [['#os-frete', 'frete'], ['#os-desloc', 'deslocamento']];
    for (const [sel, chave] of campos) {
      const el = $(sel);
      el?.addEventListener('change', () => { st.os[chave] = Math.max(0, r2(numTela(el.value))); marcarSujo(); renderTotais(); renderLateral(); });
    }
    for (const [sel, chave] of [['#os-desc-geral', 'desc_geral'], ['#os-acres-geral', 'acres_geral']]) {
      const el = $(sel);
      el?.addEventListener('change', async () => {
        const antes = Number(st.os[chave] || 0);
        const novo = Math.max(0, r2(numTela(el.value)));
        if (novo === antes) return;
        if (novo > 0 && st.os.itens.length) {
          const ok = await confirmar('Ratear entre os itens?', `Esse valor será rateado entre os itens. Deseja continuar?\n\n${money(novo)} dividido pelo valor de cada produto e serviço.`, { sim: 'Sim, ratear', nao: 'Não' });
          if (!ok) { el.value = moedaCampo(antes); return; }
        }
        if (chave === 'desc_geral' && novo > 0 && st.limites.geral > 0) {
          const base = st.os.itens.reduce((s, it) => s + Math.max(0, baseItem(it)), 0);
          const pct = base > 0 ? Math.round((novo / base) * 10000) / 100 : 100;
          if (pct > st.limites.geral + 0.0001 && !(await liberacaoValida('geral', pct))) {
            const token = await pedirLiberacao(pct, 'geral', st.limites.geral);
            if (!token) { el.value = moedaCampo(antes); return; }
          }
        }
        st.os[chave] = novo;
        marcarSujo();
        atualizarValores();
      });
    }
  }

  /* ---------- Lateral: gravar, imprimir, WhatsApp, venda ---------- */
  function modeloImpressao(o) {
    const stt = statusDe(o?.id_status);
    const nome = String(stt?.descricao || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (stt?.final || nome.includes('final') || nome.includes('entreg') || nome.includes('conclu')) return 'fechamento';
    return 'abertura';
  }

  function ligarLateral() {
    const lat = $('#os-lateral');
    $('[data-os-gravar]', lat)?.addEventListener('click', gravar);
    $('[data-os-imprimir]', lat)?.addEventListener('click', () => janelaImprimir(st.os.id, modeloImpressao(st.os), { titulo: `Imprimir O.S ${st.os.id}`, semWhats: true }));
    $('[data-os-hist]', lat)?.addEventListener('click', () => imprimir(st.os.id, 'a4', 'historico'));
    $('[data-os-whats]', lat)?.addEventListener('click', () => janelaWhats(st.os.id, modeloImpressao(st.os)));
    $('[data-os-venda]', lat)?.addEventListener('click', enviarVenda);
    $('[data-os-cancelar]', lat)?.addEventListener('click', cancelarOs);
  }

  async function gravar(opcoes = {}) {
    const ficar = opcoes?.ficar === true;
    if (st.gravando) return null;
    lerCabecalho();
    const o = st.os;
    if (!o.id_cliente) { msg('Escolha o cliente.'); $('#os-cli-nome')?.focus(); return null; }
    if (!o.equipamento) { msg('Descreva o equipamento.'); $('#os-equip')?.focus(); return null; }
    if (!o.defeito) { msg('Descreva o defeito apresentado.'); $('#os-defeito')?.focus(); return null; }
    const catCampo = $('#os-cat');
    if (catCampo && catCampo.value.trim() && catCampo.value.trim() !== (o.categoria || '')) {
      msg('Escolha a categoria na lista ou cadastre com +.');
      catCampo.focus();
      return null;
    }
    const subCampo = $('#os-sub');
    if (subCampo && subCampo.value.trim() && subCampo.value.trim() !== (o.subcategoria || '')) {
      msg('Escolha a subcategoria na lista ou cadastre com +.');
      subCampo.focus();
      return null;
    }
    if (o.subcategoria && !o.id_categoria) {
      msg('A subcategoria precisa de uma categoria.');
      return null;
    }
    if (etapaExigeItem(statusDe(o.id_status)) && !(o.itens || []).length) {
      msg('Informe ao menos um produto ou serviço para finalizar. O valor pode ser zero.');
      return null;
    }
    const eraNova = !o.id;
    const statusAntes = eraNova ? null : st.statusGravado;
    st.gravando = true;
    renderLateral();
    const body = {
      tipo: o.tipo, modalidade: o.modalidade, id_status: o.id_status, id_tecnico: o.id_tecnico, quem_trouxe: o.quem_trouxe,
      equipamento: o.equipamento, defeito: o.defeito, autorizacao: o.autorizacao, autor_status: o.autor_status, id_autor_contato: o.id_autor_contato || null, solucao: o.solucao, obs: o.obs, previsao: o.previsao, entrega: o.entrega,
      id_categoria: o.id_categoria, id_subcategoria: o.id_subcategoria, id_colaborador: o.id_colaborador_pendente || null, na_empresa: !!o.na_empresa,
      id_cliente: o.id_cliente, desc_geral: o.desc_geral, acres_geral: o.acres_geral, frete: o.frete, deslocamento: o.deslocamento,
      itens: o.itens.map((it) => ({ id_identificador: it.id_identificador, descricao: it.descricao, tipo: it.tipo, unidade: it.unidade, qtd: it.qtd, vlr_unit: it.vlr_unit, desc_item: it.desc_item, acres_item: it.acres_item })),
      liberacoes: st.liberacoes,
    };
    const res = await api(eraNova ? '/os' : `/os/${o.id}`, { method: 'POST', body });
    st.gravando = false;
    if (!res.ok) { renderLateral(); msg(res.error || 'Não foi possível gravar.'); return null; }
    avisar(res.avisos);
    const det = await api(`/os/${res.id}`);
    if (det.ok) st.os = det.os;
    st.sujo = false;
    st.statusGravado = st.os.id_status;
    st.os.id_colaborador_pendente = null;
    const virouFinal = statusDe(st.os.id_status)?.final && statusAntes !== st.os.id_status;
    const mudouStatus = !eraNova && statusAntes !== st.os.id_status;
    const jaPerguntou = st.proximaPerguntada;
    st.proximaPerguntada = false;
    if (ficar) return res.id;
    if (eraNova) await janelaImprimir(res.id, 'abertura', { titulo: `O.S ${res.id} gravada`, texto: 'Abertura registrada. Deseja imprimir ou enviar?' });
    else if (virouFinal) await perguntarFechamento(res.id, !!st.os.id_pedido);
    if (!mudouStatus && !virouFinal && !jaPerguntou) await perguntarProxima(res.id);
    irPara('quadro');
    return res.id;
  }

  async function perguntarProxima(id) {
    const atual = statusDe(st.os?.id_status);
    const prox = proximaEtapa(atual);
    if (!prox) return;
    const ok = await confirmar('Enviar para a próxima etapa?', `Mover esta O.S para ${prox.descricao}.`, { sim: 'Enviar', nao: 'Ficar aqui' });
    if (!ok) {
      const etapa = tipoEtapa(atual);
      if (!st.os?.id_pedido && (etapa === 'finalizada' || etapa === 'entregando')) await oferecerConclusao(id, false);
      return;
    }
    const extra = await confirmarDestino(atual, prox);
    if (!extra) return;
    const mov = await api(`/os/${id}/status`, { method: 'POST', body: { id_status: prox.id, ...extra } });
    if (!mov.ok) { msg(mov.error || 'Não foi possível mudar a etapa.'); return; }
    avisar(mov.avisos);
    const det = await api(`/os/${id}`);
    if (det.ok) { st.os = det.os; st.statusGravado = det.os.id_status; }
    const etapa = tipoEtapa(statusDe(st.os?.id_status));
    if (mov.final) await perguntarFechamento(id, !!st.os.id_pedido);
    else if (!st.os?.id_pedido && (etapa === 'finalizada' || etapa === 'entregando')) await oferecerConclusao(id, false);
  }

  async function janelaImprimir(id, modelo, { titulo, texto, semWhats, oferecerVenda } = {}) {
    const det = await api(`/os/${id}/whatsapp?modelo=${encodeURIComponent(modelo)}`);
    const fone = det.telefone || '';
    const escolha = await janela(`<header><span class="circ" style="background:color-mix(in srgb,var(--ok) 16%,transparent);color:var(--ok)">${ic('check')}</span><div><h2>${esc(titulo || `O.S ${id}`)}</h2><p>${esc(texto || 'Escolha o formato.')}</p></div></header>
      <div class="corpo">
        <div class="os-campo"><span>Modelo</span><div class="os-seg" id="im-modelo"><button type="button" data-v="abertura" class="${modelo === 'abertura' ? 'on' : ''}">Abertura</button><button type="button" data-v="fechamento" class="${modelo === 'fechamento' ? 'on' : ''}">Fechamento</button><button type="button" data-v="historico" class="${modelo === 'historico' ? 'on' : ''}">Histórico</button></div></div>
        <div class="os-campo"><span>Formato</span><div class="os-seg" id="im-formato"><button type="button" data-v="a4">A4</button><button type="button" data-v="meia" class="on">Meia folha</button><button type="button" data-v="80">80 mm</button></div></div>
        ${semWhats ? '' : `<label class="os-linha" style="padding:11px 13px;border-radius:12px;background:var(--os-fill)">${ic('whats')}<span>Enviar para o WhatsApp do cliente${fone ? ` <b>${esc(fmtFone(fone))}</b>` : ''}</span><span class="os-esp"></span><button type="button" class="os-chave${fone ? ' on' : ''}" id="im-whats" aria-pressed="${!!fone}" aria-label="Enviar pelo WhatsApp"></button></label>`}
        ${oferecerVenda ? `<label class="os-linha" style="padding:11px 13px;border-radius:12px;background:var(--os-fill)">${ic('venda')}<span>Concluir serviço</span><span class="os-esp"></span><button type="button" class="os-chave on" id="im-venda" aria-pressed="true" aria-label="Concluir serviço"></button></label>` : ''}
      </div>
      <footer><button type="button" class="ob" data-fechar="">Agora não</button><button type="button" class="ob pri" id="im-ok">${ic('impressora', 'p')}Continuar</button></footer>`, {
      aoAbrir: (dlg, fechar) => {
        const escolhas = { modelo, formato: 'meia' };
        for (const [grupo, chave] of [['#im-modelo', 'modelo'], ['#im-formato', 'formato']]) {
          $$(`${grupo} button`, dlg).forEach((b) => b.addEventListener('click', () => { escolhas[chave] = b.dataset.v; $$(`${grupo} button`, dlg).forEach((x) => x.classList.toggle('on', x === b)); }));
        }
        $$('.os-chave', dlg).forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); b.classList.toggle('on'); b.setAttribute('aria-pressed', b.classList.contains('on')); }));
        $('#im-ok', dlg).addEventListener('click', () => fechar({
          ...escolhas,
          whats: !!$('#im-whats', dlg)?.classList.contains('on'),
          venda: !!$('#im-venda', dlg)?.classList.contains('on'),
          imprimir: true,
        }));
      },
    });
    if (!escolha || typeof escolha !== 'object') return;
    if (escolha.venda) await enviarVenda(id);
    if (escolha.whats) await janelaWhats(id, escolha.modelo);
    imprimir(id, escolha.formato, escolha.modelo);
  }

  async function janelaWhats(id, modelo) {
    const det = await api(`/os/${id}/whatsapp?modelo=${encodeURIComponent(modelo)}`);
    if (!det.ok) { msg(det.error || 'Não foi possível montar a mensagem.'); return; }
    const rotuloWa = modelo === 'fechamento' ? 'fechamento' : (modelo === 'autorizacao' ? 'autorização pendente' : 'abertura');
    await janela(`<header><span class="circ" style="background:color-mix(in srgb,#22a35a 16%,transparent);color:#1b8a4a">${ic('whats')}</span><div><h2>Enviar por WhatsApp</h2><p>O.S ${id} · ${rotuloWa}</p></div></header>
      <div class="corpo">
        <div class="os-campo"><label for="wa-num">Celular do cliente — confira antes de enviar</label><input class="oc" id="wa-num" inputmode="tel" value="${esc(fmtFone(det.telefone))}" /></div>
        <div class="os-bolha">${esc(det.texto)}</div>
        <p class="os-legenda" style="margin:0">Sai pelo WhatsApp da loja configurado no painel. Para mandar o PDF, use Imprimir e salve o arquivo.</p>
        <div class="os-erro" id="wa-erro"></div>
      </div>
      <footer><button type="button" class="ob" data-fechar="">Cancelar</button><button type="button" class="ob ok" id="wa-ok">${ic('whats', 'p')}Enviar</button></footer>`, {
      aoAbrir: (dlg, fechar) => {
        $('#wa-ok', dlg).addEventListener('click', async () => {
          const b = $('#wa-ok', dlg);
          b.disabled = true;
          const r = await api(`/os/${id}/whatsapp`, { method: 'POST', body: { numero: $('#wa-num', dlg).value, modelo } });
          b.disabled = false;
          if (!r.ok) { $('#wa-erro', dlg).textContent = r.error || 'Não foi possível enviar.'; return; }
          msg(r.enfileirada ? (r.aviso || 'Sem internet agora: a mensagem vai sair quando a conexão voltar.') : 'Mensagem enviada pelo WhatsApp da loja.');
          fechar('ok');
        });
        $('#wa-num', dlg).select();
      },
    });
    if (st.view === 'os' && st.os?.id === id) {
      const d = await api(`/os/${id}`);
      if (d.ok) { st.os.historico = d.os.historico; renderLateral(); }
    }
  }

  async function cancelarOs() {
    const id = st.os?.id;
    if (!id || st.os.cancelada || st.os.importada) return;
    if (st.sujo) { msg('Grave ou descarte as alterações antes de cancelar.'); return; }
    const ok = await confirmar('Cancelar esta O.S?', 'Ela vai para a coluna concluída com a marca de cancelada. Se o pedido ainda não foi importado, ele fica Reprovado no Clipp.', { sim: 'Cancelar O.S', nao: 'Voltar', icone: 'alerta' });
    if (!ok) return;
    const res = await api(`/os/${id}/cancelar`, { method: 'POST', body: {} });
    if (!res.ok) { msg(res.error || 'Não foi possível cancelar.'); return; }
    msg(`O.S ${id} cancelada.`);
    st.sujo = false;
    irPara('quadro');
  }

  async function enviarVenda(idParam, jaConfirmado) {
    const id = Number(idParam) || st.os?.id;
    if (!id) return;
    if (st.view === 'os' && st.os?.id === id && !(st.os.itens || []).length) {
      msg('Informe ao menos um produto ou serviço para finalizar. O valor pode ser zero.');
      return;
    }
    if (st.view === 'os' && st.sujo) {
      msg('Grave a O.S antes de concluir o serviço.');
      return;
    }
    if (!jaConfirmado) {
      const ok = await confirmar('Concluir serviço?', 'A O.S vira um pedido para o Clipp importar na venda. Os produtos ficam reservados e os itens não podem mais ser alterados.', { sim: 'Concluir serviço', nao: 'Cancelar', icone: 'venda' });
      if (!ok) return;
    }
    const res = await api(`/os/${id}/enviar-venda`, { method: 'POST', body: {} });
    if (!res.ok) { msg(res.error || 'Não foi possível concluir o serviço.'); return; }
    msg(`Serviço da O.S ${id} concluído (pedido ${res.id_pedido}).`);
    if (st.view === 'os' && st.os?.id === id) {
      const d = await api(`/os/${id}`);
      if (d.ok) { st.os = d.os; renderOs(); }
    } else if (st.view === 'quadro') carregarQuadro();
  }

  /* ================================================================== */
  /* Mensagens padrão                                                    */
  /* ================================================================== */

  const VARIAVEIS = ['numero_os', 'cliente', 'tecnico', 'equipamento', 'defeito', 'previsao', 'status', 'quem_trouxe'];
  const EXEMPLO = { numero_os: '1284', cliente: 'Mariana Alves', tecnico: 'Rafael', equipamento: 'Notebook Dell Inspiron 15', defeito: 'Não liga', previsao: '28/11/2026', status: 'Em Andamento', quem_trouxe: 'Pedro' };
  let msgSel = null;

  async function renderMensagens(host) {
    const alvo = host || raizEl();
    const embutido = !!host;
    const deNovo = () => renderMensagens(embutido ? alvo : null);
    const res = await api('/os/mensagens');
    if (!res.ok) {
      alvo.innerHTML = embutido ? `<p class="os-vazio">${esc(res.error)}</p>` : `<div class="os">${abasHtml()}<p class="os-vazio">${esc(res.error)}</p></div>`;
      return;
    }
    const lista = res.mensagens;
    if (!msgSel || (msgSel.id && !lista.some((m) => m.id === msgSel.id))) msgSel = lista[0] ? { ...lista[0] } : { id: 0, titulo: '', texto: '', evento: 'atribuida', ativo: true };
    const m = msgSel;
    const ev = Object.entries(res.eventos);
    alvo.innerHTML = `<div class="os">${embutido ? '' : abasHtml()}<div class="os-cad">
      <section class="os-grupo"><header><h2>Mensagens</h2><span class="os-esp"></span><button type="button" class="ob sm pri" data-msg-nova>${ic('mais', 'p')}Nova</button></header>
        <div class="corpo" style="gap:2px">${lista.map((x) => `<button type="button" class="os-item-lista${x.id === m.id ? ' on' : ''}" data-msg="${x.id}"><span class="os-icost" style="--h:${x.ativo ? '#0d9488' : '#64748b'}">${ic('whats', 'p')}</span>
          <span style="min-width:0"><b>${esc(x.titulo)}</b><br><span class="os-legenda">${esc(res.eventos[x.evento] || '')}${res.automaticos.includes(x.evento) ? ' · automática' : ' · em breve'}${x.ativo ? '' : ' · inativa'}</span></span></button>`).join('') || '<p class="os-legenda">Nenhuma mensagem.</p>'}</div></section>
      <section class="os-grupo"><header><h2>${m.id ? esc(m.titulo) : 'Nova mensagem'}</h2><span class="os-esp"></span><label class="os-linha os-legenda">Ativa<button type="button" class="os-chave${m.ativo ? ' on' : ''}" id="msg-ativo" aria-pressed="${m.ativo}" aria-label="Ativa"></button></label></header>
        <div class="corpo">
          <div class="os-g2"><div class="os-campo"><label for="msg-titulo">Título</label><input class="oc" id="msg-titulo" maxlength="80" value="${esc(m.titulo)}" /></div>
            <div class="os-campo"><label for="msg-evento">Evento que dispara</label><select class="oc" id="msg-evento">${ev.map(([k, n]) => `<option value="${k}" ${k === m.evento ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div></div>
          <div class="os-campo"><label for="msg-texto">Texto</label><textarea class="oc" id="msg-texto" maxlength="1000" style="min-height:110px">${esc(m.texto)}</textarea></div>
          <div class="os-chips"><span class="os-legenda">Inserir:</span>${VARIAVEIS.map((v) => `<button type="button" class="os-chip" data-var="${v}">{${v}}</button>`).join('')}</div>
          <div><div class="os-legenda" style="margin-bottom:6px">Prévia</div><div class="os-bolha" id="msg-previa"></div></div>
          <p class="os-legenda" style="margin:0">Por enquanto só "O.S atribuída ao técnico" dispara sozinha. Sai pelo WhatsApp da loja. O número sai do Celular ou do WhatsApp do cadastro do funcionário; se os dois estiverem vazios, o Gestor avisa e não envia.</p>
          <div class="os-linha">${m.id ? `<button type="button" class="ob perigo" data-msg-exc>${ic('lixo', 'p')}Excluir</button>` : ''}<span class="os-esp"></span><button type="button" class="ob pri" data-msg-salvar>Salvar</button></div>
        </div></section></div></div>`;
    const r = alvo.querySelector(':scope > .os') || alvo;
    const texto = $('#msg-texto', r);
    const previa = () => { $('#msg-previa', r).textContent = texto.value.replace(/\{(\w+)\}/g, (x, k) => EXEMPLO[k] ?? x); };
    previa();
    texto.addEventListener('input', previa);
    $$('[data-var]', r).forEach((b) => b.addEventListener('click', () => {
      const ins = `{${b.dataset.var}}`;
      const ini = texto.selectionStart ?? texto.value.length;
      texto.setRangeText(ins, ini, texto.selectionEnd ?? ini, 'end');
      texto.focus();
      previa();
    }));
    $('#msg-ativo', r).addEventListener('click', (e) => { e.currentTarget.classList.toggle('on'); });
    $$('[data-msg]', r).forEach((b) => b.addEventListener('click', () => { msgSel = { ...lista.find((x) => x.id === Number(b.dataset.msg)) }; deNovo(); }));
    $('[data-msg-nova]', r).addEventListener('click', () => { msgSel = { id: 0, titulo: '', texto: '', evento: 'atribuida', ativo: true }; deNovo(); });
    $('[data-msg-salvar]', r).addEventListener('click', async () => {
      const body = { id: m.id, titulo: $('#msg-titulo', r).value, texto: texto.value, evento: $('#msg-evento', r).value, ativo: $('#msg-ativo', r).classList.contains('on') };
      const res2 = await api('/os/mensagens', { method: 'POST', body });
      if (!res2.ok) { msg(res2.error); return; }
      msgSel = { ...body, id: res2.id };
      msg('Mensagem salva.');
      deNovo();
    });
    $('[data-msg-exc]', r)?.addEventListener('click', async () => {
      if (!(await confirmar('Excluir mensagem?', m.titulo, { sim: 'Excluir', nao: 'Cancelar', icone: 'lixo' }))) return;
      await api(`/os/mensagens/${m.id}`, { method: 'DELETE' });
      msgSel = null;
      deNovo();
    });
  }

  function montarMensagens(el) {
    if (el) renderMensagens(el);
  }

  /* ================================================================== */
  /* Base de soluções                                                    */
  /* ================================================================== */

  let solBusca = '';
  async function renderSolucoes() {
    const res = await api(`/os/solucoes?q=${encodeURIComponent(solBusca)}`);
    const lista = res.solucoes || [];
    raizEl().innerHTML = `<div class="os">${abasHtml()}<section class="os-grupo"><header>
        <label class="os-filtros" style="flex:1"><span class="os-busca" style="max-width:460px;flex:1">${ic('busca', 'p')}<input class="oc" type="search" id="sol-busca" value="${esc(solBusca)}" placeholder="Buscar defeito, solução ou equipamento…" aria-label="Buscar soluções" /></span></label>
        <span class="os-legenda">Entram sozinhas ao finalizar uma O.S com a solução preenchida</span><button type="button" class="ob sm pri" data-sol-nova>${ic('mais', 'p')}Nova</button></header>
      <div class="corpo"><div class="os-tabela-wrap"><table class="os-tabela"><thead><tr><th>Defeito</th><th>Solução</th><th>Equipamento</th><th class="n">Usada</th><th>Última vez</th><th></th></tr></thead><tbody>
      ${lista.map((s) => `<tr><td style="min-width:200px"><b style="font-weight:600">${esc(s.defeito)}</b>${s.categoria ? `<span class="sub">${esc([s.categoria, s.subcategoria].filter(Boolean).join(' › '))}</span>` : ''}${s.id_os ? `<span class="sub">O.S ${s.id_os}</span>` : ''}</td><td class="os-legenda" style="min-width:240px">${esc(s.solucao)}</td><td>${esc(s.equipamento)}</td>
        <td class="n"><span class="os-chip">${s.usos}×</span></td><td class="os-legenda">${esc(s.data)}</td>
        <td class="n"><button type="button" class="ob ico sm" data-sol-ed="${s.id}" aria-label="Editar">${ic('lapis', 'p')}</button> <button type="button" class="ob ico sm perigo" data-sol-exc="${s.id}" aria-label="Excluir">${ic('lixo', 'p')}</button></td></tr>`).join('')
        || `<tr class="vazia"><td colspan="6">${res.ok ? 'Nenhuma solução gravada ainda.' : esc(res.error)}</td></tr>`}
      </tbody></table></div></div></section></div>`;
    const r = raizEl();
    let timer = 0;
    $('#sol-busca', r).addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(async () => { solBusca = e.target.value; await renderSolucoes(); const b = $('#sol-busca'); b.focus(); b.setSelectionRange(b.value.length, b.value.length); }, 350);
    });
    const editar = async (s) => {
      const cats = await api('/os/categorias?q=');
      const opcoes = (cats.categorias || []).map((c) => `<option value="${c.id_categoria}" ${Number(c.id_categoria) === Number(s?.id_categoria) ? 'selected' : ''}>${esc(c.categoria)}</option>`).join('');
      const salvo = await janela(`<header><div><h2>${s ? 'Editar solução' : 'Nova solução'}</h2></div></header><div class="corpo">
        <div class="os-campo"><label for="se-cat">Categoria</label><select class="oc" id="se-cat"><option value="">Sem categoria</option>${opcoes}</select></div>
        <div class="os-campo"><label for="se-sub">Subcategoria</label><select class="oc" id="se-sub"><option value="">Sem subcategoria</option></select></div>
        <div class="os-campo"><label for="se-def">Defeito</label><textarea class="oc" id="se-def" maxlength="2000">${esc(s?.defeito || '')}</textarea></div>
        <div class="os-campo"><label for="se-sol">Solução</label><textarea class="oc" id="se-sol" maxlength="2000">${esc(s?.solucao || '')}</textarea></div>
        <div class="os-campo"><label for="se-eq">Equipamento</label><input class="oc" id="se-eq" maxlength="300" value="${esc(s?.equipamento || '')}" /></div>
        <div class="os-erro" id="se-erro"></div></div>
        <footer><button type="button" class="ob" data-fechar="">Cancelar</button><button type="button" class="ob pri" id="se-ok">Salvar</button></footer>`, {
        aoAbrir: (dlg, fechar) => {
          const cat = $('#se-cat', dlg);
          const sub = $('#se-sub', dlg);
          const encherSub = async (pai, marcar) => {
            sub.innerHTML = '<option value="">Sem subcategoria</option>';
            if (!pai) return;
            const rs = await api(`/os/categorias?pai=${encodeURIComponent(pai)}&q=`);
            for (const c of rs.categorias || []) {
              const opt = document.createElement('option');
              opt.value = String(c.id_subcategoria);
              opt.textContent = c.subcategoria;
              if (Number(c.id_subcategoria) === Number(marcar)) opt.selected = true;
              sub.appendChild(opt);
            }
          };
          cat.addEventListener('change', () => encherSub(cat.value, 0));
          encherSub(cat.value, s?.id_subcategoria);
          $('#se-ok', dlg).addEventListener('click', async () => {
            const rr = await api('/os/solucoes', { method: 'POST', body: {
              id: s?.id, defeito: $('#se-def', dlg).value, solucao: $('#se-sol', dlg).value, equipamento: $('#se-eq', dlg).value,
              id_categoria: Number(cat.value) || null, id_subcategoria: Number(sub.value) || null,
            } });
            if (!rr.ok) { $('#se-erro', dlg).textContent = rr.error; return; }
            fechar('ok');
          });
        },
      });
      if (salvo) renderSolucoes();
    };
    $('[data-sol-nova]', r).addEventListener('click', () => editar(null));
    $$('[data-sol-ed]', r).forEach((b) => b.addEventListener('click', () => editar(lista.find((x) => x.id === Number(b.dataset.solEd)))));
    $$('[data-sol-exc]', r).forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmar('Excluir solução?', 'Ela deixa de aparecer na lâmpada.', { sim: 'Excluir', nao: 'Cancelar', icone: 'lixo' }))) return;
      await api(`/os/solucoes/${b.dataset.solExc}`, { method: 'DELETE' });
      renderSolucoes();
    }));
  }

  /* ================================================================== */
  /* Status                                                              */
  /* ================================================================== */

  let stSel = null;
  async function renderStatus() {
    const res = await api('/os/status');
    if (!res.ok) { raizEl().innerHTML = `<div class="os">${abasHtml()}<p class="os-vazio">${esc(res.error)}</p></div>`; return; }
    st.statuses = res.statuses;
    const lista = res.statuses;
    if (!stSel || (stSel.id && !lista.some((s) => s.id === stSel.id))) stSel = { id: 0, descricao: '', icone: 'relogio', cor: res.cores[7] || res.cores[0], ativo: true, final: false };
    const s = stSel;
    raizEl().innerHTML = `<div class="os">${abasHtml()}<div class="os-cad" style="grid-template-columns:minmax(0,1fr) 380px">
      <section class="os-grupo"><header><h2>Colunas do quadro</h2><span class="os-legenda">use as setas para mudar a ordem</span><span class="os-esp"></span><button type="button" class="ob sm pri" data-st-novo>${ic('mais', 'p')}Novo status</button></header>
        <div class="corpo" style="gap:0">${lista.map((x, i) => `<div class="os-linha" style="--h:${esc(x.cor)};padding:9px 4px;border-bottom:1px solid var(--os-sep)">
          <span style="display:flex;flex-direction:column"><button type="button" class="ob ico sm" style="min-height:18px;height:18px;width:24px" data-st-sobe="${i}" ${i ? '' : 'disabled'} aria-label="Subir">${ic('cima', 'p')}</button><button type="button" class="ob ico sm" style="min-height:18px;height:18px;width:24px" data-st-desce="${i}" ${i < lista.length - 1 ? '' : 'disabled'} aria-label="Descer">${ic('baixo', 'p')}</button></span>
          <span class="os-legenda" style="width:16px">${i + 1}</span><span class="os-icost">${ic(x.icone)}</span>
          <button type="button" class="os-item-lista${x.id === s.id ? ' on' : ''}" style="flex:1;padding:6px 8px" data-st-ed="${x.id}"><b>${esc(x.descricao)}</b>${x.final ? ' <span class="os-chip" style="margin-left:6px">Status final</span>' : ''}${x.ativo ? '' : ' <span class="os-legenda">· inativo</span>'}</button>
        </div>`).join('')}</div></section>
      <section class="os-grupo"><header><h2>${s.id ? 'Editar status' : 'Novo status'}</h2></header><div class="corpo">
        <div class="os-campo"><label for="st-desc">Descrição</label><input class="oc" id="st-desc" maxlength="60" value="${esc(s.descricao)}" /></div>
        <div class="os-campo"><span>Ícone</span><div class="os-icones" style="--h:${esc(s.cor)}">${res.icones.map((n) => `<button type="button" data-ico="${n}" class="${n === s.icone ? 'on' : ''}" aria-label="${n}" aria-pressed="${n === s.icone}">${ic(n)}</button>`).join('')}</div></div>
        <div class="os-campo"><span>Cor</span><div class="os-cores">${res.cores.map((c) => `<button type="button" data-cor="${c}" style="--c:${c}" class="${c === s.cor ? 'on' : ''}" aria-label="Cor ${c}" aria-pressed="${c === s.cor}"></button>`).join('')}</div></div>
        <div class="os-campo"><span>Prévia</span><div id="st-previa">${pillHtml({ ...s, descricao: s.descricao || 'Novo status' })}</div></div>
        <label class="os-linha os-legenda"><button type="button" class="os-chave${s.ativo ? ' on' : ''}" id="st-ativo" aria-label="Ativo"></button>Ativo (aparece como coluna no quadro)</label>
        <label class="os-linha os-legenda"><button type="button" class="os-chave${s.final ? ' on' : ''}" id="st-final" aria-label="Status final"></button>Status final (O.S concluída: grava a entrega e a solução)</label>
        <div class="os-linha"><span class="os-esp"></span>${s.id ? '<button type="button" class="ob" data-st-cancela>Novo</button>' : ''}<button type="button" class="ob pri" data-st-salvar>Salvar</button></div>
      </div></section></div></div>`;
    const r = raizEl();
    const previa = () => { $('#st-previa', r).innerHTML = pillHtml({ ...stSel, descricao: $('#st-desc', r).value || 'Novo status' }); };
    $('#st-desc', r).addEventListener('input', previa);
    $$('[data-ico]', r).forEach((b) => b.addEventListener('click', () => { stSel.icone = b.dataset.ico; $$('[data-ico]', r).forEach((x) => x.classList.toggle('on', x === b)); previa(); }));
    $$('[data-cor]', r).forEach((b) => b.addEventListener('click', () => { stSel.cor = b.dataset.cor; $$('[data-cor]', r).forEach((x) => x.classList.toggle('on', x === b)); $('.os-icones', r).style.setProperty('--h', stSel.cor); previa(); }));
    $('#st-ativo', r).addEventListener('click', (e) => { e.preventDefault(); stSel.ativo = !stSel.ativo; e.currentTarget.classList.toggle('on', stSel.ativo); });
    $('#st-final', r).addEventListener('click', (e) => { e.preventDefault(); stSel.final = !stSel.final; e.currentTarget.classList.toggle('on', stSel.final); });
    $('[data-st-novo]', r).addEventListener('click', () => { stSel = null; renderStatus(); });
    $('[data-st-cancela]', r)?.addEventListener('click', () => { stSel = null; renderStatus(); });
    $$('[data-st-ed]', r).forEach((b) => b.addEventListener('click', () => { stSel = { ...lista.find((x) => x.id === Number(b.dataset.stEd)) }; renderStatus(); }));
    const mover = async (i, j) => {
      const ids = lista.map((x) => x.id);
      [ids[i], ids[j]] = [ids[j], ids[i]];
      await api('/os/status/ordem', { method: 'POST', body: { ids } });
      renderStatus();
    };
    $$('[data-st-sobe]', r).forEach((b) => b.addEventListener('click', () => mover(Number(b.dataset.stSobe), Number(b.dataset.stSobe) - 1)));
    $$('[data-st-desce]', r).forEach((b) => b.addEventListener('click', () => mover(Number(b.dataset.stDesce), Number(b.dataset.stDesce) + 1)));
    $('[data-st-salvar]', r).addEventListener('click', async () => {
      const rr = await api('/os/status', { method: 'POST', body: { ...stSel, descricao: $('#st-desc', r).value } });
      if (!rr.ok) { msg(rr.error); return; }
      stSel = { ...rr.statuses.find((x) => x.id === rr.id) };
      msg('Status salvo.');
      renderStatus();
    });
  }

  /* ================================================================== */
  /* Técnicos e gerentes                                                 */
  /* ================================================================== */

  async function renderTecnicos() {
    const res = await api('/os/funcionarios');
    const sup = !!usuario()?.supervisor;
    const lista = res.funcionarios || [];
    raizEl().innerHTML = `<div class="os">${abasHtml()}<section class="os-grupo"><header><h2>Técnicos e gerentes</h2><span class="os-esp"></span>
        <span class="os-legenda">${sup ? 'Técnico vem da função Técnico no cadastro de funcionários. Gerente libera desconto acima do limite com a senha dele no Gestor.' : 'Técnico vem do cadastro de funcionários. Só o supervisor marca gerente.'}</span></header>
      <div class="corpo"><div class="os-tabela-wrap"><table class="os-tabela"><thead><tr><th>Funcionário</th><th>Celular ou WhatsApp</th><th class="n">Técnico</th><th class="n">Gerente</th></tr></thead><tbody>
      ${lista.map((f) => `<tr><td><span class="os-linha"><span class="os-av" style="cursor:default">${esc(f.iniciais)}</span>${esc(f.nome)}</span></td>
        <td>${f.celular ? esc(fmtFone(f.celular)) : '<span class="os-legenda" style="color:var(--warn)">sem celular ou WhatsApp no cadastro</span>'}</td>
        <td class="n"><button type="button" class="os-chave${f.tecnico ? ' on' : ''}" disabled title="Função Técnico no cadastro de funcionários" aria-label="Técnico ${esc(f.nome)}" aria-pressed="${f.tecnico}"></button></td>
        <td class="n"><button type="button" class="os-chave${f.gerente ? ' on' : ''}" data-func="${f.id}" data-campo="gerente" ${sup ? '' : 'disabled'} aria-label="Gerente ${esc(f.nome)}" aria-pressed="${f.gerente}"></button></td></tr>`).join('')
        || `<tr class="vazia"><td colspan="4">${res.ok ? 'Nenhum funcionário ativo.' : esc(res.error)}</td></tr>`}
      </tbody></table></div></div></section></div>`;
    $$('[data-func]', raizEl()).forEach((b) => b.addEventListener('click', async () => {
      const f = lista.find((x) => x.id === Number(b.dataset.func));
      const body = { tecnico: f.tecnico, gerente: f.gerente, [b.dataset.campo]: !f[b.dataset.campo] };
      const rr = await api(`/os/funcionarios/${f.id}`, { method: 'POST', body });
      if (!rr.ok) { msg(rr.error); return; }
      renderTecnicos();
    }));
  }

  /* ================================================================== */
  /* Limites de desconto em Preferências > Saída                         */
  /* ================================================================== */

  async function montarConfigSaida() {
    const aba = $('#cfg-tab-saida');
    if (!aba || !deps.servicosAtivo?.()) { $('#os-cfg-limites')?.remove(); return; }
    const res = await api('/os/config');
    if (!res.ok) return;
    let box = $('#os-cfg-limites');
    if (!box) {
      box = document.createElement('section');
      box.id = 'os-cfg-limites';
      box.className = 'os os-cfg-limites';
      aba.appendChild(box);
    }
    const sup = !!usuario()?.supervisor;
    const lim = res.limites;
    box.innerHTML = `<div class="os-grupo"><header><h2>Ordem de Serviço — descontos</h2><span class="os-esp"></span><span class="os-legenda">Em branco: sem limite</span></header><div class="corpo">
      <div class="os-g2">
        <div class="os-campo"><label for="os-lim-item">Exigir senha de supervisor/gerente para desconto em produto/serviço acima de (%)</label><input class="oc num" id="os-lim-item" inputmode="decimal" value="${lim.item ? esc(String(lim.item).replace('.', ',')) : ''}" ${sup ? '' : 'disabled'} /></div>
        <div class="os-campo"><label for="os-lim-geral">Exigir senha de supervisor/gerente para desconto geral acima de (%)</label><input class="oc num" id="os-lim-geral" inputmode="decimal" value="${lim.geral ? esc(String(lim.geral).replace('.', ',')) : ''}" ${sup ? '' : 'disabled'} /></div>
      </div>
      <div class="os-linha"><span class="os-legenda">${sup ? 'O percentual é sobre o valor do item ou sobre o total da O.S.' : 'Só o supervisor altera.'}</span><span class="os-esp"></span>${sup ? '<button type="button" class="ob pri" id="os-lim-salvar">Salvar limites</button>' : ''}</div>
    </div></div>`;
    $('#os-lim-salvar', box)?.addEventListener('click', async () => {
      const rr = await api('/os/config', { method: 'POST', body: { item: numTela($('#os-lim-item', box).value), geral: numTela($('#os-lim-geral', box).value) } });
      if (!rr.ok) { msg(rr.error); return; }
      st.limites = rr.limites;
      msg('Limites de desconto da O.S salvos.');
    });
    await montarImpressorasApp(box);
  }

  /** Só no app desktop: em qual impressora sai cada formato. Fica gravado no computador. */
  async function montarImpressorasApp(box) {
    const nat = appNativo();
    if (!nat || typeof nat.impressoras !== 'function') return;
    let r;
    try { r = await nat.impressoras(); } catch { return; }
    if (!r || !r.ok) return;
    const opc = (atual) => `<option value="">Perguntar na hora</option>${(r.lista || []).map((n) => `<option value="${esc(n)}" ${n === atual ? 'selected' : ''}>${esc(n)}</option>`).join('')}`;
    const esc80 = r.escolhidas || {};
    box.insertAdjacentHTML('beforeend', `<div class="os-grupo" id="os-cfg-impressoras"><header><h2>Impressoras deste computador</h2><span class="os-esp"></span><span class="os-legenda">Aplicativo desktop</span></header><div class="corpo">
      <div class="os-g2">
        <div class="os-campo"><label for="os-imp-a4">A4 e meia folha</label><select class="oc" id="os-imp-a4">${opc(esc80.a4)}</select></div>
        <div class="os-campo"><label for="os-imp-80">80 mm (térmica)</label><select class="oc" id="os-imp-80">${opc(esc80.termica)}</select></div>
      </div>
      <div class="os-linha"><span class="os-legenda">A de 80 mm recebe o texto direto (ESC/POS), sem margem nem diálogo.</span><span class="os-esp"></span><button type="button" class="ob" id="os-imp-teste">Imprimir teste</button><button type="button" class="ob pri" id="os-imp-salvar">Salvar impressoras</button></div>
    </div></div>`);
    const lerEscolha = () => ({ a4: $('#os-imp-a4', box).value, termica: $('#os-imp-80', box).value });
    $('#os-imp-salvar', box).addEventListener('click', async () => {
      const rr = await nat.salvar_impressoras(lerEscolha());
      msg(rr && rr.ok ? 'Impressoras salvas neste computador.' : (rr?.error || 'Não foi possível salvar.'));
    });
    $('#os-imp-teste', box).addEventListener('click', async () => {
      const rr = await nat.imprimir_teste(lerEscolha());
      msg(rr && rr.ok ? 'Teste enviado para a impressora.' : (rr?.error || 'Não foi possível imprimir o teste.'));
    });
  }

  /* ================================================================== */
  /* Navegação                                                           */
  /* ================================================================== */

  async function atualizarAcessoTecnicos() {
    const u = usuario();
    if (u?.supervisor) { st.podeTecnicos = true; return; }
    const res = await api('/os/funcionarios');
    const eu = (res.funcionarios || []).find((f) => Number(f.id) === Number(u?.id));
    st.podeTecnicos = !!eu?.gerente;
  }

  function irPara(view) {
    if (view === 'mensagens') view = 'quadro';
    if (view === 'tecnicos' && !st.podeTecnicos) {
      msg('A aba Técnicos é só para o supervisor ou o gerente.');
      view = 'quadro';
    }
    st.view = view;
    if (view === 'quadro') return carregarQuadro();
    if (view === 'solucoes') return renderSolucoes();
    if (view === 'status') return renderStatus();
    if (view === 'tecnicos') return renderTecnicos();
    return undefined;
  }

  function onPageEnter() {
    const r = raizEl();
    if (!r) return;
    atualizarAcessoTecnicos().finally(() => {
      if (st.view === 'os' && st.os) { renderOs(); return; }
      irPara(st.view === 'os' ? 'quadro' : st.view);
    });
  }

  function init(options) {
    deps = options || {};
    const r = raizEl();
    if (!r || r.dataset.ligado) return;
    r.dataset.ligado = '1';
    r.addEventListener('click', async (e) => {
      const v = e.target.closest('[data-os-view]');
      if (v) {
        if (st.view === 'os' && st.sujo && !(await confirmar('Sair sem gravar?', 'As alterações desta O.S ainda não foram gravadas.', { sim: 'Sair', nao: 'Continuar aqui' }))) return;
        irPara(v.dataset.osView);
        return;
      }
      if (e.target.closest('[data-os-nova]')) abrirOs(0);
      if (e.target.closest('[data-os-app]')) abrirAppDesktop();
    });
    window.addEventListener('beforeunload', (e) => {
      if (st.view === 'os' && st.sujo && !$('#page-servicos')?.hidden) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  /** Botão Voltar do Android: fecha janela/menu, volta da O.S para o quadro. */
  function handleBack() {
    if ($('#page-servicos')?.hidden !== false) return false;
    const abertas = $$('dialog.os-dlg[open]');
    if (abertas.length) {
      abertas[abertas.length - 1].close();
      return true;
    }
    const menu = $('.os-menu');
    if (menu) {
      menu.remove();
      return true;
    }
    if (st.view === 'os') {
      (async () => {
        if (st.sujo && !(await confirmar('Sair sem gravar?', 'As alterações desta O.S ainda não foram gravadas.', { sim: 'Sair', nao: 'Continuar aqui' }))) return;
        st.sujo = false;
        irPara('quadro');
      })();
      return true;
    }
    if (st.view !== 'quadro') {
      irPara('quadro');
      return true;
    }
    return false;
  }

  return { init, onPageEnter, montarConfigSaida, handleBack, montarMensagens };
})();

window.Servicos = Servicos;
