import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  cropImage: (args: any) => ipcRenderer.invoke('image:crop', args),
  saveMask: (shapes: any) => ipcRenderer.invoke('mask:save', shapes),
  loadMask: () => ipcRenderer.invoke('mask:load'),
});
