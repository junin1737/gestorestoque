'use strict';

(function initContador(global) {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  let deps = { api() { return Promise.resolve({ ok: false }); }, showMsg() {}, showToast() {}, contador() { return false; } };
  let selecionados = new Set();
  let previaPronta = null;

  function api(path, options) {
    return deps.api(path, options);
  }

  function campo(id, rotulo, placeholder) {
    return `<label class="imp-field">${rotulo}<input id="${id}" placeholder="${esc(placeholder || '')}" autocomplete="off" /></label>`;
  }

  async function carregar() {
    const host = $('#contador-host');
    if (!host) return;
    const contador = !!deps.contador?.();
    const ctx = await api('/massa/contexto');
    const regime = ctx.regime || '';
    const grupos = ctx.grupos || [];
    host.innerHTML = `
      <section class="imp-section">
        <header class="imp-section-head"><h4>${contador ? 'Tributação de saída' : 'Alteração em massa'}</h4></header>
        <p class="hint">${contador
          ? `Você altera só os campos fiscais de saída desta loja. Regime: ${esc(regime || '—')}. Cadastro, preço e estoque ficam bloqueados.`
          : `Se a condição for verdadeira, os campos preenchidos abaixo passam a valer. Campo em branco não muda o valor atual. Regime: ${esc(regime || '—')}.`}</p>
        <div class="imp-fields">
          ${campo('massa-q', 'Busca', 'Descrição')}
          ${campo('massa-ncm', 'NCM', '1905')}
          ${campo('massa-cfop', 'CFOP', '5102')}
          ${campo('massa-cst', 'CST / CSOSN', '102')}
          <label class="imp-field">Grupo
            <select id="massa-grupo"><option value="">Todos</option>${grupos.map((g) => `<option value="${g.id}">${esc(g.descricao)}</option>`).join('')}</select>
          </label>
        </div>
        <div class="massa-checks">
          <label><input type="checkbox" id="massa-incompleto" /> Tributação incompleta</label>
        </div>
        <div class="imp-vinc-btns">
          <button type="button" class="btn small" id="massa-filtrar">Filtrar</button>
          <button type="button" class="btn small" id="massa-limpar">Limpar filtros</button>
          <button type="button" class="btn small" id="massa-todos">Marcar filtrados</button>
          <button type="button" class="btn small btn-atencao" id="massa-abrir">Alterar em Massa</button>
        </div>
        <section class="imp-section massa-regra" id="massa-regra" hidden>
        <header class="imp-section-head"><h4>Regra</h4></header>
        <div class="imp-fields">
          ${campo('reg-ncm-igual', 'SE NCM igual a', '19059090')}
          ${campo('reg-ncm-comeca', 'SE NCM começa com', '1905')}
          <label class="imp-field">SE grupo
            <select id="reg-grupo"><option value="">—</option>${grupos.map((g) => `<option value="${g.id}">${esc(g.descricao)}</option>`).join('')}</select>
          </label>
        </div>
        <div class="massa-checks">
          <label><input type="checkbox" id="reg-marcados" checked /> Usar os produtos marcados</label>
          <label><input type="checkbox" id="reg-filtrados" /> Todos os filtrados</label>
        </div>
        <p class="hint">ENTÃO preencher (só o que estiver preenchido):</p>
        <div class="imp-fields" id="massa-acoes">
          ${campo('ac-ncm', 'NCM', '')}
          ${campo('ac-cest', 'CEST', '')}
          ${campo('ac-cfop', 'CFOP saída', '')}
          ${campo('ac-cfop-nf', 'CFOP NF', '')}
          ${ctx.simples ? campo('ac-csosn', 'CSOSN', '') : campo('ac-cst', 'CST ICMS', '')}
          ${ctx.simples ? campo('ac-csosn-cfe', 'CSOSN CF-e', '') : campo('ac-cst-cfe', 'CST CF-e', '')}
          ${campo('ac-cti', 'Taxa ICMS', '')}
          ${campo('ac-cti-cfe', 'Taxa ICMS CF-e', '')}
          ${campo('ac-cst-pis', 'CST PIS', '')}
          ${campo('ac-pis', 'Alíquota PIS', '')}
          ${campo('ac-cst-cofins', 'CST COFINS', '')}
          ${campo('ac-cofins', 'Alíquota COFINS', '')}
          ${campo('ac-class', 'Reforma — class. trib. NFe (id)', '')}
          ${campo('ac-class-nfce', 'Reforma — class. trib. NFCe (id)', '')}
          ${contador ? '' : `
            ${campo('ac-desc', 'Descrição', '')}
            ${campo('ac-barras', 'Código de barras', '')}
            ${campo('ac-ref', 'Referência', '')}
            ${campo('ac-venda', 'Preço de venda', '')}
            ${campo('ac-custo', 'Preço de custo', '')}
            <label class="imp-field">Situação
              <select id="ac-status"><option value="">Não alterar</option><option value="A">Ativo</option><option value="I">Inativo</option></select>
            </label>
          `}
        </div>
        <div class="imp-vinc-btns">
          <button type="button" class="btn small" id="massa-previa">Ver prévia</button>
          <button type="button" class="btn small primary" id="massa-aplicar" disabled>Aplicar</button>
        </div>
        <div id="massa-previa-box"></div>
        </section>
        <div id="massa-lista" class="item-list"></div>
      </section>
      <p class="hint">Cada campo alterado fica no relatório de Alterações, com o valor anterior, o novo, quem fez e a data.</p>`;
    $('#massa-filtrar')?.addEventListener('click', listar);
    $('#massa-limpar')?.addEventListener('click', limparFiltros);
    $('#massa-todos')?.addEventListener('click', marcarFiltrados);
    $('#massa-abrir')?.addEventListener('click', () => {
      const box = $('#massa-regra');
      if (!box) return;
      box.hidden = !box.hidden;
      if (!box.hidden) box.scrollIntoView({ block: 'nearest' });
    });
    $('#massa-previa')?.addEventListener('click', verPrevia);
    $('#massa-aplicar')?.addEventListener('click', aplicar);
    listar();
  }

  function limparFiltros() {
    ['massa-q', 'massa-ncm', 'massa-cfop', 'massa-cst'].forEach((id) => {
      const el = $(`#${id}`);
      if (el) el.value = '';
    });
    const grupo = $('#massa-grupo');
    if (grupo) grupo.value = '';
    const incompleto = $('#massa-incompleto');
    if (incompleto) incompleto.checked = false;
    listar();
  }

  function filtro() {
    return {
      q: $('#massa-q')?.value || '',
      ncm: $('#massa-ncm')?.value || '',
      cfop: $('#massa-cfop')?.value || '',
      cst: $('#massa-cst')?.value || '',
      grupo: $('#massa-grupo')?.value || '',
      incompleto: !!$('#massa-incompleto')?.checked,
    };
  }

  function regra() {
    const condicoes = [];
    if ($('#reg-ncm-igual')?.value.trim()) condicoes.push({ tipo: 'ncm_igual', valor: $('#reg-ncm-igual').value.trim() });
    if ($('#reg-ncm-comeca')?.value.trim()) condicoes.push({ tipo: 'ncm_comeca', valor: $('#reg-ncm-comeca').value.trim() });
    if ($('#reg-grupo')?.value) condicoes.push({ tipo: 'grupo', valor: $('#reg-grupo').value });
    const acoes = {
      ncm: $('#ac-ncm')?.value,
      cest: $('#ac-cest')?.value,
      cfop: $('#ac-cfop')?.value,
      cfop_nf: $('#ac-cfop-nf')?.value,
      cst: $('#ac-cst')?.value,
      csosn: $('#ac-csosn')?.value,
      cst_cfe: $('#ac-cst-cfe')?.value,
      csosn_cfe: $('#ac-csosn-cfe')?.value,
      id_cti: $('#ac-cti')?.value,
      id_cti_cfe: $('#ac-cti-cfe')?.value,
      cst_pis: $('#ac-cst-pis')?.value,
      pis: $('#ac-pis')?.value,
      cst_cofins: $('#ac-cst-cofins')?.value,
      cofins: $('#ac-cofins')?.value,
      id_class_trib: $('#ac-class')?.value,
      id_class_trib_nfce: $('#ac-class-nfce')?.value,
      descricao: $('#ac-desc')?.value,
      cod_barras: $('#ac-barras')?.value,
      referencia: $('#ac-ref')?.value,
      prc_venda: $('#ac-venda')?.value,
      prc_custo: $('#ac-custo')?.value,
      status: $('#ac-status')?.value,
    };
    return {
      filtro: filtro(),
      condicoes,
      acoes,
      ids: [...selecionados],
      todos_filtrados: !!$('#reg-filtrados')?.checked,
    };
  }

  async function listar() {
    previaPronta = null;
    const btn = $('#massa-aplicar');
    if (btn) btn.disabled = true;
    const f = filtro();
    const qs = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v === true ? '1' : v); });
    const res = await api(`/massa/itens?${qs}`);
    const box = $('#massa-lista');
    if (!box) return;
    const itens = res.itens || [];
    box.innerHTML = itens.map((it) => `
      <label class="item-row">
        <input type="checkbox" data-id="${it.id_identificador}" ${selecionados.has(it.id_identificador) ? 'checked' : ''} />
        <strong>${esc(it.descricao)}</strong>
        <span class="hint">NCM ${esc(it.ncm || '—')} · CFOP ${esc(it.cfop || '—')} · ${esc(it.csosn || it.cst || 'sem CST/CSOSN')}</span>
      </label>`).join('') || '<p class="hint">Nenhum produto neste filtro.</p>';
    $$('input[data-id]', box).forEach((inp) => {
      inp.addEventListener('change', () => {
        const id = Number(inp.dataset.id);
        if (inp.checked) selecionados.add(id);
        else selecionados.delete(id);
      });
    });
  }

  function marcarFiltrados() {
    $$('#massa-lista input[data-id]').forEach((inp) => {
      inp.checked = true;
      selecionados.add(Number(inp.dataset.id));
    });
    const flag = $('#reg-filtrados');
    if (flag) flag.checked = true;
  }

  async function verPrevia() {
    const body = regra();
    if ($('#reg-marcados')?.checked === false) body.ids = [];
    const res = await api('/massa/previa', { method: 'POST', body });
    const box = $('#massa-previa-box');
    if (!res.ok) {
      previaPronta = null;
      if ($('#massa-aplicar')) $('#massa-aplicar').disabled = true;
      if (box) box.innerHTML = `<p class="erro">${esc(res.error || 'Não foi possível montar a prévia.')}</p>`;
      return;
    }
    previaPronta = body;
    if ($('#massa-aplicar')) $('#massa-aplicar').disabled = false;
    const linhas = (res.amostra || []).slice(0, 20).map((p) => `
      <div class="item-row">
        <strong>${esc(p.descricao)}</strong>
        <span class="hint">${(p.mudancas || []).map((m) => `${esc(m.rotulo)}: ${esc(m.de || '—')} → ${esc(m.para)}`).join(' · ')}</span>
      </div>`).join('');
    if (box) {
      box.innerHTML = `<p class="hint">${res.total} produto(s) entram na regra. Confira antes de aplicar.</p>${linhas || '<p class="hint">Os produtos já estão com esses valores.</p>'}`;
    }
  }

  async function aplicar() {
    if (!previaPronta) {
      deps.showMsg?.('Veja a prévia antes de aplicar.');
      return;
    }
    const res = await api('/massa/aplicar', { method: 'POST', body: previaPronta });
    if (!res.ok) {
      deps.showMsg?.(res.error || 'Não foi possível aplicar.');
      return;
    }
    deps.showToast?.(`${res.alterados || 0} produto(s) atualizados. O relatório de Alterações guarda o antes e o depois.`);
    previaPronta = null;
    selecionados = new Set();
    carregar();
  }

  global.Contador = {
    init(next) { deps = { ...deps, ...next }; },
    onPageEnter() { carregar(); },
  };
}(window));
