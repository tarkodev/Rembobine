using System.Buffers.Binary;
using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;
using ObsKit.NET;
using ObsKit.NET.Native.Types;
using ObsKit.NET.Video;
using Segra.Backend.App;
using Segra.Backend.Core;
using Segra.Backend.Core.Models;
using Segra.Backend.Platform;
using Segra.Backend.Recorder;
using Segra.Backend.Shared;
using Segra.Backend.Windows.Storage;
using Serilog;

namespace Segra.Backend.Media
{
    internal sealed record Screenshot(string FileName, string FilePath, DateTime CreatedAt,
        string Title, string? Game, long FileSizeBytes, bool IsImported)
    {
        public string FileSize => ContentService.FormatFileSize(FileSizeBytes);
    }

    internal static class ScreenshotService
    {
        internal const int MaxUploadBytes = 128 * 1024 * 1024;
        internal const int PngHeaderBytes = 24;
        private static readonly object _libraryLock = new();
        private static readonly SemaphoreSlim _importLock = new(1, 1);
        private static readonly byte[] _pngHeader = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
        private static readonly Regex _captureName = new(
            @"^(?<game>.+) - \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.\d{3} - [0-9a-f]{8}$",
            RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

        private static string DirectoryPath => Path.Combine(Settings.Instance.ContentFolder, FolderNames.Screenshots);
        private const string ImportedFolderName = "Imported";
        private const string TitlesFileName = ".titles.json";
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
            string directory = DirectoryPath;
            string id = Guid.NewGuid().ToString("N");
            var invalidChars = Path.GetInvalidFileNameChars();
            string title = new string((game ?? "").Take(60)
                .Select(c => invalidChars.Contains(c) || char.IsControl(c) ? '_' : c).ToArray()).Trim(' ', '.');
            if (title.Length == 0)
                title = "Screenshot";
            string fileName = FormattableString.Invariant($"{title} - {DateTime.Now:yyyy-MM-dd HH-mm-ss.fff} - {id[..8]}.png");

            await WriteImageAsync(Path.Combine(directory, fileName), writePng);
            Log.Information("Screenshot saved: {FileName}", fileName);
            _ = Task.Run(() => OBSService.PlaySound("screenshot"));
            RefreshAfterFileChange();
            return fileName;
        }

        private static async Task WriteImageAsync(string path, Func<string, Task> writeFile)
        {
            string directory = Path.GetDirectoryName(path)!;
            Directory.CreateDirectory(directory);
            string tempPath = Path.Combine(directory, $".{Guid.NewGuid():N}.tmp");
            try
            {
                await writeFile(tempPath);
                File.Move(tempPath, path);
            }
            catch
            {
                try { File.Delete(tempPath); }
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
            await WriteImageAsync(destination, async path =>
            {
                await using var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, useAsync: true);
                await source.CopyToAsync(file);
            });
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
                string directory = DirectoryPath;
                try
                {
                    IReadOnlyDictionary<string, string> titles;
                    try
                    {
                        titles = ReadTitles(directory);
                    }
                    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
                    {
                        Log.Warning(ex, "Could not read screenshot titles");
                        titles = new Dictionary<string, string>();
                    }

                    var screenshots = ReadDirectory(directory, isImported: false, titles)
                        .Concat(ReadDirectory(Path.Combine(directory, ImportedFolderName), isImported: true, titles))
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

        private static IEnumerable<Screenshot> ReadDirectory(
            string directory, bool isImported, IReadOnlyDictionary<string, string> titles)
        {
            var folder = new DirectoryInfo(directory);
            if (!folder.Exists)
                yield break;

            string prefix = isImported ? $"{ImportedFolderName}/" : "";
            foreach (var file in folder.EnumerateFiles())
            {
                if (ImageType(file.Name) == null)
                    continue;

                string title = Path.GetFileNameWithoutExtension(file.Name);
                string? game = null;
                if (!isImported && _captureName.Match(title) is { Success: true } capture)
                {
                    title = capture.Groups["game"].Value;
                    if (title != "Screenshot")
                        game = title;
                }

                if (titles.TryGetValue(prefix + file.Name, out string? savedTitle) && !string.IsNullOrWhiteSpace(savedTitle))
                    title = savedTitle;

                yield return new Screenshot(file.Name, file.FullName, file.LastWriteTimeUtc,
                    title, game, file.Length, isImported);
            }
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
            string? folder = Path.GetDirectoryName(Path.GetFullPath(path));
            return string.Equals(folder, root, PathComparison)
                || string.Equals(folder, Path.Combine(root, ImportedFolderName), PathComparison)
                ? ImageType(path)
                : null;
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

                // Video bookmarks use the original filename as the screenshot ID.
                var titles = ReadTitles(directory);
                titles[PathUtils.Normalize(Path.GetRelativePath(directory, path))] = title;
                WriteTitles(directory, titles);
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
                    return;

                File.Delete(path);
                captured = string.Equals(Path.GetDirectoryName(Path.GetFullPath(path)), directory, PathComparison);
                if (captured)
                    ContentService.RemoveBookmarksForDeletedMedia(BookmarkType.ScreenshotSaved, Path.GetFileName(path));
                try
                {
                    var titles = ReadTitles(directory);
                    if (titles.Remove(PathUtils.Normalize(Path.GetRelativePath(directory, path))))
                        WriteTitles(directory, titles);
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
                {
                    Log.Warning(ex, "Could not remove the title of the deleted screenshot");
                }
            }

            if (captured)
                await SettingsService.LoadContentFromFolderIntoState();
            else
                RefreshAfterFileChange();
        }

        private static Dictionary<string, string> ReadTitles(string directory)
        {
            var titles = new Dictionary<string, string>(StringComparer.FromComparison(PathComparison));
            string path = Path.Combine(directory, TitlesFileName);
            if (!File.Exists(path))
                return titles;

            var savedTitles = JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(path));
            if (savedTitles != null)
                foreach (var (name, title) in savedTitles)
                    titles[name] = title;

            return titles;
        }

        private static void WriteTitles(string directory, Dictionary<string, string> titles)
        {
            string tempPath = Path.Combine(directory, $".{Guid.NewGuid():N}.tmp");
            try
            {
                File.WriteAllText(tempPath, JsonSerializer.Serialize(titles));
                File.Move(tempPath, Path.Combine(directory, TitlesFileName), overwrite: true);
            }
            catch
            {
                try { File.Delete(tempPath); }
                catch (Exception ex) { Log.Warning(ex, "Could not remove unfinished screenshot titles"); }
                throw;
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
