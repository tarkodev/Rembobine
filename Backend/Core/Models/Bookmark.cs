using System.Text.Json.Serialization;

namespace Segra.Backend.Core.Models
{
    public class Bookmark : IJsonOnDeserialized
    {
        public int Id { get; set; } = Random.Shared.Next(1, int.MaxValue);
        [JsonConverter(typeof(JsonStringEnumConverter))]
        public BookmarkType Type { get; set; }
        [JsonConverter(typeof(JsonStringEnumConverter))]
        public BookmarkSubtype? Subtype { get; set; }
        public TimeSpan Time { get; set; }
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public GameHighlightPaddingOverride? HighlightPadding { get; set; }
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? MediaId { get; set; }
        // A link carried into an excerpt is navigable, but does not identify the excerpt's source.
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
        public bool Inherited { get; set; }
        // Time marks the end of the excerpt. ClipOffset is its start in the finished clip, in seconds.
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public double? ClipOffset { get; set; }
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public TimeSpan? ClipStart { get; set; }

        // Older bookmarks stored the start in Time and the length in ClipDuration.
        [JsonPropertyName("ClipDuration"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public double? LegacyClipDuration { get; set; }

        void IJsonOnDeserialized.OnDeserialized()
        {
            if (Type == BookmarkType.ClipSaved && ClipStart == null && LegacyClipDuration is double length)
            {
                ClipStart = Time;
                Time += TimeSpan.FromSeconds(length);
            }
            LegacyClipDuration = null;
        }

        public Bookmark AtTime(TimeSpan time) => new()
        {
            Type = Type,
            Subtype = Subtype,
            MediaId = MediaId,
            Inherited = Inherited,
            Time = time,
            HighlightPadding = HighlightPadding,
            ClipOffset = ClipOffset,
            ClipStart = ClipStart + (time - Time)
        };
    }

    [JsonConverter(typeof(JsonStringEnumConverter))]
    public enum BookmarkType
    {
        Manual,
        [IncludeInHighlight] Kill,
        [IncludeInHighlight] Goal,
        Assist,
        Death,
        ReplaySaved,
        ScreenshotSaved,
        ClipSaved
    }

    /// <summary>
    /// Marks a BookmarkType as one that should be included in auto-generated highlights.
    /// </summary>
    [AttributeUsage(AttributeTargets.Field)]
    public class IncludeInHighlightAttribute : Attribute { }

    public static class BookmarkTypeExtensions
    {
        /// <summary>
        /// Returns true if this bookmark type should be included in auto-generated highlights.
        /// </summary>
        public static bool IncludeInHighlight(this BookmarkType type) =>
            typeof(BookmarkType).GetField(type.ToString())!
                .GetCustomAttributes(typeof(IncludeInHighlightAttribute), false).Length > 0;
    }

    [JsonConverter(typeof(JsonStringEnumConverter))]
    public enum BookmarkSubtype
    {
        Headshot
    }
}
