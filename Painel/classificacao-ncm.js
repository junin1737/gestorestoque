'use strict';

(function initClassificacaoNcm(global) {
  const $ = (sel, root = document) => root.querySelector(sel);

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  let deps = { api() { return Promise.resolve({ ok: false }); }, showMsg() {}, showToast() {}, showConfirm() { return Promise.resolve(false); } };
  let resultado = null;

  function api(path, options) {
    return deps.api(path, options);
  }

  function rotuloOpcao(o) {
    const cst = o.cst ? `CST ${o.cst} · ` : '';
    const marca = o.sugerida ? ' · sugestão da Receita' : '';
    return `${o.codigo} — ${cst}${o.descricao || 'Sem descrição'}${marca}`;
  }

  function selectOpcoes(id, opcoes, titulo) {
    const escolhida = (opcoes || []).find((o) => o.sugerida)?.codigo || '';
    const itens = (opcoes || []).map((o) => (
      `<option value="${esc(o.codigo)}"${o.codigo === escolhida ? ' selected' : ''}>${esc(rotuloOpcao(o))}</option>`
    )).join('');
    return `
      <label class="imp-field">${titulo}
        <select id="${id}">
          <option value="">Não alterar</option>
          ${itens || '<option value="" disabled>Nenhuma opção da Receita</option>'}
        </select>
      </label>`;
  }

  async function carregar() {
    const host = $('#classificacao-host');
    if (!host) return;
    host.innerHTML = '<p class="hint">Abrindo a classificação por NCM…</p>';
    let ctx;
    try {
      ctx = await api('/classificacao-ncm/contexto');
    } catch (err) {
      host.innerHTML = `<p class="erro">${esc(err?.message || 'Não foi possível abrir a classificação por NCM.')}</p>`;
      return;
    }
    if (!ctx.ok) {
      host.innerHTML = `<p class="erro">${esc(ctx.error || 'Não foi possível abrir a classificação por NCM.')}</p>`;
      return;
    }
    const base = ctx.consultaOnline
      ? `Consulta da Receita no ar${ctx.versaoBase ? `, base ${esc(ctx.versaoBase)}` : ''}.`
      : 'A consulta da Receita não respondeu. O serviço da consulta precisa estar no ar nesta máquina.';
    host.innerHTML = `
      <section class="imp-section">
        <header class="imp-section-head"><h4>Classificação por NCM</h4></header>
        <p class="hint">${base} Digite o NCM, busque e escolha a classificação. Atribuir preenche todos os produtos desse NCM. Regime: ${esc(ctx.regime || '—')}.</p>
        <div class="imp-fields massa-fields">
          <label class="imp-field">NCM<input id="cn-ncm" inputmode="numeric" placeholder="19059090" autocomplete="off" /></label>
        </div>
        <div class="imp-vinc-btns">
          <button type="button" class="btn small primary" id="cn-buscar">Buscar</button>
        </div>
        <div id="cn-resultado"></div>
      </section>`;
    resultado = null;
    $('#cn-buscar')?.addEventListener('click', buscar);
    $('#cn-ncm')?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') buscar();
    });
  }

  async function buscar() {
    const ncm = ($('#cn-ncm')?.value || '').replace(/\D/g, '');
    const box = $('#cn-resultado');
    if (!box) return;
    if (ncm.length !== 8) {
      deps.showMsg('Informe o NCM com 8 dígitos.');
      return;
    }
    box.innerHTML = '<p class="hint">Consultando a Receita e o estoque…</p>';
    const res = await api('/classificacao-ncm/buscar', { method: 'POST', body: { ncm } });
    if (!res.ok) {
      resultado = null;
      box.innerHTML = `<p class="erro">${esc(res.error || 'Falha na consulta.')}</p>`;
      return;
    }
    resultado = res;
    desenhar(res);
  }

  function desenhar(res) {
    const box = $('#cn-resultado');
    if (!box) return;
    const produtos = res.produtos || [];
    const linhas = produtos.map((p) => `
      <tr>
        <td>${esc(p.id_identificador)}</td>
        <td>${esc(p.descricao)}</td>
        <td>${esc(p.nfe || '—')}</td>
        <td>${esc(p.nfce || '—')}</td>
      </tr>`).join('');
    const avisoConflito = res.conflito
      ? `<p class="hint">${res.conflito} item(ns) ficaram de fora porque o mesmo cadastro tem outro NCM.</p>`
      : '';
    box.innerHTML = `
      <p class="hint">NCM ${esc(res.ncm || res.ncm_chave)}${res.descricaoNcm ? ` · ${esc(res.descricaoNcm)}` : ''}${res.versaoBase ? ` · base ${esc(res.versaoBase)}` : ''}. ${produtos.length} produto(s).</p>
      ${avisoConflito}
      <div class="imp-fields massa-fields">
        ${selectOpcoes('cn-nfe', res.nfe, 'Classificação NF-e')}
        ${selectOpcoes('cn-nfce', res.nfce, 'Classificação NFC-e')}
      </div>
      <div class="imp-vinc-btns">
        <button type="button" class="btn small primary" id="cn-atribuir" ${produtos.length ? '' : 'disabled'}>Atribuir</button>
      </div>
      <div class="class-ncm-lista">
        <table class="class-ncm-table">
          <thead><tr><th>Código</th><th>Descrição</th><th>NF-e</th><th>NFC-e</th></tr></thead>
          <tbody>${linhas || '<tr><td colspan="4">Nenhum produto com esse NCM.</td></tr>'}</tbody>
        </table>
      </div>`;
    $('#cn-atribuir')?.addEventListener('click', atribuir);
  }

  async function atribuir() {
    if (!resultado?.ncm_chave) return;
    const nfe = $('#cn-nfe')?.value || '';
    const nfce = $('#cn-nfce')?.value || '';
    if (!nfe && !nfce) {
      deps.showMsg('Escolha a classificação da NF-e, da NFC-e ou as duas.');
      return;
    }
    const total = (resultado.produtos || []).length;
    const ok = await deps.showConfirm(`Atribuir a classificação escolhida aos ${total} produtos do NCM ${resultado.ncm || resultado.ncm_chave}?`);
    if (!ok) return;
    const res = await api('/classificacao-ncm/atribuir', {
      method: 'POST',
      body: {
        ncm: resultado.ncm_chave,
        nfe,
        nfce,
      },
    });
    if (!res.ok) {
      deps.showMsg(res.error || 'Não foi possível atribuir.');
      return;
    }
    const partes = [`${res.alterados || 0} produto(s) atualizados`];
    if (res.jaIguais) partes.push(`${res.jaIguais} já estavam com essa classificação`);
    deps.showToast(partes.join('. ') + '.');
    await buscar();
  }

  global.ClassificacaoNcm = {
    init(next) { deps = { ...deps, ...(next || {}) }; },
    carregar,
    onPageEnter() { carregar(); },
  };
}(window));
