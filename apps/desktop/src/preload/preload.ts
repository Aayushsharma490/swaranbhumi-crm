import { contextBridge, ipcRenderer } from 'electron';

// Expose safe, selected functions to the renderer context
contextBridge.exposeInMainWorld('electronAPI', {
  sendNotification: (payload: { title: string; body: string }) => 
    ipcRenderer.invoke('send-notification', payload),
  
  getEnvConfig: () => 
    ipcRenderer.invoke('get-env-config'),
});
