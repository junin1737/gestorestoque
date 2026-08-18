param(
  [Parameter(Mandatory = $true)][string]$ResDir,
  [Parameter(Mandatory = $true)][string]$Initials,
  [string]$HasLogo = "0",
  [string]$LogoPath = ""
)

Add-Type -AssemblyName System.Drawing

function New-Graphics([System.Drawing.Bitmap]$bmp) {
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  return $g
}

function Get-AverageColor([System.Drawing.Bitmap]$img) {
  $r = 0L; $g = 0L; $b = 0L; $n = 0L
  $step = [Math]::Max(1, [int]($img.Width / 16))
  for ($y = 0; $y -lt $img.Height; $y += $step) {
    for ($x = 0; $x -lt $img.Width; $x += $step) {
      $c = $img.GetPixel($x, $y)
      if ($c.A -lt 80) { continue }
      $r += $c.R; $g += $c.G; $b += $c.B; $n++
    }
  }
  if ($n -lt 1) { return [System.Drawing.Color]::FromArgb(30, 58, 95) }
  return [System.Drawing.Color]::FromArgb([int]($r / $n), [int]($g / $n), [int]($b / $n))
}

function Draw-RoundedRect([System.Drawing.Graphics]$g, [System.Drawing.Brush]$brush, [int]$size, [float]$radius) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $radius * 2
  $path.AddArc(0, 0, $d, $d, 180, 90)
  $path.AddArc($size - $d, 0, $d, $d, 270, 90)
  $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
  $path.AddArc(0, $size - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $g.FillPath($brush, $path)
  $path.Dispose()
}

function Draw-InitialsIcon([int]$size, [System.Drawing.Color]$bg, [string]$text, [bool]$round) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = New-Graphics $bmp
  $g.Clear([System.Drawing.Color]::Transparent)
  $brush = New-Object System.Drawing.SolidBrush $bg
  if ($round) {
    $g.FillEllipse($brush, 0, 0, $size - 1, $size - 1)
  } else {
    Draw-RoundedRect $g $brush $size ($size * 0.22)
  }
  $fontSize = [single][Math]::Max(12, [int]($size * 0.38))
  $style = [System.Drawing.FontStyle]::Bold
  $unit = [System.Drawing.GraphicsUnit]::Pixel
  $font = New-Object System.Drawing.Font("Segoe UI", $fontSize, $style, $unit)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $rect = New-Object System.Drawing.RectangleF 0, ($size * 0.04), $size, $size
  $g.DrawString($text, $font, $white, $rect, $sf)
  $white.Dispose(); $font.Dispose(); $sf.Dispose(); $brush.Dispose(); $g.Dispose()
  return $bmp
}

function Fit-Logo([System.Drawing.Image]$logo, [int]$size, [System.Drawing.Color]$bg, [bool]$round) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = New-Graphics $bmp
  $g.Clear([System.Drawing.Color]::Transparent)
  $brush = New-Object System.Drawing.SolidBrush $bg
  if ($round) {
    $g.FillEllipse($brush, 0, 0, $size - 1, $size - 1)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddEllipse(0, 0, $size - 1, $size - 1)
    $g.SetClip($path)
    $path.Dispose()
  } else {
    Draw-RoundedRect $g $brush $size ($size * 0.22)
  }
  $pad = [int]($size * 0.14)
  $box = $size - (2 * $pad)
  $scale = [Math]::Min($box / [double]$logo.Width, $box / [double]$logo.Height)
  $w = [int]($logo.Width * $scale)
  $h = [int]($logo.Height * $scale)
  $x = [int](($size - $w) / 2)
  $y = [int](($size - $h) / 2)
  $g.DrawImage($logo, $x, $y, $w, $h)
  $brush.Dispose(); $g.Dispose()
  return $bmp
}

function Draw-Foreground([int]$size, [System.Drawing.Color]$bg, [System.Drawing.Image]$logo, [string]$text) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = New-Graphics $bmp
  $g.Clear([System.Drawing.Color]::Transparent)
  $inner = [int]($size * 0.62)
  $ox = [int](($size - $inner) / 2)
  $oy = $ox
  if ($logo) {
    $tile = Fit-Logo $logo $inner $bg $false
    $g.DrawImage($tile, $ox, $oy, $inner, $inner)
    $tile.Dispose()
  } else {
    $tile = Draw-InitialsIcon $inner $bg $text $false
    $g.DrawImage($tile, $ox, $oy, $inner, $inner)
    $tile.Dispose()
  }
  $g.Dispose()
  return $bmp
}

function Save-Png([System.Drawing.Bitmap]$bmp, [string]$file) {
  $dir = Split-Path $file -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
}

$bg = [System.Drawing.Color]::FromArgb(30, 58, 95)
$logo = $null
if ($HasLogo -eq "1" -and $LogoPath -and (Test-Path $LogoPath)) {
  try {
    $logo = [System.Drawing.Image]::FromFile((Resolve-Path $LogoPath))
    $bg = Get-AverageColor $logo
  } catch {
    Write-Host "Falha ao abrir logo, usando iniciais. $_"
    $logo = $null
  }
}

$hex = "#{0:X2}{1:X2}{2:X2}" -f $bg.R, $bg.G, $bg.B
$colorsFile = Join-Path $ResDir "values\colors.xml"
if (Test-Path $colorsFile) {
  $xml = Get-Content $colorsFile -Raw
            $xml = [regex]::Replace($xml, '(<color name="ic_launcher_background">)#?[0-9A-Fa-f]{6}(</color>)', "`${1}$hex`${2}")
            [System.IO.File]::WriteAllText($colorsFile, $xml)
}

$densities = @{
  "mipmap-mdpi"    = 48
  "mipmap-hdpi"    = 72
  "mipmap-xhdpi"   = 96
  "mipmap-xxhdpi"  = 144
  "mipmap-xxxhdpi" = 192
}

foreach ($folder in $densities.Keys) {
  $size = $densities[$folder]
  if ($logo) {
    $sq = Fit-Logo $logo $size $bg $false
    $rd = Fit-Logo $logo $size $bg $true
  } else {
    $sq = Draw-InitialsIcon $size $bg $Initials $false
    $rd = Draw-InitialsIcon $size $bg $Initials $true
  }
  Save-Png $sq (Join-Path $ResDir "$folder\ic_launcher.png")
  Save-Png $rd (Join-Path $ResDir "$folder\ic_launcher_round.png")
  $sq.Dispose(); $rd.Dispose()
}

$fg = Draw-Foreground 432 $bg $logo $Initials
$fgDir = Join-Path $ResDir "drawable-nodpi"
Save-Png $fg (Join-Path $fgDir "ic_launcher_foreground.png")
$fg.Dispose()
if ($logo) { $logo.Dispose() }

Write-Host "Ícone gerado: $Initials fundo $hex"
