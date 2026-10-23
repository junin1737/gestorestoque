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

  function descontoDocumento(doc) {
    const itens = (doc?.itens || []).reduce((s, it) => s + Number(it.desconto || 0), 0);
    return itens + Number(doc?.desconto_geral || 0);
  }

  function acrescimoDocumento(doc) {
    const itens = (doc?.itens || []).reduce((s, it) => s + Number(it.acrescimo || 0), 0);
    return itens + Number(doc?.acrescimo_geral || 0);
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
        <span class="hint">Qtd ${esc(it.qtd)} · ${money(it.prc_unit)}${Number(it.desconto) > 0 ? ` · desc. ${money(it.desconto)}` : ''} · ${money(Math.max(0, Number(it.total || 0) - Number(it.desconto || 0)))}</span>
      </div>`).join('');
    return `
      <div class="cond-ficha">
        <p><strong>Cliente:</strong> ${esc(doc.cliente || '—')}</p>
        <p><strong>Número:</strong> ${esc(doc.id)}</p>
        <p><strong>Emissão:</strong> ${esc(doc.data || '—')} ${esc(doc.horario || '')}</p>
        <p><strong>Validade:</strong> ${esc(doc.validade || '—')}</p>
        <p><strong>Vendedor:</strong> ${esc(doc.vendedor || '—')}</p>
        ${doc.pagamento ? `<p><strong>Pagamento:</strong> ${esc(doc.pagamento)}</p>` : ''}
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

  let statuses = [];
  let abertoId = 0;

  function painel(modo) {
    const split = $('#cond-split');
    const vazio = $('#cond-painel-vazio');
    const novo = $('#cond-novo');
    const det = $('#cond-detalhe');
    if (split) split.classList.toggle('is-aberto', modo !== 'vazio');
    if (vazio) vazio.hidden = modo !== 'vazio';
    if (novo) novo.hidden = modo !== 'novo';
    if (det) det.hidden = modo !== 'detalhe';
    if (modo !== 'detalhe') abertoId = 0;
    marcarCardAtivo();
  }

  function fecharNovo() {
    const dlg = $('#dlg-cond-item');
    if (dlg?.open) dlg.close();
    if (editandoId) limparLancamento();
    painel('vazio');
  }

  function marcarCardAtivo() {
    document.querySelectorAll('.cond-card').forEach((card) => {
      card.classList.toggle('is-ativo', Number(card.dataset.cond) === abertoId);
    });
  }

  function opcoesStatus(atual) {
    const lista = statuses.slice();
    if (atual && !lista.some((s) => String(s.id) === String(atual))) {
      lista.unshift({ id: atual, descricao: 'Situação atual', reserva: false });
    }
    return lista.map((st) => `
      <option value="${esc(st.id)}" ${String(st.id) === String(atual) ? 'selected' : ''}>${esc(st.descricao)}${st.reserva ? ' · reserva' : ''}</option>`).join('');
  }

  let pagamentos = null;

  async function carregarPagamentos() {
    if (Array.isArray(pagamentos)) return pagamentos;
    const res = await api('/condicionais/pagamentos');
    if (!res.ok) return [];
    pagamentos = res.itens || [];
    return pagamentos;
  }

  function opcoesPagamento(atual) {
    const lista = (pagamentos || []).slice();
    if (atual && Number(atual) !== 1 && !lista.some((p) => String(p.id_parcela) === String(atual))) {
      lista.unshift({ id_parcela: atual, descricao: 'Forma atual' });
    }
    const vazio = `<option value="">${atual && Number(atual) !== 1 ? '—' : 'Selecione'}</option>`;
    return vazio + lista.map((p) => `
      <option value="${esc(p.id_parcela)}" ${String(p.id_parcela) === String(atual) ? 'selected' : ''}>${esc(p.descricao)}</option>`).join('');
  }

  async function preencherPagamentoLancamento() {
    const sel = $('#cond-pagamento');
    if (!sel) return;
    const atual = sel.value;
    await carregarPagamentos();
    sel.innerHTML = opcoesPagamento(atual);
  }

  function statusPadrao() {
    return (statuses.find((s) => s.reserva) || statuses[0] || {}).id || '';
  }

  function preencherStatusLancamento() {
    const sel = $('#cond-lanc-status');
    if (!sel) return;
    sel.innerHTML = opcoesStatus(statusPadrao());
  }

  async function mostrarDetalhe(id, aviso = '') {
    const box = $('#cond-detalhe');
    if (!box) return;
    abertoId = Number(id) || 0;
    painel('detalhe');
    abertoId = Number(id) || 0;
    marcarCardAtivo();
    if (!aviso) box.innerHTML = '<p class="hint">Carregando…</p>';
    const res = await api(`/condicionais/${encodeURIComponent(id)}`);
    if (!res.ok) {
      box.innerHTML = `<p class="hint">${esc(res.error || 'Não encontrado')}</p>`;
      return;
    }
    const doc = res.condicional || {};
    await carregarPagamentos();
    const itens = (doc.itens || []).map((it) => `
      <div class="cond-item">
        <strong>${esc(it.descricao || 'Peça')}</strong>
        <span class="hint">Qtd ${esc(it.qtd)} · ${money(it.prc_unit)}${Number(it.desconto) > 0 ? ` · desc. ${money(it.desconto)}` : ''} · ${money(Math.max(0, Number(it.total || 0) - Number(it.desconto || 0)))}</span>
      </div>`).join('');
    box.innerHTML = `
      <div class="cond-form-head">
        <h3>Condicional ${esc(doc.id)}</h3>
        <button type="button" class="btn small" id="cond-fechar-detalhe">Fechar</button>
      </div>
      <div class="cond-ficha">
        <p class="cond-meta"><strong>${esc(doc.cliente || 'Sem cliente')}</strong> · ${esc(doc.data || '—')} ${esc(doc.horario || '')} · ${esc(doc.vendedor || 'sem vendedor')}</p>
        <p class="hint">Validade ${esc(doc.validade || '—')}${doc.obs ? ` · ${esc(doc.obs)}` : ''}</p>
        <div class="cond-detalhe-campos">
          <label class="cond-filtro">Situação
            <select id="cond-detalhe-status">${opcoesStatus(doc.status)}</select>
          </label>
          <label class="cond-filtro">Pagamento
            <select id="cond-detalhe-pagamento">${opcoesPagamento(doc.id_parcela)}</select>
          </label>
        </div>
        <p class="hint" id="cond-detalhe-msg">${esc(aviso)}</p>
        <div class="cond-acoes">
          <button type="button" class="btn" id="cond-editar">Editar</button>
          <button type="button" class="btn primary" id="cond-salvar-status">Salvar</button>
          ${doc.pode_reprovar ? '<button type="button" class="btn danger" id="cond-reprovar">Reprovar</button>' : ''}
          <button type="button" class="btn" data-pdf="${esc(doc.id)}">Gerar PDF</button>
          <button type="button" class="btn" data-wa="${esc(doc.id)}" data-fone="${esc(doc.telefone || '')}">WhatsApp</button>
        </div>
        <p><strong>Peças:</strong> ${esc((doc.itens || []).reduce((s, it) => s + Number(it.qtd || 0), 0))}</p>
        ${itens || '<p class="hint">Sem peças.</p>'}
        ${Number(doc.frete) > 0 ? `<p><strong>Frete:</strong> ${money(doc.frete)}</p>` : ''}
        ${descontoDocumento(doc) > 0 ? `<p><strong>Desconto:</strong> ${money(descontoDocumento(doc))}</p>` : ''}
        ${acrescimoDocumento(doc) > 0 ? `<p><strong>Acréscimo:</strong> ${money(acrescimoDocumento(doc))}</p>` : ''}
        <p><strong>Total:</strong> ${money(doc.total)}</p>
      </div>`;
    ligarAcoes(box);
    $('#cond-fechar-detalhe')?.addEventListener('click', () => fecharNovo());
    $('#cond-editar')?.addEventListener('click', () => abrirEdicao(doc));

    const botoes = ['#cond-salvar-status', '#cond-reprovar'].map((s) => $(s)).filter(Boolean);
    async function gravar(botao, textoBotao, chamada, ok) {
      const msg = $('#cond-detalhe-msg');
      const original = botao.textContent;
      botoes.forEach((b) => { b.disabled = true; });
      botao.textContent = textoBotao;
      if (msg) msg.textContent = '';
      let salvo;
      try {
        salvo = await chamada();
      } catch (err) {
        salvo = { ok: false, error: err?.message };
      } finally {
        botoes.forEach((b) => { b.disabled = false; });
        botao.textContent = original;
      }
      if (!salvo?.ok) {
        if (msg) msg.textContent = salvo?.error || 'Não foi possível salvar. Tente de novo.';
        return;
      }
      await abrirLista();
      await mostrarDetalhe(doc.id, typeof ok === 'function' ? ok(salvo) : ok);
    }

    $('#cond-salvar-status')?.addEventListener('click', (e) => {
      const idStatus = Number($('#cond-detalhe-status')?.value || 0);
      const idParcela = Number($('#cond-detalhe-pagamento')?.value || 0);
      gravar(e.currentTarget, 'Salvando…', () => api(`/condicionais/${encodeURIComponent(doc.id)}/status`, {
        method: 'POST',
        body: { id_status: idStatus, id_parcela: idParcela || undefined },
      }), 'Condicional atualizado.');
    });
    $('#cond-reprovar')?.addEventListener('click', (e) => {
      const pergunta = `Reprovar o condicional ${doc.id}${doc.cliente ? ` de ${doc.cliente}` : ''}?\n\nAs peças reservadas voltam para o estoque disponível.`;
      if (!window.confirm(pergunta)) return;
      gravar(e.currentTarget, 'Reprovando…', () => api(`/condicionais/${encodeURIComponent(doc.id)}/reprovar`, {
        method: 'POST',
      }), (salvo) => (salvo.estornou_reserva
        ? 'Condicional reprovado. A reserva das peças foi estornada.'
        : 'Condicional reprovado.'));
    });
  }

  async function abrirLista() {
    const lista = $('#cond-lista');
    const aviso = $('#cond-aviso');
    const sel = $('#cond-status');
    if (!lista) return;
    const filtro = sel?.value || 'todos';
    const q = String($('#cond-busca')?.value || '').trim();
    lista.innerHTML = '<p class="hint">Carregando…</p>';
    const qs = new URLSearchParams({ status: filtro });
    if (q) qs.set('q', q);
    const res = await api(`/condicionais?${qs}`);
    if (!res.ok) {
      lista.innerHTML = `<p class="hint">${esc(res.error || 'Falha ao listar')}</p>`;
      return;
    }
    if (Array.isArray(res.statuses)) statuses = res.statuses;
    if (sel && res.statuses && sel.dataset.pronto !== '1') {
      const atual = sel.value || 'todos';
      const opts = [
        '<option value="todos">Todos</option>',
        '<option value="reservado">Reservados</option>',
      ];
      for (const st of res.statuses) {
        opts.push(`<option value="${st.id}">${esc(st.descricao)}${st.reserva ? ' · reserva' : ''}</option>`);
      }
      sel.innerHTML = opts.join('');
      sel.value = [...sel.options].some((o) => o.value === atual) ? atual : 'todos';
      sel.dataset.pronto = '1';
      preencherStatusLancamento();
    }
    if (aviso) {
      aviso.hidden = !res.aviso;
      if (res.aviso) aviso.textContent = res.aviso;
    }
    const itens = res.itens || [];
    if (!itens.length) {
      lista.innerHTML = q
        ? '<p class="empty">Nenhum condicional com esse número ou cliente.</p>'
        : '<p class="empty">Nenhum condicional nesta situação.</p>';
      return;
    }
    lista.innerHTML = itens.map((it) => `
      <button type="button" class="cond-card${Number(it.id) === abertoId ? ' is-ativo' : ''}" data-cond="${esc(it.id)}">
        <span class="cond-card-top">
          <strong>${esc(it.id)}</strong>
          <span class="cond-card-nome">${esc(it.cliente || 'Sem cliente')}</span>
          <span class="cond-pill${it.reserva ? ' is-reserva' : ''}">${esc(it.status_label)}</span>
        </span>
        <span class="hint">${esc(it.data)} ${esc(it.horario)} · ${money(it.total)}</span>
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
  let editandoId = 0;
  let descontoExtra = 0;
  let acrescimoExtra = 0;
  let pecaAtual = null;

  function textoEstoque(p) {
    const d = Number(p?.qtd_disponivel);
    if (!Number.isFinite(d)) return '';
    if (d <= 0) return 'Sem estoque';
    return `Estoque ${d.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}`;
  }

  function restante(item) {
    const usado = itensNovos
      .filter((it) => Number(it.id_identificador) === Number(item.id_identificador))
      .reduce((s, it) => s + Number(it.qtd || 0), 0);
    return Number(item.qtd_disponivel) - usado;
  }

  function campoMoeda(n) {
    return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function tituloFormulario() {
    const h = $('#cond-form-titulo');
    const btn = $('#cond-salvar');
    if (h) h.textContent = editandoId ? `Editar condicional ${editandoId}` : 'Novo condicional';
    if (btn) btn.textContent = editandoId ? 'Salvar alterações' : 'Lançar condicional';
  }

  function somaDescontoItens() {
    return itensNovos.reduce((s, it) => s + Number(it.desconto || 0), 0);
  }

  function somaAcrescimoItens() {
    return itensNovos.reduce((s, it) => s + Number(it.acrescimo || 0), 0);
  }

  function textoParte(itens, geral) {
    return `Itens ${money(itens)}<br>Geral ${money(geral)}`;
  }

  function escreverPartes() {
    const desc = $('#cond-desc-partes');
    const acres = $('#cond-acres-partes');
    if (desc) desc.innerHTML = textoParte(somaDescontoItens(), descontoExtra);
    if (acres) acres.innerHTML = textoParte(somaAcrescimoItens(), acrescimoExtra);
  }

  function escreverCampoDesconto() {
    const el = $('#cond-desc-ped');
    if (el && document.activeElement !== el) {
      const valor = somaDescontoItens() + descontoExtra;
      el.value = valor > 0 ? campoMoeda(valor) : '';
    }
    escreverPartes();
  }

  function escreverCampoAcrescimo() {
    const el = $('#cond-acres-ped');
    if (el && document.activeElement !== el) {
      const valor = somaAcrescimoItens() + acrescimoExtra;
      el.value = valor > 0 ? campoMoeda(valor) : '';
    }
    escreverPartes();
  }

  function limparLancamento() {
    editandoId = 0;
    descontoExtra = 0;
    acrescimoExtra = 0;
    marcarCliente(0, '');
    itensNovos = [];
    if ($('#cond-cliente')) $('#cond-cliente').value = '';
    if ($('#cond-obs')) $('#cond-obs').value = '';
    if ($('#cond-validade')) $('#cond-validade').value = '';
    if ($('#cond-pagamento')) $('#cond-pagamento').value = '';
    if ($('#cond-frete')) $('#cond-frete').value = '';
    if ($('#cond-desc-ped')) $('#cond-desc-ped').value = '';
    if ($('#cond-acres-ped')) $('#cond-acres-ped').value = '';
    if ($('#cond-form-msg')) $('#cond-form-msg').textContent = '';
    limparDialogoItem();
    mostrarLista($('#cond-cliente-lista'), '');
    renderItensNovos();
    tituloFormulario();
  }

  async function abrirEdicao(doc) {
    editandoId = Number(doc.id) || 0;
    painel('novo');
    await carregarVendedores();
    preencherStatusLancamento();
    await preencherPagamentoLancamento();
    marcarCliente(doc.id_cliente, doc.cliente);
    if ($('#cond-cliente')) $('#cond-cliente').value = doc.cliente || '';
    if ($('#cond-vendedor')) $('#cond-vendedor').value = String(doc.id_funcionario || '');
    if ($('#cond-validade')) $('#cond-validade').value = doc.validade_iso || '';
    if ($('#cond-lanc-status')) $('#cond-lanc-status').value = String(doc.status || '');
    if ($('#cond-pagamento')) {
      const parcela = Number(doc.id_parcela || 0);
      $('#cond-pagamento').value = parcela && parcela !== 1 ? String(parcela) : '';
    }
    if ($('#cond-obs')) $('#cond-obs').value = doc.obs || '';
    if ($('#cond-frete')) $('#cond-frete').value = Number(doc.frete) ? campoMoeda(doc.frete) : '';
    descontoExtra = Number(doc.desconto_geral || 0);
    acrescimoExtra = Number(doc.acrescimo_geral || 0);
    itensNovos = (doc.itens || []).map((it) => ({
      id_item: it.id,
      id_identificador: it.id_identificador,
      descricao: it.descricao,
      qtd: it.qtd,
      prc_venda: it.prc_unit,
      desconto: it.desconto,
      acrescimo: it.acrescimo,
      total: Math.max(0, Number(it.total || 0) - Number(it.desconto || 0)),
    }));
    renderItensNovos();
    tituloFormulario();
    $('#cond-cliente')?.focus();
  }

  function perguntarEnvio(id) {
    const dlg = $('#dlg-cond-fim');
    const texto = $('#dlg-cond-fim-text');
    if (texto) texto.textContent = `Condicional ${id} salvo. Deseja gerar o PDF ou enviar no WhatsApp?`;
    if (!dlg || typeof dlg.showModal !== 'function') return;
    let fechou = false;
    const fim = (acao) => {
      if (fechou) return;
      fechou = true;
      $('#cond-fim-pdf').onclick = null;
      $('#cond-fim-wa').onclick = null;
      $('#cond-fim-nao').onclick = null;
      dlg.onclose = null;
      if (dlg.open) dlg.close();
      if (acao === 'pdf') abrirPdf(id);
      if (acao === 'wa') enviarWhatsapp(id, '');
    };
    $('#cond-fim-pdf').onclick = () => fim('pdf');
    $('#cond-fim-wa').onclick = () => fim('wa');
    $('#cond-fim-nao').onclick = () => fim('');
    dlg.onclose = () => fim('');
    if (!dlg.open) dlg.showModal();
  }

  function marcarCliente(id, nome) {
    clienteId = Number(id) || 0;
    clienteNome = clienteId ? String(nome || '') : '';
    const aviso = $('#cond-cliente-escolhido');
    if (aviso) aviso.textContent = clienteId ? `Cliente selecionado: ${clienteNome}` : 'Nenhum cliente selecionado.';
  }

  function htmlPecas(itens) {
    return itens.map((p) => {
      const extra = [p.cod_barras ? `barras ${p.cod_barras}` : '', p.referencia ? `ref. ${p.referencia}` : '', textoEstoque(p), money(p.prc_venda)].filter(Boolean).join(' · ');
      const sem = Number(p.qtd_disponivel) <= 0 ? ' is-sem-estoque' : '';
      return `<button type="button" class="cond-combo-opt${sem}" data-id="${p.id_identificador}" data-desc="${esc(p.descricao)}" data-prc="${p.prc_venda}" data-disp="${p.qtd_disponivel}"><strong>${esc(p.descricao)}</strong><span>cód. ${esc(p.id_estoque)} · id. ${esc(p.id_identificador)}${extra ? ` · ${esc(extra)}` : ''}</span></button>`;
    }).join('');
  }

  function mostrarLista(box, html) {
    if (!box) return;
    box.innerHTML = html || '';
    box.hidden = !html;
  }

  function fecharListas(exceto) {
    document.querySelectorAll('.cond-combo-list').forEach((box) => {
      if (exceto && box === exceto) return;
      box.hidden = true;
      box.innerHTML = '';
    });
  }

  function marcarOpcao(box, passo) {
    if (!box) return;
    const opts = [...box.querySelectorAll('.cond-combo-opt')];
    if (!opts.length) return;
    const atual = opts.findIndex((el) => el.classList.contains('is-ativo'));
    const i = passo == null
      ? (atual >= 0 ? atual : 0)
      : (atual < 0 ? (passo > 0 ? 0 : opts.length - 1) : (atual + passo + opts.length) % opts.length);
    opts.forEach((el, n) => el.classList.toggle('is-ativo', n === i));
    opts[i].scrollIntoView({ block: 'nearest' });
  }

  function teclaLista(e, box) {
    if (!box || box.hidden) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      marcarOpcao(box, e.key === 'ArrowDown' ? 1 : -1);
      return true;
    }
    if (e.key === 'Enter') {
      const ativo = box.querySelector('.cond-combo-opt.is-ativo');
      if (!ativo) return false;
      e.preventDefault();
      ativo.click();
      return true;
    }
    if (e.key === 'Escape') {
      mostrarLista(box, '');
      return true;
    }
    return false;
  }

  function ligarPecas(box) {
    box.querySelectorAll('[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => escolherPeca({
        id_identificador: Number(btn.dataset.id),
        descricao: btn.dataset.desc,
        prc_venda: Number(btn.dataset.prc || 0),
        qtd_disponivel: Number(btn.dataset.disp),
      }));
    });
  }

  async function buscarPecasNaTela(q) {
    const box = $('#cond-peca-lista');
    if (!box) return null;
    const res = await api(`/condicionais/produtos?q=${encodeURIComponent(q)}`);
    if (!res.ok) {
      mostrarLista(box, `<p class="hint">${esc(res.error || 'Não foi possível buscar peças.')}</p>`);
      return null;
    }
    const itens = res.itens || [];
    if (!itens.length) {
      mostrarLista(box, '<p class="hint">Nenhuma peça encontrada.</p>');
      return [];
    }
    mostrarLista(box, htmlPecas(itens));
    ligarPecas(box);
    marcarOpcao(box);
    return itens;
  }

  async function aplicarCodigoBarras(codigo) {
    const code = String(codigo || '').trim();
    if (!code) return;
    const dlg = $('#dlg-cond-item');
    if (dlg && !dlg.open && dlg.showModal) dlg.showModal();
    const inp = $('#cond-peca');
    if (inp) inp.value = code;
    pecaAtual = null;
    if ($('#cond-peca-estoque')) $('#cond-peca-estoque').textContent = '';
    const itens = await buscarPecasNaTela(code);
    if (!itens?.length) return;
    const exato = itens.filter((p) => String(p.cod_barras || '') === code || String(p.referencia || '') === code);
    const escolhido = exato.length === 1 ? exato[0] : (itens.length === 1 ? itens[0] : null);
    if (escolhido) escolherPeca(escolhido);
  }

  function escolherPeca(item) {
    pecaAtual = item;
    if ($('#cond-peca')) $('#cond-peca').value = item.descricao || '';
    const preco = $('#cond-preco');
    if (preco) {
      preco.value = Number(item.prc_venda) > 0
        ? Number(item.prc_venda).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : '';
    }
    const estoque = $('#cond-peca-estoque');
    if (estoque) estoque.textContent = textoEstoque(item);
    fecharListas();
    atualizarTotalItem();
    const qtd = $('#cond-qtd');
    if (qtd) {
      qtd.focus();
      qtd.select();
    }
  }

  function numTela(v) {
    const s = String(v ?? '').trim().replace(/\s/g, '');
    if (!s) return 0;
    if (s.includes(',') && s.includes('.')) return Number(s.replace(/\./g, '').replace(',', '.')) || 0;
    if (s.includes(',')) return Number(s.replace(',', '.')) || 0;
    return Number(s) || 0;
  }

  function ajusteValor(base, bruto, modo) {
    const n = Math.max(0, numTela(bruto));
    if (modo === '%') return base * (n / 100);
    return n;
  }

  function totaisItem() {
    const qtd = Math.max(0, numTela($('#cond-qtd')?.value));
    const unit = Math.max(0, numTela($('#cond-preco')?.value));
    const base = qtd * unit;
    const desc = Math.min(base, ajusteValor(base, $('#cond-desc')?.value, $('#cond-desc-modo')?.value));
    const acres = ajusteValor(base, $('#cond-acres')?.value, $('#cond-acres-modo')?.value);
    return { qtd, unit, desc, acres, total: Math.max(0, base - desc + acres) };
  }

  function atualizarTotalItem() {
    const el = $('#cond-item-total');
    if (el) el.textContent = money(totaisItem().total);
    const descSig = $('#cond-desc-sig');
    const acresSig = $('#cond-acres-sig');
    if (descSig) descSig.textContent = $('#cond-desc-modo')?.value === '%' ? '%' : 'R$';
    if (acresSig) acresSig.textContent = $('#cond-acres-modo')?.value === '%' ? '%' : 'R$';
  }

  function limparDialogoItem() {
    pecaAtual = null;
    if ($('#cond-peca')) $('#cond-peca').value = '';
    if ($('#cond-qtd')) $('#cond-qtd').value = '1';
    if ($('#cond-preco')) $('#cond-preco').value = '';
    if ($('#cond-desc')) $('#cond-desc').value = '';
    if ($('#cond-acres')) $('#cond-acres').value = '';
    if ($('#cond-desc-modo')) $('#cond-desc-modo').value = 'R$';
    if ($('#cond-acres-modo')) $('#cond-acres-modo').value = 'R$';
    if ($('#cond-peca-estoque')) $('#cond-peca-estoque').textContent = '';
    if ($('#cond-item-msg')) $('#cond-item-msg').textContent = '';
    fecharListas();
    atualizarTotalItem();
  }

  function abrirDialogoItem() {
    limparDialogoItem();
    const dlg = $('#dlg-cond-item');
    if (dlg?.showModal) dlg.showModal();
    $('#cond-peca')?.focus();
  }

  function fecharDialogoItem() {
    const dlg = $('#dlg-cond-item');
    if (dlg?.open) dlg.close();
    limparDialogoItem();
  }

  function incluirPeca(item) {
    const tot = totaisItem();
    const msg = $('#cond-item-msg');
    if (!(tot.qtd > 0)) {
      if (msg) msg.textContent = 'Informe a quantidade.';
      return;
    }
    if (!(tot.unit > 0)) {
      if (msg) msg.textContent = 'Informe o valor unitário.';
      return;
    }
    if (Number.isFinite(Number(item.qtd_disponivel))) {
      const livre = restante(item);
      if (!(livre > 0)) {
        if (msg) msg.textContent = `${item.descricao} está sem estoque. Não é possível lançar.`;
        return;
      }
      if (tot.qtd > livre + 0.0001) {
        if (msg) msg.textContent = `${item.descricao} tem ${livre.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} em estoque.`;
        return;
      }
    }
    itensNovos.push({
      id_identificador: Number(item.id_identificador),
      descricao: item.descricao,
      qtd: tot.qtd,
      prc_venda: tot.unit,
      desconto: tot.desc,
      acrescimo: tot.acres,
      total: tot.total,
    });
    renderItensNovos();
    limparDialogoItem();
    const dlg = $('#dlg-cond-item');
    if (dlg && !dlg.open && dlg.showModal) dlg.showModal();
    $('#cond-peca')?.focus();
  }

  function renderItensNovos() {
    const box = $('#cond-novos-itens');
    const rodape = $('#cond-novos-total');
    const totalEl = $('#cond-grade-total');
    if (!box) return;
    if (!itensNovos.length) {
      box.innerHTML = '<tr><td class="cond-grade-vazio" colspan="7">Nenhum item incluído. Clique em Incluir para pesquisar a peça.</td></tr>';
      if (rodape) rodape.hidden = true;
      escreverCampoDesconto();
      escreverCampoAcrescimo();
      return;
    }
    escreverCampoDesconto();
    escreverCampoAcrescimo();
    const soma = totaisCabeca().total;
    const pecas = itensNovos.reduce((s, it) => s + Number(it.qtd || 0), 0);
    box.innerHTML = itensNovos.map((it, i) => `
      <tr>
        <td class="item">${esc(it.descricao)}</td>
        <td class="num">${esc(it.qtd)}</td>
        <td class="num">${money(it.prc_venda)}</td>
        <td class="num">${money(it.desconto)}</td>
        <td class="num">${money(it.acrescimo)}</td>
        <td class="num">${money(it.total)}</td>
        <td><button type="button" class="btn small" data-rm="${i}">Tirar</button></td>
      </tr>`).join('');
    const pecasEl = $('#cond-grade-pecas');
    if (pecasEl) pecasEl.textContent = String(pecas);
    if (totalEl) totalEl.textContent = money(soma);
    if (rodape) rodape.hidden = false;
    box.querySelectorAll('[data-rm]').forEach((btn) => {
      btn.addEventListener('click', () => {
        itensNovos.splice(Number(btn.dataset.rm), 1);
        renderItensNovos();
      });
    });
  }

  function totaisCabeca() {
    const itens = itensNovos.reduce((s, it) => s + Number(it.total || 0), 0);
    const frete = Math.max(0, numTela($('#cond-frete')?.value));
    return {
      itens, frete, desconto: descontoExtra, acrescimo: acrescimoExtra,
      total: Math.max(0, itens + frete - descontoExtra + acrescimoExtra),
    };
  }

  function ligarFormulario() {
    let timerCliente = null;
    let timerPeca = null;
    const buscarCliente = async () => {
      const q = String($('#cond-cliente')?.value || '').trim();
      const box = $('#cond-cliente-lista');
      if (!box) return;
      if (q.length < 1) {
        mostrarLista(box, '');
        return;
      }
      const res = await api(`/condicionais/clientes?q=${encodeURIComponent(q)}`);
      if (!res.ok) {
        mostrarLista(box, `<p class="hint">${esc(res.error || 'Não foi possível buscar clientes.')}</p>`);
        return;
      }
      const itens = res.itens || [];
      if (!itens.length) {
        mostrarLista(box, '<p class="hint">Nenhum cliente com esse nome.</p>');
        return;
      }
      mostrarLista(box, itens.map((c) => `
        <button type="button" class="cond-combo-opt" data-cli="${c.id_cliente}" data-nome="${esc(c.nome)}">
          <strong>${esc(c.nome)}</strong>
          <span>${esc([c.telefone ? c.telefone : '', `cód. ${c.id_cliente}`].filter(Boolean).join(' · '))}</span>
        </button>`).join(''));
      box.querySelectorAll('[data-cli]').forEach((btn) => {
        btn.addEventListener('click', () => {
          marcarCliente(btn.dataset.cli, btn.dataset.nome);
          $('#cond-cliente').value = btn.dataset.nome;
          mostrarLista(box, '');
        });
      });
      marcarOpcao(box);
    };
    $('#cond-cliente')?.addEventListener('input', () => {
      marcarCliente(0, '');
      clearTimeout(timerCliente);
      timerCliente = setTimeout(buscarCliente, 220);
    });
    $('#cond-cliente')?.addEventListener('focus', () => {
      if (String($('#cond-cliente')?.value || '').trim().length >= 1) buscarCliente();
    });
    $('#cond-cliente')?.addEventListener('keydown', (e) => {
      const box = $('#cond-cliente-lista');
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && (box?.hidden || !box?.querySelector('.cond-combo-opt'))) {
        e.preventDefault();
        buscarCliente();
        return;
      }
      teclaLista(e, box);
    });
    $('#cond-peca')?.addEventListener('input', () => {
      pecaAtual = null;
      if ($('#cond-peca-estoque')) $('#cond-peca-estoque').textContent = '';
      atualizarTotalItem();
      clearTimeout(timerPeca);
      timerPeca = setTimeout(async () => {
        const q = String($('#cond-peca')?.value || '').trim();
        const box = $('#cond-peca-lista');
        if (!box) return;
        if (q.length < 1) {
          mostrarLista(box, '');
          return;
        }
        await buscarPecasNaTela(q);
      }, 220);
    });
    $('#cond-peca')?.addEventListener('focus', () => {
      const q = String($('#cond-peca')?.value || '').trim();
      if (q.length >= 1 && !pecaAtual) buscarPecasNaTela(q);
    });
    $('#cond-peca')?.addEventListener('keydown', async (e) => {
      const box = $('#cond-peca-lista');
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && (box?.hidden || !box?.querySelector('.cond-combo-opt'))) {
        e.preventDefault();
        const q = String($('#cond-peca')?.value || '').trim();
        if (q) await buscarPecasNaTela(q);
        return;
      }
      if (teclaLista(e, box)) return;
      if (e.key === 'Enter' && pecaAtual) {
        e.preventDefault();
        const qtd = $('#cond-qtd');
        qtd?.focus();
        qtd?.select();
      }
    });
    ['cond-qtd', 'cond-preco', 'cond-desc', 'cond-acres'].forEach((id) => {
      const el = document.getElementById(id);
      el?.addEventListener('input', atualizarTotalItem);
      el?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (pecaAtual) incluirPeca(pecaAtual);
      });
    });
    document.getElementById('cond-frete')?.addEventListener('input', () => renderItensNovos());
    $('#cond-desc-ped')?.addEventListener('input', () => {
      descontoExtra = Math.max(0, numTela($('#cond-desc-ped')?.value) - somaDescontoItens());
      escreverPartes();
      const totalEl = $('#cond-grade-total');
      if (totalEl) totalEl.textContent = money(totaisCabeca().total);
    });
    $('#cond-desc-ped')?.addEventListener('blur', () => {
      descontoExtra = Math.max(0, numTela($('#cond-desc-ped')?.value) - somaDescontoItens());
      escreverCampoDesconto();
      const totalEl = $('#cond-grade-total');
      if (totalEl) totalEl.textContent = money(totaisCabeca().total);
    });
    $('#cond-acres-ped')?.addEventListener('input', () => {
      acrescimoExtra = Math.max(0, numTela($('#cond-acres-ped')?.value) - somaAcrescimoItens());
      escreverPartes();
      const totalEl = $('#cond-grade-total');
      if (totalEl) totalEl.textContent = money(totaisCabeca().total);
    });
    $('#cond-acres-ped')?.addEventListener('blur', () => {
      acrescimoExtra = Math.max(0, numTela($('#cond-acres-ped')?.value) - somaAcrescimoItens());
      escreverCampoAcrescimo();
      const totalEl = $('#cond-grade-total');
      if (totalEl) totalEl.textContent = money(totaisCabeca().total);
    });
    $('#cond-desc-modo')?.addEventListener('change', atualizarTotalItem);
    $('#cond-acres-modo')?.addEventListener('change', atualizarTotalItem);
    $('#cond-abrir-item')?.addEventListener('click', () => abrirDialogoItem());
    $('#cond-item-voltar')?.addEventListener('click', () => fecharDialogoItem());
    $('#cond-item-fechar')?.addEventListener('click', () => fecharDialogoItem());
    $('#cond-item-cancelar')?.addEventListener('click', () => fecharDialogoItem());
    $('#cond-add-peca')?.addEventListener('click', async () => {
      const msg = $('#cond-item-msg');
      if (pecaAtual) {
        incluirPeca(pecaAtual);
        return;
      }
      const codigo = String($('#cond-peca')?.value || '').trim();
      if (!codigo) {
        if (msg) msg.textContent = 'Pesquise a peça e escolha uma da lista.';
        return;
      }
      const itens = await buscarPecasNaTela(codigo);
      if (!itens?.length) return;
      if (itens.length === 1) {
        escolherPeca(itens[0]);
        incluirPeca(itens[0]);
        return;
      }
      if (msg) msg.textContent = 'Há mais de uma peça. Escolha uma da lista.';
    });
    document.addEventListener('click', (e) => {
      const combo = e.target.closest?.('[data-cond-combo]');
      if (combo) return;
      fecharListas();
    });
    $('#cond-salvar')?.addEventListener('click', async () => {
      const msg = $('#cond-form-msg');
      const idStatus = String($('#cond-lanc-status')?.value || '');
      const caminho = editandoId ? `/condicionais/${encodeURIComponent(editandoId)}` : '/condicionais';
      const res = await api(caminho, {
        method: 'POST',
        body: {
          id_cliente: clienteId,
          id_funcionario: Number($('#cond-vendedor')?.value || 0),
          obs: $('#cond-obs')?.value || '',
          validade: $('#cond-validade')?.value || '',
          id_status: Number(idStatus || 0),
          id_parcela: Number($('#cond-pagamento')?.value || 0),
          frete: totaisCabeca().frete,
          desconto: totaisCabeca().desconto,
          acrescimo: totaisCabeca().acrescimo,
          itens: itensNovos,
        },
      });
      if (!res.ok) {
        if (msg) msg.textContent = res.error || 'Não foi possível lançar.';
        return;
      }
      const aviso = $('#cond-aviso');
      const rotulo = $('#cond-lanc-status')?.selectedOptions?.[0]?.textContent || '';
      if (aviso) {
        aviso.hidden = false;
        aviso.textContent = `Condicional ${res.id} salvo${rotulo ? ` (${rotulo})` : ''}.`;
      }
      editandoId = 0;
      limparLancamento();
      painel('vazio');
      await abrirLista();
      perguntarEnvio(res.id);
    });
    $('#cond-novo-btn')?.addEventListener('click', () => {
      painel('novo');
      preencherStatusLancamento();
      preencherPagamentoLancamento();
      carregarVendedores();
      renderItensNovos();
      $('#cond-cliente')?.focus();
    });
    $('#cond-cancelar')?.addEventListener('click', () => fecharNovo());
    $('#cond-status')?.addEventListener('change', () => abrirLista());
    let timerBusca = null;
    $('#cond-busca')?.addEventListener('input', () => {
      clearTimeout(timerBusca);
      timerBusca = setTimeout(() => abrirLista(), 250);
    });
    $('#cond-busca')?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      clearTimeout(timerBusca);
      abrirLista();
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

  return { init, onPageEnter, abrirDoProduto, aplicarCodigoBarras };
})();

window.Condicionais = Condicionais;
