# Conexões da Central de Ofertas

| Peça | Onde está | Situação |
|---|---|---|
| Produtos | `V_ESTOQUE` (Clipp) e `V_ESTOQUE_2` (ManagePro), lidas por `server/db.js` | Ligado. Preço, estoque, EAN, grupo e descrição vêm da view. A promoção (`PRC_PROMO`, início `INPROMO`, fim `FIMPROMO`) só existe na view do ManagePro. |
| Itens vendidos | `TB_NFV_ITEM` + `TB_NFVENDA` (ManagePro: `TB_NFV_ITEM_2` + `TB_NFVENDA_2`) | Ligado no mapeamento. Quantidade em `QTD_ITEM`, produto em `ID_IDENTIFICADOR`, data em `DT_EMISSAO` da nota emitida (`STATUS = 'E'`). |
| Fila | D1 `gestor-licenca`, tabelas `alteracao_fila` e `catalogo_copia`. Rota `/api/ofertas/fila` | Ligado no worker. A loja chama com o segredo da instalação. |
| Fotos | R2 `gestor-ofertas`, binding `FOTOS` | Endereço público `https://fotos.smsjrdeveloper.com.br`. |
| Instagram | Cadastro do cliente no painel: usuário, ID da conta, token e validade | O token fica só no D1. A licença da loja recebe apenas se está configurado e a data de validade. |

## Endereço público do R2

O endereço em uso é `https://fotos.smsjrdeveloper.com.br`, gravado em `FOTOS_PUBLIC_BASE` no `licenca-server/wrangler.toml`. Com isso o `IMAGENS_MODO` pode ficar `real`.
