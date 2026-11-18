using Segra.Backend.Core.Models;
using Segra.Backend.Shared;

namespace Segra.Backend.Media;

// Reserve live bookmarks before encoding, then publish links only for the segments actually exported.
internal sealed class ClipBookmarks : IDisposable
{
    private sealed record Link(Bookmark Bookmark, string? ContentId, string? LivePath, Recording.PendingMediaBookmark? Pending);
    private readonly Dictionary<Segment, List<Link>> _links = [];
    private static readonly StringComparison PathComparison = OperatingSystem.IsWindows()
        ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;

    public void Track(Segment segment)
    {
        var links = _links[segment] = [];
        var library = AppState.Instance.Content;
        var recording = AppState.Instance.Recording;
        var path = PathUtils.Normalize(segment.FilePath ?? "");
        var source = library.FirstOrDefault(c => c.Id == segment.ContentId);
        var direct = Excerpt(segment.StartTime, segment.EndTime);

        if (source == null && segment.ContentId?.StartsWith("live-", StringComparison.Ordinal) == true)
        {
            if (recording?.FilePath != null && string.Equals(path, PathUtils.Normalize(recording.FilePath), PathComparison))
                links.Add(new(direct, null, path, recording.BeginLinkedBookmark(direct)));
            else
                links.Add(new(direct, null, path, null));
            return;
        }
        if (source == null) return;
        links.Add(new(direct, source.Id, null, null));

        if (source.Type is not (Content.ContentType.Buffer or Content.ContentType.Clip)) return;
        foreach (var session in library.Where(c => c.Type == Content.ContentType.Session))
        {
            foreach (var mark in Project(session.GetBookmarks(), source, segment, session.Duration.TotalSeconds))
                links.Add(new(mark, session.Id, null, null));
        }
        if (recording?.FilePath != null)
        {
            foreach (var mark in Project(recording.GetBookmarks(), source, segment, double.PositiveInfinity))
                links.Add(new(mark, null, PathUtils.Normalize(recording.FilePath), recording.BeginLinkedBookmark(mark)));
        }
    }

    private static Bookmark Excerpt(double start, double end, double offset = 0) => new()
    {
        Type = BookmarkType.ClipSaved,
        Time = TimeSpan.FromSeconds(Math.Max(0, end)),
        ClipStart = TimeSpan.FromSeconds(Math.Max(0, start)),
        ClipOffset = offset
    };

    // Translate an excerpt of a replay or previous clip into the session timeline.
    private static IEnumerable<Bookmark> Project(IEnumerable<Bookmark> markers, Content source, Segment segment, double sessionDuration)
    {
        foreach (var origin in markers)
        {
            if (origin.MediaId != source.Id) continue;
            double sessionStart = origin.Time.TotalSeconds;
            double mediaStart, length;
            if (source.Type == Content.ContentType.Buffer && origin.Type == BookmarkType.ReplaySaved)
            {
                mediaStart = 0;
                length = source.Duration.TotalSeconds;
                sessionStart -= length;
            }
            else if (source.Type == Content.ContentType.Clip && origin.Type == BookmarkType.ClipSaved &&
                     origin.ClipOffset is double offset && origin.ClipStart is TimeSpan clipStart)
            {
                mediaStart = offset;
                length = (origin.Time - clipStart).TotalSeconds;
                sessionStart = clipStart.TotalSeconds;
            }
            else continue;

            double start = Math.Max(segment.StartTime, mediaStart + Math.Max(0, -sessionStart));
            double end = Math.Min(segment.EndTime, mediaStart + Math.Min(length, sessionDuration - sessionStart));
            if (end > start)
                yield return Excerpt(sessionStart + start - mediaStart, sessionStart + end - mediaStart, start - segment.StartTime);
        }
    }

    public async Task SaveAsync(List<(string Id, List<Segment> Segments)> clips)
    {
        var bySource = new Dictionary<string, List<Bookmark>>();
        foreach (var (clipId, segments) in clips)
        {
            double offset = 0;
            foreach (var segment in segments)
            {
                foreach (var link in _links[segment])
                {
                    var mark = link.Bookmark;
                    mark.ClipOffset += offset;
                    if (link.Pending != null)
                    {
                        link.Pending.Complete(clipId);
                        continue;
                    }
                    var sourceId = link.ContentId ?? AppState.Instance.Content.FirstOrDefault(c =>
                        c.Type == Content.ContentType.Session && string.Equals(c.FilePath, link.LivePath, PathComparison))?.Id;
                    if (sourceId == null) continue;
                    mark.MediaId = clipId;
                    if (!bySource.TryGetValue(sourceId, out var bookmarks))
                        bySource[sourceId] = bookmarks = [];
                    bookmarks.Add(mark);
                }
                offset += segment.EndTime - segment.StartTime;
            }
        }
        foreach (var (sourceId, bookmarks) in bySource)
            await ContentService.AddBookmarks(sourceId, bookmarks);
    }

    public void Dispose()
    {
        foreach (var links in _links.Values)
            foreach (var link in links)
                link.Pending?.Dispose();
    }
}
