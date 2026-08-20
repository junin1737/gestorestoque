'use strict';
/**
 * Protótipo — Importação NF-e com conferência por item.
 * Módulo isolado (sessões JSON + API REST).
 */
const ImportacaoNfe = (() => {
  const state = {
    sessao: null,
    itemIndex: 0,
    itemTab: 'vinculo',
    view: 'inicio',
    buscaProduto: '',
    buscaFornecedor: '',
    tab: 'dados',
    filtroDe: '',
    filtroAte: '',
    filtroNnf: '',
    filtroForn: '',
    filtroDataCampo: 'entrada',
    unidades: [],
    formasPagto: [],
    parcelamentos: [],
    emitenteSimples: null,
    xmlTextPendente: null,
  };

  let deps = {};
  let buscaProdTimer = null;
  let buscaFornTimer = null;
  let buscaClassTimer = null;
  let buscaAnpTimer = null;
  let buscaCestTimer = null;
  let buscaCodeTimer = null;

  const ITEM_TABS = [
    { id: 'vinculo', label: '1 · Vínculo' },
    { id: 'entrada', label: '2 · Entrada' },
    { id: 'conversao', label: '3 · Conversão' },
    { id: 'saida', label: '4 · Saída' },
    { id: 'trib_saida', label: '5 · Trib. saída' },
    { id: 'anp', label: '6 · ANP' },
  ];

  function calcVendaPorMargem(custo, margem) {
    const c = Number(custo || 0);
    const m = Number(margem || 0);
    if (!(c > 0) || !(m > 0)) return null;
    return Number((c * (1 + m / 100)).toFixed(4));
  }

  function cmpHint(a, b, label) {
    const left = String(a || '').trim();
    const right = String(b || '').trim();
    if (!left && !right) return '';
    if (left.toUpperCase() === right.toUpperCase()) {
      return `<span class="imp-cmp-chip ok">${esc(label)} iguais</span>`;
    }
    return `<span class="imp-cmp-chip diff">${esc(label)} diferem</span>`;
  }

  function $(sel, el = document) { return el.querySelector(sel); }
  function $$(sel, el = document) { return [...el.querySelectorAll(sel)]; }

  async function api(path, options = {}) {
    const supervisor = deps.isSupervisor?.() ? '1' : '0';
    const method = (options.method || 'GET').toUpperCase();
    let url = path;
    if (method === 'GET' || method === 'DELETE') {
      url += (path.includes('?') ? '&' : '?') + `supervisor=${supervisor}`;
    } else if (options.body && typeof options.body === 'object') {
      options = { ...options, body: { ...options.body, supervisor: supervisor === '1' } };
    } else if (method === 'POST' || method === 'PUT') {
      options = { ...options, body: { ...(options.body || {}), supervisor: supervisor === '1' } };
    }
    return deps.api(url, options);
  }

  function esc(s) {
    return deps.escapeHtml ? deps.escapeHtml(s) : String(s ?? '');
  }
  function money(n) {
    return deps.fmtMoney ? deps.fmtMoney(n) : String(n ?? '');
  }
  function num(n) {
    return deps.fmtNum ? deps.fmtNum(n) : String(n ?? '');
  }

  function todayLocal() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function fmtDateBr(v) {
    if (!v) return '—';
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const [y, m, d] = s.slice(0, 10).split('-');
      return `${d}/${m}/${y}`;
    }
    const dt = new Date(v);
    if (Number.isNaN(dt.getTime())) return s;
    return dt.toLocaleDateString('pt-BR');
  }

  function fmtDateTimeBr(v) {
    if (!v) return '—';
    const dt = new Date(v);
    if (Number.isNaN(dt.getTime())) return fmtDateBr(v);
    return dt.toLocaleString('pt-BR');
  }

  function formatCnpjDisplay(v) {
    const d = String(v || '').replace(/\D/g, '');
    if (d.length === 14) {
      return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
    }
    if (d.length === 11) {
      return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
    }
    return String(v || '');
  }

  function formatEndereco(end) {
    if (!end) return '—';
    const parts = [
      end.xLgr || end.end_lograd,
      end.nro || end.end_numero ? `nº ${end.nro || end.end_numero}` : '',
      end.xCpl || end.end_comple,
      end.xBairro || end.end_bairro,
      end.xMun || end.municipio,
      end.UF || end.uf,
      end.CEP || end.end_cep ? `CEP ${end.CEP || end.end_cep}` : '',
    ].filter(Boolean);
    return parts.join(' · ') || '—';
  }

  function modFreteLabel(mod) {
    const m = String(mod ?? '');
    const map = {
      0: '0 — Por conta do emitente',
      1: '1 — Por conta do destinatário',
      2: '2 — Por conta de terceiros',
      3: '3 — Próprio por conta do remetente',
      4: '4 — Próprio por conta do destinatário',
      9: '9 — Sem frete',
    };
    return map[m] || (m || '—');
  }

  function itemAt(idx) {
    return state.sessao?.itens?.[idx] || null;
  }

  function statusLabel(st) {
    if (st === 'conferido') return ['Verificado', 'ok'];
    if (st === 'vinculado') return ['Vinculado', 'warn'];
    return ['Pendente', 'pending'];
  }

  function showView(name) {
    state.view = name;
    const views = ['inicio', 'consultar', 'params', 'sessao', 'item'];
    views.forEach((v) => {
      const el = $(`#imp-view-${v}`);
      if (el) el.hidden = v !== name;
    });
    deps.scrollAppTop?.();
  }

  function setDateFiltersToday() {
    const hoje = todayLocal();
    state.filtroDe = hoje;
    state.filtroAte = hoje;
    state.filtroNnf = '';
    state.filtroForn = '';
    const de = $('#imp-filtro-de');
    const ate = $('#imp-filtro-ate');
    const nnf = $('#imp-filtro-nnf');
    const forn = $('#imp-filtro-forn');
    if (de) de.value = hoje;
    if (ate) ate.value = hoje;
    if (nnf) nnf.value = '';
    if (forn) forn.value = '';
  }

  function readDateFilters() {
    state.filtroDe = $('#imp-filtro-de')?.value || state.filtroDe || todayLocal();
    state.filtroAte = $('#imp-filtro-ate')?.value || state.filtroAte || state.filtroDe;
    state.filtroNnf = String($('#imp-filtro-nnf')?.value || state.filtroNnf || '').trim();
    state.filtroForn = String($('#imp-filtro-forn')?.value || state.filtroForn || '').trim();
    state.filtroDataCampo = $('#imp-filtro-data-campo')?.value || state.filtroDataCampo || 'entrada';
  }

  async function askConfirm(message, opts) {
    if (deps.showConfirm) return deps.showConfirm(message, opts);
    return window.confirm(message);
  }

  function setTab(tab) {
    state.tab = tab || 'dados';
    $$('#imp-tabs .imp-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === state.tab);
    });
    const dados = $('#imp-tab-dados');
    const itens = $('#imp-tab-itens');
    const fin = $('#imp-tab-financeiro');
    if (dados) dados.hidden = state.tab !== 'dados';
    if (itens) itens.hidden = state.tab !== 'itens';
    if (fin) fin.hidden = state.tab !== 'financeiro';
    if (state.tab === 'financeiro') renderFinanceiro();
  }

  /* ── HOME ───────────────────────────────────────────────────────────────── */

  async function loadHome() {
    readDateFilters();
    const de = state.filtroDe;
    const ate = state.filtroAte;
    const nf = String(state.filtroNnf || '').replace(/\D/g, '');
    const forn = String(state.filtroForn || '').trim();
    const dataCampo = state.filtroDataCampo === 'emissao' ? 'emissao' : 'entrada';
    const parts = [];
    if (nf) parts.push(`nf=${encodeURIComponent(nf)}`);
    else {
      parts.push(`de=${encodeURIComponent(de)}`);
      parts.push(`ate=${encodeURIComponent(ate)}`);
      parts.push(`data_campo=${encodeURIComponent(dataCampo)}`);
    }
    if (forn) parts.push(`fornecedor=${encodeURIComponent(forn)}`);
    const res = await api(`/importacao/notas?${parts.join('&')}`);
    renderSessoesLista(res.sessoes || []);
    renderNotasLista(res.notas || []);
  }

  function renderSessoesLista(list) {
    const box = $('#imp-sessoes-lista');
    if (!box) return;
    if (!list.length) {
      box.innerHTML = '<p class="empty">Nenhuma importação em andamento</p>';
      return;
    }
    box.innerHTML = list.map((s) => {
      const emit = s.xml?.emit || {};
      const ide = s.xml?.ide || {};
      const total = s.xml?.total || {};
      const fornNome = emit.xFant || emit.xNome || s.fornecedor?.cadastro?.nome_fanta || s.fornecedor?.cadastro?.nome || '—';
      const cnpj = formatCnpjDisplay(emit.CNPJ || s.fornecedor?.cadastro?.cnpj || '');
      const qtd = s.resumo?.total ?? (s.itens?.length || 0);
      const dataEnt = fmtDateBr(s.createdAt || ide.dhEmi);
      return `
        <div class="imp-sessao-row-wrap">
          <button type="button" class="imp-sessao-row" data-id="${esc(s.id)}">
            <div>
              <strong>NF ${esc(ide.nNF || '—')} · Série ${esc(ide.serie || '—')} · ${esc(fornNome)}</strong>
              <span class="hint">CNPJ ${esc(cnpj || '—')} · ${qtd} itens · ${money(total.vNF)} · Entrada ${esc(dataEnt)}</span>
              <span class="hint mono">${esc(s.chave || '')}</span>
            </div>
            <div class="imp-sessao-meta">
              <span class="chip">${s.resumo?.conferidos || 0}/${qtd} conferidos</span>
              <span class="chip warn">${s.resumo?.pendentes || 0} pend.</span>
              ${s.manual ? '<span class="chip">Manual</span>' : ''}
              ${s.fonte === 'demo' ? '<span class="chip pending">Demo</span>' : ''}
              ${s.fonte === 'sefaz' ? '<span class="chip ok">SEFAZ</span>' : ''}
              ${s.fonte === 'xml' ? '<span class="chip">XML</span>' : ''}
            </div>
          </button>
          <button type="button" class="btn small outline imp-btn-remover" data-id="${esc(s.id)}" title="Remover da conferência">Remover</button>
        </div>
      `;
    }).join('');
    $$('.imp-sessao-row', box).forEach((btn) => {
      btn.addEventListener('click', () => openSessao(btn.dataset.id));
    });
    $$('.imp-btn-remover', box).forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!await askConfirm('Remover esta nota da conferência?')) return;
        const res = await api(`/importacao/sessoes/${btn.dataset.id}`, { method: 'DELETE' });
        if (!res.ok) deps.showMsg?.(res.error || 'Erro ao remover');
        else {
          deps.showToast?.('Removida');
          loadHome();
        }
      });
    });
  }

  function renderNotasLista(list) {
    const box = $('#imp-notas-lista');
    if (!box) return;
    if (!list.length) {
      box.innerHTML = '<p class="empty">Nenhuma nota cadastrada no período</p>';
      return;
    }
    box.innerHTML = list.map((n) => {
      const st = String(n.status || '').trim().toUpperCase();
      const cancelada = st === 'C';
      return `
      <div class="imp-sessao-row-wrap">
        <div class="imp-sessao-row" style="cursor:default">
          <div>
            <strong>NF ${esc(n.nf_numero || '—')} · Série ${esc(n.nf_serie || '—')} · ${esc(n.fornecedor_nome || '—')}</strong>
            <span class="hint">CNPJ ${esc(formatCnpjDisplay(n.fornecedor_cnpj) || '—')} · ${num(n.qtd_itens)} itens · ${money(n.vlr_itens)} · Entrada ${esc(fmtDateBr(n.dt_entrada))}</span>
          </div>
          <div class="imp-sessao-meta">
            <span class="chip ${cancelada ? 'pending' : 'ok'}">${cancelada ? 'Cancelada' : 'Cadastrada'}</span>
          </div>
        </div>
        ${!cancelada ? `<button type="button" class="btn small outline imp-btn-cancelar-nf" data-id="${esc(n.id_nfcompra)}">Cancelar</button>` : ''}
      </div>`;
    }).join('');
    $$('.imp-btn-cancelar-nf', box).forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        if (!await askConfirm('Cancelar esta NF de compra? O estoque será estornado e as contas a pagar serão zeradas. A parametrização (TB_MT_REGRA_TRIBUTO) permanece.')) return;
        btn.disabled = true;
        const res = await api(`/importacao/notas/${btn.dataset.id}/cancelar`, {
          method: 'POST',
          body: {},
        });
        if (!res.ok) {
          btn.disabled = false;
          deps.showMsg?.(res.error || 'Erro ao cancelar');
        } else {
          deps.showMsg?.(res.message || 'Nota cancelada. Contas a pagar zeradas. Parametrização mantida.');
          loadHome();
        }
      });
    });
  }

  /* ── SESSÃO ─────────────────────────────────────────────────────────────── */

  async function openSessao(id) {
    const res = await api(`/importacao/sessoes/${id}`);
    if (!res.ok) {
      deps.showMsg?.(res.error || 'Erro ao abrir sessão');
      return;
    }
    state.sessao = res.sessao;
    state.itemIndex = 0;
    state.tab = 'dados';
    renderSessao();
    setTab('dados');
    showView('sessao');
  }

  function renderSessao() {
    renderSessaoHeader();
    renderManualCabecalho();
    renderFornecedor();
    renderItensLista();
    updateAddItemBtn();
    updateConfirmBtn();
    if (state.tab === 'financeiro') renderFinanceiro();
  }

  function renderManualCabecalho() {
    const host = $('#imp-sessao-resumo');
    const s = state.sessao;
    if (!host || !s?.manual) return;
    const wrap = document.createElement('div');
    wrap.id = 'imp-manual-cab';
    wrap.innerHTML = `
      <section class="imp-section">
        <header class="imp-section-head"><h4>Lançamento manual</h4></header>
        <div class="imp-fields">
          ${field('Número NF', 'imp-man-nnf', s.xml?.ide?.nNF || '', { half: true })}
          ${field('Série', 'imp-man-serie', s.xml?.ide?.serie || '1', { half: true })}
        </div>
        <p class="hint">A natureza principal fica no bloco “Natureza de operação” acima.</p>
        <div class="imp-vinc-btns">
          <button type="button" class="btn small outline" id="imp-man-salvar-cab">Salvar cabeçalho</button>
        </div>
      </section>
    `;
    const old = host.querySelector('#imp-manual-cab');
    if (old) old.remove();
    host.appendChild(wrap);

    $('#imp-man-salvar-cab')?.addEventListener('click', async () => {
      const res = await api(`/importacao/sessoes/${s.id}/cabecalho`, {
        method: 'PUT',
        body: {
          nNF: $('#imp-man-nnf')?.value,
          serie: $('#imp-man-serie')?.value,
        },
      });
      if (res.ok) {
        state.sessao = res.sessao;
        deps.showToast?.('Cabeçalho salvo');
        renderSessao();
      } else deps.showMsg?.(res.error);
    });
  }

  function updateAddItemBtn() {
    const btn = $('#imp-btn-add-item');
    if (!btn) return;
    btn.hidden = !state.sessao?.manual;
  }

  function updateConfirmBtn() {
    const btn = $('#imp-btn-confirmar');
    if (!btn) return;
    const s = state.sessao;
    const itensOk = !!s
      && (s.resumo?.total || 0) > 0
      && s.resumo?.pendentes === 0
      && s.resumo?.conferidos === s.resumo?.total;
    const fornOk = !!s?.fornecedor?.id_fornec;
    const ok = !!(itensOk && fornOk);
    // Evita disabled nativo: no APK o clique some e o usuário acha que “não funciona”.
    btn.disabled = false;
    btn.classList.toggle('is-disabled', !ok);
    btn.setAttribute('aria-disabled', ok ? 'false' : 'true');
    btn.title = ok
      ? 'Confirmar gravação da nota'
      : (!fornOk
        ? 'Vincule o fornecedor antes de gravar'
        : 'Confira todos os itens antes de gravar');
  }

  function kv(label, value) {
    return `
      <div class="imp-kv">
        <span class="hint">${esc(label)}</span>
        <strong>${value}</strong>
      </div>
    `;
  }

  function renderSessaoHeader() {
    const s = state.sessao;
    const el = $('#imp-sessao-resumo');
    if (!el || !s) return;
    const ide = s.xml?.ide || {};
    const emit = s.xml?.emit || {};
    const dest = s.xml?.dest || {};
    const tot = s.xml?.total || {};
    const transp = s.xml?.transp || {};
    const transporta = transp.transporta || {};
    const vols = Array.isArray(transp.vol) ? transp.vol : (transp.vol ? [transp.vol] : []);
    const inf = s.xml?.infAdic || {};
    const endEmit = emit.enderEmit || {};
    const endDest = dest.enderDest || {};
    const pct = s.resumo?.total
      ? Math.round((s.resumo.conferidos / s.resumo.total) * 100)
      : 0;

    const volsHtml = vols.length
      ? vols.map((v, i) => `
          <div class="imp-kv">
            <span class="hint">Volume ${i + 1}</span>
            <strong>${esc([
              v.qVol != null ? `${v.qVol} vol` : '',
              v.esp || '',
              v.marca || '',
              v.nVol ? `nº ${v.nVol}` : '',
              v.pesoL != null ? `P.L ${num(v.pesoL)}` : '',
              v.pesoB != null ? `P.B ${num(v.pesoB)}` : '',
            ].filter(Boolean).join(' · ') || '—')}</strong>
          </div>
        `).join('')
      : kv('Volumes', '—');

    el.innerHTML = `
      <div class="imp-nf-card">
        <div class="imp-nf-head">
          <div>
            <h3>NF-e ${esc(ide.nNF || '—')} · Série ${esc(ide.serie || '—')} · Modelo ${esc(ide.modelo || '55')}</h3>
            <p class="hint">${esc(ide.natOp || s.natureza?.descricao || '')}</p>
            <p class="hint mono">${esc(s.chave || '')}</p>
            ${s.fonte === 'demo' ? '<p class="hint" style="color:#b45309">Demonstração — anexe o XML real ou configure o certificado SEFAZ.</p>' : ''}
            ${s.fonte === 'sefaz' ? `<p class="hint">Consultada na SEFAZ · ${esc(String(s.resumo?.total || s.itens?.length || 0))} itens</p>` : ''}
            ${s.fonte === 'xml' ? `<p class="hint">XML · ${esc(String(s.resumo?.total || s.itens?.length || 0))} itens</p>` : ''}
          </div>
          <div class="imp-nf-totais">
            <strong>${money(tot.vNF)}</strong>
            <span class="hint">${s.resumo?.conferidos || 0} de ${s.resumo?.total || 0} itens conferidos</span>
            <button type="button" class="btn small outline" id="imp-btn-ver-pdf-info">Ver PDF da nota</button>
          </div>
        </div>
        <div class="imp-progress">
          <div class="imp-progress-bar" style="width:${pct}%"></div>
        </div>
      </div>

      <div class="imp-nf-grid">
        <section class="imp-section">
          <header class="imp-section-head"><h4>Identificação</h4></header>
          <div class="imp-kv-grid">
            ${kv('Chave', `<span class="mono">${esc(s.chave || '—')}</span>`)}
            ${kv('Número', esc(ide.nNF || '—'))}
            ${kv('Série', esc(ide.serie || '—'))}
            ${kv('Modelo', esc(ide.modelo || '55'))}
            ${kv('Emissão', esc(fmtDateTimeBr(ide.dhEmi)))}
          </div>
        </section>

        <section class="imp-section" style="grid-column:1/-1">
          <header class="imp-section-head">
            <h4>Natureza de operação</h4>
            <span class="hint">Natureza principal da nota no Clipp — pode alterar</span>
          </header>
          <div class="imp-fields">
            ${comboField('Natureza (TB_NAT_OPERACAO)', 'imp-natope', 'imp-natope-list', s.id_natope || '', {
    full: true,
    displayLabel: s.natureza
      ? `${s.natureza.descricao}${s.natureza.cfop ? ` · CFOP ${s.natureza.cfop}` : ''}`
      : (ide.natOp || ''),
    placeholder: 'Pesquisar natureza por descrição ou CFOP…',
  })}
          </div>
          <p class="hint">Texto na NF-e (XML): <strong>${esc(ide.natOp || '—')}</strong>${s.id_natope ? ` · Cód. sistema ${esc(s.id_natope)}` : ''}</p>
        </section>

        <section class="imp-section">
          <header class="imp-section-head"><h4>Emitente</h4></header>
          <div class="imp-kv-grid">
            ${kv('CNPJ', esc(formatCnpjDisplay(emit.CNPJ) || '—'))}
            ${kv('Razão social', esc(emit.xNome || '—'))}
            ${kv('Fantasia', esc(emit.xFant || '—'))}
            ${kv('IE', esc(emit.IE || '—'))}
            ${kv('Endereço', esc(formatEndereco(endEmit)))}
            ${kv('Fone', esc(endEmit.fone || emit.fone || '—'))}
          </div>
        </section>

        <section class="imp-section">
          <header class="imp-section-head"><h4>Destinatário</h4></header>
          <div class="imp-kv-grid">
            ${kv('CNPJ/CPF', esc(formatCnpjDisplay(dest.CNPJ || dest.CPF) || '—'))}
            ${kv('Nome', esc(dest.xNome || '—'))}
            ${kv('IE', esc(dest.IE || '—'))}
            ${kv('Endereço', esc(formatEndereco(endDest)))}
          </div>
        </section>

        <section class="imp-section">
          <header class="imp-section-head"><h4>Totais</h4></header>
          <div class="imp-kv-grid">
            ${kv('Valor NF (vNF)', money(tot.vNF))}
            ${kv('Produtos (vProd)', money(tot.vProd))}
            ${kv('Desconto (vDesc)', money(tot.vDesc))}
            ${kv('Frete (vFrete)', money(tot.vFrete))}
            ${kv('Seguro (vSeg)', money(tot.vSeg))}
            ${kv('Outras (vOutro)', money(tot.vOutro))}
            ${kv('Base ICMS (vBC)', money(tot.vBC))}
            ${kv('ICMS (vICMS)', money(tot.vICMS))}
            ${kv('ST (vST)', money(tot.vST))}
            ${kv('IPI (vIPI)', money(tot.vIPI))}
            ${kv('PIS (vPIS)', money(tot.vPIS))}
            ${kv('COFINS (vCOFINS)', money(tot.vCOFINS))}
          </div>
        </section>

        <section class="imp-section">
          <header class="imp-section-head"><h4>Transporte / Frete</h4></header>
          <div class="imp-kv-grid">
            ${kv('Modalidade frete', esc(modFreteLabel(transp.modFrete)))}
            ${kv('Transportadora', esc(transporta.xNome || '—'))}
            ${kv('CNPJ transp.', esc(formatCnpjDisplay(transporta.CNPJ) || '—'))}
            ${kv('IE transp.', esc(transporta.IE || '—'))}
            ${kv('Endereço transp.', esc(transporta.xEnder || '—'))}
            ${kv('Município/UF', esc([transporta.xMun, transporta.UF].filter(Boolean).join('/') || '—'))}
          </div>
        </section>

        <section class="imp-section">
          <header class="imp-section-head"><h4>Volumes</h4></header>
          <div class="imp-kv-grid">${volsHtml}</div>
        </section>

        <section class="imp-section" style="grid-column:1/-1">
          <header class="imp-section-head"><h4>Informações complementares</h4></header>
          <p class="hint" style="white-space:pre-wrap;margin:0">${esc(inf.infCpl || '—')}</p>
        </section>
      </div>
    `;
    $('#imp-btn-ver-pdf-info')?.addEventListener('click', () => abrirDanfePdf());
    wireCodeSearch({
      valueSel: '#imp-natope',
      listSel: '#imp-natope-list',
      endpoint: '/importacao/naturezas',
      codeKey: 'id_natope',
      labelPreferDesc: true,
      onSelect: async (code, desc, extra) => {
        const sess = state.sessao;
        if (!sess?.id) return;
        const label = desc || extra?.descricao || '';
        const res = await api(`/importacao/sessoes/${sess.id}/cabecalho`, {
          method: 'PUT',
          body: {
            id_natope: Number(code) || null,
            natureza: {
              id_natope: Number(code) || null,
              descricao: label,
              cfop: extra?.cfop || '',
              csosn_padrao: extra?.csosn_padrao || '',
            },
            natOp: label || sess.xml?.ide?.natOp || '',
          },
        });
        if (res.ok) {
          state.sessao = res.sessao;
          deps.showToast?.('Natureza atualizada');
          renderSessao();
        } else {
          deps.showMsg?.(res.error || 'Erro ao salvar natureza');
        }
      },
    });
  }

  function abrirDanfePdf() {
    const id = state.sessao?.id;
    if (!id) {
      deps.showMsg?.('Nenhuma nota aberta para visualizar.');
      return;
    }
    const supervisor = deps.isSupervisor?.() ? '1' : '0';
    const url = `/api/importacao/sessoes/${encodeURIComponent(id)}/danfe?supervisor=${supervisor}`;
    const dlg = $('#dlg-danfe');
    const frame = $('#dlg-danfe-frame');
    if (dlg && frame) {
      frame.src = url;
      const fechar = () => {
        try {
          frame.src = 'about:blank';
          dlg.close();
        } catch { /* ignore */ }
      };
      $('#dlg-danfe-fechar')?.addEventListener('click', fechar, { once: true });
      $('#dlg-danfe-print')?.addEventListener('click', () => {
        try { frame.contentWindow?.print(); } catch { /* ignore */ }
      }, { once: true });
      if (!dlg.open) dlg.showModal();
      return;
    }
    const win = window.open(url, '_blank');
    if (!win) deps.showMsg?.('Permita pop-ups para visualizar o PDF da nota.');
  }

  function renderItensLista() {
    const s = state.sessao;
    const box = $('#imp-itens-lista');
    if (!box || !s) return;
    const itens = s.itens || [];
    if (!itens.length) {
      box.innerHTML = '<p class="empty">Nenhum item na nota</p>';
      return;
    }
    box.innerHTML = itens.map((it, idx) => {
      const [lbl, cls] = statusLabel(it.status);
      const xml = it.xml || {};
      const sys = it.sistema || {};
      const cfopOrig = sys.cfop_origem || xml.CFOP || '—';
      const cfopEnt = sys.cfop || '—';
      const descForn = xml.xProd || '—';
      const descEst = sys.criar_novo
        ? `(novo) ${sys.descricao || xml.xProd || '—'}`
        : (sys.descricao || (sys.id_identificador ? `ID ${sys.id_identificador}` : '— sem vínculo —'));
      const conversor = Number(sys.conversor ?? 1) || 1;
      const qtdXml = Number(sys.qtd_xml ?? xml.qCom ?? 0);
      const qtdEst = Number(sys.qtd ?? (qtdXml * conversor));
      const uniXml = sys.uni_medida_xml || xml.uCom || '';
      const uniEst = sys.uni_medida || '';
      const custo = Number(sys.prc_custo || 0);
      const convLine = (it.conferido || it.status === 'conferido')
        ? `<span class="hint imp-item-conv">Conv. ${esc(String(conversor))} · ${num(qtdXml)} ${esc(uniXml)} → ${num(qtdEst)} ${esc(uniEst)}${custo > 0 ? ` · Custo ${money(custo)}` : ''}</span>`
        : '';
      return `
        <button type="button" class="imp-item-row ${cls}" data-idx="${idx}">
          <span class="imp-item-num">${esc(it.nItem)}</span>
          <div class="imp-item-main">
            <div class="imp-item-conf">
              <span class="hint">Fornecedor</span>
              <strong>${esc(descForn)}</strong>
            </div>
            <div class="imp-item-conf">
              <span class="hint">Estoque</span>
              <strong class="${sys.id_identificador || sys.criar_novo ? '' : 'imp-muted'}">${esc(descEst)}</strong>
            </div>
            <span class="hint">Cód. ${esc(xml.cProd || '—')} · Qtd ${num(xml.qCom)} ${esc(xml.uCom || '')} · CFOP ${esc(cfopOrig)} → ${esc(cfopEnt)}</span>
            ${convLine}
          </div>
          <span class="imp-status ${cls}">${lbl}</span>
        </button>
      `;
    }).join('');
    $$('.imp-item-row', box).forEach((btn) => {
      btn.addEventListener('click', () => openItem(Number(btn.dataset.idx)));
    });
  }

  /* ── FORNECEDOR ─────────────────────────────────────────────────────────── */

  function field(label, id, value, opts = {}) {
    const type = opts.type || 'text';
    const ro = opts.readonly ? 'readonly' : '';
    const dis = opts.disabled ? 'disabled' : '';
    const step = opts.step ? ` step="${opts.step}"` : '';
    const cls = opts.full
      ? 'imp-field full'
      : opts.half
        ? 'imp-field half'
        : opts.third
          ? 'imp-field third'
          : 'imp-field';
    return `
      <label class="${cls}">
        <span>${esc(label)}</span>
        <input id="${id}" type="${type}" value="${esc(value ?? '')}" ${ro} ${dis}${step} />
      </label>
    `;
  }

  function searchableCodeField(label, valueId, buscaId, listId, value, opts = {}) {
    return comboField(label, valueId, listId, value, {
      ...opts,
      placeholder: opts.placeholder || 'Pesquisar código ou descrição…',
    });
  }

  function comboField(label, valueId, listId, value, opts = {}) {
    const cls = opts.full
      ? 'imp-field full imp-combo'
      : opts.half
        ? 'imp-field half imp-combo'
        : opts.third
          ? 'imp-field third imp-combo'
          : 'imp-field imp-combo';
    const displayId = opts.displayId || `${valueId}-disp`;
    const code = String(value ?? '').trim();
    const disp = opts.displayLabel || code;
    return `
      <div class="${cls}" data-combo-root>
        <span>${esc(label)}</span>
        <input type="hidden" id="${valueId}" value="${esc(code)}" />
        <input id="${displayId}" type="search" class="imp-combo-input"
          value="${esc(disp)}"
          placeholder="${esc(opts.placeholder || 'Pesquisar…')}"
          autocomplete="off" enterkeyhint="search" />
        <div id="${listId}" class="imp-combo-list" hidden></div>
      </div>
    `;
  }

  function renderFornecedor() {
    const s = state.sessao;
    const host = $('#imp-fornecedor-host');
    if (!host || !s) return;
    const f = s.fornecedor || {};
    const c = f.cadastro || {};
    const emit = s.xml?.emit || {};
    const end = emit.enderEmit || {};
    const vinculado = !!f.id_fornec;

    if (vinculado) {
      host.innerHTML = `
        <section class="imp-section imp-fornec-section">
          <header class="imp-section-head">
            <h4>Fornecedor</h4>
            <span class="chip ok">Vinculado · Cód. ${esc(f.id_fornec)}</span>
          </header>
          <div class="imp-fornec-vinculado">
            <div><span class="hint">Razão social</span><strong>${esc(c.nome)}</strong></div>
            <div><span class="hint">Nome fantasia</span><strong>${esc(c.nome_fanta || '—')}</strong></div>
            <div><span class="hint">CNPJ</span><strong>${esc(c.cnpj || '—')}</strong></div>
            <div><span class="hint">IE</span><strong>${esc(c.insc_estad || '—')}</strong></div>
            <div class="full"><span class="hint">Endereço</span><strong>${esc([c.end_lograd, c.end_numero, c.end_bairro, c.municipio, c.uf].filter(Boolean).join(' · ') || '—')}</strong></div>
          </div>
          <div class="imp-vinc-btns">
            <button type="button" class="btn small outline" id="imp-forn-trocar">Buscar outro fornecedor</button>
            <button type="button" class="btn small outline" id="imp-forn-limpar">Desvincular</button>
          </div>
        </section>
      `;
      bindFornecedorEvents();
      return;
    }

    const notaEnd = formatEndereco(end);
    host.innerHTML = `
      <section class="imp-section imp-fornec-section">
        <header class="imp-section-head">
          <h4>Fornecedor</h4>
          <span class="chip pending">Não vinculado</span>
        </header>
        <div class="imp-vinc-pair imp-fornec-pair">
          <div class="imp-vinc-nota">
            <label class="imp-field">
              <span>Emitente na nota</span>
              <input type="text" readonly value="${esc(emit.xNome || '')}" />
            </label>
            <div class="imp-nota-meta">
              <span>CNPJ <strong>${esc(emit.CNPJ ? formatCnpjDisplay(emit.CNPJ) : '—')}</strong></span>
              <span>Fantasia <strong>${esc(emit.xFant || '—')}</strong></span>
              <span>IE <strong>${esc(emit.IE || '—')}</strong></span>
              <span class="full">Endereço <strong>${esc(notaEnd)}</strong></span>
            </div>
          </div>
          <div class="imp-vinc-estoque">
            <label class="imp-field">
              <span>Buscar fornecedor cadastrado</span>
              <div class="search-field imp-busca-prod">
                <input id="imp-busca-forn" type="search" placeholder="CNPJ, razão social ou fantasia…" value="${esc(state.buscaFornecedor)}" />
              </div>
            </label>
            <div id="imp-forn-resultados" class="imp-prod-list"></div>
          </div>
        </div>
        <h5 class="imp-sub">Dados para cadastro / vínculo</h5>
        <div class="imp-fields imp-fornec-fields">
          ${field('CNPJ', 'imp-forn-cnpj', c.cnpj || formatCnpjDisplay(emit.CNPJ), { half: true, readonly: true })}
          ${field('Inscrição estadual', 'imp-forn-ie', c.insc_estad ?? emit.IE, { half: true })}
          ${field('Razão social', 'imp-forn-nome', c.nome ?? emit.xNome, { full: true })}
          ${field('Nome fantasia', 'imp-forn-fanta', c.nome_fanta ?? emit.xFant, { full: true })}
          ${field('Inscrição municipal', 'imp-forn-im', c.insc_munic ?? emit.IM, { half: true })}
          ${field('CEP', 'imp-forn-cep', c.end_cep ?? end.CEP, { half: true })}
          ${field('Logradouro', 'imp-forn-lograd', c.end_lograd ?? end.xLgr, { full: true })}
          ${field('Número', 'imp-forn-num', c.end_numero ?? end.nro, { half: true })}
          ${field('Complemento', 'imp-forn-comp', c.end_comple ?? end.xCpl, { half: true })}
          ${field('Bairro', 'imp-forn-bairro', c.end_bairro ?? end.xBairro, { half: true })}
          ${field('Município', 'imp-forn-mun', c.municipio ?? end.xMun, { half: true })}
          ${field('UF', 'imp-forn-uf', c.uf ?? end.UF, { half: true })}
          ${field('DDD comercial', 'imp-forn-ddd', c.ddd_comer, { half: true })}
          ${field('Fone comercial', 'imp-forn-fone', c.fone_comer ?? end.fone, { half: true })}
          ${field('e-mail', 'imp-forn-email', c.email_cont ?? emit.email, { half: true })}
          ${field('e-mail p/ NFe', 'imp-forn-email-nfe', c.email_nfe, { half: true })}
          ${field('Site', 'imp-forn-site', c.site, { half: true })}
          <label class="imp-field full">
            <span>Observação</span>
            <textarea id="imp-forn-obs" rows="2">${esc(c.observacao || '')}</textarea>
          </label>
          <label class="imp-check imp-field full">
            <input type="checkbox" id="imp-forn-prod-rural" ${c.produtor_rural ? 'checked' : ''} />
            Produtor rural
          </label>
        </div>
        <div class="imp-vinc-btns">
          <button type="button" class="btn small primary" id="imp-forn-cadastrar">Cadastrar fornecedor</button>
          <button type="button" class="btn small outline" id="imp-forn-salvar-campos">Salvar dados na sessão</button>
        </div>
      </section>
    `;
    bindFornecedorEvents();
    loadFornecedoresBusca(state.buscaFornecedor);
  }

  function collectFornecedorCadastro() {
    const g = (id) => $(id)?.value;
    return {
      cnpj: g('#imp-forn-cnpj'),
      insc_estad: g('#imp-forn-ie'),
      nome: g('#imp-forn-nome'),
      nome_fanta: g('#imp-forn-fanta'),
      insc_munic: g('#imp-forn-im'),
      end_cep: g('#imp-forn-cep'),
      end_lograd: g('#imp-forn-lograd'),
      end_numero: g('#imp-forn-num'),
      end_comple: g('#imp-forn-comp'),
      end_bairro: g('#imp-forn-bairro'),
      municipio: g('#imp-forn-mun'),
      uf: g('#imp-forn-uf'),
      ddd_comer: g('#imp-forn-ddd'),
      fone_comer: g('#imp-forn-fone'),
      email_cont: g('#imp-forn-email'),
      email_nfe: g('#imp-forn-email-nfe'),
      site: g('#imp-forn-site'),
      observacao: g('#imp-forn-obs'),
      produtor_rural: !!$('#imp-forn-prod-rural')?.checked,
    };
  }

  async function loadFornecedoresBusca(q) {
    const box = $('#imp-forn-resultados');
    if (!box) return;
    if (!String(q || '').trim()) {
      box.innerHTML = '<p class="hint">Digite CNPJ ou nome para buscar fornecedor</p>';
      return;
    }
    const res = await api(`/importacao/fornecedores?q=${encodeURIComponent(q)}`);
    const list = res.itens || [];
    if (!list.length) {
      box.innerHTML = '<p class="hint">Nenhum fornecedor encontrado — use o formulário abaixo para cadastrar</p>';
      return;
    }
    box.innerHTML = list.map((p) => `
      <button type="button" class="imp-prod-opt imp-forn-opt" data-id="${p.id_fornec}">
        <strong>Cód. ${p.id_fornec} · ${esc(p.cnpj || '—')}</strong>
        <span>${esc(p.nome)}</span>
        <span class="hint">${esc(p.nome_fanta || '')}${p.municipio ? ` · ${esc(p.municipio)}/${esc(p.uf || '')}` : ''}</span>
      </button>
    `).join('');
    $$('.imp-forn-opt', box).forEach((btn) => {
      btn.addEventListener('click', () => vincularFornecedorId(Number(btn.dataset.id)));
    });
  }

  async function vincularFornecedorId(idFornec) {
    const s = state.sessao;
    if (!s) return;
    const res = await api(`/importacao/sessoes/${s.id}/fornecedor`, {
      method: 'PUT',
      body: { id_fornec: idFornec },
    });
    if (!res.ok) {
      deps.showMsg?.(res.error || 'Erro ao vincular fornecedor');
      return;
    }
    state.sessao = res.sessao;
    deps.showToast?.('Fornecedor vinculado');
    renderSessao();
  }

  async function salvarFornecedorCampos() {
    const s = state.sessao;
    if (!s) return;
    const res = await api(`/importacao/sessoes/${s.id}/fornecedor`, {
      method: 'PUT',
      body: { cadastro: collectFornecedorCadastro(), criar_novo: true },
    });
    if (res.ok) {
      state.sessao = res.sessao;
      deps.showToast?.('Dados do fornecedor salvos');
    } else {
      deps.showMsg?.(res.error);
    }
  }

  async function cadastrarFornecedor() {
    const s = state.sessao;
    if (!s) return;
    const cadastro = collectFornecedorCadastro();
    const res = await api(`/importacao/sessoes/${s.id}/fornecedor/cadastrar`, {
      method: 'POST',
      body: { cadastro },
    });
    if (!res.ok) {
      deps.showMsg?.(res.error || 'Erro ao cadastrar fornecedor');
      return;
    }
    state.sessao = res.sessao;
    deps.showMsg?.(res.message || 'Fornecedor cadastrado');
    renderSessao();
  }

  function bindFornecedorEvents() {
    $('#imp-forn-cadastrar')?.addEventListener('click', cadastrarFornecedor);
    $('#imp-forn-salvar-campos')?.addEventListener('click', salvarFornecedorCampos);
    $('#imp-forn-limpar')?.addEventListener('click', async () => {
      const s = state.sessao;
      if (!s) return;
      const res = await api(`/importacao/sessoes/${s.id}/fornecedor`, {
        method: 'PUT',
        body: { id_fornec: null, criar_novo: true },
      });
      if (res.ok) {
        state.sessao = res.sessao;
        state.buscaFornecedor = '';
        renderSessao();
      }
    });
    $('#imp-forn-trocar')?.addEventListener('click', async () => {
      const s = state.sessao;
      if (!s) return;
      const res = await api(`/importacao/sessoes/${s.id}/fornecedor`, {
        method: 'PUT',
        body: { id_fornec: null, criar_novo: true },
      });
      if (res.ok) {
        state.sessao = res.sessao;
        state.buscaFornecedor = s.fornecedor?.cadastro?.cnpj || '';
        renderSessao();
      }
    });
    $('#imp-busca-forn')?.addEventListener('input', (e) => {
      state.buscaFornecedor = e.target.value;
      clearTimeout(buscaFornTimer);
      buscaFornTimer = setTimeout(() => loadFornecedoresBusca(state.buscaFornecedor), 280);
    });
  }

  /* ── FINANCEIRO ─────────────────────────────────────────────────────────── */

  async function ensureFormasPagto() {
    if (state.formasPagto?.length) return state.formasPagto;
    const res = await api('/importacao/formas-pagto');
    state.formasPagto = res.itens || [];
    return state.formasPagto;
  }

  async function loadParcelamentos(idFmapgto) {
    const qs = idFmapgto != null && idFmapgto !== ''
      ? `?id_fmapgto=${encodeURIComponent(idFmapgto)}`
      : '';
    const res = await api(`/importacao/parcelamentos${qs}`);
    state.parcelamentos = res.itens || [];
    return state.parcelamentos;
  }

  async function renderFinanceiro() {
    const s = state.sessao;
    const host = $('#imp-fin-host');
    if (!s || !host) return;

    let fin = s.financeiro || {};
    if (fin.id_fmapgto == null || Number(fin.id_fmapgto) === 1 || fin.id_parcela == null || Number(fin.id_parcela) === 1) {
      const sug = await api(`/importacao/sessoes/${s.id}/financeiro/sugerir`, { method: 'POST', body: {} });
      if (sug.ok && sug.sessao) {
        state.sessao = sug.sessao;
        fin = state.sessao.financeiro || fin;
      }
    }

    const parc = fin.parcelas || [];
    await ensureFormasPagto();
    const idFm = fin.id_fmapgto != null ? Number(fin.id_fmapgto) : '';
    await loadParcelamentos(idFm || '');
    const formasOpts = [
      '<option value="">Selecione…</option>',
      ...state.formasPagto
        .filter((f) => Number(f.id_fmapgto) !== 1 || Number(idFm) === 1)
        .map((f) =>
          `<option value="${f.id_fmapgto}" ${Number(idFm) === f.id_fmapgto ? 'selected' : ''}>${esc(f.descricao)}</option>`
        ),
    ].join('');
    const idParcela = fin.id_parcela != null ? Number(fin.id_parcela) : '';
    const parcOpts = [
      '<option value="">Selecione…</option>',
      ...state.parcelamentos
        .filter((p) => Number(p.id_parcela) !== 1 || Number(idParcela) === 1)
        .map((p) =>
          `<option value="${p.id_parcela}" ${Number(idParcela) === p.id_parcela ? 'selected' : ''}>${esc(p.descricao)}${p.n_parcelas ? ` (${p.n_parcelas}x)` : ''}</option>`
        ),
    ].join('');
    const tPagLbl = fin.tPag
      ? `tPag ${esc(fin.tPag)}${fin.sugestao_label ? ` · ${esc(fin.sugestao_label)}` : ''}`
      : (fin.sugestao_label ? esc(fin.sugestao_label) : 'Sem &lt;pag&gt; no XML — inferido pela fatura/duplicatas');
    host.innerHTML = `
      <div class="imp-section">
        <p class="hint">Faturamento sugerido pelo XML: <strong>${tPagLbl}</strong></p>
        <div class="imp-fields">
          ${field('Valor total NF', 'imp-vnf', s.xml?.total?.vNF, { type: 'number', step: '0.01', half: true, readonly: true })}
          ${field('Valor produtos', 'imp-vprod', s.xml?.total?.vProd, { type: 'number', step: '0.01', half: true, readonly: true })}
          ${field('Frete', 'imp-vfrete-tot', s.xml?.total?.vFrete, { type: 'number', step: '0.01', half: true, readonly: true })}
          <label class="imp-field half">
            <span>Forma de pagamento (faturamento)</span>
            <select id="imp-fmpag">${formasOpts}</select>
          </label>
          <label class="imp-field half">
            <span>Parcelamento</span>
            <select id="imp-parcelamento">${parcOpts}</select>
          </label>
          ${field('Fatura (nFat)', 'imp-nfat', fin.nFat || '', { half: true })}
          ${field('tPag XML', 'imp-tpag', fin.tPag || '', { half: true, readonly: true })}
        </div>
        <h4 class="imp-sub">Parcelas da nota (XML)</h4>
        <div id="imp-parcelas">${parc.length ? parc.map((p, i) => `
          <div class="imp-parc-row" data-i="${i}">
            ${field(`Parcela ${p.nDup || i + 1}`, `imp-parc-v-${i}`, p.vDup, { type: 'number', step: '0.01', half: true })}
            ${field('Vencimento', `imp-parc-d-${i}`, String(p.dVenc || '').slice(0, 10), { type: 'date', half: true })}
          </div>
        `).join('') : '<p class="hint">Nenhuma parcela informada no XML</p>'}</div>
        <div class="imp-item-footer">
          <button type="button" class="btn primary" id="imp-fin-salvar">Salvar financeiro</button>
        </div>
      </div>
    `;
    $('#imp-fmpag')?.addEventListener('change', async (e) => {
      const id = e.target.value;
      await loadParcelamentos(id);
      const sel = $('#imp-parcelamento');
      if (!sel) return;
      sel.innerHTML = [
        '<option value="">Selecione…</option>',
        ...state.parcelamentos
          .filter((p) => Number(p.id_parcela) !== 1)
          .map((p) =>
            `<option value="${p.id_parcela}">${esc(p.descricao)}${p.n_parcelas ? ` (${p.n_parcelas}x)` : ''}</option>`
          ),
      ].join('');
    });
    $('#imp-fin-salvar')?.addEventListener('click', async () => {
      const parcelas = parc.map((p, i) => ({
        ...p,
        vDup: Number($(`#imp-parc-v-${i}`)?.value || 0),
        dVenc: $(`#imp-parc-d-${i}`)?.value || p.dVenc,
      }));
      const idFmapgto = $('#imp-fmpag')?.value || null;
      const idParcelaSel = $('#imp-parcelamento')?.value || null;
      const formaDesc = state.formasPagto.find((f) => String(f.id_fmapgto) === String(idFmapgto))?.descricao || '';
      const parcDesc = state.parcelamentos.find((p) => String(p.id_parcela) === String(idParcelaSel))?.descricao || '';
      const res = await api(`/importacao/sessoes/${s.id}/financeiro`, {
        method: 'PUT',
        body: {
          id_fmapgto: idFmapgto ? Number(idFmapgto) : null,
          id_parcela: idParcelaSel ? Number(idParcelaSel) : null,
          id_fmanfce: fin.id_fmanfce || null,
          forma_pagto: formaDesc,
          parcelamento: parcDesc,
          nFat: $('#imp-nfat')?.value,
          tPag: fin.tPag || '',
          parcelas,
        },
      });
      if (res.ok) {
        state.sessao = res.sessao;
        deps.showToast?.('Financeiro salvo');
        renderFinanceiro();
      } else {
        deps.showMsg?.(res.error);
      }
    });
  }

  /* ── ITEM ───────────────────────────────────────────────────────────────── */

  function openItem(idx) {
    state.itemIndex = idx;
    state.itemTab = 'vinculo';
    const it = itemAt(idx);
    const semVinculo = !it?.sistema?.id_identificador && !it?.sistema?.criar_novo;
    state.buscaProduto = semVinculo ? (it?.xml?.xProd || '') : '';
    renderItemScreen();
    showView('item');
  }

  function tribRow(label, xmlVal, sysId, sysVal, opts = {}) {
    const xmlTxt = xmlVal == null || xmlVal === '' ? '—' : xmlVal;
    const same = String(xmlTxt).trim() !== '—'
      && String(sysVal ?? '').trim() !== ''
      && String(xmlTxt).trim().toUpperCase() === String(sysVal).trim().toUpperCase();
    return `
      <div class="imp-trib-row ${same ? 'is-match' : ''}">
        <span class="imp-trib-lbl">${esc(label)}</span>
        <span class="imp-trib-xml" title="Valor na NF-e">${esc(xmlTxt)}</span>
        <input class="imp-trib-sys" id="${sysId}" type="${opts.type || 'text'}" value="${esc(sysVal ?? '')}" ${opts.readonly ? 'readonly' : ''} ${opts.disabled ? 'disabled' : ''} />
      </div>
    `;
  }

  function tribSearchRow(label, xmlVal, valueId, buscaId, listId, sysVal) {
    const xmlTxt = xmlVal == null || xmlVal === '' ? '—' : xmlVal;
    const same = String(xmlTxt).trim() !== '—'
      && String(sysVal ?? '').trim() !== ''
      && String(xmlTxt).trim().toUpperCase() === String(sysVal).trim().toUpperCase();
    const displayId = `${valueId}-disp`;
    return `
      <div class="imp-trib-row imp-trib-search-row ${same ? 'is-match' : ''}" data-combo-root>
        <span class="imp-trib-lbl">${esc(label)}</span>
        <span class="imp-trib-xml" title="Valor na NF-e">${esc(xmlTxt)}</span>
        <div class="imp-trib-search">
          <input type="hidden" id="${valueId}" value="${esc(sysVal ?? '')}" />
          <input id="${displayId}" class="imp-trib-sys imp-combo-input" type="search"
            value="${esc(sysVal ?? '')}" placeholder="Pesquisar…" autocomplete="off" enterkeyhint="search" />
          <div id="${listId}" class="imp-combo-list" hidden></div>
        </div>
      </div>
    `;
  }

  function ynChecked(v) {
    return String(v || '').toUpperCase() === 'S' || v === true || v === 1 || v === '1';
  }

  async function ensureUnidades() {
    if (state.unidades.length) return state.unidades;
    const res = await api('/importacao/unidades');
    state.unidades = res.itens || [];
    return state.unidades;
  }

  async function ensureEmitenteFiscal() {
    if (state.emitenteSimples != null) return state.emitenteSimples;
    const res = await api('/importacao/emitente-fiscal');
    state.emitenteSimples = !!res.simples;
    return state.emitenteSimples;
  }

  function unidadeOptions(selected) {
    const sel = String(selected || '').trim().toUpperCase();
    const labelOf = (u) => {
      const uni = String(u.unidade || '').trim();
      const desc = String(u.descricao || '').trim();
      if (!desc) return uni;
      if (desc.toUpperCase().startsWith(uni.toUpperCase())) return desc;
      return `${uni} — ${desc}`;
    };
    const opts = state.unidades.map((u) => {
      const uni = String(u.unidade || '').trim();
      const selectedAttr = uni.toUpperCase() === sel ? 'selected' : '';
      return `<option value="${esc(uni)}" data-conversor="${u.conversor ?? 1}" ${selectedAttr}>${esc(labelOf(u))}</option>`;
    }).join('');
    if (sel && !state.unidades.some((u) => String(u.unidade || '').toUpperCase() === sel)) {
      return `<option value="${esc(sel)}" selected>${esc(sel)}</option>${opts}`;
    }
    return opts;
  }

  function itemTabNav() {
    return `
      <nav class="imp-item-tabs" role="tablist">
        ${ITEM_TABS.map((t) => `
          <button type="button" class="imp-item-tab ${state.itemTab === t.id ? 'active' : ''}"
            data-item-tab="${t.id}" role="tab" aria-selected="${state.itemTab === t.id}">
            ${esc(t.label)}
          </button>
        `).join('')}
      </nav>
    `;
  }

  function panelVinculo(it, sys, xml) {
    const chips = [
      cmpHint(xml.cEAN, sys.cod_barras, 'EAN'),
      cmpHint(xml.NCM, sys.ncm, 'NCM'),
      cmpHint(xml.uCom, sys.uni_medida_xml || sys.uni_medida, 'Unid.'),
      cmpHint(xml.cProd, sys.cod_fornecedor, 'Cód.'),
    ].filter(Boolean).join('');
    return `
      <section class="imp-panel" data-panel="vinculo">
        <header class="imp-section-head">
          <h4>Comparar item da nota × estoque</h4>
          <span class="hint">Confira código, EAN e descrição antes de vincular</span>
        </header>
        <div class="imp-cmp-grid">
          <article class="imp-cmp-card nota">
            <header><span class="imp-cmp-tag">Na NF-e</span><strong>Entrada / fornecedor</strong></header>
            <p class="imp-cmp-title">${esc(xml.xProd || '—')}</p>
            <dl class="imp-cmp-dl">
              <div><dt>Cód. fornecedor</dt><dd>${esc(xml.cProd || '—')}</dd></div>
              <div><dt>EAN</dt><dd>${esc(xml.cEAN || '—')}</dd></div>
              <div><dt>NCM</dt><dd>${esc(xml.NCM || '—')}</dd></div>
              <div><dt>Qtd / unid.</dt><dd>${num(xml.qCom)} ${esc(xml.uCom || '')}</dd></div>
              <div><dt>Vlr unit.</dt><dd>${money(xml.vUnCom)}</dd></div>
              <div><dt>CFOP nota</dt><dd>${esc(xml.CFOP || '—')}</dd></div>
            </dl>
          </article>
          <article class="imp-cmp-card estoque ${sys.id_identificador || sys.criar_novo ? 'ok' : 'pending'}">
            <header><span class="imp-cmp-tag">No estoque</span><strong>Cadastro local</strong></header>
            <p class="imp-cmp-title">${esc(sys.descricao || (sys.criar_novo ? '(novo produto)' : 'Sem vínculo'))}</p>
            <dl class="imp-cmp-dl">
              <div><dt>ID ident.</dt><dd>${sys.id_identificador != null ? esc(sys.id_identificador) : (sys.criar_novo ? 'novo' : '—')}</dd></div>
              <div><dt>EAN</dt><dd>${esc(sys.cod_barras || '—')}</dd></div>
              <div><dt>NCM</dt><dd>${esc(sys.ncm || '—')}</dd></div>
              <div><dt>Unid. estoque</dt><dd>${esc(sys.uni_medida || '—')}</dd></div>
              <div><dt>Custo / venda</dt><dd>${money(sys.prc_custo)} / ${money(sys.prc_venda)}</dd></div>
              <div><dt>Cód. no fornec.</dt><dd>${esc(sys.cod_fornecedor || xml.cProd || '—')}</dd></div>
            </dl>
          </article>
        </div>
        ${chips ? `<div class="imp-cmp-chips">${chips}</div>` : ''}
        <div class="imp-field">
          <span>Buscar no estoque</span>
          <div class="imp-busca-row">
            <div class="search-field imp-busca-prod">
              <input id="imp-busca-prod" type="search" placeholder="ID, EAN ou descrição…" value="${esc(state.buscaProduto)}" autocomplete="off" />
              <button type="button" id="imp-limpar-busca-prod" class="btn-clear-search" ${state.buscaProduto ? '' : 'hidden'} title="Limpar busca" aria-label="Limpar busca">×</button>
            </div>
            <button type="button" id="imp-btn-scan-prod" class="btn icon-cam" title="Ler código de barras" aria-label="Ler código de barras">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7.2 10.1 5.8A1.4 1.4 0 0 1 11.25 5.2h1.5a1.4 1.4 0 0 1 1.15.6L15 7.2h3.1A2.1 2.1 0 0 1 20.2 9.3v8.1A2.1 2.1 0 0 1 18.1 19.5H5.9A2.1 2.1 0 0 1 3.8 17.4V9.3A2.1 2.1 0 0 1 5.9 7.2H9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13.1" r="3.05" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
            </button>
          </div>
        </div>
        <div id="imp-prod-resultados" class="imp-prod-list"></div>
        <div class="imp-vinc-atual" id="imp-vinc-atual">
          ${sys.id_identificador
    ? `<span class="chip ok">Vinculado: ID ${esc(sys.id_identificador)} · ${esc(sys.descricao)}</span>`
    : sys.criar_novo
      ? `<span class="chip warn">Será criado: ${esc(sys.descricao || xml.xProd)}</span>`
      : '<span class="chip pending">Nenhum produto vinculado — busque acima</span>'}
        </div>
        ${sys.criar_novo ? field('Descrição do novo produto', 'imp-desc-novo', sys.descricao || xml.xProd, { full: true }) : ''}
        <div class="imp-vinc-btns">
          <button type="button" class="btn small outline" id="imp-criar-novo">Criar como novo produto</button>
          <button type="button" class="btn small outline" id="imp-limpar-vinc">Limpar vínculo</button>
        </div>
      </section>
    `;
  }

  function panelEntrada(sys, xml, trib, imp, simples) {
    const csosnEnt = sys.csosn_entrada || sys.csosn || trib.csosn || '';
    const custoInfo = calcCustoNotaUnitario(sys, xml);
    const custoNota = sys.prc_custo_nota != null
      ? sys.prc_custo_nota
      : (custoInfo.custoXml || xml.vUnCom || 0);
    return `
      <section class="imp-panel" data-panel="entrada">
        <header class="imp-section-head">
          <h4>Tributos e custos de entrada</h4>
          <span class="hint">Custo unitário = valor da nota (sem conversão). CST/CSOSN: XML × sistema</span>
        </header>
        <div class="imp-fields">
          ${field('CFOP origem (nota)', 'imp-cfop-origem', sys.cfop_origem || xml.CFOP, { third: true, readonly: true })}
          ${searchableCodeField('CFOP entrada', 'imp-cfop', 'imp-busca-cfop', 'imp-cfop-list', sys.cfop, { half: true, placeholder: 'Buscar CFOP…' })}
          ${simples
    ? searchableCodeField('CSOSN entrada', 'imp-csosn-entrada', 'imp-busca-csosn-entrada', 'imp-csosn-entrada-list', csosnEnt, { third: true, placeholder: 'Pesquisar CSOSN…' })
    : field('CST (nota)', 'imp-cst-nota', sys.cst_icms || trib.cst_icms || imp.CST, { third: true, readonly: true })}
          ${field('Custo unitário', 'imp-custo', custoNota, { type: 'number', step: '0.0001', third: true })}
          ${field('Frete rateado', 'imp-frete', sys.v_frete, { type: 'number', step: '0.01', third: true })}
          ${field('Desconto', 'imp-desc-val', sys.v_desc, { type: 'number', step: '0.01', third: true })}
          ${field('Seguro', 'imp-seguro', sys.v_seguro, { type: 'number', step: '0.01', third: true })}
          ${field('Outras despesas', 'imp-outro', sys.v_outro, { type: 'number', step: '0.01', third: true })}
        </div>
        <div class="imp-trib-head"><span>Código</span><span>XML (nota)</span><span>Sistema</span></div>
        <div class="imp-trib-codes">
          ${tribRow('CST ICMS', imp.CST, 'imp-cst', trib.cst_icms || imp.CST, { readonly: true })}
          ${simples
    ? tribSearchRow('CSOSN', imp.CSOSN || '—', 'imp-csosn-trib', 'imp-busca-csosn-trib', 'imp-csosn-trib-list', sys.csosn_entrada || trib.csosn || sys.csosn)
    : '<div class="imp-trib-row imp-trib-spacer"></div>'}
          ${tribSearchRow('CST IPI', imp.CST_IPI, 'imp-cst-ipi', 'imp-busca-cst-ipi', 'imp-cst-ipi-list', trib.cst_ipi)}
          <div class="imp-trib-row imp-trib-spacer"></div>
          ${tribSearchRow('CST PIS', imp.CST_PIS, 'imp-cst-pis', 'imp-busca-cst-pis', 'imp-cst-pis-list', trib.cst_pis)}
          ${tribSearchRow('CST COFINS', imp.CST_COFINS, 'imp-cst-cof', 'imp-busca-cst-cof', 'imp-cst-cof-list', trib.cst_cofins)}
        </div>
        <p class="hint">Bases e valores de ICMS/ST/IPI/PIS/COFINS seguem o XML na gravação; aqui só os códigos.</p>
      </section>
    `;
  }

  function panelConversao(sys, xml, qtdXml, conversor, qtdConv) {
    const custoInfo = calcCustoNotaUnitario({ ...sys, conversor, qtd_xml: qtdXml, qtd: qtdConv }, xml);
    return `
      <section class="imp-panel" data-panel="conversao">
        <header class="imp-section-head">
          <h4>Conversão e quantidade</h4>
          <span class="hint">Entrada estoque = qtd XML × conversor · custo convertido alimenta o preço de custo</span>
        </header>
        <div class="imp-conv-summary">
          <div><span>Na nota</span><strong>${num(qtdXml)} ${esc(sys.uni_medida_xml || xml.uCom || '')}</strong></div>
          <div class="imp-conv-x">×</div>
          <div><span>Conversor</span><strong id="imp-conv-preview">${num(conversor)}</strong></div>
          <div class="imp-conv-x">=</div>
          <div><span>No estoque</span><strong id="imp-qtd-preview">${num(qtdConv)} ${esc(sys.uni_medida || '')}</strong></div>
        </div>
        <div class="imp-fields">
          ${field('Qtd XML', 'imp-qtd-xml', qtdXml, { type: 'number', step: '0.0001', third: true, readonly: true })}
          ${field('Unidade XML', 'imp-uni-xml', sys.uni_medida_xml || xml.uCom, { third: true, readonly: true })}
          <label class="imp-field third">
            <span>Unidade estoque</span>
            <select id="imp-uni">${unidadeOptions(sys.uni_medida || xml.uCom)}</select>
          </label>
          ${field('Conversor', 'imp-conversor', conversor, { type: 'number', step: '0.0001', third: true })}
          ${field('Entrada Estoque', 'imp-qtd', qtdConv, { type: 'number', step: '0.0001', third: true, readonly: true })}
          ${field('Custo Convertido', 'imp-custo-conv', custoInfo.custoEstoque, { type: 'number', step: '0.0001', third: true })}
        </div>
        <p class="hint">Custo Convertido = total líquido do item ÷ entrada estoque. Ao salvar, este valor alimenta o preço de custo.</p>
        <div class="imp-vinc-btns">
          <button type="button" class="btn small outline" id="imp-cad-unidade">Cadastrar unidade</button>
        </div>
      </section>
    `;
  }

  function calcCustoNotaUnitario(sys = {}, xml = {}) {
    const trib = sys.tributos || {};
    const imp = xml.imposto || {};
    const qtdXml = Number(sys.qtd_xml ?? xml.qCom ?? 0) || 0;
    const conversor = Number(sys.conversor ?? 1) || 1;
    const qtdEstoque = Number((qtdXml * conversor).toFixed(6)) || 0;

    const vProd = Number(xml.vProd != null ? xml.vProd : (Number(xml.vUnCom || 0) * qtdXml)) || 0;
    const vDesc = Number(sys.v_desc ?? xml.vDesc ?? 0) || 0;
    const vFrete = Number(sys.v_frete ?? xml.vFrete ?? 0) || 0;
    const vSeg = Number(sys.v_seguro ?? xml.vSeg ?? 0) || 0;
    const vOutro = Number(sys.v_outro ?? xml.vOutro ?? 0) || 0;
    const vIpi = Number(trib.v_ipi ?? imp.vIPI ?? 0) || 0;
    const vSt = Number(trib.v_icms_st ?? imp.vICMSST ?? 0) || 0;

    const totalItem = vProd - vDesc + vFrete + vSeg + vOutro + vIpi + vSt;
    const custoXml = qtdXml > 0 ? totalItem / qtdXml : totalItem;
    const custoEstoque = qtdEstoque > 0 ? totalItem / qtdEstoque : (conversor > 0 ? custoXml / conversor : custoXml);

    return {
      totalItem: Number(totalItem.toFixed(4)),
      custoXml: Number(custoXml.toFixed(6)),
      custoEstoque: Number(custoEstoque.toFixed(6)),
      qtdXml,
      qtdEstoque,
      conversor,
      vProd,
      vDesc,
      vFrete,
      vSeg,
      vOutro,
      vIpi,
      vSt,
    };
  }

  function panelSaida(sys, xml, vinculado, descEditable) {
    const custoInfo = calcCustoNotaUnitario(sys, xml);
    return `
      <section class="imp-panel" data-panel="saida">
        <header class="imp-section-head">
          <h4>Dados de saída (cadastro)</h4>
          <span class="hint">Margem LB calcula o preço de venda a partir do custo</span>
        </header>
        <div class="imp-custo-nota" id="imp-custo-nota">
          <span class="imp-custo-nota-tag">Custo da nota (líquido)</span>
          <strong>${money(custoInfo.custoEstoque)}</strong>
          <span class="hint">por unid. estoque · conversor ${esc(custoInfo.conversor)} · total item ${money(custoInfo.totalItem)}</span>
          <span class="hint">Base: prod ${money(custoInfo.vProd)} − desc ${money(custoInfo.vDesc)} + frete ${money(custoInfo.vFrete)} + seg ${money(custoInfo.vSeg)} + out ${money(custoInfo.vOutro)} + IPI ${money(custoInfo.vIpi)} + ST ${money(custoInfo.vSt)}</span>
        </div>
        <div class="imp-fields">
          ${field('ID identificador', 'imp-id-ident', sys.id_identificador ?? '', { third: true, readonly: true, disabled: true })}
          ${field('ID estoque', 'imp-id-estoque', sys.id_estoque ?? '', { third: true, readonly: true, disabled: true })}
          ${field('Descrição', 'imp-desc', sys.descricao || (vinculado ? xml.xProd : ''), { full: true, readonly: !descEditable })}
          ${field('Descrição complementar', 'imp-desc-cmpl', sys.desc_cmpl, { full: true })}
          ${field('Referência', 'imp-ref', sys.referencia, { half: true })}
          <label class="imp-field half imp-ean-field">
            <span>Código de barras</span>
            <div class="search-field imp-ean-scan">
              <input id="imp-ean" type="text" value="${esc(sys.cod_barras || '')}" autocomplete="off" inputmode="numeric" />
              <button type="button" id="imp-btn-scan-ean" class="btn icon-cam" title="Ler código de barras" aria-label="Ler código de barras">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7.2 10.1 5.8A1.4 1.4 0 0 1 11.25 5.2h1.5a1.4 1.4 0 0 1 1.15.6L15 7.2h3.1A2.1 2.1 0 0 1 20.2 9.3v8.1A2.1 2.1 0 0 1 18.1 19.5H5.9A2.1 2.1 0 0 1 3.8 17.4V9.3A2.1 2.1 0 0 1 5.9 7.2H9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13.1" r="3.05" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
              </button>
            </div>
          </label>
        </div>
        <div class="imp-block-title">Preço</div>
        <div class="imp-fields">
          ${field('Preço custo', 'imp-custo-ficha', sys.prc_custo ?? custoInfo.custoEstoque, { type: 'number', step: '0.0001', third: true })}
          ${field('Margem LB %', 'imp-margem', sys.margem_lb ?? 0, { type: 'number', step: '0.01', third: true })}
          ${field('Preço venda', 'imp-venda', sys.prc_venda, { type: 'number', step: '0.0001', third: true })}
          ${field('Status', 'imp-status-prod', sys.status || 'A', { third: true })}
          <label class="imp-field third imp-uni-compact">
            <span>Unidade</span>
            <input id="imp-uni-ficha" type="text" value="${esc(sys.uni_medida || xml.uCom || '')}" maxlength="6" />
          </label>
          ${searchableCodeField('CST', 'imp-cst-saida', 'imp-busca-cst-saida', 'imp-cst-saida-list', sys.cst_saida || sys.cst_icms || '', { third: true, placeholder: 'Pesquisar CST…' })}
          ${searchableCodeField('CST CF-e', 'imp-cst-cfe', 'imp-busca-cst-cfe', 'imp-cst-cfe-list', sys.cst_cfe || '', { third: true, placeholder: 'Pesquisar CST…' })}
        </div>
        <p class="hint" id="imp-margem-hint">Use o custo líquido da nota acima para definir a margem. Com margem &gt; 0: venda = custo × (1 + margem/100)</p>
        <div class="imp-vinc-btns">
          <button type="button" class="btn small outline" id="imp-usar-custo-nota">Usar custo da nota</button>
        </div>
      </section>
    `;
  }

  function calcCbsIbs(tn = {}, base = 0) {
    const aliqCbs = Number(tn.aliq_cbs != null ? tn.aliq_cbs : 0.9);
    const aliqIbsUf = Number(tn.aliq_ibs_uf != null ? tn.aliq_ibs_uf : 0.1);
    const aliqIbsMun = Number(tn.aliq_ibs_mun != null ? tn.aliq_ibs_mun : 0);
    const redCbs = Number(tn.percent_red_aliq_cbs || 0);
    const redIbs = Number(tn.percent_red_aliq_ibs || 0);
    const efetCbs = aliqCbs * (1 - Math.min(100, Math.max(0, redCbs)) / 100);
    const efetIbsUf = aliqIbsUf * (1 - Math.min(100, Math.max(0, redIbs)) / 100);
    const efetIbsMun = aliqIbsMun * (1 - Math.min(100, Math.max(0, redIbs)) / 100);
    const bc = Number(base || 0);
    return {
      vlr_bc_cbs: Number(bc.toFixed(2)),
      vlr_bc_ibs: Number(bc.toFixed(2)),
      aliq_cbs: aliqCbs,
      aliq_ibs_uf: aliqIbsUf,
      aliq_ibs_mun: aliqIbsMun,
      percent_red_aliq_cbs: redCbs,
      percent_red_aliq_ibs: redIbs,
      aliq_efetiva_cbs: Number(efetCbs.toFixed(4)),
      aliq_efetiva_ibs_uf: Number(efetIbsUf.toFixed(4)),
      aliq_efetiva_ibs_mun: Number(efetIbsMun.toFixed(4)),
      vlr_cbs: Number((bc * efetCbs / 100).toFixed(2)),
      vlr_ibs_uf: Number((bc * efetIbsUf / 100).toFixed(2)),
      vlr_ibs_mun: Number((bc * efetIbsMun / 100).toFixed(2)),
      vlr_ibs_tot: Number((bc * (efetIbsUf + efetIbsMun) / 100).toFixed(2)),
    };
  }

  function applySimplesPisCofinsRates(trib = {}, simples) {
    if (!simples) return trib;
    const cst = String(trib.cst_pis_saida || trib.cst_pis || '').replace(/\D/g, '').padStart(2, '0').slice(-2);
    if (cst === '01' || cst === '05') {
      return { ...trib, p_pis: 0.65, p_cofins: 3 };
    }
    return trib;
  }

  function panelTribSaida(sys, trib, tn, tc, simples, xml = {}) {
    const aplicar = ynChecked(sys.aplicar_saida !== undefined ? sys.aplicar_saida : 'S');
    const tribOut = applySimplesPisCofinsRates(trib, simples);
    const custoInfo = calcCustoNotaUnitario(sys, xml);
    const cbs = calcCbsIbs(tn, tn.vlr_bc_cbs != null && tn.vlr_bc_cbs !== '' ? tn.vlr_bc_cbs : custoInfo.totalItem);
    return `
      <section class="imp-panel" data-panel="trib_saida">
        <header class="imp-section-head">
          <h4>Tributos de saída</h4>
          <span class="hint">Opcional — desmarque se o contador definir a saída</span>
        </header>
        <label class="imp-check imp-aplicar-saida">
          <input type="checkbox" id="imp-aplicar-saida" ${aplicar ? 'checked' : ''} />
          Aplicar tributação de saída neste item (se desmarcado, grava só a entrada)
        </label>
        <div class="imp-saida-block ${aplicar ? '' : 'is-off'}" id="imp-saida-block">
          <div class="imp-fields">
            ${field('NCM', 'imp-ncm', sys.ncm || xml.NCM || '', { third: true })}
            ${comboField('CEST', 'imp-cest', 'imp-cest-list', sys.cest || '', { third: true, placeholder: 'Pesquisar CEST (filtrado pelo NCM)…' })}
            ${searchableCodeField('CFOP saída NF-e', 'imp-cfop-saida', 'imp-busca-cfop-saida', 'imp-cfop-saida-list', sys.cfop_saida || '', { third: true, placeholder: 'Pesquisar CFOP…' })}
            ${searchableCodeField('CFOP CF-e', 'imp-cfop-nf', 'imp-busca-cfop-nf', 'imp-cfop-nf-list', sys.cfop_nf || '', { third: true, placeholder: 'Pesquisar CFOP…' })}
            ${searchableCodeField('CST saída NF-e', 'imp-cst-saida', 'imp-busca-cst-saida', 'imp-cst-saida-list', sys.cst_saida || trib.cst_icms || sys.cst_icms || '', { third: true, placeholder: 'Pesquisar CST…' })}
            ${searchableCodeField('CST CF-e', 'imp-cst-cfe', 'imp-busca-cst-cfe', 'imp-cst-cfe-list', sys.cst_cfe || '', { third: true, placeholder: 'Pesquisar CST…' })}
            ${simples
    ? searchableCodeField('CSOSN saída NF-e', 'imp-csosn-saida', 'imp-busca-csosn-saida', 'imp-csosn-saida-list', sys.csosn_saida || '', { third: true, placeholder: 'Pesquisar CSOSN…' })
    : ''}
            ${simples
    ? searchableCodeField('CSOSN CF-e', 'imp-csosn-cfe', 'imp-busca-csosn-cfe', 'imp-csosn-cfe-list', sys.csosn_cfe || '', { third: true, placeholder: 'Pesquisar CSOSN…' })
    : ''}
            ${searchableCodeField('CST PIS saída', 'imp-cst-pis-saida', 'imp-busca-cst-pis-saida', 'imp-cst-pis-saida-list', tribOut.cst_pis_saida || tribOut.cst_pis || '', { third: true, placeholder: 'Pesquisar CST PIS…' })}
            ${field('% PIS', 'imp-ppis-saida', tribOut.p_pis ?? 0, { type: 'number', step: '0.0001', third: true })}
            ${searchableCodeField('CST COFINS saída', 'imp-cst-cof-saida', 'imp-busca-cst-cof-saida', 'imp-cst-cof-saida-list', tribOut.cst_cofins_saida || tribOut.cst_cofins || '', { third: true, placeholder: 'Pesquisar CST COFINS…' })}
            ${field('% COFINS', 'imp-pcof-saida', tribOut.p_cofins ?? 0, { type: 'number', step: '0.0001', third: true })}
            ${comboField('Taxa ICMS', 'imp-cti', 'imp-cti-list', sys.id_cti || '', { half: true, displayLabel: sys._cti_label || sys.id_cti || '', placeholder: 'Pesquisar pela descrição da taxa…' })}
            ${comboField('Taxa CFE', 'imp-cti-cfe', 'imp-cti-cfe-list', sys.id_cti_cfe || '', { half: true, displayLabel: sys._cti_cfe_label || sys.id_cti_cfe || '', placeholder: 'Pesquisar pela descrição…' })}
          </div>
          <div class="imp-block-title">Reforma Tributária — CBS / IBS</div>
          <div class="imp-fields">
            ${comboField('Classificação tributária CBS/IBS — NF-e', 'imp-nfe-class', 'imp-class-nfe-list', tn.id_class_trib ?? '', {
    full: true,
    displayId: 'imp-busca-class-nfe',
    displayLabel: tn._class_label || (tn.id_class_trib != null ? String(tn.id_class_trib) : ''),
    placeholder: 'Pesquisar classificação…',
  })}
            ${field('Base CBS/IBS', 'imp-nfe-bc-cbs', cbs.vlr_bc_cbs, { type: 'number', step: '0.01', third: true })}
            ${field('Alíq. CBS %', 'imp-nfe-aliq-cbs-pad', cbs.aliq_cbs, { type: 'number', step: '0.0001', third: true })}
            ${field('Alíq. IBS UF %', 'imp-nfe-aliq-ibs-uf', cbs.aliq_ibs_uf, { type: 'number', step: '0.0001', third: true })}
            ${field('% red. alíq. CBS', 'imp-nfe-red-cbs', cbs.percent_red_aliq_cbs, { type: 'number', step: '0.0001', third: true, readonly: true })}
            ${field('% red. alíq. IBS', 'imp-nfe-red-ibs', cbs.percent_red_aliq_ibs, { type: 'number', step: '0.0001', third: true, readonly: true })}
            ${field('CST class. trib.', 'imp-nfe-cst-class', tn.cst_class_trib || '', { third: true, readonly: true })}
            ${field('Alíq. efetiva CBS', 'imp-nfe-efet-cbs', cbs.aliq_efetiva_cbs, { type: 'number', step: '0.0001', third: true, readonly: true })}
            ${field('Alíq. efetiva IBS UF', 'imp-nfe-efet-ibs-uf', cbs.aliq_efetiva_ibs_uf, { type: 'number', step: '0.0001', third: true, readonly: true })}
            ${field('Vlr CBS', 'imp-nfe-vlr-cbs', cbs.vlr_cbs, { type: 'number', step: '0.01', third: true, readonly: true })}
            ${field('Vlr IBS UF', 'imp-nfe-vlr-ibs-uf', cbs.vlr_ibs_uf, { type: 'number', step: '0.01', third: true, readonly: true })}
            ${field('Vlr IBS total', 'imp-nfe-vlr-ibs-tot', cbs.vlr_ibs_tot, { type: 'number', step: '0.01', third: true, readonly: true })}
            ${field('Diferimento CBS', 'imp-nfe-dif-cbs', tn.diferimento_cbs ?? 0, { type: 'number', step: '0.0001', third: true })}
            ${field('Cód. créd. pres. CBS', 'imp-nfe-cod-cbs', tn.cod_cred_presu_cbs || '', { third: true })}
            ${field('Alíq. créd. pres. CBS', 'imp-nfe-aliq-cbs', tn.aliq_cred_presu_cbs ?? 0, { type: 'number', step: '0.0001', third: true })}
            ${field('Diferimento IBS UF', 'imp-nfe-dif-ibs-uf', tn.diferimento_ibs_uf ?? 0, { type: 'number', step: '0.0001', third: true })}
            ${field('Diferimento IBS Mun', 'imp-nfe-dif-ibs-mun', tn.diferimento_ibs_mun ?? 0, { type: 'number', step: '0.0001', third: true })}
            ${field('Cód. créd. pres. IBS', 'imp-nfe-cod-ibs', tn.cod_cred_presu_ibs || '', { third: true })}
            ${field('Alíq. créd. pres. IBS', 'imp-nfe-aliq-ibs', tn.aliq_cred_presu_ibs ?? 0, { type: 'number', step: '0.0001', third: true })}
            ${field('Class. trib. regular', 'imp-nfe-class-reg', tn.id_class_trib_regular ?? '', { third: true })}
            <label class="imp-check imp-field third">
              <input type="checkbox" id="imp-nfe-deduz-cbs" ${ynChecked(tn.deduz_cred_presu_cbs) ? 'checked' : ''} />
              Deduz créd. pres. CBS
            </label>
            <label class="imp-check imp-field third">
              <input type="checkbox" id="imp-nfe-deduz-ibs" ${ynChecked(tn.deduz_cred_presu_ibs) ? 'checked' : ''} />
              Deduz créd. pres. IBS
            </label>
            <label class="imp-check imp-field third">
              <input type="checkbox" id="imp-nfe-bem-usado" ${ynChecked(tn.ind_bem_movel_usado) ? 'checked' : ''} />
              Bem móvel usado
            </label>
          </div>
          <div class="imp-fields">
            ${comboField('Classificação tributária NFC-e', 'imp-nfce-class', 'imp-class-nfce-list', tc.id_class_trib ?? '', {
    full: true,
    displayId: 'imp-busca-class-nfce',
    displayLabel: tc._class_label || (tc.id_class_trib != null ? String(tc.id_class_trib) : ''),
    placeholder: 'Pesquisar classificação…',
  })}
            ${field('% red. alíq. CBS', 'imp-nfce-red-cbs', tc.percent_red_aliq_cbs ?? '', { type: 'number', step: '0.0001', third: true, readonly: true })}
            ${field('% red. alíq. IBS', 'imp-nfce-red-ibs', tc.percent_red_aliq_ibs ?? '', { type: 'number', step: '0.0001', third: true, readonly: true })}
            ${field('Diferimento CBS', 'imp-nfce-dif-cbs', tc.diferimento_cbs ?? 0, { type: 'number', step: '0.0001', third: true })}
            ${field('Diferimento IBS UF', 'imp-nfce-dif-ibs-uf', tc.diferimento_ibs_uf ?? 0, { type: 'number', step: '0.0001', third: true })}
            ${field('Diferimento IBS Mun', 'imp-nfce-dif-ibs-mun', tc.diferimento_ibs_mun ?? 0, { type: 'number', step: '0.0001', third: true })}
          </div>
        </div>
      </section>
    `;
  }

  function panelAnp(sys) {
    return `
      <section class="imp-panel" data-panel="anp">
        <header class="imp-section-head">
          <h4>Código ANP</h4>
          <span class="hint">Obrigatório para combustíveis — TB_COD_PROD_ANP</span>
        </header>
        <div class="imp-fields">
          ${field('Código ANP', 'imp-anp', sys.anp || '', { half: true })}
          <label class="imp-field full">
            <span>Buscar produto ANP</span>
            <input id="imp-busca-anp" type="search" placeholder="Código ou descrição…" value="" />
          </label>
        </div>
        <div id="imp-anp-list" class="imp-prod-list"></div>
        <label class="imp-field full">
          <span>Observação do item</span>
          <input id="imp-obs" type="text" value="${esc(itemAt(state.itemIndex)?.observacao || '')}" placeholder="Opcional" />
        </label>
      </section>
    `;
  }

  async function hydrateClassTribRates(sys) {
    if (!sys) return;
    for (const key of ['trib_nfe', 'trib_nfce']) {
      const t = sys[key];
      if (!t?.id_class_trib) continue;
      if (t._class_hydrated) continue;
      try {
        const res = await api(`/importacao/class-trib?id=${encodeURIComponent(t.id_class_trib)}`);
        const c = (res.itens || [])[0];
        if (!c) {
          sys[key] = { ...t, _class_hydrated: true };
          continue;
        }
        sys[key] = {
          ...t,
          _class_label: `${c.cod_class_trib} — ${c.desc_class_trib}`,
          _class_cod: c.cod_class_trib,
          percent_red_aliq_cbs: c.percent_red_aliq_cbs,
          percent_red_aliq_ibs: c.percent_red_aliq_ibs,
          cst_class_trib: c.cst_class_trib || t.cst_class_trib || '',
          _class_hydrated: true,
        };
        if (key === 'trib_nfe') {
          const it = itemAt(state.itemIndex);
          const base = Number(sys[key].vlr_bc_cbs)
            || calcCustoNotaUnitario(sys, it?.xml || {}).totalItem
            || 0;
          Object.assign(sys[key], calcCbsIbs(sys[key], base));
        }
      } catch (_) { /* ignore */ }
    }
  }

  async function hydrateTaxaLabels(sys) {
    if (!sys) return;
    const loadOne = async (id, labelKey) => {
      if (!id || sys[labelKey]) return;
      try {
        const res = await api(`/importacao/taxa-uf?q=${encodeURIComponent(id)}`);
        const hit = (res.itens || []).find((x) => String(x.id_cti) === String(id))
          || (res.itens || [])[0];
        if (hit) sys[labelKey] = hit.descricao || hit.id_cti;
      } catch (_) { /* ignore */ }
    };
    await loadOne(sys.id_cti, '_cti_label');
    await loadOne(sys.id_cti_cfe, '_cti_cfe_label');
  }

  async function renderItemScreen() {
    const it = itemAt(state.itemIndex);
    const host = $('#imp-item-host');
    if (!it || !host) return;
    await ensureUnidades();
    const simples = await ensureEmitenteFiscal();
    await hydrateClassTribRates(it.sistema || {});
    await hydrateTaxaLabels(it.sistema || {});

    const s = state.sessao;
    const sys = it.sistema || {};
    const xml = it.xml || {};
    const imp = xml.imposto || {};
    const trib = sys.tributos || {};
    const tn = sys.trib_nfe || {};
    const tc = sys.trib_nfce || {};
    const total = s?.itens?.length || 0;
    const [stLbl, stCls] = statusLabel(it.status);
    const vinculado = !!sys.id_identificador || !!sys.criar_novo;
    const descEditable = !!sys.criar_novo || !!sys.id_identificador;
    const qtdXml = Number(sys.qtd_xml ?? xml.qCom ?? 0);
    const conversor = Number(sys.conversor ?? 1) || 1;
    const qtdConv = Number((qtdXml * conversor).toFixed(6));
    const tab = state.itemTab || 'vinculo';
    const isLastTab = tab === 'anp';

    let panelHtml = '';
    if (tab === 'vinculo') panelHtml = panelVinculo(it, sys, xml);
    else if (tab === 'entrada') panelHtml = panelEntrada(sys, xml, trib, imp, simples);
    else if (tab === 'conversao') panelHtml = panelConversao(sys, xml, qtdXml, conversor, qtdConv);
    else if (tab === 'saida') panelHtml = panelSaida(sys, xml, vinculado, descEditable);
    else if (tab === 'trib_saida') panelHtml = panelTribSaida(sys, trib, tn, tc, simples, xml);
    else panelHtml = panelAnp(sys);

    const footerHtml = isLastTab
      ? `
        <button type="button" class="btn outline" id="imp-salvar-item">Salvar item</button>
        <label class="imp-check">
          <input type="checkbox" id="imp-conferido" ${it.conferido ? 'checked' : ''} />
          Item verificado
        </label>
        <button type="button" class="btn primary" id="imp-salvar-proximo">
          ${state.itemIndex < total - 1 ? 'Salvar e próximo →' : 'Salvar e voltar'}
        </button>`
      : `<button type="button" class="btn primary" id="imp-proxima-etapa">Próxima etapa →</button>`;

    host.innerHTML = `
      <div class="imp-item-toolbar">
        <button type="button" class="btn" id="imp-item-voltar">← Itens</button>
        <div class="imp-item-nav">
          <button type="button" class="btn small" id="imp-item-prev" ${state.itemIndex <= 0 ? 'disabled' : ''}>← Anterior</button>
          <span>Item ${it.nItem} / ${total}</span>
          <button type="button" class="btn small" id="imp-item-next" ${state.itemIndex >= total - 1 ? 'disabled' : ''}>Próximo →</button>
        </div>
        <span class="imp-status ${stCls}">${stLbl}</span>
      </div>
      ${itemTabNav()}
      <div class="imp-item-scroll">
        ${panelHtml}
      </div>
      <div class="imp-item-footer">
        ${footerHtml}
      </div>
    `;

    bindItemEvents(it);
    if (tab === 'vinculo') loadProdutosBusca(state.buscaProduto);
  }

  async function loadProdutosBusca(q) {
    const box = $('#imp-prod-resultados');
    if (!box) return;
    if (!String(q || '').trim()) {
      box.innerHTML = '<p class="hint">Digite para buscar produtos do estoque</p>';
      return;
    }
    const res = await deps.api(`/estoque?q=${encodeURIComponent(q)}`);
    const list = res.itens || [];
    if (!list.length) {
      box.innerHTML = '<p class="hint">Nenhum produto encontrado no estoque</p>';
      return;
    }
    box.innerHTML = list.slice(0, 20).map((p) => `
      <button type="button" class="imp-prod-opt"
        data-id="${p.id_identificador}"
        data-estoque="${p.id_estoque ?? ''}"
        data-desc="${esc(p.descricao)}"
        data-ean="${esc(p.cod_barras || '')}"
        data-uni="${esc(p.uni_medida || '')}"
        data-ref="${esc(p.referencia || '')}"
        data-custo="${p.prc_custo ?? ''}"
        data-venda="${p.prc_venda ?? ''}">
        <strong>ID ${p.id_identificador}${p.id_estoque != null ? ` · Est. ${p.id_estoque}` : ''}</strong>
        <span>${esc(p.descricao)}</span>
        <span class="hint">EAN ${esc(p.cod_barras || '—')}${p.referencia ? ` · Ref. ${esc(p.referencia)}` : ''}</span>
      </button>
    `).join('');
    $$('.imp-prod-opt', box).forEach((btn) => {
      btn.addEventListener('click', () => {
        applyVinculo({
          id_identificador: Number(btn.dataset.id),
          id_estoque: btn.dataset.estoque !== '' ? Number(btn.dataset.estoque) : null,
          descricao: btn.dataset.desc,
          cod_barras: btn.dataset.ean,
          referencia: btn.dataset.ref || undefined,
          uni_medida: btn.dataset.uni || undefined,
          prc_custo: btn.dataset.custo !== '' ? Number(btn.dataset.custo) : undefined,
          prc_venda: btn.dataset.venda !== '' ? Number(btn.dataset.venda) : undefined,
          criar_novo: false,
        });
      });
    });
  }

  async function loadClassTrib(q, target) {
    const listId = target === 'nfce' ? '#imp-class-nfce-list' : '#imp-class-nfe-list';
    const hiddenId = target === 'nfce' ? '#imp-nfce-class' : '#imp-nfe-class';
    const box = $(listId);
    if (!box) return;
    const term = String(q || '').trim();
    if (!term) {
      box.innerHTML = '<p class="hint">Digite código ou descrição (TB_CLASS_TRIB)</p>';
      return;
    }
    const res = await api(`/importacao/class-trib?q=${encodeURIComponent(term)}`);
    const list = res.itens || [];
    if (!list.length) {
      box.innerHTML = '<p class="hint">Nenhuma classificação encontrada em TB_CLASS_TRIB</p>';
      return;
    }
    box.innerHTML = list.map((c) => `
      <button type="button" class="imp-prod-opt imp-class-opt"
        data-id="${c.id_class_trib}"
        data-label="${esc(c.cod_class_trib)} — ${esc(c.desc_class_trib)}"
        data-red-cbs="${c.percent_red_aliq_cbs ?? 0}"
        data-red-ibs="${c.percent_red_aliq_ibs ?? 0}"
        data-cst="${esc(c.cst_class_trib || '')}">
        <strong>${esc(c.cod_class_trib)}</strong>
        <span>${esc(c.desc_class_trib)}</span>
        <span class="hint">Red. CBS ${num(c.percent_red_aliq_cbs)}% · IBS ${num(c.percent_red_aliq_ibs)}%${c.cst_class_trib ? ` · CST ${esc(c.cst_class_trib)}` : ''}</span>
      </button>
    `).join('');
    $$('.imp-class-opt', box).forEach((btn) => {
      btn.addEventListener('click', () => {
        const hid = $(hiddenId);
        const inp = $(target === 'nfce' ? '#imp-busca-class-nfce' : '#imp-busca-class-nfe');
        if (hid) hid.value = btn.dataset.id;
        if (inp) inp.value = btn.dataset.label;
        const redCbs = btn.dataset.redCbs;
        const redIbs = btn.dataset.redIbs;
        const cst = btn.dataset.cst || '';
        if (target === 'nfce') {
          if ($('#imp-nfce-red-cbs')) $('#imp-nfce-red-cbs').value = redCbs;
          if ($('#imp-nfce-red-ibs')) $('#imp-nfce-red-ibs').value = redIbs;
        } else {
          if ($('#imp-nfe-red-cbs')) $('#imp-nfe-red-cbs').value = redCbs;
          if ($('#imp-nfe-red-ibs')) $('#imp-nfe-red-ibs').value = redIbs;
          if ($('#imp-nfe-cst-class')) $('#imp-nfe-cst-class').value = cst;
        }
        const it = itemAt(state.itemIndex);
        if (it?.sistema) {
          const key = target === 'nfce' ? 'trib_nfce' : 'trib_nfe';
          it.sistema[key] = {
            ...(it.sistema[key] || {}),
            id_class_trib: Number(btn.dataset.id),
            _class_label: btn.dataset.label,
            percent_red_aliq_cbs: Number(redCbs || 0),
            percent_red_aliq_ibs: Number(redIbs || 0),
            cst_class_trib: cst,
          };
        }
        box.innerHTML = `<p class="hint">Selecionado: ${esc(btn.dataset.label)} (CBS/IBS de TB_CLASS_TRIB)</p>`;
      });
    });
  }

  async function loadAnpBusca(q) {
    const box = $('#imp-anp-list');
    if (!box) return;
    const term = String(q || '').trim();
    if (!term) {
      box.innerHTML = '<p class="hint">Digite código ou nome do produto ANP</p>';
      return;
    }
    const res = await api(`/importacao/anp?q=${encodeURIComponent(term)}`);
    const list = res.itens || [];
    if (!list.length) {
      box.innerHTML = '<p class="hint">Nenhum código ANP encontrado</p>';
      return;
    }
    box.innerHTML = list.map((a) => `
      <button type="button" class="imp-prod-opt" data-cod="${esc(a.codigo)}" data-nome="${esc(a.produto)}">
        <strong>${esc(a.codigo)}</strong>
        <span>${esc(a.produto)}</span>
      </button>
    `).join('');
    $$('.imp-prod-opt', box).forEach((btn) => {
      btn.addEventListener('click', () => {
        if ($('#imp-anp')) $('#imp-anp').value = btn.dataset.cod;
        box.innerHTML = `<p class="hint">Selecionado: ${esc(btn.dataset.cod)} — ${esc(btn.dataset.nome)}</p>`;
      });
    });
  }

  async function loadCestBusca(q) {
    const box = $('#imp-cest-list');
    if (!box) return;
    const term = String(q || '').trim();
    const ncm = String($('#imp-ncm')?.value || itemAt(state.itemIndex)?.sistema?.ncm
      || itemAt(state.itemIndex)?.xml?.NCM || '').replace(/\D/g, '');
    if (!term && !ncm) {
      box.innerHTML = '';
      return;
    }
    const qs = new URLSearchParams();
    if (term) qs.set('q', term);
    if (ncm) qs.set('ncm', ncm);
    const res = await api(`/importacao/cest?${qs.toString()}`);
    const list = res.itens || [];
    if (!list.length) {
      box.innerHTML = ncm
        ? `<p class="hint">Nenhum CEST compatível com NCM ${esc(ncm)}</p>`
        : '<p class="hint">Nenhum CEST encontrado</p>';
      return;
    }
    box.innerHTML = list.map((c) => `
      <button type="button" class="imp-prod-opt" data-cest="${esc(c.cest)}" data-ncm="${esc(c.ncm)}">
        <strong>${esc(c.cest)}</strong>
        <span>NCM ${esc(c.ncm)} · ${esc(c.descricao)}</span>
      </button>
    `).join('');
    $$('.imp-prod-opt', box).forEach((btn) => {
      btn.addEventListener('click', () => {
        if ($('#imp-cest')) $('#imp-cest').value = btn.dataset.cest;
        if ($('#imp-ncm') && btn.dataset.ncm && !$('#imp-ncm').value) {
          $('#imp-ncm').value = btn.dataset.ncm;
        }
        box.innerHTML = `<p class="hint">CEST ${esc(btn.dataset.cest)} selecionado</p>`;
      });
    });
  }

  function syncQtdConvertida() {
    const qtdXml = Number($('#imp-qtd-xml')?.value || 0);
    const conv = Number($('#imp-conversor')?.value || 1) || 1;
    const qtdConv = Number((qtdXml * conv).toFixed(6));
    const out = $('#imp-qtd');
    if (out) out.value = String(qtdConv);
    const prevConv = $('#imp-conv-preview');
    const prevQtd = $('#imp-qtd-preview');
    if (prevConv) prevConv.textContent = String(conv);
    if (prevQtd) {
      const uni = $('#imp-uni')?.value || '';
      prevQtd.textContent = `${qtdConv} ${uni}`.trim();
    }
    const it = itemAt(state.itemIndex);
    if (it) {
      const custoInfo = calcCustoNotaUnitario({
        ...(it.sistema || {}),
        conversor: conv,
        qtd_xml: qtdXml,
        qtd: qtdConv,
        v_desc: Number($('#imp-desc-val')?.value ?? it.sistema?.v_desc ?? 0),
        v_frete: Number($('#imp-frete')?.value ?? it.sistema?.v_frete ?? 0),
        v_seguro: Number($('#imp-seguro')?.value ?? it.sistema?.v_seguro ?? 0),
        v_outro: Number($('#imp-outro')?.value ?? it.sistema?.v_outro ?? 0),
      }, it.xml || {});
      const custoEl = $('#imp-custo-conv');
      if (custoEl) custoEl.value = String(custoInfo.custoEstoque);
      // Aba Entrada mantém o unitário da nota (sem conversão)
      const custoEntrada = $('#imp-custo');
      if (custoEntrada && !(Number(custoEntrada.value) > 0)) {
        custoEntrada.value = String(custoInfo.custoXml);
      }
      const custoFicha = $('#imp-custo-ficha');
      if (custoFicha) custoFicha.value = String(custoInfo.custoEstoque);
    }
  }

  function applySugestoesRegra(sys, regra, estFornec) {
    if (!sys) return;
    if (regra) {
      if (regra.id_regra) sys.id_regra = regra.id_regra;
      if (regra.cfop_entrada && !sys.cfop) sys.cfop = regra.cfop_entrada;
      if (regra.cfop_saida) sys.cfop_saida = regra.cfop_saida;
      if (regra.cfop_nf) sys.cfop_nf = regra.cfop_nf;
      if (regra.cst_entrada || regra.cst) {
        const cstE = regra.cst_entrada || regra.cst;
        sys.cst_icms = cstE;
        sys.tributos = { ...(sys.tributos || {}), cst_icms: cstE };
      }
      if (regra.cst_saida) sys.cst_saida = regra.cst_saida;
      if (regra.cst_cfe) sys.cst_cfe = regra.cst_cfe;
      if (regra.csosn_entrada) sys.csosn_entrada = regra.csosn_entrada;
      if (regra.csosn_saida || regra.csosn) {
        sys.csosn_saida = regra.csosn_saida || regra.csosn;
      }
      if (regra.csosn_cfe) sys.csosn_cfe = regra.csosn_cfe;
      if (regra.cst_pis_entrada || regra.cst_pis) {
        sys.tributos = { ...(sys.tributos || {}), cst_pis: regra.cst_pis_entrada || regra.cst_pis };
      }
      if (regra.cst_pis_saida) {
        sys.tributos = { ...(sys.tributos || {}), cst_pis_saida: regra.cst_pis_saida };
      }
      if (regra.cst_cofins_entrada || regra.cst_cofins) {
        sys.tributos = { ...(sys.tributos || {}), cst_cofins: regra.cst_cofins_entrada || regra.cst_cofins };
      }
      if (regra.cst_cofins_saida) {
        sys.tributos = { ...(sys.tributos || {}), cst_cofins_saida: regra.cst_cofins_saida };
      }
      if (regra.pis != null) sys.tributos = { ...(sys.tributos || {}), p_pis: regra.pis };
      if (regra.cofins != null) sys.tributos = { ...(sys.tributos || {}), p_cofins: regra.cofins };
      if (regra.id_cti) sys.id_cti = regra.id_cti;
      if (regra.id_cti_cfe) sys.id_cti_cfe = regra.id_cti_cfe;
      if (regra.aplicar_saida !== undefined && regra.aplicar_saida !== null) {
        sys.aplicar_saida = (regra.aplicar_saida === true || regra.aplicar_saida === 'S') ? 'S' : 'N';
      }
      if (regra.id_class_trib) {
        sys.trib_nfe = { ...(sys.trib_nfe || {}), id_class_trib: regra.id_class_trib };
      }
      if (regra.id_class_trib_nfce) {
        sys.trib_nfce = { ...(sys.trib_nfce || {}), id_class_trib: regra.id_class_trib_nfce };
      }
    }
    if (estFornec) {
      if (estFornec.cod_no_fornecedor) sys.cod_fornecedor = estFornec.cod_no_fornecedor;
      if (estFornec.cfop && !sys.cfop) sys.cfop = estFornec.cfop;
      if (estFornec.cst) {
        sys.cst_icms = estFornec.cst;
        sys.tributos = { ...(sys.tributos || {}), cst_icms: estFornec.cst };
      }
      if (estFornec.csosn) {
        sys.csosn_saida = estFornec.csosn;
      }
      if (estFornec.cst_pis) sys.tributos = { ...(sys.tributos || {}), cst_pis: estFornec.cst_pis };
      if (estFornec.cst_cofins) sys.tributos = { ...(sys.tributos || {}), cst_cofins: estFornec.cst_cofins };
      if (estFornec.pis != null) sys.tributos = { ...(sys.tributos || {}), p_pis: estFornec.pis };
      if (estFornec.cofins != null) sys.tributos = { ...(sys.tributos || {}), p_cofins: estFornec.cofins };
      if (estFornec.uni_medida) sys.uni_medida = estFornec.uni_medida;
      if (estFornec.cod_barras && !sys.cod_barras) sys.cod_barras = estFornec.cod_barras;
    }
  }

  async function applyVinculo(patch) {
    const it = itemAt(state.itemIndex);
    if (!it) return;
    const merged = { ...patch };
    if (merged.prc_custo === undefined) delete merged.prc_custo;
    if (merged.prc_venda === undefined) delete merged.prc_venda;
    if (merged.uni_medida === undefined) delete merged.uni_medida;
    if (merged.referencia === undefined) delete merged.referencia;
    it.sistema = { ...it.sistema, ...merged };
    if (patch.id_identificador) {
      it.match = {
        id_identificador: patch.id_identificador,
        id_estoque: patch.id_estoque ?? null,
        descricao: patch.descricao,
        cod_barras: patch.cod_barras,
        origem_match: 'manual',
        confianca: 100,
      };
      it.sistema.criar_novo = false;

      try {
        const fiscal = await api(`/importacao/produto-fiscal/${patch.id_identificador}`);
        if (fiscal.ok && fiscal.item) {
          const f = fiscal.item;
          Object.assign(it.sistema, {
            id_estoque: f.id_estoque ?? it.sistema.id_estoque,
            descricao: f.descricao || it.sistema.descricao,
            desc_cmpl: f.desc_cmpl || it.sistema.desc_cmpl || '',
            referencia: f.referencia || it.sistema.referencia || '',
            cod_barras: f.cod_barras || it.sistema.cod_barras || '',
            uni_medida: f.uni_medida || it.sistema.uni_medida,
            prc_custo: it.sistema.prc_custo ?? f.prc_custo,
            prc_venda: f.prc_venda ?? it.sistema.prc_venda,
            margem_lb: f.margem_lb || 0,
            ncm: f.ncm || it.sistema.ncm,
            cest: f.cest || it.sistema.cest || '',
            anp: f.anp || it.sistema.anp || '',
            cfop_saida: f.cfop || it.sistema.cfop_saida || '',
            cfop_nf: f.cfop_nf || it.sistema.cfop_nf || '',
            csosn_saida: f.csosn || it.sistema.csosn_saida || '',
            csosn_cfe: f.csosn_cfe || it.sistema.csosn_cfe || '',
            cst_saida: f.cst || it.sistema.cst_saida || '',
            cst_cfe: f.cst_cfe || it.sistema.cst_cfe || '',
            id_cti: f.id_cti || '',
            id_cti_cfe: f.id_cti_cfe || '',
            _cti_label: '',
            _cti_cfe_label: '',
            status: f.status || 'A',
            id_grupo: f.id_grupo,
          });
          if (f.margem_lb > 0 && it.sistema.prc_custo > 0) {
            const calc = calcVendaPorMargem(it.sistema.prc_custo, f.margem_lb);
            if (calc != null) it.sistema.prc_venda = calc;
          }
          it.sistema.tributos = {
            ...(it.sistema.tributos || {}),
            cst_icms: f.cst || it.sistema.tributos?.cst_icms,
            cst_pis: f.cst_pis || it.sistema.tributos?.cst_pis,
            cst_cofins: f.cst_cofins || it.sistema.tributos?.cst_cofins,
            p_pis: f.pis ?? it.sistema.tributos?.p_pis,
            p_cofins: f.cofins ?? it.sistema.tributos?.p_cofins,
          };
        }
      } catch (_) { /* ignore */ }

      const idFornec = state.sessao?.fornecedor?.id_fornec;
      const codForn = it.xml?.cProd || it.sistema.cod_fornecedor || '';
      try {
        const qs = new URLSearchParams();
        if (idFornec) qs.set('id_fornec', String(idFornec));
        qs.set('id_identificador', String(patch.id_identificador));
        if (codForn) qs.set('cod_fornecedor', codForn);
        const [efRes, rgRes] = await Promise.all([
          idFornec ? api(`/importacao/estoque-fornecedor?${qs}`) : Promise.resolve({ item: null }),
          api(`/importacao/regra-tributo?${qs}${it.sistema.cfop ? `&cfop_entrada=${encodeURIComponent(it.sistema.cfop)}` : ''}`),
        ]);
        applySugestoesRegra(it.sistema, rgRes.item, efRes.item);
        if (rgRes.item || efRes.item) {
          deps.showToast?.('Parâmetros anteriores carregados (regra / fornecedor)');
        }
      } catch (_) { /* ignore */ }
    }
    state.buscaProduto = patch.id_identificador ? patch.descricao : state.buscaProduto;
    state.itemTab = 'entrada';
    renderItemScreen();
  }

  function syncVendaPorMargem() {
    const custo = Number($('#imp-custo-ficha')?.value || $('#imp-custo')?.value || 0);
    const margem = Number($('#imp-margem')?.value || 0);
    const calc = calcVendaPorMargem(custo, margem);
    if (calc != null && $('#imp-venda')) $('#imp-venda').value = String(calc);
  }

  function collectItemPatch() {
    const g = (id) => $(id)?.value;
    const gn = (id) => {
      const v = g(id);
      if (v === '' || v == null) return undefined;
      return Number(v);
    };
    const gnDef = (id, def = 0) => {
      const v = gn(id);
      return v === undefined ? def : v;
    };
    const gnNull = (id) => {
      const v = g(id);
      if (v === '' || v == null) return null;
      const n = Number(v);
      return Number.isNaN(n) ? null : n;
    };
    const yn = (sel) => ($(sel)?.checked ? 'S' : 'N');

    const it = itemAt(state.itemIndex);
    const sys = it?.sistema || {};
    const trib = sys.tributos || {};
    const tn = sys.trib_nfe || {};
    const tc = sys.trib_nfce || {};

    const descNovo = g('#imp-desc-novo');
    const descricao = descNovo != null && descNovo !== ''
      ? descNovo
      : (g('#imp-desc') != null ? g('#imp-desc') : sys.descricao);
    const uniSelect = $('#imp-uni')?.value || g('#imp-uni-ficha') || sys.uni_medida;
    const csosnEntrada = g('#imp-csosn-entrada') || g('#imp-csosn-trib') || sys.csosn_entrada || sys.csosn || '';
    const csosnSaida = g('#imp-csosn-saida') != null ? (g('#imp-csosn-saida') || '') : (sys.csosn_saida || '');

    const aplicarEl = $('#imp-aplicar-saida');
    const aplicarSaida = aplicarEl ? yn('#imp-aplicar-saida') : (sys.aplicar_saida || 'S');

    const vDesc = gnDef('#imp-desc-val', sys.v_desc ?? 0);
    const vFrete = gnDef('#imp-frete', sys.v_frete ?? 0);
    const vSeguro = gnDef('#imp-seguro', sys.v_seguro ?? 0);
    const vOutro = gnDef('#imp-outro', sys.v_outro ?? 0);
    const conversor = gnDef('#imp-conversor', sys.conversor ?? 1) || 1;
    const qtdXml = gnDef('#imp-qtd-xml', sys.qtd_xml ?? it?.xml?.qCom ?? 0);
    const qtd = Number((qtdXml * conversor).toFixed(6));

    let custo = gn('#imp-custo-ficha') ?? gn('#imp-custo-conv');
    if (custo === undefined) custo = sys.prc_custo;
    if (!(Number(custo) > 0) && it) {
      const merged = {
        ...sys,
        conversor,
        qtd_xml: qtdXml,
        qtd,
        v_desc: vDesc,
        v_frete: vFrete,
        v_seguro: vSeguro,
        v_outro: vOutro,
        tributos: {
          ...trib,
          v_ipi: trib.v_ipi ?? 0,
          v_icms_st: trib.v_icms_st ?? 0,
        },
      };
      custo = calcCustoNotaUnitario(merged, it.xml || {}).custoEstoque;
    }
    const custoNota = gn('#imp-custo') ?? sys.prc_custo_nota ?? calcCustoNotaUnitario({
      ...sys, conversor, qtd_xml: qtdXml, qtd, v_desc: vDesc, v_frete: vFrete, v_seguro: vSeguro, v_outro: vOutro,
    }, it?.xml || {}).custoXml;

    const margem = gn('#imp-margem') ?? sys.margem_lb ?? 0;
    let venda = gn('#imp-venda') ?? sys.prc_venda;
    const calc = calcVendaPorMargem(custo, margem);
    if (calc != null && ($('#imp-margem') || margem > 0)) venda = calc;

    return {
      sistema: {
        descricao: descricao || '',
        desc_cmpl: g('#imp-desc-cmpl') != null ? g('#imp-desc-cmpl') : (sys.desc_cmpl || ''),
        referencia: g('#imp-ref') != null ? g('#imp-ref') : (sys.referencia || ''),
        status: g('#imp-status-prod') || sys.status || 'A',
        cod_barras: g('#imp-ean') != null ? g('#imp-ean') : (sys.cod_barras || ''),
        cod_fornecedor: sys.cod_fornecedor || it?.xml?.cProd || '',
        ncm: g('#imp-ncm') != null ? g('#imp-ncm') : (sys.ncm || ''),
        cest: g('#imp-cest') != null ? g('#imp-cest') : (sys.cest || ''),
        anp: g('#imp-anp') != null ? g('#imp-anp') : (sys.anp || ''),
        cfop: g('#imp-cfop') != null ? g('#imp-cfop') : (sys.cfop || ''),
        cfop_origem: g('#imp-cfop-origem') || sys.cfop_origem || '',
        cfop_saida: g('#imp-cfop-saida') != null ? g('#imp-cfop-saida') : (sys.cfop_saida || ''),
        cfop_nf: g('#imp-cfop-nf') != null ? g('#imp-cfop-nf') : (sys.cfop_nf || ''),
        csosn_entrada: csosnEntrada || '',
        csosn_saida: csosnSaida || '',
        csosn_cfe: g('#imp-csosn-cfe') != null ? (g('#imp-csosn-cfe') || '') : (sys.csosn_cfe || ''),
        csosn: csosnEntrada || '',
        cst_icms: g('#imp-cst-nota') || g('#imp-cst') || g('#imp-cst-saida') || sys.cst_icms || '',
        cst_saida: g('#imp-cst-saida') != null ? g('#imp-cst-saida') : (sys.cst_saida || ''),
        cst_cfe: g('#imp-cst-cfe') != null ? g('#imp-cst-cfe') : (sys.cst_cfe || ''),
        id_cti: g('#imp-cti') != null ? g('#imp-cti') : (sys.id_cti || ''),
        id_cti_cfe: g('#imp-cti-cfe') != null ? g('#imp-cti-cfe') : (sys.id_cti_cfe || ''),
        _cti_label: g('#imp-cti-disp') || sys._cti_label || '',
        _cti_cfe_label: g('#imp-cti-cfe-disp') || sys._cti_cfe_label || '',
        margem_lb: margem,
        aplicar_saida: aplicarSaida,
        id_regra: sys.id_regra ?? null,
        uni_medida: uniSelect || '',
        uni_medida_xml: g('#imp-uni-xml') || sys.uni_medida_xml || '',
        conversor,
        qtd_xml: qtdXml,
        qtd,
        prc_custo: custo ?? 0,
        prc_custo_nota: custoNota ?? 0,
        prc_venda: venda ?? 0,
        v_desc: vDesc,
        v_frete: vFrete,
        v_seguro: vSeguro,
        v_outro: vOutro,
        id_identificador: sys.id_identificador ?? null,
        id_estoque: sys.id_estoque ?? null,
        criar_novo: !!sys.criar_novo,
        tributos: {
          origem: trib.origem || '',
          cst_icms: g('#imp-cst') || g('#imp-cst-nota') || g('#imp-cst-saida') || trib.cst_icms || '',
          csosn: csosnEntrada || trib.csosn || '',
          v_bc_icms: gn('#imp-vbc') ?? trib.v_bc_icms ?? 0,
          p_icms: gn('#imp-picms') ?? trib.p_icms ?? 0,
          v_icms: gn('#imp-vicms') ?? trib.v_icms ?? 0,
          v_bc_st: gn('#imp-vbcst') ?? trib.v_bc_st ?? 0,
          v_icms_st: gn('#imp-vst') ?? trib.v_icms_st ?? 0,
          cst_ipi: g('#imp-cst-ipi') != null ? g('#imp-cst-ipi') : (trib.cst_ipi || ''),
          p_ipi: gn('#imp-pipi') ?? trib.p_ipi ?? 0,
          v_ipi: gn('#imp-vipi') ?? trib.v_ipi ?? 0,
          cst_pis: g('#imp-cst-pis') != null ? g('#imp-cst-pis') : (trib.cst_pis || ''),
          cst_pis_saida: g('#imp-cst-pis-saida') != null ? g('#imp-cst-pis-saida') : (trib.cst_pis_saida || ''),
          p_pis: gn('#imp-ppis-saida') ?? gn('#imp-ppis') ?? trib.p_pis ?? 0,
          v_pis: gn('#imp-vpis') ?? trib.v_pis ?? 0,
          cst_cofins: g('#imp-cst-cof') != null ? g('#imp-cst-cof') : (trib.cst_cofins || ''),
          cst_cofins_saida: g('#imp-cst-cof-saida') != null ? g('#imp-cst-cof-saida') : (trib.cst_cofins_saida || ''),
          p_cofins: gn('#imp-pcof-saida') ?? gn('#imp-pcof') ?? trib.p_cofins ?? 0,
          v_cofins: gn('#imp-vcof') ?? trib.v_cofins ?? 0,
        },
        trib_nfe: {
          id_class_trib: gnNull('#imp-nfe-class') ?? tn.id_class_trib ?? null,
          percent_red_aliq_cbs: gnDef('#imp-nfe-red-cbs', tn.percent_red_aliq_cbs ?? 0),
          percent_red_aliq_ibs: gnDef('#imp-nfe-red-ibs', tn.percent_red_aliq_ibs ?? 0),
          cst_class_trib: g('#imp-nfe-cst-class') || tn.cst_class_trib || '',
          aliq_cbs: gnDef('#imp-nfe-aliq-cbs-pad', tn.aliq_cbs ?? 0.9),
          aliq_ibs_uf: gnDef('#imp-nfe-aliq-ibs-uf', tn.aliq_ibs_uf ?? 0.1),
          aliq_ibs_mun: tn.aliq_ibs_mun ?? 0,
          vlr_bc_cbs: gnDef('#imp-nfe-bc-cbs', tn.vlr_bc_cbs ?? 0),
          vlr_bc_ibs: gnDef('#imp-nfe-bc-cbs', tn.vlr_bc_ibs ?? 0),
          aliq_efetiva_cbs: gnDef('#imp-nfe-efet-cbs', tn.aliq_efetiva_cbs ?? 0),
          aliq_efetiva_ibs_uf: gnDef('#imp-nfe-efet-ibs-uf', tn.aliq_efetiva_ibs_uf ?? 0),
          vlr_cbs: gnDef('#imp-nfe-vlr-cbs', tn.vlr_cbs ?? 0),
          vlr_ibs_uf: gnDef('#imp-nfe-vlr-ibs-uf', tn.vlr_ibs_uf ?? 0),
          vlr_ibs_tot: gnDef('#imp-nfe-vlr-ibs-tot', tn.vlr_ibs_tot ?? 0),
          diferimento_cbs: gnDef('#imp-nfe-dif-cbs', tn.diferimento_cbs ?? 0),
          cod_cred_presu_cbs: g('#imp-nfe-cod-cbs') != null ? g('#imp-nfe-cod-cbs') : (tn.cod_cred_presu_cbs || ''),
          aliq_cred_presu_cbs: gnDef('#imp-nfe-aliq-cbs', tn.aliq_cred_presu_cbs ?? 0),
          diferimento_ibs_uf: gnDef('#imp-nfe-dif-ibs-uf', tn.diferimento_ibs_uf ?? 0),
          diferimento_ibs_mun: gnDef('#imp-nfe-dif-ibs-mun', tn.diferimento_ibs_mun ?? 0),
          cod_cred_presu_ibs: g('#imp-nfe-cod-ibs') != null ? g('#imp-nfe-cod-ibs') : (tn.cod_cred_presu_ibs || ''),
          aliq_cred_presu_ibs: gnDef('#imp-nfe-aliq-ibs', tn.aliq_cred_presu_ibs ?? 0),
          id_class_trib_regular: gnNull('#imp-nfe-class-reg') ?? tn.id_class_trib_regular ?? null,
          deduz_cred_presu_cbs: $('#imp-nfe-deduz-cbs') ? yn('#imp-nfe-deduz-cbs') : (tn.deduz_cred_presu_cbs || 'N'),
          deduz_cred_presu_ibs: $('#imp-nfe-deduz-ibs') ? yn('#imp-nfe-deduz-ibs') : (tn.deduz_cred_presu_ibs || 'N'),
          ind_bem_movel_usado: $('#imp-nfe-bem-usado') ? yn('#imp-nfe-bem-usado') : (tn.ind_bem_movel_usado || 'N'),
          _class_label: g('#imp-busca-class-nfe') || tn._class_label || '',
          _class_cod: tn._class_cod || '',
        },
        trib_nfce: {
          id_class_trib: gnNull('#imp-nfce-class') ?? tc.id_class_trib ?? null,
          percent_red_aliq_cbs: gnDef('#imp-nfce-red-cbs', tc.percent_red_aliq_cbs ?? 0),
          percent_red_aliq_ibs: gnDef('#imp-nfce-red-ibs', tc.percent_red_aliq_ibs ?? 0),
          diferimento_cbs: gnDef('#imp-nfce-dif-cbs', tc.diferimento_cbs ?? 0),
          diferimento_ibs_uf: gnDef('#imp-nfce-dif-ibs-uf', tc.diferimento_ibs_uf ?? 0),
          diferimento_ibs_mun: gnDef('#imp-nfce-dif-ibs-mun', tc.diferimento_ibs_mun ?? 0),
          _class_label: g('#imp-busca-class-nfce') || tc._class_label || '',
        },
      },
      conferido: $('#imp-conferido') ? !!$('#imp-conferido').checked : !!it?.conferido,
      observacao: g('#imp-obs') != null ? (g('#imp-obs') || '') : (it?.observacao || ''),
    };
  }

  async function persistRegraEFornec(it) {
    const sys = it?.sistema || {};
    const trib = sys.tributos || {};
    const idFornec = state.sessao?.fornecedor?.id_fornec;
    if (!idFornec) return;

    const regraBody = {
      id_regra: sys.id_regra || undefined,
      id_fornec: idFornec,
      id_identificador: sys.id_identificador || null,
      cod_fornecedor: sys.cod_fornecedor || it.xml?.cProd || '',
      cfop_entrada: sys.cfop || '',
      cfop_saida: sys.cfop_saida || '',
      cfop_nf: sys.cfop_nf || '',
      cst_entrada: trib.cst_icms || sys.cst_icms || '',
      cst_saida: sys.cst_saida || '',
      cst_cfe: sys.cst_cfe || '',
      csosn_entrada: sys.csosn_entrada || trib.csosn || '',
      csosn_saida: sys.csosn_saida || '',
      csosn_cfe: sys.csosn_cfe || '',
      cst_pis_entrada: trib.cst_pis || '',
      cst_pis_saida: trib.cst_pis_saida || trib.cst_pis || '',
      cst_cofins_entrada: trib.cst_cofins || '',
      cst_cofins_saida: trib.cst_cofins_saida || trib.cst_cofins || '',
      pis: trib.p_pis || 0,
      cofins: trib.p_cofins || 0,
      id_cti: sys.id_cti || '',
      id_cti_cfe: sys.id_cti_cfe || '',
      id_class_trib: sys.trib_nfe?.id_class_trib ?? null,
      id_class_trib_nfce: sys.trib_nfce?.id_class_trib ?? null,
      aplicar_saida: sys.aplicar_saida || 'S',
    };

    try {
      const rg = await api('/importacao/regra-tributo', { method: 'POST', body: regraBody });
      if (rg.ok && rg.item?.id_regra && it.sistema) {
        it.sistema.id_regra = rg.item.id_regra;
      }
    } catch (_) { /* ignore */ }

    if (!sys.id_identificador) return;
    try {
      await api('/importacao/estoque-fornecedor', {
        method: 'POST',
        body: {
          id_identificador: sys.id_identificador,
          id_fornec: idFornec,
          cod_no_fornecedor: sys.cod_fornecedor || it.xml?.cProd || '',
          cst: trib.cst_icms || sys.cst_icms || '',
          csosn: trib.csosn || sys.csosn || '',
          cofins: trib.p_cofins || 0,
          cst_cofins: trib.cst_cofins || '',
          pis: trib.p_pis || 0,
          cst_pis: trib.cst_pis || '',
          aliq_icms: trib.p_icms || 0,
          uni_medida: sys.uni_medida || '',
          cfop: sys.cfop || '',
          ipi: trib.p_ipi || null,
          cst_ipi: trib.cst_ipi || '',
          cod_barras: sys.cod_barras || '',
        },
      });
    } catch (_) { /* ignore */ }
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
    const saved = itemAt(state.itemIndex) || state.sessao.itens.find((x) => Number(x.nItem) === Number(it.nItem));
    if (saved) await persistRegraEFornec(saved);
    deps.showToast?.('Item salvo');
    if (opts.next && state.itemIndex < (state.sessao.itens.length - 1)) {
      openItem(state.itemIndex + 1);
    } else if (opts.prev && state.itemIndex > 0) {
      openItem(state.itemIndex - 1);
    } else if (opts.back) {
      renderSessao();
      showView('sessao');
      setTab('itens');
    } else {
      const idx = state.sessao.itens.findIndex((x) => Number(x.nItem) === Number(it.nItem));
      if (idx >= 0) state.itemIndex = idx;
      renderItemScreen();
    }
    return true;
  }

  function setItemTab(tabId) {
    const patch = collectItemPatch();
    const it = itemAt(state.itemIndex);
    if (it && patch.sistema) {
      it.sistema = { ...it.sistema, ...patch.sistema };
      if (patch.sistema.tributos) {
        it.sistema.tributos = { ...(it.sistema.tributos || {}), ...patch.sistema.tributos };
      }
      if (patch.sistema.trib_nfe) {
        it.sistema.trib_nfe = { ...(it.sistema.trib_nfe || {}), ...patch.sistema.trib_nfe };
      }
      if (patch.sistema.trib_nfce) {
        it.sistema.trib_nfce = { ...(it.sistema.trib_nfce || {}), ...patch.sistema.trib_nfce };
      }
      it.conferido = patch.conferido;
      it.observacao = patch.observacao;
    }
    state.itemTab = tabId;
    renderItemScreen();
  }

  function wireCodeSearch({ buscaSel, listSel, valueSel, endpoint, codeKey = 'codigo', extraQuery, onSelect, labelPreferDesc = false }) {
    const valueEl = $(valueSel);
    const displayEl = $(`${valueSel}-disp`) || $(buscaSel);
    const box = $(listSel);
    if (!displayEl || !box) return;

    const closeList = () => { box.hidden = true; box.innerHTML = ''; };
    const openList = () => { box.hidden = false; };

    const pickCode = (it) => it[codeKey] ?? it.cfop ?? it.cest ?? it.id_cti ?? it.id_class_trib ?? it.codigo ?? '';
    const pickDesc = (it) => it.descricao || it.desc_class_trib || it.resumo || it.label || '';

    const renderList = async (term) => {
      openList();
      const qs = new URLSearchParams();
      if (term) qs.set('q', term);
      if (typeof extraQuery === 'function') {
        const extra = extraQuery() || {};
        Object.entries(extra).forEach(([k, v]) => { if (v != null && v !== '') qs.set(k, v); });
      }
      const res = await api(`${endpoint}?${qs.toString()}`);
      const list = res.itens || [];
      if (!list.length) {
        box.innerHTML = '<p class="hint">Nenhum resultado</p>';
        return;
      }
      box.innerHTML = list.map((it) => {
        const code = String(pickCode(it));
        const desc = String(pickDesc(it));
        const label = labelPreferDesc
          ? (desc ? `${desc}${code ? ` (${code})` : ''}` : code)
          : (desc ? `${code} — ${desc}` : code);
        return `
          <button type="button" class="imp-prod-opt" data-code="${esc(code)}" data-desc="${esc(desc)}" data-label="${esc(label)}"
            data-extra="${esc(JSON.stringify({
    percent_red_aliq_cbs: it.percent_red_aliq_cbs,
    percent_red_aliq_ibs: it.percent_red_aliq_ibs,
    cst_class_trib: it.cst_class_trib,
    id_class_trib: it.id_class_trib,
    ncm: it.ncm,
    cod_class_trib: it.cod_class_trib,
    cfop: it.cfop,
    csosn_padrao: it.csosn_padrao,
    descricao: it.descricao || it.desc_class_trib || '',
  }))}">
            <strong>${esc(labelPreferDesc ? (desc || code) : code)}</strong>
            <span>${esc(labelPreferDesc ? code : desc)}</span>
          </button>`;
      }).join('');
      $$('.imp-prod-opt', box).forEach((btn) => {
        btn.addEventListener('click', () => {
          if (valueEl) valueEl.value = btn.dataset.code;
          displayEl.value = btn.dataset.label || btn.dataset.code;
          let extra = {};
          try { extra = JSON.parse(btn.dataset.extra || '{}'); } catch (_) { /* ignore */ }
          onSelect?.(btn.dataset.code, btn.dataset.desc, extra);
          closeList();
          displayEl.blur();
        });
      });
    };

    const runSearch = () => {
      clearTimeout(buscaCodeTimer);
      const term = String(displayEl.value || '').trim();
      buscaCodeTimer = setTimeout(() => renderList(term), 220);
    };

    displayEl.addEventListener('focus', () => {
      displayEl.select();
      runSearch();
    });
    displayEl.addEventListener('input', runSearch);
    displayEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Search') {
        e.preventDefault();
        clearTimeout(buscaCodeTimer);
        renderList(String(displayEl.value || '').trim()).then(() => {
          const first = box.querySelector('.imp-prod-opt');
          if (first && $$('.imp-prod-opt', box).length === 1) first.click();
          else displayEl.blur();
        });
      }
      if (e.key === 'Escape') closeList();
    });

    if (!wireCodeSearch._docBound) {
      wireCodeSearch._docBound = true;
      document.addEventListener('click', (e) => {
        document.querySelectorAll('[data-combo-root]').forEach((root) => {
          if (root.contains(e.target)) return;
          const list = root.querySelector('.imp-combo-list');
          if (list && !list.hidden) {
            list.hidden = true;
            list.innerHTML = '';
          }
        });
      });
    }
  }

  function syncCbsIbsFields(cbs) {
    if (!cbs) return;
    const set = (id, v) => { if ($(id)) $(id).value = v == null ? '' : String(v); };
    set('#imp-nfe-bc-cbs', cbs.vlr_bc_cbs);
    set('#imp-nfe-aliq-cbs-pad', cbs.aliq_cbs);
    set('#imp-nfe-aliq-ibs-uf', cbs.aliq_ibs_uf);
    set('#imp-nfe-red-cbs', cbs.percent_red_aliq_cbs);
    set('#imp-nfe-red-ibs', cbs.percent_red_aliq_ibs);
    set('#imp-nfe-efet-cbs', cbs.aliq_efetiva_cbs);
    set('#imp-nfe-efet-ibs-uf', cbs.aliq_efetiva_ibs_uf);
    set('#imp-nfe-vlr-cbs', cbs.vlr_cbs);
    set('#imp-nfe-vlr-ibs-uf', cbs.vlr_ibs_uf);
    set('#imp-nfe-vlr-ibs-tot', cbs.vlr_ibs_tot);
  }

  function recalcCbsIbsFromInputs() {
    const it = itemAt(state.itemIndex);
    if (!it?.sistema) return;
    const tn = {
      ...(it.sistema.trib_nfe || {}),
      percent_red_aliq_cbs: Number($('#imp-nfe-red-cbs')?.value || 0),
      percent_red_aliq_ibs: Number($('#imp-nfe-red-ibs')?.value || 0),
      aliq_cbs: Number($('#imp-nfe-aliq-cbs-pad')?.value || 0.9),
      aliq_ibs_uf: Number($('#imp-nfe-aliq-ibs-uf')?.value || 0.1),
    };
    const base = Number($('#imp-nfe-bc-cbs')?.value || 0);
    const cbs = calcCbsIbs(tn, base);
    it.sistema.trib_nfe = { ...tn, ...cbs };
    syncCbsIbsFields(cbs);
  }

  function applySimplesPisCofinsFromCst() {
    if (!state.emitenteSimples) return;
    const cst = String($('#imp-cst-pis-saida')?.value || '').replace(/\D/g, '').padStart(2, '0').slice(-2);
    if (cst === '01' || cst === '05') {
      if ($('#imp-ppis-saida')) $('#imp-ppis-saida').value = '0.65';
      if ($('#imp-pcof-saida')) $('#imp-pcof-saida').value = '3';
    }
  }

  function bindItemEvents(it) {
    $('#imp-item-voltar')?.addEventListener('click', () => {
      renderSessao();
      showView('sessao');
      setTab('itens');
    });
    $('#imp-item-prev')?.addEventListener('click', () => {
      if (state.itemIndex <= 0) return;
      saveItem({ prev: true });
    });
    $('#imp-item-next')?.addEventListener('click', () => {
      if (state.itemIndex >= (state.sessao?.itens?.length || 0) - 1) return;
      saveItem({ next: true });
    });
    $$('.imp-item-tab').forEach((btn) => {
      btn.addEventListener('click', () => setItemTab(btn.dataset.itemTab));
    });
    $('#imp-proxima-etapa')?.addEventListener('click', () => {
      const idx = ITEM_TABS.findIndex((t) => t.id === state.itemTab);
      if (idx >= 0 && idx < ITEM_TABS.length - 1) setItemTab(ITEM_TABS[idx + 1].id);
    });
    $('#imp-usar-custo-nota')?.addEventListener('click', () => {
      const cur = itemAt(state.itemIndex);
      if (!cur) return;
      const info = calcCustoNotaUnitario(cur.sistema || {}, cur.xml || {});
      if ($('#imp-custo-ficha')) $('#imp-custo-ficha').value = String(info.custoEstoque);
      syncVendaPorMargem();
      deps.showToast?.('Custo da nota aplicado');
    });

    $('#imp-salvar-item')?.addEventListener('click', () => saveItem());
    $('#imp-salvar-proximo')?.addEventListener('click', async () => {
      const next = state.itemIndex < (state.sessao?.itens?.length || 0) - 1;
      await saveItem({ next, back: !next });
    });
    $('#imp-criar-novo')?.addEventListener('click', () => {
      applyVinculo({
        id_identificador: null,
        id_estoque: null,
        criar_novo: true,
        descricao: it.xml?.xProd || '',
        cod_barras: it.xml?.cEAN || '',
        cod_fornecedor: it.xml?.cProd || '',
        ncm: it.xml?.NCM || '',
      });
    });
    $('#imp-limpar-vinc')?.addEventListener('click', () => {
      const item = itemAt(state.itemIndex);
      if (!item) return;
      item.match = null;
      item.sistema.id_identificador = null;
      item.sistema.id_estoque = null;
      item.sistema.descricao = '';
      item.sistema.cod_barras = '';
      item.sistema.criar_novo = false;
      item.sistema.id_regra = null;
      state.buscaProduto = item.xml?.xProd || '';
      renderItemScreen();
    });
    const syncClearBuscaProd = () => {
      const clearBtn = $('#imp-limpar-busca-prod');
      if (clearBtn) clearBtn.hidden = !String($('#imp-busca-prod')?.value || '').trim();
    };
    syncClearBuscaProd();
    $('#imp-limpar-busca-prod')?.addEventListener('click', () => {
      state.buscaProduto = '';
      const inp = $('#imp-busca-prod');
      if (inp) inp.value = '';
      syncClearBuscaProd();
      loadProdutosBusca('');
      inp?.focus();
    });
    $('#imp-btn-scan-prod')?.addEventListener('click', () => {
      deps.startScanner?.('importacao-prod');
    });
    $('#imp-btn-scan-ean')?.addEventListener('click', () => {
      deps.startScanner?.('importacao-ean');
    });
    $('#imp-nfe-bc-cbs')?.addEventListener('input', recalcCbsIbsFromInputs);
    $('#imp-nfe-aliq-cbs-pad')?.addEventListener('input', recalcCbsIbsFromInputs);
    $('#imp-nfe-aliq-ibs-uf')?.addEventListener('input', recalcCbsIbsFromInputs);
    $('#imp-cst-pis-saida-disp')?.addEventListener('change', applySimplesPisCofinsFromCst);
    $('#imp-cst-pis-saida')?.addEventListener('change', applySimplesPisCofinsFromCst);
    applySimplesPisCofinsFromCst();
    $('#imp-busca-prod')?.addEventListener('input', (e) => {
      state.buscaProduto = e.target.value;
      syncClearBuscaProd();
      clearTimeout(buscaProdTimer);
      buscaProdTimer = setTimeout(() => loadProdutosBusca(state.buscaProduto), 280);
    });
    $('#imp-busca-prod')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Search') {
        e.preventDefault();
        clearTimeout(buscaProdTimer);
        loadProdutosBusca(e.target.value);
        e.target.blur();
      }
    });
    $('#imp-ncm')?.addEventListener('change', () => {
      const disp = $('#imp-cest-disp');
      if (disp) {
        disp.dispatchEvent(new Event('focus'));
      }
    });
    $('#imp-conversor')?.addEventListener('input', syncQtdConvertida);
    $('#imp-uni')?.addEventListener('change', (e) => {
      const opt = e.target.selectedOptions?.[0];
      const conv = opt?.dataset?.conversor;
      if (conv != null && $('#imp-conversor')) {
        $('#imp-conversor').value = conv;
      }
      const ficha = $('#imp-uni-ficha');
      if (ficha) ficha.value = e.target.value;
      syncQtdConvertida();
    });
    $('#imp-margem')?.addEventListener('input', syncVendaPorMargem);
    $('#imp-custo-ficha')?.addEventListener('input', syncVendaPorMargem);
    $('#imp-aplicar-saida')?.addEventListener('change', (e) => {
      const block = $('#imp-saida-block');
      if (block) block.classList.toggle('is-off', !e.target.checked);
    });
    $('#imp-cad-unidade')?.addEventListener('click', async () => {
      const unidade = prompt('Unidade (ex.: CX):');
      if (!unidade) return;
      const descricao = prompt('Descrição da unidade:', unidade) || unidade;
      const conversorStr = prompt('Conversor (padrão 1):', '1');
      const conversor = Number(conversorStr || 1) || 1;
      const res = await api('/importacao/unidades', {
        method: 'POST',
        body: { unidade, descricao, conversor },
      });
      if (!res.ok) {
        deps.showMsg?.(res.error || 'Erro ao cadastrar unidade');
        return;
      }
      state.unidades = [];
      await ensureUnidades();
      const item = itemAt(state.itemIndex);
      if (item?.sistema) {
        item.sistema.uni_medida = res.item?.unidade || unidade.toUpperCase();
        item.sistema.conversor = res.item?.conversor ?? conversor;
      }
      deps.showToast?.('Unidade cadastrada');
      renderItemScreen();
    });
    $('#imp-busca-anp')?.addEventListener('input', (e) => {
      clearTimeout(buscaAnpTimer);
      buscaAnpTimer = setTimeout(() => loadAnpBusca(e.target.value), 280);
    });
    $('#imp-busca-anp')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Search') {
        e.preventDefault();
        loadAnpBusca(e.target.value);
        e.target.blur();
      }
    });

    const wireFiscal = (valueSel, listSel, endpoint, codeKey, extra = {}) => {
      wireCodeSearch({
        valueSel,
        listSel,
        endpoint,
        codeKey,
        ...extra,
      });
    };

    wireFiscal('#imp-cfop', '#imp-cfop-list', '/importacao/cfop', 'cfop');
    wireFiscal('#imp-cfop-saida', '#imp-cfop-saida-list', '/importacao/cfop', 'cfop');
    wireFiscal('#imp-cfop-nf', '#imp-cfop-nf-list', '/importacao/cfop', 'cfop');
    wireFiscal('#imp-cti', '#imp-cti-list', '/importacao/taxa-uf', 'id_cti', {
      labelPreferDesc: true,
      onSelect: (code, desc) => {
        const it = itemAt(state.itemIndex);
        if (it?.sistema) it.sistema._cti_label = desc || code;
      },
    });
    wireFiscal('#imp-cti-cfe', '#imp-cti-cfe-list', '/importacao/taxa-uf', 'id_cti', {
      labelPreferDesc: true,
      onSelect: (code, desc) => {
        const it = itemAt(state.itemIndex);
        if (it?.sistema) it.sistema._cti_cfe_label = desc || code;
      },
    });
    wireFiscal('#imp-cst-pis', '#imp-cst-pis-list', '/importacao/cst-pis', 'codigo');
    wireFiscal('#imp-cst-cof', '#imp-cst-cof-list', '/importacao/cst-cofins', 'codigo');
    wireFiscal('#imp-cst-ipi', '#imp-cst-ipi-list', '/importacao/cst-ipi', 'codigo');
    wireFiscal('#imp-cst-pis-saida', '#imp-cst-pis-saida-list', '/importacao/cst-pis', 'codigo', {
      onSelect: () => applySimplesPisCofinsFromCst(),
    });
    wireFiscal('#imp-cst-cof-saida', '#imp-cst-cof-saida-list', '/importacao/cst-cofins', 'codigo');
    wireFiscal('#imp-cst-saida', '#imp-cst-saida-list', '/importacao/cst-icms', 'codigo');
    wireFiscal('#imp-cst-cfe', '#imp-cst-cfe-list', '/importacao/cst-icms', 'codigo');
    wireFiscal('#imp-csosn-saida', '#imp-csosn-saida-list', '/importacao/csosn', 'codigo');
    wireFiscal('#imp-csosn-cfe', '#imp-csosn-cfe-list', '/importacao/csosn', 'codigo');
    wireFiscal('#imp-csosn-trib', '#imp-csosn-trib-list', '/importacao/csosn', 'codigo');
    wireFiscal('#imp-csosn-entrada', '#imp-csosn-entrada-list', '/importacao/csosn', 'codigo');

    wireCodeSearch({
      valueSel: '#imp-cest',
      listSel: '#imp-cest-list',
      endpoint: '/importacao/cest',
      codeKey: 'cest',
      extraQuery: () => ({
        ncm: String($('#imp-ncm')?.value || itemAt(state.itemIndex)?.sistema?.ncm
          || itemAt(state.itemIndex)?.xml?.NCM || '').replace(/\D/g, ''),
      }),
    });

    const onClassPick = (target) => (code, desc, extra) => {
      const it = itemAt(state.itemIndex);
      const key = target === 'nfce' ? 'trib_nfce' : 'trib_nfe';
      if (target === 'nfce') {
        if ($('#imp-nfce-red-cbs')) $('#imp-nfce-red-cbs').value = extra.percent_red_aliq_cbs ?? '';
        if ($('#imp-nfce-red-ibs')) $('#imp-nfce-red-ibs').value = extra.percent_red_aliq_ibs ?? '';
      } else {
        if ($('#imp-nfe-red-cbs')) $('#imp-nfe-red-cbs').value = extra.percent_red_aliq_cbs ?? '';
        if ($('#imp-nfe-red-ibs')) $('#imp-nfe-red-ibs').value = extra.percent_red_aliq_ibs ?? '';
        if ($('#imp-nfe-cst-class')) $('#imp-nfe-cst-class').value = extra.cst_class_trib || '';
      }
      if (it?.sistema) {
        const baseTn = {
          ...(it.sistema[key] || {}),
          id_class_trib: Number(code),
          _class_label: desc
            ? `${extra.cod_class_trib || code} — ${desc}`
            : String(extra.cod_class_trib || code),
          _class_cod: extra.cod_class_trib || '',
          percent_red_aliq_cbs: Number(extra.percent_red_aliq_cbs || 0),
          percent_red_aliq_ibs: Number(extra.percent_red_aliq_ibs || 0),
          cst_class_trib: extra.cst_class_trib || '',
          _class_hydrated: true,
        };
        if (target === 'nfe') {
          const bc = Number($('#imp-nfe-bc-cbs')?.value)
            || calcCustoNotaUnitario(it.sistema, it.xml || {}).totalItem
            || 0;
          Object.assign(baseTn, calcCbsIbs(baseTn, bc));
          syncCbsIbsFields(baseTn);
        }
        it.sistema[key] = baseTn;
      }
    };

    wireCodeSearch({
      valueSel: '#imp-nfe-class',
      listSel: '#imp-class-nfe-list',
      buscaSel: '#imp-busca-class-nfe',
      endpoint: '/importacao/class-trib',
      codeKey: 'id_class_trib',
      onSelect: onClassPick('nfe'),
    });
    wireCodeSearch({
      valueSel: '#imp-nfce-class',
      listSel: '#imp-class-nfce-list',
      buscaSel: '#imp-busca-class-nfce',
      endpoint: '/importacao/class-trib',
      codeKey: 'id_class_trib',
      onSelect: onClassPick('nfce'),
    });
  }

  /* ── CONSULTAR / MANUAL ─────────────────────────────────────────────────── */

  async function consultarChave(opts = {}) {
    const chave = String($('#imp-chave')?.value || '').replace(/\D/g, '');
    if (chave.length !== 44) {
      deps.showMsg?.('Informe a chave de acesso com 44 dígitos.');
      return;
    }
    const btn = $('#imp-btn-consultar');
    if (btn) btn.disabled = true;
    let xmlText = state.xmlTextPendente || null;
    const fileInput = $('#imp-xml-file');
    if (!xmlText && fileInput?.files?.[0]) {
      xmlText = await fileInput.files[0].text();
    }
    const res = await api('/importacao/sessoes', {
      method: 'POST',
      body: {
        chave,
        xmlText,
        allowDemo: !!opts.allowDemo,
      },
    });
    if (btn) btn.disabled = false;
    if (!res.ok) {
      deps.showMsg?.(res.error || 'Não foi possível consultar a NF-e');
      return;
    }
    state.xmlTextPendente = null;
    state.sessao = res.sessao;
    state.itemIndex = 0;
    state.tab = 'dados';
    renderSessao();
    setTab('dados');
    showView('sessao');
    const qtd = res.sessao?.itens?.length || 0;
    const nNf = res.sessao?.xml?.ide?.nNF || '';
    if (res.fonte === 'sefaz') {
      deps.showToast?.(`NF ${nNf} consultada na SEFAZ (${qtd} itens)`);
    } else if (res.fonte === 'xml') {
      deps.showToast?.(`NF ${nNf} carregada do XML (${qtd} itens)`);
      if (res.sefazErro) {
        deps.showMsg?.(`XML local usado. SEFAZ: ${res.sefazErro}`);
      }
    } else {
      deps.showMsg?.(
        `Demonstração com dados simulados (NF ${nNf}, ${qtd} itens). Para dados reais, configure o certificado ou anexe o XML.`
      );
    }
    if (res.avisoDuplicada) {
      deps.showMsg?.(res.avisoDuplicada);
    }
  }

  async function criarManual() {
    const res = await api('/importacao/sessoes/manual', { method: 'POST', body: {} });
    if (!res.ok) {
      deps.showMsg?.(res.error || 'Erro ao criar lançamento manual');
      return;
    }
    state.sessao = res.sessao;
    state.itemIndex = 0;
    state.tab = 'itens';
    renderSessao();
    setTab('itens');
    showView('sessao');
    deps.showToast?.('Lançamento manual criado');
  }

  async function addItemManual() {
    const s = state.sessao;
    if (!s?.manual) return;
    const res = await api(`/importacao/sessoes/${s.id}/itens`, { method: 'POST', body: {} });
    if (!res.ok) {
      deps.showMsg?.(res.error || 'Erro ao adicionar item');
      return;
    }
    state.sessao = res.sessao;
    const idx = (state.sessao.itens?.length || 1) - 1;
    openItem(idx);
  }

  /* ── PARÂMETROS ─────────────────────────────────────────────────────────── */

  async function loadParamsView() {
    const res = await api('/importacao/params/cfop');
    const host = $('#imp-params-host');
    if (!host) return;
    const itens = res.itens || [];
    const csosn = res.csosn_padrao || '102';
    const saida = res.saida || {};
    host.innerHTML = `
      <section class="imp-section">
        <header class="imp-section-head"><h4>Parâmetros CFOP / CSOSN</h4></header>
        <p class="hint">O 1º dígito do CFOP de entrada é ajustado automaticamente pela UF do fornecedor × UF do emitente (1=mesmo estado, 2=interestadual). O CSOSN é definido por linha; CST permanece o da nota.</p>
        <div class="imp-fields">
          ${field('CSOSN padrão (fallback)', 'imp-params-csosn', csosn, { third: true })}
        </div>
        <h5 class="imp-sub">Conversão por linha (entrada → saída NF-e / CF-e)</h5>
        <div class="imp-params-scroll">
        <table class="imp-params-table" id="imp-params-table">
          <thead>
            <tr>
              <th>CFOP origem</th>
              <th>CFOP entrada</th>
              <th>CSOSN entr.</th>
              <th>CFOP saí. NF-e</th>
              <th>CSOSN NF-e</th>
              <th>CST NF-e</th>
              <th>Taxa ICMS</th>
              <th>CFOP saí. CF-e</th>
              <th>CSOSN CF-e</th>
              <th>CST CF-e</th>
              <th>Taxa CFE</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${itens.map((r, i) => paramsRowHtml(r, i)).join('') || paramsRowHtml({}, 0)}
          </tbody>
        </table>
        </div>
        <div class="imp-vinc-btns" style="margin-top:.65rem">
          <button type="button" class="btn small outline" id="imp-params-add">Adicionar linha</button>
        </div>
      </section>
      <section class="imp-section">
        <header class="imp-section-head"><h4>Dados de saída (padrão / fallback)</h4></header>
        <p class="hint">Usado quando a linha de conversão não tiver saída preenchida.</p>
        <div class="imp-fields">
          ${field('CFOP saída padrão', 'imp-params-cfop-saida', saida.cfop_saida || '', { third: true })}
          ${field('CSOSN saída padrão', 'imp-params-csosn-saida', saida.csosn_saida || '', { third: true })}
          <label class="imp-check imp-field third">
            <input type="checkbox" id="imp-params-aplicar-saida" ${ynChecked(saida.aplicar_saida !== undefined ? saida.aplicar_saida : 'S') ? 'checked' : ''} />
            Aplicar saída padrão
          </label>
        </div>
      </section>
    `;
    $('#imp-params-add')?.addEventListener('click', () => {
      const tbody = $('#imp-params-table tbody');
      if (!tbody) return;
      const i = tbody.children.length;
      tbody.insertAdjacentHTML('beforeend', paramsRowHtml({}, i));
      bindParamsRowEvents();
    });
    bindParamsRowEvents();
    showView('params');
  }

  function paramsTaxaCell(cls, listCls, value, label, placeholder) {
    const code = String(value || '').trim();
    const disp = String(label || code || '').trim();
    return `
      <td class="imp-params-combo" data-combo-root>
        <input type="hidden" class="${cls}" value="${esc(code)}" />
        <input type="search" class="${cls}-disp" value="${esc(disp)}"
          placeholder="${esc(placeholder)}" autocomplete="off" enterkeyhint="search" />
        <div class="imp-combo-list ${listCls}" hidden></div>
      </td>
    `;
  }

  function paramsRowHtml(r = {}, i = 0) {
    return `
      <tr data-i="${i}">
        <td><input type="text" class="imp-cfop-origem" maxlength="4" value="${esc(r.cfop_origem || '')}" inputmode="numeric" title="CFOP origem" /></td>
        <td><input type="text" class="imp-cfop-conv" maxlength="4" value="${esc(r.cfop_conv || '')}" inputmode="numeric" title="CFOP entrada" /></td>
        <td><input type="text" class="imp-cfop-csosn" maxlength="3" value="${esc(r.csosn || '102')}" inputmode="numeric" title="CSOSN entrada" /></td>
        <td><input type="text" class="imp-cfop-saida-nfe" maxlength="4" value="${esc(r.cfop_saida_nfe || '')}" inputmode="numeric" title="CFOP saída NF-e" /></td>
        <td><input type="text" class="imp-csosn-saida-nfe" maxlength="3" value="${esc(r.csosn_saida_nfe || '')}" inputmode="numeric" title="CSOSN saída NF-e" placeholder="CSOSN" /></td>
        <td><input type="text" class="imp-cst-saida-nfe" maxlength="3" value="${esc(r.cst_saida_nfe || '')}" inputmode="numeric" title="CST saída NF-e" placeholder="CST" /></td>
        ${paramsTaxaCell('imp-id-cti', 'imp-params-cti-list', r.id_cti, r.cti_label, 'Taxa ICMS…')}
        <td><input type="text" class="imp-cfop-saida-cfe" maxlength="4" value="${esc(r.cfop_saida_cfe || '')}" inputmode="numeric" title="CFOP saída CF-e" /></td>
        <td><input type="text" class="imp-csosn-saida-cfe" maxlength="3" value="${esc(r.csosn_saida_cfe || '')}" inputmode="numeric" title="CSOSN saída CF-e" placeholder="CSOSN" /></td>
        <td><input type="text" class="imp-cst-saida-cfe" maxlength="3" value="${esc(r.cst_saida_cfe || '')}" inputmode="numeric" title="CST saída CF-e" placeholder="CST" /></td>
        ${paramsTaxaCell('imp-id-cti-cfe', 'imp-params-cti-cfe-list', r.id_cti_cfe, r.cti_cfe_label, 'Taxa CFE…')}
        <td><button type="button" class="btn small outline imp-params-del">Remover</button></td>
      </tr>
    `;
  }

  function wireParamsTaxaCombo(tr, hiddenCls, listCls) {
    const valueEl = tr.querySelector(`.${hiddenCls}`);
    const displayEl = tr.querySelector(`.${hiddenCls}-disp`);
    const box = tr.querySelector(`.${listCls}`);
    if (!valueEl || !displayEl || !box || displayEl.dataset.wired === '1') return;
    displayEl.dataset.wired = '1';

    const closeList = () => { box.hidden = true; box.innerHTML = ''; };
    const renderList = async (term) => {
      box.hidden = false;
      const qs = new URLSearchParams();
      if (term) qs.set('q', term);
      const res = await api(`/importacao/taxa-uf?${qs.toString()}`);
      const list = res.itens || [];
      if (!list.length) {
        box.innerHTML = '<p class="hint">Nenhuma taxa</p>';
        return;
      }
      box.innerHTML = list.map((it) => {
        const code = String(it.id_cti || '');
        const desc = String(it.descricao || '');
        const label = desc ? `${desc}${code ? ` (${code})` : ''}` : code;
        return `
          <button type="button" class="imp-prod-opt" data-code="${esc(code)}" data-label="${esc(label)}">
            <strong>${esc(desc || code)}</strong>
            <span>${esc(code)}</span>
          </button>`;
      }).join('');
      $$('.imp-prod-opt', box).forEach((btn) => {
        btn.addEventListener('click', () => {
          valueEl.value = btn.dataset.code || '';
          displayEl.value = btn.dataset.label || btn.dataset.code || '';
          closeList();
          displayEl.blur();
        });
      });
    };

    displayEl.addEventListener('focus', () => {
      displayEl.select();
      renderList(String(displayEl.value || '').trim());
    });
    displayEl.addEventListener('input', () => {
      clearTimeout(buscaCodeTimer);
      buscaCodeTimer = setTimeout(() => renderList(String(displayEl.value || '').trim()), 220);
    });
    displayEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Search') {
        e.preventDefault();
        renderList(String(displayEl.value || '').trim()).then(() => {
          const opts = $$('.imp-prod-opt', box);
          if (opts.length === 1) opts[0].click();
          else displayEl.blur();
        });
      }
      if (e.key === 'Escape') closeList();
    });
  }

  function bindParamsRowEvents() {
    $$('#imp-params-table .imp-params-del').forEach((btn) => {
      btn.onclick = () => {
        const tr = btn.closest('tr');
        const tbody = tr?.parentElement;
        tr?.remove();
        if (tbody && !tbody.children.length) {
          tbody.insertAdjacentHTML('beforeend', paramsRowHtml({}, 0));
          bindParamsRowEvents();
        }
      };
    });
    $$('#imp-params-table tbody tr').forEach((tr) => {
      wireParamsTaxaCombo(tr, 'imp-id-cti', 'imp-params-cti-list');
      wireParamsTaxaCombo(tr, 'imp-id-cti-cfe', 'imp-params-cti-cfe-list');
    });
  }

  async function saveParams() {
    const csosn = $('#imp-params-csosn')?.value || '102';
    const itens = $$('#imp-params-table tbody tr').map((tr) => ({
      cfop_origem: tr.querySelector('.imp-cfop-origem')?.value || '',
      cfop_conv: tr.querySelector('.imp-cfop-conv')?.value || '',
      csosn: tr.querySelector('.imp-cfop-csosn')?.value || '102',
      cfop_saida_nfe: tr.querySelector('.imp-cfop-saida-nfe')?.value || '',
      csosn_saida_nfe: tr.querySelector('.imp-csosn-saida-nfe')?.value || '',
      cst_saida_nfe: tr.querySelector('.imp-cst-saida-nfe')?.value || '',
      cfop_saida_cfe: tr.querySelector('.imp-cfop-saida-cfe')?.value || '',
      csosn_saida_cfe: tr.querySelector('.imp-csosn-saida-cfe')?.value || '',
      cst_saida_cfe: tr.querySelector('.imp-cst-saida-cfe')?.value || '',
      id_cti: tr.querySelector('.imp-id-cti')?.value || '',
      id_cti_cfe: tr.querySelector('.imp-id-cti-cfe')?.value || '',
      cti_label: tr.querySelector('.imp-id-cti-disp')?.value || '',
      cti_cfe_label: tr.querySelector('.imp-id-cti-cfe-disp')?.value || '',
    })).filter((r) => r.cfop_origem || r.cfop_conv);
    const saida = {
      cfop_saida: $('#imp-params-cfop-saida')?.value || '',
      csosn_saida: $('#imp-params-csosn-saida')?.value || '',
      aplicar_saida: $('#imp-params-aplicar-saida')?.checked ? 'S' : 'N',
    };
    const res = await api('/importacao/params/cfop', {
      method: 'PUT',
      body: { itens, csosn_padrao: csosn, saida },
    });
    if (!res.ok) {
      deps.showMsg?.(res.error || 'Erro ao salvar parâmetros');
      return;
    }
    deps.showToast?.('Parâmetros salvos');
    showView('inicio');
    loadHome();
  }

  /* ── EVENTS / API PÚBLICA ───────────────────────────────────────────────── */

  function bindEvents() {
    $('#imp-btn-hoje')?.addEventListener('click', () => {
      setDateFiltersToday();
      loadHome();
    });
    $('#imp-btn-filtrar')?.addEventListener('click', () => loadHome());
    const blurAndFilter = (e) => {
      if (e.key === 'Enter' || e.key === 'Search') {
        e.preventDefault();
        e.target.blur();
        loadHome();
      }
    };
    $('#imp-filtro-nnf')?.addEventListener('keydown', blurAndFilter);
    $('#imp-filtro-forn')?.addEventListener('keydown', blurAndFilter);
    $('#imp-filtro-de')?.addEventListener('keydown', blurAndFilter);
    $('#imp-filtro-ate')?.addEventListener('keydown', blurAndFilter);
    $('#imp-btn-nova')?.addEventListener('click', () => showView('consultar'));
    $('#imp-btn-manual')?.addEventListener('click', () => criarManual());
    $('#imp-btn-params')?.addEventListener('click', () => loadParamsView());
    $('#imp-btn-params-sessao')?.addEventListener('click', () => loadParamsView());
    $('#imp-btn-ver-pdf')?.addEventListener('click', () => abrirDanfePdf());
    $('#imp-voltar-lista')?.addEventListener('click', () => {
      showView('inicio');
      loadHome();
    });
    $('#imp-params-voltar')?.addEventListener('click', () => {
      showView('inicio');
      loadHome();
    });
    $('#imp-params-salvar')?.addEventListener('click', () => saveParams());

    $('#imp-btn-consultar')?.addEventListener('click', consultarChave);
    $('#imp-chave')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Search') {
        e.preventDefault();
        e.target.blur();
        consultarChave();
      }
    });
    $('#imp-btn-scan-chave')?.addEventListener('click', () => {
      deps.startScanner?.('importacao');
    });
    $('#imp-btn-demo')?.addEventListener('click', () => {
      const demo = '35260821234567890123456789012345678901234567';
      const inp = $('#imp-chave');
      if (inp) inp.value = demo;
      consultarChave({ allowDemo: true });
    });

    $$('#imp-tabs .imp-tab').forEach((btn) => {
      btn.addEventListener('click', () => setTab(btn.dataset.tab));
    });

    $('#imp-btn-add-item')?.addEventListener('click', () => addItemManual());

    $('#imp-btn-confirmar')?.addEventListener('click', async () => {
      if (!state.sessao) return;
      const btn = $('#imp-btn-confirmar');
      if (btn?.classList.contains('is-disabled') || btn?.getAttribute('aria-disabled') === 'true') {
        deps.showMsg?.(btn?.title || 'Confira todos os itens e vincule o fornecedor antes de gravar.');
        return;
      }
      const nItens = state.sessao.itens?.length || 0;
      const nNf = state.sessao.xml?.ide?.nNF || state.sessao.cabecalho?.nNF || '—';
      const okConfirm = await askConfirm(
        `Confirmar gravação da NF-e ${nNf} com ${nItens} item(ns)?\n\nEsta ação registra a entrada no estoque.`,
        { okLabel: 'Gravar', cancelLabel: 'Cancelar' }
      );
      if (!okConfirm) return;
      if (btn) {
        btn.classList.add('is-disabled');
        btn.setAttribute('aria-disabled', 'true');
      }
      try {
        const res = await api(`/importacao/sessoes/${state.sessao.id}/confirmar`, {
          method: 'POST',
          body: {
            usuarioNome: deps.getUsuario?.()?.nome || 'Supervisor',
            idFuncionario: deps.getUsuario?.()?.id || 0,
          },
        });
        if (res.ok) {
          deps.showMsg?.(res.message || 'Entrada confirmada (protótipo)');
          state.sessao = null;
          showView('inicio');
          loadHome();
        } else {
          deps.showMsg?.(res.error || 'Falha ao confirmar gravação');
          updateConfirmBtn();
        }
      } catch (err) {
        deps.showMsg?.(err.message || 'Falha ao confirmar gravação');
        updateConfirmBtn();
      }
    });

    $('#imp-voltar-inicio')?.addEventListener('click', () => {
      showView('inicio');
      loadHome();
    });
  }

  function applyScannedChave(code) {
    if (state.view !== 'consultar' && state.view !== 'inicio') return false;
    const chave = String(code || '').replace(/\D/g, '');
    if (chave.length >= 44) {
      if (state.view !== 'consultar') showView('consultar');
      const inp = $('#imp-chave');
      if (inp) inp.value = chave.slice(0, 44);
      consultarChave();
      return true;
    }
    return false;
  }

  function applyScannedProduto(code) {
    if (state.view !== 'item') return false;
    const raw = String(code || '').trim();
    if (!raw) return false;
    state.buscaProduto = raw;
    const inp = $('#imp-busca-prod');
    if (inp) {
      inp.value = raw;
      const clearBtn = $('#imp-limpar-busca-prod');
      if (clearBtn) clearBtn.hidden = false;
    }
    loadProdutosBusca(raw);
    return true;
  }

  function applyScannedEan(code) {
    if (state.view !== 'item') return false;
    const raw = String(code || '').trim();
    if (!raw) return false;
    const inp = $('#imp-ean');
    if (!inp) return false;
    inp.value = raw;
    const it = itemAt(state.itemIndex);
    if (it?.sistema) it.sistema.cod_barras = raw;
    deps.showToast?.('Código de barras atualizado');
    return true;
  }

  /** Volta uma tela no fluxo de importação. Retorna true se tratou o back. */
  function handleBack() {
    if (state.view === 'item') {
      renderSessao();
      showView('sessao');
      setTab('itens');
      return true;
    }
    if (state.view === 'sessao') {
      state.sessao = null;
      showView('inicio');
      loadHome();
      return true;
    }
    if (state.view === 'consultar' || state.view === 'params') {
      showView('inicio');
      loadHome();
      return true;
    }
    return false;
  }

  function onPageEnter() {
    setDateFiltersToday();
    showView('inicio');
    loadHome();
    const title = $('#page-title');
    const sub = $('#page-sub');
    if (title) title.textContent = 'Importar NF-e';
    if (sub) sub.textContent = 'Protótipo — conferência por item (em desenvolvimento)';
  }

  function init(options) {
    deps = options || {};
    bindEvents();
  }

  return {
    init,
    onPageEnter,
    applyScannedChave,
    applyScannedProduto,
    applyScannedEan,
    handleBack,
    getView: () => state.view,
  };
})();

window.ImportacaoNfe = ImportacaoNfe;
