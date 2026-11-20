using System.Diagnostics;
using System.IO.Pipes;
using Serilog;

namespace Segra.Backend.Platform.Windows
{
    internal static class WindowsQuitCommand
    {
        private const PipeOptions Options = PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly;
        private const byte Quit = 1;

        // Keep the quit channel separate from the legacy pipe that brings the window forward.
        private static string GetPipeName(string mutexName)
        {
            using var process = Process.GetCurrentProcess();
            return $"{mutexName}.Quit.{process.SessionId}";
        }

        public static async Task<int> RequestAsync(string mutexName)
        {
            try
            {
                if (!Mutex.TryOpenExisting(mutexName, out var mutex))
                    return 0;
                mutex.Dispose();

                using var pipe = new NamedPipeClientStream(".", GetPipeName(mutexName), PipeDirection.InOut, Options);
                using var handshake = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                await pipe.ConnectAsync(handshake.Token);
                var pid = new byte[sizeof(int)];
                await pipe.ReadExactlyAsync(pid, handshake.Token);
                using var target = Process.GetProcessById(BitConverter.ToInt32(pid));
                // Pin this instance before requesting exit, even if it shuts down immediately.
                _ = target.SafeHandle;
                pipe.WriteByte(Quit);
                pipe.Close();

                if (target.WaitForExit(60_000))
                    return 0;

                Console.Error.WriteLine("Rembobine is still running after 60 seconds.");
                return 1;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Could not confirm that Rembobine exited: {ex.Message}");
                return 1;
            }
        }

        public static async Task ListenAsync(string mutexName, Action exit)
        {
            string pipeName = GetPipeName(mutexName);
            while (true)
            {
                try
                {
                    using var pipe = new NamedPipeServerStream(pipeName, PipeDirection.InOut, 1,
                        PipeTransmissionMode.Byte, Options);
                    await pipe.WaitForConnectionAsync();
                    using var handshake = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                    await pipe.WriteAsync(BitConverter.GetBytes(Environment.ProcessId), handshake.Token);
                    var request = new byte[1];
                    if (await pipe.ReadAsync(request, handshake.Token) == 1 && request[0] == Quit)
                        exit();
                }
                catch (Exception ex)
                {
                    Log.Warning(ex, "Could not handle the Rembobine quit command");
                    await Task.Delay(250);
                }
            }
        }
    }
}
