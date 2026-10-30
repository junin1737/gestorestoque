'use strict';

const { criarConectores } = require('./conectores');
const { lerArquivo, gravarArquivo, lerConfig, sanitizar, padrao } = require('./config-loja');
const { randomUUID } = require('crypto');
const { validarPublicacao, promoValida, descontoPercentual, modoDaLinha } = require('./regras-estoque');
const { montarRotina, diaDaOferta } = require('./regras-publicacao');

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

  router.get('/central-ofertas/config', acesso, async (req, res) => {
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
        pode_preco: podeAlterarPreco(req),
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
        menos: req.query.vendidos === '1',
        rapido: req.query.rapido === '1',
        id: req.query.id || '',
        ignorar: Object.entries(mods).filter(([, m]) => m?.ignorar_estoque).map(([id]) => id),
      };
      if (req.query.grupos === '1') {
        const soGrupos = await conectores.erp.grupos().catch(() => []);
        return res.json({ ok: true, grupos: soGrupos, produtos: [], pode_preco: podeAlterarPreco(req) });
      }
      let lista = await conectores.erp.listarProdutos(filtros);
      if (req.query.vendidos === '1' && !filtros.rapido && !filtros.id && !lista.some((p) => p.vendido_30d != null)) {
        const totais = await conectores.erp.vendidos30();
        lista = lista
          .map((p) => ({ ...p, vendido_30d: Number(totais[String(p.id)] || 0) }))
          .sort((a, b) => a.vendido_30d - b.vendido_30d || String(a.descricao).localeCompare(String(b.descricao), 'pt'))
          .slice(0, 300);
      }
      const grupos = filtros.rapido || filtros.id ? [] : await conectores.erp.grupos().catch(() => (
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
      const jpeg = await require('./publicador').arquivoParaGuardar(bruto, 1920);
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

  router.post('/central-ofertas/banner', acesso, async (req, res) => {
    try {
      const dados = lerArquivo();
      dados.configuracao = dados.configuracao && typeof dados.configuracao === 'object' ? dados.configuracao : {};
      const atual = { ...padrao().banner, ...(dados.configuracao.banner || {}) };
      const furo = require('./regras-postagem').furoBanner(req.body || {}, atual);
      let url = /^https:\/\//.test(String(atual.url || '')) ? String(atual.url) : '';
      let chave = String(atual.chave || '');
      if (req.body?.base64) {
        let bruto;
        try { bruto = Buffer.from(String(req.body.base64 || ''), 'base64'); }
        catch { bruto = Buffer.alloc(0); }
        if (!bruto.length || bruto.length > 8_000_000) {
          return res.status(400).json({ ok: false, error: 'Escolha um banner de até 8 MB.' });
        }
        const jpeg = await require('./publicador').arquivoParaGuardar(bruto, 1920);
        const { LICENCA_URL, cabecalhosInstalacao } = require('../licenca');
        const remoto = await fetch(`${LICENCA_URL}/api/ofertas/foto`, {
          method: 'POST',
          headers: { ...(await cabecalhosInstalacao()), 'Content-Type': 'application/json' },
          body: JSON.stringify({ produto_id: 'banner-padrao', ean: 'loja', tipo: 'image/jpeg', base64: jpeg.toString('base64') }),
        });
        const data = await remoto.json().catch(() => ({}));
        if (!remoto.ok || data.ok === false || !data.url) {
          return res.status(400).json({ ok: false, error: data.error || 'O R2 não recebeu o banner.' });
        }
        url = String(data.url);
        chave = String(data.chave || '');
      }
      dados.configuracao.banner = { url, chave, ...furo };
      gravarArquivo(dados);
      res.json({ ok: true, banner: dados.configuracao.banner });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message || 'Falha ao guardar o banner.' });
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
        ativa: req.body?.ativa !== false,
        produtos,
        rotina_cfg: { ...rotinaPadrao(), dias_semana: diaDaOferta(inicio) },
        origem: 'integrada',
        simples: { foto_url: '', descricao: '' },
        forma: 'post',
        usar_banner: req.body?.usar_banner !== false,
        legenda: '',
        link: '',
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

  router.put('/central-ofertas/ofertas/:id', acesso, (req, res) => {
    try {
      const dados = lerArquivo();
      const lista = Array.isArray(dados.ofertas) ? dados.ofertas : [];
      const oferta = lista.find((o) => o.id === req.params.id);
      if (!oferta) return res.status(404).json({ ok: false, error: 'Oferta não encontrada.' });
      if (req.body?.nome != null) {
        const nome = String(req.body.nome || '').trim().slice(0, 80);
        if (nome.length < 2) throw new Error('Dê um nome para a oferta.');
        oferta.nome = nome;
      }
      if (req.body?.inicio != null || req.body?.fim != null) {
        const inicio = dataCampo(req.body?.inicio || oferta.inicio);
        const fim = dataCampo(req.body?.fim || oferta.fim);
        if (!inicio || !fim) throw new Error('Informe o início e o fim da oferta.');
        if (fim < inicio) throw new Error('O fim da oferta é anterior ao início.');
        oferta.inicio = inicio;
        oferta.fim = fim;
      }
      if (req.body?.ativa != null) oferta.ativa = req.body.ativa !== false && req.body.ativa !== 0 && req.body.ativa !== '0';
      if (req.body?.rotina_cfg) oferta.rotina_cfg = normalizarRotina(req.body.rotina_cfg);
      if (req.body?.origem != null) oferta.origem = req.body.origem === 'simples' ? 'simples' : 'integrada';
      if (req.body?.simples && typeof req.body.simples === 'object') {
        const url = String(req.body.simples.foto_url || oferta.simples?.foto_url || '');
        oferta.simples = {
          foto_url: /^https:\/\//.test(url) ? url : '',
          descricao: String(req.body.simples.descricao ?? oferta.simples?.descricao ?? '').slice(0, 500),
        };
      }
      if (req.body?.forma != null) oferta.forma = formaOferta(req.body.forma);
      if (req.body?.usar_banner != null) {
        oferta.usar_banner = req.body.usar_banner !== false && req.body.usar_banner !== 0 && req.body.usar_banner !== '0';
      }
      if (req.body?.legenda != null) oferta.legenda = String(req.body.legenda || '').slice(0, 1000);
      if (req.body?.link != null) oferta.link = linkOferta(req.body.link);
      dados.ofertas = lista;
      gravarArquivo(dados);
      res.json({ ok: true, oferta });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message || 'Falha ao salvar a oferta.' });
    }
  });

  router.post('/central-ofertas/ofertas/:id/apagar', acesso, (req, res) => {
    try {
      const dados = lerArquivo();
      const lista = Array.isArray(dados.ofertas) ? dados.ofertas : [];
      const oferta = lista.find((o) => o.id === req.params.id);
      if (!oferta) return res.status(404).json({ ok: false, error: 'Oferta não encontrada.' });
      if ((oferta.rotina || []).some((s) => s.publicado)) {
        throw new Error('Esta campanha já tem post publicado.');
      }
      dados.ofertas = lista.filter((o) => o.id !== oferta.id);
      gravarArquivo(dados);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message || 'Falha ao cancelar a campanha.' });
    }
  });

  router.post('/central-ofertas/ofertas/:id/produtos', acesso, (req, res) => {
    try {
      const dados = lerArquivo();
      const lista = Array.isArray(dados.ofertas) ? dados.ofertas : [];
      const oferta = lista.find((o) => o.id === req.params.id);
      if (!oferta) return res.status(404).json({ ok: false, error: 'Oferta não encontrada.' });
      const atuais = new Map((oferta.produtos || []).map((p) => [String(p.id), p]));
      let entrou = false;
      for (const p of normalizarProdutosOferta(req.body?.produtos)) {
        if (!atuais.has(p.id)) entrou = true;
        const anterior = atuais.get(p.id) || {};
        atuais.set(p.id, {
          ...anterior,
          ...p,
          detalhes: { ...(anterior.detalhes || {}), ...(p.detalhes || {}) },
        });
      }
      if (atuais.size > 300) throw new Error('A oferta aceita até 300 produtos.');
      oferta.produtos = [...atuais.values()];
      if (entrou) {
        oferta.rotina = [];
        oferta.aviso = '';
      }
      dados.ofertas = lista;
      gravarArquivo(dados);
      res.json({ ok: true, oferta });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message || 'Falha ao incluir os produtos.' });
    }
  });

  router.post('/central-ofertas/ofertas/:id/produtos/remover', acesso, (req, res) => {
    try {
      const dados = lerArquivo();
      const lista = Array.isArray(dados.ofertas) ? dados.ofertas : [];
      const oferta = lista.find((o) => o.id === req.params.id);
      if (!oferta) return res.status(404).json({ ok: false, error: 'Oferta não encontrada.' });
      const tirar = new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(String));
      oferta.produtos = (oferta.produtos || []).filter((p) => !tirar.has(String(p.id)));
      oferta.rotina = [];
      oferta.aviso = '';
      dados.ofertas = lista;
      gravarArquivo(dados);
      res.json({ ok: true, oferta });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message || 'Falha ao tirar o produto.' });
    }
  });

  router.post('/central-ofertas/ofertas/:id/rotina', acesso, (req, res) => {
    try {
      const dados = lerArquivo();
      const lista = Array.isArray(dados.ofertas) ? dados.ofertas : [];
      const oferta = lista.find((o) => o.id === req.params.id);
      if (!oferta) return res.status(404).json({ ok: false, error: 'Oferta não encontrada.' });
      const cfg = normalizarRotina(req.body?.rotina || oferta.rotina_cfg);
      oferta.rotina_cfg = cfg;
      if (oferta.origem === 'simples') {
        const foto = String(oferta.simples?.foto_url || '');
        if (!/^https:\/\//.test(foto)) throw new Error('Anexe a foto da postagem simples.');
        const texto = String(oferta.legenda || oferta.simples?.descricao || oferta.nome || '').trim();
        if (texto.length < 2) throw new Error('Escreva a descrição da postagem.');
        const gerada = require('./regras-publicacao').montarRotinaSimples({
          inicio: oferta.inicio,
          fim: oferta.fim,
          publicacao: cfg,
          descricao: texto,
          foto_url: foto,
        });
        const publicados = (oferta.rotina || []).filter((s) => s.publicado);
        const datas = new Set(publicados.map((s) => s.data));
        oferta.rotina = publicados.concat(gerada.rotina.filter((s) => !datas.has(s.data)));
        oferta.aviso = gerada.rotina.length
          ? `Rotina simples com ${gerada.rotina.length} postagem(ns).`
          : 'Nenhum dia novo para agendar.';
        dados.ofertas = lista;
        gravarArquivo(dados);
        return res.json({ ok: true, oferta, aviso: oferta.aviso });
      }
      aplicarDetalhes(oferta, req.body?.detalhes);
      const usar = oferta.usar_detalhes !== false;
      const campo = oferta.detalhes?.campo_origem || 'OBSERVACAO';
      const publicados = (oferta.rotina || []).filter((s) => s.publicado);
      const ja = new Set(publicados.map((s) => String(s.produto_id || '')).filter(Boolean));
      const produtos = (oferta.produtos || []).filter((p) => !ja.has(String(p.id))).map((p) => {
        const campoItem = String(p.campo_origem || campo || 'OBSERVACAO');
        return {
          ...p,
          detalhe: usar ? String(p.detalhes?.[campoItem] || p.detalhe || '').slice(0, 200) : '',
        };
      });
      if (!produtos.length) {
        throw new Error(ja.size ? 'Todos os produtos desta oferta já foram publicados.' : 'Inclua produtos na oferta antes de gerar a rotina.');
      }
      const gerada = montarRotina({
        inicio: oferta.inicio,
        fim: oferta.fim,
        produtos,
        publicacao: cfg,
        fds: { ativo: cfg.fds_ativo, qtd: cfg.fds_qtd, encarte: cfg.encarte },
      });
      const fotos = dados.produtos || {};
      oferta.rotina = publicados.concat(gerada.rotina.map((slot) => ({
        ...slot,
        publicado: false,
        foto_url: String(fotos[String(slot.produto_id)]?.foto_url
          || (oferta.produtos || []).find((p) => String(p.id) === String(slot.produto_id))?.foto_url
          || ''),
      })));
      oferta.aviso = gerada.aviso || '';
      dados.ofertas = lista;
      gravarArquivo(dados);
      res.json({ ok: true, oferta, aviso: oferta.aviso });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message || 'Falha ao gerar a rotina.' });
    }
  });

  router.post('/central-ofertas/ofertas/:id/postar', acesso, async (req, res) => {
    try {
      const r = await require('./publicador').publicarOferta(req.params.id);
      res.json({
        ok: true,
        etapa: r.etapa || 'publicado',
        mensagem: r.mensagem || '',
        post_id: r.post_id || '',
        oferta: r.oferta,
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message || 'Falha ao postar.', oferta: err.oferta });
    }
  });
}

