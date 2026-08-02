using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;
using Microsoft.Win32;

namespace PremiereConnectorInstaller;

internal static class Program
{
    private const string ExtensionId = "MCPBridgeCEP";
    private const string ResourceName = "MCPBridgeCEP.zxp";

    [STAThread]
    private static int Main(string[] args)
    {
        ApplicationConfiguration.Initialize();

        bool quiet = args.Contains("--quiet", StringComparer.OrdinalIgnoreCase);
        bool uninstall = args.Contains("--uninstall", StringComparer.OrdinalIgnoreCase);

        try
        {
            if (uninstall)
            {
                RemoveConnector();
                Show(quiet, "Premiere Connector was removed. Restart Premiere Pro if it is open.", MessageBoxIcon.Information);
                return 0;
            }

            if (!quiet)
            {
                DialogResult answer = MessageBox.Show(
                    "Install or repair the Premiere Connector for the current Windows account?\n\n" +
                    "Close Premiere Pro first. Your media and projects are not accessed.",
                    "Premiere Connector Setup",
                    MessageBoxButtons.OKCancel,
                    MessageBoxIcon.Information);
                if (answer != DialogResult.OK) return 2;
            }

            if (IsPremiereRunning())
            {
                Show(quiet, "Premiere Pro is running. Close it, then run this installer again.", MessageBoxIcon.Warning);
                return 3;
            }

            InstallConnector();
            Show(
                quiet,
                "Premiere Connector is installed.\n\n" +
                "Next: open Premiere Pro, choose Window > Extensions > MCP Bridge, then ask your AI assistant to verify the Premiere connection.",
                MessageBoxIcon.Information);
            return 0;
        }
        catch (Exception error)
        {
            Show(quiet, "Setup could not finish:\n\n" + error.Message, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static string CepRoot => Path.GetFullPath(Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "Adobe", "CEP", "extensions"));

    private static string Destination => Path.GetFullPath(Path.Combine(CepRoot, ExtensionId));

    private static void InstallConnector()
    {
        EnsureInsideCepRoot(Destination);
        Directory.CreateDirectory(CepRoot);

        string staging = Path.Combine(CepRoot, $".{ExtensionId}-staging-{Guid.NewGuid():N}");
        string backup = Path.Combine(CepRoot, $".{ExtensionId}-backup-{Guid.NewGuid():N}");

        try
        {
            Directory.CreateDirectory(staging);
            ExtractEmbeddedPackage(staging);
            string manifest = Path.Combine(staging, "CSXS", "manifest.xml");
            if (!File.Exists(manifest)) throw new InvalidDataException("The connector package is missing CSXS/manifest.xml.");

            if (Directory.Exists(Destination)) Directory.Move(Destination, backup);
            Directory.Move(staging, Destination);
            if (Directory.Exists(backup)) Directory.Delete(backup, true);

            for (int version = 9; version <= 14; version++)
            {
                using RegistryKey key = Registry.CurrentUser.CreateSubKey($@"SOFTWARE\Adobe\CSXS.{version}", true);
                key.SetValue("PlayerDebugMode", "1", RegistryValueKind.String);
            }
        }
        catch
        {
            if (!Directory.Exists(Destination) && Directory.Exists(backup)) Directory.Move(backup, Destination);
            throw;
        }
        finally
        {
            if (Directory.Exists(staging)) Directory.Delete(staging, true);
            if (Directory.Exists(backup)) Directory.Delete(backup, true);
        }
    }

    private static void ExtractEmbeddedPackage(string staging)
    {
        using Stream package = Assembly.GetExecutingAssembly().GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException("The verified connector package is not embedded in this installer.");
        using var archive = new ZipArchive(package, ZipArchiveMode.Read);
        string root = Path.GetFullPath(staging).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;

        foreach (ZipArchiveEntry entry in archive.Entries)
        {
            string target = Path.GetFullPath(Path.Combine(staging, entry.FullName.Replace('/', Path.DirectorySeparatorChar)));
            if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("The connector package contains an unsafe path.");

            if (string.IsNullOrEmpty(entry.Name))
            {
                Directory.CreateDirectory(target);
                continue;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            entry.ExtractToFile(target, true);
        }
    }

    private static void RemoveConnector()
    {
        EnsureInsideCepRoot(Destination);
        if (Directory.Exists(Destination)) Directory.Delete(Destination, true);
    }

    private static void EnsureInsideCepRoot(string path)
    {
        string root = CepRoot.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!path.StartsWith(root, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Refusing to modify files outside the Adobe CEP extensions folder.");
    }

    private static bool IsPremiereRunning() => Process.GetProcesses().Any(process =>
    {
        try { return process.ProcessName.Contains("Adobe Premiere Pro", StringComparison.OrdinalIgnoreCase); }
        catch { return false; }
    });

    private static void Show(bool quiet, string message, MessageBoxIcon icon)
    {
        if (quiet) Console.Error.WriteLine(message);
        else MessageBox.Show(message, "Premiere Connector Setup", MessageBoxButtons.OK, icon);
    }
}
