'use strict';

const { withDb, query, activeTargets, hasTable } = require('./db');

function localNow() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return {
    dataSql: `${y}-${m}-${day}`,
    horaSql: `${hh}:${mm}:${ss}`,
  };
}

async function nextSaldoId(db, genName, tableName) {
  try {
    const gen = await query(db, `SELECT GEN_ID(${genName}, 1) AS ID FROM RDB$DATABASE`);
    return Number(gen[0].ID);
  } catch {
    const max = await query(db, `SELECT COALESCE(MAX(ID),0)+1 AS ID FROM ${tableName}`);
    return Number(max[0].ID);
  }
}

async function nextMovtoId(db) {
  try {
    const gen = await query(db, `SELECT GEN_ID(GEN_TB_MOVDIARIO_ID, 1) AS ID FROM RDB$DATABASE`);
    return Number(gen[0].ID);
  } catch {
    const max = await query(db, `SELECT COALESCE(MAX(ID_MOVTO),0)+1 AS ID FROM TB_MOVDIARIO`);
    return Number(max[0].ID);
  }
}

async function defaultIdCtapla(db) {
  const rows = await query(db, `
    SELECT FIRST 1 ID_CTAPLA FROM TB_MOVDIARIO
    WHERE TIP_MOVTO CONTAINING 'C'
    GROUP BY ID_CTAPLA
    ORDER BY COUNT(*) DESC`);
  return Number(rows[0]?.ID_CTAPLA || 75);
}

