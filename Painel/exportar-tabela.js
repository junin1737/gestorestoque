(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ExportarTabela = api;
}(typeof window !== 'undefined' ? window : globalThis, function exportarTabela() {
  function xml(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function texto(v) {
    const s = String(v ?? '').trim();
    return s || '—';
  }

  function larguraExcel(coluna) {
    if (['descricao', 'anterior', 'atual'].includes(coluna.id)) return 320;
    if (['ncm', 'cod_ncm'].includes(coluna.id)) return 110;
    return 100;
  }

  function agora() {
    return GestorHora.textoCompleto();
  }

  function nomeArquivo(titulo) {
    return String(titulo || 'relatorio')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'relatorio';
  }

  function htmlPdf(opcoes) {
    const colunas = opcoes.colunas || [];
    const linhas = opcoes.linhas || [];
    const head = colunas.map((c) => `<th>${xml(c.titulo)}</th>`).join('');
    const cols = colunas.map((c) => `<col style="width:${xml(c.largura || `${Math.floor(100 / (colunas.length || 1))}%`)}">`).join('');
    const body = linhas.length
      ? linhas.map((linha) => `<tr>${colunas.map((c) => `<td class="${c.numero ? 'num' : ''}">${xml(texto(linha[c.id]))}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${colunas.length || 1}">Nenhum registro</td></tr>`;
    const foot = opcoes.total && linhas.length
      ? `<tfoot><tr>${colunas.map((c) => `<td class="${c.numero ? 'num' : ''}">${xml(opcoes.total[c.id] ?? '')}</td>`).join('')}</tr></tfoot>`
      : '';
    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>${xml(opcoes.titulo || 'Relatório')}</title>
<style>
@page { size: A4 ${opcoes.paisagem === false ? 'portrait' : 'landscape'}; margin: 12mm 12mm 14mm; }
html, body { background: #fff; color: #1c2430; }
body { font-family: "Segoe UI", Arial, sans-serif; font-size: 11px; margin: 0; padding: 16px; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
header { border-bottom: 3px solid #1f4e79; padding-bottom: 8px; margin-bottom: 12px; }
.empresa { font-size: 12px; font-weight: 700; letter-spacing: .02em; }
h1 { font-size: 18px; margin: 2px 0 0; color: #1f4e79; }
.meta { margin: 4px 0 0; color: #445066; }
thead { display: table-header-group; }
th { background: #1f4e79; color: #fff; text-align: left; padding: 6px 8px; font-size: 10px; letter-spacing: .03em; }
td { border-bottom: 1px solid #d5dde8; padding: 5px 8px; vertical-align: top; overflow-wrap: anywhere; }
tr:nth-child(even) td { background: #f4f7fb; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
tfoot td { font-weight: 700; border-top: 2px solid #1f4e79; background: #eef3f9; }
.aviso { background: #fff4e5; border: 1px solid #e6b15c; padding: 8px 10px; font-weight: 700; margin: 0 0 10px; }
.termo { font-size: 10px; line-height: 1.45; margin: 0 0 8px; white-space: pre-wrap; }
.rodape { margin-top: 14px; color: #5c6b7a; font-size: 10px; }
@media print { body { padding: 0; } .no-print { display: none; } }
</style></head><body>
<header>
  <div class="empresa">${xml(opcoes.empresa || 'Gestor de Estoque')}</div>
  <h1>${xml(opcoes.titulo || 'Relatório')}</h1>
  <p class="meta">${xml(opcoes.subtitulo || '')}${opcoes.subtitulo ? ' · ' : ''}${linhas.length.toLocaleString('pt-BR')} registro(s) · ${xml(opcoes.usuario ? `Usuário ${opcoes.usuario} · ` : '')}Gerado em ${xml(opcoes.geradoEm || agora())}</p>
</header>
${opcoes.aviso ? `<p class="aviso">${xml(opcoes.aviso)}</p>` : ''}
${(opcoes.paragrafos || []).map((p) => `<p class="termo">${xml(p)}</p>`).join('')}
<table><colgroup>${cols}</colgroup><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>
<p class="rodape">Documento para conferência do usuário e do contador. Gestor de Estoque · MT Automações</p>
${opcoes.embutido ? '' : '<p class="no-print"><button type="button" onclick="window.print()">Imprimir / Salvar PDF</button></p>'}
</body></html>`;
  }

  const WIN = {
    '—': 0x97, '–': 0x96, '•': 0x95, '“': 0x93, '”': 0x94, '‘': 0x91, '’': 0x92,
    'á': 0xE1, 'à': 0xE0, 'â': 0xE2, 'ã': 0xE3, 'ä': 0xE4,
    'é': 0xE9, 'ê': 0xEA, 'í': 0xED, 'ó': 0xF3, 'ô': 0xF4, 'õ': 0xF5, 'ö': 0xF6,
    'ú': 0xFA, 'ü': 0xFC, 'ç': 0xE7, 'ñ': 0xF1,
    'Á': 0xC1, 'À': 0xC0, 'Â': 0xC2, 'Ã': 0xC3, 'Ä': 0xC4,
    'É': 0xC9, 'Ê': 0xCA, 'Í': 0xCD, 'Ó': 0xD3, 'Ô': 0xD4, 'Õ': 0xD5, 'Ö': 0xD6,
    'Ú': 0xDA, 'Ü': 0xDC, 'Ç': 0xC7, 'Ñ': 0xD1,
  };

  function pdfLiteral(valor) {
    let out = '(';
    for (const ch of String(valor ?? '')) {
      const code = ch.codePointAt(0);
      const b = code < 128 ? code : (WIN[ch] || 0x3F);
      if (b === 40 || b === 41 || b === 92) out += `\\${String.fromCharCode(b)}`;
      else if (b < 32 || b > 126) out += `\\${b.toString(8).padStart(3, '0')}`;
      else out += String.fromCharCode(b);
    }
    return `${out})`;
  }

  function quebrar(valor, largura, tamanho) {
    const max = Math.max(8, Math.floor(largura / (tamanho * 0.5)));
    const palavras = String(valor ?? '').split(/\s+/).filter(Boolean);
    const linhas = [];
    let atual = '';
    palavras.forEach((palavra) => {
      const partes = palavra.length > max ? palavra.match(new RegExp(`.{1,${max}}`, 'g')) : [palavra];
      partes.forEach((parte) => {
        const proxima = atual ? `${atual} ${parte}` : parte;
        if (proxima.length > max && atual) {
          linhas.push(atual);
          atual = parte;
        } else atual = proxima;
      });
    });
    if (atual) linhas.push(atual);
    return linhas.length ? linhas : ['—'];
  }

  function pdfBytes(opcoes) {
    const paisagem = opcoes.paisagem !== false;
    const W = paisagem ? 841.89 : 595.28;
    const H = paisagem ? 595.28 : 841.89;
    const M = 32;
    const L = W - M * 2;
    const paginas = [];
    let cmds = '';
    let y = H - M;
    const guardar = () => { if (cmds) paginas.push(cmds); cmds = ''; y = H - M; };
    const cabe = (h) => { if (y - h < M) guardar(); };
    const escrever = (s, tamanho, fonte, cor) => {
      const partes = quebrar(s, L, tamanho);
      cabe(partes.length * (tamanho + 3));
      partes.forEach((parte) => {
        y -= tamanho;
        cmds += `${cor} rg\nBT /${fonte} ${tamanho} Tf 1 0 0 1 ${M.toFixed(1)} ${y.toFixed(1)} Tm ${pdfLiteral(parte)} Tj ET\n`;
        y -= 3;
      });
    };
    escrever(opcoes.empresa || 'Gestor de Estoque', 11, 'F2', '0.12 0.31 0.47');
    escrever(opcoes.titulo || 'Relatório', 16, 'F2', '0.12 0.31 0.47');
    const meta = `${opcoes.subtitulo ? `${opcoes.subtitulo} · ` : ''}${(opcoes.linhas || []).length} registro(s)${opcoes.usuario ? ` · ${opcoes.usuario}` : ''} · ${opcoes.geradoEm || agora()}`;
    escrever(meta, 9, 'F1', '0.27 0.31 0.40');
    if (opcoes.aviso) escrever(opcoes.aviso, 9, 'F2', '0.55 0.27 0.05');
    (opcoes.paragrafos || []).filter(Boolean).forEach((p) => escrever(p, 8, 'F1', '0.15 0.18 0.22'));
    y -= 6;
    const colunas = opcoes.colunas || [];
    const linhas = opcoes.linhas?.length ? opcoes.linhas : [{}];
    const larguras = colunas.map((c) => {
      const n = parseFloat(c.largura);
      return ((Number.isFinite(n) ? n : (100 / (colunas.length || 1))) / 100) * L;
    });
    const ft = 8;
    const cabeca = () => {
      const alt = ft + 10;
      cabe(alt);
      y -= alt;
      cmds += `0.12 0.31 0.47 rg ${M.toFixed(1)} ${y.toFixed(1)} ${L.toFixed(1)} ${alt.toFixed(1)} re f\n`;
      let x = M;
      colunas.forEach((c, i) => {
        cmds += `1 1 1 rg\nBT /F2 ${ft} Tf 1 0 0 1 ${(x + 3).toFixed(1)} ${(y + 3).toFixed(1)} Tm ${pdfLiteral(c.titulo)} Tj ET\n`;
        x += larguras[i];
      });
    };
    if (colunas.length) cabeca();
    const extra = opcoes.total && opcoes.linhas?.length ? [{ ...opcoes.total, __total: true }] : [];
    linhas.concat(extra).forEach((linha, idx) => {
      const fonte = linha.__total ? 'F2' : 'F1';
      const celulas = colunas.map((c, i) => quebrar(linha.__total ? (linha[c.id] ?? ' ') : texto(linha[c.id]), larguras[i] - 6, ft));
      const n = Math.max(1, ...celulas.map((c) => c.length));
      const alt = n * (ft + 2) + 6;
      if (y - alt < M) { guardar(); cabeca(); }
      y -= alt;
      if (idx % 2 === 1) cmds += `0.956 0.969 0.984 rg ${M.toFixed(1)} ${y.toFixed(1)} ${L.toFixed(1)} ${alt.toFixed(1)} re f\n`;
      let x = M;
      celulas.forEach((ls, i) => {
        ls.forEach((t, k) => {
          const ty = y + alt - 4 - ft - k * (ft + 2);
          cmds += `0.11 0.14 0.19 rg\nBT /${fonte} ${ft} Tf 1 0 0 1 ${(x + 3).toFixed(1)} ${ty.toFixed(1)} Tm ${pdfLiteral(t)} Tj ET\n`;
        });
        x += larguras[i];
      });
      cmds += `0.83 0.87 0.91 RG 0.4 w ${M.toFixed(1)} ${y.toFixed(1)} m ${(M + L).toFixed(1)} ${y.toFixed(1)} l S\n`;
    });
    y -= 14;
    escrever('Documento para conferência do usuário e do contador. Gestor de Estoque · MT Automações', 8, 'F1', '0.36 0.42 0.48');
    if (cmds) paginas.push(cmds);
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    ];
    const kids = [];
    paginas.forEach((stream) => {
      const cid = objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`) ;
      const pid = objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${cid} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`);
      kids.push(`${pid} 0 R`);
    });
    objs[1] = `<< /Type /Pages /Count ${kids.length} /Kids [${kids.join(' ')}] >>`;
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objs.forEach((body, i) => {
      offsets.push(pdf.length);
      pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((o) => { pdf += `${String(o).padStart(10, '0')} 00000 n \n`; });
    pdf += `trailer << /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return pdf;
  }

  let previaAtual = null;
  let resolverAceite = null;

  function fecharPrevia(valor) {
    const resolver = resolverAceite;
    resolverAceite = null;
    const dlg = typeof document !== 'undefined' ? document.getElementById('dlg-previa') : null;
    try { if (dlg?.open) dlg.close(); } catch { /* ignore */ }
    if (resolver) resolver(valor);
  }

  function appNativo() {
    return typeof window !== 'undefined' && window.GestorApp ? window.GestorApp : null;
  }

  function blobBase64(blob) {
    return new Promise((resolve, reject) => {
      const leitor = new FileReader();
      leitor.onload = () => resolve(String(leitor.result || '').split(',')[1] || '');
      leitor.onerror = () => reject(leitor.error);
      leitor.readAsDataURL(blob);
    });
  }

  /**
   * Salva um arquivo gerado na tela. No navegador baixa pelo link; no APK o WebView ignora
   * download de blob, então o arquivo vai para o compartilhar do Android (Arquivos, Drive,
   * WhatsApp, e-mail). Devolve false quando o aparelho não tem como salvar.
   */
  async function salvarArquivo(blob, nome) {
    const app = appNativo();
    if (app) {
      if (typeof app.shareFile === 'function') {
        app.shareFile(nome, blob.type || 'application/octet-stream', await blobBase64(blob));
        return true;
      }
      return false;
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = nome;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1500);
    return true;
  }

  async function baixarAtual() {
    if (!previaAtual) return;
    const pdf = pdfBytes(previaAtual);
    const blob = new Blob([pdf], { type: 'application/pdf' });
    if (await salvarArquivo(blob, `${nomeArquivo(previaAtual.titulo)}.pdf`)) return;
    // APK antigo, sem shareFile: a impressão do Android tem "Salvar como PDF".
    const app = appNativo();
    if (app && typeof app.printHtml === 'function') app.printHtml(previaAtual.titulo || 'relatorio', htmlPdf({ ...previaAtual, embutido: true }));
  }

  function garantirDialog() {
    let dlg = document.getElementById('dlg-previa');
    if (dlg && !dlg.querySelector('[data-previa-confirma]')) {
      dlg.remove();
      dlg = null;
    }
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.id = 'dlg-previa';
    dlg.className = 'dlg';
    dlg.innerHTML = `
      <div class="dlg-card previa-card">
        <div class="previa-barra">
          <strong data-previa-titulo>Prévia</strong>
          <div class="dlg-actions">
            <button type="button" class="btn" data-previa-fechar>Fechar</button>
            <button type="button" class="btn primary" data-previa-baixar disabled>Baixar PDF</button>
          </div>
        </div>
        <iframe title="Prévia do relatório" data-previa-frame></iframe>
        <div class="previa-aceite" data-previa-aceite hidden>
          <div data-previa-form>
            <label class="termo-check"><input type="checkbox" data-previa-check /><span>Assinar o termo e autorizar a atualização</span></label>
            <div data-previa-assina hidden>
              <label>Nome completo <input data-previa-nome autocomplete="name" /></label>
              <label>CPF
                <input data-previa-cpf inputmode="numeric" maxlength="14" placeholder="000.000.000-00" autocomplete="off" />
                <span class="termo-erro" data-previa-cpf-erro hidden></span>
              </label>
            </div>
            <p class="termo-erro" data-previa-erro hidden></p>
            <div class="dlg-actions">
              <button type="button" class="btn primary" data-previa-sim disabled>Aceitar termos</button>
            </div>
          </div>
          <div data-previa-confirma hidden>
            <p class="previa-pergunta">Deseja aplicar estas alterações na base?</p>
            <div class="dlg-actions">
              <button type="button" class="btn" data-previa-confirma-nao>Não</button>
              <button type="button" class="btn primary" data-previa-confirma-sim>Sim, aplicar</button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    dlg.querySelector('[data-previa-fechar]').addEventListener('click', () => fecharPrevia(null));
    dlg.querySelector('[data-previa-baixar]').addEventListener('click', baixarAtual);
    dlg.addEventListener('close', () => {
      if (!resolverAceite) return;
      const resolver = resolverAceite;
      resolverAceite = null;
      resolver(null);
    });
    return dlg;
  }

  function iniciarPrevia(opcoes = {}) {
    const dlg = garantirDialog();
    previaAtual = null;
    dlg.querySelector('[data-previa-titulo]').textContent = opcoes.titulo || 'Prévia';
    dlg.querySelector('[data-previa-baixar]').disabled = true;
    dlg.querySelector('[data-previa-aceite]').hidden = true;
    dlg.querySelector('[data-previa-form]').hidden = false;
    dlg.querySelector('[data-previa-confirma]').hidden = true;
    dlg.querySelector('[data-previa-frame]').srcdoc = paginaStatus(opcoes.titulo || 'Prévia', opcoes.carregando || 'Gerando a prévia…');
    if (!dlg.open) dlg.showModal();
    return {
      preencher(dados) {
        previaAtual = { ...dados, geradoEm: dados.geradoEm || agora() };
        dlg.querySelector('[data-previa-titulo]').textContent = previaAtual.titulo || 'Prévia';
        dlg.querySelector('[data-previa-frame]').srcdoc = htmlPdf({ ...previaAtual, embutido: true });
        dlg.querySelector('[data-previa-baixar]').disabled = false;
        if (!dlg.open) dlg.showModal();
      },
      ocupado(texto) {
        dlg.querySelector('[data-previa-titulo]').textContent = 'Aplicando';
        dlg.querySelector('[data-previa-baixar]').disabled = true;
        dlg.querySelector('[data-previa-aceite]').hidden = true;
        dlg.querySelector('[data-previa-form]').hidden = true;
        dlg.querySelector('[data-previa-confirma]').hidden = true;
        dlg.querySelector('[data-previa-frame]').srcdoc = paginaStatus('Aplicando', texto || 'Aplicando as alterações na base…');
      },
      ocultarAceite() {
        dlg.querySelector('[data-previa-aceite]').hidden = true;
      },
      aguardarAceite(termo) {
        const box = dlg.querySelector('[data-previa-aceite]');
        const form = dlg.querySelector('[data-previa-form]');
        const confirma = dlg.querySelector('[data-previa-confirma]');
        const check = dlg.querySelector('[data-previa-check]');
        const assina = dlg.querySelector('[data-previa-assina]');
        const nome = dlg.querySelector('[data-previa-nome]');
        const cpf = dlg.querySelector('[data-previa-cpf]');
        const erro = dlg.querySelector('[data-previa-erro]');
        const erroCpf = dlg.querySelector('[data-previa-cpf-erro]');
        const sim = dlg.querySelector('[data-previa-sim]');
        box.hidden = false;
        form.hidden = false;
        confirma.hidden = true;
        check.checked = false;
        assina.hidden = true;
        nome.value = '';
        cpf.value = '';
        cpf.classList.remove('cpf-invalido');
        erro.hidden = true;
        erroCpf.hidden = true;
        sim.disabled = true;
        const mostrarCpf = () => {
          const msg = mensagemCpf(cpf.value);
          const incompleto = String(cpf.value || '').replace(/\D/g, '').length < 11;
          erroCpf.hidden = !msg || incompleto;
          erroCpf.textContent = msg;
          cpf.classList.toggle('cpf-invalido', !!msg && !incompleto);
          return msg;
        };
        const atualizar = () => {
          assina.hidden = !check.checked;
          const msgCpf = check.checked ? mostrarCpf() : '';
          const nomeOk = nome.value.trim().split(/\s+/).filter((p) => p.length >= 2).length >= 2;
          const digitos = String(cpf.value || '').replace(/\D/g, '').length;
          if (!check.checked || (nomeOk && (!msgCpf || digitos === 11))) {
            erro.hidden = true;
          } else {
            erro.hidden = false;
            erro.textContent = nomeOk ? msgCpf : 'Informe o nome completo de quem assina.';
          }
          sim.disabled = !check.checked || !nomeOk || !!msgCpf;
        };
        const pendencia = () => {
          if (!check.checked) return 'Marque o aceite para assinar o termo.';
          if (nome.value.trim().split(/\s+/).filter((p) => p.length >= 2).length < 2) return 'Informe o nome completo de quem assina.';
          return mensagemCpf(cpf.value);
        };
        check.onchange = atualizar;
        nome.oninput = atualizar;
        cpf.oninput = () => { cpf.value = formatarCpf(cpf.value); atualizar(); };
        sim.onclick = () => {
          const msg = pendencia();
          erro.hidden = !msg;
          erro.textContent = msg || '';
          mostrarCpf();
          if (msg) return;
          form.hidden = true;
          confirma.hidden = false;
        };
        dlg.querySelector('[data-previa-confirma-nao]').onclick = () => {
          confirma.hidden = true;
          form.hidden = false;
        };
        dlg.querySelector('[data-previa-confirma-sim]').onclick = () => {
          const msg = pendencia();
          if (msg) {
            confirma.hidden = true;
            form.hidden = false;
            erro.hidden = false;
            erro.textContent = msg;
            return;
          }
          const resolver = resolverAceite;
          resolverAceite = null;
          confirma.hidden = true;
          if (resolver) resolver({ nome: nome.value.trim().replace(/\s+/g, ' '), cpf: cpf.value });
        };
        if (termo) dlg.dataset.termo = termo.titulo || '';
        return new Promise((resolve) => { resolverAceite = resolve; });
      },
      fechar() { fecharPrevia(null); },
    };
  }

  function paginaStatus(titulo, texto) {
    return `<!DOCTYPE html><html><body style="font-family:Segoe UI,Arial,sans-serif;padding:24px;color:#1c2430"><h1 style="color:#1f4e79;font-size:18px">${xml(titulo || '')}</h1><p>${xml(texto || '')}</p></body></html>`;
  }

  function mensagemCpf(valor) {
    const d = String(valor || '').replace(/\D/g, '');
    if (d.length !== 11) return 'Informe o CPF com 11 dígitos.';
    return cpfValido(valor) ? '' : 'CPF inválido.';
  }

  function cpfValido(valor) {
    const d = String(valor || '').replace(/\D/g, '');
    if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
    const dv = (tamanho) => {
      let soma = 0;
      for (let i = 0; i < tamanho; i++) soma += Number(d[i]) * ((tamanho + 1) - i);
      const resto = (soma * 10) % 11;
      return resto === 10 ? 0 : resto;
    };
    return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
  }

  function formatarCpf(valor) {
    const d = String(valor || '').replace(/\D/g, '').slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }

  function abrirPdf(opcoes) {
    const ui = iniciarPrevia({ titulo: opcoes.titulo || 'Relatório' });
    ui.preencher(opcoes);
    return true;
  }

  function excel(opcoes) {
    const colunas = opcoes.colunas || [];
    const linhas = opcoes.linhas || [];
    const celula = (valor, estilo) => {
      const estiloXml = estilo ? ` ss:StyleID="${estilo}"` : '';
      return `<Cell${estiloXml}><Data ss:Type="String">${xml(texto(valor))}</Data></Cell>`;
    };
    const larguras = colunas.map((c) => `<Column ss:Width="${larguraExcel(c)}"/>`).join('');
    const cabeca = colunas.map((c) => celula(c.titulo, 'cabeca')).join('');
    const corpo = linhas.map((linha) => `<Row>${colunas.map((c) => celula(linha[c.id])).join('')}</Row>`).join('')
      + (opcoes.total && linhas.length ? `<Row>${colunas.map((c) => celula(opcoes.total[c.id] ?? '', 'cabeca')).join('')}</Row>` : '');
    const xmlDoc = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
  <Style ss:ID="titulo"><Font ss:Bold="1" ss:Size="14" ss:Color="#1F4E79"/></Style>
  <Style ss:ID="meta"><Font ss:Size="10" ss:Color="#445066"/></Style>
  <Style ss:ID="cabeca"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1F4E79" ss:Pattern="Solid"/></Style>
</Styles>
<Worksheet ss:Name="Relatorio"><Table>${larguras}
<Row><Cell ss:MergeAcross="${Math.max(colunas.length - 1, 0)}" ss:StyleID="titulo"><Data ss:Type="String">${xml(opcoes.empresa || 'Gestor de Estoque')}</Data></Cell></Row>
<Row><Cell ss:MergeAcross="${Math.max(colunas.length - 1, 0)}" ss:StyleID="titulo"><Data ss:Type="String">${xml(opcoes.titulo || 'Relatório')}</Data></Cell></Row>
<Row><Cell ss:MergeAcross="${Math.max(colunas.length - 1, 0)}" ss:StyleID="meta"><Data ss:Type="String">${xml(`${opcoes.usuario ? `Usuário ${opcoes.usuario} · ` : ''}${linhas.length} registro(s) · ${opcoes.geradoEm || agora()}`)}</Data></Cell></Row>
<Row></Row>
<Row>${cabeca}</Row>
${corpo}
</Table></Worksheet></Workbook>`;
    const blob = new Blob([xmlDoc], { type: 'application/vnd.ms-excel;charset=utf-8' });
    salvarArquivo(blob, `${nomeArquivo(opcoes.titulo)}.xls`).then((ok) => {
      if (!ok && typeof window !== 'undefined') window.alert('Atualize o aplicativo para exportar em Excel pelo celular.');
    });
  }

  return { htmlPdf, abrirPdf, excel, nomeArquivo, pdfBytes, iniciarPrevia, salvarArquivo };
}));
