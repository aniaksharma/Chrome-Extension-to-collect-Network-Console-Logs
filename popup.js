const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusLabel = document.getElementById('statusValue');
const logSizeLabel = document.getElementById('logSize');

startBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: "startCapture" });
  updateUI(true);
  chrome.storage.local.set({ capturing: true });
});

stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: "stopCapture" });
  updateUI(false);
  chrome.storage.local.set({ capturing: false });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'logSizeUpdate') {
    const sizeInMB = (message.size / (1024 * 1024)).toFixed(10);
    logSizeLabel.textContent = `Log Size: ${sizeInMB} MB`;
  }
});

function updateUI(isCapturing) {
  if (isCapturing) {
    statusLabel.textContent = "Capturing...";
    statusLabel.classList.remove("status-stopped");
    statusLabel.classList.add("status-capturing");
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } else {
    statusLabel.textContent = "Stopped";
    statusLabel.classList.remove("status-capturing");
    statusLabel.classList.add("status-stopped");
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

chrome.storage.local.get(['capturing', 'currentLogSize'], (data) => {
  updateUI(data.capturing === true);
  const sizeInMB = data.currentLogSize ? (data.currentLogSize / (1024 * 1024)).toFixed(10) : "0.00";
  logSizeLabel.textContent = `Log Size: ${sizeInMB} MB`;
});

setInterval(() => {
  chrome.storage.local.get(['capturing', 'currentLogSize'], (data) => {
    if (data.capturing) {
      const sizeInMB = data.currentLogSize ? (data.currentLogSize / (1024 * 1024)).toFixed(10) : "0.00";
      logSizeLabel.textContent = `Log Size: ${sizeInMB} MB`;
    }
  });
}, 1000);
