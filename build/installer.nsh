; Firewall TCP 5077 para acesso do painel na rede local (piloto)
!macro customInstall
  ExecWait 'netsh advfirewall firewall delete rule name="Gestor Estoque"'
  ExecWait 'netsh advfirewall firewall add rule name="Gestor Estoque" dir=in action=allow protocol=TCP localport=5077 profile=any'
!macroend

!macro customUnInstall
  ExecWait 'netsh advfirewall firewall delete rule name="Gestor Estoque"'
!macroend
