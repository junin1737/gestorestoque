/**
 * Condicionais de peças — lista, ficha do produto, PDF e WhatsApp.
 */
const Condicionais = (() => {
  let deps = {};

  function $(sel, root = document) {
    return root.querySelector(sel);
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function money(n) {
    return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function api(path, options = {}) {
    if (deps.api) return deps.api(path, options);
    return Promise.resolve({ ok: false, error: 'Painel ainda não iniciou.' });
  }

  function waLink(telefone, texto) {
    const digits = String(telefone || '').replace(/\D/g, '');
    const fone = digits ? (digits.startsWith('55') ? digits : `55${digits}`) : '';
    const q = encodeURIComponent(texto || '');
    return fone ? `https://wa.me/${fone}?text=${q}` : `https://wa.me/?text=${q}`;
  }

  function fichaHtml(doc, extra) {
    const itens = (doc.itens || []).map((it) => `
      <div class="item-row">
        <strong>${esc(it.descricao || 'Peça')}</strong>
        <span class="hint">Qtd ${esc(it.qtd)} · ${money(it.prc_unit)} · ${money(it.total)}</span>
      </div>`).join('');
    return `
      <div class="cond-ficha">
        <p><strong>Cliente:</strong> ${esc(doc.cliente || '—')}</p>
        <p><strong>Número:</strong> ${esc(doc.id)}</p>
        <p><strong>Emissão:</strong> ${esc(doc.data || '—')} ${esc(doc.horario || '')}</p>
        <p><strong>Vendedor:</strong> ${esc(doc.vendedor || '—')}</p>
        <p><strong>Situação:</strong> ${esc(doc.status_label || '')}</p>
        ${doc.obs ? `<p><strong>Obs.:</strong> ${esc(doc.obs)}</p>` : ''}
        ${doc.qtd != null ? `<p><strong>Quantidade desta peça:</strong> ${esc(doc.qtd)}</p>` : ''}
        ${extra || ''}
        ${itens}
        <div class="banco-actions" style="margin-top:12px">
          <button type="button" class="btn small" data-pdf="${esc(doc.id)}">Gerar PDF</button>
          <button type="button" class="btn small" data-wa="${esc(doc.id)}" data-fone="${esc(doc.telefone || '')}">Enviar WhatsApp</button>
        </div>
      </div>`;
  }

  async function abrirPdf(id) {
    window.open(`/api/condicionais/${encodeURIComponent(id)}/pdf`, '_blank', 'noopener');
  }

  async function enviarWhatsapp(id, telefone) {
    const res = await api(`/condicionais/${encodeURIComponent(id)}`);
    if (!res.ok) {
      alert(res.error || 'Não foi possível montar a mensagem.');
      return;
    }
    const fone = telefone || res.condicional?.telefone || '';
    window.open(waLink(fone, res.whatsapp || ''), '_blank', 'noopener');
  }

  function ligarAcoes(root) {
    root.querySelectorAll('[data-pdf]').forEach((btn) => {
      btn.addEventListener('click', () => abrirPdf(btn.dataset.pdf));
    });
    root.querySelectorAll('[data-wa]').forEach((btn) => {
      btn.addEventListener('click', () => enviarWhatsapp(btn.dataset.wa, btn.dataset.fone));
    });
    root.querySelectorAll('[data-cond]').forEach((btn) => {
      btn.addEventListener('click', () => mostrarDetalhe(btn.dataset.cond));
    });
  }

  async function mostrarDetalhe(id) {
    const box = $('#cond-detalhe');
    if (!box) return;
    box.hidden = false;
    box.innerHTML = '<p class="hint">Carregando…</p>';
    const res = await api(`/condicionais/${encodeURIComponent(id)}`);
    if (!res.ok) {
      box.innerHTML = `<p class="hint">${esc(res.error || 'Não encontrado')}</p>`;
      return;
    }
    box.innerHTML = fichaHtml(res.condicional);
    ligarAcoes(box);
  }

  async function abrirLista() {
    const lista = $('#cond-lista');
    const aviso = $('#cond-aviso');
    if (!lista) return;
    lista.innerHTML = '<p class="hint">Carregando…</p>';
    const res = await api('/condicionais');
    if (!res.ok) {
      lista.innerHTML = `<p class="hint">${esc(res.error || 'Falha ao listar')}</p>`;
      return;
    }
    if (aviso) {
      aviso.hidden = !res.aviso;
      aviso.textContent = res.aviso || '';
    }
    const itens = res.itens || [];
    if (!itens.length) {
      lista.innerHTML = '<p class="empty">Nenhum condicional nesta base.</p>';
      return;
    }
    lista.innerHTML = itens.map((it) => `
      <button type="button" class="item-row" data-cond="${esc(it.id)}">
        <strong>Nº ${esc(it.id)} · ${esc(it.cliente || 'Sem cliente')}</strong>
        <span class="hint">${esc(it.data)} ${esc(it.horario)} · ${esc(it.vendedor || 'sem vendedor')} · ${esc(it.status_label)} · ${money(it.total)}</span>
      </button>`).join('');
    ligarAcoes(lista);
  }

  async function abrirDoProduto(id) {
    const dlg = $('#dlg-condicional');
    const body = $('#dlg-condicional-body');
    if (!dlg || !body) return;
    body.innerHTML = '<p class="hint">Carregando…</p>';
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.hidden = false;
    const res = await api(`/condicionais/produto/${encodeURIComponent(id)}`);
    if (!res.ok) {
      body.innerHTML = `<p class="hint">${esc(res.error || 'Falha')}</p>`;
      return;
    }
    const conds = res.condicionais || [];
    const reservas = res.reservas || [];
    if (!conds.length && !reservas.length) {
      body.innerHTML = '<p class="hint">Não há condicional nem reserva para esta peça.</p>';
      return;
    }
    const blocos = [];
    for (const c of conds) blocos.push(fichaHtml(c, '<p class="hint">Condicional de peças</p>'));
    for (const r of reservas) {
      blocos.push(`<div class="cond-ficha">
        <p class="hint">Reserva que compõe a quantidade reservada</p>
        <p><strong>Cliente:</strong> ${esc(r.cliente || '—')}</p>
        <p><strong>Documento:</strong> ${esc(r.tipo)} ${esc(r.numero)}</p>
        <p><strong>Data:</strong> ${esc(r.data || '—')}</p>
        <p><strong>Quantidade:</strong> ${esc(r.qtd)}</p>
      </div>`);
    }
    body.innerHTML = blocos.join('<hr>');
    ligarAcoes(body);
  }

  let clienteId = 0;
  let itensNovos = [];

  function renderItensNovos() {
    const box = $('#cond-novos-itens');
    if (!box) return;
    if (!itensNovos.length) {
      box.innerHTML = '<p class="hint">Nenhuma peça incluída.</p>';
      return;
    }
    box.innerHTML = itensNovos.map((it, i) => `
      <div class="item-row">
        <strong>${esc(it.descricao)}</strong>
        <span class="hint">Qtd ${esc(it.qtd)} · ${money(it.prc_venda)}</span>
        <button type="button" class="btn small" data-rm="${i}">Tirar</button>
      </div>`).join('');
    box.querySelectorAll('[data-rm]').forEach((btn) => {
      btn.addEventListener('click', () => {
        itensNovos.splice(Number(btn.dataset.rm), 1);
        renderItensNovos();
      });
    });
  }

  function ligarFormulario() {
    let timer = null;
    $('#cond-cliente')?.addEventListener('input', () => {
      clienteId = 0;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = $('#cond-cliente').value.trim();
        const box = $('#cond-cliente-lista');
        if (!box || q.length < 2) {
          if (box) box.innerHTML = '';
          return;
        }
        const res = await api(`/condicionais/clientes?q=${encodeURIComponent(q)}`);
        box.innerHTML = (res.itens || []).map((c) => `
          <button type="button" class="item-row" data-cli="${c.id_cliente}" data-nome="${esc(c.nome)}">${esc(c.nome)}</button>`).join('');
        box.querySelectorAll('[data-cli]').forEach((btn) => {
          btn.addEventListener('click', () => {
            clienteId = Number(btn.dataset.cli);
            $('#cond-cliente').value = btn.dataset.nome;
            box.innerHTML = '';
          });
        });
      }, 250);
    });
    $('#cond-add-peca')?.addEventListener('click', async () => {
      const codigo = String($('#cond-peca')?.value || '').trim();
      const qtd = Number($('#cond-qtd')?.value || 0);
      if (!codigo || qtd <= 0) return;
      const res = await api(`/estoque/${encodeURIComponent(codigo)}`);
      const item = res.item;
      if (!res.ok || !item) {
        alert(res.error || 'Produto não encontrado. Use o identificador.');
        return;
      }
      itensNovos.push({
        id_identificador: item.id_identificador,
        descricao: item.descricao_exibicao || item.descricao,
        qtd,
        prc_venda: Number(item.prc_venda || 0),
      });
      $('#cond-peca').value = '';
      renderItensNovos();
    });
    $('#cond-salvar')?.addEventListener('click', async () => {
      const msg = $('#cond-form-msg');
      const res = await api('/condicionais', {
        method: 'POST',
        body: {
          id_cliente: clienteId,
          id_funcionario: Number($('#cond-vendedor')?.value || 0),
          obs: $('#cond-obs')?.value || '',
          itens: itensNovos,
        },
      });
      if (!res.ok) {
        if (msg) msg.textContent = res.error || 'Não foi possível lançar.';
        return;
      }
      clienteId = 0;
      itensNovos = [];
      if ($('#cond-cliente')) $('#cond-cliente').value = '';
      if ($('#cond-obs')) $('#cond-obs').value = '';
      renderItensNovos();
      if (msg) msg.textContent = `Condicional ${res.id} lançado.`;
      abrirLista();
      mostrarDetalhe(res.id);
    });
    $('#dlg-condicional-fechar')?.addEventListener('click', () => {
      const dlg = $('#dlg-condicional');
      if (dlg?.close) dlg.close();
    });
  }

  async function carregarVendedores() {
    const sel = $('#cond-vendedor');
    if (!sel || sel.dataset.pronto === '1') return;
    const res = await api('/condicionais/vendedores');
    sel.innerHTML = '<option value="">—</option>' + (res.itens || []).map((v) =>
      `<option value="${v.id_funcionario}">${esc(v.nome)}</option>`).join('');
    sel.dataset.pronto = '1';
  }

  function onPageEnter() {
    carregarVendedores();
    abrirLista();
    renderItensNovos();
  }

  function init(options) {
    deps = options || {};
    ligarFormulario();
  }

  return { init, onPageEnter, abrirDoProduto };
})();

window.Condicionais = Condicionais;
