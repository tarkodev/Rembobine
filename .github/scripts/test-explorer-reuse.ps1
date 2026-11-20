#Requires -Version 7.6
# Run in an interactive Windows session with the path to a published Rembobine.dll.
param([Parameter(Mandatory)][string]$AssemblyPath)

$ErrorActionPreference = 'Stop'
$assembly = [Reflection.Assembly]::LoadFrom((Resolve-Path -LiteralPath $AssemblyPath).Path)
$type = $assembly.GetType('Segra.Backend.Platform.Windows.WindowsNativeDialogs', $true)
$dialogs = [Activator]::CreateInstance($type)
$shell = New-Object -ComObject Shell.Application
$folder = [IO.Directory]::CreateTempSubdirectory('Rembobine Explorer ').FullName
$first = Join-Path $folder 'first clip.mp4'
$second = Join-Path $folder 'deuxième, clip.mp4'

function Get-TestViews {
    $shell.Windows() | Where-Object { $_.Document.Folder.Self.Path -eq $folder }
}

function Assert-SingleView([long]$expectedHandle = 0, [string]$selectedFile) {
    $deadline = [datetime]::UtcNow.AddSeconds(8)
    do {
        $views = @(Get-TestViews)
        if ($views.Count -gt 1) { throw "Found $($views.Count) Explorer views for the same folder" }
        if ($views.Count -eq 1) {
            if ($expectedHandle -and $expectedHandle -ne $views[0].HWND) { throw 'Explorer replaced the original window' }
            $selection = @($views[0].Document.SelectedItems() | ForEach-Object Path)
            if (!$selectedFile -or ($selection.Count -eq 1 -and $selection[0] -eq $selectedFile)) { return $views[0].HWND }
        }
        Start-Sleep -Milliseconds 100
    } while ([datetime]::UtcNow -lt $deadline)
    throw "Timed out waiting for the Explorer view and selection '$selectedFile'"
}

try {
    [IO.File]::WriteAllText($first, '')
    [IO.File]::WriteAllText($second, '')
    $requests = 1..4 | ForEach-Object { $dialogs.OpenFileLocationAsync($first.Replace('\', '/')) }
    [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]$requests)
    $handle = Assert-SingleView -selectedFile $first
    $dialogs.OpenFileLocationAsync($second).GetAwaiter().GetResult() | Out-Null
    $null = Assert-SingleView $handle $second
    $requests = 1..4 | ForEach-Object { $dialogs.OpenFolderAsync($folder) }
    [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]$requests)
    $dialogs.OpenFileLocationAsync((Join-Path $folder 'removed.mp4')).GetAwaiter().GetResult() | Out-Null
    Start-Sleep -Milliseconds 500
    $null = Assert-SingleView $handle

    (Get-TestViews).Quit()
    $deadline = [datetime]::UtcNow.AddSeconds(8)
    while (@(Get-TestViews).Count -gt 0) {
        if ([datetime]::UtcNow -ge $deadline) { throw 'The test window did not close' }
        Start-Sleep -Milliseconds 100
    }
    $requests = 1..4 | ForEach-Object { $dialogs.OpenFolderAsync($folder) }
    [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]$requests)
    $handle = Assert-SingleView
    $dialogs.OpenFileLocationAsync($first).GetAwaiter().GetResult() | Out-Null
    Start-Sleep -Milliseconds 500
    $null = Assert-SingleView $handle $first
    'PASS: repeated folder and file actions reuse one Explorer window and select the requested file.'
} finally {
    @(Get-TestViews) | ForEach-Object { if ($_.Document.Folder.Self.Path -eq $folder) { $_.Quit() } }
    [IO.File]::Delete($first)
    [IO.File]::Delete($second)
    [IO.Directory]::Delete($folder)
}
