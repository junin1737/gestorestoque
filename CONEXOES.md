# Conexões da Central de Ofertas

| Peça | Onde está | Situação |
|---|---|---|
| Produtos | `V_ESTOQUE` (Clipp) e `V_ESTOQUE_2` (ManagePro), lidas por `server/db.js` | Ligado. Preço, estoque, EAN, grupo e descrição vêm da view. A promoção (`PRC_PROMO`, início `INPROMO`, fim `FIMPROMO`) só existe na view do ManagePro. |
| Itens vendidos | `server/ofertas-auto/mapeamento-erp.js` (`vendidos`) | Ainda `TODO`. A view de estoque não traz unidades vendidas. |
| Fila | D1 `gestor-licenca`, tabelas `alteracao_fila` e `catalogo_copia`. Rota `/api/ofertas/fila` | Ligado no worker. A loja chama com o segredo da instalação. |
| Fotos | R2 `gestor-ofertas`, binding `FOTOS` | Endereço público `https://pub-b4ce55fc842145b9a0772045f8271a9c.r2.dev`. É o link de desenvolvimento do R2, com limite de acesso. |
| Instagram | Cadastro do cliente no painel: usuário, ID da conta, token e validade | O token fica só no D1. A licença da loja recebe apenas se está configurado e a data de validade. |

## Endereço público do R2

O endereço em uso é `https://pub-b4ce55fc842145b9a0772045f8271a9c.r2.dev`. Quando for trocar por um domínio próprio, altere `FOTOS_PUBLIC_BASE` em `licenca-server/wrangler.toml` e publique o worker de novo. Aí o `IMAGENS_MODO` pode ficar `real`.
