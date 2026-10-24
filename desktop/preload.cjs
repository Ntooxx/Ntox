const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ntoxDesktop", {
  sendMessage: payload => ipcRenderer.invoke("ntox:send-message", payload),
  cancelMessage: requestId => ipcRenderer.invoke("ntox:cancel-message", requestId),
  onChatEvent: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("ntox:chat-event", listener);
    return () => ipcRenderer.removeListener("ntox:chat-event", listener);
  },
  request: input => ipcRenderer.invoke("ntox:desktop-request", input),
  loadConversations: () => ipcRenderer.invoke("ntox:load-conversations"),
  saveConversations: conversations => ipcRenderer.invoke("ntox:save-conversations", conversations),
  getRuntimeStatus: () => ipcRenderer.invoke("ntox:runtime-status"),
  getSecretStoreStatus: () => ipcRenderer.invoke("ntox:secret-store-status"),
  saveCredential: input => ipcRenderer.invoke("ntox:save-credential", input),
  deleteCredential: input => ipcRenderer.invoke("ntox:delete-credential", input),
  testCredential: input => ipcRenderer.invoke("ntox:test-credential", input),
  reloadRuntime: () => ipcRenderer.invoke("ntox:reload-runtime"),
  approve: input => ipcRenderer.invoke("ntox:approve", input),
});
