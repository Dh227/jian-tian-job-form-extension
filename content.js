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

  function collectJsonLd() {
    const values = [];
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        values.push(JSON.parse(script.textContent || ""));
      } catch {
        // Invalid third-party structured data should not block the editable fallback.
      }
    }
    return values;
  }

  function metaContent(...names) {
    for (const name of names) {
      const escaped = window.CSS?.escape ? window.CSS.escape(name) : name.replace(/["\\]/g, "\\$&");
      const node = document.querySelector(`meta[property="${escaped}"], meta[name="${escaped}"]`);
      if (node?.content) return node.content.trim();
    }
    return "";
  }

  function collectMainText() {
    const candidate = document.querySelector([
      'main',
      '[role="main"]',
      'article',
      '[class*="job-detail" i]',
      '[class*="job_detail" i]',
      '[class*="position-detail" i]',
      '[class*="job-description" i]'
    ].join(", ")) || document.body;
    if (!candidate) return "";
    const clone = candidate.cloneNode(true);
    clone.querySelectorAll("script, style, nav, footer, header, noscript, svg, canvas, form, button").forEach((node) => node.remove());
    return String(clone.innerText || clone.textContent || "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 30000);
  }

  function extractJob() {
    if (!window.JobCore) throw new Error("岗位识别模块未加载");
    const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
      .filter((node) => node.getClientRects().length > 0)
      .map((node) => (node.innerText || node.textContent || "").trim())
      .filter(Boolean)
      .slice(0, 20);
    const snapshot = {
      url: location.href,
      pageTitle: document.title,
      jsonLd: collectJsonLd(),
      headings,
      mainText: collectMainText(),
      meta: {
        title: metaContent("og:title", "twitter:title"),
        description: metaContent("description", "og:description", "twitter:description"),
        siteName: metaContent("og:site_name", "application-name"),
        company: metaContent("hiringOrganization", "company")
      }
    };
    return window.JobCore.extractJobData(snapshot);
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
      else if (message?.type === "JT_EXTRACT_JOB") sendResponse({ ok: true, data: extractJob() });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "页面处理失败" });
    }
    return true;
  });
})();
