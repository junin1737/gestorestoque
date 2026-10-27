'use strict';

const { criarConectores } = require('./conectores');
const { lerArquivo, gravarArquivo, lerConfig, sanitizar, padrao } = require('./config-loja');
const { validarPublicacao, promoValida, descontoPercentual } = require('./regras-estoque');

function hoje() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dia}`;
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
      const ig = await conectores.instagram.status();
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
      const q = String(req.query.q || '').trim().toLowerCase();
      let lista = await conectores.erp.listarProdutos();
      if (q) {
        lista = lista.filter((p) => [p.descricao, p.codigo, p.ean].some((v) => String(v || '').toLowerCase().includes(q)));
      }
      res.json({
        ok: true,
        data,
        exigir_estoque_positivo: config.estoque.exigir_estoque_positivo === true,
        produtos: lista.map((p) => anotar(p, config, mods[String(p.id)], data)),
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message || 'Falha ao ler os produtos.' });
    }
  });

  router.put('/central-ofertas/produtos/:id', acesso, async (req, res) => {
    try {
      const id = String(req.params.id);
      const dados = lerArquivo();
      dados.produtos = dados.produtos || {};
      const atual = dados.produtos[id] || {};
      dados.produtos[id] = {
        ignorar_estoque: req.body?.ignorar_estoque === true || req.body?.ignorar_estoque === 'true',
        detalhes_sobrescritos: String(req.body?.detalhes_sobrescritos ?? atual.detalhes_sobrescritos ?? '').slice(0, 200),
      };
      gravarArquivo(dados);
      res.json({ ok: true, produto: dados.produtos[id] });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message || 'Falha ao salvar o produto.' });
    }
  });
}

module.exports = { montar, anotar };
