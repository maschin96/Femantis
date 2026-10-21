import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI } from '../shared/types';

const api: DesktopAPI = {
  backendStatus: () => ipcRenderer.invoke('desktop:status'),
  openMesh: (scale) => ipcRenderer.invoke('desktop:mesh', scale),
  openProject: () => ipcRenderer.invoke('desktop:open'),
  loadExample: (kind) => ipcRenderer.invoke('desktop:example', kind),
  saveProject: (view) => ipcRenderer.invoke('desktop:save', view),
  setDirty: (value) => ipcRenderer.invoke('desktop:dirty', value),
  createBox: (value) => ipcRenderer.invoke('desktop:box', value),
  importGeometry: (value) => ipcRenderer.invoke('desktop:geometry', value),
  openModel: () => ipcRenderer.invoke('desktop:openModel'),
  exportModel: (value) => ipcRenderer.invoke('desktop:exportModel', value),
  validateModel: (value) => ipcRenderer.invoke('desktop:validate', value),
  solveModel: (value) => ipcRenderer.invoke('desktop:solve', value),
  cancelJob: () => ipcRenderer.invoke('desktop:cancel'),
  saveWorkspace: (view, model, runId) =>
    ipcRenderer.invoke('desktop:saveWorkspace', view, model, runId),
  listRuns: () => ipcRenderer.invoke('desktop:runs'),
  selectRun: (id) => ipcRenderer.invoke('desktop:selectRun', id),
  removeRun: (id) => ipcRenderer.invoke('desktop:removeRun', id),
  cleanRunCache: () => ipcRenderer.invoke('desktop:cleanRunCache'),
  onJob: (callback) => {
    const handler = (_event: unknown, value: import('../shared/types').JobEvent) => callback(value);
    ipcRenderer.on('desktop:job', handler);
    return () => ipcRenderer.removeListener('desktop:job', handler);
  },
};
contextBridge.exposeInMainWorld('desktop', api);
