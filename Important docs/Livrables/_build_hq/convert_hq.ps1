$ErrorActionPreference='Stop'
$pandoc='C:\Users\kfirs\AppData\Local\Pandoc\pandoc.exe'
if(!(Test-Path $pandoc)){ throw 'Pandoc non trouve' }

$workspace = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
Set-Location $workspace
$buildRoot = Join-Path (Get-Location) 'Important docs/Livrables/_build_hq'
New-Item -ItemType Directory -Force -Path $buildRoot | Out-Null

$files = @(
  'Important docs/Livrables/Pack_A_Executif/Rapport_Architecture_Reference_et_Baseline_Infrastructure.md',
  'Important docs/Livrables/Pack_B_Operations/Rapport_Procedure_Deploiement_et_Exploitation.md',
  'Important docs/Livrables/Pack_B_Operations/Rapport_Acces_Distant_Securise_Gateway_VPN.md',
  'Important docs/Livrables/Pack_C_Technique_QA/Rapport_Specification_Codec_ADW300.md',
  'Important docs/Livrables/Pack_C_Technique_QA/Rapport_Edge_NodeRED_Traitement_et_Resilience.md'
)

foreach($rel in $files){
  $src = Join-Path (Get-Location) $rel
  $base = [System.IO.Path]::GetFileNameWithoutExtension($src)
  $assetsRel = $base + '_assets_hq'
  $assetsDir = Join-Path $buildRoot $assetsRel
  New-Item -ItemType Directory -Force -Path $assetsDir | Out-Null

  $text = Get-Content -Raw -Path $src
  $rx = [regex]'```mermaid\r?\n([\s\S]*?)\r?\n```'
  $i = 0

  $rendered = $rx.Replace($text, {
    param($m)
    $script:i++
    $mmd = Join-Path $assetsDir ("diagram-" + $script:i + ".mmd")
    $png = Join-Path $assetsDir ("diagram-" + $script:i + ".png")
    Set-Content -Path $mmd -Value $m.Groups[1].Value -Encoding UTF8
    npx -y @mermaid-js/mermaid-cli -w 3200 -s 3 -i $mmd -o $png | Out-Null
    "![Schema " + $script:i + "](./" + $assetsRel + "/diagram-" + $script:i + ".png)"
  })

  $tmpMd = Join-Path $buildRoot ($base + '.rendered.hq.md')
  Set-Content -Path $tmpMd -Value $rendered -Encoding UTF8

  $dstDocx = [System.IO.Path]::ChangeExtension($src, '.docx')
  & $pandoc $tmpMd -o $dstDocx --resource-path $buildRoot
  Write-Output ("HQ_DOCX_OK:" + $dstDocx)
}
