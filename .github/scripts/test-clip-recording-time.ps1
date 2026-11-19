#Requires -Version 7.6
# Usage: pwsh -NoProfile -File .github/scripts/test-clip-recording-time.ps1 <published Windows app DLL>
param([Parameter(Mandatory)][string]$AssemblyPath)

$ErrorActionPreference = 'Stop'
$assembly = [Reflection.Assembly]::LoadFrom((Resolve-Path -LiteralPath $AssemblyPath).Path)
$settingsType = $assembly.GetType('Segra.Backend.Core.Models.Settings', $true)
$settings = $settingsType::Instance
$state = $assembly.GetType('Segra.Backend.Core.Models.AppState', $true)::Instance
$messageType = $assembly.GetType('Segra.Backend.App.MessageService', $true)
$createClip = $messageType.GetMethod('HandleCreateClip', [Reflection.BindingFlags]'Static,NonPublic')
$loader = $assembly.GetType('Segra.Backend.Core.SettingsService', $true)
$embeddedMetadata = $assembly.GetType('Segra.Backend.Media.EmbeddedMetadataService', $true)
$ffmpeg = (Get-Command ffmpeg -CommandType Application | Select-Object -First 1).Source
$originalDirectory = [Environment]::CurrentDirectory
$tempParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
$fixture = [IO.Directory]::CreateTempSubdirectory('segrabi-clip-time-').FullName
$library = Join-Path $fixture 'library'
$cache = Join-Path $fixture 'cache'
$sample = Join-Path $fixture 'sample.mp4'

function New-Source($type, $name, [datetime]$created, $extra) {
    $folder = if ($type -eq 'Buffer') { 'Replay Buffers' } else { 'Full Sessions' }
    $videoDir = [IO.Directory]::CreateDirectory((Join-Path $library $folder)).FullName
    $metadataDir = [IO.Directory]::CreateDirectory((Join-Path $cache 'metadata' $folder)).FullName
    $filePath = Join-Path $videoDir "$name.mp4"
    [IO.File]::Copy($sample, $filePath)
    $id = [guid]::NewGuid().ToString('N')
    @{
        Id = $id; Type = $type; FileName = $name; FilePath = $filePath; Game = 'Fixture'
        CreatedAt = $created; Duration = '00:00:06'; Bookmarks = @()
    } + $extra | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $metadataDir "$id.json")
    return $id
}

function Invoke-Export($segments, $mode = 'combined') {
    $previous = @($state.Content.Id)
    $document = [Text.Json.JsonDocument]::Parse((@{ Segments = @($segments); OutputMode = $mode } | ConvertTo-Json -Depth 4))
    try {
        [void]$createClip.Invoke($null, @($document.RootElement)).WaitAsync([timespan]::FromSeconds(90)).GetAwaiter().GetResult()
    } finally { $document.Dispose() }
    $clips = @($state.Content | Where-Object { $_.Type -eq 'Clip' -and $_.Id -notin $previous })
    $expectedCount = if ($mode -eq 'separate') { @($segments).Count } else { 1 }
    if ($clips.Count -ne $expectedCount) { throw "Expected $expectedCount new clips, found $($clips.Count)" }
    return $clips
}

function Assert-DatedClip($clip, [datetime]$expected, $suffix = '') {
    $fileName = $expected.ToString('yyyy-MM-dd_HH-mm-ss') + $suffix + '.mp4'
    if ($clip.CreatedAt -ne $expected -or $clip.ExportedAt -lt $testStart -or
        [IO.Path]::GetFileName($clip.FilePath) -ne $fileName -or !(Test-Path -LiteralPath $clip.FilePath)) {
        throw "Expected $fileName dated $expected with a fresh export date, got $($clip.FilePath) / $($clip.CreatedAt) / $($clip.ExportedAt)"
    }
    $embedded = $embeddedMetadata::ReadAsync($clip.FilePath).GetAwaiter().GetResult()
    if ($embedded.CreatedAt -ne $expected -or $embedded.ExportedAt -ne $clip.ExportedAt) {
        throw "MP4 metadata did not preserve both dates in $fileName"
    }
}

