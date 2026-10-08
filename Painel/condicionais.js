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
        <p><strong>Validade:</strong> ${esc(doc.validade || '—')}</p>
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

  function abrirNoDialogo(url, titulo) {
    const dlg = $('#dlg-danfe');
    const frame = $('#dlg-danfe-frame');
    const barra = dlg?.querySelector('.dlg-danfe-bar strong');
    if (dlg && frame && typeof dlg.showModal === 'function') {
      if (barra) barra.textContent = titulo || 'PDF';
      frame.removeAttribute('srcdoc');
      frame.src = url;
      if (!dlg.open) dlg.showModal();
      return;
    }
    window.open(url, '_blank', 'noopener');
  }

  async function abrirPdf(id) {
    const escolha = $('#dlg-cond-pdf');
    const campo = $('#cond-pdf-validade');
    if (campo) {
      const res = await api(`/condicionais/${encodeURIComponent(id)}`);
      campo.value = res.condicional?.validade_iso || '';
    }
    if (escolha && typeof escolha.showModal === 'function') {
      const formato = await new Promise((resolve) => {
        const fechar = () => {
          escolha.removeEventListener('close', fechar);
          resolve(escolha.returnValue === 'ok' ? ($('#cond-pdf-formato')?.value || 'a4') : '');
        };
        escolha.addEventListener('close', fechar);
        escolha.showModal();
      });
      if (!formato) return;
      const validade = campo?.value || '';
      const url = `/api/condicionais/${encodeURIComponent(id)}/pdf?formato=${encodeURIComponent(formato)}&validade=${encodeURIComponent(validade)}`;
      abrirNoDialogo(url, 'Condicional');
      return;
    }
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

  function fecharNovo() {
    const box = $('#cond-novo');
    if (box) box.hidden = true;
  }

  async function mostrarDetalhe(id) {
    fecharNovo();
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
    const sel = $('#cond-status');
    if (!lista) return;
    const filtro = sel?.value || 'reservado';
    lista.innerHTML = '<p class="hint">Carregando…</p>';
    const res = await api(`/condicionais?status=${encodeURIComponent(filtro)}`);
    if (!res.ok) {
      lista.innerHTML = `<p class="hint">${esc(res.error || 'Falha ao listar')}</p>`;
      return;
    }
    if (sel && res.statuses && sel.dataset.pronto !== '1') {
      const atual = sel.value || 'reservado';
      const opts = ['<option value="reservado">Reservados (seguram estoque)</option>'];
      for (const st of res.statuses) {
        opts.push(`<option value="${st.id}">${esc(st.descricao)}${st.reserva ? ' · reserva' : ''}</option>`);
      }
      opts.push('<option value="todos">Todos</option>');
      sel.innerHTML = opts.join('');
      sel.value = [...sel.options].some((o) => o.value === atual) ? atual : 'reservado';
      sel.dataset.pronto = '1';
    }
    if (aviso && res.aviso) aviso.textContent = res.aviso;
    const itens = res.itens || [];
    if (!itens.length) {
      lista.innerHTML = '<p class="empty">Nenhum condicional nesta situação.</p>';
      return;
    }
    lista.innerHTML = itens.map((it) => `
      <button type="button" class="item-row" data-cond="${esc(it.id)}">
        <strong>Nº ${esc(it.id)} · ${esc(it.cliente || 'Sem cliente')}</strong>
        <span class="hint">${esc(it.data)} ${esc(it.horario)} · ${esc(it.vendedor || 'sem vendedor')} · ${esc(it.status_label)}${it.reserva ? ' · reserva estoque' : ''} · ${money(it.total)}</span>
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
    for (const c of conds) blocos.push(fichaHtml(c));
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
  let clienteNome = '';
  let itensNovos = [];

  function marcarCliente(id, nome) {
    clienteId = Number(id) || 0;
    clienteNome = clienteId ? String(nome || '') : '';
    const aviso = $('#cond-cliente-escolhido');
    if (aviso) aviso.textContent = clienteId ? `Cliente selecionado: ${clienteNome}` : 'Nenhum cliente selecionado.';
  }

  function botaoSugestao(texto, attrs) {
    return `<button type="button" class="cond-pick" ${attrs}>${texto}</button>`;
  }

  function incluirPeca(item) {
    const qtd = Number($('#cond-qtd')?.value || 0);
    const msg = $('#cond-form-msg');
    if (!(qtd > 0)) {
      if (msg) msg.textContent = 'Informe a quantidade.';
      return;
    }
    itensNovos.push({
      id_identificador: Number(item.id_identificador),
      descricao: item.descricao,
      qtd,
      prc_venda: Number(item.prc_venda || 0),
    });
    if ($('#cond-peca')) $('#cond-peca').value = '';
    const lista = $('#cond-peca-lista');
    if (lista) lista.innerHTML = '';
    if (msg) msg.textContent = '';
    renderItensNovos();
  }

  function renderItensNovos() {
    const box = $('#cond-novos-itens');
    if (!box) return;
    if (!itensNovos.length) {
      box.innerHTML = '<p class="hint">Nenhuma peça incluída.</p>';
      return;
    }
    box.innerHTML = itensNovos.map((it, i) => `
      <div class="cond-item">
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
    let timerCliente = null;
    let timerPeca = null;
    $('#cond-cliente')?.addEventListener('input', () => {
      marcarCliente(0, '');
      clearTimeout(timerCliente);
      timerCliente = setTimeout(async () => {
        const q = $('#cond-cliente').value.trim();
        const box = $('#cond-cliente-lista');
        if (!box) return;
        if (q.length < 2) {
          box.innerHTML = '';
          return;
        }
        const res = await api(`/condicionais/clientes?q=${encodeURIComponent(q)}`);
        if (!res.ok) {
          box.innerHTML = `<p class="hint">${esc(res.error || 'Não foi possível buscar clientes.')}</p>`;
          return;
        }
        const itens = res.itens || [];
        if (!itens.length) {
          box.innerHTML = '<p class="hint">Nenhum cliente com esse nome. Escolha um já cadastrado.</p>';
          return;
        }
        box.innerHTML = itens.map((c) => botaoSugestao(esc(c.nome), `data-cli="${c.id_cliente}" data-nome="${esc(c.nome)}"`)).join('');
        box.querySelectorAll('[data-cli]').forEach((btn) => {
          btn.addEventListener('click', () => {
            marcarCliente(btn.dataset.cli, btn.dataset.nome);
            $('#cond-cliente').value = btn.dataset.nome;
            box.innerHTML = '';
          });
        });
      }, 250);
    });
    $('#cond-peca')?.addEventListener('input', () => {
      clearTimeout(timerPeca);
      timerPeca = setTimeout(async () => {
        const q = String($('#cond-peca')?.value || '').trim();
        const box = $('#cond-peca-lista');
        if (!box) return;
        if (q.length < 1) {
          box.innerHTML = '';
          return;
        }
        const res = await api(`/condicionais/produtos?q=${encodeURIComponent(q)}`);
        if (!res.ok) {
          box.innerHTML = `<p class="hint">${esc(res.error || 'Não foi possível buscar peças.')}</p>`;
          return;
        }
        const itens = res.itens || [];
        if (!itens.length) {
          box.innerHTML = '<p class="hint">Nenhuma peça encontrada.</p>';
          return;
        }
        box.innerHTML = itens.map((p) => {
          const extra = [p.cod_barras ? `barras ${p.cod_barras}` : '', p.referencia ? `ref. ${p.referencia}` : ''].filter(Boolean).join(' · ');
          return botaoSugestao(
            `<strong>${esc(p.id_identificador)}</strong> ${esc(p.descricao)}<span class="hint"> · cód. ${esc(p.id_estoque)}${extra ? ` · ${esc(extra)}` : ''} · ${money(p.prc_venda)}</span>`,
            `data-id="${p.id_identificador}" data-desc="${esc(p.descricao)}" data-prc="${p.prc_venda}"`
          );
        }).join('');
        box.querySelectorAll('[data-id]').forEach((btn) => {
          btn.addEventListener('click', () => incluirPeca({
            id_identificador: Number(btn.dataset.id),
            descricao: btn.dataset.desc,
            prc_venda: Number(btn.dataset.prc || 0),
          }));
        });
      }, 250);
    });
    $('#cond-add-peca')?.addEventListener('click', async () => {
      const codigo = String($('#cond-peca')?.value || '').trim();
      const box = $('#cond-peca-lista');
      if (!codigo) {
        if (box) box.innerHTML = '<p class="hint">Informe o nome, o identificador, o código, as barras ou a referência.</p>';
        return;
      }
      const res = await api(`/condicionais/produtos?q=${encodeURIComponent(codigo)}`);
      const itens = res.itens || [];
      if (!res.ok || !itens.length) {
        if (box) box.innerHTML = `<p class="hint">${esc(res.error || 'Nenhuma peça encontrada.')}</p>`;
        return;
      }
      if (itens.length === 1) {
        incluirPeca(itens[0]);
        return;
      }
      if (box) box.innerHTML = '<p class="hint">Há mais de uma peça. Toque na lista para incluir.</p>';
    });
    $('#cond-salvar')?.addEventListener('click', async () => {
      const msg = $('#cond-form-msg');
      const res = await api('/condicionais', {
        method: 'POST',
        body: {
          id_cliente: clienteId,
          id_funcionario: Number($('#cond-vendedor')?.value || 0),
          obs: $('#cond-obs')?.value || '',
          validade: $('#cond-validade')?.value || '',
          itens: itensNovos,
        },
      });
      if (!res.ok) {
        if (msg) msg.textContent = res.error || 'Não foi possível lançar.';
        return;
      }
      marcarCliente(0, '');
      itensNovos = [];
      if ($('#cond-cliente')) $('#cond-cliente').value = '';
      if ($('#cond-obs')) $('#cond-obs').value = '';
      if ($('#cond-validade')) $('#cond-validade').value = '';
      if ($('#cond-peca-lista')) $('#cond-peca-lista').innerHTML = '';
      if ($('#cond-cliente-lista')) $('#cond-cliente-lista').innerHTML = '';
      renderItensNovos();
      if (msg) msg.textContent = '';
      const aviso = $('#cond-aviso');
      if (aviso) aviso.textContent = `Condicional ${res.id} lançado como reservado. A quantidade fica reservada no estoque.`;
      fecharNovo();
      const sel = $('#cond-status');
      if (sel) sel.value = 'reservado';
      abrirLista();
    });
    $('#cond-novo-btn')?.addEventListener('click', () => {
      const box = $('#cond-novo');
      const det = $('#cond-detalhe');
      if (det) det.hidden = true;
      if (box) {
        box.hidden = false;
        box.scrollIntoView({ block: 'start' });
        $('#cond-cliente')?.focus();
      }
      carregarVendedores();
    });
    $('#cond-cancelar')?.addEventListener('click', () => fecharNovo());
    $('#cond-status')?.addEventListener('change', () => abrirLista());
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
    fecharNovo();
    const det = $('#cond-detalhe');
    if (det) det.hidden = true;
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
