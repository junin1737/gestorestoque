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

  function statusPadrao() {
    return (statuses.find((s) => s.reserva) || statuses[0] || {}).id || '';
  }

  function preencherStatusLancamento() {
    const sel = $('#cond-lanc-status');
    if (!sel) return;
    sel.innerHTML = opcoesStatus(statusPadrao());
  }

  async function mostrarDetalhe(id) {
    const box = $('#cond-detalhe');
    if (!box) return;
    abertoId = Number(id) || 0;
    painel('detalhe');
    abertoId = Number(id) || 0;
    marcarCardAtivo();
    box.innerHTML = '<p class="hint">Carregando…</p>';
    const res = await api(`/condicionais/${encodeURIComponent(id)}`);
    if (!res.ok) {
      box.innerHTML = `<p class="hint">${esc(res.error || 'Não encontrado')}</p>`;
      return;
    }
    const doc = res.condicional || {};
    const itens = (doc.itens || []).map((it) => `
      <div class="cond-item">
        <strong>${esc(it.descricao || 'Peça')}</strong>
        <span class="hint">Qtd ${esc(it.qtd)} · ${money(it.prc_unit)} · ${money(it.total)}</span>
      </div>`).join('');
    box.innerHTML = `
      <div class="cond-form-head">
        <h3>Condicional ${esc(doc.id)}</h3>
        <button type="button" class="btn small" id="cond-fechar-detalhe">Fechar</button>
      </div>
      <div class="cond-ficha">
        <p><strong>${esc(doc.cliente || 'Sem cliente')}</strong></p>
        <p class="hint">${esc(doc.data || '—')} ${esc(doc.horario || '')} · ${esc(doc.vendedor || 'sem vendedor')}</p>
        <p><strong>Validade:</strong> ${esc(doc.validade || '—')}</p>
        ${doc.obs ? `<p><strong>Obs.:</strong> ${esc(doc.obs)}</p>` : ''}
        <label class="cond-filtro">Situação
          <select id="cond-detalhe-status">${opcoesStatus(doc.status)}</select>
        </label>
        <p class="hint" id="cond-detalhe-msg"></p>
        <div class="banco-actions">
          <button type="button" class="btn primary small" id="cond-salvar-status">Salvar situação</button>
          <button type="button" class="btn small" data-pdf="${esc(doc.id)}">Gerar PDF</button>
          <button type="button" class="btn small" data-wa="${esc(doc.id)}" data-fone="${esc(doc.telefone || '')}">WhatsApp</button>
        </div>
        ${itens || '<p class="hint">Sem peças.</p>'}
        <p><strong>Total:</strong> ${money(doc.total)}</p>
      </div>`;
    ligarAcoes(box);
    $('#cond-fechar-detalhe')?.addEventListener('click', () => fecharNovo());
    $('#cond-salvar-status')?.addEventListener('click', async () => {
      const msg = $('#cond-detalhe-msg');
      const idStatus = Number($('#cond-detalhe-status')?.value || 0);
      const salvo = await api(`/condicionais/${encodeURIComponent(doc.id)}/status`, {
        method: 'POST',
        body: { id_status: idStatus },
      });
      if (!salvo.ok) {
        if (msg) msg.textContent = salvo.error || 'Não foi possível salvar a situação.';
        return;
      }
      if (msg) msg.textContent = 'Situação atualizada.';
      await abrirLista();
    });
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
    if (Array.isArray(res.statuses)) statuses = res.statuses;
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
      preencherStatusLancamento();
    }
    if (aviso && res.aviso) aviso.textContent = res.aviso;
    const itens = res.itens || [];
    if (!itens.length) {
      lista.innerHTML = '<p class="empty">Nenhum condicional nesta situação.</p>';
      return;
    }
    lista.innerHTML = itens.map((it) => `
      <button type="button" class="cond-card${Number(it.id) === abertoId ? ' is-ativo' : ''}" data-cond="${esc(it.id)}">
        <span class="cond-card-top">
          <strong>Nº ${esc(it.id)}</strong>
          <span class="cond-pill${it.reserva ? ' is-reserva' : ''}">${esc(it.status_label)}</span>
        </span>
        <span class="cond-card-nome">${esc(it.cliente || 'Sem cliente')}</span>
        <span class="hint">${esc(it.data)} ${esc(it.horario)} · ${esc(it.vendedor || 'sem vendedor')} · ${money(it.total)}</span>
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

  function marcarCliente(id, nome) {
    clienteId = Number(id) || 0;
    clienteNome = clienteId ? String(nome || '') : '';
    const aviso = $('#cond-cliente-escolhido');
    if (aviso) aviso.textContent = clienteId ? `Cliente selecionado: ${clienteNome}` : 'Nenhum cliente selecionado.';
  }

  function botaoSugestao(texto, attrs) {
    return `<button type="button" class="cond-pick" ${attrs}>${texto}</button>`;
  }

  function escolherPeca(item) {
    pecaAtual = item;
    if ($('#cond-peca')) $('#cond-peca').value = item.descricao || '';
    const preco = $('#cond-preco');
    if (preco) preco.value = Number(item.prc_venda) > 0 ? String(item.prc_venda) : '';
    const estoque = $('#cond-peca-estoque');
    if (estoque) estoque.textContent = textoEstoque(item);
    const lista = $('#cond-peca-lista');
    if (lista) lista.innerHTML = '';
  }

  function incluirPeca(item) {
    const qtd = Number($('#cond-qtd')?.value || 0);
    const preco = Number($('#cond-preco')?.value || 0);
    const msg = $('#cond-form-msg');
    if (!(qtd > 0)) {
      if (msg) msg.textContent = 'Informe a quantidade.';
      return;
    }
    if (!(preco > 0)) {
      if (msg) msg.textContent = 'Informe o preço.';
      return;
    }
    if (Number.isFinite(Number(item.qtd_disponivel))) {
      const livre = restante(item);
      if (!(livre > 0)) {
        if (msg) msg.textContent = `${item.descricao} está sem estoque. Não é possível lançar.`;
        return;
      }
      if (qtd > livre + 0.0001) {
        if (msg) msg.textContent = `${item.descricao} tem ${livre.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} em estoque.`;
        return;
      }
    }
    itensNovos.push({
      id_identificador: Number(item.id_identificador),
      descricao: item.descricao,
      qtd,
      prc_venda: preco,
    });
    pecaAtual = null;
    if ($('#cond-peca')) $('#cond-peca').value = '';
    if ($('#cond-preco')) $('#cond-preco').value = '';
    if ($('#cond-peca-estoque')) $('#cond-peca-estoque').textContent = '';
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
      pecaAtual = null;
      if ($('#cond-peca-estoque')) $('#cond-peca-estoque').textContent = '';
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
          const extra = [p.cod_barras ? `barras ${p.cod_barras}` : '', p.referencia ? `ref. ${p.referencia}` : '', textoEstoque(p), money(p.prc_venda)].filter(Boolean).join(' · ');
          const sem = Number(p.qtd_disponivel) <= 0 ? ' is-sem-estoque' : '';
          return `<button type="button" class="cond-pick${sem}" data-id="${p.id_identificador}" data-desc="${esc(p.descricao)}" data-prc="${p.prc_venda}" data-disp="${p.qtd_disponivel}"><strong>${esc(p.id_identificador)}</strong> ${esc(p.descricao)}<span class="hint"> · cód. ${esc(p.id_estoque)}${extra ? ` · ${esc(extra)}` : ''}</span></button>`;
        }).join('');
        box.querySelectorAll('[data-id]').forEach((btn) => {
          btn.addEventListener('click', () => escolherPeca({
            id_identificador: Number(btn.dataset.id),
            descricao: btn.dataset.desc,
            prc_venda: Number(btn.dataset.prc || 0),
            qtd_disponivel: Number(btn.dataset.disp),
          }));
        });
      }, 250);
    });
    $('#cond-add-peca')?.addEventListener('click', async () => {
      const box = $('#cond-peca-lista');
      if (pecaAtual) {
        incluirPeca(pecaAtual);
        return;
      }
      const codigo = String($('#cond-peca')?.value || '').trim();
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
        escolherPeca(itens[0]);
        incluirPeca(itens[0]);
        return;
      }
      if (box) box.innerHTML = '<p class="hint">Há mais de uma peça. Toque na lista para escolher.</p>';
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
          id_status: Number($('#cond-lanc-status')?.value || 0),
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
      if ($('#cond-peca')) $('#cond-peca').value = '';
      if ($('#cond-preco')) $('#cond-preco').value = '';
      if ($('#cond-peca-estoque')) $('#cond-peca-estoque').textContent = '';
      if ($('#cond-peca-lista')) $('#cond-peca-lista').innerHTML = '';
      if ($('#cond-cliente-lista')) $('#cond-cliente-lista').innerHTML = '';
      pecaAtual = null;
      renderItensNovos();
      if (msg) msg.textContent = '';
      const aviso = $('#cond-aviso');
      const rotulo = $('#cond-lanc-status')?.selectedOptions?.[0]?.textContent || '';
      if (aviso) aviso.textContent = `Condicional ${res.id} lançado${rotulo ? ` (${rotulo})` : ''}.`;
      const idStatus = String($('#cond-lanc-status')?.value || '');
      fecharNovo();
      const sel = $('#cond-status');
      if (sel && [...sel.options].some((o) => o.value === idStatus)) sel.value = idStatus;
      abrirLista();
    });
    $('#cond-novo-btn')?.addEventListener('click', () => {
      painel('novo');
      preencherStatusLancamento();
      carregarVendedores();
      $('#cond-cliente')?.focus();
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
