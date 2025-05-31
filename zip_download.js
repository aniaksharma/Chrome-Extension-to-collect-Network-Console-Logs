chrome.runtime.sendMessage({ action: "getLogsForZip" }, async (data) => {
  console.log("zip_download.js received logs:", data);

  const zip = new JSZip();

  if (data.consoleLogs && data.consoleLogs.length) {
    const decoder = new TextDecoder();
    const consoleText = data.consoleLogs.map(chunk => {
      if (chunk instanceof Uint8Array) return decoder.decode(chunk);
      if (Array.isArray(chunk)) return decoder.decode(new Uint8Array(chunk));
      return "";
    }).join('');
    zip.file("console_logs.txt", consoleText);
  } else {
    console.log("No console logs found.");
  }

  if (data.harEntries && data.harEntries.length) {
    const harData = {
      log: {
        version: "1.2",
        creator: { name: "WebInspector", version: "1.2" },
        entries: data.harEntries
      }
    };
    zip.file("network_logs.har", JSON.stringify(harData, null, 2));
  } else {
    console.log("No network logs found.");
  }

  const content = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(content);

  chrome.downloads.download({
    url: url,
    filename: `logs/Browser_logs_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`,
    saveAs: true
  }, () => {
    console.log("Download triggered.");
  });
});
