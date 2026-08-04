(function initializeResumeCore(globalScope) {
  "use strict";

  const SECTION_PATTERNS = [
    ["summary", /^(求职摘要|个人摘要|自我评价|个人简介|职业概述)$/],
    ["skills", /^(核心能力|专业技能|技能特长|技能|能力)$/],
    ["education", /^(教育经历|教育背景|教育)$/],
    ["internships", /^(实习经历|实习经验|实践经历|实习\/工作经历|实习\/工作经验)$/],
    ["work", /^(工作经历|工作经验|职业经历)$/],
    ["projects", /^(项目经历|项目经验|项目)$/],
    ["campus", /^(校园经历|校园经历\/证书|校园实践|社团经历|学生工作)$/],
    ["certificates", /^(证书|荣誉证书|证书奖项|获奖证书)$/]
  ];

  const PROFILE_MAPPING = [
    ["fullName", "中文姓名", (resume) => resume.basic.name, 0.98],
    ["phone", "手机号", (resume) => resume.basic.phone, 0.98],
    ["email", "邮箱", (resume) => resume.basic.email, 0.98],
    ["targetRole", "应聘岗位", (resume) => resume.basic.target, 0.88],
    ["school", "学校", (resume) => resume.basic.school, 0.9],
    ["major", "专业", (resume) => resume.basic.major, 0.86],
    ["educationLevel", "学历", (resume) => resume.basic.degree, 0.9],
    ["graduationDate", "毕业时间", (resume) => normalizeMonth(resume.basic.graduation), 0.82]
  ];

  function cleanText(text) {
    return String(text || "")
      .replace(/\r/g, "\n")
      .replaceAll("⻥", "鱼")
      .replaceAll("⻓", "长")
      .replaceAll("⻋", "车")
      .replaceAll("⻔", "门")
      .replaceAll("⻅", "见")
      .replace(/[ \t]+/g, " ")
      .replace(/([\u2e80-\u9fff])[ \t]+(?=[\u2e80-\u9fff])/g, "$1")
      .replace(/[ \t]+([，。；：、！？）])/g, "$1")
      .replace(/[•●◆◇▪▫]/g, "-")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function splitLines(value) {
    return String(value || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  }

  function compactHeading(line) {
    return String(line || "").replace(/^#+\s*/, "").replace(/[\s：:]/g, "");
  }

  function sectionKey(line) {
    const compact = compactHeading(line);
    return SECTION_PATTERNS.find(([, pattern]) => pattern.test(compact))?.[0] || "";
  }

  function splitSections(lines) {
    const sections = { header: [] };
    let current = "header";
    for (const line of lines) {
      const found = sectionKey(line);
      if (found) {
        current = found;
        sections[current] ||= [];
      } else {
        sections[current] ||= [];
        sections[current].push(line);
      }
    }
    return sections;
  }

  function blankResume() {
    return {
      settings: { template: "classic", density: "normal", accent: "#0f4c81", showPhoto: false, smartOnePage: true, photo: "", language: "zh" },
      basic: { name: "", target: "", phone: "", email: "", school: "", degree: "", major: "", graduation: "" },
      summary: "",
      skills: [],
      education: [],
      internships: [],
      projects: [],
      campus: [],
      certificates: [],
      unassignedText: ""
    };
  }

  function detectName(lines) {
    return lines.slice(0, 8).find((line) => /^[\u4e00-\u9fa5]{2,5}$/.test(line) || /^[A-Za-z][A-Za-z\s]{2,30}$/.test(line)) || "";
  }

  function detectTarget(lines) {
    const explicit = lines.find((line) => /求职意向|意向岗位|目标岗位|应聘岗位/.test(line));
    if (explicit) return explicit.replace(/^.*?[：:]/, "").trim();
    return lines.find((line) => /(工程师|销售|运营|产品|设计|开发|分析师|实习生)/.test(line) && line.length <= 40) || "";
  }

  function detectEducationBasic(resume, lines) {
    const joined = lines.join(" ");
    resume.basic.degree = joined.match(/本科|硕士|博士|大专|专科/)?.[0] || "";
    const explicitGraduation = joined.match(/20\d{2}[.\-/年]\d{1,2}\s*(?:预计)?毕业/)?.[0] || "";
    const educationRangeEnd = joined.match(/(?:19|20)\d{2}[.\-/年]\d{1,2}\s*(?:-|–|—|至|~|－)\s*((?:19|20)\d{2}[.\-/年]\d{1,2}|至今|现在|Present)/i)?.[1] || "";
    resume.basic.graduation = explicitGraduation || educationRangeEnd;
    const schoolLine = lines.find((line) => /大学|学院|学校/.test(line)) || "";
    const parts = schoolLine.split(/[|｜]/).map((part) => part.trim()).filter(Boolean);
    resume.basic.school = parts.find((part) => /大学|学院|学校/.test(part)) || "";
    resume.basic.major = parts.find((part) =>
      !/大学|学院|学校|本科|硕士|博士|大专|专科|20\d{2}|GPA|排名/.test(part) &&
      /[\u4e00-\u9fa5]/.test(part) && part.length <= 24
    ) || "";
  }

  function parseSkills(lines) {
    return lines.map((raw) => raw.replace(/^[-\s]+/, "")).filter(Boolean).map((line) => {
      const [label, ...rest] = line.split(/[：:]/);
      return rest.length ? { label: label.trim(), value: rest.join("：").trim() } : { label: "能力", value: line };
    });
  }

  function newItem(line, fallbackTitle) {
    const parts = line.split(/[|｜]/).map((part) => part.trim()).filter(Boolean);
    return { title: parts[0] || fallbackTitle, subtitle: parts.slice(1).join(" | "), period: "", bullets: [] };
  }

  function parseItems(lines, fallbackTitle) {
    const timePattern = /(?:19|20)\d{2}[.\-/年]\d{1,2}\s*(?:-|–|—|至|~|－)\s*(?:(?:19|20)\d{2}[.\-/年]\d{1,2}|至今|现在|Present)/i;
    const items = [];
    let current = null;
    for (const raw of lines || []) {
      const isBullet = /^[-•●▪]/.test(raw);
      const line = raw.replace(/^[-•●▪\s]+/, "").trim();
      if (!line) continue;
      const period = line.match(timePattern)?.[0] || "";
      if (period && current && line.replace(period, "").trim() === "") {
        current.period = period;
        continue;
      }
      const looksLikeTitle = !isBullet && (/大学|学院|公司|集团|项目|协会|学生会|实验室|[|｜]/.test(line)) && line.length <= 90;
      if (!current || period || looksLikeTitle) {
        if (current) items.push(current);
        const titleLine = period ? line.replace(period, "").trim() : line;
        current = newItem(titleLine, fallbackTitle);
        current.period = period;
        continue;
      }
      if (isBullet || !current.bullets.length) current.bullets.push(line);
      else current.bullets[current.bullets.length - 1] += /[A-Za-z0-9]$/.test(current.bullets.at(-1)) ? ` ${line}` : line;
    }
    if (current) items.push(current);
    return items.filter((item) => item.title || item.period || item.bullets.length);
  }

  function parseCertificates(lines) {
    return splitLines((lines || []).join("\n"))
      .flatMap((line) => line.replace(/^证书[：:]?\s*/, "").split(/[、,，;；]/))
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function parseResumeText(input) {
    const text = cleanText(input);
    const lines = splitLines(text);
    const sections = splitSections(lines);
    const resume = blankResume();
    const header = sections.header || [];
    const allText = lines.join("\n");

    resume.basic.name = detectName(header.length ? header : lines);
    resume.basic.target = detectTarget([...(header || []), ...(sections.summary || [])]);
    resume.basic.phone = allText.match(/(?:\+?86[-\s]?)?1[3-9]\d{9}/)?.[0]?.replace(/\s/g, "") || "";
    resume.basic.email = allText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
    detectEducationBasic(resume, [...(sections.education || []), ...header]);
    resume.summary = (sections.summary || []).join("\n");
    resume.skills = parseSkills(sections.skills || []);
    resume.education = parseItems(sections.education || [], "教育经历");
    resume.internships = parseItems([...(sections.internships || []), ...(sections.work || [])], "实习 / 工作经历");
    resume.projects = parseItems(sections.projects || [], "项目经历");
    resume.campus = parseItems(sections.campus || [], "校园经历");
    resume.certificates = parseCertificates(sections.certificates || []);

    const assignedHeader = new Set([resume.basic.name, resume.basic.target, resume.basic.phone, resume.basic.email].filter(Boolean));
    resume.unassignedText = header
      .filter((line) => ![...assignedHeader].some((value) => line.includes(value)))
      .filter((line) => !/求职意向|意向岗位|目标岗位|应聘岗位/.test(line))
      .join("\n");
    return resume;
  }

  function normalizeMonth(value) {
    const match = String(value || "").match(/(20\d{2})[.\-/年](\d{1,2})/);
    return match ? `${match[1]}-${match[2].padStart(2, "0")}` : "";
  }

  function buildProfileCandidates(resume, currentProfile = {}) {
    return PROFILE_MAPPING.map(([key, label, getter, confidence]) => {
      const value = String(getter(resume) || "").trim();
      const existing = String(currentProfile[key] || "").trim();
      return {
        key,
        label,
        value,
        existing,
        confidence,
        source: "resume_import",
        conflict: Boolean(value && existing && value !== existing),
        defaultSelected: Boolean(value && !existing && confidence >= 0.9) || Boolean(value && existing === value && confidence >= 0.9),
        status: !value ? "missing" : existing && value !== existing ? "conflict" : "recognized"
      };
    });
  }

  function applyProfileCandidates(currentProfile, candidates, selectedKeys) {
    const next = { ...(currentProfile || {}) };
    const allowed = selectedKeys ? new Set(selectedKeys) : null;
    for (const candidate of candidates || []) {
      if (!candidate.value || (allowed && !allowed.has(candidate.key))) continue;
      if (!allowed && candidate.conflict) continue;
      next[candidate.key] = candidate.value;
    }
    return next;
  }

  function summarizeResume(resume) {
    return {
      name: resume?.basic?.name || "待补充",
      target: resume?.basic?.target || "待补充",
      contactReady: Boolean(resume?.basic?.phone || resume?.basic?.email),
      skills: resume?.skills?.length || 0,
      education: resume?.education?.length || 0,
      internships: resume?.internships?.length || 0,
      projects: resume?.projects?.length || 0,
      missing: buildProfileCandidates(resume || blankResume()).filter((item) => !item.value).map((item) => item.label)
    };
  }

  const api = { blankResume, cleanText, parseResumeText, buildProfileCandidates, applyProfileCandidates, summarizeResume };
  globalScope.ResumeCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
