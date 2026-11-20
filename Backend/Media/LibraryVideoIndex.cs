using System.Text.Json;
using Segra.Backend.Core.Models;
using Segra.Backend.Games;
using Segra.Backend.Shared;
using Segra.Backend.Windows.Storage;
using Serilog;

namespace Segra.Backend.Media;

// One catalog per reconciliation batch. Missing files keep their sidecars so a temporarily
// disconnected library or an offline rename can recover the original ids and annotations.
internal sealed class LibraryVideoIndex
{
    private static readonly StringComparer Paths = OperatingSystem.IsWindows()
        ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal;
    private static readonly SemaphoreSlim WaveformSlot = new(1, 1);
    private readonly Dictionary<string, Content> _paths = new(Paths);
    private readonly List<Content> _entries = [];
    private readonly string _cacheFolder = Settings.Instance.CacheFolder;
    private readonly string _contentFolder = Settings.Instance.ContentFolder;
    private bool HasCurrentRoots => Paths.Equals(_cacheFolder, Settings.Instance.CacheFolder)
        && Paths.Equals(_contentFolder, Settings.Instance.ContentFolder);
    private long _creationVersion;

    public static LibraryVideoIndex ReadCatalog()
    {
        var index = new LibraryVideoIndex();
        index.Load();
        return index;
    }

    private void Load()
    {
        _creationVersion = ContentService.MetadataCreationVersion;
        _paths.Clear();
        _entries.Clear();
        foreach (var type in Enum.GetValues<Content.ContentType>())
        {
            string directory = FolderNames.GetMetadataFolderPath(type);
            if (!Directory.Exists(directory)) continue;
            foreach (string file in Directory.EnumerateFiles(directory, "*.json"))
            {
                if (Path.GetFileName(file).StartsWith('.')) continue;
                try
                {
                    var item = JsonSerializer.Deserialize<Content>(File.ReadAllText(file));
                    if (item == null || item.Type != type || string.IsNullOrEmpty(item.Id) ||
                        item.Id != Path.GetFileNameWithoutExtension(file)) continue;
                    Remember(item);
                }
                catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
                {
                    Log.Debug(ex, "Could not index sidecar {File}", file);
                }
            }
        }
    }

    private void Remember(Content item)
    {
        _entries.Add(item);
        if (!string.IsNullOrEmpty(item.FilePath))
            _paths[item.FilePath] = item;
    }

    private void ReloadIfContentCreated()
    {
        if (_creationVersion != ContentService.MetadataCreationVersion)
            Load();
    }

    public bool HasPath(string path)
    {
        path = PathUtils.Normalize(path);
        return _paths.TryGetValue(path, out var item) && item.FilePath == path;
    }

    public bool Contains(string path)
    {
        path = PathUtils.Normalize(path);
        if (!_paths.TryGetValue(path, out var item) || item.FilePath != path) return false;
        string? identity = ReadIdentity(path);
        return identity != null && (item.LibraryFileIdentity == null || item.LibraryFileIdentity == identity);
    }

