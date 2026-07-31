# Gestor Estoque — MT Automações

Painel Administrativo local + API Firebird (Clipp / ManagePro).

## Requisitos

- Node.js 18+
- Firebird 2.5 ou 5.0 acessível (porta 3050)
- Pasta `MTdll/` com `fbclient.dll` e `fbclient5.dll` (incluída no instalador)

## Desenvolvimento

```bash
npm install
npm start          # API em http://127.0.0.1:5077
npm run electron   # janela desktop
```

Base padrão de desenvolvimento: `C:\Work\MT\Cheff\Clipp\Base\CLIPP.FDB`  
Configuração fica em `%APPDATA%\GestorEstoque\`.

## Login

- Usuários vêm de `TB_FUNCIONARIO`
- Supervisor: senha fixa `1020` (todas as permissões)
- Demais usuários: definir senha em **Usuários**

## Configuração

Botão **CONFIGURAÇÃO** no login:

- Caminho da base `.FDB`
- Host / porta / usuário Firebird
- Sistema: Clipp | ManagePro | Clipp+ManagePro
- Tema: claro | escuro | empresa

## Build instalador

```bash
npm run build
```

O `electron-builder` copia `MTdll/**` para `resources/MTdll/`.
