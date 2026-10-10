$ErrorActionPreference = 'Stop'
$guideVersion = (Get-Content (Join-Path $PSScriptRoot '..\package.json') -Raw | ConvertFrom-Json).version
$guideDocx = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ('..\artifacts\guide\EluShell操作指南-' + $guideVersion + '.docx')))
$guideRender = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\artifacts\guide\rendered'))
New-Item -ItemType Directory -Path $guideRender -Force | Out-Null
$guidePdf = Join-Path $guideRender ('guide-' + $guideVersion + '-' + [Guid]::NewGuid().ToString('N') + '.pdf')
$guideWord = $null
$guideDocument = $null
try {
  $guideWord = New-Object -ComObject Word.Application
  $guideWord.Visible = $false
  $guideWord.DisplayAlerts = 0
  $guideWord.ScreenUpdating = $false
  $guideWord.AutomationSecurity = 3
  Write-Output 'Opening guide in Word'
  $guideDocument = $guideWord.Documents.Open($guideDocx, $false, $false, $false)
  Write-Output 'Updating guide fields'
  $guideDocument.Fields.Update() | Out-Null
  $guideDocument.Repaginate()
  Write-Output 'Saving guide'
  $guideDocument.Save()
  Write-Output 'Exporting guide PDF'
  $guideDocument.SaveAs2($guidePdf, 17)
  Write-Output ('Native Word render pages: ' + $guideDocument.ComputeStatistics(2))
} finally {
  if ($null -ne $guideDocument) { $guideDocument.Close(0); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($guideDocument) }
  if ($null -ne $guideWord) { $guideWord.Quit(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($guideWord) }
}
Copy-Item -LiteralPath $guidePdf -Destination (Join-Path $guideRender 'guide.pdf') -Force
Write-Output ('Guide PDF ready: ' + $guidePdf)