function aplicarDetalhes(oferta, body) {
  const src = body && typeof body === 'object' ? body : {};
  if ('ativo' in src) oferta.usar_detalhes = src.ativo !== false && src.ativo !== 0 && src.ativo !== '0';
  const campo = String(src.campo_origem || oferta.detalhes?.campo_origem || 'OBSERVACAO').replace(/[^\w]/g, '').slice(0, 40);
  const onde = ['banner', 'legenda', 'ambos'].includes(src.onde) ? src.onde : (oferta.detalhes?.onde || 'legenda');
  const limite = Number(src.limite_banner);
  oferta.detalhes = {
    campo_origem: campo || 'OBSERVACAO',
    onde,
    limite_banner: Number.isInteger(limite) ? Math.min(120, Math.max(10, limite)) : (oferta.detalhes?.limite_banner || 40),
  };
}

function formaOferta(v) {
  return v === 'story' || v === 'ambos' ? v : 'post';
}

function linkOferta(v) {
  const s = String(v || '').trim().slice(0, 300);
  if (!s) return '';
  if (!/^https?:\/\/\S+$/i.test(s)) throw new Error('O link precisa começar com http:// ou https://');
  return s;
}

function rotinaPadrao() {
  const pub = require('./config-loja').padrao();
  return {
    posts_por_dia: pub.publicacao.posts_por_dia,
    intervalo_minutos: pub.publicacao.intervalo_minutos,
    hora_inicio: pub.publicacao.hora_inicio,
    hora_fim: pub.publicacao.hora_fim,
    dias_semana: pub.publicacao.dias_semana.slice(),
    fds_ativo: false,
    fds_qtd: 1,
    encarte: false,
  };
}

