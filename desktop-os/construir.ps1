# Gera o instalador do Gestor O.S (app desktop) e a versao.json que o serviço do Gestor entrega.
#
#   cd desktop-os
#   powershell -ExecutionPolicy Bypass -File construir.ps1
#
# Saída: desktop-os\saida\GestorOS-Setup.exe + versao.json. O build do Gestor (electron-builder)
# leva essa pasta para resources\desktop, de onde sai o "Baixar aplicativo desktop".

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

$versao = (Select-String -Path 'gestor_os\__init__.py' -Pattern 'VERSAO = "([^"]+)"').Matches[0].Groups[1].Value
Write-Host "Gestor O.S $versao"

# Python 3.10 ou mais novo, com o pythonnet do pywebview (testado no 3.14).
if (-not (Test-Path '.venv\Scripts\python.exe')) {
  python -m venv .venv
  if ($LASTEXITCODE -ne 0) { throw 'Não foi possível criar o .venv: confira o Python no PATH.' }
}
& .\.venv\Scripts\python.exe -m pip install --upgrade pip | Out-Null
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt

& .\.venv\Scripts\python.exe -m unittest discover -s testes -v
if ($LASTEXITCODE -ne 0) { throw 'Testes falharam: o instalador não foi gerado.' }

& .\.venv\Scripts\pyinstaller.exe --noconfirm --clean --windowed `
  --name GestorOS `
  --icon ..\build\icon.ico `
  --add-data "gestor_os\web;gestor_os\web" `
  iniciar.py

$iscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
if (-not (Test-Path $iscc)) { throw 'Inno Setup 6 não encontrado.' }
& $iscc "/DAppVersion=$versao" 'instalador\gestor-os.iss'

$info = [ordered]@{ versao = $versao; data = (Get-Date -Format 'yyyy-MM-dd'); arquivo = 'GestorOS-Setup.exe' }
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'saida\versao.json'), ($info | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
Write-Host "Pronto: saida\GestorOS-Setup.exe ($versao)"
