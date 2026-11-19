using System.Buffers.Binary;
using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using ObsKit.NET;
using ObsKit.NET.Native.Types;
using ObsKit.NET.Video;
using Segra.Backend.App;
using Segra.Backend.Core;
using Segra.Backend.Core.Models;
using Segra.Backend.Platform;
using Segra.Backend.Games;
using Segra.Backend.Recorder;
using Segra.Backend.Shared;
using Segra.Backend.Windows.Storage;
using Serilog;

namespace Segra.Backend.Media
{
    internal sealed record Screenshot(string FileName, string FilePath, DateTime CreatedAt,
        string Title, string? Game, long FileSizeBytes, bool IsImported, string? MediaId)
    {
        public string FileSize => ContentService.FormatFileSize(FileSizeBytes);
    }

    internal static class ScreenshotService
    {
        internal const int MaxUploadBytes = 128 * 1024 * 1024;
        internal const int PngHeaderBytes = 24;
        private static readonly object _libraryLock = new();
        private static readonly SemaphoreSlim _importLock = new(1, 1);
        private static readonly char[] _invalidNameChars = Path.GetInvalidFileNameChars();
        private static readonly byte[] _pngHeader = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
        private static readonly Regex _captureName = new(
            @"^(?<game>.+) - (?<date>\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.\d{3}) - [0-9a-f]{8}$",
            RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);
        private const string CaptureDateFormat = "yyyy-MM-dd_HH-mm-ss";
        private const string CapturesFileName = ".captures.json";
        // The key is the current relative path. During a move, keep both paths and the title until the rename commits.
        private sealed record Capture(string MediaId, string? Game, string? PendingPath = null, string? PendingTitle = null);

        private static string DirectoryPath => Path.Combine(Settings.Instance.ContentFolder, FolderNames.Screenshots);
        private const string ImportedFolderName = "Imported";
        private const string TitlesFileName = ".titles.json";
        private const string GamesFileName = ".games.json";
        private static StringComparison PathComparison =>
            OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;

        internal sealed record OutputFrame(byte[] Pixels, uint Width, uint Height, bool IsHdr);

        internal static async Task<OutputFrame> CaptureOutputFrameAsync(uint width, uint height, bool isHdr)
        {
            var ready = new TaskCompletionSource<OutputFrame>(TaskCreationOptions.RunContinuationsAsynchronously);
            int frameClaimed = 0;
            using var subscription = Obs.SubscribeRawVideo(isHdr ? VideoFormat.P010 : VideoFormat.BGRA,
                width, height, CopyFrame, range: isHdr ? VideoRangeType.Default : VideoRangeType.Full);

            return await ready.Task.WaitAsync(TimeSpan.FromSeconds(2));

            void CopyFrame(in RawVideoFrame frame)
            {
                if (Interlocked.Exchange(ref frameClaimed, 1) != 0)
                    return;

                try
                {
                    int rowBytes = checked((int)frame.Width * (isHdr ? 2 : 4));
                    int rows = (int)frame.Height;
                    int chromaRows = isHdr ? rows / 2 : 0;
                    byte[] pixels = GC.AllocateUninitializedArray<byte>(checked(rowBytes * (rows + chromaRows)));
                    CopyPlane(in frame, 0, rows, rowBytes, pixels);
                    if (isHdr)
                        CopyPlane(in frame, 1, chromaRows, rowBytes, pixels.AsSpan(rowBytes * rows));

                    ready.TrySetResult(new OutputFrame(pixels, frame.Width, frame.Height, isHdr));
                }
                catch (Exception ex)
                {
                    ready.TrySetException(ex);
                }
            }
        }

        private static void CopyPlane(in RawVideoFrame frame, int plane, int rows, int rowBytes, Span<byte> destination)
        {
            int stride = (int)frame.GetLinesize(plane);
            var source = frame.GetPlane(plane, (uint)rows);
            if (source.IsEmpty || stride < rowBytes)
                throw new InvalidDataException("OBS returned an incomplete screenshot frame.");

            if (stride == rowBytes)
            {
                source.CopyTo(destination);
                return;
            }

            for (int y = 0; y < rows; y++)
                source.Slice(y * stride, rowBytes).CopyTo(destination.Slice(y * rowBytes, rowBytes));
        }

        internal static Task<string> SaveOutputFrameAsync(OutputFrame frame, string game) =>
            SaveAsync(game, path => EncodePngAsync(frame, path));

