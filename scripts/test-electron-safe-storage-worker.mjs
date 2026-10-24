import { app, BrowserWindow } from 'electron';

const userData = process.argv.at(-1);
if (!userData) throw new Error('Isolated safeStorage smoke profile path is required');
app.setPath('userData', userData);

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 420,
    height: 240,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await window.loadURL('data:text/html,<title>Storage smoke</title>');
});

app.on('window-all-closed', () => app.quit());
