; Firewall TCP 5078 para acesso do painel na rede local (edicao online, lado a lado com o Gestor Estoque normal na 5077)
!macro customInstall
  ExecWait 'netsh advfirewall firewall delete rule name="Gestor Estoque Online"'
  ExecWait 'netsh advfirewall firewall add rule name="Gestor Estoque Online" dir=in action=allow protocol=TCP localport=5078 profile=any'
!macroend

!macro customUnInstall
  ExecWait 'netsh advfirewall firewall delete rule name="Gestor Estoque Online"'
!macroend

!ifndef BUILD_UNINSTALLER
Function .onInstSuccess
  Exec '"$INSTDIR\${PRODUCT_FILENAME}.exe"'
FunctionEnd

Function .onInstFailed
  IfFileExists "$INSTDIR\${PRODUCT_FILENAME}.exe" 0 semApp
  Exec '"$INSTDIR\${PRODUCT_FILENAME}.exe"'
  semApp:
FunctionEnd
!endif
