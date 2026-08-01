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

## Build instalador (cliente piloto)

No PC de desenvolvimento:

```bash
npm install
npm run build
```

Ou execute `build\gerar-instalador.bat`.

O instalador fica em:

`dist\GestorEstoque-Setup-1.1.0.exe`

### Publicar atualização

1. Suba a versão em `package.json`.
2. Commit/push no GitHub (`main`).
3. `npm run build`
4. Crie um **Release** no GitHub (`vX.Y.Z`) anexando `dist\GestorEstoque-Setup-X.Y.Z.exe`.

No cliente, ao abrir o app ele consulta o GitHub; se houver versão nova + instalador no Release, pergunta e atualiza automaticamente.

### No cliente

1. Execute o instalador (admin se pedir).
2. Abre regra de firewall **TCP 5077** automaticamente.
3. Abra **Gestor Estoque** → aba **Banco de dados** → aponte o `.FDB` e o modo (Clipp / ManagePro / ambos).
4. Em **Sobre**, ative **Iniciar com o Windows** se quiser.
5. Na aba **Conexão**, anote o IP/QR e abra no celular: `http://IP:5077`.

Configuração e usuários ficam em `%APPDATA%\GestorEstoque\`.

O `electron-builder` copia `MTdll/*.dll` para `resources/MTdll/`.
