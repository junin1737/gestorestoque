(function () {
  const TITULOS = {
    'ncm-branco': 'NCM em branco ou inválido',
    'ncm-distintos': 'NCMs distintos',
    'os-abertos': 'Serviços em aberto',
    'os-status': 'O.S por status',
    'os-finalizados': 'Serviços finalizados',
    'os-tecnico': 'Serviços por técnico',
    'os-produtos': 'Produtos vendidos em O.S',
    'os-totalizador': 'Totalizador de serviços',
    'os-descontos': 'Descontos e acréscimos',
  };
  /** Relatórios da O.S: filtros iguais aos do quadro (período, status, tipo e técnico). */
  const PERIODO_OPCIONAL = ['os-abertos', 'os-status'];
  let deps = {};
  let pedido = 'ncm-branco';
  let atual = null;
  let apoioOs = null;
  const filtrosOs = {};

  function esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ehOs(id = pedido) {
    return String(id).startsWith('os-');
  }

  function titulo() {
    return TITULOS[pedido] || 'Relatório';
  }

  function usuario() {
    return typeof deps.usuario === 'function' ? deps.usuario() : '';
  }

  function filtrosDe(id) {
    if (!filtrosOs[id]) {
      const hoje = GestorHora.hoje();
      filtrosOs[id] = PERIODO_OPCIONAL.includes(id)
        ? { inicio: '', fim: '', status: '', tipo: '', tecnico: '', item: id === 'os-produtos' ? 'produto' : '' }
        : { inicio: `${hoje.slice(0, 8)}01`, fim: hoje, status: '', tipo: '', tecnico: '', item: id === 'os-produtos' ? 'produto' : '' };
    }
    return filtrosOs[id];
  }

  function descricaoFiltros() {
    if (!ehOs() || !atual) return '';
    const f = filtrosDe(pedido);
    const partes = [atual.periodo?.rotulo || ''];
    if (f.status) partes.push(`status ${apoioOs?.statuses?.find((s) => String(s.id) === f.status)?.descricao || f.status}`);
    if (f.tipo) partes.push(f.tipo === 'E' ? 'externas' : 'internas');
    if (f.tecnico) partes.push(f.tecnico === 'sem' ? 'sem técnico' : `técnico ${apoioOs?.tecnicos?.find((t) => String(t.id) === f.tecnico)?.nome || f.tecnico}`);
    if (pedido === 'os-produtos') partes.push(f.item === 'servico' ? 'só serviços' : (f.item === 'ambos' ? 'produtos e serviços' : 'só produtos'));
    return partes.filter(Boolean).join(' · ');
  }

  function pacote() {
    const colunas = (atual?.colunas || []).map((c) => ({
      ...c,
      largura: c.largura || (c.id === 'descricao' ? '58%' : c.id === 'id_identificador' ? '16%' : '26%'),
    }));
    const linhas = atual?.linhas || [];
    return {
      total: atual?.total || null,
      titulo: atual?.titulo || titulo(),
      empresa: atual?.empresa || '',
      usuario: usuario(),
      subtitulo: descricaoFiltros(),
      paragrafos: atual?.nota ? [atual.nota] : [],
      colunas,
      linhas,
    };
  }

  function exportarPdf() {
    if (!atual) return;
    window.ExportarTabela?.abrirPdf(pacote());
  }

  function exportarExcel() {
    if (!atual) return;
    window.ExportarTabela?.excel(pacote());
  }

  function htmlFiltros() {
    if (!ehOs()) return '';
    const f = filtrosDe(pedido);
    const opc = (lista, atualId, campo) => (lista || [])
      .map((o) => `<option value="${esc(o.id)}" ${String(o.id) === String(atualId) ? 'selected' : ''}>${esc(o[campo])}</option>`).join('');
    return `<form class="fin-filtros rel-filtros" id="rel-filtros">
      <label>De<input type="date" name="inicio" value="${esc(f.inicio)}"></label>
      <label>Até<input type="date" name="fim" value="${esc(f.fim)}"></label>
      <label>Status<select name="status"><option value="">Todos</option>${opc(apoioOs?.statuses, f.status, 'descricao')}</select></label>
      <label>Tipo<select name="tipo"><option value="">Todos</option>
        <option value="I" ${f.tipo === 'I' ? 'selected' : ''}>Interna</option>
        <option value="E" ${f.tipo === 'E' ? 'selected' : ''}>Externa</option></select></label>
      <label>Técnico<select name="tecnico"><option value="">Todos</option>${opc(apoioOs?.tecnicos, f.tecnico, 'nome')}
        <option value="sem" ${f.tecnico === 'sem' ? 'selected' : ''}>Sem técnico</option></select></label>
      ${pedido === 'os-produtos' ? `<label>Itens<select name="item">
        <option value="produto" ${f.item !== 'servico' && f.item !== 'ambos' ? 'selected' : ''}>Produtos</option>
        <option value="servico" ${f.item === 'servico' ? 'selected' : ''}>Serviços</option>
        <option value="ambos" ${f.item === 'ambos' ? 'selected' : ''}>Ambos</option></select></label>` : ''}
      <button type="submit" class="btn small">Atualizar</button>
    </form>`;
  }

  function desenhar(res) {
    const host = document.getElementById('relatorios-host');
    if (!host) return;
    atual = res;
    const colunas = res.colunas || [];
    const linhas = res.linhas || [];
    const nome = res.titulo || titulo();
    const cls = (c) => (c.numero ? ' class="num"' : '');
    const head = colunas.map((c) => `<th${cls(c)}>${esc(c.titulo)}</th>`).join('');
    const body = linhas.length
      ? linhas.map((linha) => `<tr>${colunas.map((c) => `<td${cls(c)}>${esc(linha[c.id] || '—')}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${colunas.length || 1}">${esc(res.aviso || 'Nenhum registro')}</td></tr>`;
    const foot = res.total && linhas.length
      ? `<tfoot><tr>${colunas.map((c) => `<td${cls(c)}>${esc(res.total[c.id] || '')}</td>`).join('')}</tr></tfoot>`
      : '';
    host.innerHTML = `
      ${htmlFiltros()}
      <div class="rel-cabeca">
        <div>
          <strong>${esc(nome)}</strong>
          <span class="hint">${linhas.length.toLocaleString('pt-BR')} ${linhas.length === 1 ? 'registro' : 'registros'}${ehOs() && res.periodo?.rotulo ? ` · ${esc(res.periodo.rotulo)}` : ''}</span>
        </div>
        <div class="rel-exportar">
          <button type="button" class="btn small" id="rel-pdf">PDF</button>
          <button type="button" class="btn small" id="rel-excel">Excel</button>
        </div>
      </div>
      ${res.nota ? `<p class="hint rel-nota">${esc(res.nota)}</p>` : ''}
      <div class="rel-tabela-wrap">
        <table class="rel-tabela"${colunas.length > 3 ? ` style="min-width:${colunas.length * 6.5}rem"` : ''}>
          <thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody>
          ${foot}
        </table>
      </div>`;
    document.getElementById('rel-pdf')?.addEventListener('click', exportarPdf);
    document.getElementById('rel-excel')?.addEventListener('click', exportarExcel);
    ligarFiltros();
  }

  function ligarFiltros() {
    const form = document.getElementById('rel-filtros');
    if (!form) return;
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const dados = new FormData(form);
      const f = filtrosDe(pedido);
      ['inicio', 'fim', 'status', 'tipo', 'tecnico', 'item'].forEach((k) => { f[k] = String(dados.get(k) || ''); });
      if (f.inicio && f.fim && f.inicio > f.fim) {
        deps.showMsg?.('A data inicial é maior que a final.');
        return;
      }
      onPageEnter();
    });
  }

  async function carregarApoioOs() {
    if (apoioOs) return;
    const [st, fn] = await Promise.all([deps.api('/os/status'), deps.api('/os/funcionarios')]);
    apoioOs = {
      statuses: st?.ok ? (st.statuses || []) : [],
      tecnicos: fn?.ok ? (fn.funcionarios || []).filter((f) => f.tecnico) : [],
    };
  }

  function url() {
    if (!ehOs()) return `/relatorios/${encodeURIComponent(pedido)}`;
    const f = filtrosDe(pedido);
    const params = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v) params.set(k, v); });
    return `/os/relatorios/${encodeURIComponent(pedido)}?${params.toString()}`;
  }

  async function onPageEnter() {
    const host = document.getElementById('relatorios-host');
    if (!host) return;
    const filtros = host.querySelector('#rel-filtros');
    const aviso = '<p class="hint">Carregando…</p>';
    if (filtros && ehOs()) {
      host.querySelectorAll('.rel-cabeca, .rel-nota, .rel-tabela-wrap').forEach((el) => el.remove());
      host.insertAdjacentHTML('beforeend', aviso);
    } else host.innerHTML = aviso;
    const id = pedido;
    if (ehOs()) await carregarApoioOs();
    const res = await deps.api(url());
    if (id !== pedido) return;
    if (!res?.ok) {
      atual = null;
      host.innerHTML = `${htmlFiltros()}<p class="hint">${esc(res?.error || 'Não foi possível abrir o relatório.')}</p>`;
      ligarFiltros();
      return;
    }
    desenhar(res);
  }

  window.Relatorios = {
    init(d) { deps = d || {}; },
    definir(id) { if (TITULOS[id]) pedido = id; },
    atual() { return pedido; },
    titulo,
    onPageEnter,
  };
}());
