'use strict';

const { criarConectores } = require('./conectores');
const { lerArquivo, gravarArquivo, lerConfig, sanitizar, padrao } = require('./config-loja');
const { randomUUID } = require('crypto');
const { validarPublicacao, promoValida, descontoPercentual, modoDaLinha } = require('./regras-estoque');
const { montarRotina } = require('./regras-publicacao');

function hoje() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dia}`;
}

function preparar(produto, modulo) {
  const out = { ...produto, selecionado: false };
  if (!modulo) return out;
  if (modulo.preco != null && modulo.preco !== '') {
    const n = Number(modulo.preco);
    if (Number.isFinite(n)) out.preco = n;
  }
  if (Object.prototype.hasOwnProperty.call(modulo, 'preco_promocional')) {
    if (modulo.preco_promocional == null || modulo.preco_promocional === '') out.preco_promocional = null;
    else {
      const n = Number(modulo.preco_promocional);
      out.preco_promocional = Number.isFinite(n) ? n : null;
    }
  }
  if (Object.prototype.hasOwnProperty.call(modulo, 'promocao_inicio')) out.promocao_inicio = String(modulo.promocao_inicio || '');
  if (Object.prototype.hasOwnProperty.call(modulo, 'promocao_fim')) out.promocao_fim = String(modulo.promocao_fim || '');
  out.selecionado = modulo.selecionado === true;
  return out;
}

function publicar(produto, config, modulo, data) {
  const base = preparar(produto, modulo);
  const linha = anotar(base, config, modulo, data);
  linha.selecionado = base.selecionado === true;
  linha.modo_escolhido = modulo?.modo_escolhido === 'oferta' || modulo?.modo_escolhido === 'exposicao'
    ? modulo.modo_escolhido
    : '';
  linha.foto_url = String(modulo?.foto_url || '');
  linha.foto_chave = String(modulo?.foto_chave || '');
  linha.foto = !!(linha.foto_url || produto.foto);
  linha.modo = modoDaLinha(linha);
  linha.vendido_30d = Number(produto.vendido_30d || 0);
  linha.textos = produto.textos || {};
  return linha;
}

function dinheiro(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0 || v > 999999.99) throw new Error('Preço inválido.');
    return Math.round(v * 100) / 100;
  }
  let t = String(v).trim().replace(/\s/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if ((t.match(/\./g) || []).length > 1) t = t.replace(/\./g, '');
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 999999.99) throw new Error('Preço inválido.');
  return Math.round(n * 100) / 100;
}

function dataCampo(v) {
  const s = String(v || '').slice(0, 10);
  if (!s) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Data inválida.');
  return s;
}

function anotar(produto, config, modulo, data) {
  const extra = modulo?.ignorar_estoque === true ? { ignorar_estoque: true } : {};
  const base = { ...produto, ...extra };
  return {
    ...produto,
    ignorar_estoque: base.ignorar_estoque === true || modulo?.ignorar_estoque === true,
    detalhes_sobrescritos: String(modulo?.detalhes_sobrescritos || ''),
    promocao_valida: promoValida(produto, data),
    desconto: promoValida(produto, data) ? descontoPercentual(produto.preco, produto.preco_promocional) : null,
    exposicao: validarPublicacao({ produto: base, modo: 'exposicao', data, config, modulo }),
    oferta: validarPublicacao({ produto: base, modo: 'oferta', data, config, modulo }),
  };
}

function montar(router, deps) {
  const { auth, loadUsersConfig, loadAppConfig } = deps;
  const conectores = criarConectores(deps);

  function acesso(req, res, next) {
    if (require('../licenca').situacao().central_ofertas !== true) {
      return res.status(403).json({ ok: false, error: 'A Central de Ofertas não está liberada para esta loja.' });
    }
    return auth.exigirModulo('central_ofertas')(req, res, next);
  }

  async function lojaId() {
    try {
      const rows = await deps.withDb((db) => deps.query(db, 'SELECT FIRST 1 CNPJ FROM TB_EMITENTE'));
      const cnpj = String(rows[0]?.CNPJ || '').replace(/\D/g, '');
      if (cnpj) return cnpj;
    } catch { /* sem base: a loja local segue com dados simulados */ }
    return 'loja-local';
  }

  function podeAlterarPreco(req) {
    const u = req.usuario;
    if (!u) return false;
    if (u.supervisor) return true;
    if (u.permissoes?.central_ofertas?.preco === true) return true;
    const papel = (lerConfig().usuarios || []).find((x) => Number(x.id) === Number(u.id));
    return papel?.papel === 'preco';
  }

  function configEfetiva() {
    const config = lerConfig();
    const flag = Number(loadAppConfig()?.considerar_qtd_ofertas);
    if (flag === 0 || flag === 1) config.estoque.exigir_estoque_positivo = flag === 1;
    return config;
  }

function equipe() {
    const usuarios = loadUsersConfig(loadAppConfig()).usuarios || [];
    const papeis = new Map((lerConfig().usuarios || []).map((u) => [Number(u.id), u.papel]));
    return usuarios
      .filter((u) => !u.mtEntradas)
      .map((u) => ({
        id: Number(u.id),
        nome: u.nome,
        supervisor: !!u.supervisor,
        papel: u.supervisor ? 'preco' : (papeis.get(Number(u.id)) || 'agenda'),
      }));
  }

  router.get('/central-ofertas/config', acesso, async (_req, res) => {
    try {
      const config = configEfetiva();
      const campos = await conectores.erp.camposTexto();
      const sit = require('../licenca').situacao();
      const ig = {
        conectada: sit.instagram_configurado === true,
        usuario: '',
        token_expira_em: sit.instagram_expira || null,
        status: sit.instagram_configurado ? 'conectada' : 'desconectada',
      };
      res.json({
        ok: true,
        loja_id: await lojaId(),
        config,
        padrao: padrao(),
        janela: require('./regras-publicacao').capacidadeJanela(config.publicacao),
        modos: conectores.modos,
        campos_texto: campos,
        equipe: equipe(),
        instagram: ig,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message || 'Falha ao ler a Central de Ofertas.' });
    }
  });

  router.put('/central-ofertas/config', acesso, async (req, res) => {
    try {
      const campos = await conectores.erp.camposTexto();
      const { config, janela } = sanitizar(req.body || {}, campos);
      const { saveAppConfig, loadAppConfig: lerApp } = require('../config');
      saveAppConfig({
        ...lerApp(),
        considerar_qtd_ofertas: config.estoque?.exigir_estoque_positivo ? 1 : 0,
      });
      const dados = lerArquivo();
      dados.loja_id = await lojaId();
      dados.configuracao = config;
      gravarArquivo(dados);
      res.json({ ok: true, config, janela });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message || 'Falha ao salvar.' });
    }
  });

  router.get('/central-ofertas/produtos', acesso, async (req, res) => {
    try {
      const data = String(req.query.data || hoje());
      const config = configEfetiva();
      const mods = lerArquivo().produtos || {};
      const filtros = {
        q: req.query.q,
        grupo: req.query.grupo,
        com: req.query.com === '1',
        promo: req.query.promo === '1',
        ignorar: Object.entries(mods).filter(([, m]) => m?.ignorar_estoque).map(([id]) => id),
      };
      let lista = await conectores.erp.listarProdutos(filtros);
      if (req.query.vendidos === '1') {
        const totais = await conectores.erp.vendidos30();
        lista = lista.map((p) => ({ ...p, vendido_30d: Number(totais[String(p.id)] || 0) }));
      }
      const grupos = await conectores.erp.grupos().catch(() => (
        [...new Set(lista.map((p) => String(p.categoria || '').trim()).filter(Boolean))]
          .sort((a, b) => a.localeCompare(b, 'pt'))
      ));
      res.json({
        ok: true,
        data,
        exigir_estoque_positivo: config.estoque.exigir_estoque_positivo === true,
        pode_preco: podeAlterarPreco(req),
        grupos,
        produtos: lista.map((p) => publicar(p, config, mods[String(p.id)], data)),
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message || 'Falha ao ler os produtos.' });
    }
  });

  router.post('/central-ofertas/selecao', acesso, async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).slice(0, 500) : [];
      const selecionado = req.body?.selecionado === true;
      const dados = lerArquivo();
      dados.produtos = dados.produtos || {};
      for (const id of ids) {
        if (!id) continue;
        dados.produtos[id] = { ...(dados.produtos[id] || {}), selecionado };
      }
      gravarArquivo(dados);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message || 'Falha ao salvar a seleção.' });
    }
  });

  router.put('/central-ofertas/produtos/:id', acesso, async (req, res) => {
    try {
      const id = String(req.params.id);
      const dados = lerArquivo();
      dados.produtos = dados.produtos || {};
      const atual = dados.produtos[id] || {};
      const prox = { ...atual };
      if ('ignorar_estoque' in (req.body || {})) {
        prox.ignorar_estoque = req.body.ignorar_estoque === true || req.body.ignorar_estoque === 'true';
      }
      if ('selecionado' in (req.body || {})) prox.selecionado = req.body.selecionado === true;
      if ('modo' in (req.body || {})) {
        const modo = String(req.body.modo || '');
        if (!['oferta', 'exposicao', 'nenhum'].includes(modo)) throw new Error('Modo inválido.');
        prox.modo_escolhido = modo === 'nenhum' ? '' : modo;
        if (modo === 'oferta' || modo === 'exposicao') prox.selecionado = true;
      }
      if ('detalhes_sobrescritos' in (req.body || {})) {
        prox.detalhes_sobrescritos = String(req.body.detalhes_sobrescritos || '').slice(0, 200);
      }
      const mexePreco = ['preco', 'preco_promocional', 'promocao_inicio', 'promocao_fim'].some((k) => k in (req.body || {}));
      if (mexePreco) {
        if (!podeAlterarPreco(req)) {
          return res.status(403).json({ ok: false, error: 'Este usuário só agenda. Preço e promoção ficam com quem pode alterar preço.' });
        }
        if ('preco' in req.body) prox.preco = dinheiro(req.body.preco);
        if ('preco_promocional' in req.body) {
          prox.preco_promocional = req.body.preco_promocional == null || req.body.preco_promocional === ''
            ? null
            : dinheiro(req.body.preco_promocional);
        }
        if ('promocao_inicio' in req.body) prox.promocao_inicio = dataCampo(req.body.promocao_inicio);
        if ('promocao_fim' in req.body) prox.promocao_fim = dataCampo(req.body.promocao_fim);
        if (prox.preco == null) throw new Error('Informe o preço.');
        if (prox.preco_promocional != null) {
          if (!prox.promocao_inicio || !prox.promocao_fim) throw new Error('Informe o início e o fim da promoção.');
          if (prox.promocao_fim < prox.promocao_inicio) throw new Error('O fim da promoção é anterior ao início.');
        } else {
          prox.promocao_inicio = '';
          prox.promocao_fim = '';
        }
      }
      dados.produtos[id] = prox;
      gravarArquivo(dados);
      const base = await conectores.erp.lerProduto(id);
      const produto = base
        ? publicar(base, lerConfig(), prox, hoje())
        : { id, ...prox };
      res.json({ ok: true, produto });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message || 'Falha ao salvar o produto.' });
    }
  });

  router.post('/central-ofertas/produtos/:id/foto', acesso, async (req, res) => {
    try {
      const id = String(req.params.id || '').replace(/[^\w.-]/g, '').slice(0, 40);
      if (!id) return res.status(400).json({ ok: false, error: 'Produto inválido.' });
      const ean = String(req.body?.ean || '').replace(/\D/g, '').slice(0, 20);
      let bruto;
      try { bruto = Buffer.from(String(req.body?.base64 || ''), 'base64'); }
      catch { bruto = Buffer.alloc(0); }
      if (!bruto.length || bruto.length > 8_000_000) {
        return res.status(400).json({ ok: false, error: 'Escolha uma foto de até 8 MB.' });
      }
      const { Jimp } = require('jimp');
      let img = await Jimp.read(bruto);
      if (Math.max(img.width, img.height) > 1080) img = img.scaleToFit({ w: 1080, h: 1080 });
      const jpeg = await img.getBuffer('image/jpeg');
      if (jpeg.length > 1_500_000) {
        return res.status(400).json({ ok: false, error: 'A foto ficou maior que 1,5 MB depois de reduzir. Use uma imagem menor.' });
      }
      const { LICENCA_URL, cabecalhosInstalacao } = require('../licenca');
      const headers = { ...(await cabecalhosInstalacao()), 'Content-Type': 'application/json' };
      const remoto = await fetch(`${LICENCA_URL}/api/ofertas/foto`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ produto_id: id, ean, tipo: 'image/jpeg', base64: jpeg.toString('base64') }),
      });
      const data = await remoto.json().catch(() => ({}));
      if (!remoto.ok || data.ok === false) {
        return res.status(400).json({ ok: false, error: data.error || 'O R2 não recebeu a foto.' });
      }
      const dados = lerArquivo();
      dados.produtos = dados.produtos || {};
      dados.produtos[id] = {
        ...(dados.produtos[id] || {}),
        foto_url: data.url || '',
        foto_chave: data.chave || '',
      };
      gravarArquivo(dados);
      res.json({ ok: true, foto_url: data.url || '', foto_chave: data.chave || '', aviso: data.aviso || '' });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message || 'Falha ao anexar a foto.' });
    }
  });

  function lerOfertas() {
    const lista = lerArquivo().ofertas;
    return Array.isArray(lista) ? lista : [];
  }

  router.get('/central-ofertas/ofertas', acesso, (_req, res) => {
    res.json({ ok: true, ofertas: lerOfertas() });
  });

  router.post('/central-ofertas/ofertas', acesso, (req, res) => {
    try {
      const nome = String(req.body?.nome || '').trim().slice(0, 80);
      const inicio = dataCampo(req.body?.inicio);
      const fim = dataCampo(req.body?.fim);
      if (nome.length < 2) throw new Error('Dê um nome para a oferta.');
      if (!inicio || !fim) throw new Error('Informe o início e o fim da oferta.');
      if (fim < inicio) throw new Error('O fim da oferta é anterior ao início.');
      const produtos = normalizarProdutosOferta(req.body?.produtos);
      const dados = lerArquivo();
      const lista = Array.isArray(dados.ofertas) ? dados.ofertas : [];
      if (lista.length >= 40) throw new Error('Há muitas ofertas salvas. Apague uma antes de criar outra.');
      const oferta = {
        id: randomUUID(),
        nome,
        inicio,
        fim,
        usar_detalhes: req.body?.usar_detalhes !== false,
        produtos,
        rotina: [],
        aviso: '',
        criada_em: new Date().toISOString(),
      };
      lista.unshift(oferta);
      dados.ofertas = lista.slice(0, 40);
      gravarArquivo(dados);
      res.json({ ok: true, oferta });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message || 'Falha ao criar a oferta.' });
    }
  });

  router.post('/central-ofertas/ofertas/:id/produtos', acesso, (req, res) => {
    try {
      const dados = lerArquivo();
      const lista = Array.isArray(dados.ofertas) ? dados.ofertas : [];
      const oferta = lista.find((o) => o.id === req.params.id);
      if (!oferta) return res.status(404).json({ ok: false, error: 'Oferta não encontrada.' });
      const atuais = new Map((oferta.produtos || []).map((p) => [String(p.id), p]));
      for (const p of normalizarProdutosOferta(req.body?.produtos)) atuais.set(p.id, p);
      if (atuais.size > 300) throw new Error('A oferta aceita até 300 produtos.');
      oferta.produtos = [...atuais.values()];
      oferta.rotina = [];
      oferta.aviso = '';
      dados.ofertas = lista;
      gravarArquivo(dados);
      res.json({ ok: true, oferta });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message || 'Falha ao incluir os produtos.' });
    }
  });

  router.post('/central-ofertas/ofertas/:id/rotina', acesso, (req, res) => {
    try {
      const dados = lerArquivo();
      const lista = Array.isArray(dados.ofertas) ? dados.ofertas : [];
      const oferta = lista.find((o) => o.id === req.params.id);
      if (!oferta) return res.status(404).json({ ok: false, error: 'Oferta não encontrada.' });
      const config = lerConfig();
      const usar = oferta.usar_detalhes === true && config.detalhes_item?.ativo === true;
      const campo = config.detalhes_item?.campo_origem || 'OBSERVACAO';
      const produtos = (oferta.produtos || []).map((p) => ({
        ...p,
        detalhe: usar ? String(p.detalhes?.[campo] || p.detalhe || '').slice(0, 200) : '',
      }));
      const gerada = montarRotina({
        inicio: oferta.inicio,
        fim: oferta.fim,
        produtos,
        publicacao: config.publicacao,
      });
      oferta.rotina = gerada.rotina;
      oferta.aviso = gerada.aviso || '';
      dados.ofertas = lista;
      gravarArquivo(dados);
      res.json({ ok: true, oferta, aviso: oferta.aviso });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message || 'Falha ao gerar a rotina.' });
    }
  });
}

function normalizarProdutosOferta(lista) {
  if (!Array.isArray(lista)) return [];
  const vistos = new Set();
  const out = [];
  for (const item of lista) {
    const id = String(item?.id || '').replace(/[^\w.-]/g, '').slice(0, 40);
    if (!id || vistos.has(id)) continue;
    vistos.add(id);
    const detalhes = {};
    const bruto = item?.detalhes && typeof item.detalhes === 'object' ? item.detalhes : {};
    for (const [chave, valor] of Object.entries(bruto)) {
      if (!/^[A-Z0-9_]{2,40}$/.test(chave)) continue;
      detalhes[chave] = String(valor || '').slice(0, 200);
    }
    out.push({
      id,
      descricao: String(item?.descricao || '').trim().slice(0, 120),
      ean: String(item?.ean || '').replace(/\D/g, '').slice(0, 20),
      detalhe: String(item?.detalhe || detalhes.OBSERVACAO || '').slice(0, 200),
      detalhes,
    });
    if (out.length >= 300) break;
  }
  return out;
}

module.exports = { montar, anotar };