        internal static async Task SavePlayerFrameAsync(Stream png, long length, string? game, CancellationToken cancellationToken)
        {
            byte[] header = new byte[PngHeaderBytes];
            await png.ReadExactlyAsync(header, cancellationToken);
            uint width = BinaryPrimitives.ReadUInt32BigEndian(header.AsSpan(16));
            uint height = BinaryPrimitives.ReadUInt32BigEndian(header.AsSpan(20));
            if (!header.AsSpan(0, _pngHeader.Length).SequenceEqual(_pngHeader)
                || width == 0 || height == 0 || (ulong)width * height > 64_000_000)
            {
                throw new InvalidDataException("Invalid screenshot PNG.");
            }

            await SaveAsync(game, async path =>
            {
                await using var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, useAsync: true);
                await file.WriteAsync(header, cancellationToken);
                await png.CopyToAsync(file, cancellationToken);
                if (file.Length != length)
                    throw new EndOfStreamException("Screenshot upload was incomplete.");
            });
        }

        private static async Task<string> SaveAsync(string? game, Func<string, Task> writePng)
        {
            using var work = BackgroundWork.Begin();
            string directory = Path.GetFullPath(DirectoryPath);
            string id = Guid.NewGuid().ToString("N");
            string stem = DateTime.Now.ToString(CaptureDateFormat, CultureInfo.InvariantCulture);
            var capture = new Capture(id, string.IsNullOrWhiteSpace(game) ? null : game);

            await WriteImageAsync(directory, writePng, tempPath =>
            {
                var titles = ReadMap<string>(directory, TitlesFileName);
                var captures = ReadMap<Capture>(directory, CapturesFileName);
                RecoverMoves(directory, captures, titles);
                var file = new FileInfo(tempPath);
                MoveCapture(file, directory, stem, capture, captures, titles);
                Log.Information("Screenshot saved: {FileName}", file.Name);
            }, nativeCapture: true);
            _ = Task.Run(() => OBSService.PlaySound("screenshot"));
            RefreshAfterFileChange();
            return id;
        }

        private static string CaptureNamePrefix(string? game)
        {
            string prefix = new string((game ?? "").Take(60)
                .Select(c => _invalidNameChars.Contains(c) || char.IsControl(c) || c == '\\' ? '_' : c).ToArray()).Trim(' ', '.');
            return prefix.Length == 0 ? "Screenshot" : prefix;
        }

        private static string GetCaptureFolder(string root, string? game)
        {
            if (!Settings.Instance.GameSubfolders)
                return root;

            // Imported is reserved for pictures picked from disk, including copies of native captures.
            string folderName = StorageService.SanitizeGameNameForFolder(game?.Replace('\\', '_') ?? "Unknown");
            if (folderName.Length > 255 || (!OperatingSystem.IsWindows() && System.Text.Encoding.UTF8.GetByteCount(folderName) > 255))
                folderName = CaptureNamePrefix(folderName);
            if (string.Equals(folderName, ImportedFolderName, PathComparison))
                folderName += " (game)";
            return Path.Combine(root, folderName);
        }

        private static void PublishImage(FileInfo source, string destination)
        {
            string folder = Path.GetDirectoryName(destination)!;
            if (new DirectoryInfo(folder).LinkTarget != null)
                throw new IOException($"The screenshot folder is a link: {folder}");
            Directory.CreateDirectory(folder);
            source.MoveTo(destination);
        }

        private static async Task WriteImageAsync(string directory, Func<string, Task> writeFile, Action<string> publish,
            bool nativeCapture = false)
        {
            if (new DirectoryInfo(directory).LinkTarget != null)
                throw new IOException($"The screenshot folder is a link: {directory}");
            Directory.CreateDirectory(directory);
            string tempPath = Path.Combine(directory, $".{Guid.NewGuid():N}.tmp");
            try
            {
                await writeFile(tempPath);
                lock (_libraryLock)
                {
                    // Choose the final directory after encoding, in case Game Subfolders changed meanwhile.
                    publish(tempPath);
                }
            }
            catch
            {
                try
                {
                    lock (_libraryLock)
                    {
                        // Once registered, a completely encoded frame can be published after a restart.
                        if (!nativeCapture || !File.Exists(tempPath) ||
                            !ReadMap<Capture>(directory, CapturesFileName).ContainsKey(Path.GetFileName(tempPath)))
                            File.Delete(tempPath);
                    }
                }
                catch (Exception ex) { Log.Warning(ex, "Could not remove unfinished screenshot"); }
                throw;
            }
        }

