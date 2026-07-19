"use strict";

const form = document.querySelector("#profileForm");
const saveStatus = document.querySelector("#saveStatus");
const clearButton = document.querySelector("#clearButton");

function showStatus(message, isError = false) {
  saveStatus.textContent = message;
  saveStatus.classList.toggle("error", isError);
}

function readForm() {
  const data = Object.fromEntries(new FormData(form).entries());
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value).trim()]));
}

function populateForm(profile) {
  for (const [key, value] of Object.entries(profile || {})) {
    const control = form.elements.namedItem(key);
    if (control && typeof value === "string") control.value = value;
  }
}

function validateProfile(profile) {
  form.querySelectorAll(".invalid").forEach((element) => element.classList.remove("invalid"));
  const errors = [];
  if (!profile.fullName) errors.push(["fullName", "请填写中文姓名"]);
  if (!profile.phone && !profile.email) errors.push(["phone", "手机号和邮箱至少填写一项"]);
  if (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) errors.push(["email", "邮箱格式不正确"]);
  if (profile.phone && !/^[+\d][\d\s-]{5,20}$/.test(profile.phone)) errors.push(["phone", "手机号格式不正确"]);
  for (const [name] of errors) form.elements.namedItem(name)?.classList.add("invalid");
  return errors;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const profile = readForm();
  const errors = validateProfile(profile);
  if (errors.length) {
    showStatus(errors[0][1], true);
    form.elements.namedItem(errors[0][0])?.focus();
    return;
  }
  await chrome.storage.local.set({ profile, onboardingComplete: true, profileUpdatedAt: new Date().toISOString() });
  showStatus("资料已保存在当前浏览器");
});

clearButton.addEventListener("click", async () => {
  if (!confirm("确定清除当前浏览器中的全部个人资料吗？此操作无法撤销。")) return;
  await chrome.storage.local.remove(["profile", "onboardingComplete", "profileUpdatedAt"]);
  form.reset();
  showStatus("本机资料已清除");
});

(async function initialize() {
  const stored = await chrome.storage.local.get(["profile", "profileUpdatedAt"]);
  populateForm(stored.profile || {});
  if (stored.profileUpdatedAt) {
    const time = new Date(stored.profileUpdatedAt).toLocaleString("zh-CN", { hour12: false });
    showStatus(`上次保存：${time}`);
  }
})();
