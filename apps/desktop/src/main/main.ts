import { app, BrowserWindow, ipcMain, Notification } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    title: 'Swaranbhumi Enterprise CRM',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // Sandbox rendering process to limit access to host filesystem
    },
    show: false,
  });

  // Load URL
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    
    // Check for updates silently in background (Production NSIS targets)
    if (!isDev) {
      autoUpdater.checkForUpdatesAndNotify();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Safe IPC channel triggers for system notifications
ipcMain.handle('send-notification', async (_: any, { title, body }: { title: string; body: string }) => {
  if (Notification.isSupported()) {
    const notif = new Notification({
      title,
      body,
      silent: false
    });
    notif.show();
    return { success: true };
  }
  return { success: false, error: 'Notifications not supported' };
});

ipcMain.handle('get-env-config', async () => {
  return {
    isPackaged: app.isPackaged,
    version: app.getVersion()
  };
});

// Auto-updater logs & status checking
autoUpdater.on('checking-for-update', () => {
  console.log('Checking for Swaranbhumi CRM application updates...');
});

autoUpdater.on('update-available', () => {
  console.log('Update available! Downloading silently in the background...');
});

autoUpdater.on('update-downloaded', () => {
  console.log('Update downloaded. Ready to install upon next application restart.');
});
