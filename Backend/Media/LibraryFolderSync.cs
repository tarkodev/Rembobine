using System.Collections.Concurrent;
using Segra.Backend.Core;
using Segra.Backend.Core.Models;
using Segra.Backend.Recorder;
using Segra.Backend.Shared;
using Serilog;

namespace Segra.Backend.Media;

internal sealed class LibraryFolderSync : IDisposable
{
    private static readonly StringComparer PathComparer = OperatingSystem.IsWindows()
        ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal;
    private static readonly Content.ContentType[] Types = Enum.GetValues<Content.ContentType>();
    private readonly record struct Stamp(long Length, DateTime Modified);
    private sealed record Observation(Stamp Stamp, DateTime CheckAfter, bool Indexed = false, int RetrySeconds = 2);
    // Exact spelling matters here: a case-only rename should reach the gallery on Windows too.
    private readonly Dictionary<string, Observation> observations = new(StringComparer.Ordinal);
    private readonly ConcurrentQueue<RenamedEventArgs> renames = new();
    private readonly ConcurrentDictionary<string, byte> changedNames = new(StringComparer.Ordinal);
    private FileSystemWatcher? watcher;
    private string? root, cache;
    private int videoChanged, screenshotsChanged, restartWatcher;

    public async Task RunAsync(CancellationToken token)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(750));
        DateTime nextAudit = DateTime.MinValue;
        DateTime nextScan = DateTime.MaxValue;
        try
        {
            do
            {
                try
                {
                    var now = DateTime.UtcNow;
                    var settings = Settings.Instance;
                    bool reset = root != settings.ContentFolder || cache != settings.CacheFolder;
                    bool audit = reset || now >= nextAudit;
                    if (reset || Interlocked.Exchange(ref restartWatcher, 0) != 0 || (audit && watcher == null))
                    {
                        Watch(settings.ContentFolder, settings.CacheFolder);
                        audit = true;
                    }
                    if (audit) nextAudit = now.AddMinutes(1);

                    if (Interlocked.Exchange(ref screenshotsChanged, 0) != 0)
                        ScreenshotService.RefreshLibrary();
                    if (Interlocked.Exchange(ref videoChanged, 0) != 0 || audit || now >= nextScan)
                        nextScan = Directory.Exists(root) ? await ScanAsync(now, token).ConfigureAwait(false) : DateTime.MaxValue;
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    Log.Warning(ex, "Could not synchronize the library at {Folder}", root);
                    nextAudit = DateTime.UtcNow.AddSeconds(10);
                    nextScan = DateTime.MaxValue;
                }
            } while (await timer.WaitForNextTickAsync(token).ConfigureAwait(false));
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { }
        finally { Dispose(); }
    }

    private void Watch(string contentRoot, string cacheRoot)
    {
        Dispose();
        observations.Clear();
        changedNames.Clear();
        renames.Clear();
        root = contentRoot;
        cache = cacheRoot;
        if (!Directory.Exists(root)) return;
        var next = new FileSystemWatcher(root)
        {
            IncludeSubdirectories = true,
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite
        };
        watcher = next;
        next.Created += OnChange;
        next.Deleted += OnChange;
        next.Changed += OnChange;
        next.Renamed += (_, e) =>
        {
            if (IsMp4(e.OldFullPath) && IsMp4(e.FullPath)) renames.Enqueue(e);
            MarkChanged(e.OldName, e.OldFullPath, true);
            MarkChanged(e.Name, e.FullPath, true);
        };
        next.Error += (_, _) => Interlocked.Exchange(ref restartWatcher, 1);
        try
        {
            next.EnableRaisingEvents = true;
            Log.Information("Watching library folders under {Root}", root);
        }
        catch { Dispose(); throw; }
    }

    private void OnChange(object sender, FileSystemEventArgs e) =>
        MarkChanged(e.Name, e.FullPath, e.ChangeType != WatcherChangeTypes.Changed);

    private void MarkChanged(string? name, string path, bool nameChanged)
    {
        if (string.IsNullOrEmpty(name)) return;
        string section = name.Split(Path.DirectorySeparatorChar, 2)[0];
        if (PathComparer.Equals(section, FolderNames.Screenshots))
        {
            // RefreshLibrary can update its own dot-prefixed JSON maps.
            if (nameChanged && !Path.GetFileName(path).StartsWith('.'))
                Interlocked.Exchange(ref screenshotsChanged, 1);
        }
        else if (Types.Any(t => PathComparer.Equals(section, FolderNames.GetVideoFolderName(t))))
        {
            if ((!IsMp4(path) && !nameChanged) || IsRecordingPath(path)) return;
            if (nameChanged && IsMp4(path)) changedNames.TryAdd(PathUtils.Normalize(path), 0);
            Interlocked.Exchange(ref videoChanged, 1);
        }
    }

    internal static bool IsRecordingPath(string path)
    {
        string normalized = PathUtils.Normalize(path);
        return PathComparer.Equals(normalized, AppState.Instance.Recording?.FilePath)
            || PathComparer.Equals(normalized, OBSService.FinishingSession?.FilePath)
            || MatchSplitService.IsPendingDeletion(normalized);
    }

    private static bool IsMp4(string path) =>
        Path.GetExtension(path).Equals(".mp4", StringComparison.OrdinalIgnoreCase);

    private async Task<DateTime> ScanAsync(DateTime now, CancellationToken token)
    {
        // Native imports, replay saves and exports publish their own metadata after writing the MP4.
        // Leave them the first opportunity to claim it, even when FFmpeg has already closed it.
        if (BackgroundWork.IsUpdatingLibrary || AppState.Instance.IsFinishingRecording) return now.AddSeconds(1);
        LibraryVideoIndex? catalog = null;
        LibraryVideoIndex Catalog() => catalog ??= LibraryVideoIndex.ReadCatalog();
        bool refresh = false;
        while (renames.TryDequeue(out var move))
        {
            var from = SectionType(move.OldFullPath);
            var to = SectionType(move.FullPath);
            if (from.HasValue && to.HasValue && File.Exists(move.FullPath) && !IsRecordingPath(move.FullPath))
                refresh |= await Catalog().MoveAsync(move.OldFullPath, move.FullPath, from.Value, to.Value);
        }
        foreach (string path in changedNames.Keys)
            if (changedNames.TryRemove(path, out _)) observations.Remove(path);

        var present = new HashSet<string>(StringComparer.Ordinal);
        var visible = AppState.Instance.Content.Select(c => c.FilePath).ToHashSet(StringComparer.Ordinal);
        DateTime nextScan = DateTime.MaxValue;
        void RecheckAt(DateTime time) { if (time < nextScan) nextScan = time; }
        var options = new EnumerationOptions { RecurseSubdirectories = true, AttributesToSkip = FileAttributes.ReparsePoint };
        foreach (var type in Types)
        {
            var folder = new DirectoryInfo(FolderNames.GetVideoFolderPath(root!, type));
            if (!folder.Exists || folder.LinkTarget != null) continue;
            foreach (var file in folder.EnumerateFiles("*", options))
            {
                token.ThrowIfCancellationRequested();
                if (root != Settings.Instance.ContentFolder || cache != Settings.Instance.CacheFolder) return now;
                if (!IsMp4(file.Name)) continue;
                var path = PathUtils.Normalize(file.FullName);
                if (!present.Add(path) || IsRecordingPath(path)) continue;
                var stamp = new Stamp(file.Length, file.LastWriteTimeUtc);
                if (!observations.TryGetValue(path, out var seen) || seen.Stamp != stamp)
                {
                    observations[path] = new(stamp, now.AddSeconds(1));
                    RecheckAt(now.AddSeconds(1));
                    continue;
                }
                if (seen.Indexed)
                {
                    if (!visible.Contains(path) && Catalog().HasPath(path)) refresh = true;
                    continue;
                }
                if (now < seen.CheckAfter)
                {
                    RecheckAt(seen.CheckAfter);
                    continue;
                }
                if (BackgroundWork.IsUpdatingLibrary)
                {
                    RecheckAt(now.AddSeconds(1));
                    continue;
                }
                if (Catalog().Contains(path))
                {
                    observations[path] = seen with { Indexed = true };
                    refresh |= !visible.Contains(path);
                    continue;
                }
                if (await Catalog().IndexAsync(path, type, token))
                {
                    observations[path] = seen with { Indexed = true };
                    refresh = true;
                }
                else
                {
                    // A writer may still hold the destination even after preallocating its final size.
                    DateTime retry = now.AddSeconds(seen.RetrySeconds);
                    observations[path] = seen with { CheckAfter = retry, RetrySeconds = Math.Min(300, seen.RetrySeconds * 2) };
                    RecheckAt(retry);
                }
            }
        }
        foreach (var missing in observations.Keys.Where(p => !present.Contains(p)).ToArray())
            observations.Remove(missing);
        if (catalog != null) await catalog.RememberFileIdentitiesAsync();
        if (refresh || visible.Any(p => !File.Exists(p)))
            await SettingsService.LoadContentFromFolderIntoState();
        return nextScan;
    }

    private Content.ContentType? SectionType(string path)
    {
        var relative = Path.GetRelativePath(root!, path);
        var section = relative.Split(Path.DirectorySeparatorChar, 2)[0];
        foreach (var type in Types)
            if (PathComparer.Equals(FolderNames.GetVideoFolderName(type), section)) return type;
        return null;
    }

    public void Dispose()
    {
        watcher?.Dispose();
        watcher = null;
    }
}
