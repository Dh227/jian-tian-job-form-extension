"use strict";

const elements = {
  siteMark: document.querySelector("#siteMark"), siteName: document.querySelector("#siteName"), siteUrl: document.querySelector("#siteUrl"),
  supportBadge: document.querySelector("#supportBadge"), recognizedCount: document.querySelector("#recognizedCount"),
  confirmCount: document.querySelector("#confirmCount"), missingCount: document.querySelector("#missingCount"),
  unsupportedCount: document.querySelector("#unsupportedCount"), emptyProfile: document.querySelector("#emptyProfile"),
  previewSection: document.querySelector("#previewSection"), previewCount: document.querySelector("#previewCount"),
  previewList: document.querySelector("#previewList"), confirmSection: document.querySelector("#confirmSection"),
  includeConfirmed: document.querySelector("#includeConfirmed"), overwrite: document.querySelector("#overwrite"),
  fillButton: document.querySelector("#fillButton"), undoButton: document.querySelector("#undoButton"),
  resultMessage: document.querySelector("#resultMessage"), openOptions: document.querySelector("#openOptions"),
  createProfile: document.querySelector("#createProfile")
};

let activeTabId = null;
let profile = {};

function setResult(message, isError = false) {
  elements.resultMessage.textContent = message;
  elements.resultMessage.classList.toggle("error", isError);
}

function profileIsReady(data) {
  return Boolean(data.fullName && (data.phone || data.email));
}

function setSupportBadge(level) {
  elements.supportBadge.textContent = level;
  elements.supportBadge.className = "support-badge";
  if (level === "完全支持") elements.supportBadge.classList.add("good");
  else if (level === "部分支持") elements.supportBadge.classList.add("partial");
  else elements.supportBadge.classList.add("neutral");
}

function renderScan(data) {
  const { counts } = data.summary;
  elements.recognizedCount.textContent = counts.matched || 0;
  elements.confirmCount.textContent = counts.confirm_required || 0;
  elements.missingCount.textContent = counts.missing_profile_value || 0;
  elements.unsupportedCount.textContent = counts.unsupported || 0;
  setSupportBadge(data.summary.supportLevel);

  const previewItems = data.items.filter((item) => ["matched", "confirm_required"].includes(item.status));
  elements.previewList.replaceChildren(...previewItems.map((item) => {
    const row = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = item.fieldLabel;
    if (item.status === "confirm_required") label.classList.add("warning");
    const value = document.createElement("strong");
    value.textContent = item.value || "—";
    row.append(label, value);
    return row;
  }));
  elements.previewCount.textContent = `${previewItems.length} 项`;
  elements.previewSection.classList.toggle("hidden", previewItems.length === 0);
  elements.confirmSection.classList.toggle("hidden", !counts.confirm_required);
  elements.fillButton.disabled = !profileIsReady(profile) || previewItems.length === 0;
}

async function ensureContentScript() {
  await chrome.scripting.executeScript({ target: { tabId: activeTabId }, files: ["core.js", "content.js"] });
}

async function sendToPage(message) {
  const response = await chrome.tabs.sendMessage(activeTabId, message);
  if (!response?.ok) throw new Error(response?.error || "无法读取当前页面");
  return response.data;
}

async function scanPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/i.test(tab.url || "")) throw new Error("当前页面不允许插件读取，请打开企业网申网页");
    activeTabId = tab.id;
    const url = new URL(tab.url);
    elements.siteMark.textContent = url.hostname.replace(/^www\./, "").slice(0, 1).toUpperCase();
    elements.siteName.textContent = tab.title || url.hostname;
    elements.siteUrl.textContent = url.hostname;
    await ensureContentScript();
    renderScan(await sendToPage({ type: "JT_SCAN", profile }));
  } catch (error) {
    setSupportBadge("不可读取");
    elements.siteName.textContent = "请打开网申表单";
    elements.siteUrl.textContent = "浏览器设置页和扩展页无法填写";
    elements.fillButton.disabled = true;
    setResult(error.message, true);
  }
}

async function fillPage() {
  elements.fillButton.disabled = true;
  setResult("正在填写…");
  try {
    const result = await sendToPage({
      type: "JT_FILL",
      profile,
      options: { includeConfirmed: elements.includeConfirmed.checked, overwrite: elements.overwrite.checked }
    });
    renderScan(result);
    const filled = result.summary.counts.filled || 0;
    const failed = result.summary.counts.failed || 0;
    setResult(failed ? `已填写 ${filled} 项，${failed} 项需要手动处理` : `已填写 ${filled} 项。请检查页面后手动提交。`, failed > 0);
    elements.undoButton.classList.toggle("hidden", !result.canUndo);
  } catch (error) {
    setResult(error.message, true);
  } finally {
    elements.fillButton.disabled = false;
  }
}

async function undoFill() {
  try {
    const result = await sendToPage({ type: "JT_UNDO" });
    elements.undoButton.classList.add("hidden");
    setResult(result.restored ? `已恢复 ${result.restored} 个控件` : "没有可撤销的填写");
    await scanPage();
  } catch (error) {
    setResult(error.message, true);
  }
}

function openOptions() {
  chrome.runtime.openOptionsPage();
}

elements.fillButton.addEventListener("click", fillPage);
elements.undoButton.addEventListener("click", undoFill);
elements.openOptions.addEventListener("click", openOptions);
elements.createProfile.addEventListener("click", openOptions);

(async function initialize() {
  const stored = await chrome.storage.local.get(["profile"]);
  profile = stored.profile || {};
  elements.emptyProfile.classList.toggle("hidden", profileIsReady(profile));
  await scanPage();
})();
