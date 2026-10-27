'use strict';

(function () {
  const ABAS = [
    ['lista', 'Estoque'],
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
  let podePreco = false;
  let buscaTimer = 0;
  const filtros = { q: '', grupo: '', com: false, menos: false, promo: false };
  const MODO = {
    oferta: 'Oferta',
    exposicao: 'Exposição',
    sem_estoque: 'Sem estoque',
    nenhum: '—',
  };

  function raiz() {
    return document.getElementById('co-raiz');
  }

  function campo(id) {
    return document.getElementById(id);
  }

  function moeda(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function htmlAbas() {
    return `<div class="tabs" id="co-abas">${ABAS.map(([id, nome]) =>
      `<button type="button" class="tab${id === aba ? ' active' : ''}" data-co-aba="${id}">${nome}</button>`
    ).join('')}</div><div id="co-painel"></div>`;
  }

  function checado(lista, valor) {
    return (lista || []).map(Number).includes(Number(valor)) ? 'checked' : '';
  }

  function painel() {
    const c = estado.config;
    const janela = estado.janela || {};
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
      const campos = estado.campos_texto || [];
      return `<label class="co-check"><input id="co-det-on" type="checkbox" ${d.ativo ? 'checked' : ''} /> Mostrar um detalhe do produto</label>
        <label>Campo de origem no ERP<select id="co-det-campo">${[''].concat(campos).map((nome) => `<option value="${esc(nome)}" ${nome === d.campo_origem ? 'selected' : ''}>${nome || 'Nenhum'}</option>`).join('')}</select></label>
        <label>Onde aparece<select id="co-det-onde">
          <option value="banner" ${d.onde === 'banner' ? 'selected' : ''}>Banner</option>
          <option value="legenda" ${d.onde === 'legenda' ? 'selected' : ''}>Legenda</option>
          <option value="ambos" ${d.onde === 'ambos' ? 'selected' : ''}>Banner e legenda</option>
        </select></label>
        <label>Limite no banner<input id="co-det-limite" type="number" min="10" max="120" value="${d.limite_banner}" /></label>
        <p class="hint">Pode ser sobrescrito por produto na montagem, na fase seguinte.</p>
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
      <div class="co-barra">
        <label class="co-busca">Buscar<input id="co-q" type="search" placeholder="Nome, código ou EAN" value="${esc(filtros.q)}" /></label>
        <label class="co-grupo">Grupo<select id="co-grupo">${opcoes}</select></label>
      </div>
      <div class="co-atalhos" role="group" aria-label="Filtros">
        ${atalho('com', 'Com estoque')}
        ${atalho('menos', 'Menos vendidos')}
        ${atalho('promo', 'Promoção no ERP')}
      </div>
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

  function visiveis() {
    const q = filtros.q.trim().toLowerCase();
    let lista = produtos.filter((p) => {
      if (q && ![p.descricao, p.codigo, p.ean].some((v) => String(v || '').toLowerCase().includes(q))) return false;
      if (filtros.grupo && p.categoria !== filtros.grupo) return false;
      if (filtros.com && !(Number(p.estoque) > 0 || p.ignorar_estoque)) return false;
      if (filtros.promo && !p.promocao_valida) return false;
      return true;
    });
    if (filtros.menos) {
      lista = lista.slice().sort((a, b) => (Number(a.vendido_30d) || 0) - (Number(b.vendido_30d) || 0)
        || String(a.descricao).localeCompare(String(b.descricao), 'pt'));
    }
    return lista;
  }

  function modoLocal(p) {
    if (p.exposicao?.ok === false) return 'sem_estoque';
    if (!p.selecionado) return 'nenhum';
    return p.oferta?.ok ? 'oferta' : 'exposicao';
  }

  function inputMoeda(p, nome, valor) {
    const dis = podePreco ? '' : 'disabled';
    return `<input class="co-moeda" type="text" inputmode="decimal" autocomplete="off" data-co-campo="${nome}" data-co-id="${esc(p.id)}" value="${esc(moedaInput(valor))}" ${dis} />`;
  }

  function inputData(p, nome, valor) {
    const dis = podePreco ? '' : 'disabled';
    return `<input class="co-data" type="date" data-co-campo="${nome}" data-co-id="${esc(p.id)}" value="${esc(valor || '')}" ${dis} />`;
  }

  function metaProduto(p) {
    const partes = [p.codigo ? `Cód. ${p.codigo}` : '', p.ean ? `EAN ${p.ean}` : 'Sem EAN', p.categoria || ''];
    return partes.filter(Boolean).join(' · ');
  }

  function htmlLinhas(lista) {
    const todos = lista.length > 0 && lista.every((p) => p.selecionado);
    const cabeca = `<div class="co-lista-topo">
      <label class="co-marcar"><input type="checkbox" id="co-todos" ${todos ? 'checked' : ''} /><span>Marcar os visíveis</span></label>
      <span>${lista.length} produto${lista.length === 1 ? '' : 's'}</span>
    </div>`;
    if (!lista.length) return `<div class="co-lista-caixa">${cabeca}<p class="co-vazio">Nenhum produto com esses filtros.</p></div>`;
    const linhas = lista.map((p) => {
      const modo = p.modo || 'nenhum';
      const qtdCls = Number(p.estoque) < 0 ? ' is-neg' : '';
      const titulo = p.oferta?.ok ? '' : (p.oferta?.motivo || p.exposicao?.motivo || '');
      const selo = modo === 'nenhum' ? '' : `<span class="co-pill ${modo}" title="${esc(titulo)}">${MODO[modo]}</span>`;
      return `<article class="co-linha${p.selecionado ? ' is-on' : ''}" data-co-id="${esc(p.id)}">
        <div class="co-linha-topo">
          <label class="co-check-linha">
            <input type="checkbox" data-co-sel="${esc(p.id)}" ${p.selecionado ? 'checked' : ''} />
            <span class="co-ident">
              <span class="co-nome">${esc(p.descricao)}</span>
              <span class="co-sub">${esc(metaProduto(p))}${metaProduto(p) ? ' · ' : ''}<span class="co-estoque${qtdCls}">${esc(qtdTxt(p.estoque))}</span></span>
            </span>
          </label>
          ${selo}
        </div>
        <div class="co-campos">
          <label>Preço${inputMoeda(p, 'preco', p.preco)}</label>
          <label>Promoção${inputMoeda(p, 'promo', p.preco_promocional)}</label>
          <label>Início${inputData(p, 'inicio', p.promocao_inicio)}</label>
          <label>Fim${inputData(p, 'fim', p.promocao_fim)}</label>
        </div>
      </article>`;
    }).join('');
    return `<div class="co-lista-caixa">${cabeca}<div class="co-linhas">${linhas}</div></div>`;
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
    if (Array.isArray(r.config.usuarios) && estado.equipe) {
      const papeis = new Map(r.config.usuarios.map((u) => [Number(u.id), u.papel]));
      estado.equipe = estado.equipe.map((u) => ({
        ...u,
        papel: u.supervisor ? 'preco' : (papeis.get(Number(u.id)) || 'agenda'),
      }));
    }
    desenhar();
    if (r.janela && r.janela.cabe === false) showMsg(r.janela.aviso);
  }

  function desenhar() {
    const el = raiz();
    if (!el || !estado) return;
    el.innerHTML = htmlAbas() + '';
    const painelEl = document.getElementById('co-painel');
    if (painelEl) painelEl.innerHTML = painel();
    el.querySelectorAll('[data-co-aba]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (campo('co-salvar')) lerFormulario();
        aba = btn.dataset.coAba;
        desenhar();
        if (aba === 'lista') carregarLista();
      });
    });
    campo('co-salvar')?.addEventListener('click', salvar);
    campo('co-exigir')?.addEventListener('change', () => {
      const min = campo('co-minimo');
      if (min) min.disabled = !campo('co-exigir').checked;
    });
    if (aba === 'lista') ligarLista(el);
  }

  function pintar() {
    const miolo = document.getElementById('co-miolo');
    if (!miolo) return;
    const lista = visiveis();
    miolo.innerHTML = htmlLinhas(lista);
    const todos = campo('co-todos');
    if (todos) {
      const marcados = lista.filter((p) => p.selecionado).length;
      todos.indeterminate = marcados > 0 && marcados < lista.length;
    }
    const resumo = document.getElementById('co-resumo');
    const extra = document.getElementById('co-extra');
    const sel = lista.filter((p) => p.selecionado);
    const ofertas = sel.filter((p) => (p.modo || modoLocal(p)) === 'oferta').length;
    const exposicoes = sel.filter((p) => (p.modo || modoLocal(p)) === 'exposicao').length;
    if (resumo) {
      const n = sel.length;
      resumo.textContent = `${n} selecionado${n === 1 ? '' : 's'} · ${ofertas} em oferta · ${exposicoes} em exposição`;
    }
    if (extra) {
      const partes = [];
      if (!podePreco) partes.push('Preço e promoção bloqueados para este usuário.');
      if (produtos.length && lista.length !== produtos.length) partes.push(`${lista.length} de ${produtos.length}`);
      extra.textContent = partes.join(' · ');
    }
  }

  async function salvarSelecao(ids, selecionado) {
    if (!ids.length) return;
    const r = await api('/central-ofertas/selecao', { method: 'POST', body: { ids, selecionado } });
    if (!r.ok) return showMsg(r.error || 'Falha ao salvar a seleção.');
    const set = new Set(ids.map(String));
    produtos = produtos.map((p) => {
      if (!set.has(String(p.id))) return p;
      const prox = { ...p, selecionado };
      prox.modo = modoLocal(prox);
      return prox;
    });
    pintar();
  }

  async function salvarCampos(id) {
    if (!podePreco) return;
    const linha = raiz()?.querySelector(`.co-linha[data-co-id="${CSS.escape(String(id))}"]`);
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

  function ligarLista(el) {
    campo('co-q')?.addEventListener('input', () => {
      filtros.q = campo('co-q').value;
      clearTimeout(buscaTimer);
      buscaTimer = setTimeout(() => carregarLista(), 280);
    });
    campo('co-grupo')?.addEventListener('change', () => {
      filtros.grupo = campo('co-grupo').value;
      carregarLista();
    });
    el.addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-co-filtro]');
      if (!b) return;
      const k = b.dataset.coFiltro;
      filtros[k] = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', filtros[k] ? 'true' : 'false');
      await carregarLista();
    });
    el.addEventListener('change', async (ev) => {
      const t = ev.target;
      if (t.id === 'co-todos') {
        await salvarSelecao(visiveis().map((p) => p.id), t.checked);
        return;
      }
      if (t.dataset.coSel) await salvarSelecao([t.dataset.coSel], t.checked);
    });
    el.addEventListener('focusout', (ev) => {
      const origem = ev.target.closest?.('.co-linha');
      if (!origem?.dataset.coId) return;
      if (ev.relatedTarget && origem.contains(ev.relatedTarget)) return;
      salvarCampos(origem.dataset.coId);
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
    if (miolo && !produtos.length) miolo.innerHTML = '<p class="hint">Carregando produtos…</p>';
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
  }

  function init(deps) {
    api = deps.api || api;
    showMsg = deps.showMsg || showMsg;
    esc = deps.escapeHtml || esc;
  }

  window.CentralOfertas = { init, onPageEnter };
})();
