'use strict';
/**
 * Protótipo — Importação NF-e com conferência por item (tudo na tela do item).
 * Módulo isolado para migração futura ao replicador (sessões JSON + API REST).
 */
const ImportacaoNfe = (() => {
  /** Desativar consulta/gravação até integração SEFAZ estar pronta. */
  const EM_DESENVOLVIMENTO = true;

  const state = {
    sessao: null,
    itemIndex: 0,
    view: 'inicio', // inicio | sessao | item | financeiro
    buscaProduto: '',
  };

  let deps = {};

  function $(sel, el = document) { return el.querySelector(sel); }
  function $$(sel, el = document) { return [...el.querySelectorAll(sel)]; }

  async function api(path, options = {}) {
    return deps.api(path, options);
  }

  function esc(s) {
    return deps.escapeHtml ? deps.escapeHtml(s) : String(s ?? '');
  }
  function money(n) { return deps.fmtMoney ? deps.fmtMoney(n) : String(n); }
  function num(n) { return deps.fmtNum ? deps.fmtNum(n) : String(n); }

  function itemAt(idx) {
    return state.sessao?.itens?.[idx] || null;
  }

  function statusLabel(st) {
    if (st === 'conferido') return ['Conferido', 'ok'];
    if (st === 'vinculado') return ['Vinculado', 'warn'];
    return ['Pendente', 'pending'];
  }

  function showView(name) {
    state.view = name;
    $('#imp-view-inicio').hidden = name !== 'inicio';
    $('#imp-view-sessao').hidden = name !== 'sessao';
    $('#imp-view-item').hidden = name !== 'item';
    $('#imp-view-financeiro').hidden = name !== 'financeiro';
    deps.scrollAppTop?.();
  }

  async function loadSessoesEmAndamento() {
    const res = await api('/importacao/sessoes');
    const box = $('#imp-sessoes-lista');
    if (!box) return;
    const list = res.sessoes || [];
    if (!list.length) {
      box.innerHTML = '<p class="empty">Nenhuma importação em andamento</p>';
      return;
    }
    box.innerHTML = list.map((s) => `
      <button type="button" class="imp-sessao-row" data-id="${esc(s.id)}">
        <div>
          <strong>NF ${esc(s.xml?.ide?.nNF || '—')} · ${esc(s.xml?.emit?.xFant || s.xml?.emit?.xNome || '')}</strong>
          <span class="hint">${esc(s.chave)}</span>
        </div>
        <div class="imp-sessao-meta">
          <span class="chip">${s.resumo?.conferidos || 0}/${s.resumo?.total || 0} conferidos</span>
          <span class="chip warn">${s.resumo?.pendentes || 0} pend.</span>
        </div>
      </button>
    `).join('');
    $$('.imp-sessao-row', box).forEach((btn) => {
      btn.addEventListener('click', () => openSessao(btn.dataset.id));
    });
  }

  async function openSessao(id) {
    const res = await api(`/importacao/sessoes/${id}`);
    if (!res.ok) {
      deps.showMsg?.(res.error || 'Erro ao abrir sessão');
      return;
    }
    state.sessao = res.sessao;
    state.itemIndex = 0;
    renderSessao();
    showView('sessao');
  }

  function renderSessaoHeader() {
    const s = state.sessao;
    if (!s) return;
    const el = $('#imp-sessao-resumo');
    if (!el) return;
    el.innerHTML = `
      <div class="imp-nf-card">
        <div class="imp-nf-head">
          <div>
            <h3>NF-e ${esc(s.xml?.ide?.nNF || '—')} · Série ${esc(s.xml?.ide?.serie || '—')}</h3>
            <p class="hint">${esc(s.xml?.emit?.xNome || '')}</p>
            <p class="hint mono">${esc(s.chave)}</p>
          </div>
          <div class="imp-nf-totais">
            <strong>${money(s.xml?.total?.vNF)}</strong>
            <span class="hint">${s.resumo?.conferidos || 0} de ${s.resumo?.total || 0} itens conferidos</span>
          </div>
        </div>
        <div class="imp-progress">
          <div class="imp-progress-bar" style="width:${s.resumo?.total ? Math.round((s.resumo.conferidos / s.resumo.total) * 100) : 0}%"></div>
        </div>
      </div>
    `;
  }

  function renderItensLista() {
    const s = state.sessao;
    const box = $('#imp-itens-lista');
    if (!box || !s) return;
    box.innerHTML = s.itens.map((it, idx) => {
      const [lbl, cls] = statusLabel(it.status);
      return `
        <button type="button" class="imp-item-row ${cls}" data-idx="${idx}">
          <span class="imp-item-num">${it.nItem}</span>
          <div class="imp-item-main">
            <strong>${esc(it.xml?.xProd || it.sistema?.descricao)}</strong>
            <span class="hint">${esc(it.xml?.cProd || '')} · EAN ${esc(it.xml?.cEAN || '—')} · ${num(it.xml?.qCom)} ${esc(it.xml?.uCom || '')}</span>
          </div>
          <span class="imp-status ${cls}">${lbl}</span>
        </button>
      `;
    }).join('');
    $$('.imp-item-row', box).forEach((btn) => {
      btn.addEventListener('click', () => openItem(Number(btn.dataset.idx)));
    });
  }

  function renderSessao() {
    renderSessaoHeader();
    renderItensLista();
    const btn = $('#imp-btn-confirmar');
    if (btn) {
      const ok = state.sessao?.resumo?.pendentes === 0
        && state.sessao?.resumo?.conferidos === state.sessao?.resumo?.total;
      btn.disabled = !ok;
    }
  }

  function openItem(idx) {
    state.itemIndex = idx;
    renderItemScreen();
    showView('item');
  }

  function field(label, id, value, opts = {}) {
    const type = opts.type || 'text';
    const ro = opts.readonly ? 'readonly' : '';
    const step = opts.step ? ` step="${opts.step}"` : '';
    const cls = opts.half ? 'imp-field half' : 'imp-field';
    return `
      <label class="${cls}">
        <span>${esc(label)}</span>
        <input id="${id}" type="${type}" value="${esc(value)}" ${ro}${step} />
      </label>
    `;
  }

  function tribRow(label, xmlVal, sysId, sysVal, opts = {}) {
    return `
      <div class="imp-trib-row">
        <span class="imp-trib-lbl">${esc(label)}</span>
        <span class="imp-trib-xml">${esc(xmlVal ?? '—')}</span>
        <input class="imp-trib-sys" id="${sysId}" type="${opts.type || 'text'}" value="${esc(sysVal ?? '')}" ${opts.readonly ? 'readonly' : ''} />
      </div>
    `;
  }

  function renderItemScreen() {
    const it = itemAt(state.itemIndex);
    const host = $('#imp-item-host');
    if (!it || !host) return;
    const s = state.sessao;
    const sys = it.sistema || {};
    const xml = it.xml || {};
    const imp = xml.imposto || {};
    const trib = sys.tributos || {};
    const match = it.match;
    const total = s?.itens?.length || 0;
    const [stLbl, stCls] = statusLabel(it.status);

    host.innerHTML = `
      <div class="imp-item-toolbar">
        <button type="button" class="btn" id="imp-item-voltar">← Itens</button>
        <div class="imp-item-nav">
          <button type="button" class="btn small" id="imp-item-prev" ${state.itemIndex <= 0 ? 'disabled' : ''}>‹</button>
          <span>Item ${it.nItem} / ${total}</span>
          <button type="button" class="btn small" id="imp-item-next" ${state.itemIndex >= total - 1 ? 'disabled' : ''}>›</button>
        </div>
        <span class="imp-status ${stCls}">${stLbl}</span>
      </div>

      <div class="imp-item-scroll">
        <!-- VINCULAÇÃO -->
        <section class="imp-section">
          <header class="imp-section-head">
            <h4>Vinculação do produto</h4>
            <span class="hint">XML → Estoque</span>
          </header>
          <div class="imp-xml-strip">
            <div><span class="hint">Fornecedor</span><strong>${esc(xml.cProd)}</strong></div>
            <div><span class="hint">EAN</span><strong>${esc(xml.cEAN || '—')}</strong></div>
            <div class="full"><span class="hint">Descrição XML</span><strong>${esc(xml.xProd)}</strong></div>
          </div>
          ${match ? `
            <div class="imp-match ok">
              <strong>Sugestão (${esc(match.origem_match || 'auto')}) · ${match.confianca || 0}%</strong>
              <span>ID ${esc(match.id_identificador)} · ${esc(match.descricao)}</span>
            </div>
          ` : `
            <div class="imp-match warn">
              <strong>Sem correspondência automática</strong>
              <span>Busque ou crie um produto</span>
            </div>
          `}
          <div class="imp-vinc-acoes">
            <div class="search-field imp-busca-prod">
              <input id="imp-busca-prod" type="search" placeholder="Buscar por EAN, ID ou descrição…" value="${esc(state.buscaProduto)}" />
            </div>
            <div id="imp-prod-resultados" class="imp-prod-list"></div>
            <div class="imp-vinc-btns">
              <button type="button" class="btn small" id="imp-usar-sugestao" ${match ? '' : 'hidden'}>Usar sugestão</button>
              <button type="button" class="btn small outline" id="imp-criar-novo">Criar como novo</button>
              <button type="button" class="btn small outline" id="imp-limpar-vinc">Limpar vínculo</button>
            </div>
            <div class="imp-vinc-atual" id="imp-vinc-atual">
              ${sys.id_identificador
    ? `<span class="chip ok">Vinculado: ID ${esc(sys.id_identificador)} · ${esc(sys.descricao)}</span>`
    : sys.criar_novo
      ? '<span class="chip warn">Será criado como novo produto</span>'
      : '<span class="chip pending">Não vinculado</span>'}
            </div>
          </div>
        </section>

        <!-- COMERCIAL -->
        <section class="imp-section">
          <header class="imp-section-head">
            <h4>Comercial</h4>
            <span class="hint">Quantidades e preços</span>
          </header>
          <div class="imp-fields">
            ${field('Descrição (sistema)', 'imp-desc', sys.descricao)}
            ${field('Unidade', 'imp-uni', sys.uni_medida, { half: true })}
            ${field('Quantidade', 'imp-qtd', sys.qtd, { type: 'number', step: '0.0001', half: true })}
            ${field('Preço custo (unit.)', 'imp-custo', sys.prc_custo, { type: 'number', step: '0.0001', half: true })}
            ${field('Preço venda (unit.)', 'imp-venda', sys.prc_venda, { type: 'number', step: '0.0001', half: true })}
            ${field('Desconto (item)', 'imp-desc-val', sys.v_desc, { type: 'number', step: '0.01', half: true })}
            ${field('Frete rateado', 'imp-frete', sys.v_frete, { type: 'number', step: '0.01', half: true })}
            ${field('Outras despesas', 'imp-outro', sys.v_outro, { type: 'number', step: '0.01', half: true })}
          </div>
        </section>

        <!-- TRIBUTOS -->
        <section class="imp-section">
          <header class="imp-section-head">
            <h4>Tributação</h4>
            <span class="hint">Original XML × Valor no sistema</span>
          </header>
          <div class="imp-trib-head">
            <span></span><span>XML</span><span>Sistema</span>
          </div>
          ${tribRow('NCM', xml.NCM, 'imp-ncm', sys.ncm)}
          ${tribRow('CFOP', xml.CFOP, 'imp-cfop', sys.cfop)}
          ${tribRow('Origem', imp.orig, 'imp-orig', trib.origem)}
          ${tribRow('CST ICMS', imp.CST, 'imp-cst', trib.cst_icms)}
          ${tribRow('CSOSN', imp.CSOSN || '—', 'imp-csosn', trib.csosn)}
          ${tribRow('Base ICMS', imp.vBC, 'imp-vbc', trib.v_bc_icms, { type: 'number' })}
          ${tribRow('% ICMS', imp.pICMS, 'imp-picms', trib.p_icms, { type: 'number' })}
          ${tribRow('Vlr ICMS', imp.vICMS, 'imp-vicms', trib.v_icms, { type: 'number' })}
          ${tribRow('Base ST', imp.vBCST, 'imp-vbcst', trib.v_bc_st, { type: 'number' })}
          ${tribRow('Vlr ST', imp.vICMSST, 'imp-vst', trib.v_icms_st, { type: 'number' })}
          ${tribRow('CST IPI', imp.CST_IPI, 'imp-cst-ipi', trib.cst_ipi)}
          ${tribRow('Vlr IPI', imp.vIPI, 'imp-vipi', trib.v_ipi, { type: 'number' })}
          ${tribRow('CST PIS', imp.CST_PIS, 'imp-cst-pis', trib.cst_pis)}
          ${tribRow('Vlr PIS', imp.vPIS, 'imp-vpis', trib.v_pis, { type: 'number' })}
          ${tribRow('CST COFINS', imp.CST_COFINS, 'imp-cst-cof', trib.cst_cofins)}
          ${tribRow('Vlr COFINS', imp.vCOFINS, 'imp-vcof', trib.v_cofins, { type: 'number' })}
        </section>

        <!-- OBS -->
        <section class="imp-section">
          <label class="imp-field full">
            <span>Observação do item</span>
            <input id="imp-obs" type="text" value="${esc(it.observacao || '')}" placeholder="Opcional" />
          </label>
        </section>
      </div>

      <div class="imp-item-footer">
        <button type="button" class="btn outline" id="imp-salvar-item">Salvar item</button>
        <label class="imp-check">
          <input type="checkbox" id="imp-conferido" ${it.conferido ? 'checked' : ''} />
          Item conferido
        </label>
        <button type="button" class="btn primary" id="imp-salvar-proximo">
          ${state.itemIndex < total - 1 ? 'Salvar e próximo →' : 'Salvar e voltar'}
        </button>
      </div>
    `;

    bindItemEvents(it);
    loadProdutosBusca(state.buscaProduto);
  }

  async function loadProdutosBusca(q) {
    const box = $('#imp-prod-resultados');
    if (!box) return;
    const res = await api(`/importacao/produtos?q=${encodeURIComponent(q || '')}`);
    const list = res.itens || [];
    if (!list.length) {
      box.innerHTML = '<p class="hint">Nenhum produto encontrado</p>';
      return;
    }
    box.innerHTML = list.map((p) => `
      <button type="button" class="imp-prod-opt" data-id="${p.id_identificador}" data-desc="${esc(p.descricao)}" data-ean="${esc(p.cod_barras)}">
        <strong>ID ${p.id_identificador}</strong>
        <span>${esc(p.descricao)}</span>
        <span class="hint">EAN ${esc(p.cod_barras || '—')}</span>
      </button>
    `).join('');
    $$('.imp-prod-opt', box).forEach((btn) => {
      btn.addEventListener('click', () => {
        applyVinculo({
          id_identificador: Number(btn.dataset.id),
          descricao: btn.dataset.desc,
          cod_barras: btn.dataset.ean,
          criar_novo: false,
        });
      });
    });
  }

  function applyVinculo(patch) {
    const it = itemAt(state.itemIndex);
    if (!it) return;
    it.sistema = { ...it.sistema, ...patch };
    if (patch.id_identificador) {
      it.match = {
        id_identificador: patch.id_identificador,
        descricao: patch.descricao,
        cod_barras: patch.cod_barras,
        origem_match: 'manual',
        confianca: 100,
      };
      it.sistema.criar_novo = false;
    }
    renderItemScreen();
  }

  function collectItemPatch() {
    const g = (id) => $(id)?.value;
    const gn = (id) => Number(g(id) || 0);
    return {
      sistema: {
        descricao: g('#imp-desc'),
        uni_medida: g('#imp-uni'),
        qtd: gn('#imp-qtd'),
        prc_custo: gn('#imp-custo'),
        prc_venda: gn('#imp-venda'),
        v_desc: gn('#imp-desc-val'),
        v_frete: gn('#imp-frete'),
        v_outro: gn('#imp-outro'),
        ncm: g('#imp-ncm'),
        cfop: g('#imp-cfop'),
        tributos: {
          origem: g('#imp-orig'),
          cst_icms: g('#imp-cst'),
          csosn: g('#imp-csosn'),
          v_bc_icms: gn('#imp-vbc'),
          p_icms: gn('#imp-picms'),
          v_icms: gn('#imp-vicms'),
          v_bc_st: gn('#imp-vbcst'),
          v_icms_st: gn('#imp-vst'),
          cst_ipi: g('#imp-cst-ipi'),
          v_ipi: gn('#imp-vipi'),
          cst_pis: g('#imp-cst-pis'),
          v_pis: gn('#imp-vpis'),
          cst_cofins: g('#imp-cst-cof'),
          v_cofins: gn('#imp-vcof'),
        },
      },
      conferido: !!$('#imp-conferido')?.checked,
      observacao: g('#imp-obs') || '',
    };
  }

  async function saveItem(opts = {}) {
    const it = itemAt(state.itemIndex);
    const s = state.sessao;
    if (!it || !s) return false;
    const patch = collectItemPatch();
    const res = await api(`/importacao/sessoes/${s.id}/itens/${it.nItem}`, {
      method: 'PUT',
      body: patch,
    });
    if (!res.ok) {
      deps.showMsg?.(res.error || 'Erro ao salvar item');
      return false;
    }
    state.sessao = res.sessao;
    deps.showToast?.('Item salvo');
    if (opts.next && state.itemIndex < (state.sessao.itens.length - 1)) {
      openItem(state.itemIndex + 1);
    } else if (opts.back) {
      renderSessao();
      showView('sessao');
    }
    return true;
  }

  function bindItemEvents(it) {
    $('#imp-item-voltar')?.addEventListener('click', () => {
      renderSessao();
      showView('sessao');
    });
    $('#imp-item-prev')?.addEventListener('click', () => openItem(state.itemIndex - 1));
    $('#imp-item-next')?.addEventListener('click', () => openItem(state.itemIndex + 1));
    $('#imp-salvar-item')?.addEventListener('click', () => saveItem());
    $('#imp-salvar-proximo')?.addEventListener('click', async () => {
      const next = state.itemIndex < (state.sessao?.itens?.length || 0) - 1;
      await saveItem({ next, back: !next });
    });
    $('#imp-usar-sugestao')?.addEventListener('click', () => {
      if (!it.match) return;
      applyVinculo({
        id_identificador: it.match.id_identificador,
        descricao: it.match.descricao,
        cod_barras: it.match.cod_barras || '',
        criar_novo: false,
      });
    });
    $('#imp-criar-novo')?.addEventListener('click', () => {
      applyVinculo({
        id_identificador: null,
        criar_novo: true,
        descricao: it.xml?.xProd || '',
        cod_barras: it.xml?.cEAN || '',
        cod_fornecedor: it.xml?.cProd || '',
      });
    });
    $('#imp-limpar-vinc')?.addEventListener('click', () => {
      const item = itemAt(state.itemIndex);
      if (!item) return;
      item.match = null;
      item.sistema.id_identificador = null;
      item.sistema.criar_novo = false;
      renderItemScreen();
    });
    let buscaTimer;
    $('#imp-busca-prod')?.addEventListener('input', (e) => {
      state.buscaProduto = e.target.value;
      clearTimeout(buscaTimer);
      buscaTimer = setTimeout(() => loadProdutosBusca(state.buscaProduto), 280);
    });
  }

  function renderFinanceiro() {
    const s = state.sessao;
    const host = $('#imp-fin-host');
    if (!s || !host) return;
    const fin = s.financeiro || {};
    const parc = fin.parcelas || [];
    host.innerHTML = `
      <div class="imp-item-toolbar">
        <button type="button" class="btn" id="imp-fin-voltar">← Itens da NF-e</button>
        <strong>Financeiro da entrada</strong>
      </div>
      <div class="imp-section">
        <div class="imp-fields">
          ${field('Valor total NF', 'imp-vnf', s.xml?.total?.vNF, { type: 'number', step: '0.01', half: true, readonly: true })}
          ${field('Valor produtos', 'imp-vprod', s.xml?.total?.vProd, { type: 'number', step: '0.01', half: true, readonly: true })}
          ${field('Frete', 'imp-vfrete-tot', s.xml?.total?.vFrete, { type: 'number', step: '0.01', half: true, readonly: true })}
          ${field('Forma pagamento', 'imp-fmpag', fin.forma_pagto || 'Duplicata', { half: true })}
          ${field('Fatura', 'imp-nfat', fin.nFat || '', { half: true })}
        </div>
        <h4 class="imp-sub">Parcelas</h4>
        <div id="imp-parcelas">${parc.map((p, i) => `
          <div class="imp-parc-row" data-i="${i}">
            ${field(`Parcela ${p.nDup || i + 1}`, `imp-parc-v-${i}`, p.vDup, { type: 'number', step: '0.01', half: true })}
            ${field('Vencimento', `imp-parc-d-${i}`, String(p.dVenc || '').slice(0, 10), { type: 'date', half: true })}
          </div>
        `).join('')}</div>
        <div class="imp-item-footer">
          <button type="button" class="btn primary" id="imp-fin-salvar">Salvar financeiro</button>
        </div>
      </div>
    `;
    $('#imp-fin-voltar')?.addEventListener('click', () => {
      renderSessao();
      showView('sessao');
    });
    $('#imp-fin-salvar')?.addEventListener('click', async () => {
      const parcelas = parc.map((p, i) => ({
        ...p,
        vDup: Number($(`#imp-parc-v-${i}`)?.value || 0),
        dVenc: $(`#imp-parc-d-${i}`)?.value || p.dVenc,
      }));
      const res = await api(`/importacao/sessoes/${s.id}/financeiro`, {
        method: 'PUT',
        body: {
          forma_pagto: $('#imp-fmpag')?.value,
          nFat: $('#imp-nfat')?.value,
          parcelas,
        },
      });
      if (res.ok) {
        state.sessao = res.sessao;
        deps.showToast?.('Financeiro salvo');
        renderSessao();
        showView('sessao');
      } else deps.showMsg?.(res.error);
    });
  }

  function applyDevLock() {
    const page = $('#page-importacao');
    if (!page) return;
    page.classList.toggle('imp-dev-locked', EM_DESENVOLVIMENTO);
    const lockIds = [
      '#imp-chave', '#imp-btn-consultar', '#imp-btn-scan-chave', '#imp-btn-demo',
      '#imp-btn-financeiro', '#imp-btn-confirmar', '#imp-voltar-inicio',
    ];
    lockIds.forEach((sel) => {
      const el = $(sel);
      if (el) el.disabled = EM_DESENVOLVIMENTO;
    });
  }

  function avisoDesenvolvimento() {
    deps.showMsg?.('Importação de NF-e em desenvolvimento. Esta função ainda não está disponível.');
  }

  async function consultarChave() {
    if (EM_DESENVOLVIMENTO) {
      avisoDesenvolvimento();
      return;
    }
    const chave = String($('#imp-chave')?.value || '').replace(/\D/g, '');
    if (chave.length !== 44) {
      deps.showMsg?.('Informe a chave de acesso com 44 dígitos.');
      return;
    }
    const btn = $('#imp-btn-consultar');
    if (btn) btn.disabled = true;
    const res = await api('/importacao/sessoes', { method: 'POST', body: { chave } });
    if (btn) btn.disabled = false;
    if (!res.ok) {
      deps.showMsg?.(res.error || 'Não foi possível consultar a NF-e');
      return;
    }
    state.sessao = res.sessao;
    state.itemIndex = 0;
    renderSessao();
    showView('sessao');
    deps.showToast?.('NF-e carregada para conferência');
  }

  function onPageEnter() {
    applyDevLock();
    showView('inicio');
    if (!EM_DESENVOLVIMENTO) loadSessoesEmAndamento();
    else {
      const box = $('#imp-sessoes-lista');
      if (box) box.innerHTML = '<p class="empty">Módulo em desenvolvimento</p>';
    }
    $('#page-title').textContent = 'Importar NF-e';
    $('#page-sub').textContent = EM_DESENVOLVIMENTO
      ? 'Em desenvolvimento — indisponível por enquanto'
      : 'Protótipo — conferência por item';
  }

  function bindEvents() {
    $('#imp-btn-consultar')?.addEventListener('click', consultarChave);
    $('#imp-chave')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') consultarChave();
    });
    $('#imp-btn-scan-chave')?.addEventListener('click', () => {
      if (EM_DESENVOLVIMENTO) {
        avisoDesenvolvimento();
        return;
      }
      deps.startScanner?.('importacao');
    });
    $('#imp-btn-demo')?.addEventListener('click', () => {
      if (EM_DESENVOLVIMENTO) {
        avisoDesenvolvimento();
        return;
      }
      const demo = '35260821234567890123456789012345678901234567';
      const inp = $('#imp-chave');
      if (inp) inp.value = demo;
      consultarChave();
    });
    $('#imp-btn-financeiro')?.addEventListener('click', () => {
      renderFinanceiro();
      showView('financeiro');
    });
    $('#imp-btn-confirmar')?.addEventListener('click', async () => {
      if (EM_DESENVOLVIMENTO) {
        avisoDesenvolvimento();
        return;
      }
      if (!state.sessao) return;
      const res = await api(`/importacao/sessoes/${state.sessao.id}/confirmar`, { method: 'POST' });
      if (res.ok) {
        deps.showMsg?.(res.message || 'Entrada confirmada (protótipo)');
        state.sessao = null;
        showView('inicio');
        loadSessoesEmAndamento();
      } else deps.showMsg?.(res.error);
    });
    $('#imp-voltar-inicio')?.addEventListener('click', () => {
      showView('inicio');
      loadSessoesEmAndamento();
    });
  }

  function applyScannedChave(code) {
    if (EM_DESENVOLVIMENTO) {
      avisoDesenvolvimento();
      return true;
    }
    const chave = String(code || '').replace(/\D/g, '');
    if (chave.length >= 44) {
      const inp = $('#imp-chave');
      if (inp) inp.value = chave.slice(0, 44);
      consultarChave();
      return true;
    }
    return false;
  }

  function init(options) {
    deps = options || {};
    bindEvents();
    applyDevLock();
  }

  return { init, onPageEnter, applyScannedChave, getView: () => state.view };
})();

window.ImportacaoNfe = ImportacaoNfe;