/** Cria par C/D em TB_MOVDIARIO + TB_CTAPAG_MOVTO (exigido pelo trigger AU0). */
async function ensureContaMovtos(db, idCta, {
  vlr, historico, dataSql, horaSql, idCtapla,
} = {}) {
  const existing = await query(db, `
    SELECT FIRST 1 ID_MOVTO FROM TB_CTAPAG_MOVTO WHERE ID_CTAPAG = ?`, [idCta]);
  if (existing[0]) return Number(existing[0].ID_MOVTO);

  const valor = Math.abs(Number(vlr || 0));
  const hist = String(historico || 'Conta a pagar').slice(0, 80);
  const pla = idCtapla || await defaultIdCtapla(db);
  const agora = localNow();
  const dt = dataSql || agora.dataSql;
  const hr = horaSql || agora.horaSql;

  for (const tip of ['C', 'D']) {
    const idMov = await nextMovtoId(db);
    await query(db, `
      INSERT INTO TB_MOVDIARIO (
        ID_MOVTO, DT_MOVTO, HR_MOVTO, HISTORICO, TIP_MOVTO, VLR_MOVTO, ID_CTAPLA, DT_MOVTO_REAL
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
      idMov, dt, hr, hist, tip, valor, pla, dt,
    ]);
    await query(db, `
      INSERT INTO TB_CTAPAG_MOVTO (ID_MOVTO, ID_CTAPAG) VALUES (?, ?)`, [idMov, idCta]);
  }
  return true;
}

async function zerarContaPagar(db, idCta, nfNumero) {
  const cur = await query(db, `
    SELECT FIRST 1 VLR_CTAPAG, HISTORICO, TIP_CTAPAG FROM TB_CONTA_PAGAR WHERE ID_CTAPAG = ?`, [idCta]);
  if (!cur[0]) return false;
  const vlr = Number(cur[0].VLR_CTAPAG || 0);
  const tipAtual = String(cur[0].TIP_CTAPAG || '').trim().toUpperCase();
  const agora = localNow();

  // Já cancelada com baixa C → só garante TIP/histórico
  const baixaC = await query(db, `
    SELECT FIRST 1 ID_BAIXA FROM TB_CTAPAG_BAIXA
    WHERE ID_CTAPAG = ? AND TRIM(TIP_PAGTO) = 'C'`, [idCta]);
  if (baixaC[0] && tipAtual === 'C') {
    return true;
  }

  await ensureContaMovtos(db, idCta, {
    vlr: vlr || 0.01,
    historico: `Compra NF ${nfNumero}`,
    dataSql: agora.dataSql,
    horaSql: agora.horaSql,
  });

  // Padrão Clipp (ex.: ID_CTAPAG 1987): TIP_CTAPAG=C + baixa TIP_PAGTO=C
  if (!baixaC[0]) {
    let nextBaixa;
    try {
      const gen = await query(db, `SELECT GEN_ID(GEN_TB_CTAPAG_BAIXA_ID, 1) AS ID FROM RDB$DATABASE`);
      nextBaixa = Number(gen[0].ID);
    } catch {
      const max = await query(db, `SELECT COALESCE(MAX(ID_BAIXA),0)+1 AS ID FROM TB_CTAPAG_BAIXA`);
      nextBaixa = Number(max[0].ID);
    }
    await query(db, `
      INSERT INTO TB_CTAPAG_BAIXA (
        ID_BAIXA, ID_CTAPAG, DT_BAIXA, HR_BAIXA, VLR_PAGO, VLR_DESC, VLR_ACRESC, TIP_PAGTO
      ) VALUES (?, ?, ?, ?, ?, 0, 0, 'C')`, [
      nextBaixa,
      idCta,
      agora.dataSql,
      agora.horaSql,
      Math.abs(vlr) || 0,
    ]);
  }

  await query(db, `
    UPDATE TB_CONTA_PAGAR
    SET TIP_CTAPAG = 'C',
        HISTORICO = ?
    WHERE ID_CTAPAG = ?`, [
    `CANCELADA c/ NF ${nfNumero} ${agora.dataSql}`.slice(0, 80),
    idCta,
  ]);
  return true;
}

/** Evita estorno duplicado por clique duplo / requisições paralelas no mesmo processo. */
const cancelandoIds = new Set();

async function cancelarNfCompra(idNfcompra, { usuario = 'Supervisor', idFuncionario = 0 } = {}) {
  const id = Number(idNfcompra);
  if (!id) throw new Error('Informe o ID da NF de compra.');
  if (cancelandoIds.has(id)) {
    throw new Error('Cancelamento desta nota já está em andamento. Aguarde.');
  }
  cancelandoIds.add(id);

  try {
    return await withDb(async (db, appCfg) => {
      const nfs = await query(db, `
        SELECT FIRST 1 ID_NFCOMPRA, NF_NUMERO, NF_SERIE, STATUS, ID_FORNEC, NFE_ORIGEM
        FROM TB_NFCOMPRA WHERE ID_NFCOMPRA = ?`, [id]);
      const nf = nfs[0];
      if (!nf) throw new Error('Nota de compra não encontrada.');
      const status = String(nf.STATUS || '').trim().toUpperCase();
      const chave = String(nf.NFE_ORIGEM || '').replace(/\D/g, '') || null;

      // Nunca apaga/altera TB_MT_REGRA_TRIBUTO no cancelamento — parametrização permanece.

      if (status === 'C') {
        const links = await query(db, `SELECT ID_CTAPAG FROM TB_NFC_CTAPAG WHERE ID_NFCOMPRA = ?`, [id]);
        let contasZeradas = 0;
        for (const link of links) {
          const idCta = Number(link.ID_CTAPAG);
          if (!idCta) continue;
          const cur = await query(db, `
            SELECT VLR_CTAPAG, TIP_CTAPAG FROM TB_CONTA_PAGAR WHERE ID_CTAPAG = ?`, [idCta]);
          const tip = String(cur[0]?.TIP_CTAPAG || '').trim().toUpperCase();
          const baixaOk = await query(db, `
            SELECT FIRST 1 ID_BAIXA FROM TB_CTAPAG_BAIXA
            WHERE ID_CTAPAG = ? AND TRIM(TIP_PAGTO) = 'C'`, [idCta]);
          if (tip === 'C' && baixaOk[0]) continue;
          await zerarContaPagar(db, idCta, nf.NF_NUMERO);
          contasZeradas += 1;
        }
        return {
          id_nfcompra: id,
          nf_numero: nf.NF_NUMERO,
          chave,
          itens_estornados: 0,
          contas_pagar_zeradas: contasZeradas,
          ja_cancelada: true,
        };
      }

      const itens = await query(db, `
        SELECT ID_NFCITEM, ID_IDENTIFICADOR, NUM_ITEM, QTD_ITEM, EST_BX
        FROM TB_NFC_ITEM WHERE ID_NFCOMPRA = ?`, [id]);

      const targets = activeTargets(appCfg);
      const agora = localNow();
      const obs = `Estorno cancelamento NF ${nf.NF_NUMERO}/${String(nf.NF_SERIE || '').trim()} - ${usuario}`;

      for (const it of itens) {
        const idIdent = Number(it.ID_IDENTIFICADOR);
        const qtd = Number(it.QTD_ITEM || 0);
        const estBx = String(it.EST_BX || '').trim().toUpperCase();
        // Só estorna estoque dos itens que entraram (EST_BX='S'); o trigger Clipp
        // não desfaz o cancelamento — fazemos o estorno manual aqui.
        if (!idIdent || !qtd || estBx !== 'S') continue;

        for (const target of targets) {
          const t = target.tables;
          const prodRows = await query(db, `
            SELECT FIRST 1 QTD_ATUAL, PRC_MEDIO FROM ${t.produto} WHERE ID_IDENTIFICADOR = ?`, [idIdent]);
          if (!prodRows[0]) continue;
          const qtdAtual = Number(prodRows[0].QTD_ATUAL || 0);
          const prcMedio = Number(prodRows[0].PRC_MEDIO || 0);
          const nova = qtdAtual - qtd;
          await query(db, `UPDATE ${t.produto} SET QTD_ATUAL = ? WHERE ID_IDENTIFICADOR = ?`, [nova, idIdent]);

          if (hasTable(t.saldo)) {
            const nextId = await nextSaldoId(db, t.genSaldo, t.saldo);
            try {
              await query(db, `
                INSERT INTO ${t.saldo}
                  (ID, DATA, ID_IDENTIFICADOR, SALDO_ANTIGO, SALDO_NOVO, PRC_MEDIO, HORA, ID_FUNCIONARIO, OBSERVACAO)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                nextId, agora.dataSql, idIdent, qtdAtual, nova, prcMedio, agora.horaSql, idFuncionario || 0, obs.slice(0, 200),
              ]);
            } catch (e) {
              if (String(e.message || '').includes('OBSERVACAO')) {
                await query(db, `
                  INSERT INTO ${t.saldo}
                    (ID, DATA, ID_IDENTIFICADOR, SALDO_ANTIGO, SALDO_NOVO, PRC_MEDIO, HORA, ID_FUNCIONARIO)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
                  nextId, agora.dataSql, idIdent, qtdAtual, nova, prcMedio, agora.horaSql, idFuncionario || 0,
                ]);
              } else {
                console.warn('Saldo cancel NF:', e.message);
              }
            }
          }
        }
      }

      const links = await query(db, `SELECT ID_CTAPAG FROM TB_NFC_CTAPAG WHERE ID_NFCOMPRA = ?`, [id]);
      let contasZeradas = 0;
      const errosConta = [];
      for (const link of links) {
        const idCta = Number(link.ID_CTAPAG);
        if (!idCta) continue;
        try {
          await zerarContaPagar(db, idCta, nf.NF_NUMERO);
          contasZeradas += 1;
        } catch (err) {
          errosConta.push(`cta ${idCta}: ${err.message}`);
          console.warn('Conta a pagar cancel:', err.message);
        }
      }

      if (links.length && contasZeradas === 0) {
        throw new Error(
          `Não foi possível zerar as contas a pagar (${errosConta.join('; ') || 'sem detalhe'}).`
        );
      }

      await query(db, `UPDATE TB_NFCOMPRA SET STATUS = 'C' WHERE ID_NFCOMPRA = ?`, [id]);

      const aindaAbertas = await query(db, `
        SELECT COUNT(*) AS QTD
        FROM TB_NFC_CTAPAG L
        JOIN TB_CONTA_PAGAR C ON C.ID_CTAPAG = L.ID_CTAPAG
        WHERE L.ID_NFCOMPRA = ?
          AND TRIM(C.TIP_CTAPAG) <> 'C'`, [id]);
      if (Number(aindaAbertas[0]?.QTD || 0) > 0) {
        throw new Error(`Ainda há contas a pagar sem cancelamento (TIP_CTAPAG) após o processo.`);
      }

      return {
        id_nfcompra: id,
        nf_numero: nf.NF_NUMERO,
        chave,
        itens_estornados: itens.length,
        contas_pagar_zeradas: contasZeradas,
      };
    });
  } finally {
    cancelandoIds.delete(id);
  }
}

module.exports = {
  cancelarNfCompra,
  ensureContaMovtos,
  zerarContaPagar,
};
