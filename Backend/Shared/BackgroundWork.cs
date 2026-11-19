namespace Segra.Backend.Shared
{
    // Counts long-running jobs (clips, uploads, imports, highlights) so an automatic update never restarts mid-job.
    public static class BackgroundWork
    {
        private static int _active;
        private static int _libraryWriters;

        public static bool IsBusy => Volatile.Read(ref _active) > 0;
        public static bool IsUpdatingLibrary => Volatile.Read(ref _libraryWriters) > 0;

        public static IDisposable Begin(bool writesLibrary = true)
        {
            Interlocked.Increment(ref _active);
            if (writesLibrary) Interlocked.Increment(ref _libraryWriters);
            return new Scope(writesLibrary);
        }

        private sealed class Scope(bool writesLibrary) : IDisposable
        {
            private int _disposed;

            public void Dispose()
            {
                if (Interlocked.Exchange(ref _disposed, 1) == 0)
                {
                    if (writesLibrary) Interlocked.Decrement(ref _libraryWriters);
                    Interlocked.Decrement(ref _active);
                }
            }
        }
    }
}
