#Requires -Version 7.6
# Usage: pwsh -NoProfile -File .github/scripts/test-library-sync.ps1 <published Windows app DLL>
param([Parameter(Mandatory)][string]$AssemblyPath)

$ErrorActionPreference = 'Stop'
$assembly = [Reflection.Assembly]::LoadFrom((Resolve-Path -LiteralPath $AssemblyPath).Path)
$syncType = $assembly.GetType('Segra.Backend.Media.LibraryFolderSync', $true)
$settingsType = $assembly.GetType('Segra.Backend.Core.Models.Settings', $true)
$stateType = $assembly.GetType('Segra.Backend.Core.Models.AppState', $true)
$settings = $settingsType.GetProperty('Instance').GetValue($null)
$appState = $stateType.GetProperty('Instance').GetValue($null)
$ffmpeg = (Get-Command ffmpeg -CommandType Application | Select-Object -First 1).Source
$originalWorkingDirectory = [Environment]::CurrentDirectory
$tempParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
$fixture = [IO.Directory]::CreateTempSubdirectory('segrabi-sync-').FullName
$library = Join-Path $fixture 'library'
$cache = Join-Path $fixture 'cache'
$gameFolder = Join-Path $library 'Clips' 'Example Game'
$highlightFolder = Join-Path $library 'Highlights' 'Example Game'
$metadataFolder = Join-Path $cache 'metadata' 'Clips'
$sample = Join-Path $fixture 'sample.mp4'
$preexisting = Join-Path $gameFolder 'before startup.mp4'
$crashed = Join-Path $gameFolder 'unfinished OBS session.mp4'
$offlineRename = Join-Path $gameFolder 'renamed offline.mp4'
$original = Join-Path $gameFolder 'legacy.mp4'
$partial = Join-Path $gameFolder 'explorer.mp4'
$renamed = Join-Path $gameFolder 'renamed.mp4'
$moved = Join-Path $highlightFolder 'moved.mp4'
$id = [guid]::NewGuid().ToString('N')

