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
  let empresaNome = '';

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
    empresaNome = ctx.nome || (typeof deps.empresa === 'function' ? deps.empresa() : '');
    const base = ctx.consultaOnline
      ? `Base oficial da Receita Federal${ctx.versaoBase ? ` ${esc(ctx.versaoBase)}` : ''}, repositório calculadora-rtc-regime-regular.`
      : 'A base oficial da Receita Federal não abriu neste aplicativo.';
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
      </section>
      <section class="imp-section">
        <header class="imp-section-head"><h4>Replicador Geral</h4></header>
        <p class="hint">Lê um NCM válido de cada, sem nulos, sem 00000000 e sem código curto. A opção da Receita aparece antes de gravar. Desmarque o que não deve ser aplicado.</p>
        <div class="imp-vinc-btns">
          <button type="button" class="btn small primary" id="cn-ler">Ler NCMs</button>
        </div>
        <div id="cn-replicador"></div>
      </section>`;
    resultado = null;
    $('#cn-buscar')?.addEventListener('click', buscar);
    $('#cn-ncm')?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') buscar();
    });
    $('#cn-ler')?.addEventListener('click', lerReplicador);
  }

  function selectLinha(nome, opcoes) {
    const escolhida = (opcoes || []).find((o) => o.sugerida)?.codigo || '';
    const itens = (opcoes || []).map((o) => (
      `<option value="${esc(o.codigo)}"${o.codigo === escolhida ? ' selected' : ''}>${esc(rotuloOpcao(o))}</option>`
    )).join('');
    return `<select data-rep="${nome}"><option value="">Não alterar</option>${itens}</select>`;
  }

  async function lerReplicador() {
    const box = $('#cn-replicador');
    if (!box) return;
    box.innerHTML = '<p class="hint">Lendo um NCM de cada na Receita…</p>';
    const res = await api('/classificacao-ncm/replicador');
    if (!res?.ok) {
      box.innerHTML = `<p class="erro">${esc(res?.error || 'Não foi possível ler os NCMs.')}</p>`;
      return;
    }
    const itens = res.itens || [];
    if (!itens.length) {
      box.innerHTML = '<p class="hint">Nenhum NCM válido no estoque.</p>';
      return;
    }
    const linhas = itens.map((item, idx) => {
      const travado = !!item.erro || (!item.nfe?.length && !item.nfce?.length);
      return `
        <tr>
          <td class="rep-check"><input type="checkbox" data-rep-marca="${idx}" ${travado ? 'disabled' : 'checked'} /></td>
          <td><span class="rep-ncm">${esc(item.ncm_formatado || item.ncm)}</span></td>
          <td>${item.quantidade || 0}</td>
          <td>${travado ? `<span class="hint">${esc(item.erro || 'Sem opção da Receita')}</span>` : selectLinha('nfe', item.nfe)}</td>
          <td>${travado ? '—' : selectLinha('nfce', item.nfce)}</td>
        </tr>`;
    }).join('');
    box.innerHTML = `
      <p class="hint">${itens.length} NCM(s) válidos${res.regime ? ` · ${esc(res.regime)}` : ''}.</p>
      <div class="imp-vinc-btns">
        <button type="button" class="btn small primary" id="cn-replicar">Aplicar nos marcados</button>
      </div>
      <div class="rep-lista">
        <table class="rep-table">
          <thead><tr><th class="rep-check"><input type="checkbox" id="cn-rep-todos" checked /></th><th>NCM</th><th>Produtos</th><th>NF-e</th><th>NFC-e</th></tr></thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>`;
    box._itens = itens;
    $('#cn-rep-todos')?.addEventListener('change', (ev) => {
      box.querySelectorAll('[data-rep-marca]:not(:disabled)').forEach((el) => { el.checked = ev.target.checked; });
    });
    $('#cn-replicar')?.addEventListener('click', () => aplicarReplicador(box));
  }

  async function aplicarReplicador(box) {
    const itens = box?._itens || [];
    const escolhidos = [];
    box.querySelectorAll('[data-rep-marca]:checked').forEach((el) => {
      const item = itens[Number(el.getAttribute('data-rep-marca'))];
      const tr = el.closest('tr');
      if (!item || !tr) return;
      escolhidos.push({
        ncm: item.ncm,
        nfe: tr.querySelector('[data-rep="nfe"]')?.value || '',
        nfce: tr.querySelector('[data-rep="nfce"]')?.value || '',
      });
    });
    if (!escolhidos.length) {
      deps.showMsg('Marque ao menos um NCM.');
      return;
    }
    const ok = await deps.showConfirm(`Aplicar a classificação escolhida em todos os produtos dos ${escolhidos.length} NCMs marcados?`);
    if (!ok) return;
    const res = await api('/classificacao-ncm/replicar', { method: 'POST', body: { itens: escolhidos } });
    if (!res?.ok) {
      deps.showMsg(res?.error || 'Não foi possível aplicar.');
      return;
    }
    const partes = [`${res.alterados || 0} produto(s) atualizados`];
    if (res.jaIguais) partes.push(`${res.jaIguais} já estavam iguais`);
    if (res.falhas?.length) partes.push(`${res.falhas.length} NCM(s) não aplicados`);
    deps.showToast(partes.join('. ') + '.');
    if (res.falhas?.length) deps.showMsg(res.falhas.map((f) => `${f.ncm}: ${f.error}`).join('\n'));
    await oferecerImpressao(res);
    await lerReplicador();
  }

  function classeTexto(codigo, descricao) {
    if (!codigo || codigo === '—') return '—';
    return descricao ? `${codigo} — ${descricao}` : codigo;
  }

  async function oferecerImpressao(res) {
    const linhas = (res?.linhas || []).map((linha) => ({
      ncm: linha.ncm,
      documento: linha.documento,
      anterior: classeTexto(linha.anterior, linha.anterior_descricao),
      atual: classeTexto(linha.atual, linha.atual_descricao),
      produtos: linha.produtos,
    }));
    if (!linhas.length) return;
    const imprimir = await deps.showConfirm('Deseja imprimir o relatório das alterações?', { okLabel: 'Imprimir', cancelLabel: 'Agora não' });
    if (!imprimir) return;
    const abriu = window.ExportarTabela?.abrirPdf({
      titulo: 'Alterações de classificação tributária',
      subtitulo: 'NCM, cClassTrib anterior e atual',
      empresa: empresaNome || (typeof deps.empresa === 'function' ? deps.empresa() : ''),
      usuario: typeof deps.usuario === 'function' ? deps.usuario() : '',
      colunas: [
        { id: 'ncm', titulo: 'NCM', largura: '12%' },
        { id: 'documento', titulo: 'Documento', largura: '10%' },
        { id: 'anterior', titulo: 'cClassTrib anterior', largura: '34%' },
        { id: 'atual', titulo: 'cClassTrib atual', largura: '34%' },
        { id: 'produtos', titulo: 'Produtos', numero: true, largura: '10%' },
      ],
      linhas,
    });
    if (!abriu) deps.showMsg('Permita pop-ups para abrir o PDF.');
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
    await oferecerImpressao(res);
    await buscar();
  }

  global.ClassificacaoNcm = {
    init(next) { deps = { ...deps, ...(next || {}) }; },
    carregar,
    onPageEnter() { carregar(); },
  };
}(window));
