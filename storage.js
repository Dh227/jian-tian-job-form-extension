(function initializeJobStorage(globalScope) {
  "use strict";

  const DB_NAME = "jian-tian-v2";
  const DB_VERSION = 1;
  const MASTER_ID = "master";

  function makeId(prefix) {
    const token = globalScope.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix}-${token}`;
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("本地数据库操作失败"));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("本地数据库事务失败"));
      transaction.onabort = () => reject(transaction.error || new Error("本地数据库事务已取消"));
    });
  }

  let databasePromise = null;

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = globalScope.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("assets")) {
          const assets = database.createObjectStore("assets", { keyPath: "id" });
          assets.createIndex("kind", "kind", { unique: false });
        }
        if (!database.objectStoreNames.contains("resumeMasters")) database.createObjectStore("resumeMasters", { keyPath: "id" });
        if (!database.objectStoreNames.contains("jobRecords")) {
          const jobs = database.createObjectStore("jobRecords", { keyPath: "id" });
          jobs.createIndex("updatedAt", "updatedAt", { unique: false });
          jobs.createIndex("status", "status", { unique: false });
        }
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => {
        databasePromise = null;
        reject(request.error || new Error("无法打开本地资料库"));
      };
    });
    return databasePromise;
  }

  async function get(storeName, key) {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readonly");
    return requestResult(transaction.objectStore(storeName).get(key));
  }

  async function getAll(storeName) {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readonly");
    return requestResult(transaction.objectStore(storeName).getAll());
  }

  async function put(storeName, value) {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);
    await transactionDone(transaction);
    return value;
  }

  async function remove(storeName, key) {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(key);
    await transactionDone(transaction);
  }

  function dataUrlToBlob(dataUrl) {
    const [header, encoded] = String(dataUrl || "").split(",", 2);
    if (!header || !encoded) throw new Error("截图数据无效");
    const mimeType = header.match(/^data:([^;]+)/)?.[1] || "image/png";
    const bytes = atob(encoded);
    const output = new Uint8Array(bytes.length);
    for (let index = 0; index < bytes.length; index += 1) output[index] = bytes.charCodeAt(index);
    return new Blob([output], { type: mimeType });
  }

  function buildAssetRecord(blob, metadata = {}) {
    if (!(blob instanceof Blob)) throw new Error("要保存的附件无效");
    return {
      id: metadata.id || makeId("asset"),
      kind: metadata.kind || "attachment",
      fileName: metadata.fileName || "attachment.bin",
      mimeType: blob.type || metadata.mimeType || "application/octet-stream",
      size: blob.size,
      createdAt: metadata.createdAt || new Date().toISOString(),
      blob
    };
  }

  async function saveAsset(blob, metadata = {}) {
    const asset = buildAssetRecord(blob, metadata);
    return put("assets", asset);
  }

  async function saveDataUrlAsset(dataUrl, metadata = {}) {
    return saveAsset(dataUrlToBlob(dataUrl), metadata);
  }

  async function getAsset(id) {
    return id ? get("assets", id) : null;
  }

  function deleteAsset(id) {
    return id ? remove("assets", id) : Promise.resolve();
  }

  async function saveResumeMaster(master, file) {
    const previous = await getResumeMaster();
    let fileAssetId = previous?.fileAssetId || "";
    let newAsset = null;
    if (file) {
      newAsset = buildAssetRecord(file, { kind: "resume_master", fileName: file.name, mimeType: file.type });
      fileAssetId = newAsset.id;
    }
    const record = {
      ...master,
      id: MASTER_ID,
      fileAssetId,
      importedAt: master.importedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1
    };
    const database = await openDatabase();
    const transaction = database.transaction(["assets", "resumeMasters"], "readwrite");
    if (newAsset) transaction.objectStore("assets").put(newAsset);
    transaction.objectStore("resumeMasters").put(record);
    if (newAsset && previous?.fileAssetId && previous.fileAssetId !== fileAssetId) transaction.objectStore("assets").delete(previous.fileAssetId);
    await transactionDone(transaction);
    return record;
  }

  function getResumeMaster() {
    return get("resumeMasters", MASTER_ID);
  }

  async function deleteResumeMaster() {
    const current = await getResumeMaster();
    const database = await openDatabase();
    const transaction = database.transaction(["assets", "resumeMasters"], "readwrite");
    transaction.objectStore("resumeMasters").delete(MASTER_ID);
    if (current?.fileAssetId) transaction.objectStore("assets").delete(current.fileAssetId);
    await transactionDone(transaction);
  }

  async function saveJob(job) {
    const now = new Date().toISOString();
    const record = {
      ...job,
      id: job.id || makeId("job"),
      status: job.status || "准备投递",
      createdAt: job.createdAt || now,
      updatedAt: now,
      version: 1
    };
    return put("jobRecords", record);
  }

  function getJob(id) {
    return get("jobRecords", id);
  }

  async function getJobs() {
    const jobs = await getAll("jobRecords");
    return jobs.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  }

  async function deleteJob(id) {
    const job = await getJob(id);
    const database = await openDatabase();
    const transaction = database.transaction(["assets", "jobRecords"], "readwrite");
    transaction.objectStore("jobRecords").delete(id);
    for (const assetId of job?.screenshotAssetIds || []) transaction.objectStore("assets").delete(assetId);
    await transactionDone(transaction);
  }

  async function clearAll() {
    const database = await openDatabase();
    const transaction = database.transaction(["assets", "resumeMasters", "jobRecords"], "readwrite");
    transaction.objectStore("assets").clear();
    transaction.objectStore("resumeMasters").clear();
    transaction.objectStore("jobRecords").clear();
    await transactionDone(transaction);
  }

  async function downloadAsset(id) {
    const asset = await getAsset(id);
    if (!asset) throw new Error("找不到要下载的附件");
    const url = URL.createObjectURL(asset.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = asset.fileName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return asset.fileName;
  }

  const api = {
    openDatabase,
    dataUrlToBlob,
    saveAsset,
    saveDataUrlAsset,
    getAsset,
    deleteAsset,
    saveResumeMaster,
    getResumeMaster,
    deleteResumeMaster,
    saveJob,
    getJob,
    getJobs,
    deleteJob,
    clearAll,
    downloadAsset
  };
  globalScope.JobStorage = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