function Get-Entries([string]$Path) {
    $appState.Content | Where-Object { $_.FilePath -eq $Path.Replace('\', '/') }
}

function Wait-For([string]$Description, [scriptblock]$Condition) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while (-not (& $Condition)) {
        if ($worker.IsCompleted) {
            $worker.GetAwaiter().GetResult()
            throw "The watcher stopped while waiting for $Description"
        }
        if ($timer.Elapsed.TotalSeconds -gt 35) {
            $paths = $appState.Content.FilePath -join ', '
            throw "Timed out waiting for $Description. Library contains [$paths]"
        }
        Start-Sleep -Milliseconds 100
    }
}

function Stop-Watcher {
    $cancel.Cancel()
    try {
        if ($null -ne $worker) { [void]$worker.WaitAsync([TimeSpan]::FromSeconds(10)).GetAwaiter().GetResult() }
    } catch [OperationCanceledException] {
        # Cancellation is the normal application shutdown path.
    } finally {
        $watcher.Dispose()
        $cancel.Dispose()
    }
}

try {
    foreach ($directory in $gameFolder, $highlightFolder, $metadataFolder) {
        [void][IO.Directory]::CreateDirectory($directory)
    }

    # Set the fixture roots before invoking services. The normal settings setter also saves to the user's profile.
    $settingsType.GetField('_contentFolder', 'Instance,NonPublic').SetValue($settings, $library.Replace('\', '/'))
    $settings.CacheFolder = $cache
    $settings._isBulkUpdating = $true

    & $ffmpeg -nostdin -hide_banner -loglevel error -f lavfi -i 'color=s=64x64:r=8' -t 1 -c:v mpeg4 $sample
    if ($LASTEXITCODE -ne 0) { throw 'Could not generate the MP4 fixture' }
    & $ffmpeg -nostdin -hide_banner -loglevel error -f lavfi -i 'color=c=red:s=64x64:r=8' -t 2 -c:v mpeg4 -movflags '+frag_keyframe+empty_moov' $preexisting
    if ($LASTEXITCODE -ne 0) { throw 'Could not generate the offline MP4 fixture' }
    # An unfinalized OBS hybrid still contains the reserved free box immediately after ftyp.
    $fragmented = [IO.File]::ReadAllBytes($preexisting)
    $ftypSize = [Net.IPAddress]::NetworkToHostOrder([BitConverter]::ToInt32($fragmented, 0))
    $freeBox = [Convert]::FromHexString('00000010667265650000000000000000')
    $unfinished = [IO.File]::Create($crashed)
    try {
        $unfinished.Write($fragmented, 0, $ftypSize)
        $unfinished.Write($freeBox, 0, $freeBox.Length)
        $unfinished.Write($fragmented, $ftypSize, $fragmented.Length - $ftypSize)
    } finally { $unfinished.Dispose() }
    [IO.File]::Copy($sample, $original)
    @{
        Id = $id; Type = 'Clip'; FilePath = $original; FileName = 'legacy'
        Game = 'Example Game'; Title = 'Keep my title'; FileSizeKb = 2
        Duration = '00:00:01'; Bookmarks = @(@{ Id = 4; Type = 'Manual'; Time = '00:00:00.250' })
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $metadataFolder "$id.json")

    # The Windows backend resolves its bundled ffmpeg.exe relative to its working directory.
    [Environment]::CurrentDirectory = [IO.Path]::GetDirectoryName($ffmpeg)
    $watcher = [Activator]::CreateInstance($syncType, $true)
    $cancel = [Threading.CancellationTokenSource]::new()
    try {
        $worker = $watcher.RunAsync($cancel.Token)
        Wait-For 'existing legacy metadata' { @(Get-Entries $original).Count -eq 1 }
        Wait-For 'discovery of a finished fragmented MP4 at startup' { @(Get-Entries $preexisting).Count -eq 1 }
        $preexistingId = (Get-Entries $preexisting).Id

        # Leave the incomplete file in place across more than one debounce window.
        $bytes = [IO.File]::ReadAllBytes($sample)
        $writer = [IO.File]::Open($partial, 'CreateNew', 'Write', 'Read')
        try {
            $writer.Write($bytes, 0, 32)
            $writer.Flush()
            Start-Sleep -Seconds 3
            if (@(Get-Entries $partial).Count) { throw 'An unfinished Explorer copy appeared in the library' }
            $writer.Write($bytes, 32, $bytes.Length - 32)
            $writer.Flush()
            Start-Sleep -Seconds 3
            if (@(Get-Entries $partial).Count) { throw 'The video was published while its writer still held it open' }
        } finally { $writer.Dispose() }

        Wait-For 'completed Explorer copy' { @(Get-Entries $partial).Count -eq 1 }
        $copy = Get-Entries $partial
        if ($copy.Id -eq $id -or $copy.Duration.TotalSeconds -le 0) {
            throw 'The completed copy must have its own identity and playable duration'
        }
        if ((Get-FileHash -LiteralPath $partial).Hash -ne (Get-FileHash -LiteralPath $sample).Hash) {
            throw 'Indexing modified the source MP4'
        }

        [IO.File]::Move($original, $renamed)
        Wait-For 'renamed video without a stale card' {
            @(Get-Entries $renamed).Count -eq 1 -and @(Get-Entries $original).Count -eq 0
        }
        [IO.File]::Move($renamed, $moved)
        Wait-For 'video moved between categories' {
            @(Get-Entries $moved).Count -eq 1 -and @(Get-Entries $renamed).Count -eq 0
        }
        $entry = Get-Entries $moved
        if ($entry.Id -ne $id -or $entry.Type -ne 'Highlight' -or $entry.Title -ne 'Keep my title' -or $entry.Bookmarks[0].Id -ne 4) {
            throw 'Moving the file lost its identity, category, title, or bookmark'
        }

        [IO.File]::Delete($partial)
        Wait-For 'deleted video to disappear' { @(Get-Entries $partial).Count -eq 0 }
        if (@(Get-Entries $crashed).Count) { throw 'The unfinished OBS hybrid appeared in the library' }
        if ($appState.Content.Count -ne 2) { throw 'Unexpected library entries after the live changes' }
    } finally { Stop-Watcher }

    [IO.File]::Move($preexisting, $offlineRename)
    $watcher = [Activator]::CreateInstance($syncType, $true)
    $cancel = [Threading.CancellationTokenSource]::new()
    try {
        $worker = $watcher.RunAsync($cancel.Token)
        Wait-For 'reconciliation after an offline rename' {
            @(Get-Entries $offlineRename).Count -eq 1 -and @(Get-Entries $preexisting).Count -eq 0
        }
        if ((Get-Entries $offlineRename).Id -ne $preexistingId) { throw 'The offline rename lost its identity' }

        [IO.File]::Copy($offlineRename, $moved, $true)
        Wait-For 'different video replacing an existing path' {
            $replacement = @(Get-Entries $moved)
            $replacement.Count -eq 1 -and $replacement[0].Id -ne $id
        }
        $replacement = Get-Entries $moved
        if ($replacement.Bookmarks.Count -ne 0 -or $replacement.Title -eq 'Keep my title' -or $replacement.Id -eq $preexistingId) {
            throw 'Replacing a video inherited unrelated annotations or the identity of another copy'
        }
    } finally { Stop-Watcher }
    Write-Output 'Library sync passed for startup, partial and locked copies, OBS recovery files, renames, moves, deletions, and replacements.'
} finally {
    [Environment]::CurrentDirectory = $originalWorkingDirectory
    $resolved = (Resolve-Path -LiteralPath $fixture).Path
    if ([IO.Path]::GetDirectoryName($resolved) -eq $tempParent -and [IO.Path]::GetFileName($resolved).StartsWith('segrabi-sync-')) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
