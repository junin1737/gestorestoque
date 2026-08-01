# Projeto Android separado (WebView do painel).
# Não altera o Electron/servidor/painel existentes.

Gera o APK:
  cd android-app
  .\gradlew.bat assembleRelease

Saída:
  app\build\outputs\apk\release\app-release.apk

Uso:
  1. No PC, inicie o Gestor Estoque (serviço na porta 5077).
  2. Instale o APK no celular (mesma Wi-Fi).
  3. Informe o IP mostrado na tela do serviço (ex.: 192.168.0.123).
