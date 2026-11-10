param(
    [ValidateSet('attach', 'watch', 'inspect')]
    [string]$Mode = 'attach',
    [long]$WindowHandle = 0,
    [int]$X = 0,
    [int]$Y = 0,
    [int]$Width = 1920,
    [int]$Height = 1080,
    [int]$OwnerPid = 0
)

$interopSource = @'
using System;
using System.Runtime.InteropServices;

public static class AuraDeskNative
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    public struct MONITORINFO
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string className, string windowName);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetParent(IntPtr child, IntPtr newParent);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetWindowLong(IntPtr hWnd, int index);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int SetWindowLong(IntPtr hWnd, int index, int newStyle);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetLayeredWindowAttributes(IntPtr hWnd, uint colorKey, byte alpha, uint flags);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int command);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);

    private const int GWL_STYLE = -16;
    private const int GWL_EXSTYLE = -20;
    private const int WS_CHILD = 0x40000000;
    private const int WS_POPUP = unchecked((int)0x80000000);
    private const int WS_EX_LAYERED = 0x00080000;
    private const int WS_EX_NOREDIRECTIONBITMAP = 0x00200000;
    private const uint WM_SPAWN_WORKER = 0x052C;
    private const uint SMTO_NORMAL = 0x0000;
    private const uint LWA_ALPHA = 0x00000002;
    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_SHOWWINDOW = 0x0040;
    private const int SW_SHOWNA = 8;
    private const uint MONITOR_DEFAULTTONEAREST = 2;
    private static readonly IntPtr HWND_BOTTOM = new IntPtr(1);

    public static string LastDiagnostic { get; private set; }

    private static IntPtr FindClassicWorker(out IntPtr shellView)
    {
        IntPtr worker = IntPtr.Zero;
        IntPtr foundView = IntPtr.Zero;
        EnumWindows(delegate(IntPtr topWindow, IntPtr lParam)
        {
            IntPtr view = FindWindowEx(topWindow, IntPtr.Zero, "SHELLDLL_DefView", null);
            if (view != IntPtr.Zero)
            {
                worker = FindWindowEx(IntPtr.Zero, topWindow, "WorkerW", null);
                foundView = view;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        shellView = foundView;
        return worker;
    }

    private static void SetChildStyle(IntPtr window, bool layered)
    {
        int style = GetWindowLong(window, GWL_STYLE);
        SetWindowLong(window, GWL_STYLE, (style | WS_CHILD) & ~WS_POPUP);
        if (layered)
        {
            int exStyle = GetWindowLong(window, GWL_EXSTYLE);
            SetWindowLong(window, GWL_EXSTYLE, exStyle | WS_EX_LAYERED);
            SetLayeredWindowAttributes(window, 0, 255, LWA_ALPHA);
        }
    }

    public static string DescribeDesktop()
    {
        IntPtr progman = FindWindow("Progman", null);
        if (progman == IntPtr.Zero) return "progman-not-found";
        int exStyle = GetWindowLong(progman, GWL_EXSTYLE);
        bool raised = (exStyle & WS_EX_NOREDIRECTIONBITMAP) != 0;
        IntPtr shellView = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
        IntPtr childWorker = FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
        return String.Format("mode={0};progman={1};shellView={2};childWorker={3};exStyle=0x{4:X8}",
            raised ? "raised" : "classic", progman.ToInt64(), shellView.ToInt64(), childWorker.ToInt64(), exStyle);
    }

    public static bool Attach(long windowHandle, int x, int y, int width, int height)
    {
        IntPtr window = new IntPtr(windowHandle);
        if (window == IntPtr.Zero || !IsWindow(window))
        {
            LastDiagnostic = "invalid-window";
            return false;
        }

        IntPtr progman = FindWindow("Progman", null);
        if (progman == IntPtr.Zero)
        {
            LastDiagnostic = "progman-not-found";
            return false;
        }

        IntPtr messageResult;
        SendMessageTimeout(progman, WM_SPAWN_WORKER, new IntPtr(0xD), new IntPtr(0x1), SMTO_NORMAL, 1000, out messageResult);

        int progmanExStyle = GetWindowLong(progman, GWL_EXSTYLE);
        bool raisedDesktop = (progmanExStyle & WS_EX_NOREDIRECTIONBITMAP) != 0;
        IntPtr shellView = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
        IntPtr host;
        IntPtr insertAfter;

        if (raisedDesktop)
        {
            host = progman;
            insertAfter = shellView;
            if (shellView == IntPtr.Zero)
            {
                LastDiagnostic = "raised-shellview-not-found";
                return false;
            }
            SetChildStyle(window, true);
        }
        else
        {
            IntPtr enumeratedView;
            IntPtr worker = FindClassicWorker(out enumeratedView);
            if (shellView == IntPtr.Zero) shellView = enumeratedView;
            host = worker != IntPtr.Zero ? worker : progman;
            insertAfter = HWND_BOTTOM;
            SetChildStyle(window, false);
        }

        RECT hostRect;
        if (!GetWindowRect(host, out hostRect))
        {
            hostRect.Left = 0;
            hostRect.Top = 0;
        }

        SetParent(window, host);
        bool positioned = SetWindowPos(window, insertAfter, x - hostRect.Left, y - hostRect.Top, width, height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
        if (raisedDesktop)
        {
            IntPtr worker = FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
            if (worker != IntPtr.Zero)
                SetWindowPos(worker, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
        ShowWindow(window, SW_SHOWNA);
        LastDiagnostic = String.Format("mode={0};window={1};parent={2};shellView={3};bounds={4},{5},{6},{7};positioned={8}",
            raisedDesktop ? "raised" : "classic", window.ToInt64(), host.ToInt64(), shellView.ToInt64(),
            x - hostRect.Left, y - hostRect.Top, width, height, positioned);
        return positioned;
    }

    public static bool IsForegroundFullscreen(int ownerPid)
    {
        IntPtr window = GetForegroundWindow();
        if (window == IntPtr.Zero || !IsWindowVisible(window) || IsIconic(window)) return false;

        uint processId;
        GetWindowThreadProcessId(window, out processId);
        if (processId == ownerPid) return false;

        RECT windowRect;
        if (!GetWindowRect(window, out windowRect)) return false;
        IntPtr monitor = MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST);
        MONITORINFO info = new MONITORINFO();
        info.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
        if (!GetMonitorInfo(monitor, ref info)) return false;

        const int tolerance = 3;
        return Math.Abs(windowRect.Left - info.rcMonitor.Left) <= tolerance
            && Math.Abs(windowRect.Top - info.rcMonitor.Top) <= tolerance
            && Math.Abs(windowRect.Right - info.rcMonitor.Right) <= tolerance
            && Math.Abs(windowRect.Bottom - info.rcMonitor.Bottom) <= tolerance;
    }
}
'@

Add-Type -TypeDefinition $interopSource -Language CSharp

if ($Mode -eq 'inspect') {
    Write-Output ([AuraDeskNative]::DescribeDesktop())
    exit 0
}

if ($Mode -eq 'attach') {
    if ($WindowHandle -eq 0) {
        Write-Error "AuraDesk did not provide a valid native window handle."
        exit 1
    }
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if ([AuraDeskNative]::Attach($WindowHandle, $X, $Y, $Width, $Height)) {
            Write-Output "ATTACHED $([AuraDeskNative]::LastDiagnostic)"
            exit 0
        }
        Start-Sleep -Milliseconds 100
    }
    Write-Error "Windows could not attach the AuraDesk wallpaper window to the desktop. Diagnostic: $([AuraDeskNative]::LastDiagnostic)"
    exit 1
}

$lastState = ''
while ($true) {
    if ($OwnerPid -gt 0 -and -not (Get-Process -Id $OwnerPid -ErrorAction SilentlyContinue)) {
        exit 0
    }
    $currentState = if ([AuraDeskNative]::IsForegroundFullscreen($OwnerPid)) { 'FULLSCREEN' } else { 'NORMAL' }
    if ($currentState -ne $lastState) {
        [Console]::Out.WriteLine($currentState)
        [Console]::Out.Flush()
        $lastState = $currentState
    }
    Start-Sleep -Milliseconds 750
}
