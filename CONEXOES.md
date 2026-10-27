# Conexões da Central de Ofertas

O módulo usa dados simulados enquanto estas ligações não forem feitas. A troca é só por variável de ambiente (`simulado` ou `real`). A lista está em `.env.example`.

| O quê | Arquivo | O que falta |
|---|---|---|
| Nomes de tabela e campo do produto e dos itens vendidos | `server/ofertas-auto/mapeamento-erp.js` | Preencher os `TODO` e mudar `pronto` para `true`. A leitura real usa `withDb` e `query` de `server/db.js`, a mesma camada do restante do gestor. |
| Gravação no ERP | `server/ofertas-auto/conectores/erp.js` (`gravar`) | Implementar a gravação por essa mesma camada. Toda alteração do módulo passa pela fila; este método só é chamado pelo agente da loja. |
| Fila na nuvem e cópia do catálogo | `server/ofertas-auto/conectores/fila.js` | Ligar ao D1. Variáveis `FILA_MODO=real`, `FILA_URL` e `FILA_TOKEN`. |
| Fotos e artes | `server/ofertas-auto/conectores/imagens.js` | Ligar ao R2: enviar, URL pública HTTPS e apagar. Variável `IMAGENS_MODO=real` e as variáveis `R2_*`. |
| Instagram | `server/ofertas-auto/conectores/instagram.js` | API da Meta: container, publicação, status e limite. Variável `INSTAGRAM_MODO=real`. O token fica em `META_ACCESS_TOKEN`, fora do painel. |

O túnel Cloudflare até a loja já existe no gestor. A validação do post na hora marcada, com a loja offline, entra na fase da agenda.