try {
    # Use private fixture roots before starting any service; the public ContentFolder setter saves the profile.
    $settings._isBulkUpdating = $true
    $settingsType.GetField('_contentFolder', 'Instance,NonPublic').SetValue($settings, $library.Replace('\', '/'))
    $settings.CacheFolder = $cache
    $settings.ClipEncoder = 'cpu'
    $settings.ClipPreset = 'ultrafast'
    [Environment]::CurrentDirectory = [IO.Path]::GetDirectoryName($ffmpeg)
    # This headless process has no UI to receive export progress.
    [void]$messageType.GetField('ResentOnConnect', 'Static,NonPublic').GetValue($null).Add('ClipProgress')
    & $ffmpeg -nostdin -hide_banner -loglevel error -f lavfi -i 'color=s=64x64:r=10' -f lavfi -i 'anullsrc=r=48000:cl=stereo' -t 6 -c:v libx264 -c:a aac $sample
    if ($LASTEXITCODE -ne 0) { throw 'Could not create sample MP4' }

    $sessionStart = [datetime]::new(2025, 4, 4, 23, 59, 57, [DateTimeKind]::Local)
    $replayEnd = [datetime]::new(2025, 4, 3, 18, 0, 6, [DateTimeKind]::Local)
    $sessionId = New-Source 'Session' 'Renamed session' $sessionStart.AddSeconds(7) @{ RecordingStartedAt = $sessionStart.ToUniversalTime() }
    $bufferId = New-Source 'Buffer' '2025-04-03_18-00-06' $replayEnd.AddSeconds(1) @{}
    $importId = New-Source 'Session' 'Unknown capture time' $sessionStart @{ IsImported = $true }
    [void]$loader::LoadContentFromFolderIntoState($false, $false).GetAwaiter().GetResult()
    $session = @{ id = 1; contentId = $sessionId; startTime = 3; endTime = 5 }
    $replay = @{ id = 2; contentId = $bufferId; startTime = 1; endTime = 3 }
    $testStart = [datetime]::Now.AddSeconds(-1)

    if ($settings.ClipUseRecordingEndTime) { throw 'Source dating must default to off' }
    $defaultClip = Invoke-Export $session
    if ($defaultClip.CreatedAt -lt $testStart -or $null -ne $defaultClip.ExportedAt) { throw 'Unexpected default clip date' }

    $settings.ClipUseRecordingEndTime = $true
    $separate = @(Invoke-Export @($session, $replay) 'separate')
    Assert-DatedClip ($separate | Where-Object FileName -like '*_segment-001') $sessionStart.AddSeconds(5) '_segment-001'
    Assert-DatedClip ($separate | Where-Object FileName -like '*_segment-002') $replayEnd.AddSeconds(-3) '_segment-002'
    # The edit ends on the earlier recording. Its last segment determines the date.
    Assert-DatedClip (Invoke-Export @($session, $replay)) $replayEnd.AddSeconds(-3)
    $unknown = Invoke-Export @{ id = 3; contentId = $importId; startTime = 1; endTime = 2 }
    if ($unknown.CreatedAt -lt $testStart -or $null -ne $unknown.ExportedAt) { throw 'Unknown source did not fall back to export time' }
    Write-Output 'Clip dates passed for default exports, separate and combined exports, midnight, a legacy replay and unknown capture time.'
} finally {
    [Environment]::CurrentDirectory = $originalDirectory
    $resolved = (Resolve-Path -LiteralPath $fixture).Path
    if ([IO.Path]::GetDirectoryName($resolved) -eq $tempParent -and [IO.Path]::GetFileName($resolved).StartsWith('segrabi-clip-time-')) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
