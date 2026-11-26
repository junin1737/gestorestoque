/* Contingência: abrir e editar O.S na base deste computador e imprimir. Sem venda no Clipp até sincronizar. */
(async function () {
  const api = await ponte();
  const raiz = document.getElementById('raiz');
  const st = { dados: null, os: null, aba: 'P', busca: '' };
  const $ = (s, r = document) => r.querySelector(s);

  function nomeStatus(id) {
    return (st.dados?.statuses || []).find((s) => s.id === id)?.descricao || '—';
  }

  /* ---------------- Login ---------------- */
  async function telaLogin() {
    const r = await api.ctg_usuarios();
    const usuarios = r.usuarios || [];
    raiz.innerHTML = `<main class="centro"><form class="cartao" id="f">
      <div><h1>Entrar na contingência</h1><p class="muted">Mesmo usuário e senha do Gestor. Só aparece quem já entrou neste computador com o servidor no ar.</p></div>
      ${usuarios.length ? `<label>Usuário<select class="campo" id="u">${usuarios.map((u) => `<option value="${u.id}">${esc(u.nome)}</option>`).join('')}</select></label>
      <label>Senha<input class="campo" id="s" type="password" autocomplete="off" autofocus></label>
      <p class="erro" id="e"></p>
      <div class="acoes"><button class="btn pri" type="submit">Entrar</button></div>`
      : '<p class="erro">Nenhum usuário entrou neste computador com o servidor no ar. A contingência precisa de um login feito antes, com o servidor funcionando.</p>'}
      <p class="muted" data-versao></p>
    </form></main>`;
    $('#f')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rr = await api.ctg_login(Number($('#u').value), $('#s').value);
      if (!rr.ok) { $('#e').textContent = rr.error; return; }
      $('#faixa-usuario').textContent = rr.usuario.nome;
      st.dados = await api.ctg_dados();
      telaLista();
    });
  }

  /* ---------------- Lista ---------------- */
  async function telaLista() {
    st.os = null;
    const r = await api.ctg_listar(st.busca);
    if (!r.ok) { telaLogin(); return; }
    const copia = st.dados?.copia_em ? new Date(st.dados.copia_em).toLocaleString('pt-BR') : '—';
    raiz.innerHTML = `<div class="pagina">
      <div class="topo"><div><h1>Ordens de serviço</h1><p class="muted">Cópia do servidor de ${esc(copia)}</p></div><span class="esp"></span>
        <input class="campo" id="busca" placeholder="Número, cliente ou equipamento" style="max-width:320px" value="${esc(st.busca)}">
        <button class="btn pri" id="nova">+ Nova O.S</button></div>
      <section class="grupo"><table class="lista"><thead><tr><th>O.S</th><th>Cliente</th><th>Equipamento</th><th>Status</th><th>Técnico</th><th>Previsão</th><th></th></tr></thead>
      <tbody>${(r.os || []).map((o) => `<tr data-chave="${esc(o.chave)}">
        <td><b>${esc(o.numero)}</b></td><td>${esc(o.cliente)}</td><td>${esc(o.equipamento)}</td><td>${esc(nomeStatus(o.id_status))}</td>
        <td>${esc(o.tecnico)}</td><td>${esc(dataBr(o.previsao))}</td>
        <td>${o.situacao === 'erro' ? `<span class="etq erro" title="${esc(o.erro)}">Erro ao enviar</span>` : o.situacao === 'conflito' ? '<span class="etq conf">Conflito</span>' : o.pendente ? '<span class="etq pend">A enviar</span>' : ''}</td>
      </tr>`).join('') || '<tr><td colspan="7" class="muted">Nenhuma O.S</td></tr>'}</tbody></table></section>
    </div>`;
    $('#nova').addEventListener('click', () => telaOs(null));
    let t = 0;
    $('#busca').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { st.busca = e.target.value; telaLista(); }, 250); });
    raiz.querySelectorAll('tr[data-chave]').forEach((tr) => tr.addEventListener('click', () => telaOs(tr.dataset.chave)));
  }

  /* ---------------- O.S ---------------- */
  function novaOs() {
    const primeiro = (st.dados?.statuses || []).find((s) => s.ativo && !s.final);
    return { tipo: 'I', modalidade: 'P', id_status: primeiro?.id || null, id_tecnico: null, quem_trouxe: '', equipamento: '', defeito: '', solucao: '', obs: '',
      previsao: '', id_cliente: 0, cliente: null, desc_geral: 0, acres_geral: 0, frete: 0, deslocamento: 0, itens: [] };
  }

  async function telaOs(chave) {
    if (chave) {
      const r = await api.ctg_abrir(chave);
      if (!r.ok) { alert(r.error); return; }
      st.os = r.os;
    } else st.os = novaOs();
    desenharOs();
  }

  function desenharOs() {
    const o = st.os;
    const enviada = !!o.id_pedido;
    const titulo = o._chave ? (o._chave.startsWith('S') ? `O.S ${o._chave.slice(1)}` : o._chave) : 'Nova O.S (número provisório ao gravar)';
    const opcStatus = (st.dados?.statuses || []).filter((s) => s.ativo || s.id === o.id_status).map((s) => `<option value="${s.id}" ${s.id === o.id_status ? 'selected' : ''}>${esc(s.descricao)}</option>`).join('');
    const opcTec = `<option value="">Sem técnico</option>${(st.dados?.tecnicos || []).map((t) => `<option value="${t.id}" ${t.id === o.id_tecnico ? 'selected' : ''}>${esc(t.nome)}</option>`).join('')}`;
    raiz.innerHTML = `<div class="pagina">
      <div class="topo"><button class="btn" id="voltar-lista">‹ Lista</button><h1>${esc(titulo)}</h1><span class="esp"></span>
        <button class="btn" id="imp-a4">Imprimir A4</button><button class="btn" id="imp-80">Imprimir 80 mm</button><button class="btn pri" id="gravar">Gravar</button></div>
      ${enviada ? '<p class="erro">Esta O.S já foi para a venda: na contingência só dá para consultar.</p>' : ''}
      <section class="grupo"><header><h2>Cliente</h2></header><div class="corpo">
        <div class="rel"><input class="campo" id="cli-busca" placeholder="Código, nome, CPF ou CNPJ" value="${esc(o.cliente?.nome || '')}" autocomplete="off"><div class="res" id="cli-res" hidden></div></div>
        <p class="muted" id="cli-info">${o.cliente?.id ? esc([o.cliente.documento, o.cliente.telefone, o.cliente.endereco].filter(Boolean).join(' · ')) : 'Clientes da cópia do servidor. Cliente novo só com o servidor no ar.'}</p>
      </div></section>
      <section class="grupo"><header><h2>Equipamento e defeito</h2></header><div class="corpo">
        <div class="g4">
          <label>Tipo<select class="campo" id="tipo"><option value="I" ${o.tipo !== 'E' ? 'selected' : ''}>Interna</option><option value="E" ${o.tipo === 'E' ? 'selected' : ''}>Externa</option></select></label>
          <label>Modalidade<select class="campo" id="modalidade"><option value="P" ${o.modalidade !== 'R' ? 'selected' : ''}>Presencial</option><option value="R" ${o.modalidade === 'R' ? 'selected' : ''}>Remota</option></select></label>
          <label>Status<select class="campo" id="status">${opcStatus}</select></label>
          <label>Técnico<select class="campo" id="tecnico">${opcTec}</select></label>
        </div>
        <div class="g2">
          <label>Quem trouxe<input class="campo" id="quem" value="${esc(o.quem_trouxe)}"></label>
          <label>Previsão<input class="campo" id="previsao" type="date" value="${esc(String(o.previsao || '').slice(0, 10))}"></label>
        </div>
        <label>Equipamento<input class="campo" id="equip" value="${esc(o.equipamento)}"></label>
        <label>Defeito apresentado<textarea class="campo" id="defeito">${esc(o.defeito)}</textarea></label>
        <label>Solução<textarea class="campo" id="solucao">${esc(o.solucao)}</textarea></label>
        <label>Observações<textarea class="campo" id="obs">${esc(o.obs)}</textarea></label>
      </div></section>
      <section class="grupo"><header><h2>Produtos e serviços</h2><span class="esp"></span>
        <div class="seg"><button type="button" data-aba="P" class="${st.aba === 'P' ? 'on' : ''}">Produtos</button><button type="button" data-aba="S" class="${st.aba === 'S' ? 'on' : ''}">Serviços</button></div></header>
        <div class="corpo">
          ${enviada ? '' : `<div class="rel"><input class="campo" id="it-busca" placeholder="Pesquisar ${st.aba === 'S' ? 'serviço' : 'produto'} por código, código de barras ou descrição" autocomplete="off"><div class="res" id="it-res" hidden></div></div>`}
          <table class="lista"><thead><tr><th>Descrição</th><th class="num">Qtd</th><th class="num">Unitário</th><th class="num">Desconto</th><th class="num">Total</th><th></th></tr></thead><tbody id="itens"></tbody></table>
          <div class="duas"><div class="g2">
            <label>Desconto geral (R$)<input class="campo num" id="desc" value="${o.desc_geral || ''}" inputmode="decimal"></label>
            <label>Acréscimo geral (R$)<input class="campo num" id="acres" value="${o.acres_geral || ''}" inputmode="decimal"></label>
            <label>Frete (R$)<input class="campo num" id="frete" value="${o.frete || ''}" inputmode="decimal"></label>
            <label>Deslocamento (R$)<input class="campo num" id="desl" value="${o.deslocamento || ''}" inputmode="decimal"></label>
          </div><div class="totais" id="totais"></div></div>
          <p class="muted">Desconto acima do limite precisa de senha do supervisor ou gerente, e isso só existe com o servidor no ar.</p>
        </div></section>
      <p class="erro" id="erro"></p>
    </div>`;
    ligarOs(enviada);
    desenharItens(enviada);
  }

  function lerTela() {
    const o = st.os;
    o.tipo = $('#tipo').value; o.modalidade = $('#modalidade').value;
    o.id_status = Number($('#status').value) || null; o.id_tecnico = Number($('#tecnico').value) || null;
    o.quem_trouxe = $('#quem').value; o.previsao = $('#previsao').value; o.equipamento = $('#equip').value;
    o.defeito = $('#defeito').value; o.solucao = $('#solucao').value; o.obs = $('#obs').value;
    o.desc_geral = numTela($('#desc').value); o.acres_geral = numTela($('#acres').value);
    o.frete = numTela($('#frete').value); o.deslocamento = numTela($('#desl').value);
    return o;
  }

  async function desenharItens(enviada) {
    const r = await api.ctg_calcular(lerTela());
    const c = r.calculo;
    $('#itens').innerHTML = c.itens.map((it, i) => `<tr>
      <td>${esc(it.descricao)} <span class="etq">${it.tipo === 'S' ? 'Serviço' : 'Produto'}</span></td>
      <td class="num">${it.tipo === 'S' ? '—' : `<input class="campo num" data-q="${i}" value="${it.qtd}" style="width:80px" ${enviada ? 'disabled' : ''}>`}</td>
      <td class="num"><input class="campo num" data-v="${i}" value="${String(it.vlr_unit).replace('.', ',')}" style="width:110px" ${enviada ? 'disabled' : ''}></td>
      <td class="num"><input class="campo num" data-d="${i}" value="${it.desc_item ? String(it.desc_item).replace('.', ',') : ''}" style="width:100px" ${enviada ? 'disabled' : ''}></td>
      <td class="num">${moeda(it.total)}</td>
      <td>${enviada ? '' : `<button class="btn perigo" data-x="${i}" title="Tirar">✕</button>`}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nenhum item</td></tr>';
    const t = c.totais;
    $('#totais').innerHTML = `<div><span>Produtos</span><b>${moeda(t.bruto_produtos)}</b></div><div><span>Serviços</span><b>${moeda(t.bruto_servicos)}</b></div>
      ${t.desconto_total ? `<div><span>Descontos</span><b>− ${moeda(t.desconto_total)}</b></div>` : ''}${t.acrescimo_total ? `<div><span>Acréscimos</span><b>${moeda(t.acrescimo_total)}</b></div>` : ''}
      ${t.frete ? `<div><span>Frete</span><b>${moeda(t.frete)}</b></div>` : ''}${t.deslocamento ? `<div><span>Deslocamento</span><b>${moeda(t.deslocamento)}</b></div>` : ''}
      <div class="total"><span>Total</span><b>${moeda(t.total)}</b></div>`;
    const mudar = (campo, conv) => (e) => {
      const i = Number(e.target.dataset[campo]);
      st.os.itens[i][{ q: 'qtd', v: 'vlr_unit', d: 'desc_item' }[campo]] = conv(e.target.value);
      desenharItens(enviada);
    };
    $('#itens').querySelectorAll('[data-q]').forEach((el) => el.addEventListener('change', mudar('q', numTela)));
    $('#itens').querySelectorAll('[data-v]').forEach((el) => el.addEventListener('change', mudar('v', numTela)));
    $('#itens').querySelectorAll('[data-d]').forEach((el) => el.addEventListener('change', mudar('d', numTela)));
    $('#itens').querySelectorAll('[data-x]').forEach((el) => el.addEventListener('click', () => { st.os.itens.splice(Number(el.dataset.x), 1); desenharItens(enviada); }));
  }

  function busca(input, caixa, buscar, montar, escolher) {
    let t = 0;
    input.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const lista = await buscar(input.value);
        caixa.hidden = !lista.length;
        caixa.innerHTML = lista.map((x, i) => `<button type="button" data-i="${i}">${montar(x)}</button>`).join('');
        caixa.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { caixa.hidden = true; escolher(lista[Number(b.dataset.i)]); }));
      }, 200);
    });
    input.addEventListener('blur', () => setTimeout(() => { caixa.hidden = true; }, 200));
  }

  function ligarOs(enviada) {
    $('#voltar-lista').addEventListener('click', () => telaLista());
    busca($('#cli-busca'), $('#cli-res'), async (q) => (await api.ctg_clientes(q)).clientes || [],
      (c) => `<b>${esc(c.nome)}</b><small>${esc([c.id, c.documento, c.telefone].filter(Boolean).join(' · '))}</small>`,
      (c) => { st.os.id_cliente = c.id; st.os.cliente = c; $('#cli-busca').value = c.nome; $('#cli-info').textContent = [c.documento, c.telefone, c.endereco].filter(Boolean).join(' · '); });
    raiz.querySelectorAll('[data-aba]').forEach((b) => b.addEventListener('click', () => { lerTela(); st.aba = b.dataset.aba; desenharOs(); }));
    if (!enviada) {
      busca($('#it-busca'), $('#it-res'), async (q) => (await api.ctg_itens(q, st.aba === 'S')).itens || [],
        (it) => `<b>${esc(it.descricao)}</b><small>${esc([it.id, it.referencia, it.cod_barras].filter(Boolean).join(' · '))} · ${moeda(it.preco)}</small>`,
        (it) => {
          st.os.itens.push({ id_identificador: it.id, descricao: it.descricao, tipo: it.servico ? 'S' : 'P', unidade: it.unidade, qtd: 1, vlr_unit: it.preco, desc_item: 0, acres_item: 0 });
          $('#it-busca').value = '';
          desenharItens(false);
        });
    }
    ['#desc', '#acres', '#frete', '#desl'].forEach((s) => $(s).addEventListener('change', () => desenharItens(enviada)));
    $('#gravar').addEventListener('click', async () => {
      const r = await api.ctg_salvar(lerTela());
      if (!r.ok) { $('#erro').textContent = r.error; return; }
      st.os._chave = r.chave;
      $('#erro').className = 'ok';
      $('#erro').textContent = `Gravada neste computador como ${r.numero}. Vai para o servidor na sincronização.`;
      const titulo = raiz.querySelector('.topo h1');
      if (titulo) titulo.textContent = r.chave.startsWith('S') ? `O.S ${r.numero}` : r.numero;
    });
    const imprimir = async (formato) => {
      if (!st.os._chave) { $('#erro').textContent = 'Grave a O.S antes de imprimir.'; return; }
      const r = await api.ctg_imprimir(st.os._chave, formato, st.os.solucao ? 'fechamento' : 'abertura');
      if (!r.ok) $('#erro').textContent = r.error;
    };
    $('#imp-a4').addEventListener('click', () => imprimir('a4'));
    $('#imp-80').addEventListener('click', () => imprimir('80'));
  }

  /* ---------------- Servidor voltou ---------------- */
  document.getElementById('voltar').addEventListener('click', async () => {
    const r = await api.ctg_voltar_servidor();
    if (!r.ok) alert(r.error);
  });
  window.gestorServidorVoltou = () => {
    const f = document.getElementById('faixa');
    f.classList.add('voltou');
    document.getElementById('faixa-texto').textContent = 'O servidor voltou. Entre no Gestor para sincronizar as O.S desta contingência.';
    document.getElementById('voltar').textContent = 'Voltar ao servidor';
  };

  telaLogin();
}());
