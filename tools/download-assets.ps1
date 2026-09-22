$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$icons = Join-Path $root 'src/_logo/icons'
New-Item -ItemType Directory -Force $icons, (Join-Path $root 'src/_logo/art'), (Join-Path $root 'public/fonts'), (Join-Path $root '.cache/research') | Out-Null
$names = 'book-open','folder-open','languages','settings-2','upload','download','plus','minus','chevron-down','chevron-left','chevron-right','x','underline','highlighter','message-square','type','pencil','eraser','undo-2','redo-2','search','file-text','cloud','database','sparkles','send','copy','volume-2','check','circle-help','arrow-up-right','panel-left-close','menu','shield-check','refresh-cw','trash-2','stop-circle','eye','external-link','loader-circle','arrow-left','expand','bot','key-round','monitor','smartphone','history','circle-alert'
foreach ($name in $names) {
  if (Test-Path (Join-Path $icons "$name.svg")) { continue }
  $remoteName = switch ($name) { 'circle-help' { 'circle-question-mark' } 'stop-circle' { 'circle-stop' } default { $name } }
  Invoke-WebRequest -Uri "https://raw.githubusercontent.com/lucide-icons/lucide/0.468.0/icons/$remoteName.svg" -OutFile (Join-Path $icons "$name.svg")
}
foreach ($name in @('strikethrough','shapes','rectangle-horizontal','circle','gallery-vertical-end','bookmark')) {
  if (-not (Test-Path (Join-Path $icons "$name.svg"))) {
    Invoke-WebRequest -Uri "https://raw.githubusercontent.com/lucide-icons/lucide/0.468.0/icons/$name.svg" -OutFile (Join-Path $icons "$name.svg")
  }
}
Invoke-WebRequest 'https://raw.githubusercontent.com/lucide-icons/lucide/main/LICENSE' -OutFile (Join-Path $root 'src/_logo/LUCIDE-LICENSE')
Invoke-WebRequest 'https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Open%20book/3D/open_book_3d.png' -OutFile (Join-Path $root 'src/_logo/art/open-book.png')
Invoke-WebRequest 'https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Sparkles/3D/sparkles_3d.png' -OutFile (Join-Path $root 'src/_logo/art/sparkles.png')
Invoke-WebRequest 'https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/LICENSE' -OutFile (Join-Path $root 'src/_logo/FLUENT-LICENSE')
Invoke-WebRequest 'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf' -OutFile (Join-Path $root 'public/fonts/NotoSansSC-Regular.otf')
Invoke-WebRequest 'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/LICENSE' -OutFile (Join-Path $root 'public/fonts/LICENSE')
Invoke-WebRequest 'https://mozilla.github.io/pdf.js/examples/' -OutFile (Join-Path $root '.cache/research/pdfjs.html')
Invoke-WebRequest 'https://pdf-lib.js.org/' -OutFile (Join-Path $root '.cache/research/pdf-lib.html')
Invoke-WebRequest 'https://dictionaryapi.dev/' -OutFile (Join-Path $root '.cache/research/dictionary.html')
try { Invoke-WebRequest 'https://mymemory.translated.net/doc/spec.php' -OutFile (Join-Path $root '.cache/research/mymemory.html') } catch { Write-Warning 'MyMemory documentation endpoint rejected this request.' }
try { Invoke-WebRequest 'https://developers.openai.com/api/docs/guides/file-inputs' -OutFile (Join-Path $root '.cache/research/openai-pdf.html') } catch { Write-Warning 'OpenAI documentation endpoint is unavailable.' }
Copy-Item -LiteralPath 'D:/Models/vibe_coding/fritia_online_next_chat/LICENSE' -Destination (Join-Path $root 'LICENSE')
Write-Output 'Downloaded Lucide icons, Fluent illustrations, Noto font, licenses, and official library documentation.'
