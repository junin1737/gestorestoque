/* Apoio das telas locais: espera a ponte do pywebview e aplica o tema do Gestor. */
(function () {
  const pronta = new Promise((resolve) => {
    if (window.pywebview && window.pywebview.api) resolve(window.pywebview.api);
    else window.addEventListener('pywebviewready', () => resolve(window.pywebview.api), { once: true });
  });
  window.ponte = () => pronta;
  window.esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.moeda = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  window.numTela = (v) => {
    const s = String(v ?? '').trim();
    if (!s) return 0;
    const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
    return Number.isFinite(n) ? n : 0;
  };
  window.dataBr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
  pronta.then(async (api) => {
    try {
      const info = await api.info();
      document.documentElement.dataset.theme = info.tema === 'escuro' ? 'escuro' : 'claro';
      document.querySelectorAll('[data-versao]').forEach((el) => { el.textContent = `versão ${info.versao} · ${info.maquina}`; });
    } catch { /* tema padrão */ }
  });
}());
