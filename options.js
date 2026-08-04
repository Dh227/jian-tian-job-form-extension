"use strict";

const form = document.querySelector("#profileForm");
const saveStatus = document.querySelector("#saveStatus");
const clearButton = document.querySelector("#clearButton");

const resumeElements = {
  fileInput: document.querySelector("#resumeImportFile"),
  importButton: document.querySelector("#importResumeButton"),
  empty: document.querySelector("#resumeEmpty"),
  current: document.querySelector("#resumeCurrent"),
  fileName: document.querySelector("#resumeFileName"),
  meta: document.querySelector("#resumeMeta"),
  downloadButton: document.querySelector("#downloadResumeButton"),
  editButton: document.querySelector("#editResumeButton"),
  deleteButton: document.querySelector("#deleteResumeButton"),
  panel: document.querySelector("#resumeImportPanel"),
  summary: document.querySelector("#resumeImportSummary"),
  issues: document.querySelector("#resumeIssueList"),
  candidates: document.querySelector("#profileCandidateList"),
  structure: document.querySelector("#resumeStructurePreview"),
  rawText: document.querySelector("#resumeRawText"),
  cancelButton: document.querySelector("#cancelResumeImportButton"),
  reanalyzeButton: document.querySelector("#reanalyzeResumeButton"),
  applyButton: document.querySelector("#applyResumeButton"),
  status: document.querySelector("#resumeStatus")
};

const jobElements = {
  list: document.querySelector("#jobList"),
  empty: document.querySelector("#jobEmpty"),
  status: document.querySelector("#jobStatus"),
  createButton: document.querySelector("#createJobButton"),
  dialog: document.querySelector("#jobDialog"),
  form: document.querySelector("#jobForm"),
  closeButton: document.querySelector("#closeJobButton"),
  cancelButton: document.querySelector("#cancelJobButton"),
  deleteButton: document.querySelector("#deleteJobButton"),
  screenshotInput: document.querySelector("#jobScreenshotFile"),
  screenshotList: document.querySelector("#jobScreenshotList"),
  workspacePath: document.querySelector("#workspacePath"),
  generatePromptButton: document.querySelector("#generatePromptButton"),
  copyPromptButton: document.querySelector("#copyPromptButton"),
  promptPreview: document.querySelector("#promptPreview"),
  dialogStatus: document.querySelector("#jobDialogStatus")
};

const state = {
  profile: {},
  resumeMaster: null,
  pendingResumeFile: null,
  pendingResume: null,
  jobs: [],
  currentJob: null,
  currentDraftKey: "",
  screenshotEntries: [],
  removedScreenshotIds: new Set(),
  objectUrls: [],
  promptPackage: null
};

function setStatus(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle("error", isError);
}

function readProfileForm() {
  const data = Object.fromEntries(new FormData(form).entries());
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value).trim()]));
}

function populateProfileForm(profile) {
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
  const profile = readProfileForm();
  const errors = validateProfile(profile);
  if (errors.length) {
    setStatus(saveStatus, errors[0][1], true);
    form.elements.namedItem(errors[0][0])?.focus();
    return;
  }
  state.profile = profile;
  await chrome.storage.local.set({ profile, onboardingComplete: true, profileUpdatedAt: new Date().toISOString() });
  setStatus(saveStatus, "基本资料已保存在当前浏览器");
});

clearButton.addEventListener("click", async () => {
  if (!confirm("确定清除基本资料、母版简历、岗位档案和截图吗？此操作无法撤销。")) return;
  try {
    await JobStorage.clearAll();
    await chrome.storage.local.remove(["profile", "onboardingComplete", "profileUpdatedAt", "codexWorkspacePath"]);
    state.profile = {};
    state.resumeMaster = null;
    state.jobs = [];
    form.reset();
    renderResumeCurrent();
    renderJobs();
    setStatus(saveStatus, "全部本机资料已清除");
  } catch (error) {
    setStatus(saveStatus, error.message || "清除失败", true);
  }
});

