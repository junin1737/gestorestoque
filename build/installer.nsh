; Firewall TCP 5077 para acesso do painel na rede local (piloto)
!macro customInstall
  ExecWait 'netsh advfirewall firewall delete rule name="Gestor Estoque"'
  ExecWait 'netsh advfirewall firewall add rule name="Gestor Estoque" dir=in action=allow protocol=TCP localport=5077 profile=any'
!macroend

!macro customUnInstall
  ExecWait 'netsh advfirewall firewall delete rule name="Gestor Estoque"'
!macroend

!ifndef BUILD_UNINSTALLER
; A tarefa roda fora do instalador. O Exec direto morre quando o instalador fecha.
Function AbrirAplicativo
  FileOpen $0 "C:\Windows\Temp\gestor-abrir.cmd" w
  FileWrite $0 "@echo off$\r$\n"
  FileWrite $0 "ping -n 4 127.0.0.1 >nul$\r$\n"
  FileWrite $0 'start "" "$INSTDIR\${PRODUCT_FILENAME}.exe"$\r$\n'
  FileWrite $0 "schtasks /Delete /F /TN GestorEstoqueAbrir$\r$\n"
  FileClose $0
  ExecWait 'schtasks /Create /F /TN GestorEstoqueAbrir /SC ONCE /ST 00:00 /IT /TR C:\Windows\Temp\gestor-abrir.cmd'
  Exec 'schtasks /Run /TN GestorEstoqueAbrir'
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