        internal static async Task PickAndImportAsync(int importId)
        {
            if (!await _importLock.WaitAsync(0))
                return;

            try
            {
                var files = await PlatformServices.Dialogs.PickFilesAsync(
                    "Import Screenshots", "Images (PNG, JPEG, WebP)", "png", "jpg", "jpeg", "webp");
                if (files == null || files.Length == 0)
                    return;

                string folder = Path.Combine(DirectoryPath, ImportedFolderName);
                int imported = 0;
                for (int i = 0; i < files.Length; i++)
                {
                    string file = files[i];
                    await MessageService.SendFrontendMessage("ImportProgress", new
                    {
                        id = importId,
                        progress = 100d * i / files.Length,
                        fileName = Path.GetFileName(file),
                        totalFiles = files.Length,
                        currentFileIndex = i + 1,
                        status = "importing"
                    });
                    try
                    {
                        await ImportImageAsync(file, folder);
                        imported++;
                    }
                    catch (Exception ex)
                    {
                        Log.Warning(ex, "Could not import screenshot {FileName}", Path.GetFileName(file));
                    }
                }

                if (imported > 0)
                    RefreshAfterFileChange();

                await MessageService.SendFrontendMessage("ImportProgress", new
                {
                    id = importId,
                    progress = 100,
                    fileName = $"{imported} of {files.Length} screenshots",
                    totalFiles = files.Length,
                    currentFileIndex = files.Length,
                    status = imported > 0 ? "done" : "error"
                });

                if (imported < files.Length)
                {
                    await MessageService.ShowModal("Screenshot import",
                        $"Imported {imported} of {files.Length} images. Check that the remaining files are readable PNG, JPEG or WebP images.", "warning");
                }
            }
            finally
            {
                _importLock.Release();
            }
        }

