'use strict';

(function () {
  const ABAS = [
    ['ofertas', 'Ofertas'],
    ['detalhes', 'Detalhes do item'],
  ];
  const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  let api = async () => ({ ok: false });
  let showMsg = (t) => window.alert(t);
  let esc = (v) => String(v ?? '');
  let estado = null;
  let aba = 'ofertas';
  let produtos = [];
  let grupos = [];
  let ofertas = [];
  let ofertaAberta = '';
  let podePreco = false;
  let buscaTimer = 0;
  let fotoAlvo = '';
  const filtros = { q: '', grupo: '', com: false, menos: false, promo: false };

  function raiz() { return document.getElementById('co-raiz'); }
  function campo(id) { return document.getElementById(id); }

  function htmlAbas() {
    return `<div class="tabs" id="co-abas">${ABAS.map(([id, nome]) =>
      `<button type="button" class="tab${id === aba ? ' active' : ''}" data-co-aba="${id}">${nome}</button>`
    ).join('')}</div><div id="co-painel"></div>`;
  }

  function camposOrigem() {
    return (estado?.campos_texto || []).map((c) => (
      typeof c === 'string' ? { coluna: c, rotulo: c || 'Nenhum' } : { coluna: c.coluna || '', rotulo: c.rotulo || c.coluna || 'Nenhum' }
    ));
  }

  function campoPadrao() {
    const lista = camposOrigem();
    return (lista.find((c) => c.coluna === 'OBSERVACAO') || lista[0] || { coluna: '' }).coluna;
  }

  function painel() {
    if (aba === 'detalhes') return htmlDetalhes();
    return htmlOfertas();
  }

  function htmlDetalhes() {
    const d = estado.config.detalhes_item;
    const campos = camposOrigem();
    const atual = d.campo_origem || campoPadrao();
    return `<label class="co-check"><input id="co-det-on" type="checkbox" ${d.ativo ? 'checked' : ''} /> Usar os detalhes do item</label>
      <label>Campo de origem no ERP<select id="co-det-campo">${campos.map((item) => `<option value="${esc(item.coluna)}" ${item.coluna === atual ? 'selected' : ''}>${esc(item.rotulo)}</option>`).join('')}</select></label>
      <label>Onde aparece<select id="co-det-onde">
        <option value="banner" ${d.onde === 'banner' ? 'selected' : ''}>Banner</option>
        <option value="legenda" ${d.onde === 'legenda' ? 'selected' : ''}>Legenda</option>
        <option value="ambos" ${d.onde === 'ambos' ? 'selected' : ''}>Banner e legenda</option>
      </select></label>
      <label>Limite no banner<input id="co-det-limite" type="number" min="10" max="120" value="${d.limite_banner}" /></label>
      <p class="hint">Com a opção marcada, a rotina leva o texto da observação. A quantidade segue o parâmetro em Configurações, Produtos. A conta do Instagram fica em Configurações, Conexões.</p>
      <button type="button" class="btn primary" id="co-salvar">Salvar</button>`;
  }

  function ofertaAtual() {
    return ofertas.find((o) => o.id === ofertaAberta) || null;
  }

  function idsNaOferta() {
    return new Set((ofertaAtual()?.produtos || []).map((p) => String(p.id)));
  }

  function htmlOfertas() {
    const aberta = ofertaAtual();
    if (aberta) return htmlOfertaAberta(aberta);
    const linhas = ofertas.map((o) => `<button type="button" class="co-oferta-item" data-co-oferta="${esc(o.id)}">
      <strong>${esc(o.nome)}</strong>
      <span>${esc(o.inicio)} a ${esc(o.fim)} · ${(o.produtos || []).length} produto${(o.produtos || []).length === 1 ? '' : 's'}</span>
    </button>`).join('');
    return `<div class="co-ofertas">
      <div class="co-oferta-lista">${linhas || '<p class="hint">Nenhuma oferta criada.</p>'}</div>
      <section class="co-oferta-nova">
        <h3>Nova oferta</h3>
        <div class="co-grade co-grade-2">
          <label class="co-oferta-nome">Nome<input id="co-of-nome" maxlength="80" placeholder="Semana do Yu-Gi-Oh" /></label>
          <label>Início<input id="co-of-ini" type="date" value="${isoHoje(0)}" /></label>
          <label>Fim<input id="co-of-fim" type="date" value="${isoHoje(6)}" /></label>
        </div>
        <button type="button" class="btn primary" id="co-of-criar">Criar oferta</button>
      </section>
    </div>`;
  }

  function cfgRotina(o) {
    const base = {
      posts_por_dia: 4, intervalo_minutos: 90, hora_inicio: '08:00', hora_fim: '20:00',
      dias_semana: [1, 2, 3, 4, 5], fds_ativo: false, fds_qtd: 1, encarte: false,
    };
    return { ...base, ...(o.rotina_cfg || {}) };
  }

  function htmlOfertaAberta(o) {
    const r = cfgRotina(o);
    const dias = (r.dias_semana || []).map(Number);
    const rotina = (o.rotina || []).map((item) => `<li><span>${esc(item.data)} ${esc(item.hora)}</span><span>${esc(item.descricao || item.produto_id)}</span>${item.detalhe ? `<small>${esc(item.detalhe)}</small>` : ''}</li>`).join('');
    return `<div class="co-oferta-head">
        <button type="button" class="btn small" id="co-of-voltar">Ofertas</button>
        <h3>${esc(o.nome)}</h3>
        <span class="hint">${esc(o.inicio)} a ${esc(o.fim)}</span>
      </div>
      <h4>Produtos</h4>
      ${htmlBusca()}
      <h4>Rotina</h4>
      <div class="co-rotina">
        <label>Posts<input id="co-r-posts" class="co-curto" type="number" min="1" max="50" value="${Number(r.posts_por_dia) || 4}" /></label>
        <label>Min<input id="co-r-int" class="co-curto" type="number" min="1" max="1440" value="${Number(r.intervalo_minutos) || 90}" /></label>
        <label>Início<input id="co-r-ini" class="co-hora" type="time" value="${esc(String(r.hora_inicio || '08:00').slice(0, 5))}" /></label>
        <label>Fim<input id="co-r-fim" class="co-hora" type="time" value="${esc(String(r.hora_fim || '20:00').slice(0, 5))}" /></label>
        <div class="co-dias-curtos">${DIAS.map((nome, i) => `<label class="co-dia" title="${nome}"><input type="checkbox" data-co-dia="${i}" ${dias.includes(i) ? 'checked' : ''} /><span>${esc(nome)}</span></label>`).join('')}</div>
        <label class="co-check"><input id="co-r-fds" type="checkbox" ${r.fds_ativo ? 'checked' : ''} /> Fds</label>
        <label>Qtd<input id="co-r-fds-qtd" class="co-curto" type="number" min="0" max="10" value="${Number(r.fds_qtd) || 0}" /></label>
        <label class="co-check"><input id="co-r-encarte" type="checkbox" ${r.encarte ? 'checked' : ''} /> Encarte</label>
        <button type="button" class="btn primary" id="co-of-rotina">Gerar</button>
      </div>
      ${o.aviso ? `<p class="erro">${esc(o.aviso)}</p>` : ''}
      <ul class="co-oferta-rotina">${rotina || '<li><span>A rotina ainda não foi gerada.</span></li>'}</ul>`;
  }

  function atalho(id, nome) {
    return `<button type="button" class="co-atalho" data-co-filtro="${id}" aria-pressed="${filtros[id] ? 'true' : 'false'}">${nome}</button>`;
  }

  function htmlBusca() {
    const opcoes = ['<option value="">Todos</option>'].concat(grupos.map((g) =>
      `<option value="${esc(g)}" ${g === filtros.grupo ? 'selected' : ''}>${esc(g)}</option>`
    )).join('');
    return `<div class="co-est">
      <div class="co-filtros">
        <label>Buscar<input id="co-q" type="search" placeholder="Nome, código ou EAN" value="${esc(filtros.q)}" /></label>
        <label>Grupo<select id="co-grupo">${opcoes}</select></label>
        <div class="co-atalhos" role="group" aria-label="Filtros">
          ${atalho('com', 'Com estoque')}
          ${atalho('menos', 'Menos vendidos')}
          ${atalho('promo', 'Promoção no ERP')}
        </div>
      </div>
      <input id="co-arquivo" class="co-arquivo" type="file" accept="image/jpeg,image/png,image/webp" />
      <div id="co-miolo"></div>
      <p class="hint" id="co-extra"></p>
    </div>`;
  }

  function moedaInput(v) {
    if (v == null || v === '') return '';
    const n = Number(v);
    if (!Number.isFinite(n)) return '';
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function qtdTxt(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} un`;
  }

  function temPromo(p) {
    return Number(p.preco_promocional) > 0 && p.promocao_inicio && p.promocao_fim;
  }

  function visiveis() {
    const q = filtros.q.trim().toLowerCase();
    let lista = produtos.filter((p) => {
      if (q && ![p.descricao, p.codigo, p.ean, p.id].some((v) => String(v || '').toLowerCase().includes(q))) return false;
      if (filtros.grupo && p.categoria !== filtros.grupo) return false;
      if (filtros.com && !(Number(p.estoque) > 0 || p.ignorar_estoque)) return false;
      if (filtros.promo && !temPromo(p)) return false;
      return true;
    });
    if (filtros.menos) {
      lista = lista.slice().sort((a, b) => (Number(a.vendido_30d) || 0) - (Number(b.vendido_30d) || 0)
        || String(a.descricao).localeCompare(String(b.descricao), 'pt'));
    }
    return lista;
  }

  function inputMoeda(p, nome, valor) {
    const dis = podePreco ? '' : 'disabled';
    return `<input class="co-moeda" type="text" inputmode="decimal" autocomplete="off" data-co-campo="${nome}" value="${esc(moedaInput(valor))}" ${dis} />`;
  }

  function inputData(p, nome, valor) {
    const dis = podePreco ? '' : 'disabled';
    return `<input class="co-data" type="date" data-co-campo="${nome}" value="${esc(valor || '')}" ${dis} />`;
  }

  function modoAtual(p) {
    if (p.modo_escolhido === 'oferta' || p.modo_escolhido === 'exposicao') return p.modo_escolhido;
    if (p.modo === 'oferta' || p.modo === 'exposicao') return p.modo;
    return 'nenhum';
  }

  function htmlFoto(p) {
    const caminho = `${p.id}/${p.ean || 'sem-codigo'}`;
    const img = p.foto_url ? `<img class="co-foto-mini" src="${esc(p.foto_url)}" alt="" />` : '';
    return `<button type="button" class="co-foto-btn" data-co-foto="${esc(p.id)}" data-co-ean="${esc(p.ean || '')}" title="Caminho no R2: ${esc(caminho)}">${img}<span>${p.foto_url ? 'Trocar' : 'Anexar'}</span></button>`;
  }

  function htmlModo(p) {
    const modo = modoAtual(p);
    const titulo = p.oferta?.motivo || p.exposicao?.motivo || '';
    return `<select class="co-modo-sel" data-co-modo="${esc(p.id)}" title="${esc(titulo)}">
      <option value="nenhum" ${modo === 'nenhum' ? 'selected' : ''}>—</option>
      <option value="exposicao" ${modo === 'exposicao' ? 'selected' : ''}>Exposição</option>
      <option value="oferta" ${modo === 'oferta' ? 'selected' : ''}>Oferta</option>
    </select>`;
  }

  function htmlTabela(lista) {
    const naOferta = idsNaOferta();
    const linhas = lista.map((p) => {
      const qtdCls = Number(p.estoque) < 0 ? ' is-neg' : '';
      const dentro = naOferta.has(String(p.id));
      const vendido = filtros.menos ? ` · ${Number(p.vendido_30d) || 0} vend.` : '';
      return `<tr data-co-id="${esc(p.id)}">
        <td class="meio"><input type="checkbox" data-co-na="${esc(p.id)}" ${dentro ? 'checked' : ''} title="${dentro ? 'Tirar da oferta' : 'Incluir na oferta'}" /></td>
        <td class="meio">${htmlFoto(p)}</td>
        <td class="co-cod">${esc(p.codigo)}</td>
        <td><div class="co-nome">${esc(p.descricao)}</div><div class="co-sub">${esc(p.ean ? `EAN ${p.ean}` : 'Sem EAN')}${p.categoria ? ` · ${esc(p.categoria)}` : ''}${esc(vendido)}</div></td>
        <td class="num co-qtd${qtdCls}">${esc(qtdTxt(p.estoque))}</td>
        <td>${inputMoeda(p, 'preco', p.preco)}</td>
        <td>${inputMoeda(p, 'promo', p.preco_promocional)}</td>
        <td>${inputData(p, 'inicio', p.promocao_inicio)}</td>
        <td>${inputData(p, 'fim', p.promocao_fim)}</td>
        <td class="meio">${htmlModo(p)}</td>
      </tr>`;
    }).join('');
    const vazio = filtros.q || filtros.grupo || filtros.com || filtros.menos || filtros.promo
      ? 'Nenhum produto com esses filtros.'
      : 'Busque o produto para incluir na oferta.';
    return `<div class="co-tabela-wrap"><table class="co-tabela">
      <colgroup>
        <col class="c-sel" /><col class="c-foto" /><col class="c-cod" /><col class="c-nome" />
        <col class="c-est" /><col class="c-preco" /><col class="c-preco" /><col class="c-data" /><col class="c-data" /><col class="c-modo" />
      </colgroup>
      <thead><tr>
        <th class="meio" title="Incluir na oferta"></th>
        <th class="meio">Foto</th><th>Cód.</th><th>Produto</th><th class="num">Estoque</th>
        <th class="num">Preço</th><th class="num">Preço promo</th><th>Início</th><th>Fim</th><th class="meio">Modo</th>
      </tr></thead>
      <tbody>${linhas || `<tr><td colspan="10" class="co-vazio">${vazio}</td></tr>`}</tbody>
    </table></div>`;
  }

  function lerFormulario() {
    if (aba !== 'detalhes' || !campo('co-det-on')) return;
    estado.config.detalhes_item = {
      ativo: campo('co-det-on').checked,
      campo_origem: campo('co-det-campo').value,
      onde: campo('co-det-onde').value,
      limite_banner: Number(campo('co-det-limite').value),
    };
  }

  async function salvar() {
    lerFormulario();
    const r = await api('/central-ofertas/config', { method: 'PUT', body: estado.config });
    if (!r.ok) return showMsg(r.error || 'Falha ao salvar.');
    estado.config = r.config;
    estado.janela = r.janela;
    desenhar();
  }

  function desenhar() {
    const el = raiz();
    if (!el || !estado) return;
    el.innerHTML = htmlAbas();
    const painelEl = document.getElementById('co-painel');
    if (painelEl) painelEl.innerHTML = painel();
    el.querySelectorAll('[data-co-aba]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (campo('co-salvar')) lerFormulario();
        aba = btn.dataset.coAba;
        desenhar();
        if (aba === 'ofertas' && ofertaAtual()) carregarLista();
      });
    });
    campo('co-salvar')?.addEventListener('click', salvar);
    if (aba === 'ofertas' && ofertaAtual()) ligarArquivo();
    pintar();
  }

  function buscaAtiva() {
    return !!(filtros.q.trim() || filtros.grupo || filtros.com || filtros.menos || filtros.promo);
  }

  function pintar() {
    const miolo = document.getElementById('co-miolo');
    if (!miolo) return;
    miolo.innerHTML = htmlTabela(buscaAtiva() ? visiveis() : []);
    const extra = document.getElementById('co-extra');
    if (!extra) return;
    if (!buscaAtiva()) {
      extra.textContent = `${(ofertaAtual()?.produtos || []).length} na oferta`;
      return;
    }
    const partes = [`${visiveis().length} produto${visiveis().length === 1 ? '' : 's'}`];
    if (filtros.com) partes.push('com estoque');
    if (filtros.promo) partes.push('com promoção no ERP');
    if (filtros.menos) partes.push('menos vendidos primeiro');
    extra.textContent = partes.join(' · ');
  }

  function itemOferta(p) {
    return {
      id: p.id,
      descricao: p.descricao || '',
      ean: p.ean || '',
      detalhe: p.observacao || '',
      detalhes: p.textos || {},
    };
  }

  function trocarOferta(oferta) {
    ofertas = ofertas.map((o) => (o.id === oferta.id ? oferta : o));
    if (!ofertas.some((o) => o.id === oferta.id)) ofertas.unshift(oferta);
  }

  async function incluirProduto(p) {
    const o = ofertaAtual();
    if (!o || !p) return;
    const r = await api(`/central-ofertas/ofertas/${encodeURIComponent(o.id)}/produtos`, {
      method: 'POST',
      body: { produtos: [itemOferta(p)] },
    });
    if (!r.ok) return showMsg(r.error || 'Falha ao incluir o produto.');
    trocarOferta(r.oferta);
    desenhar();
    carregarLista();
  }

  async function tirarProduto(id) {
    const o = ofertaAtual();
    if (!o) return;
    const r = await api(`/central-ofertas/ofertas/${encodeURIComponent(o.id)}/produtos/remover`, {
      method: 'POST',
      body: { ids: [id] },
    });
    if (!r.ok) return showMsg(r.error || 'Falha ao tirar o produto.');
    trocarOferta(r.oferta);
    desenhar();
    carregarLista();
  }

  async function salvarModo(id, modo) {
    const r = await api(`/central-ofertas/produtos/${encodeURIComponent(id)}`, { method: 'PUT', body: { modo } });
    if (!r.ok) return showMsg(r.error || 'Falha ao salvar o modo.');
    produtos = produtos.map((p) => (String(p.id) === String(id) ? r.produto : p));
    pintar();
  }

  async function salvarCampos(id) {
    if (!podePreco) return;
    const linha = raiz()?.querySelector(`tr[data-co-id="${CSS.escape(String(id))}"]`);
    if (!linha) return;
    const val = (nome) => linha.querySelector(`[data-co-campo="${nome}"]`)?.value ?? '';
    const preco = val('preco');
    const promo = val('promo');
    const inicio = val('inicio');
    const fim = val('fim');
    const atual = produtos.find((p) => String(p.id) === String(id));
    if (atual
      && moedaInput(atual.preco) === preco
      && moedaInput(atual.preco_promocional) === promo
      && String(atual.promocao_inicio || '') === inicio
      && String(atual.promocao_fim || '') === fim) return;
    if (!String(preco).trim()) return showMsg('Informe o preço.');
    if (String(promo).trim() && (!inicio || !fim)) return showMsg('Informe o início e o fim da promoção.');
    const r = await api(`/central-ofertas/produtos/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: {
        preco,
        preco_promocional: String(promo).trim() ? promo : null,
        promocao_inicio: String(promo).trim() ? inicio : '',
        promocao_fim: String(promo).trim() ? fim : '',
      },
    });
    if (!r.ok) return showMsg(r.error || 'Falha ao salvar o preço.');
    produtos = produtos.map((p) => (String(p.id) === String(id) ? r.produto : p));
    pintar();
  }

  function reduzirFoto(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const lado = Math.max(img.width, img.height) || 1;
        const escala = Math.min(1, 1080 / lado);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * escala));
        canvas.height = Math.max(1, Math.round(img.height * escala));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Não abri a foto.'));
      };
      img.src = url;
    });
  }

  async function enviarFoto(id, ean, file) {
    let dataUrl = '';
    try { dataUrl = await reduzirFoto(file); }
    catch (err) { return showMsg(err.message || 'Não abri a foto.'); }
    const base64 = dataUrl.split(',')[1] || '';
    const r = await api(`/central-ofertas/produtos/${encodeURIComponent(id)}/foto`, {
      method: 'POST',
      body: { base64, tipo: 'image/jpeg', ean },
    });
    if (!r.ok) return showMsg(r.error || 'Falha ao anexar a foto.');
    produtos = produtos.map((p) => (String(p.id) === String(id) ? { ...p, foto: true, foto_url: r.foto_url, foto_chave: r.foto_chave } : p));
    pintar();
    if (r.aviso) showMsg(r.aviso);
  }

  function ligarArquivo() {
    campo('co-q')?.addEventListener('input', () => {
      filtros.q = campo('co-q').value;
      clearTimeout(buscaTimer);
      buscaTimer = setTimeout(() => carregarLista(), 280);
    });
    campo('co-grupo')?.addEventListener('change', () => {
      filtros.grupo = campo('co-grupo').value;
      carregarLista();
    });
    campo('co-arquivo')?.addEventListener('change', () => {
      const file = campo('co-arquivo').files?.[0];
      const id = fotoAlvo;
      const ean = campo('co-arquivo').dataset.ean || '';
      campo('co-arquivo').value = '';
      fotoAlvo = '';
      if (file && id) enviarFoto(id, ean, file);
    });
  }

  function noEvento(ev) {
    if (!raiz()?.contains(ev.target)) return;
    if (ev.type === 'click') clique(ev);
    if (ev.type === 'change') mudou(ev);
    if (ev.type === 'focusout') saiu(ev);
  }

  async function clique(ev) {
    const abaBtn = ev.target.closest('[data-co-aba]');
    if (abaBtn) return;
    if (ev.target.id === 'co-of-criar') return criarOferta();
    if (ev.target.id === 'co-of-voltar') {
      ofertaAberta = '';
      produtos = [];
      desenhar();
      return;
    }
    const item = ev.target.closest('[data-co-oferta]');
    if (item) {
      ofertaAberta = item.dataset.coOferta;
      desenhar();
      return;
    }
    if (ev.target.id === 'co-of-rotina') return gerarRotina();
    if (!ofertaAtual()) return;
    const foto = ev.target.closest('[data-co-foto]');
    if (foto) {
      fotoAlvo = foto.dataset.coFoto;
      const arq = campo('co-arquivo');
      if (arq) {
        arq.dataset.ean = foto.dataset.coEan || '';
        arq.click();
      }
      return;
    }
    const b = ev.target.closest('[data-co-filtro]');
    if (!b) return;
    const k = b.dataset.coFiltro;
    filtros[k] = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', filtros[k] ? 'true' : 'false');
    await carregarLista();
  }

  async function mudou(ev) {
    const t = ev.target;
    if (!raiz()?.contains(t) || !ofertaAtual()) return;
    if (t.dataset.coNa) {
      const p = produtos.find((item) => String(item.id) === String(t.dataset.coNa));
      if (t.checked) await incluirProduto(p);
      else await tirarProduto(t.dataset.coNa);
      return;
    }
    if (t.dataset.coModo) await salvarModo(t.dataset.coModo, t.value);
  }

  function saiu(ev) {
    if (!ofertaAtual()) return;
    const origem = ev.target.closest?.('tr');
    if (!origem?.dataset.coId || !raiz()?.contains(origem)) return;
    if (ev.target?.dataset?.coModo || ev.target?.dataset?.coNa) return;
    if (ev.relatedTarget && origem.contains(ev.relatedTarget)) return;
    salvarCampos(origem.dataset.coId);
  }

  function queryLista() {
    const qs = new URLSearchParams();
    if (filtros.q) qs.set('q', filtros.q);
    if (filtros.grupo) qs.set('grupo', filtros.grupo);
    if (filtros.com) qs.set('com', '1');
    if (filtros.promo) qs.set('promo', '1');
    if (filtros.menos) qs.set('vendidos', '1');
    const s = qs.toString();
    return s ? `?${s}` : '';
  }

  async function carregarLista() {
    if (!ofertaAtual()) return;
    if (!buscaAtiva()) {
      produtos = [];
      pintar();
      return;
    }
    const extra = document.getElementById('co-extra');
    if (extra) extra.textContent = 'Carregando produtos…';
    const r = await api(`/central-ofertas/produtos${queryLista()}`);
    if (!r.ok) {
      const miolo = document.getElementById('co-miolo');
      if (miolo) miolo.innerHTML = `<p class="erro">${esc(r.error || 'Falha ao ler os produtos.')}</p>`;
      return;
    }
    produtos = r.produtos || [];
    grupos = r.grupos || [];
    podePreco = r.pode_preco === true;
    const grupo = campo('co-grupo');
    if (grupo) {
      const atual = filtros.grupo;
      grupo.innerHTML = ['<option value="">Todos</option>'].concat(grupos.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`)).join('');
      grupo.value = grupos.includes(atual) ? atual : '';
      filtros.grupo = grupo.value;
    }
    pintar();
  }

  function isoHoje(offset) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function lerRotinaForm() {
    return {
      posts_por_dia: Number(campo('co-r-posts')?.value),
      intervalo_minutos: Number(campo('co-r-int')?.value),
      hora_inicio: String(campo('co-r-ini')?.value || '').slice(0, 5),
      hora_fim: String(campo('co-r-fim')?.value || '').slice(0, 5),
      dias_semana: [...document.querySelectorAll('[data-co-dia]:checked')].map((el) => Number(el.dataset.coDia)),
      fds_ativo: !!campo('co-r-fds')?.checked,
      fds_qtd: Number(campo('co-r-fds-qtd')?.value),
      encarte: !!campo('co-r-encarte')?.checked,
    };
  }

  async function criarOferta() {
    const usar = estado?.config?.detalhes_item?.ativo === true;
    const r = await api('/central-ofertas/ofertas', {
      method: 'POST',
      body: {
        nome: campo('co-of-nome')?.value || '',
        inicio: campo('co-of-ini')?.value || '',
        fim: campo('co-of-fim')?.value || '',
        usar_detalhes: usar,
        produtos: [],
      },
    });
    if (!r.ok) return showMsg(r.error || 'Falha ao criar a oferta.');
    ofertaAberta = r.oferta.id;
    await carregarOfertas();
  }

  async function gerarRotina() {
    const o = ofertaAtual();
    if (!o) return;
    const r = await api(`/central-ofertas/ofertas/${encodeURIComponent(o.id)}/rotina`, {
      method: 'POST',
      body: { rotina: lerRotinaForm() },
    });
    if (!r.ok) return showMsg(r.error || 'Falha ao gerar a rotina.');
    if (r.aviso) showMsg(r.aviso);
    trocarOferta(r.oferta);
    desenhar();
    carregarLista();
  }

  async function carregarOfertas() {
    const r = await api('/central-ofertas/ofertas');
    if (!r.ok) return showMsg(r.error || 'Falha ao ler as ofertas.');
    ofertas = r.ofertas || [];
    if (ofertaAberta && !ofertas.some((o) => o.id === ofertaAberta)) ofertaAberta = '';
    if (aba === 'ofertas') {
      desenhar();
      if (ofertaAtual()) carregarLista();
    }
  }

  async function onPageEnter() {
    const el = raiz();
    if (!el) return;
    el.innerHTML = '<p class="hint">Carregando…</p>';
    const r = await api('/central-ofertas/config');
    if (!r.ok) {
      el.innerHTML = `<p class="erro">${esc(r.error || 'A Central de Ofertas não está disponível.')}</p>`;
      return;
    }
    estado = r;
    await carregarOfertas();
  }

  function init(deps) {
    api = deps.api || api;
    showMsg = deps.showMsg || showMsg;
    esc = deps.escapeHtml || esc;
    const raizEl = document.getElementById('co-raiz');
    if (raizEl && !raizEl.dataset.coLigado) {
      raizEl.dataset.coLigado = '1';
      raizEl.addEventListener('click', noEvento);
      raizEl.addEventListener('change', noEvento);
      raizEl.addEventListener('focusout', noEvento);
    }
  }

  window.CentralOfertas = { init, onPageEnter };
})();
