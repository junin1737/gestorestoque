# Gestor O.S — aplicativo desktop

Aplicativo instalado nos computadores da loja para a Ordem de Serviço. É feito em Python com pywebview. Ele mostra as mesmas telas do Gestor web e fala só com a API do serviço do Gestor, nunca direto com o Firebird. Por isso funciona com Firebird 2.5 e 5.0 sem instalar driver no computador.

## Modos

| Modo | Quando acontece | O que funciona |
| --- | --- | --- |
| Normal | Servidor e internet funcionando | Tudo |
| Sem internet | A internet caiu, mas a rede da loja funciona | Tudo, menos a consulta de CNPJ. O WhatsApp vai para uma fila no servidor e sai quando a internet volta. |
| Contingência | O servidor não responde | Abrir, editar e imprimir O.S na base SQLite do computador |

- **Cópia da contingência:** enquanto o servidor está no ar, o app renova a cópia a cada 5 minutos, por `GET /api/os/desktop/cache`. A cópia leva clientes, produtos, serviços, técnicos, status, limites e as O.S em aberto.
- **Entrada na contingência:**
  - Se o servidor não responde, o app pergunta se a pessoa quer entrar em contingência. Enquanto estiver nesse modo, uma faixa laranja fica sempre visível.
  - O login é o mesmo do Gestor. A senha é conferida no computador contra um hash PBKDF2, guardado quando a pessoa entrou com o servidor no ar.
- **Número provisório:** cada O.S aberta na contingência ganha um número provisório como `C-CAIXA01-0001`. O nome do computador evita repetir o número de outro computador.
- **Sincronização:** quando o servidor volta, o app envia as O.S novas e as alteradas por `POST /api/os/desktop/sincronizar`. Depois recebe os números definitivos e imprime o resumo.
- **Conflito:** se a mesma O.S foi alterada no servidor e na contingência, o app mostra as duas versões e a pessoa escolhe qual fica. As duas escolhas ficam no histórico da O.S.
- **Venda no Clipp:** a contingência não grava a venda no Clipp. Enviar para a venda só funciona com o servidor no ar.
- **Desconto acima do limite:** fica bloqueado na contingência, porque a liberação por senha precisa do servidor.

## Impressão

- **80 mm (térmica):** o texto vai em ESC/POS, cru, para a fila do Windows. Sai na hora, sem diálogo.
- **A4 e meia folha:** o HTML do Gestor é impresso pelo WebView2 na impressora escolhida. Se nenhuma impressora estiver escolhida, abre o diálogo de impressão.
- **Escolha das impressoras:** em Configurações › Saída, no próprio Gestor aberto dentro do app. A escolha fica gravada no computador.

## Instalação e atualização

- **Download:** no Gestor web, em Serviços, o botão **Aplicativo desktop** baixa o instalador mais novo que veio com o serviço. O nome do arquivo baixado já leva o endereço do servidor, por exemplo `GestorOS-Setup_192.168.0.10-5077.exe`. O instalador grava esse endereço e o app abre configurado.
- **O que o instalador faz:** cria os atalhos no menu Iniciar e na área de trabalho, e registra `gestoros://` para o botão "Abrir aplicativo". A instalação é por usuário, sem pedir administrador.
- **Atualização automática:** o app consulta `GET /api/desktop/versao` uma vez por hora. Quando há versão nova, pergunta se pode atualizar, baixa `GET /api/desktop/instalador` e roda o instalador em silêncio. Se houver O.S pendentes de sincronização, a atualização espera.

## Gerar o instalador

Pré-requisitos: Python 3.12 (`py -3.12`), Inno Setup 6 e o WebView2 Runtime, que já vem no Windows 10 e no 11.

```powershell
cd desktop-os
powershell -ExecutionPolicy Bypass -File construir.ps1
```

O script cria `.venv`, instala as dependências, roda os testes, gera o executável com o PyInstaller e o instalador com o Inno Setup. A saída fica em `saida\GestorOS-Setup.exe`, junto com `saida\versao.json`.

O build do Gestor (`npm run build`) leva essa pasta para `resources\desktop`, e é de lá que o serviço entrega o instalador. Para lançar uma versão nova, mude `VERSAO` em `gestor_os/__init__.py`.

## Testes

```powershell
python -m unittest discover -s testes -v
```

Os testes cobrem estes pontos:

- O cálculo é o mesmo do servidor: rateio, centavos e arredondamento.
- A base local: busca sem acento, número provisório, fila de envio e O.S já enviada para a venda.
- A sincronização: O.S criada, conflito, escolha da versão e erro.
- A impressão de 80 mm, a senha local e o endereço do servidor.

## Arquivos

- `gestor_os/app.py`: o fluxo do app, o vigia em segundo plano e a impressão pelo WebView2.
- `gestor_os/ponte.py`: os métodos que as telas chamam por `window.pywebview.api`.
- `gestor_os/base_local.py`: a base SQLite da contingência.
- `gestor_os/sincronizacao.py`: o envio das O.S, o tratamento de conflito e a escolha da versão.
- `gestor_os/impressao.py`: o ESC/POS de 80 mm, a lista de impressoras e o resumo da sincronização.
- `gestor_os/web/`: as telas locais (servidor, servidor fora, contingência e sincronização).
- `instalador/gestor-os.iss`: o instalador do Inno Setup.
- No servidor, `server/os-desktop.js` e `server/desktop-http.js` tratam da cópia, da sincronização, do download e da versão.