    internal static string? ReadIdentity(string path)
    {
        try
        {
            using var file = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            return EmbeddedMetadataService.ReadLibraryFileIdentity(file);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    public async Task RememberFileIdentitiesAsync()
    {
        foreach (var item in _entries.Where(c => c.LibraryFileIdentity == null && File.Exists(c.FilePath)))
        {
            if (!HasCurrentRoots) return;
            string? identity = ReadIdentity(item.FilePath);
            if (identity == null) continue;
            var updated = await ContentService.UpdateMetadataFile(MetadataPath(item), current =>
            {
                if (Paths.Equals(current.FilePath, item.FilePath))
                    current.LibraryFileIdentity ??= identity;
            });
            item.LibraryFileIdentity = updated?.LibraryFileIdentity;
        }
    }

    public async Task<bool> MoveAsync(string oldPath, string newPath, Content.ContentType oldType, Content.ContentType newType)
    {
        oldPath = PathUtils.Normalize(oldPath);
        newPath = PathUtils.Normalize(newPath);
        Content? moved;
        await ContentService.MetadataWriteLock.WaitAsync();
        try
        {
            if (!HasCurrentRoots) return false;
            ReloadIfContentCreated();
            if (!_paths.TryGetValue(oldPath, out var item) || item.Type != oldType ||
                (File.Exists(oldPath) && !Paths.Equals(oldPath, newPath))) return false;
            string? identity = ReadIdentity(newPath);
            if (identity == null || (item.LibraryFileIdentity != null && item.LibraryFileIdentity != identity))
                return false;
            moved = await RelocateAsync(item, newPath, newType, identity);
        }
        finally
        {
            ContentService.MetadataWriteLock.Release();
        }
        return await EnsureAssetsAsync(moved);
    }

    public async Task<bool> IndexAsync(string path, Content.ContentType type, CancellationToken cancellationToken = default)
    {
        path = PathUtils.Normalize(path);
        cancellationToken.ThrowIfCancellationRequested();
        Content? added;
        try
        {
            // Deny writers while probing and publishing. On platforms without mandatory sharing,
            // verify the length and write timestamp again before committing.
            using var file = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            var length = file.Length;
            var modified = File.GetLastWriteTimeUtc(path);
            string? identity = EmbeddedMetadataService.ReadLibraryFileIdentity(file);
            if (identity == null || EmbeddedMetadataService.IsUnfinishedFragmented(path)) return false;

            Content? match;
            await ContentService.MetadataWriteLock.WaitAsync(cancellationToken);
            try
            {
                if (!HasCurrentRoots) return false;
                ReloadIfContentCreated();
                if (_paths.TryGetValue(path, out var existing) &&
                    (existing.LibraryFileIdentity == null || existing.LibraryFileIdentity == identity))
                {
                    if (existing.FilePath == path && existing.Type == type) return false;
                    match = existing;
                }
                else
                {
                    // An identical copy in a second folder is a separate video while its original exists.
                    var missing = _entries.Where(c => c.LibraryFileIdentity == identity && !File.Exists(c.FilePath))
                        .DistinctBy(c => c.Id).Take(2).ToList();
                    match = missing.Count == 1 ? missing[0] : null;
                }
                added = match == null ? null : await RelocateAsync(match, path, type, identity);
            }
            finally
            {
                ContentService.MetadataWriteLock.Release();
            }

            if (match != null)
                return await EnsureAssetsAsync(added);

            added = await ReadVideoAsync(path, type, length, identity);
            if (added == null || file.Length != length || File.GetLastWriteTimeUtc(path) != modified)
                return false;

            await ContentService.MetadataWriteLock.WaitAsync(cancellationToken);
            try
            {
                if (!HasCurrentRoots) return false;
                ReloadIfContentCreated();
                if (_paths.TryGetValue(path, out var previous))
                {
                    if (previous.LibraryFileIdentity == null || previous.LibraryFileIdentity == identity)
                        return false;
                    await DetachAsync(previous);
                }
                await ContentService.WriteMetadataAtomically(MetadataPath(added), added);
                Remember(added);
                _creationVersion = ContentService.NotifyCatalogChanged();
            }
            finally
            {
                ContentService.MetadataWriteLock.Release();
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            Log.Debug(ex, "Could not index library video {Path}", path);
            return false;
        }

        return await EnsureAssetsAsync(added);
    }

    private async Task<bool> EnsureAssetsAsync(Content? item)
    {
        if (item == null || !HasCurrentRoots) return false;
        if (!File.Exists(FolderNames.GetThumbnailFilePath(item.Type, item.Id)))
            await ContentService.CreateThumbnail(item.FilePath, item.Type, item.Id);
        if (!File.Exists(FolderNames.GetWaveformFilePath(item.Type, item.Id)))
            _ = GenerateWaveformAsync(item);
        return true;
    }

    private async Task GenerateWaveformAsync(Content item)
    {
        await WaveformSlot.WaitAsync();
        try
        {
            if (HasCurrentRoots && File.Exists(MetadataPath(item)) && !File.Exists(FolderNames.GetWaveformFilePath(item.Type, item.Id)))
                await ContentService.CreateWaveformFile(item.FilePath, item.Type, item.Id);
        }
        finally
        {
            WaveformSlot.Release();
        }
    }

    private static async Task<Content?> ReadVideoAsync(string path, Content.ContentType type, long length, string identity)
    {
        string probe = await FFmpegService.GetMetadata(path, timeoutSeconds: 10);
        TimeSpan duration = FFmpegService.ExtractDuration(probe);
        if (duration <= TimeSpan.Zero || !probe.Split('\n').Any(line =>
                line.TrimStart().StartsWith("Stream #", StringComparison.Ordinal) && line.Contains("Video: ")))
            return null;
        var embedded = await EmbeddedMetadataService.ReadAsync(path);
        string? canonicalGame = embedded?.IgdbId is int id
            ? GameUtils.GetIgdbIdToNameMap().GetValueOrDefault(id) : null;
        var names = embedded?.AudioTrackNames;
        if (names == null)
        {
            var raw = await Mp4BoxReader.ReadAudioTrackNamesAsync(path);
            var fallback = FFmpegService.ExtractAudioTrackNames(probe);
            names = (raw ?? fallback)?.Select((name, i) =>
                !string.IsNullOrWhiteSpace(name) ? name : fallback?.ElementAtOrDefault(i) ?? $"Track {i + 1}").ToList();
        }

        string? parent = Path.GetDirectoryName(path);
        string? folder = Paths.Equals(PathUtils.Normalize(parent!), FolderNames.GetVideoFolderPath(Settings.Instance.ContentFolder, type))
            ? null : Path.GetFileName(parent);
        string? knownGame = folder == null ? null : AppState.Instance.Content.Select(c => c.Game)
            .Concat(Settings.Instance.Games.Select(g => g.Name))
            .FirstOrDefault(game => !string.IsNullOrEmpty(game) && Paths.Equals(StorageService.SanitizeGameNameForFolder(game), folder));
        string fileName = Path.GetFileNameWithoutExtension(path);
        return new Content
        {
            Id = ContentService.NewContentId(),
            Type = type,
            FilePath = path,
            FileName = fileName,
            Title = embedded?.Title ?? fileName,
            Game = canonicalGame ?? embedded?.Game ?? knownGame ?? folder ?? "Unknown",
            FileSize = ContentService.FormatFileSize(length),
            FileSizeKb = length / 1024,
            Duration = duration,
            CreatedAt = embedded?.CreatedAt ?? File.GetCreationTime(path),
            RecordingStartedAt = embedded?.RecordingStartedAt,
            ExportedAt = embedded?.ExportedAt,
            SourceExcerpts = embedded?.SourceExcerpts,
            LibraryFileIdentity = identity,
            IgdbId = embedded?.IgdbId,
            GameExePath = embedded?.GameExePath,
            Bookmarks = embedded?.Bookmarks?.Where(b => !ContentService.IsDeletedMediaBookmark(b)).ToList() ?? [],
            Matches = embedded?.Matches,
            AudioTrackNames = names,
            AudioTrackTypes = embedded?.AudioTrackTypes,
            Compressed = embedded?.Compressed ?? false,
            IsImported = true
        };
    }

    private static string MetadataPath(Content item) => FolderNames.GetMetadataFilePath(item.Type, item.Id);

    // Called with the metadata lock held. Reread before changing paths so a title or bookmark
    // edited since this batch started is preserved. A replaced video's fingerprint stays available.
    private async Task DetachAsync(Content item)
    {
        string sidecar = MetadataPath(item);
        if (File.Exists(sidecar))
        {
            var current = JsonSerializer.Deserialize<Content>(await File.ReadAllTextAsync(sidecar));
            if (current != null && Paths.Equals(current.FilePath, item.FilePath))
            {
                current.FilePath = string.Empty;
                await ContentService.WriteMetadataAtomically(sidecar, current);
                _creationVersion = ContentService.NotifyCatalogChanged();
            }
        }
        _paths.Remove(item.FilePath);
        item.FilePath = string.Empty;
    }

    private async Task<Content?> RelocateAsync(Content item, string path, Content.ContentType type, string identity)
    {
        string source = MetadataPath(item);
        if (!File.Exists(source)) return null;
        var current = JsonSerializer.Deserialize<Content>(await File.ReadAllTextAsync(source));
        if (current == null || !HasCurrentRoots || !Paths.Equals(current.FilePath, item.FilePath)) return null;
        if (_paths.TryGetValue(path, out var occupant) && occupant != item)
        {
            if (occupant.LibraryFileIdentity == null || occupant.LibraryFileIdentity == identity) return null;
            await DetachAsync(occupant);
        }
        string destination = FolderNames.GetMetadataFilePath(type, item.Id);
        if (item.Type != type)
        {
            if (File.Exists(destination)) return null;
            MoveAsset(FolderNames.GetThumbnailFilePath(item.Type, item.Id), FolderNames.GetThumbnailFilePath(type, item.Id));
            MoveAsset(FolderNames.GetWaveformFilePath(item.Type, item.Id), FolderNames.GetWaveformFilePath(type, item.Id));
        }
        current.RecordingStartedAt ??= current.GetRecordingStartTime();
        current.Type = type;
        current.FilePath = path;
        current.FileName = Path.GetFileNameWithoutExtension(path);
        current.LibraryFileIdentity = identity;
        await ContentService.WriteMetadataAtomically(destination, current);
        if (item.Type != type) File.Delete(source);
        _paths.Remove(item.FilePath);
        _entries.Remove(item);
        Remember(current);
        _creationVersion = ContentService.NotifyCatalogChanged();
        return current;
    }

    private static void MoveAsset(string oldPath, string newPath)
    {
        if (!File.Exists(oldPath)) return;
        Directory.CreateDirectory(Path.GetDirectoryName(newPath)!);
        File.Move(oldPath, newPath, true);
    }
}
