using Serilog;
using System.Reflection;

namespace Segra.Backend.App
{
    internal static class StartupService
    {
        private static readonly string StartupFolder = Environment.GetFolderPath(Environment.SpecialFolder.Startup);
        private static readonly string ShortcutPath = Path.Combine(StartupFolder, "Rembobine.lnk");
        private static readonly string LegacyShortcutPath = Path.Combine(StartupFolder, "Segrabi.lnk");
        private static readonly string ExecutablePath = Path.ChangeExtension(Assembly.GetExecutingAssembly().Location, ".exe");

        private static dynamic OpenShortcut(string path)
        {
            var shellType = Type.GetTypeFromProgID("WScript.Shell")!;
            dynamic shell = Activator.CreateInstance(shellType)!;
            return shell.CreateShortcut(path);
        }

        private static bool HasLegacyShortcut()
        {
            if (!File.Exists(LegacyShortcutPath))
                return false;

            string target = OpenShortcut(LegacyShortcutPath).TargetPath;
            string legacyExe = Path.Combine(AppContext.BaseDirectory, "Segrabi.exe");
            // Velopack can retarget the old link before the application gets to rename it.
            return string.Equals(target, legacyExe, StringComparison.OrdinalIgnoreCase)
                || string.Equals(target, ExecutablePath, StringComparison.OrdinalIgnoreCase);
        }

        private static void WriteShortcut()
        {
            dynamic shortcut = OpenShortcut(ShortcutPath);
            shortcut.TargetPath = ExecutablePath;
            shortcut.Arguments = "--from-startup";
            shortcut.WorkingDirectory = AppContext.BaseDirectory;
            shortcut.IconLocation = ExecutablePath + ",0";
            shortcut.Save();
        }

        public static void SetStartupStatus(bool enable)
        {
            try
            {
                if (enable)
                    WriteShortcut();
                else
                    File.Delete(ShortcutPath);

                if (HasLegacyShortcut())
                    File.Delete(LegacyShortcutPath);
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Could not update the Rembobine startup shortcut");
            }
        }

        public static bool GetStartupStatus()
        {
            try
            {
                if (HasLegacyShortcut())
                {
                    // Publish the new shortcut before retiring the previous launch target.
                    WriteShortcut();
                    File.Delete(LegacyShortcutPath);
                }
                return File.Exists(ShortcutPath);
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Could not read the Rembobine startup shortcut");
                return File.Exists(ShortcutPath) || File.Exists(LegacyShortcutPath);
            }
        }
    }
}