function horaRotina(v, nome) {
  const m = String(v || '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) throw new Error(`Informe ${nome} no formato HH:MM.`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`Informe ${nome} no formato HH:MM.`);
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

function normalizarRotina(body) {
  const base = rotinaPadrao();
  const src = body && typeof body === 'object' ? body : {};
  const dias = Array.isArray(src.dias_semana)
    ? [...new Set(src.dias_semana.map(Number).filter((n) => n >= 0 && n <= 6))]
    : base.dias_semana;
  const posts = Number(src.posts_por_dia);
  const intervalo = Number(src.intervalo_minutos);
  const qtd = Number(src.fds_qtd);
  return {
    posts_por_dia: Number.isInteger(posts) ? Math.min(50, Math.max(1, posts)) : base.posts_por_dia,
    intervalo_minutos: Number.isInteger(intervalo) ? Math.min(1440, Math.max(1, intervalo)) : base.intervalo_minutos,
    hora_inicio: horaRotina(src.hora_inicio || base.hora_inicio, 'o início'),
    hora_fim: horaRotina(src.hora_fim || base.hora_fim, 'o fim'),
    dias_semana: dias.length ? dias : base.dias_semana,
    fds_ativo: src.fds_ativo === true || src.fds_ativo === 1 || src.fds_ativo === '1',
    fds_qtd: Number.isInteger(qtd) ? Math.min(10, Math.max(0, qtd)) : base.fds_qtd,
    encarte: src.encarte === true || src.encarte === 1 || src.encarte === '1',
  };
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
    const preco = Number(item?.preco);
    const promo = item?.preco_promocional == null || item?.preco_promocional === '' ? null : Number(item.preco_promocional);
    const estoque = Number(item?.estoque);
    const limite = Number(item?.limite_banner);
    const onde = ['banner', 'legenda', 'ambos'].includes(item?.onde) ? item.onde : '';
    const campo = String(item?.campo_origem || '').replace(/[^\w]/g, '').slice(0, 40);
    const foto = String(item?.foto_url || '');
    out.push({
      id,
      codigo: String(item?.codigo || id).trim().slice(0, 20),
      descricao: String(item?.descricao || '').trim().slice(0, 120),
      ean: String(item?.ean || '').replace(/\D/g, '').slice(0, 20),
      detalhe: String(item?.detalhe || detalhes.OBSERVACAO || '').slice(0, 200),
      detalhes,
      preco: Number.isFinite(preco) ? Math.round(preco * 100) / 100 : null,
      preco_promocional: Number.isFinite(promo) ? Math.round(promo * 100) / 100 : null,
      promocao_inicio: String(item?.promocao_inicio || '').slice(0, 10),
      promocao_fim: String(item?.promocao_fim || '').slice(0, 10),
      estoque: Number.isFinite(estoque) ? estoque : null,
      foto_url: /^https:\/\//.test(foto) ? foto.slice(0, 300) : '',
      modo: item?.modo === 'oferta' || item?.modo === 'exposicao' ? item.modo : '',
      categoria: String(item?.categoria || '').trim().slice(0, 60),
      limite_banner: Number.isInteger(limite) ? Math.min(120, Math.max(10, limite)) : 0,
      campo_origem: campo,
      onde,
    });
    if (out.length >= 300) break;
  }
  return out;
}

module.exports = { montar, anotar };
