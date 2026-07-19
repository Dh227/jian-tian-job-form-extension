chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== "install") return;

  const { onboardingComplete } = await chrome.storage.local.get("onboardingComplete");
  if (!onboardingComplete) {
    await chrome.runtime.openOptionsPage();
  }
});
