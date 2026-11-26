"""Aplicativo desktop da Ordem de Serviço do Gestor (Python + pywebview).

Fala só com a API do serviço do Gestor (nunca direto com o Firebird), então serve para
Firebird 2.5 e 5.0 sem driver no computador. Quando o servidor cai, trabalha numa base
SQLite temporária (contingência) e sincroniza depois.
"""

VERSAO = "1.0.0"
NOME = "Gestor O.S"
