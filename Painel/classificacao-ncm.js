'use strict';

(function initClassificacaoNcm(global) {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  let deps = { api() { return Promise.resolve({ ok: false }); }, showMsg() {}, showToast() {}, showConfirm() { return Promise.resolve(false); } };
  let contexto = {};
  let ultima = null;

  function api(path, options) {
    return deps.api(path, options);
  }

  const ROTULO = {
    aplicar: 'Vai gravar',
    preenchido: 'Já preenchido',
    revisar: 'Revisar',
    ausente: 'Código ausente na base',
    sem_ncm: 'Sem NCM',
    erro: 'Erro na consulta',
  };

  async function carregar() {
    const host = $('#classificacao-host');
    if (!host) return;
    const ctx = await api('/classificacao-ncm/contexto');
    if (!ctx.ok) {
      host.innerHTML = `<p class="erro">${esc(ctx.error || 'Não foi possível abrir a classificação por NCM.')}</p>`;
      return;
    }
    contexto = ctx;
    const grupos = ctx.grupos || [];
    host.innerHTML = `
      <section class="imp-section">
        <header class="imp-section-head"><h4>Classificação por NCM</h4></header>
        <p class="hint">A consulta da Receita sugere o cClassTrib da NF-e e da NFC-e pelo NCM do estoque. Para consultar e gravar, informe a senha de acesso do Gestor. Regime: ${esc(ctx.regime || '—')}.</p>
        ${ctx.consultaConfigurada ? '' : '<p class="erro">A consulta ainda não está configurada neste servidor. O endereço e a chave ficam na Configuração do serviço.</p>'}
        <div class="imp-fields massa-fields">
          <label class="imp-field">Busca<input id="cn-q" placeholder="Descrição" autocomplete="off" /></label>
          <label class="imp-field">NCM<input id="cn-ncm" placeholder="1905" autocomplete="off" /></label>
          <label class="imp-field">Grupo
            <select id="cn-grupo"><option value="">Todos</option>${grupos.map((g) => `<option value="${g.id}">${esc(g.descricao)}</option>`).join('')}</select>
          </label>
          <label class="imp-field">Senha de acesso
            <input id="cn-senha" type="password" autocomplete="current-password" />
          </label>
        </div>
        <div class="massa-checks">
          <label><input type="checkbox" id="cn-substituir" /> Substituir a classificação que já está preenchida</label>
        </div>
        <div class="imp-vinc-btns">
          <button type="button" class="btn small primary" id="cn-consultar">Consultar</button>
          <button type="button" class="btn small" id="cn-aplicar" disabled>Aplicar</button>
        </div>
        <div id="cn-resumo"></div>
        <div id="cn-lista" class="massa-lista"></div>
      </section>
      <p class="hint">NCM ambíguo não grava sozinho: escolha o código na linha e aplique. Cada mudança fica no relatório de Alterações.</p>`;
    ultima = null;
    $('#cn-consultar')?.addEventListener('click', consultar);
    $('#cn-aplicar')?.addEventListener('click', aplicar);
    ['cn-q', 'cn-ncm', 'cn-grupo', 'cn-substituir'].forEach((id) => {
      $(`#${id}`)?.addEventListener('change', invalidar);
      $(`#${id}`)?.addEventListener('input', invalidar);
    });
  }

  function pedido() {
    return {
      senha: $('#cn-senha')?.value || '',
      substituir: !!$('#cn-substituir')?.checked,
      filtro: {
        q: $('#cn-q')?.value || '',
        ncm: $('#cn-ncm')?.value || '',
        grupo: $('#cn-grupo')?.value || '',
      },
      escolhas: escolhas(),
    };
  }

  function escolhas() {
    const mapa = new Map();
    $$('#cn-lista select[data-ncm]').forEach((sel) => {
      const ncm = sel.dataset.ncm;
      if (!mapa.has(ncm)) mapa.set(ncm, { ncm });
      mapa.get(ncm)[sel.dataset.doc] = sel.value;
    });
    return [...mapa.values()];
  }

  function invalidar() {
    ultima = null;
    const btn = $('#cn-aplicar');
    if (btn) btn.disabled = true;
  }

  function textoCodigo(lado) {
    if (!lado) return '—';
    if (lado.acao === 'erro') return esc(lado.descricao || 'Erro');
    if (lado.acao === 'sem_ncm') return '—';
    if (lado.motivo === 'conflito') return 'O mesmo cadastro tem NCMs diferentes';
    if (lado.acao === 'revisar') return (lado.candidatos || []).length ? '' : 'Mais de um código possível';
    if (lado.acao === 'ausente') return `${esc(lado.codigo)} não está em TB_CLASS_TRIB`;
    if (!lado.gravar) return 'Já preenchido';
    const nome = `${lado.codigo}${lado.descricao ? ` — ${lado.descricao}` : ''}`;
    return `${esc(nome)} · ${esc(lado.gravar)} produto(s)`;
  }

  function selectLado(ncm, doc, lado) {
    if (lado?.acao !== 'revisar' || !(lado.candidatos || []).length) return `<span>${textoCodigo(lado)}</span>`;
    const opts = (lado.candidatos || []).map((c) => (
      `<option value="${esc(c.codigo)}">${esc(c.codigo)}${c.descricao ? ` — ${esc(c.descricao)}` : ''}</option>`
    )).join('');
    return `<select data-ncm="${esc(ncm)}" data-doc="${doc}"><option value="">Escolher…</option>${opts}</select>`;
  }

  function pintar(res) {
    const resumo = $('#cn-resumo');
    const lista = $('#cn-lista');
    const r = res.resumo || {};
    if (resumo) {
      resumo.innerHTML = `<p class="hint">${res.produtos || 0} produto(s) em ${res.ncms || 0} NCM(s). ${r.aplicar || 0} vão mudar · ${r.revisar || 0} para revisar · ${r.preenchido || 0} já preenchidos · ${r.sem_ncm || 0} sem NCM.</p>`;
    }
    if (!lista) return;
    const linhas = res.linhas || [];
    if (!linhas.length) {
      lista.innerHTML = '<p class="hint">Nenhum produto neste filtro.</p>';
      return;
    }
    lista.innerHTML = `<table class="class-ncm-table"><thead><tr><th>NCM</th><th>Produtos</th><th>NF-e</th><th>NFC-e</th><th>Situação</th></tr></thead><tbody>
      ${linhas.map((l) => {
        const ncm = l.conflito ? 'NCMs diferentes no mesmo cadastro' : (l.ncm || 'Sem NCM');
        return `<tr>
          <td><strong>${esc(ncm)}</strong>${l.exemplos?.length ? `<div class="hint">${esc(l.exemplos.join(' · '))}</div>` : ''}</td>
          <td>${esc(l.produtos)}</td>
          <td>${selectLado(l.ncm_chave, 'nfe', l.nfe)}</td>
          <td>${selectLado(l.ncm_chave, 'nfce', l.nfce)}</td>
          <td>${esc(ROTULO[l.situacao] || l.situacao)}</td>
        </tr>`;
      }).join('')}
    </tbody></table>`;
  }

  async function consultar() {
    const body = pedido();
    if (!body.senha.trim()) return deps.showMsg?.('Informe a senha de acesso do Gestor.');
    const btn = $('#cn-consultar');
    if (btn) btn.disabled = true;
    const res = await api('/classificacao-ncm/previa', { method: 'POST', body });
    if (btn) btn.disabled = false;
    if (!res.ok) {
      ultima = null;
      if ($('#cn-aplicar')) $('#cn-aplicar').disabled = true;
      return deps.showMsg?.(res.error || 'Não foi possível consultar.');
    }
    ultima = body;
    pintar(res);
    const tem = (res.linhas || []).some((l) => l.situacao === 'aplicar' || l.situacao === 'revisar');
    if ($('#cn-aplicar')) $('#cn-aplicar').disabled = !tem;
  }

  async function aplicar() {
    const body = pedido();
    if (!body.senha.trim()) return deps.showMsg?.('Informe a senha de acesso do Gestor.');
    const ok = await deps.showConfirm?.(
      'Gravar a classificação tributária nos produtos desta consulta? O que estiver ambíguo e sem escolha fica de fora.',
      { okLabel: 'Aplicar', cancelLabel: 'Cancelar' },
    );
    if (!ok) return;
    const btn = $('#cn-aplicar');
    if (btn) btn.disabled = true;
    const res = await api('/classificacao-ncm/aplicar', { method: 'POST', body });
    if (!res.ok) {
      if (btn) btn.disabled = false;
      return deps.showMsg?.(res.error || 'Não foi possível aplicar.');
    }
    deps.showToast?.(res.mensagem || `${res.alterados || 0} produto(s) atualizados.${res.revisar ? ` ${res.revisar} continuam para revisão.` : ''}`);
    await consultar();
  }

  global.ClassificacaoNcm = {
    init(next) { deps = { ...deps, ...next }; },
    onPageEnter() { carregar(); },
  };
}(window));
