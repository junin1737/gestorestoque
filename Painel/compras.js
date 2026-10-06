/**
 * Consultar compras — NF-e destinadas ao CNPJ, vindas da SEFAZ a cada 1h30.
 */
const Compras = (() => {
  let deps = {};
  let dados = null;
  let filtro = 'todas';
  let timer = null;
  let relogioTimer = null;
  let importando = false;

  function $(sel, root = document) {
    return root.querySelector(sel);
  }

  function esc(s) {
    return deps.escapeHtml ? deps.escapeHtml(s) : String(s ?? '');
  }

  function fmtCnpj(v) {
    const s = String(v || '').replace(/\D/g, '');
    if (s.length !== 14) return s || '—';
    return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }

  function fmtQuando(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function fmtDhEmi(iso) {
    return fmtQuando(iso) || '—';
  }

  function statusClass(status) {
    if (status === 'Lançada') return 'ok';
    if (status === 'Cancelada') return 'zero';
    return 'low';
  }

  function renderStatus() {
    const el = $('#compras-status');
    if (!el) return;
    if (!dados) {
      el.textContent = 'Carregando notas destinadas ao CNPJ…';
      return;
    }
    const amb = dados.ambiente === 'producao' ? 'produção' : 'homologação';
    const pend = (dados.notas || []).filter((n) => n.status === 'Pendente').length;
    const partes = [];
    if (dados.ultimoErro && !(dados.certificadoOk && /n[aã]o configurado/i.test(dados.ultimoErro))) {
      partes.push(dados.ultimoErro);
    }
    if (dados.consultando) partes.push('Lendo a fila da SEFAZ (últimos 90 dias)');
    else if (dados.filaCompleta === false) partes.push('Ainda há notas na fila da SEFAZ');
    else if (dados.ultimaConsulta) partes.push(`Última consulta ${fmtQuando(dados.ultimaConsulta)}`);
    partes.push(`ambiente ${amb}`);
    partes.push(`${pend} pendente(s)`);
    partes.push('últimos 90 dias');
    el.textContent = partes.join(' · ');
    const chk = $('#compras-auto');
    if (chk && document.activeElement !== chk) chk.checked = !!dados.importarAutomatico;
    renderRelogio();
  }

  function minutosRestantes() {
    if (dados?.consultando && !dados?.proximaConsulta) return null;
    if (!dados?.proximaConsulta) return null;
    const ms = new Date(dados.proximaConsulta).getTime() - Date.now();
    if (!Number.isFinite(ms)) return null;
    if (ms <= 0) return 0;
    return Math.ceil(ms / 60000);
  }

  function renderRelogio() {
    const el = $('#compras-minutos');
    if (!el) return;
    const unidade = el.parentElement?.querySelector('span');
    const min = minutosRestantes();
    if (min == null) {
      el.textContent = dados?.consultando ? '…' : '—';
      if (unidade) unidade.textContent = '';
      return;
    }
    el.textContent = String(min);
    if (unidade) unidade.textContent = 'min';
  }

  function notasVisiveis() {
    const q = String($('#compras-busca')?.value || '').trim().toLowerCase();
    return (dados?.notas || []).filter((n) => {
      if (filtro !== 'todas' && n.status !== filtro) return false;
      if (!q) return true;
      const blob = `${n.emitente} ${n.cnpjEmit} ${n.nNF} ${n.serie} ${n.chave}`.toLowerCase();
      return blob.includes(q);
    });
  }

  function renderLista() {
    const box = $('#compras-lista');
    if (!box) return;
    const lista = notasVisiveis();
    if (!dados) {
      box.innerHTML = '<p class="hint">Carregando…</p>';
      return;
    }
    if (!lista.length) {
      const vazio = !dados.certificadoOk
        ? 'Sem certificado, a SEFAZ não envia as notas. Configure o A1 ou o certificado do Windows no serviço.'
        : (dados.notas || []).length
          ? 'Nenhuma nota neste filtro.'
          : 'Nenhuma NF-e dos últimos 90 dias. A SEFAZ só envia esse período; a lista compara com as já lançadas.';
      box.innerHTML = `<p class="hint">${esc(vazio)}</p>`;
      return;
    }
    box.innerHTML = lista.map((n) => {
      const titulo = esc(n.emitente || 'Fornecedor');
      const nf = `${esc(n.nNF || '—')}/${esc(n.serie || '—')}`;
      const pode = n.status === 'Pendente';
      return `
        <article class="item-row compras-row" data-chave="${esc(n.chave)}">
          <div class="item-avatar" aria-hidden="true">NF</div>
          <div class="item-main">
            <strong>${titulo}</strong>
            <div class="item-meta">
              <span class="chip">NF ${nf}</span>
              <span class="chip">${esc(fmtCnpj(n.cnpjEmit))}</span>
              <span class="chip">${esc(fmtDhEmi(n.dhEmi))}</span>
              <span class="chip">${esc(deps.fmtMoney ? deps.fmtMoney(n.vNF) : n.vNF)}</span>
            </div>
          </div>
          <div class="item-side">
            <span class="stock-badge ${statusClass(n.status)}">${esc(n.status)}</span>
            ${pode ? `<button type="button" class="btn small primary compras-importar" data-chave="${esc(n.chave)}">Importar</button>` : ''}
          </div>
        </article>`;
    }).join('');
    box.querySelectorAll('.compras-importar').forEach((btn) => {
      btn.addEventListener('click', () => importar(btn.dataset.chave, btn));
    });
  }

  async function load(opts = {}) {
    const res = opts.forcar
      ? await deps.api('/compras/sincronizar', { method: 'POST', body: {} })
      : await deps.api('/compras');
    if (!res?.ok && res?.error && !res.notas) {
      const el = $('#compras-status');
      if (el) el.textContent = res.error;
      return;
    }
    dados = res;
    renderStatus();
    renderLista();
  }

  async function salvarParametro() {
    const chk = $('#compras-auto');
    const res = await deps.api('/compras/parametro', {
      method: 'POST',
      body: { importarAutomatico: !!chk?.checked },
    });
    if (!res?.ok) {
      if (chk) chk.checked = !!dados?.importarAutomatico;
      deps.showMsg?.(res?.error || 'Não foi possível guardar o parâmetro.');
      return;
    }
    if (dados) dados.importarAutomatico = !!res.importarAutomatico;
    deps.showToast?.('Parâmetro guardado. A importação automática ainda não entra em vigor.');
  }

  async function importar(chave, btn) {
    if (importando) return;
    importando = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Importando…';
    }
    try {
      const xmlRes = await deps.api(`/compras/notas/${encodeURIComponent(chave)}/xml`, {
        method: 'POST',
        body: {},
      });
      if (!xmlRes?.ok || !xmlRes.xmlText) {
        deps.showMsg?.(xmlRes?.error || 'Não foi possível obter o XML da NF-e.');
        return;
      }
      const sess = await deps.api('/importacao/sessoes', {
        method: 'POST',
        body: { chave, xmlText: xmlRes.xmlText },
      });
      if (!sess?.ok) {
        deps.showMsg?.(sess?.error || 'Não foi possível abrir a compra.');
        if (sess?.code === 'DUPLICADA') load();
        return;
      }
      window.ImportacaoNfe?.abrirSessaoImportada?.(sess.sessao);
      await deps.openImportacao?.();
      const nNf = sess.sessao?.xml?.ide?.nNF || '';
      deps.showToast?.(nNf ? `NF ${nNf} aberta para lançamento` : 'Nota aberta para lançamento');
    } finally {
      importando = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Importar';
      }
    }
  }

  function onPageEnter() {
    const title = document.getElementById('page-title');
    const sub = document.getElementById('page-sub');
    if (title) title.textContent = 'Consultar compras';
    if (sub) sub.textContent = 'NF-e emitidas contra o CNPJ';
    load({ forcar: true });
    if (timer) clearInterval(timer);
    if (relogioTimer) clearInterval(relogioTimer);
    timer = setInterval(() => {
      const page = document.getElementById('page-compras');
      if (page && !page.hidden) load();
    }, 20000);
    relogioTimer = setInterval(() => {
      const page = document.getElementById('page-compras');
      if (page && !page.hidden) renderRelogio();
    }, 15000);
  }

  function onPageLeave() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (relogioTimer) {
      clearInterval(relogioTimer);
      relogioTimer = null;
    }
  }

  function bind() {
    $('#compras-filtro')?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-status]');
      if (!btn) return;
      filtro = btn.dataset.status || 'todas';
      $('#compras-filtro')?.querySelectorAll('.seg-btn').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      renderLista();
    });
    $('#compras-busca')?.addEventListener('input', () => renderLista());
    $('#compras-auto')?.addEventListener('change', () => salvarParametro());
  }

  function init(options) {
    deps = options || {};
    bind();
  }

  return { init, onPageEnter, onPageLeave };
})();

window.Compras = Compras;
