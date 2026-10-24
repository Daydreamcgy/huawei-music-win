// Installed font enumeration for the appearance settings.
//
// Chromium's queryLocalFonts() is unavailable on file:// documents, so the list is produced in
// the main process: PowerShell/.NET on Windows, fontconfig on Linux (and on macOS when present).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseFcList, parseWindowsFontList } from './fonts.mjs';

const run = promisify(execFile);

export async function listSystemFonts(): Promise<string[]> {
  if (process.platform === 'win32') {
    // System.Drawing exposes the same font families the system UI uses; no extra tooling needed.
    const script = "Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }";
    try {
      const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        timeout: 15_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
      });
      return parseWindowsFontList(stdout);
    } catch { return []; }
  }
  try {
    const { stdout } = await run('fc-list', [':', 'family'], { timeout: 8_000, maxBuffer: 4 * 1024 * 1024 });
    return parseFcList(stdout);
  } catch { return []; }
}
