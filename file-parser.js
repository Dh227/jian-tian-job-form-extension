(function initializeResumeFileParser(globalScope) {
  "use strict";

  const MAX_FILE_SIZE = 20 * 1024 * 1024;

  function extensionOf(fileName) {
    return String(fileName || "").split(".").pop().toLowerCase();
  }

  function joinPdfItems(items) {
    let lastY = null;
    let line = "";
    const lines = [];
    for (const item of items || []) {
      const y = Math.round(item.transform?.[5] || 0);
      if (lastY !== null && Math.abs(y - lastY) > 4) {
        if (line.trim()) lines.push(line.trim());
        line = "";
      }
      line += `${item.str || ""} `;
      lastY = y;
    }
    if (line.trim()) lines.push(line.trim());
    return lines.join("\n");
  }

  async function extractPdfText(arrayBuffer) {
    if (!globalScope.pdfjsLib) throw new Error("PDF 解析器未加载");
    if (globalScope.chrome?.runtime?.getURL) {
      globalScope.pdfjsLib.GlobalWorkerOptions.workerSrc = globalScope.chrome.runtime.getURL("vendor/pdfjs/pdf.worker.min.js");
    }
    const data = new Uint8Array(arrayBuffer);
    let pdf;
    try {
      pdf = await globalScope.pdfjsLib.getDocument({ data }).promise;
    } catch {
      pdf = await globalScope.pdfjsLib.getDocument({ data, disableWorker: true }).promise;
    }
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(joinPdfItems(content.items));
    }
    return pages.join("\n\n").replace(/\u0000/g, "").trim();
  }

  async function extractDocxText(arrayBuffer) {
    if (!globalScope.mammoth) throw new Error("Word 解析器未加载");
    const result = await globalScope.mammoth.extractRawText({ arrayBuffer });
    return String(result.value || "").trim();
  }

  async function parseResumeFile(file) {
    if (!(file instanceof Blob)) throw new Error("请选择有效的简历文件");
    if (file.size > MAX_FILE_SIZE) throw new Error("简历文件不能超过 20 MB");
    const extension = extensionOf(file.name);
    if (!new Set(["pdf", "docx"]).has(extension)) throw new Error("仅支持文本型 PDF 和 Word .docx 文件");
    let rawText;
    try {
      const buffer = await file.arrayBuffer();
      rawText = extension === "pdf" ? await extractPdfText(buffer) : await extractDocxText(buffer);
    } catch {
      throw new Error("简历文件解析失败，请确认文件未加密或损坏");
    }
    const parseIssues = [];
    if (!rawText.trim()) parseIssues.push("未提取到文本；扫描版 PDF 不支持 OCR，请在下方手工补充简历内容");
    const resume = globalScope.ResumeCore.parseResumeText(rawText);
    const summary = globalScope.ResumeCore.summarizeResume(resume);
    if (!resume.basic.name) parseIssues.push("未识别姓名");
    if (!resume.basic.phone && !resume.basic.email) parseIssues.push("未识别手机号或邮箱");
    return { rawText, resume, summary, parseIssues, extension };
  }

  const api = { parseResumeFile, extractPdfText, extractDocxText, joinPdfItems };
  globalScope.ResumeFileParser = api;
})(typeof window !== "undefined" ? window : globalThis);
