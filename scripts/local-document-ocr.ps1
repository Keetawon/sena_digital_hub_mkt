param([Parameter(Mandatory=$true)][string]$ImagePath, [Parameter(Mandatory=$true)][string]$ArchiveWorkRoot)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Storage.FileAccessMode, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime]
$genericTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Wait-Result($Operation, [Type]$ResultType) {
    $task = $genericTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    $task.Wait()
    return $task.Result
}
try {
    # The Python worker passes only its locally rendered synthetic page; no URLs.
    $resolvedImage = [System.IO.Path]::GetFullPath($ImagePath)
    $workRoot = [System.IO.Path]::GetFullPath($ArchiveWorkRoot) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $resolvedImage.StartsWith($workRoot, [System.StringComparison]::OrdinalIgnoreCase) -or [System.IO.Path]::GetExtension($resolvedImage) -ne '.png') { throw 'Invalid OCR input' }
    $file = Wait-Result ([Windows.Storage.StorageFile]::GetFileFromPathAsync($resolvedImage)) ([Windows.Storage.StorageFile])
    $stream = Wait-Result ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    try {
        $decoder = Wait-Result ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bitmap = Wait-Result ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        try {
            $language = [Windows.Globalization.Language]::new('en-US')
            $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
            if ($null -eq $engine) { throw 'OCR language unavailable' }
            $result = Wait-Result ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
            $lines = @($result.Lines | ForEach-Object {
                @{text=$_.Text; words=@($_.Words | ForEach-Object {
                    @{text=$_.Text; x=$_.BoundingRect.X; y=$_.BoundingRect.Y; width=$_.BoundingRect.Width; height=$_.BoundingRect.Height}
                })}
            })
            @{text=($lines.text -join "`n"); lines=$lines; engine='Windows.Media.Ocr'; language='en-US'; version=[Environment]::OSVersion.Version.ToString(); confidence=$null} | ConvertTo-Json -Depth 8 -Compress
        } finally { $bitmap.Dispose() }
    } finally { $stream.Dispose() }
} catch {
    # Do not emit source text, filename, engine payloads or exception diagnostics.
    [Console]::Error.WriteLine('LOCAL_OCR_UNAVAILABLE')
    exit 1
}
