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
        CreatedAt = $created; Duration = '00:00:06'
    } + $extra | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $metadataDir "$id.json")
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

function Assert-FileDates($clip, [datetime]$expected) {
    $file = Get-Item -LiteralPath $clip.FilePath
    if ($file.CreationTimeUtc -ne $expected.ToUniversalTime() -or $file.LastWriteTimeUtc -ne $expected.ToUniversalTime()) {
        throw "Unexpected filesystem dates on $($file.Name): created $($file.CreationTimeUtc.ToString('o')), modified $($file.LastWriteTimeUtc.ToString('o')), expected $($expected.ToUniversalTime().ToString('o'))"
    }
}

function Assert-Events($clip, [string[]]$expected) {
    $metadata = $embeddedMetadata::ReadAsync($clip.FilePath).GetAwaiter().GetResult()
    foreach ($media in $clip, $metadata) {
        $events = @($media.Bookmarks | Where-Object { $_.Type -in 'Manual','Kill','Goal' } | Sort-Object Time |
            ForEach-Object { '{0}@{1}' -f $_.Type, $_.Time.TotalSeconds.ToString('0.#######', [cultureinfo]::InvariantCulture) })
        if (($events -join ',') -ne ($expected -join ',')) {
            throw "Unexpected events in $($clip.FileName): $events (expected $expected)"
        }
    }
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
    Assert-FileDates $clip $expected
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
    $sessionId = New-Source 'Session' 'Renamed session' $sessionStart.AddSeconds(7) @{
        RecordingStartedAt = $sessionStart.ToUniversalTime()
        Bookmarks = @(@{Type='Kill';Time='00:00:03.125'}, @{Type='Kill';Time='00:00:04.500'}, @{Type='Kill';Time='00:00:05'})
    }
    $bufferId = New-Source 'Buffer' '2025-04-03_18-00-06' $replayEnd.AddSeconds(1) @{
        Bookmarks = @(@{Type='Goal';Time='00:00:01.750'})
    }
    $importId = New-Source 'Session' 'Unknown capture time' $sessionStart @{ IsImported = $true }
    [void]$loader::LoadContentFromFolderIntoState($false, $false).GetAwaiter().GetResult()
    $session = @{ id = 1; contentId = $sessionId; startTime = 3; endTime = 5 }
    $replay = @{ id = 2; contentId = $bufferId; startTime = 1; endTime = 3 }
    $testStart = [datetime]::Now.AddSeconds(-1)

    if ($settings.ClipUseRecordingEndTime) { throw 'Source dating must default to off' }
    $defaultClip = Invoke-Export $session
    if ($defaultClip.CreatedAt -lt $testStart -or $null -ne $defaultClip.ExportedAt) { throw 'Unexpected default clip date' }
    $file = Get-Item -LiteralPath $defaultClip.FilePath
    if ($file.CreationTime -lt $testStart -or $file.LastWriteTime -lt $testStart) { throw 'Default clip has an old file date' }

    $settings.ClipUseRecordingEndTime = $true
    $separate = @(Invoke-Export @($session, $replay) 'separate')
    Assert-DatedClip ($separate | Where-Object FileName -like '*_segment-001') $sessionStart.AddSeconds(5) '_segment-001'
    Assert-DatedClip ($separate | Where-Object FileName -like '*_segment-002') $replayEnd.AddSeconds(-3) '_segment-002'
    # The edit ends on the earlier recording. Its last segment determines the date.
    $combined = Invoke-Export @($session, $replay)
    Assert-DatedClip $combined $replayEnd.AddSeconds(-3)
    Assert-Events ($separate | Where-Object FileName -like '*_segment-001') @('Kill@0.125','Kill@1.5')
    Assert-Events ($separate | Where-Object FileName -like '*_segment-002') @('Goal@0.75')
    Assert-Events $combined @('Kill@0.125','Kill@1.5','Goal@2.75')
    $combined.Title = 'Edited after exporting'
    [void]$embeddedMetadata::EmbedAsync($combined).GetAwaiter().GetResult()
    if ($embeddedMetadata::ReadAsync($combined.FilePath).GetAwaiter().GetResult().Title -ne $combined.Title) {
        throw 'The test edit did not update the embedded title'
    }
    Assert-FileDates $combined $replayEnd.AddSeconds(-3)
    $unknown = Invoke-Export @{ id = 3; contentId = $importId; startTime = 1; endTime = 2 }
    if ($unknown.CreatedAt -lt $testStart -or $null -ne $unknown.ExportedAt) { throw 'Unknown source did not fall back to export time' }
    $reclip = Invoke-Export @{ id = 4; contentId = $combined.Id; startTime = 1.25; endTime = 3.2 }
    Assert-Events $reclip @('Kill@0.25','Goal@1.5')

    # Simulate old exports: keep the parent-child provenance and a bookmark added by the player.
    $metadataFolder = $assembly.GetType('Segra.Backend.Shared.FolderNames', $true)
    foreach ($item in $state.Content) {
        $path = $metadataFolder::GetMetadataFilePath($item.Type, $item.Id)
        $record = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json -AsHashtable
        if ($item.Id -eq $combined.Id -or $item.Id -eq $reclip.Id) {
            $record.Bookmarks = @($record.Bookmarks | Where-Object Type -eq 'ClipSaved')
        }
        if ($item.Id -ne $combined.Id) {
            $record.Bookmarks = @($record.Bookmarks | Where-Object { $_ -and $_.MediaId -ne $reclip.Id })
        }
        if ($item.Id -eq $reclip.Id) { $record.Bookmarks += @{Id=123;Type='Manual';Time='00:00:00.500'} }
        $record | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $path
    }
    $migration = $assembly.GetType('Segra.Backend.App.MigrationService', $true).GetMethod(
        'Apply_0025_RestoreClipEvents', [Reflection.BindingFlags]'Static,NonPublic')
    $legacyCreated = $sessionStart.ToUniversalTime()
    $legacyModified = $legacyCreated.AddDays(3)
    [IO.File]::SetCreationTimeUtc($reclip.FilePath, $legacyCreated)
    [IO.File]::SetLastWriteTimeUtc($reclip.FilePath, $legacyModified)
    foreach ($pass in 1..2) {
        $migration.Invoke($null,@())
        [void]$loader::LoadContentFromFolderIntoState($false, $false).GetAwaiter().GetResult()
        $restored = $state.Content | Where-Object Id -eq $reclip.Id
        Assert-Events $restored @('Kill@0.25','Manual@0.5','Goal@1.5')
        if (($restored.Bookmarks | Where-Object Type -eq 'Manual').Id -ne 123) { throw 'Lost custom bookmark identity' }
        if ([IO.File]::GetCreationTimeUtc($reclip.FilePath) -ne $legacyCreated -or
            [IO.File]::GetLastWriteTimeUtc($reclip.FilePath) -ne $legacyModified) { throw 'Legacy MP4 dates changed' }
    }
    Write-Output 'Clip bookmark projection passed for separate, combined, reclip, embedded MP4 and idempotent legacy recovery.'
    Write-Output 'Clip dates passed for default exports, separate and combined exports, midnight, a legacy replay and unknown capture time.'

    $highlightService = $assembly.GetType('Segra.Backend.Media.HighlightService', $true)
    $sourceBefore = ($state.Content | Where-Object Id -eq $sessionId).GetBookmarks() | ConvertTo-Json -Depth 8
    [void]$highlightService::CreateHighlightFromBookmarks($sessionId, $null).GetAwaiter().GetResult()
    $highlight = $state.Content | Where-Object Type -eq 'Highlight' | Select-Object -First 1
    $sourceAfter = ($state.Content | Where-Object Id -eq $sessionId).GetBookmarks() | ConvertTo-Json -Depth 8
    if (!$highlight -or $sourceAfter -ne $sourceBefore) { throw 'Creating a highlight changed source bookmarks or failed' }
    $range = $highlight.SourceExcerpts | Select-Object -First 1
    $embedded = $embeddedMetadata::ReadAsync($highlight.FilePath).GetAwaiter().GetResult()
    if ($range.SourceId -ne $sessionId -or $embedded.SourceExcerpts[0] -ne $range) { throw 'Lost highlight source range' }
    $fromHighlight = Invoke-Export @{ id = 5; contentId = $highlight.Id; startTime = $range.Offset + 0.25; endTime = $range.Offset + 0.75 }
    $link = ($state.Content | Where-Object Id -eq $sessionId).GetBookmarks() | Where-Object MediaId -eq $fromHighlight.Id
    if (@($link).Count -ne 1 -or $link.ClipStart.TotalSeconds -ne $range.Start + 0.25 -or $link.Time.TotalSeconds -ne $range.Start + 0.75) {
        throw 'Clip made from a highlight did not project its range to the source session'
    }
    Write-Output 'Highlight export, embedded source range and clipping a highlight passed without a highlight bookmark.'
} finally {
    [Environment]::CurrentDirectory = $originalDirectory
    $resolved = (Resolve-Path -LiteralPath $fixture).Path
    if ([IO.Path]::GetDirectoryName($resolved) -eq $tempParent -and [IO.Path]::GetFileName($resolved).StartsWith('segrabi-clip-time-')) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
