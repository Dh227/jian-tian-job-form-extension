(function initializeContentBridge() {
  "use strict";

  if (window.__JIAN_TIAN_EXTENSION_LOADED__) return;
  window.__JIAN_TIAN_EXTENSION_LOADED__ = true;

  let lastSnapshot = [];

  function clearHighlights() {
    document.querySelectorAll("[data-jt-status]").forEach((element) => {
      element.removeAttribute("data-jt-status");
      element.removeAttribute("title");
    });
  }

  function highlight(item) {
    const element = item.candidate?.element;
    if (!element) return;
    element.dataset.jtStatus = item.status;
    element.title = item.reason || "";
  }

  function scan(profile) {
    clearHighlights();
    const raw = window.JobFormCore.scanDocument(document, profile);
    const items = raw.map((item) => {
      if (["confirm_required", "missing_profile_value", "unsupported"].includes(item.status)) highlight(item);
      const serialized = window.JobFormCore.serializeResult(item);
      serialized.value = window.JobFormCore.maskValue(item.key, item.value);
      return serialized;
    });
    return { items, summary: window.JobFormCore.summarize(raw), url: location.href, title: document.title };
  }

  function fill(profile, options = {}) {
    clearHighlights();
    const raw = window.JobFormCore.scanDocument(document, profile);
    lastSnapshot = [];

    for (const item of raw) {
      const permitted = item.status === "matched" || (item.status === "confirm_required" && options.includeConfirmed);
      if (!permitted) {
        highlight(item);
        continue;
      }
      if (!options.overwrite && item.currentValue) {
        item.status = "ignored";
        item.reason = "保留网页中已有内容";
        continue;
      }

      try {
        lastSnapshot.push(...window.JobFormCore.makeSnapshot(item.candidate));
        window.JobFormCore.fillCandidate(item.candidate, item.value);
        item.status = "filled";
        item.reason = "已填写";
      } catch (error) {
        item.status = "failed";
        item.reason = error instanceof Error ? error.message : "填写失败";
        highlight(item);
      }
    }

    const items = raw.map((item) => {
      const serialized = window.JobFormCore.serializeResult(item);
      serialized.value = window.JobFormCore.maskValue(item.key, item.value);
      return serialized;
    });
    return { items, summary: window.JobFormCore.summarize(raw), canUndo: lastSnapshot.length > 0 };
  }

  function undo() {
    if (!lastSnapshot.length) return { restored: 0 };
    const snapshot = lastSnapshot;
    lastSnapshot = [];
    window.JobFormCore.restoreSnapshot(snapshot);
    clearHighlights();
    return { restored: snapshot.length };
  }

  const style = document.createElement("style");
  style.dataset.jtInjected = "true";
  style.textContent = `
    [data-jt-status="confirm_required"] { outline: 2px solid #d98b2b !important; outline-offset: 2px !important; }
    [data-jt-status="missing_profile_value"] { outline: 2px dashed #8b6f47 !important; outline-offset: 2px !important; }
    [data-jt-status="failed"] { outline: 2px solid #c5463a !important; outline-offset: 2px !important; }
  `;
  document.documentElement.appendChild(style);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      if (message?.type === "JT_SCAN") sendResponse({ ok: true, data: scan(message.profile || {}) });
      else if (message?.type === "JT_FILL") sendResponse({ ok: true, data: fill(message.profile || {}, message.options || {}) });
      else if (message?.type === "JT_UNDO") sendResponse({ ok: true, data: undo() });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "页面处理失败" });
    }
    return true;
  });
})();
