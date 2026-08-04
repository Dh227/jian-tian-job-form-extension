chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== "install") return;

  const { onboardingComplete } = await chrome.storage.local.get("onboardingComplete");
  if (!onboardingComplete) {
    await chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "JT_CAPTURE_SCREENSHOT") return false;
  chrome.tabs.captureVisibleTab(message.windowId, { format: "jpeg", quality: 82 })
    .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || "岗位截图失败" }));
  return true;
});
