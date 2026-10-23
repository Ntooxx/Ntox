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
});
