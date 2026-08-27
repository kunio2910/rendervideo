/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("kitoDesktop", Object.freeze({
  isDesktop: true,
  platform: process.platform,
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  loadWorkspace: () => ipcRenderer.invoke("workspace-load"),
  saveWorkspace: (payload) => ipcRenderer.invoke("workspace-save", payload),
}));
