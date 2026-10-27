'use strict';

(function () {
  const ABAS = [
    ['publicacao', 'Publicação'],
    ['fds', 'Fim de semana'],
    ['detalhes', 'Detalhes do item'],
    ['estoque', 'Estoque'],
    ['instagram', 'Conta Instagram'],
    ['usuarios', 'Usuários'],
    ['produtos', 'Produtos'],
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
  let aba = 'publicacao';

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
    if (aba === 'estoque') {
      const e = c.estoque;
      return `<label class="co-check"><input id="co-exigir" type="checkbox" ${e.exigir_estoque_positivo ? 'checked' : ''} /> Exigir estoque positivo para anunciar</label>
        <label>Estoque mínimo do anúncio<input id="co-minimo" type="number" min="0" max="999999" value="${e.estoque_minimo_anuncio}" ${e.exigir_estoque_positivo ? '' : 'disabled'} /></label>
        <p class="hint">Desmarcado, o saldo não bloqueia seleção, agenda, validação nem encarte. A coluna de estoque continua só como informação. Itens de produção própria podem ignorar o estoque mesmo com a opção marcada.</p>
        <button type="button" class="btn primary" id="co-salvar">Salvar</button>`;
    }
    if (aba === 'instagram') {
      const ig = estado.instagram || {};
      const modo = estado.modos?.instagram || 'simulado';
      return `<p>Status: <strong>${esc(ig.status || 'desconectada')}</strong></p>
        <p class="hint">${ig.usuario ? `Conta ${esc(ig.usuario)}.` : 'Nenhuma conta profissional conectada.'} ${ig.token_expira_em ? `Token até ${esc(ig.token_expira_em)}.` : ''}</p>
        <p class="hint">Modo do conector: ${esc(modo)}. ${modo === 'simulado' ? 'A conexão real com a Meta fica para a fase de publicação.' : 'Aguardando o token da Meta no servidor.'}</p>`;
    }
    if (aba === 'usuarios') {
      const linhas = (estado.equipe || []).map((u) => `<label class="co-user"><span>${esc(u.nome)}${u.supervisor ? ' (supervisor)' : ''}</span>
        <select data-co-user="${u.id}" ${u.supervisor ? 'disabled' : ''}>
          <option value="agenda" ${u.papel !== 'preco' ? 'selected' : ''}>Só agenda</option>
          <option value="preco" ${u.papel === 'preco' ? 'selected' : ''}>Pode alterar preço</option>
        </select></label>`).join('');
      return `<div class="co-lista">${linhas || '<p class="empty">Nenhum funcionário carregado.</p>'}</div>
        <p class="hint">Quem só agenda não muda preço. A gravação do preço no ERP entra com a fila.</p>
        <button type="button" class="btn primary" id="co-salvar">Salvar</button>`;
    }
    return `<div class="co-busca"><input id="co-q" type="search" placeholder="Nome, código ou EAN" /></div>
      <p class="hint" id="co-estoque-info"></p>
      <div id="co-produtos" class="co-lista"></div>`;
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
    } else if (aba === 'estoque') {
      c.estoque = {
        exigir_estoque_positivo: campo('co-exigir').checked,
        estoque_minimo_anuncio: Number(campo('co-minimo').value),
      };
    } else if (aba === 'usuarios') {
      c.usuarios = [...document.querySelectorAll('[data-co-user]')].map((el) => ({
        id: Number(el.dataset.coUser),
        papel: el.value,
      }));
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
        if (aba === 'produtos') carregarProdutos();
      });
    });
    campo('co-salvar')?.addEventListener('click', salvar);
    campo('co-exigir')?.addEventListener('change', () => {
      const min = campo('co-minimo');
      if (min) min.disabled = !campo('co-exigir').checked;
    });
    campo('co-q')?.addEventListener('input', () => carregarProdutos());
  }

  async function carregarProdutos() {
    const box = document.getElementById('co-produtos');
    if (!box) return;
    const q = campo('co-q')?.value || '';
    const r = await api(`/central-ofertas/produtos?q=${encodeURIComponent(q)}`);
    if (!r.ok) {
      box.innerHTML = `<p class="erro">${esc(r.error || 'Falha ao ler os produtos.')}</p>`;
      return;
    }
    const info = document.getElementById('co-estoque-info');
    if (info) {
      info.textContent = r.exigir_estoque_positivo
        ? 'Estoque positivo exigido: itens abaixo do mínimo ficam bloqueados, salvo produção própria.'
        : 'Estoque não bloqueia o anúncio. A quantidade abaixo é só informação.';
    }
    box.innerHTML = (r.produtos || []).map((p) => {
      const bloqueado = p.exposicao?.ok === false;
      return `<article class="co-item">
        <strong>${esc(p.descricao)}</strong>
        <span>${esc(p.codigo)} ${p.ean ? `· EAN ${esc(p.ean)}` : '· sem EAN'} ${p.foto ? '' : '· sem foto'}</span>
        <span>De ${moeda(p.preco)}${p.promocao_valida ? ` · Por ${moeda(p.preco_promocional)} (${p.desconto}%)` : ''}</span>
        <span>Estoque ${p.estoque}</span>
        <span class="${bloqueado ? 'erro' : 'hint'}">${bloqueado ? esc(p.exposicao.motivo) : (p.oferta?.ok ? 'Pode ir como oferta ou exposição.' : 'Pode ir como exposição. Oferta: ' + esc(p.oferta?.motivo || ''))}</span>
        <label class="co-check"><input type="checkbox" data-co-ignorar="${esc(p.id)}" ${p.ignorar_estoque ? 'checked' : ''} /> Ignorar estoque neste produto</label>
      </article>`;
    }).join('') || '<p class="empty">Nenhum produto.</p>';
    box.querySelectorAll('[data-co-ignorar]').forEach((el) => {
      el.addEventListener('change', async () => {
        const resp = await api(`/central-ofertas/produtos/${encodeURIComponent(el.dataset.coIgnorar)}`, {
          method: 'PUT',
          body: { ignorar_estoque: el.checked },
        });
        if (!resp.ok) showMsg(resp.error || 'Falha ao salvar o produto.');
        else carregarProdutos();
      });
    });
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
    if (aba === 'produtos') carregarProdutos();
  }

  function init(deps) {
    api = deps.api || api;
    showMsg = deps.showMsg || showMsg;
    esc = deps.escapeHtml || esc;
  }

  window.CentralOfertas = { init, onPageEnter };
})();