        private static async Task ImportImageAsync(string sourcePath, string folder)
        {
            string ext = Path.GetExtension(sourcePath);
            string name = Path.GetFileNameWithoutExtension(sourcePath);
            string destination = Path.Combine(folder, Path.GetFileName(sourcePath));
            for (int i = 2; File.Exists(destination); i++)
                destination = Path.Combine(folder, $"{name} ({i}){ext}");

            await using var source = new FileStream(sourcePath, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, useAsync: true);
            byte[] header = new byte[16];
            await source.ReadExactlyAsync(header);
            bool valid = ImageType(sourcePath) switch
            {
                "image/png" => header.AsSpan().SequenceEqual(_pngHeader),
                "image/jpeg" => header[0] == 0xff && header[1] == 0xd8 && header[2] == 0xff,
                "image/webp" => header.AsSpan(0, 4).SequenceEqual("RIFF"u8) && header.AsSpan(8, 4).SequenceEqual("WEBP"u8),
                _ => false
            };
            if (!valid)
                throw new InvalidDataException("The file is not a supported image.");

            source.Position = 0;
            await WriteImageAsync(Path.GetDirectoryName(folder)!, async path =>
            {
                await using var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, useAsync: true);
                await source.CopyToAsync(file);
            }, tempPath => PublishImage(new FileInfo(tempPath), destination));
        }

        private static async Task EncodePngAsync(OutputFrame frame, string path)
        {
            var startInfo = new ProcessStartInfo(FFmpegService.GetFFmpegPath())
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardError = true
            };
            string[] inputArgs = ["-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pixel_format",
                frame.IsHdr ? "p010le" : "bgra", "-video_size", $"{frame.Width}x{frame.Height}"];
            foreach (string arg in inputArgs)
                startInfo.ArgumentList.Add(arg);

            if (frame.IsHdr)
            {
                string[] hdrInput = ["-colorspace", "bt2020nc", "-color_trc", "smpte2084",
                    "-color_primaries", "bt2020", "-color_range", "tv"];
                foreach (string arg in hdrInput)
                    startInfo.ArgumentList.Add(arg);
            }

            startInfo.ArgumentList.Add("-i");
            startInfo.ArgumentList.Add("pipe:0");
            if (frame.IsHdr)
            {
                startInfo.ArgumentList.Add("-vf");
                startInfo.ArgumentList.Add(FFmpegService.BuildHdrToSdrFilter());
            }

            string[] outputArgs = ["-frames:v", "1", "-c:v", "png", "-pix_fmt", "rgb24",
                "-f", "image2", "-update", "1", path];
            foreach (string arg in outputArgs)
                startInfo.ArgumentList.Add(arg);

            using var process = Process.Start(startInfo) ?? throw new IOException("Could not start FFmpeg.");
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            var error = process.StandardError.ReadToEndAsync();
            try
            {
                await process.StandardInput.BaseStream.WriteAsync(frame.Pixels, timeout.Token);
                process.StandardInput.Close();
                await process.WaitForExitAsync(timeout.Token);
            }
            finally
            {
                if (!process.HasExited)
                    process.Kill();
            }

            if (process.ExitCode != 0 || !File.Exists(path))
                throw new IOException($"Could not encode screenshot: {await error}");
        }

        internal static void RefreshLibrary(bool sendToFrontend = true)
        {
            lock (_libraryLock)
            {
                string directory = Path.GetFullPath(DirectoryPath);
                try
                {
                    var titles = TryReadMap<string>(directory, TitlesFileName);
                    var games = TryReadMap<string>(directory, GamesFileName);
                    var captures = TryReadMap<Capture>(directory, CapturesFileName);
                    if (captures != null && titles != null)
                        RecoverMoves(directory, captures, titles);
                    var legacyGames = new Dictionary<string, string>(StringComparer.Ordinal);

                    // For frames captured in the same second, migrate the earliest legacy name first.
                    var files = EnumerateImages(directory).OrderBy(file => file.Name, StringComparer.Ordinal)
                        .ThenBy(file => file.FullName, StringComparer.Ordinal).ToArray();
                    var screenshots = files.Select(file => ReadScreenshot(file, directory, titles, games, captures, legacyGames))
                        .OrderByDescending(screenshot => screenshot.CreatedAt)
                        .ThenBy(screenshot => screenshot.FileName, StringComparer.Ordinal)
                        .ToArray();
                    AppState.Instance.SetScreenshots(screenshots, sendToFrontend);
                }
                catch (Exception ex)
                {
                    Log.Warning(ex, "Could not read screenshots from {Directory}", directory);
                }
            }
        }

        private static IEnumerable<FileInfo> EnumerateImages(string directory)
        {
            var root = new DirectoryInfo(directory);
            if (!root.Exists || root.LinkTarget != null)
                yield break;

            var options = new EnumerationOptions { AttributesToSkip = FileAttributes.ReparsePoint };
            // Only the root and its direct children are part of the screenshot library.
            foreach (var folder in root.EnumerateDirectories("*", options).Prepend(root))
                foreach (var file in folder.EnumerateFiles("*", options))
                    if (ImageType(file.Name) != null)
                        yield return file;
        }

        private static bool NeedsGameLookup(string prefix) => prefix.Contains('_') || prefix.Length == 60;

        private static string ResolveLegacyGame(string prefix, Dictionary<string, string> cache)
        {
            if (!NeedsGameLookup(prefix))
                return prefix;
            if (cache.TryGetValue(prefix, out string? game))
                return game;

            var names = Settings.Instance.Games.Select(g => g.Name)
                .Concat(GameUtils.GetGameList().Select(g => g.Name));
            int separator = prefix.IndexOf('_');
            string start = separator < 0 ? prefix : prefix[..separator];
            var candidates = names.Where(n => n.StartsWith(start, StringComparison.Ordinal) && CaptureNamePrefix(n) == prefix)
                .Distinct().Take(2).ToArray();
            return cache[prefix] = candidates.Length == 1 ? candidates[0] : prefix;
        }

        private static string FileKey(string root, string path) => PathUtils.Normalize(Path.GetRelativePath(root, path));

        private static Screenshot ReadScreenshot(FileInfo file, string root, Dictionary<string, string>? titles,
            Dictionary<string, string>? games, Dictionary<string, Capture>? captures, Dictionary<string, string> legacyGames)
        {
            string? subfolder = string.Equals(file.DirectoryName, root, PathComparison) ? null : file.Directory!.Name;
            bool imported = string.Equals(subfolder, ImportedFolderName, PathComparison);
            string title = Path.GetFileNameWithoutExtension(file.Name);
            string? game = imported ? null : subfolder;
            string key = FileKey(root, file.FullName);
            Capture? capture = imported ? null : captures?.GetValueOrDefault(key);
            string? stem = null;
            if (!imported && ImageType(file.Name) == "image/png" && _captureName.Match(title) is { Success: true } legacy &&
                DateTime.TryParseExact(legacy.Groups["date"].Value, "yyyy-MM-dd HH-mm-ss.fff",
                    CultureInfo.InvariantCulture, DateTimeStyles.None, out var taken))
            {
                string prefix = legacy.Groups["game"].Value;
                game = games?.GetValueOrDefault(file.Name) ?? (prefix == "Screenshot" ? null : ResolveLegacyGame(prefix, legacyGames));
                capture ??= new Capture(file.Name, game);
                stem = taken.ToString(CaptureDateFormat, CultureInfo.InvariantCulture);
            }
            else if (capture != null && !string.Equals(file.DirectoryName, GetCaptureFolder(root, capture.Game), PathComparison))
            {
                stem = ReplayStem(file.Name);
            }

            if (capture != null)
            {
                game = capture.Game;
                title = game ?? "Screenshot";
                if (stem != null && captures != null && titles != null && games != null)
                {
                    try { MoveCapture(file, root, stem, capture, captures, titles); }
                    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                    {
                        Log.Warning(ex, "Could not organize screenshot {FileName}", file.Name);
                    }
                }
            }

            key = FileKey(root, file.FullName);
            if (titles != null && titles.TryGetValue(key, out string? savedTitle) && !string.IsNullOrWhiteSpace(savedTitle))
                title = savedTitle;

            return new Screenshot(file.Name, file.FullName, file.LastWriteTimeUtc,
                title, game, file.Length, imported, capture?.MediaId);
        }

        private static string? ReplayStem(string name)
        {
            if (ImageType(name) != "image/png" || name.Length < 23 ||
                !DateTime.TryParseExact(name[..19], CaptureDateFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
                return null;
            string suffix = name[19..^4];
            return suffix.Length == 0 || Regex.IsMatch(suffix, @"^ \([1-9][0-9]*\)$") ? name[..19] : null;
        }

        private static void MoveCapture(FileInfo file, string root, string stem, Capture capture,
            Dictionary<string, Capture> captures, Dictionary<string, string> titles)
        {
            string folder = GetCaptureFolder(root, capture.Game);
            if (new DirectoryInfo(folder).LinkTarget != null)
                throw new IOException($"The screenshot folder is a link: {folder}");
            string destination = Path.Combine(folder, stem + ".png");
            string target = FileKey(root, destination);
            for (int i = 2; Path.Exists(destination) || new FileInfo(destination).LinkTarget != null ||
                captures.GetValueOrDefault(target)?.PendingPath != null; i++)
            {
                destination = Path.Combine(folder, FormattableString.Invariant($"{stem} ({i}).png"));
                target = FileKey(root, destination);
            }

            string source = FileKey(root, file.FullName);
            var pending = capture with { PendingPath = target, PendingTitle = titles.GetValueOrDefault(source) };
            // An externally removed capture may once have occupied this free filename.
            captures.Remove(target);
            captures[source] = pending;
            WriteMap(root, CapturesFileName, captures);

            string oldFolder = file.DirectoryName!;
            PublishImage(file, destination);
            FinishMove(root, source, pending, captures, titles);
            RemoveEmptyGameFolder(oldFolder, root);
        }

        private static void FinishMove(string root, string source, Capture pending,
            Dictionary<string, Capture> captures, Dictionary<string, string> titles)
        {
            string target = pending.PendingPath!;
            bool titlesChanged = titles.Remove(source, out string? sourceTitle);
            string? title = pending.PendingTitle ?? sourceTitle;
            if (title != null)
            {
                titles[target] = title;
                titlesChanged = true;
            }
            else
                titlesChanged |= titles.Remove(target);
            if (titlesChanged)
                WriteMap(root, TitlesFileName, titles);

            captures.Remove(source);
            captures[target] = pending with { PendingPath = null, PendingTitle = null };
            WriteMap(root, CapturesFileName, captures);
        }

        private static void RecoverMoves(string root, Dictionary<string, Capture> captures, Dictionary<string, string> titles)
        {
            foreach (var (source, pending) in captures.Where(pair => pair.Value.PendingPath != null).ToArray())
            {
                try { RecoverMove(root, source, pending, captures, titles); }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    Log.Warning(ex, "Could not resume screenshot {Source}", source);
                }
            }
        }

        private static void RecoverMove(string root, string source, Capture pending,
            Dictionary<string, Capture> captures, Dictionary<string, string> titles)
        {
            var file = new FileInfo(Path.Combine(root, source));
            var target = new FileInfo(Path.Combine(root, pending.PendingPath!));
            string? stem = ReplayStem(target.Name);
            bool staging = string.Equals(file.DirectoryName, root, PathComparison) && file.Name.Length == 37 &&
                file.Name.StartsWith('.') && file.Name.EndsWith(".tmp", StringComparison.Ordinal) &&
                Guid.TryParseExact(file.Name.Substring(1, 32), "N", out _);
            if (stem == null || file.LinkTarget != null ||
                (!staging && GetScreenshotContentType(file.FullName, root) != "image/png") ||
                GetScreenshotContentType(target.FullName, root) != "image/png" ||
                string.Equals(file.Directory!.Name, ImportedFolderName, PathComparison) ||
                string.Equals(target.Directory!.Name, ImportedFolderName, PathComparison))
                return;

            bool sourceExists = FileExistsForRecovery(file.FullName);
            if (!sourceExists && FileExistsForRecovery(target.FullName) &&
                (!captures.TryGetValue(pending.PendingPath!, out var owner) || owner.MediaId == pending.MediaId))
            {
                FinishMove(root, source, pending, captures, titles);
                if (file.Directory!.Exists)
                    RemoveEmptyGameFolder(file.DirectoryName!, root);
            }
            else if (sourceExists && staging)
                MoveCapture(file, root, stem, pending, captures, titles);
            else
            {
                // The original is still in place, or was removed externally. Never adopt an occupied target.
                if (sourceExists)
                    captures[source] = pending with { PendingPath = null, PendingTitle = null };
                else
                    captures.Remove(source);
                WriteMap(root, CapturesFileName, captures);
            }
        }

        // File.Exists also returns false for an inaccessible file. Leave those moves pending until we can inspect them.
        private static bool FileExistsForRecovery(string path)
        {
            try { return (File.GetAttributes(path) & FileAttributes.Directory) == 0; }
            catch (FileNotFoundException) { return false; }
            catch (DirectoryNotFoundException) { return false; }
        }

        private static void RemoveEmptyGameFolder(string folder, string root)
        {
            if (!string.Equals(folder, root, PathComparison) && !Directory.EnumerateFileSystemEntries(folder).Any())
                Directory.Delete(folder);
        }

        private static string? ImageType(string path) =>
            Path.GetExtension(path).ToLowerInvariant() switch
            {
                ".png" => "image/png",
                ".jpg" or ".jpeg" => "image/jpeg",
                ".webp" => "image/webp",
                _ => null
            };

        internal static string? GetScreenshotContentType(string path)
        {
            string root = Path.GetFullPath(DirectoryPath);
            return GetScreenshotContentType(path, root);
        }

        private static string? GetScreenshotContentType(string path, string root)
        {
            var file = new FileInfo(path);
            var folder = file.Directory;
            if (folder == null || file.LinkTarget != null || new DirectoryInfo(root).LinkTarget != null)
                return null;

            bool inRoot = string.Equals(folder.FullName, root, PathComparison);
            bool inChild = string.Equals(folder.Parent?.FullName, root, PathComparison) && folder.LinkTarget == null;
            return inRoot || inChild ? ImageType(path) : null;
        }

        internal static void Rename(string path, string title)
        {
            title = title.Trim();
            if (title.Length == 0)
                throw new ArgumentException("The screenshot title cannot be empty.", nameof(title));

            lock (_libraryLock)
            {
                string directory = Path.GetFullPath(DirectoryPath);
                if (!Path.IsPathFullyQualified(path) || GetScreenshotContentType(path, directory) == null || !File.Exists(path))
                    throw new FileNotFoundException("The screenshot is no longer in the library.", path);

                var titles = ReadMap<string>(directory, TitlesFileName);
                RecoverMoves(directory, ReadMap<Capture>(directory, CapturesFileName), titles);
                titles[FileKey(directory, path)] = title;
                WriteMap(directory, TitlesFileName, titles);
                RefreshLibrary();
            }
        }

        internal static async Task DeleteAsync(string path)
        {
            bool captured;
            lock (_libraryLock)
            {
                string directory = Path.GetFullPath(DirectoryPath);
                if (!Path.IsPathFullyQualified(path) || GetScreenshotContentType(path, directory) == null)
                    throw new InvalidDataException("Not a library screenshot");

                var titles = ReadMap<string>(directory, TitlesFileName);
                var captures = ReadMap<Capture>(directory, CapturesFileName);
                RecoverMoves(directory, captures, titles);
                // A stale UI path may have been reorganized while the viewer was open.
                if (!File.Exists(path))
                    throw new FileNotFoundException("The screenshot is no longer at this location.", path);
                string folder = Path.GetDirectoryName(Path.GetFullPath(path))!;
                string key = FileKey(directory, path);
                string name = Path.GetFileName(path);
                bool imported = string.Equals(folder, Path.Combine(directory, ImportedFolderName), PathComparison);
                string? mediaId = imported ? null : captures.GetValueOrDefault(key)?.MediaId;
                if (mediaId == null && !imported && ImageType(name) == "image/png" && _captureName.IsMatch(Path.GetFileNameWithoutExtension(name)))
                    mediaId = name;
                File.Delete(path);
                captured = mediaId != null;
                bool wasIndexed = captures.Remove(key);
                bool lastCapture = captured && !EnumerateImages(directory).Any(other =>
                    !string.Equals(other.DirectoryName, Path.Combine(directory, ImportedFolderName), PathComparison) &&
                    string.Equals(captures.GetValueOrDefault(FileKey(directory, other.FullName))?.MediaId ?? other.Name,
                        mediaId, PathComparison));
                if (lastCapture)
                    ContentService.RemoveBookmarksForDeletedMedia(BookmarkType.ScreenshotSaved, mediaId!);
                try
                {
                    if (wasIndexed)
                        WriteMap(directory, CapturesFileName, captures);
                    if (titles.Remove(key))
                        WriteMap(directory, TitlesFileName, titles);
                    if (lastCapture)
                    {
                        var games = ReadMap<string>(directory, GamesFileName);
                        if (games.Remove(mediaId!))
                            WriteMap(directory, GamesFileName, games);
                    }
                    if (captured)
                        RemoveEmptyGameFolder(folder, directory);
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
                {
                    Log.Warning(ex, "Could not clean up the deleted screenshot's metadata or folder");
                }
            }

            if (captured)
                await SettingsService.LoadContentFromFolderIntoState();
            else
                RefreshAfterFileChange();
        }

        private static Dictionary<string, T>? TryReadMap<T>(string directory, string fileName)
        {
            try { return ReadMap<T>(directory, fileName); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
            {
                Log.Warning(ex, "Could not read screenshot metadata {File}", fileName);
                return null;
            }
        }

        private static Dictionary<string, T> ReadMap<T>(string directory, string fileName)
        {
            if (new DirectoryInfo(directory).LinkTarget != null)
                throw new IOException($"The screenshot folder is a link: {directory}");
            string path = Path.Combine(directory, fileName);
            var result = new Dictionary<string, T>(StringComparer.FromComparison(PathComparison));
            string json;
            try { json = File.ReadAllText(path); }
            catch (FileNotFoundException) { return result; }
            catch (DirectoryNotFoundException) { return result; }

            var saved = JsonSerializer.Deserialize<Dictionary<string, T>>(json)
                ?? throw new JsonException($"Empty screenshot metadata: {fileName}");
            foreach (var (name, value) in saved)
                result[name] = value ?? throw new JsonException($"Missing screenshot metadata: {name}");
            return result;
        }

        private static void WriteMap<T>(string directory, string fileName, Dictionary<string, T> values)
        {
            string tempPath = Path.Combine(directory, $".{Guid.NewGuid():N}.tmp");
            try
            {
                File.WriteAllText(tempPath, JsonSerializer.Serialize(values));
                File.Move(tempPath, Path.Combine(directory, fileName), overwrite: true);
            }
            finally
            {
                File.Delete(tempPath);
            }
        }

        private static void RefreshAfterFileChange()
        {
            RefreshLibrary();
            try
            {
                StorageService.UpdateFolderSizeInState();
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "Could not refresh storage usage after screenshot change");
            }
        }
    }
}
