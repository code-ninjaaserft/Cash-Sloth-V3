$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$brandingRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../assets/branding'))
$manifest = Get-Content -LiteralPath (Join-Path $brandingRoot 'manifest.json') -Raw | ConvertFrom-Json
$original = Join-Path $brandingRoot $manifest.original.file
$originalHash = (Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash.ToLowerInvariant()
if ($originalHash -ne $manifest.original.sha256) { throw 'Official original checksum mismatch; review the source asset before regenerating.' }
$generatedDirectory = Join-Path $brandingRoot 'generated'
New-Item -ItemType Directory -Path $generatedDirectory -Force | Out-Null

$source = [System.Drawing.Image]::FromFile($original)
try {
    if ($source.Width -ne $manifest.original.width -or $source.Height -ne $manifest.original.height) {
        throw 'Unexpected original dimensions.'
    }
    if ($source.Width -ne $source.Height) { throw 'Expected the official square logo; do not crop or stretch a replacement.' }
    $frames = [System.Collections.Generic.List[byte[]]]::new()
    foreach ($size in $manifest.windowsIconSizes) {
        $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $attributes = [System.Drawing.Imaging.ImageAttributes]::new()
        $memory = [System.IO.MemoryStream]::new()
        try {
            $graphics.Clear([System.Drawing.Color]::Transparent)
            $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
            $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $attributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
            $graphics.DrawImage($source, [System.Drawing.Rectangle]::new(0, 0, $size, $size), 0, 0, $source.Width, $source.Height, [System.Drawing.GraphicsUnit]::Pixel, $attributes)
            $bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
            $bytes = $memory.ToArray()
            $frames.Add($bytes)
            if ($size -in @(128, 256)) {
                [System.IO.File]::WriteAllBytes((Join-Path $generatedDirectory "cash-sloth-$size.png"), $bytes)
            }
        } finally {
            $memory.Dispose()
            $attributes.Dispose()
            $graphics.Dispose()
            $bitmap.Dispose()
        }
    }

    $iconStream = [System.IO.MemoryStream]::new()
    $writer = [System.IO.BinaryWriter]::new($iconStream)
    try {
        $writer.Write([uint16]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]$frames.Count)
        $offset = 6 + 16 * $frames.Count
        for ($index = 0; $index -lt $frames.Count; $index++) {
            $size = $manifest.windowsIconSizes[$index]
            $dimension = if ($size -eq 256) { 0 } else { $size }
            $writer.Write([byte]$dimension)
            $writer.Write([byte]$dimension)
            $writer.Write([byte]0)
            $writer.Write([byte]0)
            $writer.Write([uint16]1)
            $writer.Write([uint16]32)
            $writer.Write([uint32]$frames[$index].Length)
            $writer.Write([uint32]$offset)
            $offset += $frames[$index].Length
        }
        foreach ($frame in $frames) { $writer.Write($frame) }
        $writer.Flush()
        [System.IO.File]::WriteAllBytes((Join-Path $brandingRoot $manifest.files.windowsIcon), $iconStream.ToArray())
    } finally {
        $writer.Dispose()
        $iconStream.Dispose()
    }
} finally {
    $source.Dispose()
}
Write-Output "Official original preserved ($originalHash). Generated 128/256 px PNGs and nine-frame Windows ICO."
