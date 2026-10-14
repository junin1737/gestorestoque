'use strict';

(function initContador(global) {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  let deps = { api() { return Promise.resolve({ ok: false }); }, showMsg() {}, showToast() {}, contador() { return false; } };
  let selecionados = new Set();
  let previaPronta = null;
  let contexto = {};

  function api(path, options) {
    return deps.api(path, options);
  }

  function campo(id, rotulo, placeholder) {
    return `<label class="imp-field">${rotulo}<input id="${id}" placeholder="${esc(placeholder || '')}" autocomplete="off" /></label>`;
  }

  async function carregar() {
    const host = $('#contador-host');
    if (!host) return;
    const contador = !!deps.contador?.();
    const ctx = await api('/massa/contexto');
    const regime = ctx.regime || '';
    const grupos = ctx.grupos || [];
    host.innerHTML = `
      <section class="imp-section">
        <header class="imp-section-head"><h4>${contador ? 'Tributação de saída' : 'Alteração em massa'}</h4></header>
        <p class="hint">${contador
          ? `Você altera só os campos fiscais de saída desta loja. Regime: ${esc(regime || '—')}. Cadastro, preço e estoque ficam bloqueados.`
          : `Os campos preenchidos na regra passam a valer para os produtos marcados ou filtrados (e, se ligada, só para os que atenderem à condição). Campo em branco não muda o valor atual. Regime: ${esc(regime || '—')}.`}</p>
        <div class="imp-fields massa-fields">
          ${campo('massa-q', 'Busca', 'Descrição')}
          ${campo('massa-ncm', 'NCM', '1905')}
          ${campo('massa-cfop', 'CFOP', '5102')}
          ${campo('massa-cst', 'CST / CSOSN', '102')}
          <label class="imp-field">Grupo
            <select id="massa-grupo"><option value="">Todos</option>${grupos.map((g) => `<option value="${g.id}">${esc(g.descricao)}</option>`).join('')}</select>
          </label>
        </div>
        <div class="massa-checks">
          <label><input type="checkbox" id="massa-incompleto" /> Tributação incompleta</label>
        </div>
        <div class="imp-vinc-btns">
          <button type="button" class="btn small" id="massa-filtrar">Filtrar</button>
          <button type="button" class="btn small" id="massa-limpar">Limpar filtros</button>
          <button type="button" class="btn small" id="massa-todos">Marcar todos</button>
          <button type="button" class="btn small btn-atencao" id="massa-abrir">Alterar em Massa</button>
        </div>
        <section class="imp-section massa-regra" id="massa-regra" hidden>
        <header class="imp-section-head"><h4>Regra</h4></header>
        <div class="massa-checks">
          <label><input type="checkbox" id="reg-marcados" checked /> Usar os produtos marcados</label>
          <label><input type="checkbox" id="reg-filtrados" /> Todos os filtrados</label>
          <label><input type="checkbox" id="reg-usar-condicao" /> Só os que atenderem à condição (SE)</label>
        </div>
        <div class="imp-fields massa-fields" id="reg-condicao" hidden>
          ${campo('reg-ncm-igual', 'SE NCM igual a', '19059090')}
          ${campo('reg-ncm-comeca', 'SE NCM começa com', '1905')}
          <label class="imp-field">SE grupo
            <select id="reg-grupo"><option value="">—</option>${grupos.map((g) => `<option value="${g.id}">${esc(g.descricao)}</option>`).join('')}</select>
          </label>
        </div>
        <p class="hint" id="reg-escopo-hint"></p>
        <p class="hint">ENTÃO preencher (só o que estiver preenchido):</p>
        <div class="imp-fields massa-fields" id="massa-acoes">
          ${campo('ac-ncm', 'NCM', '')}
          ${campo('ac-cest', 'CEST', '')}
          ${campo('ac-cfop', 'CFOP saída', '')}
          ${campo('ac-cfop-nf', 'CFOP NF', '')}
          ${ctx.simples ? campo('ac-csosn', 'CSOSN', '') : campo('ac-cst', 'CST ICMS', '')}
          ${ctx.simples ? campo('ac-csosn-cfe', 'CSOSN CF-e', '') : campo('ac-cst-cfe', 'CST CF-e', '')}
          ${campo('ac-cti', 'Taxa ICMS', '')}
          ${campo('ac-cti-cfe', 'Taxa ICMS CF-e', '')}
          ${campo('ac-cst-pis', 'CST PIS', '')}
          ${campo('ac-pis', 'Alíquota PIS', '')}
          ${campo('ac-cst-cofins', 'CST COFINS', '')}
          ${campo('ac-cofins', 'Alíquota COFINS', '')}
          ${campo('ac-class', 'Reforma — class. trib. NFe (id)', '')}
          ${campo('ac-class-nfce', 'Reforma — class. trib. NFCe (id)', '')}
          ${contador ? '' : `
            ${campo('ac-desc', 'Descrição', '')}
            ${campo('ac-barras', 'Código de barras', '')}
            ${campo('ac-ref', 'Referência', '')}
            ${campo('ac-venda', 'Preço de venda', '')}
            ${campo('ac-custo', 'Preço de custo', '')}
            <label class="imp-field">Situação
              <select id="ac-status"><option value="">Não alterar</option><option value="A">Ativo</option><option value="I">Inativo</option></select>
            </label>
          `}
        </div>
        <div class="imp-vinc-btns">
          <button type="button" class="btn small" id="massa-previa">Ver prévia (PDF)</button>
          <button type="button" class="btn small primary" id="massa-aplicar">Aplicar</button>
          <button type="button" class="btn small" id="massa-cancelar">Cancelar</button>
        </div>
        <div id="massa-previa-box"></div>
        </section>
        <div id="massa-lista" class="massa-lista"></div>
      </section>
      <p class="hint">Cada campo alterado fica no relatório de Alterações, com o valor anterior, o novo, quem fez e a data.</p>`;
    selecionados = new Set();
    previaPronta = null;
    contexto = ctx;
    $('#massa-filtrar')?.addEventListener('click', () => { desmarcarTodos(); listar(); });
    $('#massa-limpar')?.addEventListener('click', limparFiltros);
    $('#massa-todos')?.addEventListener('click', alternarTodos);
    $('#massa-cancelar')?.addEventListener('click', cancelarRegra);
    $('#reg-marcados')?.addEventListener('change', (e) => {
      if (e.target.checked && $('#reg-filtrados')) $('#reg-filtrados').checked = false;
      atualizarEscopo();
    });
    $('#reg-filtrados')?.addEventListener('change', (e) => {
      if (e.target.checked && $('#reg-marcados')) $('#reg-marcados').checked = false;
      atualizarEscopo();
    });
    $('#reg-usar-condicao')?.addEventListener('change', atualizarEscopo);
    $('#massa-regra')?.addEventListener('input', invalidarPrevia);
    $('#massa-regra')?.addEventListener('change', invalidarPrevia);
    $('#massa-abrir')?.addEventListener('click', () => {
      const box = $('#massa-regra');
      if (!box) return;
      box.hidden = !box.hidden;
      if (!box.hidden) box.scrollIntoView({ block: 'nearest' });
    });
    $('#massa-previa')?.addEventListener('click', verPrevia);
    $('#massa-aplicar')?.addEventListener('click', aplicar);
    atualizarEscopo();
    listar();
  }

  function atualizarEscopo() {
    const usarCond = !!$('#reg-usar-condicao')?.checked;
    const cond = $('#reg-condicao');
    if (cond) cond.hidden = !usarCond;
    const hint = $('#reg-escopo-hint');
    if (hint) {
      const base = $('#reg-filtrados')?.checked
        ? 'todos os produtos do filtro atual'
        : ($('#reg-marcados')?.checked ? `os ${selecionados.size} produto(s) marcados` : '');
      hint.textContent = !base
        ? 'Escolha "Usar os produtos marcados" ou "Todos os filtrados".'
        : (usarCond
          ? `Altera ${base} que atenderem à condição. Informe ao menos um parâmetro.`
          : `Altera ${base}, sem condição.`);
    }
    invalidarPrevia();
  }

  function limparFiltros() {
    ['massa-q', 'massa-ncm', 'massa-cfop', 'massa-cst'].forEach((id) => {
      const el = $(`#${id}`);
      if (el) el.value = '';
    });
    const grupo = $('#massa-grupo');
    if (grupo) grupo.value = '';
    const incompleto = $('#massa-incompleto');
    if (incompleto) incompleto.checked = false;
    desmarcarTodos();
    listar();
  }

  function filtro() {
    return {
      q: $('#massa-q')?.value || '',
      ncm: $('#massa-ncm')?.value || '',
      cfop: $('#massa-cfop')?.value || '',
      cst: $('#massa-cst')?.value || '',
      grupo: $('#massa-grupo')?.value || '',
      incompleto: !!$('#massa-incompleto')?.checked,
    };
  }

  function regra() {
    const condicoes = [];
    if ($('#reg-ncm-igual')?.value.trim()) condicoes.push({ tipo: 'ncm_igual', valor: $('#reg-ncm-igual').value.trim() });
    if ($('#reg-ncm-comeca')?.value.trim()) condicoes.push({ tipo: 'ncm_comeca', valor: $('#reg-ncm-comeca').value.trim() });
    if ($('#reg-grupo')?.value) condicoes.push({ tipo: 'grupo', valor: $('#reg-grupo').value });
    const acoes = {
      ncm: $('#ac-ncm')?.value,
      cest: $('#ac-cest')?.value,
      cfop: $('#ac-cfop')?.value,
      cfop_nf: $('#ac-cfop-nf')?.value,
      cst: $('#ac-cst')?.value,
      csosn: $('#ac-csosn')?.value,
      cst_cfe: $('#ac-cst-cfe')?.value,
      csosn_cfe: $('#ac-csosn-cfe')?.value,
      id_cti: $('#ac-cti')?.value,
      id_cti_cfe: $('#ac-cti-cfe')?.value,
      cst_pis: $('#ac-cst-pis')?.value,
      pis: $('#ac-pis')?.value,
      cst_cofins: $('#ac-cst-cofins')?.value,
      cofins: $('#ac-cofins')?.value,
      id_class_trib: $('#ac-class')?.value,
      id_class_trib_nfce: $('#ac-class-nfce')?.value,
      descricao: $('#ac-desc')?.value,
      cod_barras: $('#ac-barras')?.value,
      referencia: $('#ac-ref')?.value,
      prc_venda: $('#ac-venda')?.value,
      prc_custo: $('#ac-custo')?.value,
      status: $('#ac-status')?.value,
    };
    const todosFiltrados = !!$('#reg-filtrados')?.checked;
    return {
      filtro: filtro(),
      usar_condicao: !!$('#reg-usar-condicao')?.checked,
      condicoes,
      acoes,
      ids: !todosFiltrados && $('#reg-marcados')?.checked ? [...selecionados] : [],
      todos_filtrados: todosFiltrados,
    };
  }

  function cstDaLinha(it) {
    if (contexto.simples) {
      return `CSOSN ${esc(it.csosn || '—')} · CSOSN CF-e ${esc(it.csosn_cfe || '—')}`;
    }
    return `CST ${esc(it.cst || '—')} · CST CF-e ${esc(it.cst_cfe || '—')}`;
  }

  async function listar() {
    previaPronta = null;
    const f = filtro();
    const qs = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v === true ? '1' : v); });
    const res = await api(`/massa/itens?${qs}`);
    const box = $('#massa-lista');
    if (!box) return;
    const itens = res.itens || [];
    box.innerHTML = itens.map((it) => `
      <label class="massa-row">
        <input type="checkbox" data-id="${it.id_identificador}" ${selecionados.has(it.id_identificador) ? 'checked' : ''} />
        <span class="massa-id">${esc(it.id_identificador)}</span>
        <strong>${esc(it.descricao)}</strong>
        <span class="hint">NCM ${esc(it.ncm || '—')} · CFOP ${esc(it.cfop || '—')} · ${cstDaLinha(it)}</span>
      </label>`).join('') || '<p class="hint">Nenhum produto neste filtro.</p>';
    $$('input[data-id]', box).forEach((inp) => {
      inp.addEventListener('change', () => {
        const id = Number(inp.dataset.id);
        if (inp.checked) selecionados.add(id);
        else selecionados.delete(id);
        usarMarcados();
        atualizarBotaoTodos();
      });
    });
    atualizarBotaoTodos();
  }

  /** Mexeu na marcação da lista: a regra passa a valer para os marcados. */
  function usarMarcados() {
    if ($('#reg-filtrados')) $('#reg-filtrados').checked = false;
    if ($('#reg-marcados')) $('#reg-marcados').checked = true;
    atualizarEscopo();
  }

  function caixasDaLista() {
    return $$('#massa-lista input[data-id]');
  }

  function atualizarBotaoTodos() {
    const btn = $('#massa-todos');
    if (!btn) return;
    const caixas = caixasDaLista();
    const todos = caixas.length > 0 && caixas.every((c) => c.checked);
    btn.textContent = todos ? 'Desmarcar todos' : 'Marcar todos';
    btn.disabled = !caixas.length;
  }

  function alternarTodos() {
    const caixas = caixasDaLista();
    const marcar = !(caixas.length > 0 && caixas.every((c) => c.checked));
    caixas.forEach((inp) => {
      inp.checked = marcar;
      if (marcar) selecionados.add(Number(inp.dataset.id));
      else selecionados.delete(Number(inp.dataset.id));
    });
    usarMarcados();
    atualizarBotaoTodos();
  }

  function desmarcarTodos() {
    selecionados = new Set();
    caixasDaLista().forEach((inp) => { inp.checked = false; });
    usarMarcados();
    atualizarBotaoTodos();
  }

  function invalidarPrevia() {
    previaPronta = null;
    const box = $('#massa-previa-box');
    if (box) box.innerHTML = '';
  }

  function cancelarRegra() {
    invalidarPrevia();
    const box = $('#massa-regra');
    if (box) box.hidden = true;
    $('#massa-abrir')?.scrollIntoView({ block: 'nearest' });
  }

  async function consultarPrevia(body) {
    const res = await api('/massa/previa', { method: 'POST', body });
    const box = $('#massa-previa-box');
    if (!res.ok) {
      previaPronta = null;
      if (box) box.innerHTML = `<p class="erro">${esc(res.error || 'Não foi possível montar a prévia.')}</p>`;
      return null;
    }
    if (box) box.innerHTML = '';
    return res;
  }

  async function verPrevia() {
    const body = regra();
    const res = await consultarPrevia(body);
    if (!res) return;
    previaPronta = body;
    abrirRelatorio(relatorioPrevia(body, res));
    const box = $('#massa-previa-box');
    if (box) {
      box.innerHTML = `<p class="hint">${res.total} produto(s) no escopo · ${res.com_mudanca} vão mudar · ${res.sem_mudanca} já estão com esses valores. O relatório completo abriu em PDF.</p>`;
    }
  }

  function descreverEscopo(body) {
    if (!body.todos_filtrados) return `Produtos marcados na lista (${(body.ids || []).length})`;
    const f = body.filtro || {};
    const grupo = (contexto.grupos || []).find((g) => String(g.id) === String(f.grupo));
    const partes = [
      f.q && `busca "${f.q}"`,
      f.ncm && `NCM começa com ${f.ncm}`,
      f.cfop && `CFOP ${f.cfop}`,
      f.cst && `CST/CSOSN ${f.cst}`,
      grupo && `grupo ${grupo.descricao}`,
      f.incompleto && 'tributação incompleta',
    ].filter(Boolean);
    return `Todos os filtrados${partes.length ? ` (${partes.join(', ')})` : ' (sem filtro: todos os produtos)'}`;
  }

  function descreverCondicao(body) {
    if (!body.usar_condicao) return 'Sem condição: todos os produtos do escopo recebem os campos.';
    return (body.condicoes || []).map((c) => {
      if (c.tipo === 'ncm_igual') return `NCM igual a ${c.valor}`;
      if (c.tipo === 'ncm_comeca') return `NCM começa com ${c.valor}`;
      if (c.tipo === 'grupo') {
        const g = (contexto.grupos || []).find((x) => String(x.id) === String(c.valor));
        return `Grupo ${g ? g.descricao : c.valor}`;
      }
      return '';
    }).filter(Boolean).join(' E ');
  }

  function relatorioPrevia(body, res) {
    const agora = new Date();
    const quem = deps.usuario?.()?.nome || (deps.contador?.() ? 'Contador' : '');
    const vazio = (v) => (v === '' || v == null ? '<span class="vz">(vazio)</span>' : esc(v));
    const linhas = (res.amostra || []).map((p, idx) => {
      const ms = p.mudancas || [];
      return ms.map((m, i) => `
        <tr class="${idx % 2 ? 'par' : ''}${i === 0 ? ' ini' : ''}">
          ${i === 0 ? `<td class="id" rowspan="${ms.length}">${esc(p.id_identificador)}</td>
          <td class="prod" rowspan="${ms.length}">${esc(p.descricao)}<small>NCM ${esc(p.ncm || '—')}</small></td>` : ''}
          <td class="campo">${esc(m.rotulo)}</td>
          <td class="de">${vazio(m.de)}</td>
          <td class="seta">→</td>
          <td class="para">${vazio(m.para)}</td>
        </tr>`).join('');
    }).join('');
    const iguais = (res.iguais || []).map((p) => `<li><b>${esc(p.id_identificador)}</b> ${esc(p.descricao)}</li>`).join('');
    const acoes = (res.acoes || []).map((a) => `<li><span>${esc(a.rotulo)}</span><b>${esc(a.valor)}</b></li>`).join('');
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Prévia da alteração em massa</title>
<style>
  @page { size: A4 portrait; margin: 12mm 10mm; }
  * { box-sizing: border-box; }
  body { font: 11px/1.35 "Segoe UI", Arial, sans-serif; color: #1c2533; margin: 0; padding: 14px; }
  .barra { display: flex; justify-content: flex-end; margin-bottom: 10px; }
  .barra button { font: inherit; font-weight: 600; padding: 6px 14px; border-radius: 8px; border: 1px solid #2563eb; background: #2563eb; color: #fff; cursor: pointer; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #1c2533; padding-bottom: 6px; margin-bottom: 10px; }
  header h1 { font-size: 16px; margin: 0; }
  header .loja { font-size: 12px; font-weight: 600; }
  header .meta { text-align: right; color: #556; font-size: 10px; }
  .aviso { background: #fff6e5; border: 1px solid #e0a63a; color: #7a4d00; border-radius: 6px; padding: 6px 9px; margin-bottom: 10px; font-weight: 600; }
  .resumo { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
  .caixa { border: 1px solid #cfd6e2; border-radius: 6px; padding: 7px 9px; }
  .caixa h3 { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; margin: 0 0 4px; color: #5b6578; }
  .caixa p { margin: 0 0 3px; }
  .acoes { list-style: none; margin: 0; padding: 0; columns: 2; }
  .acoes li { display: flex; justify-content: space-between; gap: 6px; border-bottom: 1px dotted #cfd6e2; padding: 1px 0; break-inside: avoid; }
  .acoes span { color: #5b6578; }
  .numeros { display: flex; gap: 8px; margin-bottom: 10px; }
  .numeros div { flex: 1; border: 1px solid #cfd6e2; border-radius: 6px; padding: 6px 9px; }
  .numeros b { display: block; font-size: 16px; }
  .numeros .muda b { color: #1d4ed8; }
  h2 { font-size: 12px; margin: 12px 0 5px; }
  table { width: 100%; border-collapse: collapse; }
  thead th { background: #1c2533; color: #fff; text-align: left; font-size: 10px; padding: 4px 6px; }
  thead { display: table-header-group; }
  td { padding: 3px 6px; border-bottom: 1px solid #e3e8ef; vertical-align: top; }
  tr.ini td { border-top: 1px solid #b9c3d3; }
  tr.par td { background: #f6f8fb; }
  td.id { width: 52px; font-variant-numeric: tabular-nums; color: #5b6578; }
  td.prod { width: 34%; font-weight: 600; }
  td.prod small { display: block; font-weight: 400; color: #5b6578; }
  td.campo { width: 18%; color: #3a4558; }
  td.de { color: #9a3412; }
  td.para { color: #166534; font-weight: 700; }
  td.seta { width: 14px; color: #8a94a6; text-align: center; }
  .vz { color: #8a94a6; font-style: italic; font-weight: 400; }
  tr { break-inside: avoid; }
  .iguais { columns: 2; margin: 0; padding-left: 16px; color: #3a4558; }
  .iguais li { break-inside: avoid; }
  footer { margin-top: 14px; border-top: 1px solid #cfd6e2; padding-top: 5px; color: #6b7487; font-size: 9.5px; }
  @media print { .barra { display: none; } body { padding: 0; } }
</style></head><body>
<div class="barra"><button type="button" onclick="if(parent!==window){parent.postMessage({tipo:'gestor-imprimir'}, location.origin)}else{window.print()}">Imprimir / Salvar PDF</button></div>
<header>
  <div><h1>Prévia da alteração em massa</h1><div class="loja">${esc(contexto.nome || '')}${contexto.cnpj ? ` · CNPJ ${esc(contexto.cnpj)}` : ''}</div></div>
  <div class="meta">${esc(agora.toLocaleDateString('pt-BR'))} ${esc(agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))}${quem ? `<br>Gerado por ${esc(quem)}` : ''}<br>${esc(contexto.regime || '')}</div>
</header>
<div class="aviso">Prévia: nada foi gravado ainda. Os valores só mudam depois de clicar em Aplicar.</div>
<div class="resumo">
  <div class="caixa"><h3>Escopo</h3><p>${esc(descreverEscopo(body))}</p><h3 style="margin-top:6px">Condição (SE)</h3><p>${esc(descreverCondicao(body))}</p></div>
  <div class="caixa"><h3>Campos que serão aplicados</h3><ul class="acoes">${acoes}</ul></div>
</div>
<div class="numeros">
  <div><span>Produtos no escopo</span><b>${esc(res.total)}</b></div>
  <div class="muda"><span>Vão mudar</span><b>${esc(res.com_mudanca)}</b></div>
  <div><span>Já estão com esses valores</span><b>${esc(res.sem_mudanca)}</b></div>
</div>
<h2>O que cada produto vai receber</h2>
${linhas ? `<table><thead><tr><th>ID</th><th>Produto</th><th>Campo</th><th>Valor atual</th><th></th><th>Novo valor</th></tr></thead><tbody>${linhas}</tbody></table>`
    : '<p>Nenhum produto muda: todos já estão com esses valores.</p>'}
${iguais ? `<h2>Sem alteração (já estão com esses valores)</h2><ul class="iguais">${iguais}</ul>` : ''}
<footer>Cada campo alterado fica registrado no relatório de Alterações, com o valor anterior, o novo, quem fez e a data.</footer>
</body></html>`;
  }

  function abrirRelatorio(html) {
    const dlg = $('#dlg-danfe');
    const frame = $('#dlg-danfe-frame');
    const barra = dlg?.querySelector('.dlg-danfe-bar strong');
    if (dlg && frame && typeof dlg.showModal === 'function') {
      if (barra) barra.textContent = 'Prévia da alteração em massa';
      frame.removeAttribute('src');
      frame.srcdoc = html;
      if (!dlg.open) dlg.showModal();
      return;
    }
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
  }

  async function aplicar() {
    if (!previaPronta) {
      const ver = await deps.showConfirm?.(
        'Você ainda não viu a prévia desta alteração. Quer ver o relatório antes de aplicar?',
        { okLabel: 'Ver prévia', cancelLabel: 'Não, continuar' },
      );
      if (ver) {
        await verPrevia();
        return;
      }
    }
    const body = previaPronta || regra();
    const res0 = await consultarPrevia(body);
    if (!res0) return;
    if (!res0.com_mudanca) {
      deps.showMsg?.(`Nenhum produto muda: os ${res0.total} do escopo já estão com esses valores.`);
      return;
    }
    const ok = await deps.showConfirm?.(
      `Aplicar a alteração em ${res0.com_mudanca} produto(s)? ${res0.sem_mudanca ? `${res0.sem_mudanca} já estão com esses valores e não mudam. ` : ''}A gravação é feita no cadastro agora.`,
      { okLabel: 'Aplicar', cancelLabel: 'Cancelar' },
    );
    if (!ok) return;
    const res = await api('/massa/aplicar', { method: 'POST', body });
    if (!res.ok) {
      deps.showMsg?.(res.error || 'Não foi possível aplicar.');
      return;
    }
    deps.showToast?.(`${res.alterados || 0} produto(s) atualizados. O relatório de Alterações guarda o antes e o depois.`);
    previaPronta = null;
    selecionados = new Set();
    carregar();
  }

  global.Contador = {
    init(next) { deps = { ...deps, ...next }; },
    onPageEnter() { carregar(); },
  };
}(window));
