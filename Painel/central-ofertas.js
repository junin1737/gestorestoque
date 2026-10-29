'use strict';

(function () {
  const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  let api = async () => ({ ok: false });
  let showMsg = (t) => window.alert(t);
  let esc = (v) => String(v ?? '');
  let estado = null;
  let produtos = [];
  let grupos = [];
  let ofertas = [];
  let ofertaAberta = '';
  let podePreco = false;
  let criando = false;
  let diaAberto = '';
  let postando = false;
  let assinatura = '';
  let relogio = null;
  const hojeData = new Date();
  let calAno = hojeData.getFullYear();
  let calMes = hojeData.getMonth();
  let buscaTimer = 0;
  let buscaSeq = 0;
  let fotoAlvo = '';
  let sugestoes = [];
  let escolhaId = '';
  let gruposProntos = false;
  let gravacao = 0;
  let dedoRemocao = '';
  const fechados = new Set();
  const emRemocao = new Set();
  const filtros = { q: '', grupo: '', com: false, menos: false, promo: false };

  function raiz() { return document.getElementById('co-raiz'); }
  function campo(id) { return document.getElementById(id); }

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
    if (ofertaAtual()) return htmlOfertaAberta(ofertaAtual());
    return htmlCalendario();
  }

  function detalhesOferta(o) {
    const base = estado?.config?.detalhes_item || {};
    const d = o?.detalhes || {};
    return {
      ativo: o?.usar_detalhes !== false,
      campo_origem: d.campo_origem || base.campo_origem || campoPadrao(),
      onde: d.onde || base.onde || 'legenda',
      limite_banner: d.limite_banner || base.limite_banner || 40,
    };
  }

  function htmlDetalhesOferta(o) {
    const d = detalhesOferta(o);
    const campos = camposOrigem();
    return `<div class="co-detalhes">
      <label class="co-check"><input id="co-det-on" type="checkbox" ${d.ativo ? 'checked' : ''} /> Usar os detalhes do item</label>
      <label>Origem<select id="co-det-campo">${campos.map((item) => `<option value="${esc(item.coluna)}" ${item.coluna === d.campo_origem ? 'selected' : ''}>${esc(item.rotulo)}</option>`).join('')}</select></label>
      <label>Onde<select id="co-det-onde">
        <option value="banner" ${d.onde === 'banner' ? 'selected' : ''}>Banner</option>
        <option value="legenda" ${d.onde === 'legenda' ? 'selected' : ''}>Legenda</option>
        <option value="ambos" ${d.onde === 'ambos' ? 'selected' : ''}>Os dois</option>
      </select></label>
      <label>Limite<input id="co-det-limite" class="co-curto" type="number" min="10" max="120" value="${esc(d.limite_banner)}" /></label>
    </div>`;
  }

  function ofertaAtual() {
    return ofertas.find((o) => o.id === ofertaAberta) || null;
  }

  function idsNaOferta() {
    return new Set((ofertaAtual()?.produtos || []).map((p) => String(p.id)));
  }

  function isoDia(data) {
    return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
  }

  function ofertaLigada(o) {
    return o?.ativa !== false;
  }

  function ativaNoDia(o, dia) {
    return ofertaLigada(o) && o.inicio && o.fim && o.inicio <= dia && o.fim >= dia;
  }

  function postsNoDia(dia) {
    const lista = [];
    for (const o of ofertas) {
      if (!ofertaLigada(o)) continue;
      for (const slot of o.rotina || []) {
        if (slot.data === dia) lista.push({ ...slot, oferta_id: o.id, oferta: o.nome });
      }
    }
    return lista.sort((a, b) => String(a.hora).localeCompare(String(b.hora)) || String(a.oferta).localeCompare(String(b.oferta), 'pt'));
  }

  function htmlCalendario() {
    const primeiro = new Date(calAno, calMes, 1);
    const ultimoDia = new Date(calAno, calMes + 1, 0).getDate();
    const hoje = isoHoje(0);
    const casas = [];
    for (let i = 0; i < primeiro.getDay(); i += 1) casas.push('');
    for (let dia = 1; dia <= ultimoDia; dia += 1) casas.push(isoDia(new Date(calAno, calMes, dia)));
    while (casas.length % 7) casas.push('');
    const grade = casas.map((dia) => {
      if (!dia) return '<div class="co-cal-vazio"></div>';
      const posts = postsNoDia(dia);
      const ofertasDia = ofertas.filter((o) => ativaNoDia(o, dia));
      const itens = posts.slice(0, 3).map((p) => `<span class="co-cal-post${p.publicado ? ' is-feito' : ''}">${esc(String(p.hora || '').slice(0, 5))}</span>`).join('');
      const extra = posts.length > 3 ? `<span class="co-cal-mais">+${posts.length - 3}</span>` : '';
      const sem = !posts.length && ofertasDia.length ? `<span class="co-cal-post">${ofertasDia.length} oferta${ofertasDia.length === 1 ? '' : 's'}</span>` : '';
      return `<button type="button" class="co-cal-dia${dia === hoje ? ' is-hoje' : ''}${dia === diaAberto ? ' is-on' : ''}" data-co-dia-cal="${dia}">
        <strong>${Number(dia.slice(8))}</strong>
        ${itens}${extra}${sem}
      </button>`;
    }).join('');
    const painelDia = htmlDia(diaAberto);
    const itemOfertaLista = (o) => {
      const prox = ofertaLigada(o) ? (o.rotina || []).find((s) => !s.publicado) : null;
      return `<button type="button" class="co-oferta-item${ofertaLigada(o) ? '' : ' is-inativa'}" data-co-oferta="${esc(o.id)}">
        <strong>${esc(o.nome)}</strong>
        <span>${ofertaLigada(o) ? 'Ativa' : 'Inativa'} · ${esc(o.inicio)} a ${esc(o.fim)}${prox ? ` · próxima ${esc(prox.data)} ${esc(prox.hora)}` : ''}</span>
      </button>`;
    };
    const noPeriodo = ofertas.filter((o) => o.fim >= hoje);
    const ativas = noPeriodo.filter(ofertaLigada).map(itemOfertaLista).join('');
    const inativas = noPeriodo.filter((o) => !ofertaLigada(o)).map(itemOfertaLista).join('');
    return `<div class="co-cal-head">
        <button type="button" class="btn small" data-co-mes="-1" aria-label="Mês anterior">‹</button>
        <h3>${esc(MESES[calMes])} ${calAno}</h3>
        <button type="button" class="btn small" data-co-mes="1" aria-label="Próximo mês">›</button>
        <button type="button" class="btn primary" id="co-nova">Nova oferta</button>
      </div>
      <div class="co-cal-semana">${DIAS.map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="co-cal">${grade}</div>
      ${painelDia}
      <div class="co-cal-baixo">
        ${htmlProximas()}
        ${htmlBanner()}
      </div>
      <h4>Ofertas ativas</h4>
      <div class="co-oferta-lista">${ativas || '<p class="hint">Nenhuma oferta em andamento.</p>'}</div>
      <h4>Ofertas inativas</h4>
      <div class="co-oferta-lista">${inativas || '<p class="hint">Nenhuma oferta inativa neste período.</p>'}</div>`;
  }

  function proximasPostagens() {
    const hoje = isoHoje(0);
    const limite = isoHoje(-7);
    const lista = [];
    for (const o of ofertas) {
      if (!ofertaLigada(o)) continue;
      for (const slot of o.rotina || []) {
        if (slot.publicado || !slot.data || !slot.hora) continue;
        if (slot.data < limite) continue;
        lista.push({
          oferta_id: o.id,
          oferta: o.nome,
          descricao: slot.descricao || '',
          hora: String(slot.hora).slice(0, 5),
          data: slot.data,
          diaCurto: slot.data.split('-').reverse().slice(0, 2).join('/'),
          atrasada: slot.data < hoje,
        });
      }
    }
    lista.sort((a, b) => a.data.localeCompare(b.data) || a.hora.localeCompare(b.hora) || String(a.oferta).localeCompare(String(b.oferta), 'pt'));
    return lista.slice(0, 8);
  }

  function htmlProximas() {
    const itens = proximasPostagens();
    const linhas = itens.map((p) => `<li><button type="button" data-co-oferta="${esc(p.oferta_id)}">
        <span class="co-prox-hora">${esc(p.hora)}</span>
        <span class="co-prox-dia">${esc(p.diaCurto)}</span>
        <span class="co-prox-txt"><strong>${esc(p.descricao || p.oferta)}</strong><small>${esc(p.oferta)}${p.atrasada ? ' · atrasada' : ''}</small></span>
      </button></li>`).join('');
    return `<section class="co-card"><h3>Próximas postagens</h3>${linhas
      ? `<ul class="co-proximas">${linhas}</ul>`
      : '<p class="hint">Gere a rotina na campanha para ver os horários.</p>'}</section>`;
  }

  function bannerAtual() {
    const b = estado?.config?.banner || {};
    const n = (v, fb) => (Number.isFinite(Number(v)) ? Number(v) : fb);
    return {
      url: /^https:\/\//.test(String(b.url || '')) ? String(b.url) : '',
      x: n(b.x, 28),
      y: n(b.y, 16),
      w: n(b.w, 44),
      h: n(b.h, 52),
    };
  }

  function htmlBanner() {
    const b = bannerAtual();
    const palco = b.url
      ? `<div class="co-banner-palco"><img src="${esc(b.url)}" alt="Banner padrão" /><div class="co-banner-vazio" style="left:${b.x}%;top:${b.y}%;width:${b.w}%;height:${b.h}%"><span>Foto do produto</span><i class="co-banner-alca"></i></div></div>`
      : '<div class="co-banner-vago">Nenhum banner</div>';
    return `<section class="co-card co-banner"><h3>Banner padrão</h3>
      <p class="hint">O espaço em branco recebe a foto do produto.</p>
      ${palco}
      <button type="button" class="btn" id="co-banner">Escolher banner</button>
      <input id="co-banner-arquivo" class="co-arquivo" type="file" accept="image/jpeg,image/png,image/webp" />
    </section>`;
  }

  function htmlDia(dia) {
    if (!dia) return '';
    const posts = postsNoDia(dia);
    const linhas = posts.map((p) => `<li class="${p.publicado ? 'is-feito' : ''}">
      <button type="button" data-co-oferta="${esc(p.oferta_id)}">${esc(p.hora)} · ${esc(p.oferta)}</button>
      <span>${esc(p.descricao || 'Engajamento')}${p.publicado ? ' · publicado' : ''}</span>
    </li>`).join('');
    const semRotina = ofertas.filter((o) => ativaNoDia(o, dia) && !(o.rotina || []).some((s) => s.data === dia));
    const extras = semRotina.map((o) => `<li><button type="button" data-co-oferta="${esc(o.id)}">${esc(o.nome)}</button><span>Sem horário neste dia</span></li>`).join('');
    return `<section class="co-dia-painel">
      <h4>${esc(dia.split('-').reverse().join('/'))}</h4>
      <ul class="co-oferta-rotina">${linhas || extras || '<li><span>Nenhuma oferta neste dia.</span></li>'}${linhas ? extras : ''}</ul>
    </section>`;
  }

  function cfgRotina(o) {
    const base = {
      posts_por_dia: 1, intervalo_minutos: 90, hora_inicio: '08:00', hora_fim: '20:00',
      dias_semana: [1, 2, 3, 4, 5], fds_ativo: false, fds_qtd: 1, encarte: false,
    };
    return { ...base, ...(o.rotina_cfg || {}) };
  }

  function htmlOfertaAberta(o) {
    const r = cfgRotina(o);
    const dias = diasMarcados(o, r);
    const d = detalhesOferta(o);
    const n = (o.produtos || []).length;
    const pendente = (o.rotina || []).some((item) => !item.publicado && item.produto_id);
    const ligada = ofertaLigada(o);
    return `<div class="co-oferta-head">
        <button type="button" class="btn" id="co-of-voltar"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.75"/><path d="M8 3.5v3M16 3.5v3M4 10h16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg> Calendário</button>
        <input id="co-of-nome" class="co-oferta-nome-input" maxlength="80" value="${esc(o.nome)}" aria-label="Nome da campanha" />
        <input id="co-of-ini" class="co-oferta-data" type="date" value="${esc(o.inicio)}" aria-label="Início da campanha" />
        <span class="co-oferta-datas">a</span>
        <input id="co-of-fim" class="co-oferta-data" type="date" value="${esc(o.fim)}" aria-label="Fim da campanha" />
        <div class="co-status" role="group" aria-label="Status da campanha">
          <button type="button" data-co-status="1" aria-pressed="${ligada ? 'true' : 'false'}">Ativa</button>
          <button type="button" data-co-status="0" aria-pressed="${ligada ? 'false' : 'true'}">Inativa</button>
        </div>
      </div>
      <div class="co-par">
        <section class="co-card">
          <h3>Adicionar Item</h3>
          ${htmlBusca()}
        </section>
        <section class="co-card">
          <h3>Configurações de Rotina</h3>
          <div class="co-rotina">
            <label>Posts<input id="co-r-posts" class="co-curto" type="number" min="1" max="50" value="${Number(r.posts_por_dia) || 1}" /></label>
            <label>Min<input id="co-r-int" class="co-curto" type="number" min="1" max="1440" value="${Number(r.intervalo_minutos) || 90}" /></label>
            <label>Início<input id="co-r-ini" class="co-hora" type="time" value="${esc(String(r.hora_inicio || '08:00').slice(0, 5))}" /></label>
            <label>Fim<input id="co-r-fim" class="co-hora" type="time" value="${esc(String(r.hora_fim || '20:00').slice(0, 5))}" /></label>
          </div>
          <div class="co-rotina">
            <span class="co-rotulo">Dias da Semana</span>
            <div class="co-dias-curtos">${DIAS.map((nome, i) => `<label class="co-dia" title="${nome}"><input type="checkbox" data-co-dia="${i}" ${dias.includes(i) ? 'checked' : ''} /><span>${esc(nome)}</span></label>`).join('')}</div>
            <label class="co-check"><input id="co-r-fds" type="checkbox" ${r.fds_ativo ? 'checked' : ''} /> Fds</label>
          </div>
          <div class="co-mensagem">
            <span class="co-rotulo">Modo</span>
            <div class="co-forma" id="co-forma" role="group" aria-label="Modo de postagem">
              <button type="button" data-co-forma="post" aria-pressed="${formaOferta(o) === 'post' ? 'true' : 'false'}">Postagem</button>
              <button type="button" data-co-forma="story" aria-pressed="${formaOferta(o) === 'story' ? 'true' : 'false'}">Story</button>
              <button type="button" data-co-forma="ambos" aria-pressed="${formaOferta(o) === 'ambos' ? 'true' : 'false'}">Ambos</button>
            </div>
            <span class="co-rotulo">Banner</span>
            <div class="co-forma" id="co-banner-uso" role="group" aria-label="Uso do banner">
              <button type="button" data-co-banner-uso="1" aria-pressed="${usaBanner(o) ? 'true' : 'false'}">Com banner</button>
              <button type="button" data-co-banner-uso="0" aria-pressed="${usaBanner(o) ? 'false' : 'true'}">Sem banner</button>
            </div>
            <p class="hint co-banner-dica">${usaBanner(o) ? 'A foto do produto entra no espaço do banner.' : 'A foto anexada sai inteira, como um cupom.'}</p>
            <label class="co-campo">Legenda
              <textarea id="co-legenda" maxlength="1000" rows="3">${esc(o.legenda || '')}</textarea>
            </label>
            <label class="co-campo">Link
              <input id="co-link" type="url" inputmode="url" placeholder="https://" maxlength="300" value="${esc(o.link || '')}" />
            </label>
            <p class="co-lbl">Prévia da mensagem</p>
            <pre class="co-previa" id="co-previa">${esc(previaMensagem(o))}</pre>
          </div>
          <div class="co-rotina-fim">
            <div class="co-rotina">
              <label>Qtd<input id="co-r-fds-qtd" class="co-curto" type="number" min="0" max="10" value="${Number(r.fds_qtd) || 0}" /></label>
              <label class="co-check"><input id="co-r-encarte" type="checkbox" ${r.encarte ? 'checked' : ''} /> Encarte</label>
            </div>
            <div class="co-rotina-botoes">
              <button type="button" class="btn" id="co-of-cancelar">Cancelar</button>
              <button type="button" class="btn primary" id="co-of-rotina">Gerar</button>
              <button type="button" class="btn" id="co-of-agora" ${pendente && !postando ? '' : 'disabled'}>${postando ? 'Publicando…' : 'Postar agora'}</button>
            </div>
          </div>
          <p class="hint" id="co-rotina-status">${esc(o.aviso || '')}</p>
        </section>
      </div>
      <section class="co-card">
        <div class="co-itens-head">
          <h3>Itens Adicionados na Campanha</h3>
          <label class="co-check"><input id="co-det-on" type="checkbox" ${d.ativo ? 'checked' : ''} /> Usar os detalhes do item</label>
        </div>
        ${htmlCampanha(o)}
        <p class="hint co-contagem">${n} na oferta</p>
      </section>
      <input id="co-arquivo" class="co-arquivo" type="file" accept="image/jpeg,image/png,image/webp" />`;
  }

  function atalho(id, nome) {
    return `<button type="button" class="co-atalho" data-co-filtro="${id}" aria-pressed="${filtros[id] ? 'true' : 'false'}">${nome}</button>`;
  }

  function htmlBusca() {
    const opcoes = ['<option value="">Todos</option>'].concat(grupos.map((g) =>
      `<option value="${esc(g)}" ${g === filtros.grupo ? 'selected' : ''}>${esc(g)}</option>`
    )).join('');
    return `<p class="co-lbl">Buscar</p>
      <div class="co-busca">
        <span class="co-lupa" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16"><circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" stroke-width="1.75"/><path d="M16 16l4 4" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg></span>
        <input id="co-q" type="search" placeholder="Nome, código ou EAN" value="${esc(filtros.q)}" autocomplete="off" />
        <ul id="co-sugestoes" class="co-sugestoes" hidden></ul>
      </div>
      <p class="co-lbl">Grupo</p>
      <select id="co-grupo">${opcoes}</select>
      <div class="co-filtros-linha">
        <div class="co-atalhos" role="group" aria-label="Filtros">
          ${atalho('com', 'Com estoque')}
          ${atalho('menos', 'Menos vendidos')}
          ${atalho('promo', 'Promoção no ERP')}
        </div>
        <button type="button" class="btn primary" id="co-add">+ Adicionar à Campanha</button>
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
    return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  }

  function detalheItem(p, o) {
    const base = detalhesOferta(o);
    return {
      limite: Number(p.limite_banner) || base.limite_banner,
      campo: p.campo_origem || base.campo_origem,
      onde: p.onde || base.onde,
    };
  }

  function slotDoItem(o, id) {
    const slots = (o.rotina || []).filter((s) => String(s.produto_id) === String(id));
    return slots.find((s) => !s.publicado) || slots[0] || null;
  }

  function horaDoItem(o, id) {
    const prox = slotDoItem(o, id);
    return prox?.hora ? String(prox.hora).slice(0, 5) : '';
  }

  function rotuloCurto(coluna) {
    if (coluna === 'DESC_CMPL') return 'Descrição';
    if (coluna === 'COD_BARRA') return 'Código de barras';
    if (coluna === 'ID_IDENTIFICADOR') return 'Identificador';
    const item = camposOrigem().find((c) => c.coluna === coluna);
    return item?.rotulo || coluna || 'Nenhum';
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
    const img = p.foto_url ? `<img class="co-foto-mini" src="${esc(p.foto_url)}" alt="" />` : '<span>Anexar</span>';
    return `<button type="button" class="co-foto-btn" data-co-foto="${esc(p.id)}" data-co-ean="${esc(p.ean || '')}" title="Caminho no R2: ${esc(caminho)}">${img}</button>`;
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

  function htmlMais(p, o) {
    const det = detalheItem(p, o);
    const campos = camposOrigem();
    const origem = campos.map((item) => `<option value="${esc(item.coluna)}" ${item.coluna === det.campo ? 'selected' : ''}>${esc(rotuloCurto(item.coluna))}</option>`).join('');
    const onde = (valor, nome) => `<option value="${valor}" ${det.onde === valor ? 'selected' : ''}>${nome}</option>`;
    return `<div class="co-mais">
      <label>Limite <input class="co-curto" type="number" min="10" max="120" data-co-limite="${esc(p.id)}" value="${esc(det.limite)}" /></label>
      <label>Origem <select data-co-origem="${esc(p.id)}">${origem}</select></label>
      <label>Onde <select data-co-onde="${esc(p.id)}">${onde('banner', 'Banner')}${onde('legenda', 'Legenda')}${onde('ambos', 'Os dois')}</select></label>
      <button type="button" class="btn small" data-co-tirar="${esc(p.id)}">Tirar</button>
    </div>`;
  }

  function htmlCampanha(o) {
    const linhas = (o.produtos || []).map((p) => {
      const aberto = !fechados.has(String(p.id));
      const qtdCls = Number(p.estoque) < 0 ? ' is-neg' : '';
      const hora = horaDoItem(o, p.id);
      const falha = slotDoItem(o, p.id);
      const erro = falha && !falha.publicado && falha.erro ? `<span class="co-erro-slot">${esc(falha.erro)}</span>` : '';
      const extra = aberto ? `<div class="co-mais-linha">${hora ? `<span class="co-hora-slot">${esc(hora)}</span>` : ''}${erro}${htmlMais(p, o)}</div>` : '';
      return `<tr data-co-id="${esc(p.id)}">
        <td class="meio"><button type="button" class="co-abre" data-co-abre="${esc(p.id)}" aria-expanded="${aberto ? 'true' : 'false'}">${aberto ? '▾' : '▸'}</button></td>
        <td class="meio">${htmlFoto(p)}</td>
        <td class="co-cod">${esc(p.codigo || p.id)}</td>
        <td><div class="co-nome">${esc(p.descricao)}</div>${extra}</td>
        <td class="num co-qtd${qtdCls}">${esc(qtdTxt(p.estoque))}</td>
        <td><div class="co-preco"><span>R$</span>${inputMoeda(p, 'preco', p.preco)}</div></td>
        <td><div class="co-preco"><span>R$</span>${inputMoeda(p, 'promo', p.preco_promocional)}</div></td>
        <td class="meio">${htmlModo(p)}</td>
      </tr>`;
    }).join('');
    return `<div class="co-tabela-wrap co-campanha"><table class="co-tabela">
      <colgroup>
        <col class="c-abre" /><col class="c-foto" /><col class="c-cod" /><col class="c-nome" />
        <col class="c-est" /><col class="c-preco" /><col class="c-preco" /><col class="c-modo" />
      </colgroup>
      <thead><tr>
        <th></th>
        <th class="meio">Foto</th><th>Cód.</th><th>Produto</th><th class="num">Estoque</th>
        <th class="num">Preço</th><th class="num">Preço promo</th><th class="meio">Modo</th>
      </tr></thead>
      <tbody>${linhas || '<tr><td colspan="8" class="co-vazio">Nenhum item na campanha.</td></tr>'}</tbody>
    </table></div>`;
  }

  function desenhar() {
    const el = raiz();
    if (!el || !estado) return;
    const rolagem = document.querySelector('.main')?.scrollTop || 0;
    el.innerHTML = painel();
    if (ofertaAtual()) {
      ligarArquivo();
      carregarGrupos();
    }
    const main = document.querySelector('.main');
    if (main) main.scrollTop = rolagem;
  }

  function pintarSugestoes() {
    const lista = document.getElementById('co-sugestoes');
    if (!lista) return;
    if (!sugestoes.length) {
      lista.hidden = true;
      lista.innerHTML = '';
      return;
    }
    lista.hidden = false;
    lista.innerHTML = sugestoes.map((p) => `<li><button type="button" class="co-sug${String(p.id) === String(escolhaId) ? ' is-on' : ''}" data-co-sug="${esc(p.id)}"><strong>${esc(p.codigo || p.id)}</strong><span>${esc(p.descricao)}</span></button></li>`).join('');
  }

  function itemOferta(p) {
    const base = detalhesOferta(ofertaAtual());
    const modo = modoAtual(p);
    return {
      id: p.id,
      codigo: p.codigo || p.id,
      descricao: p.descricao || '',
      ean: p.ean || '',
      detalhe: p.observacao || p.detalhe || '',
      detalhes: (p.textos && Object.values(p.textos).some((v) => String(v || '').trim())) ? p.textos : (p.detalhes || {}),
      preco: p.preco,
      preco_promocional: p.preco_promocional,
      promocao_inicio: p.promocao_inicio || '',
      promocao_fim: p.promocao_fim || '',
      estoque: p.estoque,
      foto_url: p.foto_url || '',
      modo: modo === 'nenhum' ? '' : modo,
      categoria: p.categoria || '',
      limite_banner: Number(p.limite_banner) || base.limite_banner,
      campo_origem: p.campo_origem || base.campo_origem,
      onde: p.onde || base.onde,
    };
  }

  function trocarOferta(oferta) {
    ofertas = ofertas.map((o) => (o.id === oferta.id ? oferta : o));
    if (!ofertas.some((o) => o.id === oferta.id)) ofertas.unshift(oferta);
  }

  async function persistirItem(p) {
    const o = ofertaAtual();
    if (!o || !p || emRemocao.has(String(p.id))) return null;
    const marca = gravacao;
    const r = await api(`/central-ofertas/ofertas/${encodeURIComponent(o.id)}/produtos`, {
      method: 'POST',
      body: { produtos: [itemOferta(p)] },
    });
    if (marca !== gravacao || emRemocao.has(String(p.id))) return null;
    if (!r.ok) {
      showMsg(r.error || 'Falha ao salvar o item.');
      return null;
    }
    trocarOferta(r.oferta);
    return r.oferta;
  }

  async function incluirProduto(p) {
    const o = ofertaAtual();
    if (!o || !p) return;
    if (idsNaOferta().has(String(p.id))) return showMsg('Este produto já está na campanha.');
    const salvo = await persistirItem(p);
    if (!salvo) return;
    filtros.q = '';
    sugestoes = [];
    escolhaId = '';
    desenhar();
  }

  async function adicionarEscolha() {
    clearTimeout(buscaTimer);
    if (filtros.q.trim().length >= 2) await buscarSugestoes();
    const id = escolhaId || sugestoes[0]?.id;
    if (!id) return showMsg('Busque o nome, código ou EAN e escolha um produto.');
    if (idsNaOferta().has(String(id))) return showMsg('Este produto já está na campanha.');
    const r = await api(`/central-ofertas/produtos?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
    const p = (r.ok && r.produtos && r.produtos[0]) || sugestoes.find((item) => String(item.id) === String(id));
    if (!p) return showMsg(r.error || 'Produto não encontrado.');
    await incluirProduto(p);
  }

  async function tirarProduto(id) {
    const o = ofertaAtual();
    if (!o) return;
    const chave = String(id);
    emRemocao.add(chave);
    gravacao += 1;
    trocarOferta({ ...o, produtos: (o.produtos || []).filter((p) => String(p.id) !== chave) });
    desenhar();
    const r = await api(`/central-ofertas/ofertas/${encodeURIComponent(o.id)}/produtos/remover`, {
      method: 'POST',
      body: { ids: [chave] },
    });
    emRemocao.delete(chave);
    if (!r.ok) {
      showMsg(r.error || 'Falha ao tirar o produto.');
      await carregarOfertas();
      return;
    }
    trocarOferta(r.oferta);
    desenhar();
  }

  function itemCampanha(id) {
    return (ofertaAtual()?.produtos || []).find((p) => String(p.id) === String(id)) || null;
  }

  async function salvarModo(id, modo) {
    const r = await api(`/central-ofertas/produtos/${encodeURIComponent(id)}`, { method: 'PUT', body: { modo } });
    if (!r.ok) return showMsg(r.error || 'Falha ao salvar o modo.');
    const atual = itemCampanha(id) || {};
    await persistirItem({ ...atual, ...r.produto, modo: modo === 'nenhum' ? '' : modo, modo_escolhido: modo === 'nenhum' ? '' : modo });
  }

  async function salvarCampos(id) {
    if (!podePreco || emRemocao.has(String(id))) return;
    const linha = raiz()?.querySelector(`tr[data-co-id="${CSS.escape(String(id))}"]`);
    if (!linha) return;
    const val = (nome) => linha.querySelector(`[data-co-campo="${nome}"]`)?.value ?? '';
    const preco = val('preco');
    const promo = val('promo');
    const atual = itemCampanha(id) || {};
    const o = ofertaAtual();
    const inicio = val('inicio') || atual.promocao_inicio || o?.inicio || '';
    const fim = val('fim') || atual.promocao_fim || o?.fim || '';
    if (moedaInput(atual.preco) === preco && moedaInput(atual.preco_promocional) === promo) return;
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
    await persistirItem({ ...atual, ...r.produto });
  }

  function reduzirFoto(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const lado = Math.max(img.width, img.height) || 1;
        const escala = Math.min(1, 1920 / lado);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * escala));
        canvas.height = Math.max(1, Math.round(img.height * escala));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.92));
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
    const atual = itemCampanha(id) || { id, ean };
    await persistirItem({ ...atual, foto: true, foto_url: r.foto_url, foto_chave: r.foto_chave });
    desenhar();
    if (r.aviso) showMsg(r.aviso);
  }

  function ligarArquivo() {
    campo('co-q')?.addEventListener('input', () => {
      filtros.q = campo('co-q').value;
      clearTimeout(buscaTimer);
      buscaTimer = setTimeout(() => buscarSugestoes(), 320);
    });
    campo('co-q')?.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      adicionarEscolha();
    });
    campo('co-grupo')?.addEventListener('change', () => {
      filtros.grupo = campo('co-grupo').value;
      if (filtros.q.trim().length >= 2) buscarSugestoes();
    });
    campo('co-of-nome')?.addEventListener('change', () => salvarCapa(false));
    campo('co-of-ini')?.addEventListener('change', () => salvarCapa(true));
    campo('co-of-fim')?.addEventListener('change', () => salvarCapa(true));
    campo('co-legenda')?.addEventListener('input', () => { atualizarPrevia(); agendarTexto(); });
    campo('co-link')?.addEventListener('input', () => { atualizarPrevia(); agendarTexto(); });
    campo('co-legenda')?.addEventListener('change', () => salvarTexto(true));
    campo('co-link')?.addEventListener('change', () => salvarTexto(true));
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
    const mes = ev.target.closest('[data-co-mes]');
    if (mes) {
      const passo = Number(mes.dataset.coMes) || 0;
      const d = new Date(calAno, calMes + passo, 1);
      calAno = d.getFullYear();
      calMes = d.getMonth();
      diaAberto = '';
      desenhar();
      return;
    }
    if (ev.target.closest('#co-nova')) return criarOferta();
    if (ev.target.closest('#co-banner')) {
      campo('co-banner-arquivo')?.click();
      return;
    }
    const dia = ev.target.closest('[data-co-dia-cal]');
    if (dia) {
      diaAberto = diaAberto === dia.dataset.coDiaCal ? '' : dia.dataset.coDiaCal;
      desenhar();
      return;
    }
    if (ev.target.closest('#co-of-cancelar')) return cancelarOferta();
    if (ev.target.closest('#co-of-voltar')) {
      ofertaAberta = '';
      sugestoes = [];
      escolhaId = '';
      filtros.q = '';
      desenhar();
      return;
    }
    const item = ev.target.closest('[data-co-oferta]');
    if (item) {
      ofertaAberta = item.dataset.coOferta;
      criando = false;
      desenhar();
      return;
    }
    const statusBtn = ev.target.closest('[data-co-status]');
    if (statusBtn && ofertaAtual()) return definirStatus(statusBtn.dataset.coStatus === '1');
    const formaBtn = ev.target.closest('[data-co-forma]');
    if (formaBtn && ofertaAtual()) return definirForma(formaBtn.dataset.coForma);
    const bannerUso = ev.target.closest('[data-co-banner-uso]');
    if (bannerUso && ofertaAtual()) return definirUsoBanner(bannerUso.dataset.coBannerUso === '1');
    if (ev.target.closest('#co-of-rotina')) return gerarRotina();
    if (ev.target.closest('#co-of-agora')) return postarAgora();
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
    if (ev.target.closest('#co-add')) return adicionarEscolha();
    const sug = ev.target.closest('[data-co-sug]');
    if (sug) {
      escolhaId = sug.dataset.coSug;
      return adicionarEscolha();
    }
    const abre = ev.target.closest('[data-co-abre]');
    if (abre) {
      const id = String(abre.dataset.coAbre);
      if (fechados.has(id)) fechados.delete(id);
      else fechados.add(id);
      desenhar();
      return;
    }
    const tirar = ev.target.closest('[data-co-tirar]');
    if (tirar) return tirarProduto(tirar.dataset.coTirar);
    const b = ev.target.closest('[data-co-filtro]');
    if (!b) return;
    const k = b.dataset.coFiltro;
    filtros[k] = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', filtros[k] ? 'true' : 'false');
    if (filtros.q.trim().length >= 2) buscarSugestoes();
  }

  async function enviarBanner(file) {
    if (!file) return;
    let dataUrl = '';
    try { dataUrl = await reduzirFoto(file); }
    catch (err) {
      if (campo('co-banner-arquivo')) campo('co-banner-arquivo').value = '';
      return showMsg(err.message || 'Não abri o banner.');
    }
    const b = bannerAtual();
    const r = await api('/central-ofertas/banner', {
      method: 'POST',
      body: { base64: dataUrl.split(',')[1] || '', tipo: 'image/jpeg', x: b.x, y: b.y, w: b.w, h: b.h },
    });
    if (campo('co-banner-arquivo')) campo('co-banner-arquivo').value = '';
    if (!r.ok) return showMsg(r.error || 'Falha ao guardar o banner.');
    if (estado) estado.config = { ...(estado.config || {}), banner: r.banner };
    desenhar();
  }

  async function salvarFuro(furo) {
    const r = await api('/central-ofertas/banner', { method: 'POST', body: furo });
    if (!r.ok) return showMsg(r.error || 'Falha ao guardar o espaço da foto.');
    if (estado) estado.config = { ...(estado.config || {}), banner: r.banner };
  }

  let furoArraste = null;

  function moverFuro(ev) {
    if (!furoArraste) return;
    const dx = ((ev.clientX - furoArraste.px) / furoArraste.largura) * 100;
    const dy = ((ev.clientY - furoArraste.py) / furoArraste.altura) * 100;
    let { x, y, w, h } = furoArraste;
    if (furoArraste.alca) {
      w = Math.min(100 - x, Math.max(18, furoArraste.w + dx));
      h = Math.min(100 - y, Math.max(18, furoArraste.h + dy));
    } else {
      x = Math.min(100 - w, Math.max(0, furoArraste.x + dx));
      y = Math.min(100 - h, Math.max(0, furoArraste.y + dy));
    }
    const el = raiz()?.querySelector('.co-banner-vazio');
    if (el) {
      el.style.left = `${x}%`;
      el.style.top = `${y}%`;
      el.style.width = `${w}%`;
      el.style.height = `${h}%`;
    }
    furoArraste.atual = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  }

  function soltarFuro() {
    const atual = furoArraste?.atual;
    furoArraste = null;
    if (atual) salvarFuro(atual);
  }

  async function mudou(ev) {
    const t = ev.target;
    if (!raiz()?.contains(t)) return;
    if (t.id === 'co-banner-arquivo') return enviarBanner(t.files?.[0]);
    if (!ofertaAtual()) return;
    const extraId = t.dataset.coLimite || t.dataset.coOrigem || t.dataset.coOnde;
    if (extraId) return salvarExtra(extraId);
    if (t.dataset.coModo) await salvarModo(t.dataset.coModo, t.value);
  }

  async function salvarExtra(id) {
    const atual = itemCampanha(id);
    if (!atual) return;
    const raizEl = raiz();
    const limite = Number(raizEl?.querySelector(`[data-co-limite="${CSS.escape(String(id))}"]`)?.value);
    const campoOrigem = raizEl?.querySelector(`[data-co-origem="${CSS.escape(String(id))}"]`)?.value || '';
    const onde = raizEl?.querySelector(`[data-co-onde="${CSS.escape(String(id))}"]`)?.value || '';
    await persistirItem({
      ...atual,
      limite_banner: limite,
      campo_origem: campoOrigem,
      onde,
      textos: atual.detalhes,
    });
  }

  function saiu(ev) {
    if (!ofertaAtual()) return;
    const origem = ev.target.closest?.('tr');
    if (!origem?.dataset.coId || !raiz()?.contains(origem)) return;
    if (emRemocao.has(String(origem.dataset.coId))) return;
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
    qs.set('rapido', '1');
    return `?${qs.toString()}`;
  }

  async function buscarSugestoes() {
    if (!ofertaAtual()) return;
    const seq = ++buscaSeq;
    if (filtros.q.trim().length < 2) {
      sugestoes = [];
      escolhaId = '';
      pintarSugestoes();
      return;
    }
    const r = await api(`/central-ofertas/produtos${queryLista()}`, { cache: 'no-store' });
    if (seq !== buscaSeq) return;
    if (!r.ok) {
      sugestoes = [];
      pintarSugestoes();
      return showMsg(r.error || 'Falha ao buscar os produtos.');
    }
    podePreco = r.pode_preco === true;
    sugestoes = r.produtos || [];
    if (!sugestoes.some((p) => String(p.id) === String(escolhaId))) escolhaId = sugestoes[0]?.id || '';
    pintarSugestoes();
  }

  async function carregarGrupos() {
    if (gruposProntos) return;
    gruposProntos = true;
    const r = await api('/central-ofertas/produtos?grupos=1', { cache: 'no-store' });
    if (!r.ok) {
      gruposProntos = false;
      return;
    }
    grupos = r.grupos || [];
    const grupo = campo('co-grupo');
    if (!grupo) return;
    const atual = filtros.grupo;
    grupo.innerHTML = ['<option value="">Todos</option>'].concat(grupos.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`)).join('');
    grupo.value = grupos.includes(atual) ? atual : '';
    filtros.grupo = grupo.value;
  }

  function diasMarcados(o, r) {
    const salvos = (r.dias_semana || []).map(Number).filter((n) => n >= 0 && n <= 6).sort((a, b) => a - b);
    const padraoAntigo = salvos.length === 5 && salvos.every((n, i) => n === i + 1);
    if (padraoAntigo) return diaDaOferta(o.inicio);
    return salvos.length ? salvos : diaDaOferta(o.inicio);
  }

  function diaDaOferta(inicio) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(inicio || ''))) return [];
    const dia = new Date(`${inicio}T12:00:00`);
    if (Number.isNaN(dia.getTime())) return [];
    return [dia.getDay()];
  }

  function moeda(valor) {
    const n = Number(valor);
    if (!Number.isFinite(n)) return '';
    const partes = n.toFixed(2).split('.');
    return `R$ ${partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${partes[1]}`;
  }

  function linhaPreco(produto) {
    const de = Number(produto?.preco);
    const por = Number(produto?.preco_promocional);
    const temDe = Number.isFinite(de) && de > 0;
    const temPor = Number.isFinite(por) && por > 0;
    if (temDe && temPor && por < de) return `De ${moeda(de)} por ${moeda(por)}`;
    if (temPor) return moeda(por);
    if (temDe) return moeda(de);
    return '';
  }

  function usaBanner(o) {
    return o?.usar_banner !== false;
  }

  function formaOferta(o) {
    return o?.forma === 'story' || o?.forma === 'ambos' ? o.forma : 'post';
  }

  function previaMensagem(o) {
    const produto = (o?.produtos || [])[0];
    const legenda = String(campo('co-legenda')?.value ?? o?.legenda ?? '').trim();
    const forma = campo('co-forma')?.querySelector('[aria-pressed="true"]')?.dataset.coForma || formaOferta(o);
    const link = String(campo('co-link')?.value ?? o?.link ?? '').trim();
    const linhas = [];
    if (legenda) linhas.push(legenda);
    linhas.push(String(produto?.descricao || 'Nome do produto'));
    const detalhe = String(produto?.detalhe || '').trim();
    if (detalhe) linhas.push(detalhe);
    const preco = linhaPreco(produto);
    if (preco) linhas.push(preco);
    if ((forma === 'story' || forma === 'ambos') && link) linhas.push('', link);
    return linhas.join('\n');
  }

  function atualizarPrevia() {
    const el = campo('co-previa');
    const o = ofertaAtual();
    if (el && o) el.textContent = previaMensagem(o);
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
      dias_semana: [...document.querySelectorAll('#co-raiz [data-co-dia]:checked')].map((el) => Number(el.dataset.coDia)),
      fds_ativo: !!campo('co-r-fds')?.checked,
      fds_qtd: Number(campo('co-r-fds-qtd')?.value),
      encarte: !!campo('co-r-encarte')?.checked,
    };
  }

  function lerDetalhesForm() {
    const d = detalhesOferta(ofertaAtual());
    return {
      ativo: campo('co-det-on') ? !!campo('co-det-on').checked : d.ativo,
      campo_origem: d.campo_origem,
      onde: d.onde,
      limite_banner: d.limite_banner,
    };
  }

  function avisoRotina(texto) {
    const el = campo('co-rotina-status');
    if (el) el.textContent = texto || '';
    if (texto) showMsg(texto);
  }

  async function criarOferta() {
    const usar = estado?.config?.detalhes_item?.ativo === true;
    const r = await api('/central-ofertas/ofertas', {
      method: 'POST',
      body: {
        nome: 'Nova oferta',
        inicio: isoHoje(0),
        fim: isoHoje(0),
        usar_detalhes: usar,
        ativa: true,
        produtos: [],
      },
    });
    if (!r.ok) return showMsg(r.error || 'Falha ao criar a oferta.');
    ofertaAberta = r.oferta.id;
    criando = false;
    filtros.q = '';
    sugestoes = [];
    await carregarOfertas();
  }

  async function salvarCapa(ajustarDias) {
    const o = ofertaAtual();
    if (!o) return;
    const inicio = campo('co-of-ini')?.value || o.inicio;
    const fim = campo('co-of-fim')?.value || o.fim;
    const body = {
      nome: campo('co-of-nome')?.value || o.nome,
      inicio,
      fim,
    };
    if (ajustarDias) body.rotina_cfg = { ...lerRotinaForm(), dias_semana: diaDaOferta(inicio) };
    const r = await api(`/central-ofertas/ofertas/${encodeURIComponent(o.id)}`, {
      method: 'PUT',
      body,
    });
    if (!r.ok) return showMsg(r.error || 'Falha ao salvar a campanha.');
    trocarOferta(r.oferta);
  }

  async function definirForma(forma) {
    const o = ofertaAtual();
    if (!o || !['post', 'story', 'ambos'].includes(forma)) return;
    document.querySelectorAll('#co-forma [data-co-forma]').forEach((b) => {
      b.setAttribute('aria-pressed', b.dataset.coForma === forma ? 'true' : 'false');
    });
    atualizarPrevia();
    const r = await api(`/central-ofertas/ofertas/${encodeURIComponent(o.id)}`, {
      method: 'PUT',
      body: { forma },
    });
    if (!r.ok) return showMsg(r.error || 'Falha ao salvar o modo.');
    trocarOferta(r.oferta);
  }

  async function definirUsoBanner(usar) {
    const o = ofertaAtual();
    if (!o || usaBanner(o) === usar) return;
    document.querySelectorAll('#co-banner-uso [data-co-banner-uso]').forEach((b) => {
      b.setAttribute('aria-pressed', (b.dataset.coBannerUso === '1') === usar ? 'true' : 'false');
    });
    const dica = raiz()?.querySelector('.co-banner-dica');
    if (dica) dica.textContent = usar ? 'A foto do produto entra no espaço do banner.' : 'A foto anexada sai inteira, como um cupom.';
    const r = await api(`/central-ofertas/ofertas/${encodeURIComponent(o.id)}`, {
      method: 'PUT',
      body: { usar_banner: usar },
    });
    if (!r.ok) return showMsg(r.error || 'Falha ao salvar o banner.');
    trocarOferta(r.oferta);
  }

  let textoTimer = 0;

  function agendarTexto() {
    clearTimeout(textoTimer);
    textoTimer = setTimeout(() => salvarTexto(true), 400);
  }

  async function salvarTexto(silencioso) {
    const o = ofertaAtual();
    if (!o) return false;
    const legenda = String(campo('co-legenda')?.value || '');
    const link = String(campo('co-link')?.value || '').trim();
    if (link && !/^https?:\/\/\S+$/i.test(link)) {
      if (!silencioso) showMsg('O link precisa começar com http:// ou https://');
      return false;
    }
    atualizarPrevia();
    const r = await api(`/central-ofertas/ofertas/${encodeURIComponent(o.id)}`, {
      method: 'PUT',
      body: { legenda, link },
    });
    if (!r.ok) {
      if (!silencioso) showMsg(r.error || 'Falha ao salvar a mensagem.');
      return false;
    }
    trocarOferta(r.oferta);
    return true;
  }

  async function definirStatus(ativa) {
    const o = ofertaAtual();
    if (!o || ofertaLigada(o) === ativa) return;
    const r = await api(`/central-ofertas/ofertas/${encodeURIComponent(o.id)}`, {
      method: 'PUT',
      body: { ativa },
    });
    if (!r.ok) return showMsg(r.error || 'Falha ao mudar o status.');
    trocarOferta(r.oferta);
    desenhar();
  }

  async function cancelarOferta() {
    const o = ofertaAtual();
    const vazia = o && !(o.produtos || []).length && !(o.rotina || []).some((s) => s.publicado);
    ofertaAberta = '';
    sugestoes = [];
    escolhaId = '';
    filtros.q = '';
    if (vazia) {
      const r = await api(`/central-ofertas/ofertas/${encodeURIComponent(o.id)}/apagar`, { method: 'POST', body: {} });
      if (!r.ok) showMsg(r.error || 'Falha ao cancelar a campanha.');
      await carregarOfertas();
      return;
    }
    desenhar();
  }

  async function gerarRotina() {
    const o = ofertaAtual();
    if (!o) return;
    if (!(o.produtos || []).length) return avisoRotina('Inclua um produto na oferta antes de gerar.');
    const status = campo('co-rotina-status');
    if (status) status.textContent = 'Gerando a rotina…';
    const r = await api(`/central-ofertas/ofertas/${encodeURIComponent(o.id)}/rotina`, {
      method: 'POST',
      body: { rotina: lerRotinaForm(), detalhes: lerDetalhesForm() },
    });
    if (!r.ok) return avisoRotina(r.error || 'Falha ao gerar a rotina.');
    trocarOferta(r.oferta);
    desenhar();
    const n = (r.oferta.rotina || []).length;
    const prox = (r.oferta.rotina || []).find((s) => !s.publicado);
    const texto = prox
      ? `${n} horário${n === 1 ? '' : 's'}. A próxima é ${prox.data} ${prox.hora}.`
      : `${n} horário${n === 1 ? '' : 's'}.`;
    const st = campo('co-rotina-status');
    if (st) st.textContent = r.aviso ? `${texto} ${r.aviso}` : texto;
  }

  async function postarAgora() {
    const o = ofertaAtual();
    if (!o || postando) return;
    clearTimeout(textoTimer);
    if (!(await salvarTexto(false))) return;
    postando = true;
    desenhar();
    const andamento = campo('co-rotina-status');
    if (andamento) andamento.textContent = 'Publicando no Instagram…';
    let texto = '';
    let falhou = false;
    try {
      const r = await api(`/central-ofertas/ofertas/${encodeURIComponent(o.id)}/postar`, {
        method: 'POST',
        body: {},
      });
      if (r.oferta) trocarOferta(r.oferta);
      if (!r.ok || r.etapa !== 'publicado') {
        texto = r.error || r.mensagem || 'Falha ao postar.';
        falhou = true;
      } else {
        texto = r.mensagem || 'Publicado no Instagram.';
      }
    } finally {
      postando = false;
    }
    if (ofertaAtual()) {
      desenhar();
      const st = campo('co-rotina-status');
      if (st) st.textContent = texto;
      assinatura = assinar(ofertas);
    }
    if (falhou) showMsg(texto);
  }

  function assinar(lista) {
    return JSON.stringify((lista || []).map((o) => ({
      id: o.id,
      aviso: o.aviso || '',
      rotina: (o.rotina || []).map((s) => [s.produto_id, s.data, s.hora, !!s.publicado, s.erro || '']),
    })));
  }

  function campoFocado() {
    const el = document.activeElement;
    return !!(el && raiz()?.contains(el) && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName));
  }

  async function acompanhar() {
    if (postando || campoFocado()) return;
    const r = await api('/central-ofertas/ofertas');
    if (!r.ok) return;
    const nova = assinar(r.ofertas);
    if (nova === assinatura) return;
    ofertas = r.ofertas || [];
    if (ofertaAberta && !ofertas.some((o) => o.id === ofertaAberta)) ofertaAberta = '';
    assinatura = nova;
    desenhar();
  }

  function ligarRelogio() {
    clearInterval(relogio);
    relogio = setInterval(acompanhar, 20000);
  }

  function onPageLeave() {
    clearInterval(relogio);
    relogio = null;
  }

  async function carregarOfertas() {
    const r = await api('/central-ofertas/ofertas');
    if (!r.ok) return showMsg(r.error || 'Falha ao ler as ofertas.');
    ofertas = r.ofertas || [];
    if (ofertaAberta && !ofertas.some((o) => o.id === ofertaAberta)) ofertaAberta = '';
    assinatura = assinar(ofertas);
    desenhar();
  }

  async function onPageEnter() {
    const el = raiz();
    if (!el) return;
    ofertaAberta = '';
    diaAberto = '';
    criando = false;
    el.innerHTML = '<p class="hint">Carregando…</p>';
    const r = await api('/central-ofertas/config');
    if (!r.ok) {
      el.innerHTML = `<p class="erro">${esc(r.error || 'A Central de Ofertas não está disponível.')}</p>`;
      return;
    }
    estado = r;
    podePreco = r.pode_preco === true;
    await carregarOfertas();
    ligarRelogio();
  }

  function init(deps) {
    api = deps.api || api;
    showMsg = deps.showMsg || showMsg;
    esc = deps.escapeHtml || esc;
    const raizEl = document.getElementById('co-raiz');
    if (raizEl && !raizEl.dataset.coLigado) {
      raizEl.dataset.coLigado = '1';
      const soltarRemocao = () => {
        if (!dedoRemocao) return;
        emRemocao.delete(dedoRemocao);
        dedoRemocao = '';
      };
      raizEl.addEventListener('pointerdown', (ev) => {
        const vazio = ev.target.closest?.('.co-banner-vazio');
        if (vazio) {
          const palco = vazio.parentElement?.getBoundingClientRect();
          const b = bannerAtual();
          furoArraste = {
            alca: ev.target.classList?.contains('co-banner-alca'),
            px: ev.clientX,
            py: ev.clientY,
            x: b.x,
            y: b.y,
            w: b.w,
            h: b.h,
            largura: palco?.width || 1,
            altura: palco?.height || 1,
            atual: null,
          };
          vazio.setPointerCapture?.(ev.pointerId);
          ev.preventDefault();
          return;
        }
        const tirar = ev.target.closest?.('[data-co-tirar]');
        if (!tirar) return;
        dedoRemocao = String(tirar.dataset.coTirar);
        emRemocao.add(dedoRemocao);
      });
      raizEl.addEventListener('pointermove', moverFuro);
      raizEl.addEventListener('pointerup', () => { soltarFuro(); soltarRemocao(); });
      raizEl.addEventListener('pointercancel', () => { furoArraste = null; soltarRemocao(); });
      raizEl.addEventListener('click', noEvento);
      raizEl.addEventListener('change', noEvento);
      raizEl.addEventListener('focusout', noEvento);
    }
  }

  window.CentralOfertas = { init, onPageEnter, onPageLeave };
})();
