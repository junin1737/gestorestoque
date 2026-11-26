; Instalador do Gestor O.S (app desktop da Ordem de Serviço).
; Gerado por construir.ps1:  ISCC.exe /DAppVersion=1.0.0 instalador\gestor-os.iss
;
; - Instala por usuário (sem pedir administrador), então a atualização automática roda em silêncio.
; - Atalho no menu Iniciar e na área de trabalho.
; - Registra gestoros:// para o botão "Abrir aplicativo" do Gestor web.
; - O Gestor entrega o instalador com o nome GestorOS-Setup_<servidor>-<porta>.exe; o endereço vai
;   para servidor.txt e o app abre já configurado.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{6F3B2A1C-9D4E-4C7B-8A51-0E2D9B7C4F10}
AppName=Gestor O.S
AppVersion={#AppVersion}
AppPublisher=MT Automações
DefaultDirName={autopf}\Gestor OS
DefaultGroupName=Gestor O.S
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
OutputDir=..\saida
OutputBaseFilename=GestorOS-Setup
SetupIconFile=..\..\build\icon.ico
UninstallDisplayIcon={app}\GestorOS.exe
Compression=lzma2
SolidCompression=yes
CloseApplications=yes
RestartApplications=no
WizardStyle=modern

[Languages]
Name: "ptbr"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Files]
Source: "..\dist\GestorOS\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Gestor O.S"; Filename: "{app}\GestorOS.exe"
Name: "{userdesktop}\Gestor O.S"; Filename: "{app}\GestorOS.exe"

[Registry]
Root: HKCU; Subkey: "Software\Classes\gestoros"; ValueType: string; ValueName: ""; ValueData: "URL:Gestor O.S"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\gestoros"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\gestoros\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\GestorOS.exe,0"
Root: HKCU; Subkey: "Software\Classes\gestoros\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\GestorOS.exe"" ""%1"""

[Run]
; Também roda na atualização silenciosa: o app volta a abrir sozinho.
Filename: "{app}\GestorOS.exe"; Description: "Abrir o Gestor O.S"; Flags: nowait postinstall

[Code]
{ GestorOS-Setup_192.168.0.10-5077.exe -> 192.168.0.10:5077 (o último hífen é a porta).
  O navegador pode acrescentar " (1)" quando o arquivo já existe: corta antes disso. }
function ServidorDoNome(): String;
var
  Nome, Resto: String;
  P, I, Ultimo: Integer;
begin
  Result := '';
  Nome := ExtractFileName(ExpandConstant('{srcexe}'));
  P := Pos('GestorOS-Setup_', Nome);
  if P <> 1 then Exit;
  Resto := Copy(Nome, Length('GestorOS-Setup_') + 1, Length(Nome));
  P := Pos(' (', Resto);
  if P > 0 then Resto := Copy(Resto, 1, P - 1);
  if Pos('.exe', LowerCase(Resto)) > 0 then Resto := Copy(Resto, 1, Pos('.exe', LowerCase(Resto)) - 1);
  Ultimo := 0;
  for I := 1 to Length(Resto) do
    if Resto[I] = '-' then Ultimo := I;
  if Ultimo > 0 then Resto[Ultimo] := ':';
  Result := Resto;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Servidor: String;
begin
  if CurStep = ssPostInstall then
  begin
    Servidor := ServidorDoNome();
    if Servidor <> '' then
      SaveStringToFile(ExpandConstant('{app}\servidor.txt'), Servidor, False);
  end;
end;
