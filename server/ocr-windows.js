'use strict';
/**
 * OCR nativo do Windows 10/11 (Windows.Media.Ocr) via PowerShell — sem dependência extra.
 * Usado para ler os 44 dígitos impressos da chave quando a barra não decodifica.
 */
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const SCRIPT = String.raw`
param([string]$Path)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${'`'}1'
})[0]
function Await($op, [Type]$t) {
  $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op))
  $task.Wait() | Out-Null
  $task.Result
}
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('en-US')) }
if (-not $engine) { exit 3 }
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
foreach ($line in $result.Lines) { $line.Text }
$stream.Dispose()
`;

let scriptPath = null;
function garantirScript() {
  if (scriptPath && fs.existsSync(scriptPath)) return scriptPath;
  const dir = path.join(os.tmpdir(), 'gestor-estoque');
  fs.mkdirSync(dir, { recursive: true });
  scriptPath = path.join(dir, 'ocr-windows.ps1');
  fs.writeFileSync(scriptPath, `\ufeff${SCRIPT}`, 'utf8');
  return scriptPath;
}

/** Retorna as linhas reconhecidas (ou [] se o OCR não estiver disponível). */
function ocrLinhas(buffer, { timeoutMs = 20000 } = {}) {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return new Promise((resolve) => {
    let img;
    try {
      const dir = path.join(os.tmpdir(), 'gestor-estoque');
      fs.mkdirSync(dir, { recursive: true });
      img = path.join(dir, `ocr-${crypto.randomBytes(8).toString('hex')}.img`);
      fs.writeFileSync(img, buffer);
    } catch {
      resolve([]);
      return;
    }
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', garantirScript(), '-Path', img],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024, encoding: 'utf8' },
      (err, stdout) => {
        fs.unlink(img, () => {});
        if (err && !stdout) {
          resolve([]);
          return;
        }
        resolve(String(stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
      }
    );
  });
}

module.exports = { ocrLinhas };
