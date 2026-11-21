param(
  [string]$OutFile
)

$ErrorActionPreference = 'Stop'

# 片段必须按此顺序拼接，顺序错了会破坏 HTML 结构或 JS 作用域。
$order = @(
  '_p1_head.html',
  '_p2_css2.css',
  '_p3_console_a.html',
  '_p4_console_b.html',
  '_p5_output.html',
  '_p6_js_core.js',
  '_p7_js_clock.js',
  '_p8_js_out.js',
  '_p9_js_console.js'
)

$root = Split-Path -Parent $PSScriptRoot
$srcDir = Join-Path $root 'src'

$missing = $order | Where-Object { -not (Test-Path -LiteralPath (Join-Path $srcDir $_)) }
if ($missing) {
  throw ("缺少片段：" + ($missing -join ', '))
}

$text = ($order | ForEach-Object {
  [IO.File]::ReadAllText((Join-Path $srcDir $_), [Text.Encoding]::UTF8)
}) -join "`n"

if (-not $OutFile) { $OutFile = Join-Path $root 'LiveLyric.html' }
$OutFile = [IO.Path]::GetFullPath($OutFile)

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($OutFile, $text, $utf8NoBom)

$size = (Get-Item -LiteralPath $OutFile).Length
Write-Output ("built: {0} ({1} bytes)" -f $OutFile, $size)
