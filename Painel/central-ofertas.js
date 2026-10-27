'use strict';

(function () {
  const ABAS = [
    ['lista', 'Estoque'],
    ['ofertas', 'Ofertas'],
    ['publicacao', 'Publicação'],
    ['fds', 'Fim de semana'],
    ['detalhes', 'Detalhes do item'],
    ['regra', 'Regra de estoque'],
    ['instagram', 'Conta Instagram'],
  ];
  const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const TIPOS = [
    ['receita', 'Receita com produtos da loja'],
    ['pergunta', 'Pergunta para comentar'],
    ['bastidores', 'Bastidores e novidades'],
  ];

  let api = async () => ({ ok: false });
  let showMsg = (t) => window.alert(t);
  let esc = (v) => String(v ?? '');
  let estado = null;
  let aba = 'lista';
  let produtos = [];
  let grupos = [];
  let ofertas = [];
  let ofertaAberta = '';
  let podePreco = false;
  let buscaTimer = 0;
  let fotoAlvo = '';
  const filtros = { q: '', grupo: '', com: false, menos: false, promo: false };
  const MODO = { oferta: 'Oferta', exposicao: 'Exposição', sem_estoque: 'Sem estoque', nenhum: '—' };

  function raiz() {
    return document.getElementById('co-raiz');
  }

  function campo(id) {
    return document.getElementById(id);
  }

  function htmlAbas() {
    return `<div class="tabs" id="co-abas">${ABAS.map(([id, nome]) =>
      `<button type="button" class="tab${id === aba ? ' active' : ''}" data-co-aba="${id}">${nome}</button>`
    ).join('')}</div><div id="co-painel"></div>`;
  }

  function checado(lista, valor) {
    return (lista || []).map(Number).includes(Number(valor)) ? 'checked' : '';
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
    const c = estado.config;
    const janela = estado.janela || {};
    if (aba === 'ofertas') return htmlOfertas();
    if (aba === 'publicacao') {
      return `<div class="co-grade co-grade-2">
        <label>Posts por dia<input id="co-posts" type="number" min="1" max="50" value="${c.publicacao.posts_por_dia}" /></label>
        <label>Intervalo mínimo (minutos)<input id="co-intervalo" type="number" min="1" max="1440" value="${c.publicacao.intervalo_minutos}" /></label>
        <label>Início<input id="co-ini" type="time" value="${esc(c.publicacao.hora_inicio)}" /></label>
        <label>Fim<input id="co-fim" type="time" value="${esc(c.publicacao.hora_fim)}" /></label>
      </div>
      <p class="co-dias">${DIAS.map((nome, i) => `<label><input type="checkbox" data-co-dia="${i}" ${checado(c.publicacao.dias_semana, i)} /> ${nome}</label>`).join('')}</p>
      <p class="${janela.cabe ? 'hint' : 'erro'}" id="co-janela">${esc(janela.aviso || `A janela comporta ${janela.vagas} post(s).`)}</p>
      <button type="button" class="btn primary" id="co-salvar">Salvar</button>`;
    }
    if (aba === 'fds') {
      const f = c.fim_de_semana;
      return `<label class="co-check"><input id="co-fds" type="checkbox" ${f.ativo ? 'checked' : ''} /> Publicar engajamento no sábado e no domingo</label>
        <label>Quantidade por dia<input id="co-fds-qtd" type="number" min="0" max="10" value="${f.quantidade_por_dia}" /></label>
        <div class="co-dias">${TIPOS.map(([id, nome]) => `<label><input type="checkbox" data-co-tipo="${id}" ${(f.tipos || []).includes(id) ? 'checked' : ''} /> ${nome}</label>`).join('')}</div>
        <label class="co-check"><input id="co-encarte" type="checkbox" ${f.encarte_sabado_manha ? 'checked' : ''} /> Manter o encarte no sábado de manhã</label>
        <p class="hint">Posts de engajamento são imagem e legenda, sem figurinhas interativas.</p>
        <button type="button" class="btn primary" id="co-salvar">Salvar</button>`;
    }
    if (aba === 'detalhes') {
      const d = c.detalhes_item;
      const campos = camposOrigem();
      const atual = d.campo_origem || campoPadrao();
      return `<label class="co-check"><input id="co-det-on" type="checkbox" ${d.ativo ? 'checked' : ''} /> Usar os detalhes do item</label>
        <label>Campo de origem no ERP<select id="co-det-campo">${campos.map((campo) => `<option value="${esc(campo.coluna)}" ${campo.coluna === atual ? 'selected' : ''}>${esc(campo.rotulo)}</option>`).join('')}</select></label>
        <label>Onde aparece<select id="co-det-onde">
          <option value="banner" ${d.onde === 'banner' ? 'selected' : ''}>Banner</option>
          <option value="legenda" ${d.onde === 'legenda' ? 'selected' : ''}>Legenda</option>
          <option value="ambos" ${d.onde === 'ambos' ? 'selected' : ''}>Banner e legenda</option>
        </select></label>
        <label>Limite no banner<input id="co-det-limite" type="number" min="10" max="120" value="${d.limite_banner}" /></label>
        <p class="hint">Com a opção marcada, a rotina leva o texto da observação do produto. Identificador e código de barras também estão na lista porque formam o caminho da foto no R2.</p>
        <button type="button" class="btn primary" id="co-salvar">Salvar</button>`;
    }
    if (aba === 'regra') {
      const e = c.estoque;
      return `<label class="co-check"><input id="co-exigir" type="checkbox" ${e.exigir_estoque_positivo ? 'checked' : ''} /> Exigir estoque positivo para anunciar</label>
        <label>Estoque mínimo do anúncio<input id="co-minimo" type="number" min="0" max="999999" value="${e.estoque_minimo_anuncio}" ${e.exigir_estoque_positivo ? '' : 'disabled'} /></label>
        <p class="hint">Desmarcado, o saldo não bloqueia seleção, agenda, validação nem encarte. A coluna de estoque continua só como informação. Itens de produção própria podem ignorar o estoque mesmo com a opção marcada.</p>
        <button type="button" class="btn primary" id="co-salvar">Salvar</button>`;
    }
    if (aba === 'instagram') {
      const ig = estado.instagram || {};
      const fotos = estado.modos?.imagens || 'simulado';
      return `<p>Status: <strong>${esc(ig.status || 'desconectada')}</strong></p>
        <p class="hint">${ig.token_expira_em ? `Token informado no painel, válido até ${esc(ig.token_expira_em)}.` : 'Nenhuma conta informada no cadastro do cliente.'}</p>
        <p class="hint">Usuário, ID, token e validade ficam no cadastro do cliente, no painel. O token não vem para esta loja. Fotos: ${esc(fotos)}.</p>`;
    }
    return htmlLista();
  }

  function atalho(id, nome) {
    const on = filtros[id] ? 'true' : 'false';
    return `<button type="button" class="co-atalho" data-co-filtro="${id}" aria-pressed="${on}">${nome}</button>`;
  }

  function htmlLista() {
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
      <div class="co-rodape">
        <p id="co-resumo"></p>
        <p class="hint" id="co-extra"></p>
      </div>
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
    return `<input class="co-moeda" type="text" inputmode="decimal" autocomplete="off" data-co-campo="${nome}" data-co-id="${esc(p.id)}" value="${esc(moedaInput(valor))}" ${dis} />`;
  }

  function inputData(p, nome, valor) {
    const dis = podePreco ? '' : 'disabled';
    return `<input class="co-data" type="date" data-co-campo="${nome}" data-co-id="${esc(p.id)}" value="${esc(valor || '')}" ${dis} />`;
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

  function subProduto(p) {
    const partes = [p.ean ? `EAN ${p.ean}` : 'Sem EAN', p.categoria || ''];
    if (filtros.menos) partes.push(`${Number(p.vendido_30d) || 0} vend. / 30d`);
    return partes.filter(Boolean).join(' · ');
  }

  function htmlTabela(lista) {
    const todos = lista.length > 0 && lista.every((p) => p.selecionado);
    const linhas = lista.map((p) => {
      const qtdCls = Number(p.estoque) < 0 ? ' is-neg' : '';
      return `<tr data-co-id="${esc(p.id)}">
        <td class="meio"><input type="checkbox" data-co-sel="${esc(p.id)}" ${p.selecionado ? 'checked' : ''} /></td>
        <td class="meio">${htmlFoto(p)}</td>
        <td class="co-cod">${esc(p.codigo)}</td>
        <td><div class="co-nome">${esc(p.descricao)}</div><div class="co-sub">${esc(subProduto(p))}</div></td>
        <td class="num co-qtd${qtdCls}">${esc(qtdTxt(p.estoque))}</td>
        <td>${inputMoeda(p, 'preco', p.preco)}</td>
        <td>${inputMoeda(p, 'promo', p.preco_promocional)}</td>
        <td>${inputData(p, 'inicio', p.promocao_inicio)}</td>
        <td>${inputData(p, 'fim', p.promocao_fim)}</td>
        <td class="meio">${htmlModo(p)}</td>
      </tr>`;
    }).join('');
    return `<div class="co-tabela-wrap"><table class="co-tabela">
      <colgroup>
        <col class="c-sel" /><col class="c-foto" /><col class="c-cod" /><col class="c-nome" />
        <col class="c-est" /><col class="c-preco" /><col class="c-preco" /><col class="c-data" /><col class="c-data" /><col class="c-modo" />
      </colgroup>
      <thead><tr>
        <th class="meio"><input type="checkbox" id="co-todos" ${todos ? 'checked' : ''} title="Marcar os visíveis" /></th>
        <th class="meio">Foto</th><th>Cód.</th><th>Produto</th><th class="num">Estoque</th>
        <th class="num">Preço</th><th class="num">Preço promo</th><th>Início</th><th>Fim</th><th class="meio">Modo</th>
      </tr></thead>
      <tbody>${linhas || '<tr><td colspan="10" class="co-vazio">Nenhum produto com esses filtros.</td></tr>'}</tbody>
    </table></div>`;
  }

  function lerFormulario() {
    const c = estado.config;
    if (aba === 'publicacao') {
      c.publicacao = {
        posts_por_dia: Number(campo('co-posts').value),
        intervalo_minutos: Number(campo('co-intervalo').value),
        hora_inicio: campo('co-ini').value,
        hora_fim: campo('co-fim').value,
        dias_semana: [...document.querySelectorAll('[data-co-dia]:checked')].map((el) => Number(el.dataset.coDia)),
      };
    } else if (aba === 'fds') {
      c.fim_de_semana = {
        ativo: campo('co-fds').checked,
        quantidade_por_dia: Number(campo('co-fds-qtd').value),
        tipos: [...document.querySelectorAll('[data-co-tipo]:checked')].map((el) => el.dataset.coTipo),
        encarte_sabado_manha: campo('co-encarte').checked,
      };
    } else if (aba === 'detalhes') {
      c.detalhes_item = {
        ativo: campo('co-det-on').checked,
        campo_origem: campo('co-det-campo').value,
        onde: campo('co-det-onde').value,
        limite_banner: Number(campo('co-det-limite').value),
      };
    } else if (aba === 'regra') {
      c.estoque = {
        exigir_estoque_positivo: campo('co-exigir').checked,
        estoque_minimo_anuncio: Number(campo('co-minimo').value),
      };
    }
  }

  async function salvar() {
    lerFormulario();
    const r = await api('/central-ofertas/config', { method: 'PUT', body: estado.config });
    if (!r.ok) return showMsg(r.error || 'Falha ao salvar.');
    estado.config = r.config;
    estado.janela = r.janela;
    desenhar();
    if (r.janela && r.janela.cabe === false) showMsg(r.janela.aviso);
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
        if (aba === 'lista') carregarLista();
        if (aba === 'ofertas') carregarOfertas();
      });
    });
    campo('co-salvar')?.addEventListener('click', salvar);
    campo('co-exigir')?.addEventListener('change', () => {
      const min = campo('co-minimo');
      if (min) min.disabled = !campo('co-exigir').checked;
    });
    if (aba === 'lista') ligarArquivo();
  }

  function pintar() {
    const miolo = document.getElementById('co-miolo');
    if (!miolo) return;
    const lista = visiveis();
    miolo.innerHTML = htmlTabela(lista);
    const todos = campo('co-todos');
    if (todos) {
      const marcados = lista.filter((p) => p.selecionado).length;
      todos.indeterminate = marcados > 0 && marcados < lista.length;
    }
    const resumo = document.getElementById('co-resumo');
    const extra = document.getElementById('co-extra');
    const sel = lista.filter((p) => p.selecionado);
    const emOferta = sel.filter((p) => modoAtual(p) === 'oferta').length;
    const exposicoes = sel.filter((p) => modoAtual(p) === 'exposicao').length;
    if (resumo) {
      const n = sel.length;
      resumo.textContent = `${n} selecionado${n === 1 ? '' : 's'} · ${emOferta} em oferta · ${exposicoes} em exposição`;
    }
    if (extra) {
      const partes = [`${lista.length} produto${lista.length === 1 ? '' : 's'}`];
      if (filtros.com) partes.push('com estoque');
      if (filtros.promo) partes.push('com promoção no ERP');
      if (filtros.menos) partes.push('menos vendidos primeiro');
      if (!podePreco) partes.push('preço bloqueado para este usuário');
      extra.textContent = partes.join(' · ');
    }
  }

  async function salvarSelecao(ids, selecionado) {
    if (!ids.length) return;
    const r = await api('/central-ofertas/selecao', { method: 'POST', body: { ids, selecionado } });
    if (!r.ok) return showMsg(r.error || 'Falha ao salvar a seleção.');
    const set = new Set(ids.map(String));
    produtos = produtos.map((p) => (set.has(String(p.id)) ? { ...p, selecionado } : p));
    pintar();
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

  function noEvento(ev) {
    if (!raiz()?.contains(ev.target)) return;
    if (ev.type === 'click') clique(ev);
    if (ev.type === 'change') mudou(ev);
    if (ev.type === 'focusout') saiu(ev);
  }

  async function clique(ev) {
    if (aba === 'ofertas') {
      const item = ev.target.closest('[data-co-oferta]');
      if (item) {
        ofertaAberta = item.dataset.coOferta;
        desenhar();
        return;
      }
      if (ev.target.id === 'co-of-nova') {
        ofertaAberta = '';
        desenhar();
        return;
      }
      if (ev.target.id === 'co-of-criar') await criarOferta();
      if (ev.target.id === 'co-of-incluir') await incluirNaOferta();
      if (ev.target.id === 'co-of-rotina') await gerarRotina();
      return;
    }
    if (aba !== 'lista') return;
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
    pintar();
    await carregarLista();
  }

  async function mudou(ev) {
    const t = ev.target;
    if (!raiz()?.contains(t) || aba !== 'lista') return;
    if (t.id === 'co-todos') {
      await salvarSelecao(visiveis().map((p) => p.id), t.checked);
      return;
    }
    if (t.dataset.coSel) await salvarSelecao([t.dataset.coSel], t.checked);
    if (t.dataset.coModo) await salvarModo(t.dataset.coModo, t.value);
  }

  function saiu(ev) {
    if (aba !== 'lista') return;
    const origem = ev.target.closest?.('tr');
    if (!origem?.dataset.coId || !raiz()?.contains(origem)) return;
    if (ev.target?.dataset?.coModo) return;
    if (ev.relatedTarget && origem.contains(ev.relatedTarget)) return;
    salvarCampos(origem.dataset.coId);
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
    const miolo = document.getElementById('co-miolo');
    const extra = document.getElementById('co-extra');
    if (extra) extra.textContent = 'Carregando produtos…';
    else if (miolo && !produtos.length) miolo.innerHTML = '<p class="hint">Carregando produtos…</p>';
    const r = await api(`/central-ofertas/produtos${queryLista()}`);
    if (!r.ok) {
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

  function ofertaAtual() {
    return ofertas.find((o) => o.id === ofertaAberta) || null;
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

  function htmlOfertas() {
    const aberta = ofertaAtual();
    const linhas = ofertas.map((o) => `<button type="button" class="co-oferta-item${o.id === ofertaAberta ? ' is-on' : ''}" data-co-oferta="${esc(o.id)}">
      <strong>${esc(o.nome)}</strong>
      <span>${esc(o.inicio)} a ${esc(o.fim)} · ${(o.produtos || []).length} produto${(o.produtos || []).length === 1 ? '' : 's'}</span>
    </button>`).join('');
    const detalhe = aberta ? htmlOfertaAberta(aberta) : `<section class="co-oferta-nova">
      <h3>Nova oferta</h3>
      <div class="co-grade co-grade-2">
        <label class="co-oferta-nome">Nome<input id="co-of-nome" maxlength="80" placeholder="Semana do Yu-Gi-Oh" /></label>
        <label>Início<input id="co-of-ini" type="date" value="${isoHoje(0)}" /></label>
        <label>Fim<input id="co-of-fim" type="date" value="${isoHoje(6)}" /></label>
      </div>
      <p class="hint">Os produtos marcados na aba Estoque entram nesta oferta.</p>
      <button type="button" class="btn primary" id="co-of-criar">Criar oferta</button>
    </section>`;
    return `<div class="co-ofertas">
      <div class="co-oferta-lista">${linhas || '<p class="hint">Nenhuma oferta criada.</p>'}</div>
      ${detalhe}
    </div>`;
  }

  function htmlOfertaAberta(o) {
    const produtosHtml = (o.produtos || []).map((p) => `<li><span>${esc(p.descricao || p.id)}</span>${o.usar_detalhes && p.detalhe ? `<small>${esc(p.detalhe)}</small>` : ''}</li>`).join('');
    const rotina = (o.rotina || []).map((item) => `<li><span>${esc(item.data)} ${esc(item.hora)}</span><span>${esc(item.descricao || item.produto_id)}</span>${item.detalhe ? `<small>${esc(item.detalhe)}</small>` : ''}</li>`).join('');
    return `<section class="co-oferta-nova">
      <h3>${esc(o.nome)}</h3>
      <p class="hint">${esc(o.inicio)} a ${esc(o.fim)}. ${o.usar_detalhes ? 'Os detalhes entram na rotina quando a opção da aba Detalhes do item está marcada.' : 'Esta oferta não usa detalhes.'}</p>
      <h4>Produtos</h4>
      <ul class="co-oferta-itens">${produtosHtml || '<li><span>Nenhum produto nesta oferta.</span></li>'}</ul>
      <div class="co-oferta-acoes">
        <button type="button" class="btn" id="co-of-incluir">Incluir marcados no estoque</button>
        <button type="button" class="btn primary" id="co-of-rotina">Gerar rotina de postagem</button>
        <button type="button" class="btn" id="co-of-nova">Nova oferta</button>
      </div>
      ${o.aviso ? `<p class="erro">${esc(o.aviso)}</p>` : ''}
      <h4>Rotina</h4>
      <ul class="co-oferta-rotina">${rotina || '<li><span>A rotina ainda não foi gerada.</span></li>'}</ul>
    </section>`;
  }

  function marcados() {
    return produtos.filter((p) => p.selecionado).map(itemOferta);
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
        produtos: marcados(),
      },
    });
    if (!r.ok) return showMsg(r.error || 'Falha ao criar a oferta.');
    ofertaAberta = r.oferta.id;
    await carregarOfertas();
  }

  async function incluirNaOferta() {
    const o = ofertaAtual();
    if (!o) return;
    const lista = marcados();
    if (!lista.length) return showMsg('Marque os produtos na aba Estoque.');
    const r = await api(`/central-ofertas/ofertas/${encodeURIComponent(o.id)}/produtos`, {
      method: 'POST',
      body: { produtos: lista },
    });
    if (!r.ok) return showMsg(r.error || 'Falha ao incluir os produtos.');
    await carregarOfertas();
  }

  async function gerarRotina() {
    const o = ofertaAtual();
    if (!o) return;
    const r = await api(`/central-ofertas/ofertas/${encodeURIComponent(o.id)}/rotina`, { method: 'POST', body: {} });
    if (!r.ok) return showMsg(r.error || 'Falha ao gerar a rotina.');
    if (r.aviso) showMsg(r.aviso);
    await carregarOfertas();
  }

  async function carregarOfertas() {
    const r = await api('/central-ofertas/ofertas');
    if (!r.ok) return showMsg(r.error || 'Falha ao ler as ofertas.');
    ofertas = r.ofertas || [];
    if (ofertaAberta && !ofertas.some((o) => o.id === ofertaAberta)) ofertaAberta = '';
    if (aba === 'ofertas') desenhar();
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
    desenhar();
    if (aba === 'lista') carregarLista();
    if (aba === 'ofertas') carregarOfertas();
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
