/**
 * Etiquetas de gôndola, pré-visualização e ofertas por período.
 */
const Gondola = (() => {
  let deps = {};
  let modelos = [];
  let modeloId = '';
  let grupos = [];
  let gruposSel = [];
  let itens = [];
  let marcados = new Set();
  let preview = [];
  let ofertas = [];
  let ofertaEdit = 0;
  let produtoOferta = null;
  let timerBusca = null;
  let buscando = false;

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => (deps.escapeHtml ? deps.escapeHtml(s) : String(s ?? ''));
  const api = (...args) => deps.api(...args);
  const DIAS = [
    { n: 1, nome: 'Seg' }, { n: 2, nome: 'Ter' }, { n: 3, nome: 'Qua' },
    { n: 4, nome: 'Qui' }, { n: 5, nome: 'Sex' }, { n: 6, nome: 'Sáb' }, { n: 0, nome: 'Dom' },
  ];
  const VIGENCIA = {
    vigor: 'Em vigor',
    agendada: 'Agendada',
    encerrada: 'Encerrada',
    'fora-do-dia': 'Outro dia',
  };

  const CODE128 = [
    '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
    '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
    '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
    '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
    '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
    '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
    '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
    '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
    '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
    '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
    '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
  ];
  const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
  const EAN_R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
  const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

  function money(n) {
    return deps.fmtMoney ? deps.fmtMoney(n) : Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function valor(n) {
    return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function parsePreco(v) {
    let s = String(v || '').trim().replace(/[R$\s]/g, '');
    if (!s) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0 || n > 999999.99) return null;
    return Math.round(n * 100) / 100;
  }

  function abreviar(texto, max) {
    const s = String(texto || '').replace(/\s+/g, ' ').trim();
    const limite = Math.max(8, Number(max) || 42);
    if (s.length <= limite) return s;
    const corte = s.slice(0, limite);
    const esp = corte.lastIndexOf(' ');
    return (esp > limite * 0.55 ? corte.slice(0, esp) : corte).trim();
  }

  function modeloAtual() {
    return modelos.find((m) => m.id === modeloId) || modelos[0] || null;
  }

  function digitoEan(doze) {
    let soma = 0;
    for (let i = 0; i < 12; i += 1) soma += Number(doze[i]) * (i % 2 === 0 ? 1 : 3);
    return String((10 - (soma % 10)) % 10);
  }

  function bitsCode128(texto) {
    const chars = [...String(texto || '')].filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) <= 126);
    if (!chars.length) return '';
    const valores = chars.map((ch) => ch.charCodeAt(0) - 32);
    let soma = 104;
    valores.forEach((v, i) => { soma += v * (i + 1); });
    const seq = [104, ...valores, soma % 103, 106];
    const larguras = seq.map((n) => CODE128[n]).join('');
    let bits = '0'.repeat(10);
    let barra = true;
    for (const d of larguras) {
      bits += (barra ? '1' : '0').repeat(Number(d));
      barra = !barra;
    }
    return bits + '0'.repeat(10);
  }

  function bitsEan13(codigo) {
    const digitos = String(codigo || '').replace(/\D/g, '');
    let treze = '';
    if (digitos.length === 12) treze = digitos + digitoEan(digitos);
    else if (digitos.length === 13 && digitoEan(digitos.slice(0, 12)) === digitos[12]) treze = digitos;
    if (!treze) return '';
    const paridade = EAN_PARITY[Number(treze[0])];
    let bits = '0000000' + '101';
    for (let i = 0; i < 6; i += 1) {
      const n = Number(treze[i + 1]);
      bits += (paridade[i] === 'L' ? EAN_L : EAN_G)[n];
    }
    bits += '01010';
    for (let i = 7; i < 13; i += 1) bits += EAN_R[Number(treze[i])];
    return { bits: bits + '101' + '0000000', legenda: treze };
  }

  function svgDeBits(bits) {
    if (!bits) return '';
    const partes = [];
    let i = 0;
    while (i < bits.length) {
      if (bits[i] !== '1') { i += 1; continue; }
      let j = i;
      while (j < bits.length && bits[j] === '1') j += 1;
      partes.push(`<rect x="${i}" y="0" width="${j - i}" height="40" fill="#111"/>`);
      i = j;
    }
    return `<svg viewBox="0 0 ${bits.length} 40" preserveAspectRatio="none" aria-hidden="true">${partes.join('')}</svg>`;
  }

  function htmlBarras(codigo) {
    const ean = bitsEan13(codigo);
    const bits = ean ? ean.bits : bitsCode128(codigo);
    const legenda = ean ? ean.legenda : String(codigo || '');
    if (!bits) return '';
    return `<div class="gond-barras">${svgDeBits(bits)}<span>${esc(legenda)}</span></div>`;
  }

  function htmlEtiqueta(item, modelo) {
    const empresa = deps.getEmitente?.()?.nome_fanta || '';
    const promo = !!(modelo.mostrarOferta && item.usarPromo && Number(item.prc_promo) > 0);
    const desc = modelo.abreviarDescricao ? abreviar(item.descricao, modelo.maxDescricao) : item.descricao;
    const preco = promo ? item.prc_promo : item.prc_etiqueta;
    const estilo = `--etiq-w:${modelo.larguraMm}mm;--etiq-h:${modelo.alturaMm}mm;--etiq-fundo:${modelo.fundo};--etiq-tinta:${modelo.tinta};`;
    const unidade = modelo.mostrarUnidade && item.uni_medida
      ? `<small>por ${esc(item.uni_medida)}</small>` : '';
    const blocoPreco = modelo.mostrarPreco ? `
      <div class="gond-preco${promo ? ' is-oferta' : ''}">
        ${promo ? `<em>de ${esc(money(item.prc_etiqueta))}</em>` : ''}
        <strong><span>R$</span> ${esc(valor(preco))}</strong>
        ${unidade}
      </div>` : '';
    return `
      <article class="gond-etiqueta" style="${estilo}">
        ${promo ? '<b class="gond-balao">OFERTA!</b>' : ''}
        <div class="gond-esq">
          ${modelo.mostrarEmpresa && empresa ? `<p class="gond-empresa">${esc(empresa)}</p>` : ''}
          ${modelo.mostrarDescricao ? `<p class="gond-desc">${esc(desc)}</p>` : ''}
          <p class="gond-meta">
            ${modelo.mostrarReferencia && item.referencia ? `<span>${esc(item.referencia)}</span>` : ''}
            ${modelo.mostrarIdentificador ? `<span>ID ${esc(item.id_identificador)}</span>` : ''}
          </p>
          ${modelo.mostrarBarras && item.cod_barras ? htmlBarras(item.cod_barras) : ''}
        </div>
        ${blocoPreco}
      </article>`;
  }

  function atualizarBotaoGerar() {
    const btn = $('#gond-gerar');
    if (!btn) return;
    const n = marcados.size;
    btn.disabled = n === 0;
    btn.textContent = n ? `Gerar gôndola (${n} selecionado${n === 1 ? '' : 's'})` : 'Gerar gôndola';
  }

  function renderModeloSelect() {
    const sel = $('#gond-modelo');
    if (!sel) return;
    sel.innerHTML = modelos.map((m) => `<option value="${esc(m.id)}">${esc(m.nome)}</option>`).join('');
    if (modeloId && modelos.some((m) => m.id === modeloId)) sel.value = modeloId;
    else modeloId = sel.value || modelos[0]?.id || '';
  }

  function renderChips() {
    const box = $('#gond-grupo-chips');
    if (!box) return;
    box.innerHTML = gruposSel.map((g) => `
      <button type="button" class="gond-chip" data-grupo="${g.id}">${esc(g.nome)} <span aria-hidden="true">×</span></button>
    `).join('');
  }

  function renderGruposLista() {
    const lista = $('#gond-grupo-lista');
    const q = ($('#gond-grupo-q')?.value || '').trim().toLowerCase();
    if (!lista) return;
    const usados = new Set(gruposSel.map((g) => g.id));
    const achados = grupos
      .filter((g) => !usados.has(g.id_grupo) && (!q || g.descricao.toLowerCase().includes(q)))
      .slice(0, 12);
    lista.hidden = !achados.length;
    lista.innerHTML = achados.map((g) => `
      <button type="button" data-grupo-id="${g.id_grupo}">${esc(g.descricao)}</button>
    `).join('');
  }

  function renderTabela() {
    const corpo = $('#gond-corpo');
    const foot = $('#gond-foot');
    const todos = $('#gond-todos');
    if (!corpo) return;
    if (!itens.length) {
      corpo.innerHTML = '<tr><td colspan="7" class="gond-vazio">Nenhum produto para este filtro.</td></tr>';
    } else {
      corpo.innerHTML = itens.map((it) => `
        <tr>
          <td><input type="checkbox" data-marca="${it.id_identificador}" ${marcados.has(it.id_identificador) ? 'checked' : ''} aria-label="Selecionar ${esc(it.descricao)}" /></td>
          <td>${esc(it.id_estoque)}</td>
          <td>${esc(it.cod_barras || '—')}</td>
          <td>
            <strong>${esc(it.descricao)}</strong>
            ${it.oferta ? `<em class="gond-mini-oferta">Oferta ${esc(money(it.oferta.prc_promo))}</em>` : ''}
          </td>
          <td>${esc(it.referencia || '—')}</td>
          <td class="num">${esc(money(it.prc_venda))}</td>
          <td><button type="button" class="btn small primary" data-gerar="${it.id_identificador}">Gerar</button></td>
        </tr>
      `).join('');
    }
    if (todos) {
      todos.checked = itens.length > 0 && itens.every((it) => marcados.has(it.id_identificador));
      todos.indeterminate = !todos.checked && itens.some((it) => marcados.has(it.id_identificador));
    }
    if (foot) {
      foot.textContent = itens.length
        ? `${itens.length} produto${itens.length === 1 ? '' : 's'}${itens.length >= 400 ? ' (mostrando os primeiros 400)' : ''}`
        : 'Pesquise por código de barras, descrição, identificador, referência, intervalo ou grupo.';
    }
    atualizarBotaoGerar();
  }

  function itemPreview(it) {
    const oferta = it.oferta && Number(it.oferta.prc_promo) > 0 ? it.oferta : null;
    return {
      id_identificador: it.id_identificador,
      id_estoque: it.id_estoque,
      descricao: it.descricao,
      referencia: it.referencia,
      cod_barras: it.cod_barras,
      uni_medida: it.uni_medida,
      prc_estoque: Number(it.prc_venda || 0),
      prc_etiqueta: Number(it.prc_venda || 0),
      usarPromo: !!oferta,
      prc_promo: oferta ? Number(oferta.prc_promo) : 0,
    };
  }

  function renderPreview() {
    const folha = $('#gond-folha');
    const modelo = modeloAtual();
    const titulo = $('#gond-modal-medida');
    if (!folha || !modelo) return;
    if (titulo) titulo.textContent = `${modelo.nome} · ${modelo.larguraMm}×${modelo.alturaMm} mm`;
    folha.innerHTML = preview.map((item, idx) => `
      <section class="gond-preview-item">
        ${htmlEtiqueta(item, modelo)}
        <div class="gond-item-acoes">
          <button type="button" class="btn small" data-alterar="${idx}">Alterar preço</button>
          ${modelo.mostrarOferta ? `
            <label class="gond-check">
              <input type="checkbox" data-promo="${idx}" ${item.usarPromo ? 'checked' : ''} />
              Usar preço promocional
            </label>
            ${item.usarPromo ? `<input class="gond-promo" data-promo-valor="${idx}" inputmode="decimal" value="${esc(valor(item.prc_promo || ''))}" placeholder="De por" />` : ''}
          ` : ''}
          <span class="gond-aviso" data-aviso="${idx}"></span>
        </div>
      </section>
    `).join('');
  }

  function abrirPreview(lista) {
    if (!lista.length) {
      deps.showMsg?.('Marque ao menos um produto.');
      return;
    }
    if (!modeloAtual()) {
      deps.showMsg?.('Cadastre um modelo de etiqueta em Configurações.');
      return;
    }
    preview = lista.map(itemPreview);
    renderPreview();
    const modal = $('#gond-modal');
    if (modal) modal.hidden = false;
  }

  async function aplicarPreco(idx, bruto) {
    const item = preview[idx];
    if (!item) return;
    const novo = parsePreco(bruto);
    if (novo == null || novo <= 0) {
      deps.showMsg?.('Informe um preço válido.');
      return;
    }
    if (Math.abs(novo - item.prc_etiqueta) < 0.001) return;
    if (Math.abs(novo - item.prc_estoque) > 0.009) {
      if (!deps.podeEditarPreco?.()) {
        deps.showMsg?.('Sem permissão para gravar o preço. A etiqueta usa este valor só nesta impressão.');
      } else {
        const gravar = await deps.showConfirm?.(
          `Gravar ${money(novo)} como preço de venda de ${item.descricao} no estoque?`,
          { okLabel: 'Gravar no estoque', cancelLabel: 'Só na etiqueta' }
        );
        if (gravar) {
          const res = await api(`/estoque/${item.id_identificador}`, {
            method: 'PUT',
            body: { prc_venda: novo, antes: { prc_venda: item.prc_estoque } },
          });
          if (!res?.ok) {
            deps.showMsg?.(res?.error || 'Não foi possível gravar o preço.');
          } else {
            item.prc_estoque = novo;
            const linha = itens.find((it) => it.id_identificador === item.id_identificador);
            if (linha) linha.prc_venda = novo;
            renderTabela();
          }
        }
      }
    }
    item.prc_etiqueta = novo;
    renderPreview();
    const aviso = $(`[data-aviso="${idx}"]`);
    if (aviso && Math.abs(novo - item.prc_estoque) < 0.001) aviso.textContent = 'Preço gravado no estoque.';
  }

  async function buscar() {
    if (buscando) return;
    const q = ($('#gond-q')?.value || '').trim();
    const idDe = ($('#gond-id-de')?.value || '').trim();
    const idAte = ($('#gond-id-ate')?.value || '').trim();
    const gruposIds = gruposSel.map((g) => g.id).join(',');
    if (!q && !idDe && !idAte && !gruposIds) {
      itens = [];
      marcados = new Set();
      renderTabela();
      return;
    }
    buscando = true;
    const foot = $('#gond-foot');
    if (foot) foot.textContent = 'Buscando…';
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (idDe) params.set('idDe', idDe);
    if (idAte) params.set('idAte', idAte);
    if (gruposIds) params.set('grupos', gruposIds);
    const res = await api(`/etiquetas/produtos?${params.toString()}`);
    buscando = false;
    if (!res?.ok) {
      itens = [];
      if (foot) foot.textContent = res?.error || 'Não foi possível buscar.';
      renderTabela();
      return;
    }
    itens = res.itens || [];
    const ids = new Set(itens.map((it) => it.id_identificador));
    marcados = new Set([...marcados].filter((id) => ids.has(id)));
    renderTabela();
  }

  function agendarBusca() {
    clearTimeout(timerBusca);
    timerBusca = setTimeout(buscar, 350);
  }

  async function carregarModelos() {
    const res = await api('/etiquetas/modelos');
    modelos = res?.ok && res.modelos?.length ? res.modelos : [];
    if (!modeloId) {
      try { modeloId = sessionStorage.getItem('ge-gondola-modelo') || ''; } catch { /* ignore */ }
    }
    if (!modelos.some((m) => m.id === modeloId)) modeloId = modelos[0]?.id || '';
    renderModeloSelect();
    renderEtiquetas();
  }

  async function carregarGrupos() {
    if (grupos.length) return;
    const res = await api('/grupos');
    grupos = res?.grupos || [];
  }

  function fecharPreview() {
    const modal = $('#gond-modal');
    if (modal) modal.hidden = true;
    preview = [];
    document.body.classList.remove('imprimindo-gondola');
  }

  function imprimir() {
    if (!preview.length) return;
    document.body.classList.add('imprimindo-gondola');
    const limpar = () => {
      document.body.classList.remove('imprimindo-gondola');
      window.removeEventListener('afterprint', limpar);
    };
    window.addEventListener('afterprint', limpar);
    window.print();
    setTimeout(limpar, 1200);
  }

  function ligarGondola() {
    $('#gond-buscar')?.addEventListener('click', buscar);
    $('#gond-q')?.addEventListener('input', agendarBusca);
    $('#gond-q')?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); buscar(); }
    });
    $('#gond-id-de')?.addEventListener('change', buscar);
    $('#gond-id-ate')?.addEventListener('change', buscar);
    $('#gond-modelo')?.addEventListener('change', (ev) => {
      modeloId = ev.target.value;
      try { sessionStorage.setItem('ge-gondola-modelo', modeloId); } catch { /* ignore */ }
    });
    $('#gond-gerar')?.addEventListener('click', () => {
      abrirPreview(itens.filter((it) => marcados.has(it.id_identificador)));
    });
    $('#gond-voltar')?.addEventListener('click', () => deps.showPage?.('estoque'));
    $('#gond-todos')?.addEventListener('change', (ev) => {
      if (ev.target.checked) itens.forEach((it) => marcados.add(it.id_identificador));
      else itens.forEach((it) => marcados.delete(it.id_identificador));
      renderTabela();
    });
    $('#gond-corpo')?.addEventListener('change', (ev) => {
      const marca = ev.target?.dataset?.marca;
      if (!marca) return;
      const id = Number(marca);
      if (ev.target.checked) marcados.add(id);
      else marcados.delete(id);
      renderTabela();
    });
    $('#gond-corpo')?.addEventListener('click', (ev) => {
      const btn = ev.target.closest?.('[data-gerar]');
      if (!btn) return;
      const item = itens.find((it) => it.id_identificador === Number(btn.dataset.gerar));
      if (item) abrirPreview([item]);
    });
    $('#gond-grupo-q')?.addEventListener('input', renderGruposLista);
    $('#gond-grupo-q')?.addEventListener('focus', renderGruposLista);
    $('#gond-grupo-lista')?.addEventListener('click', (ev) => {
      const btn = ev.target.closest?.('[data-grupo-id]');
      if (!btn) return;
      const id = Number(btn.dataset.grupoId);
      const grupo = grupos.find((g) => g.id_grupo === id);
      if (grupo && !gruposSel.some((g) => g.id === id)) {
        gruposSel.push({ id, nome: grupo.descricao });
        renderChips();
        if ($('#gond-grupo-q')) $('#gond-grupo-q').value = '';
        const lista = $('#gond-grupo-lista');
        if (lista) lista.hidden = true;
        buscar();
      }
    });
    $('#gond-grupo-chips')?.addEventListener('click', (ev) => {
      const btn = ev.target.closest?.('[data-grupo]');
      if (!btn) return;
      gruposSel = gruposSel.filter((g) => g.id !== Number(btn.dataset.grupo));
      renderChips();
      buscar();
    });
    document.addEventListener('click', (ev) => {
      if (ev.target.closest?.('.gond-grupo')) return;
      const lista = $('#gond-grupo-lista');
      if (lista) lista.hidden = true;
    });
    $('#gond-cancelar')?.addEventListener('click', fecharPreview);
    $('#gond-imprimir')?.addEventListener('click', imprimir);
    $('#gond-folha')?.addEventListener('click', async (ev) => {
      const btn = ev.target.closest?.('[data-alterar]');
      if (!btn) return;
      const idx = Number(btn.dataset.alterar);
      const item = preview[idx];
      if (!item) return;
      const acoes = btn.parentElement;
      acoes.innerHTML = `
        <input class="gond-novo-preco" inputmode="decimal" value="${esc(valor(item.prc_etiqueta))}" aria-label="Novo preço" />
        <button type="button" class="btn small primary" data-aplicar="${idx}">Aplicar</button>
        <button type="button" class="btn small" data-cancelar-preco="${idx}">Cancelar</button>`;
      acoes.querySelector('.gond-novo-preco')?.focus();
    });
    $('#gond-folha')?.addEventListener('click', (ev) => {
      if (ev.target.closest?.('[data-cancelar-preco]')) renderPreview();
    });
    $('#gond-folha')?.addEventListener('click', (ev) => {
      const btn = ev.target.closest?.('[data-aplicar]');
      if (!btn) return;
      const idx = Number(btn.dataset.aplicar);
      const input = btn.parentElement?.querySelector('.gond-novo-preco');
      aplicarPreco(idx, input?.value);
    });
    $('#gond-folha')?.addEventListener('change', (ev) => {
      const promo = ev.target?.dataset?.promo;
      if (promo == null || ev.target.type !== 'checkbox') return;
      const item = preview[Number(promo)];
      if (!item) return;
      item.usarPromo = ev.target.checked;
      if (item.usarPromo && !item.prc_promo) item.prc_promo = item.prc_etiqueta;
      renderPreview();
    });
    $('#gond-folha')?.addEventListener('change', (ev) => {
      const idx = ev.target?.dataset?.promoValor;
      if (idx == null) return;
      const item = preview[Number(idx)];
      const novo = parsePreco(ev.target.value);
      if (!item || novo == null) return;
      item.prc_promo = novo;
      renderPreview();
    });
  }

  function diasMarcados() {
    return [...document.querySelectorAll('#ofer-dias [aria-pressed="true"]')].map((b) => Number(b.dataset.dia));
  }

  function renderOfertaForm() {
    const nome = $('#ofer-produto');
    if (nome) {
      nome.textContent = produtoOferta
        ? `${produtoOferta.descricao} · cód. ${produtoOferta.id_estoque}`
        : 'Nenhum produto selecionado';
    }
    const salvar = $('#ofer-salvar');
    if (salvar) salvar.textContent = ofertaEdit ? 'Atualizar oferta' : 'Salvar oferta';
  }

  function renderOfertas() {
    const box = $('#ofer-lista');
    if (!box) return;
    if (!ofertas.length) {
      box.innerHTML = '<p class="empty">Nenhuma oferta cadastrada.</p>';
      return;
    }
    box.innerHTML = ofertas.map((o) => `
      <article class="ofer-card">
        <div>
          <strong>${esc(o.descricao || `Identificador ${o.id_identificador}`)}</strong>
          <p class="hint">${o.inicio ? esc(o.inicio.split('-').reverse().join('/')) : ''} até ${o.fim ? esc(o.fim.split('-').reverse().join('/')) : ''}${o.dias?.length ? ` · ${esc(o.dias.map((n) => DIAS.find((d) => d.n === n)?.nome || n).join(', '))}` : ' · todos os dias'}</p>
        </div>
        <div class="ofer-precos">
          <span>${esc(money(o.prc_venda))}</span>
          <strong>${esc(money(o.prc_promo))}</strong>
          <em class="gond-pill is-${esc(o.vigencia)}">${esc(VIGENCIA[o.vigencia] || o.vigencia)}</em>
        </div>
        <div class="ofer-acoes">
          <button type="button" class="btn small" data-editar-oferta="${o.id_oferta}">Editar</button>
          <button type="button" class="btn small" data-remover-oferta="${o.id_oferta}">Remover</button>
        </div>
      </article>
    `).join('');
  }

  function limparOfertaForm() {
    ofertaEdit = 0;
    produtoOferta = null;
    if ($('#ofer-q')) $('#ofer-q').value = '';
    if ($('#ofer-promo')) $('#ofer-promo').value = '';
    if ($('#ofer-inicio')) $('#ofer-inicio').value = '';
    if ($('#ofer-fim')) $('#ofer-fim').value = '';
    document.querySelectorAll('#ofer-dias button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    const lista = $('#ofer-achados');
    if (lista) lista.hidden = true;
    renderOfertaForm();
  }

  function preencherOferta(o) {
    ofertaEdit = o.id_oferta;
    produtoOferta = {
      id_identificador: o.id_identificador,
      id_estoque: o.id_estoque,
      descricao: o.descricao,
      prc_venda: o.prc_venda,
    };
    if ($('#ofer-promo')) $('#ofer-promo').value = valor(o.prc_promo);
    if ($('#ofer-inicio')) $('#ofer-inicio').value = o.inicio || '';
    if ($('#ofer-fim')) $('#ofer-fim').value = o.fim || '';
    document.querySelectorAll('#ofer-dias button').forEach((b) => {
      b.setAttribute('aria-pressed', o.dias?.includes(Number(b.dataset.dia)) ? 'true' : 'false');
    });
    renderOfertaForm();
  }

  async function carregarOfertas() {
    const res = await api('/ofertas');
    ofertas = res?.ok ? (res.ofertas || []) : [];
    renderOfertas();
    if (!res?.ok && res?.error) deps.showMsg?.(res.error);
  }

  async function buscarProdutoOferta() {
    const q = ($('#ofer-q')?.value || '').trim();
    const lista = $('#ofer-achados');
    if (!lista) return;
    if (q.length < 2) { lista.hidden = true; return; }
    const res = await api(`/etiquetas/produtos?q=${encodeURIComponent(q)}`);
    const achados = res?.itens || [];
    lista.hidden = !achados.length;
    lista.innerHTML = achados.slice(0, 8).map((it) => `
      <button type="button" data-oferta-prod="${it.id_identificador}">
        <strong>${esc(it.descricao)}</strong>
        <span>cód. ${esc(it.id_estoque)} · ${esc(money(it.prc_venda))}</span>
      </button>
    `).join('');
    lista._itens = achados;
  }

  async function salvarOferta() {
    if (!produtoOferta) {
      deps.showMsg?.('Selecione o produto.');
      return;
    }
    const prc = parsePreco($('#ofer-promo')?.value);
    if (prc == null || prc <= 0) {
      deps.showMsg?.('Informe o preço promocional.');
      return;
    }
    const corpo = {
      id_identificador: produtoOferta.id_identificador,
      prc_promo: prc,
      inicio: $('#ofer-inicio')?.value || '',
      fim: $('#ofer-fim')?.value || '',
      dias: diasMarcados(),
    };
    const res = ofertaEdit
      ? await api(`/ofertas/${ofertaEdit}`, { method: 'PUT', body: corpo })
      : await api('/ofertas', { method: 'POST', body: corpo });
    if (!res?.ok) {
      deps.showMsg?.(res?.error || 'Não foi possível gravar a oferta.');
      return;
    }
    limparOfertaForm();
    await carregarOfertas();
  }

  function ligarOfertas() {
    let timer = null;
    $('#ofer-q')?.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(buscarProdutoOferta, 300);
    });
    $('#ofer-achados')?.addEventListener('click', (ev) => {
      const btn = ev.target.closest?.('[data-oferta-prod]');
      if (!btn) return;
      const lista = $('#ofer-achados');
      const item = (lista?._itens || []).find((it) => it.id_identificador === Number(btn.dataset.ofertaProd));
      if (!item) return;
      produtoOferta = item;
      ofertaEdit = 0;
      lista.hidden = true;
      if ($('#ofer-q')) $('#ofer-q').value = item.descricao;
      if ($('#ofer-promo') && !$('#ofer-promo').value && item.oferta) $('#ofer-promo').value = valor(item.oferta.prc_promo);
      renderOfertaForm();
    });
    $('#ofer-dias')?.addEventListener('click', (ev) => {
      const btn = ev.target.closest?.('button');
      if (!btn) return;
      btn.setAttribute('aria-pressed', btn.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    });
    $('#ofer-salvar')?.addEventListener('click', salvarOferta);
    $('#ofer-limpar')?.addEventListener('click', limparOfertaForm);
    $('#ofer-voltar')?.addEventListener('click', () => deps.showPage?.('estoque'));
    $('#ofer-lista')?.addEventListener('click', async (ev) => {
      const editar = ev.target.closest?.('[data-editar-oferta]');
      const remover = ev.target.closest?.('[data-remover-oferta]');
      if (editar) {
        const oferta = ofertas.find((o) => o.id_oferta === Number(editar.dataset.editarOferta));
        if (oferta) preencherOferta(oferta);
      }
      if (remover) {
        const id = Number(remover.dataset.removerOferta);
        const ok = await deps.showConfirm?.('Remover esta oferta?', { okLabel: 'Remover', cancelLabel: 'Cancelar' });
        if (!ok) return;
        const res = await api(`/ofertas/${id}`, { method: 'DELETE' });
        if (!res?.ok) deps.showMsg?.(res?.error || 'Não foi possível remover.');
        else {
          if (ofertaEdit === id) limparOfertaForm();
          await carregarOfertas();
        }
      }
    });
  }

  function renderEtiquetas() {
    const host = $('#etiq-host');
    if (!host || !modelos.length) return;
    const atual = modelos.find((m) => m.id === (host.dataset.id || modeloId)) || modelos[0];
    host.dataset.id = atual.id;
    const check = (campo, rotulo) => `
      <label class="pref-check"><input type="checkbox" data-campo="${campo}" ${atual[campo] ? 'checked' : ''} /><span>${rotulo}</span></label>`;
    host.innerHTML = `
      <div class="etiq-layout">
        <div class="pref-card">
          <h3>Modelos</h3>
          <p class="hint">Preço, descrição, código de barras e identificador saem do estoque. Outros tipos de etiqueta entram nesta lista.</p>
          <div class="etiq-lista">
            ${modelos.map((m) => `
              <button type="button" class="etiq-modelo${m.id === atual.id ? ' is-on' : ''}" data-modelo="${esc(m.id)}">
                <strong>${esc(m.nome)}</strong>
                <span>${esc(m.tipo === 'gondola' ? 'Gôndola' : m.tipo)} · ${m.larguraMm}×${m.alturaMm} mm</span>
              </button>
            `).join('')}
          </div>
          <button type="button" class="btn" id="etiq-novo">Novo modelo</button>
        </div>
        <form class="pref-card larga" id="etiq-form">
          <h3>Editar modelo</h3>
          <label>Nome <input data-campo="nome" value="${esc(atual.nome)}" maxlength="60" /></label>
          <div class="etiq-medidas">
            <label>Largura (mm) <input data-campo="larguraMm" inputmode="numeric" value="${esc(atual.larguraMm)}" /></label>
            <label>Altura (mm) <input data-campo="alturaMm" inputmode="numeric" value="${esc(atual.alturaMm)}" /></label>
            <label>Fundo <input data-campo="fundo" type="color" value="${esc(atual.fundo)}" /></label>
            <label>Texto <input data-campo="tinta" type="color" value="${esc(atual.tinta)}" /></label>
          </div>
          ${check('mostrarEmpresa', 'Nome da empresa')}
          ${check('mostrarDescricao', 'Descrição')}
          ${check('abreviarDescricao', 'Abreviar descrição')}
          <label>Máximo de caracteres da descrição <input data-campo="maxDescricao" inputmode="numeric" value="${esc(atual.maxDescricao)}" /></label>
          ${check('mostrarReferencia', 'Referência')}
          ${check('mostrarBarras', 'Código de barras')}
          ${check('mostrarIdentificador', 'Identificador')}
          ${check('mostrarPreco', 'Preço')}
          ${check('mostrarOferta', 'Balão OFERTA! para preço promocional')}
          ${check('mostrarUnidade', 'Unidade de medida')}
          <div class="etiq-botoes">
            <button type="submit" class="btn primary">Salvar modelo</button>
            ${modelos.length > 1 ? '<button type="button" class="btn" id="etiq-excluir">Excluir</button>' : ''}
          </div>
        </form>
      </div>`;
  }

  function lerFormulario(id) {
    const form = $('#etiq-form');
    const bruto = { id, tipo: 'gondola' };
    form?.querySelectorAll('[data-campo]').forEach((el) => {
      bruto[el.dataset.campo] = el.type === 'checkbox' ? el.checked : el.value;
    });
    return bruto;
  }

  async function salvarModelos(lista) {
    const res = await api('/etiquetas/modelos', { method: 'PUT', body: { modelos: lista } });
    if (!res?.ok) {
      deps.showMsg?.(res?.error || 'Não foi possível salvar o modelo.');
      return;
    }
    modelos = res.modelos || lista;
    renderModeloSelect();
    renderEtiquetas();
  }

  function ligarEtiquetas() {
    $('#etiq-host')?.addEventListener('click', (ev) => {
      const modelo = ev.target.closest?.('[data-modelo]');
      if (modelo) {
        $('#etiq-host').dataset.id = modelo.dataset.modelo;
        renderEtiquetas();
      }
      if (ev.target.closest?.('#etiq-novo')) {
        const base = modelos.find((m) => m.id === $('#etiq-host').dataset.id) || modelos[0];
        const novo = {
          ...base,
          id: `gondola-${Date.now().toString(36)}`,
          nome: 'Novo modelo',
        };
        modelos = [...modelos, novo];
        $('#etiq-host').dataset.id = novo.id;
        renderEtiquetas();
      }
      if (ev.target.closest?.('#etiq-excluir')) {
        const id = $('#etiq-host').dataset.id;
        const lista = modelos.filter((m) => m.id !== id);
        if (!lista.length) return;
        $('#etiq-host').dataset.id = lista[0].id;
        salvarModelos(lista);
      }
    });
    $('#etiq-host')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
    const id = $('#etiq-host').dataset.id;
    const atual = modelos.find((m) => m.id === id);
    const bruto = lerFormulario(id);
    bruto.tipo = atual?.tipo || 'gondola';
    const lista = modelos.map((m) => (m.id === id ? { ...m, ...bruto, id } : m));
      salvarModelos(lista);
    });
  }

  function init(d) {
    deps = d || {};
    ligarGondola();
    ligarOfertas();
    ligarEtiquetas();
    $('#btn-gondola')?.addEventListener('click', () => deps.showPage?.('gondola'));
    $('#btn-ofertas')?.addEventListener('click', () => deps.showPage?.('ofertas'));
  }

  async function onGondola() {
    fecharPreview();
    await Promise.all([carregarModelos(), carregarGrupos()]);
    renderChips();
    renderTabela();
    $('#gond-q')?.focus();
  }

  async function onOfertas() {
    renderOfertaForm();
    await carregarOfertas();
  }

  async function onEtiquetas() {
    await carregarModelos();
    renderEtiquetas();
  }

  return { init, onGondola, onOfertas, onEtiquetas };
})();

window.Gondola = Gondola;
