"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    openFile: () => electron_1.ipcRenderer.invoke('dialog:openFile'),
    cropImage: (args) => electron_1.ipcRenderer.invoke('image:crop', args),
});
