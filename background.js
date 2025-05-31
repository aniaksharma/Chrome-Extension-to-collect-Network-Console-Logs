let debugging = false;
let consoleLogs = [];
let harEntries = [];
let tabId = null;
let fileCounter = 0;
let currentSize = 0;
const requestMap = new Map();
let folderName = "";
let lastLogs = { consoleLogs: [], harEntries: [] };

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getLogsForZip") {
    sendResponse(lastLogs);
  }
  if (request.action === "startCapture") startCapture();
  else if (request.action === "stopCapture") stopCapture();
  // Return true if you ever use async sendResponse
});

function getFormattedFolderName() {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toTimeString().split(' ')[0].replace(/:/g, '-');
  return `logs/Browser_logs${date}_${time}`;
}

function startCapture() {
  folderName = getFormattedFolderName();

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    tabId = tab.id;

    chrome.debugger.attach({ tabId }, "1.3", () => {
      debugging = true;
      chrome.debugger.sendCommand({ tabId }, "Network.enable");
      chrome.debugger.sendCommand({ tabId }, "Console.enable");
      chrome.debugger.onEvent.addListener(onDebuggerEvent);
    });
  });
}

function stopCapture() {
  if (tabId) {
    // Save logs in memory (not chrome.storage.local)
    lastLogs = {
      consoleLogs: consoleLogs.slice(),
      harEntries: harEntries.slice()
    };

    chrome.tabs.create({ url: chrome.runtime.getURL("zip_download.html") });

    chrome.debugger.detach({ tabId });
    debugging = false;
    tabId = null;
    consoleLogs = [];
    harEntries = [];
    requestMap.clear();
    fileCounter = 0;
    currentSize = 0;
  }
}

function onDebuggerEvent(source, method, params) {
  if (!debugging) return;

  if (method === "Console.messageAdded") {
    const { level, text, url, line, column } = params.message;
    const time = new Date().toISOString();
    const tag = {
      log: "[Info]",
      warning: "[Warning]",
      error: "[Error]",
      info: "[Info]",
      debug: "[Debug]"
    }[level] || `[${level}]`;
    const location = url ? ` (${url}:${line ?? 0}:${column ?? 0})` : "";
    const lineText = `[${time}] ${tag} ${text}${location}`;
    const encoded = new TextEncoder().encode(lineText + '\n');
    consoleLogs.push(encoded);
    currentSize += encoded.length;
    console.log("Captured console log:", lineText);
  }

  if (method === "Network.requestWillBeSent") {
    requestMap.set(params.requestId, {
      requestId: params.requestId,
      request: params.request,
      startTime: params.timestamp,
      wallTime: params.wallTime,
      initiator: params.initiator,
      documentURL: params.documentURL,
      type: params.type,
      redirectResponse: params.redirectResponse,
      hasPostData: !!params.request.postData
    });
  }

  if (method === "Network.responseReceived") {
    const req = requestMap.get(params.requestId);
    if (req) {
      req.response = params.response;
    }
  }

  if (method === "Network.loadingFinished") {
    const req = requestMap.get(params.requestId);
    if (req && req.response) {
      const { request, response, startTime, wallTime, requestId } = req;

      chrome.debugger.sendCommand({ tabId }, "Network.getResponseBody", { requestId }, (bodyResult) => {
        const postData = request.postData || "";
        const headersSize = response.headersText ? response.headersText.length : -1;

        const entry = {
          pageref: req.documentURL,
          startedDateTime: new Date(wallTime * 1000).toISOString(),
          time: (params.timestamp - startTime) * 1000,
          _requestId: requestId,
          _initiator: req.initiator,
          _priority: response.priority,
          _fetchedViaServiceWorker: response.fromServiceWorker || false,
          _transferSize: response.encodedDataLength,
          _error: response?.errorText || undefined,
          request: {
            method: request.method,
            url: request.url,
            httpVersion: "HTTP/1.1",
            headers: objectToNameValue(request.headers),
            queryString: parseQueryParams(request.url),
            headersSize: request.headers ? JSON.stringify(request.headers).length : -1,
            bodySize: postData ? postData.length : 0,
            postData: postData
              ? {
                  mimeType: request.headers["Content-Type"] || "",
                  text: postData
                }
              : undefined
          },
          response: {
            status: response.status,
            statusText: response.statusText,
            httpVersion: "HTTP/1.1",
            headers: objectToNameValue(response.headers),
            redirectURL: response.headers?.location || "",
            headersSize: headersSize,
            bodySize: typeof response.encodedDataLength === "number" ? response.encodedDataLength : -1,
            content: {
              size: response.encodedDataLength || 0,
              mimeType: response.mimeType,
              text: !chrome.runtime.lastError && bodyResult ? bodyResult.body : "",
              encoding: bodyResult?.base64Encoded ? "base64" : undefined
            }
          },
          cache: {},
          timings: {
            send: response.timing?.sendEnd - response.timing?.sendStart || 0,
            wait: response.timing?.receiveHeadersEnd - response.timing?.sendEnd || 0,
            receive: (params.timestamp - startTime) * 1000
          }
        };

        harEntries.push(entry);
        finalizeIfLarge();
      });
    }
  }

  chrome.storage.local.set({ currentLogSize: currentSize });
  chrome.runtime.sendMessage({ type: 'logSizeUpdate', size: currentSize }).catch(() => {});
}

function objectToNameValue(obj) {
  return Object.entries(obj || {}).map(([name, value]) => ({ name, value }));
}

function parseQueryParams(url) {
  try {
    const u = new URL(url);
    return Array.from(u.searchParams.entries()).map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

function finalizeIfLarge() {
  // No notification, no clearing, just keep accumulating logs in memory
}

function downloadLogs() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = `${folderName}/Logs_${timestamp}_${fileCounter}`;

  if (chrome.downloads.setUiOptions) {
    chrome.downloads.setUiOptions({ enabled: false });
  }

  if (consoleLogs.length > 0) {
    const blob = new Blob(consoleLogs, { type: 'text/plain' });
    const reader = new FileReader();
    reader.onloadend = () => {
      chrome.downloads.download({
        url: reader.result,
        filename: `${baseName}_console.txt`,
        saveAs: false
      });
    };
    reader.readAsDataURL(blob);
  }

  if (harEntries.length > 0) {
    const harData = {
      log: {
        version: "1.2",
        creator: {
          name: "WebInspector",
          version: "1.2"
        },
        entries: harEntries
      }
    };

    const blob = new Blob([JSON.stringify(harData, null, 2)], {
      type: 'application/json'
    });
    const reader = new FileReader();
    reader.onloadend = () => {
      chrome.downloads.download({
        url: reader.result,
        filename: `${baseName}_network.har`,
        saveAs: false
      });
    };
    reader.readAsDataURL(blob);
  }

  console.log("consoleLogs before saving to lastLogs:", consoleLogs.length, consoleLogs);
}
