'use strict';

const { criarConectores } = require('./conectores');
const { lerArquivo, gravarArquivo, lerConfig, sanitizar, padrao } = require('./config-loja');
const { validarPublicacao, promoValida, descontoPercentual, modoDaLinha } = require('./regras-estoque');

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
  linha.modo = modoDaLinha(linha);
  linha.vendido_30d = Number(produto.vendido_30d || 0);
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
  const papel = (lerConfig().usuarios || []).find((x) => Number(x.id) === Number(u.id));
  return papel?.papel === 'preco';
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
      const config = lerConfig();
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
      const config = lerConfig();
      const mods = lerArquivo().produtos || {};
      let lista = await conectores.erp.listarProdutos();
      if (req.query.vendidos === '1') {
        const totais = await conectores.erp.vendidos30();
        lista = lista.map((p) => ({ ...p, vendido_30d: Number(totais[String(p.id)] || 0) }));
      }
      const grupos = [...new Set(lista.map((p) => String(p.categoria || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'pt'));
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
}

module.exports = { montar, anotar };
