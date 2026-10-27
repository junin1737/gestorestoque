# Conexões da Central de Ofertas

| Peça | Onde está | Situação |
|---|---|---|
| Produtos | `V_ESTOQUE` (Clipp) e `V_ESTOQUE_2` (ManagePro), lidas por `server/db.js` | Ligado. Preço, estoque, EAN, grupo e descrição vêm da view. A promoção (`PRC_PROMO`, início `INPROMO`, fim `FIMPROMO`) só existe na view do ManagePro. |
| Itens vendidos | `server/ofertas-auto/mapeamento-erp.js` (`vendidos`) | Ainda `TODO`. A view de estoque não traz unidades vendidas. |
| Fila | D1 `gestor-licenca`, tabelas `alteracao_fila` e `catalogo_copia`. Rota `/api/ofertas/fila` | Ligado no worker. A loja chama com o segredo da instalação. |
| Fotos | R2 `gestor-ofertas`, binding `FOTOS` | Bucket criado. Falta o endereço público em `FOTOS_PUBLIC_BASE` para o Instagram conseguir baixar a imagem. |
| Instagram | Cadastro do cliente no painel: usuário, ID da conta, token e validade | O token fica só no D1. A licença da loja recebe apenas se está configurado e a data de validade. |

## Endereço público do R2

1. No painel da Cloudflare, abra R2 → `gestor-ofertas` → Settings.
2. Ative o subdomínio r2.dev ou um domínio próprio, por exemplo `fotos.smsjrdeveloper.com.br`.
3. Coloque essa URL, sem barra no final, em `FOTOS_PUBLIC_BASE` no `licenca-server/wrangler.toml` e publique o worker de novo.
4. Só então mude `IMAGENS_MODO` para `real`.
