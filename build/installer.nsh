; Firewall TCP 5078 para acesso do painel na rede local (edicao online, lado a lado com o Gestor Estoque normal na 5077)
!macro customInstall
  ExecWait 'netsh advfirewall firewall delete rule name="Gestor Estoque Online"'
  ExecWait 'netsh advfirewall firewall add rule name="Gestor Estoque Online" dir=in action=allow protocol=TCP localport=5078 profile=any'
!macroend

!macro customUnInstall
  ExecWait 'netsh advfirewall firewall delete rule name="Gestor Estoque Online"'
!macroend

!ifndef BUILD_UNINSTALLER
; A tarefa roda fora do instalador. O Exec direto morre quando o instalador fecha.
Function AbrirAplicativo
  FileOpen $0 "C:\Windows\Temp\gestor-abrir-online.cmd" w
  FileWrite $0 "@echo off$\r$\n"
  FileWrite $0 "ping -n 4 127.0.0.1 >nul$\r$\n"
  FileWrite $0 'start "" "$INSTDIR\${PRODUCT_FILENAME}.exe"$\r$\n'
  FileWrite $0 "schtasks /Delete /F /TN GestorEstoqueOnlineAbrir$\r$\n"
  FileClose $0
  ExecWait 'icacls C:\Windows\Temp\gestor-abrir-online.cmd /grant *S-1-1-0:R'
  ExecWait 'schtasks /Create /F /TN GestorEstoqueOnlineAbrir /SC ONCE /ST 00:00 /IT /TR C:\Windows\Temp\gestor-abrir-online.cmd'
  Exec 'schtasks /Run /TN GestorEstoqueOnlineAbrir'
FunctionEnd

Function .onInstSuccess
  Call AbrirAplicativo
FunctionEnd

Function .onInstFailed
  IfFileExists "$INSTDIR\${PRODUCT_FILENAME}.exe" 0 semApp
  Call AbrirAplicativo
  semApp:
FunctionEnd
!endif
