$ErrorActionPreference = 'Stop'
$probeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\test-results'))
$probeWord = New-Object -ComObject Word.Application
$probeWord.Visible = $false
$probeWord.DisplayAlerts = 0
$probeWord.AutomationSecurity = 3
try {
  $probeDocument = $probeWord.Documents.Open((Join-Path $probeRoot 'word-export-probe.docx'), $false, $true, $false)
  Write-Output 'Exporting one-page plain document'
  $probeDocument.ExportAsFixedFormat((Join-Path $probeRoot 'word-export-probe.xps'), 18)
  Write-Output 'Plain document XPS succeeded'
  $probeDocument.Close(0)
} finally { $probeWord.Quit() }