function candidateMarkup(candidate) {
  const checked = candidate.defaultSelected ? "checked" : "";
  const disabled = candidate.value ? "" : "disabled";
  const oldValue = candidate.conflict ? `<del>${escapeHtml(candidate.existing)}</del>` : "";
  return `
    <label class="candidate-item ${candidate.status}">
      <input type="checkbox" value="${escapeHtml(candidate.key)}" ${checked} ${disabled}>
      <strong>${escapeHtml(candidate.label)}</strong>
      <span class="candidate-values">${oldValue}<span>${escapeHtml(candidate.value || "未识别")}</span></span>
    </label>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderResumeImport() {
  const pending = state.pendingResume;
  if (!pending) {
    resumeElements.panel.classList.add("hidden");
    return;
  }
  const summary = ResumeCore.summarizeResume(pending.resume);
  resumeElements.summary.textContent = `${pending.fileName || "已保存母版"} · 能力 ${summary.skills} · 教育 ${summary.education} · 实习/工作 ${summary.internships} · 项目 ${summary.projects}`;
  resumeElements.issues.replaceChildren(...(pending.parseIssues || []).map((issue) => {
    const item = document.createElement("li");
    item.textContent = issue;
    return item;
  }));
  const candidates = ResumeCore.buildProfileCandidates(pending.resume, state.profile);
  resumeElements.candidates.innerHTML = candidates.map(candidateMarkup).join("");
  renderResumeStructure(pending.resume);
  resumeElements.rawText.value = pending.rawText || "";
  resumeElements.panel.classList.remove("hidden");
  resumeElements.panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderResumeStructure(resume) {
  const itemLines = (items) => (items || []).map((item) => [item.title, item.subtitle, item.period].filter(Boolean).join(" · ") || "未命名条目");
  const sections = [
    ["求职摘要", resume.summary ? [resume.summary] : []],
    ["核心能力", (resume.skills || []).map((item) => `${item.label}：${item.value}`)],
    ["教育经历", itemLines(resume.education)],
    ["实习 / 工作经历", itemLines(resume.internships)],
    ["项目经历", itemLines(resume.projects)],
    ["校园经历", itemLines(resume.campus)],
    ["证书", resume.certificates || []],
    ["待整理文本", resume.unassignedText ? [resume.unassignedText] : []]
  ];
  resumeElements.structure.replaceChildren(...sections.map(([title, lines]) => {
    const block = document.createElement("section");
    block.className = `structure-block${lines.length ? "" : " empty"}`;
    const heading = document.createElement("h4");
    heading.textContent = `${title} · ${lines.length}`;
    const list = document.createElement("ul");
    for (const line of lines) {
      const item = document.createElement("li");
      item.textContent = line;
      list.append(item);
    }
    if (!lines.length) {
      const item = document.createElement("li");
      item.textContent = "未识别";
      list.append(item);
    }
    block.append(heading, list);
    return block;
  }));
}

function renderResumeCurrent() {
  const master = state.resumeMaster;
  resumeElements.empty.classList.toggle("hidden", Boolean(master));
  resumeElements.current.classList.toggle("hidden", !master);
  if (!master) return;
  const summary = ResumeCore.summarizeResume(master.resume);
  resumeElements.fileName.textContent = master.fileName || "母版简历";
  const date = master.importedAt ? new Date(master.importedAt).toLocaleString("zh-CN", { hour12: false }) : "";
  resumeElements.meta.textContent = `${date} · 教育 ${summary.education} · 实习/工作 ${summary.internships} · 项目 ${summary.projects}`;
}

async function beginResumeImport(file) {
  state.pendingResumeFile = file;
  setStatus(resumeElements.status, "正在本地解析简历…");
  try {
    const parsed = await ResumeFileParser.parseResumeFile(file);
    state.pendingResume = { ...parsed, fileName: file.name, mimeType: file.type };
    renderResumeImport();
    setStatus(resumeElements.status, parsed.parseIssues.length ? "已完成识别，请补充或确认提示项" : "识别完成，请确认后保存");
  } catch (error) {
    state.pendingResume = null;
    renderResumeImport();
    setStatus(resumeElements.status, error.message || "简历解析失败", true);
  } finally {
    resumeElements.fileInput.value = "";
  }
}

resumeElements.importButton.addEventListener("click", () => resumeElements.fileInput.click());
resumeElements.fileInput.addEventListener("change", () => {
  const file = resumeElements.fileInput.files?.[0];
  if (file) beginResumeImport(file);
});

resumeElements.reanalyzeButton.addEventListener("click", () => {
  if (!state.pendingResume) return;
  const rawText = resumeElements.rawText.value.trim();
  const resume = ResumeCore.parseResumeText(rawText);
  const parseIssues = [];
  if (!rawText) parseIssues.push("尚未填写可识别的简历文本");
  if (!resume.basic.name) parseIssues.push("未识别姓名");
  if (!resume.basic.phone && !resume.basic.email) parseIssues.push("未识别手机号或邮箱");
  state.pendingResume = { ...state.pendingResume, rawText, resume, parseIssues };
  renderResumeImport();
  setStatus(resumeElements.status, "已根据修正后的文本重新识别");
});

resumeElements.cancelButton.addEventListener("click", () => {
  state.pendingResume = null;
  state.pendingResumeFile = null;
  renderResumeImport();
  setStatus(resumeElements.status, "已取消本次导入");
});

resumeElements.applyButton.addEventListener("click", async () => {
  if (!state.pendingResume) return;
  const rawText = resumeElements.rawText.value.trim();
  const resume = ResumeCore.parseResumeText(rawText);
  const candidates = ResumeCore.buildProfileCandidates(resume, state.profile);
  const selectedKeys = Array.from(resumeElements.candidates.querySelectorAll('input[type="checkbox"]:checked')).map((input) => input.value);
  const nextProfile = ResumeCore.applyProfileCandidates(state.profile, candidates, selectedKeys);
  const record = {
    fileName: state.pendingResume.fileName || state.resumeMaster?.fileName || "母版简历",
    mimeType: state.pendingResume.mimeType || state.resumeMaster?.mimeType || "application/octet-stream",
    rawText,
    resume,
    parseIssues: state.pendingResume.parseIssues || [],
    fieldMetadata: candidates.map(({ key, label, value, confidence, source, status }) => ({ key, label, value, confidence, source, status }))
  };
  try {
    state.resumeMaster = await JobStorage.saveResumeMaster(record, state.pendingResumeFile);
    state.profile = nextProfile;
    populateProfileForm(nextProfile);
    await chrome.storage.local.set({ profile: nextProfile, onboardingComplete: true, profileUpdatedAt: new Date().toISOString() });
    state.pendingResume = null;
    state.pendingResumeFile = null;
    renderResumeImport();
    renderResumeCurrent();
    setStatus(resumeElements.status, `母版已保存，并同步 ${selectedKeys.length} 项基本资料`);
  } catch (error) {
    setStatus(resumeElements.status, error.message || "保存母版失败", true);
  }
});

resumeElements.downloadButton.addEventListener("click", async () => {
  try {
    const fileName = await JobStorage.downloadAsset(state.resumeMaster?.fileAssetId);
    setStatus(resumeElements.status, `已下载 ${fileName}`);
  } catch (error) {
    setStatus(resumeElements.status, error.message, true);
  }
});

resumeElements.editButton.addEventListener("click", () => {
  if (!state.resumeMaster) return;
  state.pendingResumeFile = null;
  state.pendingResume = { ...state.resumeMaster };
  renderResumeImport();
});

resumeElements.deleteButton.addEventListener("click", async () => {
  if (!confirm("确定删除母版简历和原始文件吗？基本资料与岗位档案会保留。")) return;
  try {
    await JobStorage.deleteResumeMaster();
    state.resumeMaster = null;
    state.pendingResume = null;
    renderResumeImport();
    renderResumeCurrent();
    setStatus(resumeElements.status, "母版简历已删除");
  } catch (error) {
    setStatus(resumeElements.status, error.message || "删除失败", true);
  }
});

function readJobForm() {
  const values = Object.fromEntries(new FormData(jobElements.form).entries());
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value).trim()]));
}

function populateJobForm(job) {
  jobElements.form.reset();
  for (const [key, value] of Object.entries(job || {})) {
    const control = jobElements.form.elements.namedItem(key);
    if (control && typeof value === "string") control.value = value;
  }
  if (!job?.status) jobElements.form.elements.namedItem("status").value = "准备投递";
}

function releaseObjectUrls() {
  for (const url of state.objectUrls) URL.revokeObjectURL(url);
  state.objectUrls = [];
}

async function loadScreenshotEntries(job) {
  releaseObjectUrls();
  const entries = [];
  for (const id of job?.screenshotAssetIds || []) {
    const asset = await JobStorage.getAsset(id);
    if (asset) entries.push({ id: asset.id, fileName: asset.fileName, blob: asset.blob, existing: true });
  }
  return entries;
}

function renderScreenshots() {
  releaseObjectUrls();
  jobElements.screenshotList.replaceChildren(...state.screenshotEntries.map((entry, index) => {
    const card = document.createElement("div");
    card.className = "screenshot-item";
    const image = document.createElement("img");
    const url = URL.createObjectURL(entry.blob);
    state.objectUrls.push(url);
    image.src = url;
    image.alt = entry.fileName;
    const footer = document.createElement("div");
    const name = document.createElement("span");
    name.textContent = entry.fileName;
    const actions = document.createElement("span");
    const download = document.createElement("button");
    download.type = "button";
    download.textContent = "下载";
    download.addEventListener("click", async () => {
      if (entry.id) await JobStorage.downloadAsset(entry.id);
      else {
        const temp = URL.createObjectURL(entry.blob);
        const anchor = document.createElement("a");
        anchor.href = temp;
        anchor.download = entry.fileName;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(temp), 1000);
      }
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "移除";
    remove.addEventListener("click", () => {
      if (entry.id) state.removedScreenshotIds.add(entry.id);
      state.screenshotEntries.splice(index, 1);
      renderScreenshots();
      jobElements.promptPreview.value = "";
      jobElements.copyPromptButton.disabled = true;
    });
    actions.append(download, remove);
    footer.append(name, actions);
    card.append(image, footer);
    return card;
  }));
}

async function openJob(job = null, pendingEntries = [], draftKey = "") {
  state.currentJob = job;
  state.currentDraftKey = draftKey;
  state.promptPackage = null;
  state.removedScreenshotIds = new Set();
  state.screenshotEntries = [...await loadScreenshotEntries(job), ...pendingEntries];
  populateJobForm(job || {});
  renderScreenshots();
  jobElements.deleteButton.classList.toggle("hidden", !job?.id);
  jobElements.promptPreview.value = "";
  jobElements.copyPromptButton.disabled = true;
  setStatus(jobElements.dialogStatus, "");
  jobElements.dialog.showModal();
}

function closeJob() {
  if (state.currentDraftKey) chrome.storage.session.remove(state.currentDraftKey).catch(() => {});
  releaseObjectUrls();
  state.currentJob = null;
  state.currentDraftKey = "";
  state.screenshotEntries = [];
  state.removedScreenshotIds = new Set();
  jobElements.dialog.close();
}

function renderJobs() {
  jobElements.empty.classList.toggle("hidden", state.jobs.length > 0);
  jobElements.list.replaceChildren(...state.jobs.map((job) => {
    const card = document.createElement("article");
    card.className = "job-card";
    const copy = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = `${job.company || "待补充公司"} · ${job.title || "待补充岗位"}`;
    const details = document.createElement("p");
    const stage = document.createElement("span");
    stage.className = "job-stage";
    stage.textContent = job.status || "准备投递";
    details.append(stage, document.createTextNode([job.location, job.salary, job.sourcePlatform].filter(Boolean).join(" · ") || "资料待补充"));
    copy.append(title, details);
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "查看 / 生成提示词";
    edit.addEventListener("click", () => openJob(job));
    card.append(copy, edit);
    return card;
  }));
}

jobElements.createButton.addEventListener("click", () => openJob());
jobElements.closeButton.addEventListener("click", closeJob);
jobElements.cancelButton.addEventListener("click", closeJob);

jobElements.screenshotInput.addEventListener("change", () => {
  const remaining = Math.max(0, 5 - state.screenshotEntries.length);
  const files = Array.from(jobElements.screenshotInput.files || []).slice(0, remaining);
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    if (file.size > 5 * 1024 * 1024) {
      setStatus(jobElements.dialogStatus, `${file.name} 超过 5 MB，未添加`, true);
      continue;
    }
    state.screenshotEntries.push({ fileName: file.name, blob: file, existing: false });
  }
  jobElements.screenshotInput.value = "";
  renderScreenshots();
});

async function persistJobFromDialog() {
  const values = readJobForm();
  if (!values.company || !values.title) throw new Error("请填写公司和岗位名称");
  const existingEntries = state.screenshotEntries.filter((entry) => entry.id);
  const newEntries = state.screenshotEntries.filter((entry) => !entry.id);
  const storedNewEntries = [];
  let record;
  let allEntries;
  try {
    for (const entry of newEntries) {
      storedNewEntries.push(await JobStorage.saveAsset(entry.blob, { kind: "job_screenshot", fileName: entry.fileName }));
    }
    allEntries = [...existingEntries, ...storedNewEntries.map((asset) => ({ id: asset.id, fileName: asset.fileName, blob: asset.blob, existing: true }))];
    record = await JobStorage.saveJob({
      ...state.currentJob,
      ...values,
      screenshotAssetIds: allEntries.map((entry) => entry.id),
      screenshotFileNames: allEntries.map((entry) => entry.fileName),
      extractionSource: state.currentJob?.extractionSource || "manual"
    });
  } catch (error) {
    await Promise.allSettled(storedNewEntries.map((asset) => JobStorage.deleteAsset(asset.id)));
    throw error;
  }
  for (const assetId of state.removedScreenshotIds) await JobStorage.deleteAsset(assetId);
  state.currentJob = record;
  state.screenshotEntries = allEntries;
  state.removedScreenshotIds = new Set();
  state.jobs = await JobStorage.getJobs();
  renderJobs();
  return record;
}

jobElements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const record = await persistJobFromDialog();
    setStatus(jobElements.status, `${record.company} · ${record.title} 已保存`);
    closeJob();
  } catch (error) {
    setStatus(jobElements.dialogStatus, error.message || "岗位保存失败", true);
  }
});

jobElements.deleteButton.addEventListener("click", async () => {
  if (!state.currentJob?.id || !confirm("确定删除这个岗位档案和全部截图吗？")) return;
  try {
    await JobStorage.deleteJob(state.currentJob.id);
    state.jobs = await JobStorage.getJobs();
    renderJobs();
    setStatus(jobElements.status, "岗位档案已删除");
    closeJob();
  } catch (error) {
    setStatus(jobElements.dialogStatus, error.message || "删除失败", true);
  }
});

jobElements.generatePromptButton.addEventListener("click", async () => {
  try {
    const values = readJobForm();
    const job = {
      ...state.currentJob,
      ...values,
      screenshotAssetIds: state.screenshotEntries.map((entry) => entry.id || "pending"),
      screenshotFileNames: state.screenshotEntries.map((entry) => entry.fileName)
    };
    const workspacePath = jobElements.workspacePath.value.trim() || "~/Documents/简历修改";
    state.promptPackage = JobCore.buildPromptPackage({ resumeMaster: state.resumeMaster, job, workspacePath });
    jobElements.promptPreview.value = state.promptPackage.prompt;
    jobElements.copyPromptButton.disabled = false;
    await chrome.storage.local.set({ codexWorkspacePath: workspacePath });
    setStatus(jobElements.dialogStatus, "提示词已生成；复制后请同时附上母版和截图");
  } catch (error) {
    state.promptPackage = null;
    jobElements.copyPromptButton.disabled = true;
    setStatus(jobElements.dialogStatus, error.message || "提示词生成失败", true);
  }
});

jobElements.copyPromptButton.addEventListener("click", async () => {
  if (!state.promptPackage?.prompt) return;
  let copied = false;
  try {
    await navigator.clipboard.writeText(state.promptPackage.prompt);
    copied = true;
  } catch {
    jobElements.promptPreview.select();
    copied = document.execCommand("copy");
  }
  if (!copied) {
    setStatus(jobElements.dialogStatus, "浏览器未允许复制，请手动复制文本框内容", true);
    return;
  }
  setStatus(jobElements.dialogStatus, "提示词已复制。发送给 Codex 时请附上列出的文件。 ");
});

async function initialize() {
  try {
    const stored = await chrome.storage.local.get(["profile", "profileUpdatedAt", "codexWorkspacePath"]);
    state.profile = stored.profile || {};
    populateProfileForm(state.profile);
    if (stored.profileUpdatedAt) {
      const time = new Date(stored.profileUpdatedAt).toLocaleString("zh-CN", { hour12: false });
      setStatus(saveStatus, `上次保存：${time}`);
    }
    jobElements.workspacePath.value = stored.codexWorkspacePath || "~/Documents/简历修改";
    [state.resumeMaster, state.jobs] = await Promise.all([JobStorage.getResumeMaster(), JobStorage.getJobs()]);
    renderResumeCurrent();
    renderJobs();

    const jobId = location.hash.startsWith("#job=") ? decodeURIComponent(location.hash.slice(5)) : "";
    if (jobId) {
      const job = state.jobs.find((item) => item.id === jobId);
      if (job) await openJob(job);
    }
    const draftToken = location.hash.startsWith("#draft=") ? decodeURIComponent(location.hash.slice(7)) : "";
    if (draftToken) {
      const draftKey = `jobDraft:${draftToken}`;
      const draftResult = await chrome.storage.session.get(draftKey);
      const draft = draftResult[draftKey];
      if (draft?.job) {
        const pendingEntries = draft.screenshot?.dataUrl
          ? [{ fileName: draft.screenshot.fileName, blob: JobStorage.dataUrlToBlob(draft.screenshot.dataUrl), existing: false }]
          : [];
        await openJob(draft.job, pendingEntries, draftKey);
      } else {
        setStatus(jobElements.status, "岗位草稿已过期，请回到岗位页重新保存", true);
      }
    }
  } catch (error) {
    setStatus(saveStatus, `本地资料库初始化失败：${error.message}`, true);
  }
}

initialize();
