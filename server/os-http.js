'use strict';

/** Rotas da Ordem de Serviço. Precisa do módulo Serviços liberado na licença e da permissão do usuário. */

const express = require('express');
const os = require('./os');
const auth = require('./auth');

const router = express.Router();

function guard(req, res, next) {
  const servicos = require('./licenca').situacao().servicos || {};
  if (servicos.ativo !== true) {
    return res.status(403).json({ ok: false, code: 'SEM_SERVICOS', error: 'O módulo de Serviços não está liberado para esta loja no painel.' });
  }
  if (!auth.temAcesso(req.usuario, 'servicos')) {
    return res.status(403).json({ ok: false, code: 'SEM_PERMISSAO', error: 'Sem permissão para Serviços.' });
  }
  return next();
}

function usuario(req) {
  return { id: req.usuario?.id ?? null, nome: req.usuario?.supervisor ? 'Supervisor' : (req.usuario?.nome || '') };
}

/** Responde { ok: true, ...resultado } ou { ok: false, error }. */
function rota(fn) {
  return async (req, res) => {
    try {
      res.json({ ok: true, ...(await fn(req, res)) });
    } catch (err) {
      const msg = String(err?.message || 'Falha na O.S.');
      res.json({ ok: false, error: msg });
    }
  };
}

router.use('/os', guard);

router.get('/os', rota((req) => os.listar(req.query)));
router.get('/os/status', rota(() => os.listarStatus()));
router.post('/os/status', rota((req) => os.salvarStatus(req.body)));
router.post('/os/status/ordem', rota((req) => os.ordenarStatus(req.body?.ids)));
router.get('/os/funcionarios', rota(() => os.listarFuncionarios()));
router.post('/os/funcionarios/:id', rota((req) => {
  if (!req.usuario?.supervisor) throw new Error('Só o supervisor marca técnicos e gerentes.');
  return os.salvarFuncionario(req.params.id, req.body);
}));
router.get('/os/mensagens', rota(() => os.listarMensagens()));
router.post('/os/mensagens', rota((req) => os.salvarMensagem(req.body)));
router.delete('/os/mensagens/:id', rota((req) => os.excluirMensagem(req.params.id)));
router.get('/os/solucoes', rota((req) => os.listarSolucoes(req.query.q)));
router.get('/os/solucoes/sugerir', rota((req) => os.sugerirSolucoes(req.query.defeito, req.query.equipamento)));
router.post('/os/solucoes', rota((req) => os.salvarSolucao(req.body?.id, req.body)));
router.post('/os/solucoes/:id/usar', rota((req) => os.usarSolucao(req.params.id)));
router.delete('/os/solucoes/:id', rota((req) => os.excluirSolucao(req.params.id)));
router.get('/os/clientes', rota((req) => os.buscarClientes(req.query.q)));
router.get('/os/categorias', rota((req) => os.buscarCategorias(req.query.q, req.query.pai)));
router.post('/os/categorias', rota((req) => os.cadastrarCategoria(req.body)));
router.get('/os/clientes/:id', rota((req) => os.clienteResumo(req.params.id)));
router.get('/os/cnpj/:cnpj', rota(async (req) => ({ empresa: await os.consultarCnpj(req.params.cnpj) })));
router.get('/os/itens', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, rota((req) => os.buscarItens(req.query.q, req.query.aba)));
router.get('/os/config', rota(() => ({ limites: os.lerLimites(), perfil: os.perfilServicos() })));
router.post('/os/config', rota((req) => {
  if (!req.usuario?.supervisor) throw new Error('Só o supervisor altera os limites de desconto.');
  return { limites: os.salvarLimites(req.body) };
}));
router.get('/os/liberadores', rota(async () => {
  const { funcionarios } = await os.listarFuncionarios();
  return {
    liberadores: [{ id: 0, nome: 'Supervisor' }, ...funcionarios.filter((f) => f.gerente).map((f) => ({ id: f.id, nome: f.nome }))],
  };
}));
router.post('/os/liberar', rota((req) => os.liberarDesconto({
  idUsuario: req.body?.id_usuario,
  senha: req.body?.senha,
  percentual: req.body?.percentual,
  escopo: req.body?.escopo,
})));

const relatorios = require('./os-relatorios');

function podeRelatorio(req) {
  if (!auth.temAcesso(req.usuario, 'relatorios')) throw new Error('Sem permissão para Relatórios.');
}
router.get('/os/relatorios', rota((req) => { podeRelatorio(req); return relatorios.catalogo(); }));
router.get('/os/relatorios/:rel', rota((req) => { podeRelatorio(req); return relatorios.executar(req.params.rel, req.query); }));

const desktop = require('./os-desktop');

// App desktop: cópia para a contingência e sincronização do que foi feito nela.
router.get('/os/desktop/cache', rota(() => desktop.cache()));
router.post('/os/desktop/sincronizar', rota((req) => desktop.sincronizar(req.body?.itens, usuario(req))));
router.post('/os/desktop/manter-servidor', rota((req) => desktop.manterServidor(req.body?.id, req.body?.provisorio, usuario(req))));

router.post('/os', rota((req) => os.salvar(req.body, usuario(req))));
router.post('/os/ordem', rota((req) => os.reordenar(req.body?.id_status, req.body?.ids)));
router.get('/os/:id', rota((req) => os.detalhe(req.params.id)));
router.post('/os/:id', rota((req) => os.salvar({ ...req.body, id: req.params.id }, usuario(req))));
router.post('/os/:id/status', rota((req) => os.mudarStatus(req.params.id, req.body?.id_status, usuario(req), req.body?.id_colaborador)));
router.post('/os/:id/tecnico', rota((req) => os.vincularTecnico(req.params.id, req.body?.id_tecnico, usuario(req))));
router.post('/os/:id/enviar-venda', rota((req) => os.enviarParaVenda(req.params.id, usuario(req))));
router.post('/os/:id/cancelar', rota((req) => os.cancelar(req.params.id, usuario(req))));
router.post('/os/:id/whatsapp', rota((req) => os.enviarWhatsapp(req.params.id, req.body || {}, usuario(req))));
router.get('/os/:id/whatsapp', rota(async (req) => {
  const { os: doc } = await os.detalhe(req.params.id);
  return { texto: os.textoWhatsapp(doc, req.query.modelo), telefone: doc.cliente?.telefone || '' };
}));

router.get('/os/:id/impressao', async (req, res) => {
  try {
    const doc = await os.impressao(req.params.id);
    let loja = { nome: '', endereco: '', telefone: '', logo: '' };
    try {
      loja = await require('./condicionais').lojaEmitente();
      const { withDb, query, blobToDataUrl } = require('./db');
      loja.logo = await withDb(async (db) => {
        const rows = await query(db, 'SELECT FIRST 1 LOGO FROM TB_EMITENTE');
        return (await blobToDataUrl(rows[0]?.LOGO)) || '';
      });
    } catch { /* imprime sem o cabeçalho da loja */ }
    const formato = String(req.query.formato || 'a4').toLowerCase();
    const modelo = String(req.query.modelo || 'abertura').toLowerCase();
    res.type('html').send(os.htmlImpressao(doc, loja, { formato, modelo }));
  } catch (err) {
    res.status(400).type('text').send(err.message || 'Não foi possível montar a impressão.');
  }
});

module.exports = router;
