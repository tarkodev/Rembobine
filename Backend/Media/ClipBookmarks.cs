using Segra.Backend.App;
using Segra.Backend.Core.Models;
using Segra.Backend.Shared;

namespace Segra.Backend.Media;

// Reserve live bookmarks before encoding, then publish links only for the segments actually exported.
internal sealed class ClipBookmarks : IDisposable
{
    private sealed record Link(Bookmark Bookmark, string? ContentId, string? LivePath, Recording.PendingMediaBookmark? Pending);
    private readonly Dictionary<Segment, List<Link>> _links = [];
    private readonly Dictionary<Segment, Bookmark[]> _sourceBookmarks = [];
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
            {
                _sourceBookmarks[segment] = recording.GetBookmarks().ToArray();
                links.Add(new(direct, null, path, recording.BeginLinkedBookmark(direct)));
            }
            else
            {
                var finished = library.FirstOrDefault(c => c.Type == Content.ContentType.Session &&
                    string.Equals(PathUtils.Normalize(c.FilePath), path, PathComparison));
                var snapshot = MessageService.LiveContent;
                _sourceBookmarks[segment] = finished?.GetBookmarks() ??
                    (snapshot?.Id == segment.ContentId ? snapshot.GetBookmarks() : []);
                links.Add(new(direct, null, path, null));
            }
            return;
        }
        if (source == null) return;
        _sourceBookmarks[segment] = source.GetBookmarks();
        links.Add(new(direct, source.Id, null, null));

        if (source.Type == Content.ContentType.Session) return;
        foreach (var ancestor in library.Where(c => c.Id != source.Id))
        {
            foreach (var mark in Project(ancestor.Id, ancestor.GetBookmarks(), source, segment, ancestor.Duration.TotalSeconds))
                links.Add(new(mark, ancestor.Id, null, null));
        }
        if (recording?.FilePath != null)
        {
            foreach (var mark in Project(null, recording.GetBookmarks(), source, segment, double.PositiveInfinity))
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

    // Translate an excerpt into the original recording and any surviving intermediate sources.
    private static IEnumerable<Bookmark> Project(string? parentId, IEnumerable<Bookmark> markers, Content source, Segment segment, double sessionDuration)
    {
        if (source.SourceExcerpts is { } excerpts)
        {
            foreach (var range in excerpts.Where(e => e.SourceId == parentId))
                if (Intersect(range.Start, range.Offset, range.End - range.Start) is { } mark)
                    yield return mark;
        }
        foreach (var origin in markers)
        {
            if (origin.Inherited || origin.MediaId != source.Id) continue;
            Bookmark? mark = null;
            if (source.GetReplayStart(origin) is TimeSpan replayStart)
                mark = Intersect(replayStart.TotalSeconds, 0, source.Duration.TotalSeconds);
            else if (source.Type is Content.ContentType.Clip or Content.ContentType.Highlight && origin.Type == BookmarkType.ClipSaved &&
                     origin.ClipOffset is double offset && origin.ClipStart is TimeSpan clipStart)
                mark = Intersect(clipStart.TotalSeconds, offset, (origin.Time - clipStart).TotalSeconds);
            if (mark != null) yield return mark;
        }

        Bookmark? Intersect(double sessionStart, double mediaStart, double length)
        {
            double start = Math.Max(segment.StartTime, mediaStart + Math.Max(0, -sessionStart));
            double end = Math.Min(segment.EndTime, mediaStart + Math.Min(length, sessionDuration - sessionStart));
            return end > start ? Excerpt(sessionStart + start - mediaStart, sessionStart + end - mediaStart, start - segment.StartTime) : null;
        }
    }

    // Output order is the player's segment order, including repeats and cuts from different sources.
    private static IEnumerable<(Segment Segment, double Offset)> Positions(List<Segment> segments)
    {
        double offset = 0;
        foreach (var segment in segments)
        {
            yield return (segment, offset);
            offset += segment.EndTime - segment.StartTime;
        }
    }

    public List<Bookmark> InOutput(List<Segment> segments) => Positions(segments)
        .SelectMany(p => InRange(_sourceBookmarks.GetValueOrDefault(p.Segment) ?? [],
            TimeSpan.FromSeconds(p.Segment.StartTime), TimeSpan.FromSeconds(p.Segment.EndTime), TimeSpan.FromSeconds(p.Offset)))
        .OrderBy(b => b.Time).ToList();

    // A legacy clip may be linked from both a replay and its full session. Keep the
    // maximum multiplicity of each event, including two real kills on the same frame.
    internal static List<Bookmark> MissingLegacyEvents(Content clip, IEnumerable<(Content Source, Bookmark Link)> ranges)
    {
        static (BookmarkType, BookmarkSubtype?, string?, long) Key(Bookmark b) =>
            (b.Type, b.Subtype, b.MediaId, (long)Math.Round(b.Time.TotalMilliseconds));
        var counts = clip.GetBookmarks().GroupBy(Key).ToDictionary(g => g.Key, g => g.Count());
        var missing = new List<Bookmark>();
        foreach (var (source, link) in ranges)
        {
            if (link.ClipStart is not TimeSpan start || link.ClipOffset is not double offset || !double.IsFinite(offset) || offset < 0)
                continue;
            // Other ClipSaved ranges are reverse links and may have been created after this export.
            var events = InRange(source.GetBookmarks().Where(b => b.Type != BookmarkType.ClipSaved),
                start, link.Time, TimeSpan.FromSeconds(offset)).Where(b => b.Time < clip.Duration);
            foreach (var group in events.GroupBy(Key))
            {
                int existing = counts.GetValueOrDefault(group.Key);
                missing.AddRange(group.Skip(existing));
                counts[group.Key] = Math.Max(existing, group.Count());
            }
        }
        return missing.OrderBy(b => b.Time).ToList();
    }

    internal static IEnumerable<Bookmark> InRange(IEnumerable<Bookmark> bookmarks, TimeSpan start, TimeSpan end, TimeSpan offset)
    {
        foreach (var bookmark in bookmarks)
        {
            if (bookmark.Type == BookmarkType.ClipSaved && bookmark.ClipStart is TimeSpan from)
            {
                var left = from < start ? start : from;
                var right = bookmark.Time > end ? end : bookmark.Time;
                if (right <= left) continue;
                var excerpt = bookmark.AtTime(right - start + offset);
                excerpt.ClipStart = left - start + offset;
                excerpt.ClipOffset += (left - from).TotalSeconds;
                excerpt.Inherited = true;
                yield return excerpt;
            }
            else if (bookmark.Time >= start && bookmark.Time < end)
            {
                var point = bookmark.AtTime(bookmark.Time - start + offset);
                if (bookmark.HighlightPadding is { } padding)
                    point.HighlightPadding = new()
                    {
                        Before = Math.Min(padding.Before, (bookmark.Time - start).TotalSeconds),
                        After = Math.Min(padding.After, (end - bookmark.Time).TotalSeconds)
                    };
                point.Inherited = bookmark.MediaId != null;
                yield return point;
            }
        }
    }

    public async Task SaveAsync(List<(string Id, List<Segment> Segments)> clips)
    {
        var bySource = new Dictionary<string, List<Bookmark>>();
        foreach (var (clipId, segments) in clips)
        {
            foreach (var (segment, offset) in Positions(segments))
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
