using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("\u0422\u0440\u0435\u043A\u0435\u0440")]
[assembly: AssemblyProduct("\u0422\u0440\u0435\u043A\u0435\u0440")]
[assembly: AssemblyDescription("Local personal task tracker launcher")]

internal static class TrackerLauncher
{
    [STAThread]
    private static int Main()
    {
        string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        string script = Path.Combine(root, "scripts", "Open-Planner.ps1");
        string shell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),
            "WindowsPowerShell", "v1.0", "powershell.exe");
        try
        {
            using (Process process = new Process())
            {
                process.StartInfo = new ProcessStartInfo {
                    FileName = shell,
                    Arguments = "-NoProfile -WindowStyle Hidden -File \"" + script + "\"",
                    WorkingDirectory = root,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                process.Start();
                process.WaitForExit();
                if (process.ExitCode == 0) return 0;
            }
            MessageBox.Show("The tracker could not start. See .local\\launcher-error.log in the application folder.",
                "\u0422\u0440\u0435\u043A\u0435\u0440", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return 1;
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "\u0422\u0440\u0435\u043A\u0435\u0440",
                MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return 1;
        }
    }
}
