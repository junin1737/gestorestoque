# Relatorio Tecnico de Diferencas

Base: C:/Work/MT/Limpo/Clipp/Base/CLIPP.FDB
Before: 2026-08-19T16:27:13.802Z
After: 2026-08-19T16:28:54.105Z

Tabelas alteradas: 19
Generators alterados: 9

## Tabelas alteradas
- TB_EST_QTD_HISTORICO: 29 -> 87 (+58)
  - triggers ativas relacionadas: TB_EST_QTD_HISTORICO_BI
- TB_NFC_ITEM: 29 -> 58 (+29)
  - triggers ativas relacionadas: TB_NFC_ITEM_BI, TB_NFC_ITEM_VLR_UNIT_BI, TB_NFC_ITEM_VLR_UNIT_BU
- TB_NFC_ITEM_CBS_IBS: 29 -> 58 (+29)
  - triggers ativas relacionadas: TB_NFC_ITEM_CBS_IBS_BI
- TB_NFC_ITEM_ICMS: 29 -> 58 (+29)
- TB_NFC_ITEM_COFINS: 26 -> 52 (+26)
- TB_NFC_ITEM_PIS: 26 -> 52 (+26)
- TB_NFC_ITEM_IPI: 19 -> 38 (+19)
- TB_NFC_ITEM_ST: 19 -> 38 (+19)
- TB_NFC_ITEM_FCP: 17 -> 34 (+17)
- TB_MOVDIARIO: 2 -> 6 (+4)
  - triggers ativas relacionadas: TB_MOVDIARIO_BI, TRG_ATUALIZA_VINCULO_AI
- TB_CTAPAG_MOVTO: 2 -> 4 (+2)
- TB_CONTA_PAGAR: 1 -> 2 (+1)
  - triggers ativas relacionadas: TB_CONTA_PAGAR_AU0, TB_CONTA_PAGAR_BD0, TB_CONTA_PAGAR_BI
- TB_CTAPAG_BAIXA: 0 -> 1 (+1)
  - triggers ativas relacionadas: TB_CTAPAG_BAIXA_BI
- TB_FUNC_AUDITORIA_SIS: 8 -> 9 (+1)
  - triggers ativas relacionadas: TB_FUNC_AUDITORIA_SIS_BI
- TB_NFC_CTAPAG: 1 -> 2 (+1)
- TB_NFC_TRANSPORTADOR: 1 -> 2 (+1)
- TB_NFCOMPRA: 1 -> 2 (+1)
  - triggers ativas relacionadas: TB_NFCOMPRA_AI0, TB_NFCOMPRA_BI
- TB_NFCOMPRA_CONFIG: 1 -> 2 (+1)
- TB_NFCOMPRA_FMAPAGTO: 1 -> 2 (+1)
  - triggers ativas relacionadas: TB_COMPRA_FMAPAGTO_BI

## Generators alterados
- GEN_TB_CTAPAG_BAIXA_ID: 0 -> 1 (+1)
- GEN_TB_CTAPAG_ID: 1 -> 2 (+1)
- GEN_TB_EST_QTD_HISTORICO_ID: 29 -> 87 (+58)
- GEN_TB_FUNC_AUDITORIA_SIS_ID: 8 -> 9 (+1)
- GEN_TB_MOVDIARIO_ID: 2 -> 6 (+4)
- GEN_TB_NFC_ITEM_CBS_IBS_ID: 29 -> 58 (+29)
- GEN_TB_NFC_ITEM_ID: 29 -> 58 (+29)
- GEN_TB_NFCOMPRA_FMAPAGTO_ID: 1 -> 2 (+1)
- GEN_TB_NFCOMPRA_ID: 1 -> 2 (+1)

## Observacao
- Firebird nao registra historico de chamada de procedures/triggers por operacao sem trace/auditoria ativa. Este relatorio mostra evidencias por efeitos (tabelas + generators) e triggers relacionadas por tabela alterada.