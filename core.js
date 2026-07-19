(function initializeJobFormCore(globalScope) {
  "use strict";

  const PROFILE_FIELDS = {
    fullName: { label: "中文姓名", aliases: ["姓名", "中文名", "真实姓名", "full name", "fullname", "candidate name", "applicant name"] },
    englishName: { label: "英文姓名", aliases: ["英文姓名", "英文名", "english name", "name in english"] },
    gender: { label: "性别", aliases: ["性别", "gender", "sex"] },
    birthDate: { label: "出生日期", aliases: ["出生日期", "出生年月", "生日", "date of birth", "birth date", "birthday", "dob"] },
    ethnicity: { label: "民族", aliases: ["民族", "ethnicity", "ethnic group"] },
    nationality: { label: "国籍", aliases: ["国籍", "nationality", "citizenship"] },
    phone: { label: "手机号", aliases: ["手机号码", "手机号", "联系电话", "移动电话", "手机", "phone number", "mobile number", "mobile", "telephone", "phone"] },
    email: { label: "邮箱", aliases: ["电子邮箱", "邮箱地址", "联系邮箱", "email address", "e-mail", "email"] },
    wechat: { label: "微信号", aliases: ["微信号", "微信", "wechat id", "wechat"] },
    currentCity: { label: "现居城市", aliases: ["现居城市", "当前城市", "所在地", "现居地", "居住城市", "current city", "city of residence", "location"] },
    address: { label: "通讯地址", aliases: ["通讯地址", "联系地址", "现住址", "详细地址", "邮寄地址", "mailing address", "contact address", "address"] },
    targetRole: { label: "应聘岗位", aliases: ["应聘岗位", "目标岗位", "求职岗位", "申请职位", "应聘职位", "target role", "position applied", "desired position"] },
    preferredCity: { label: "期望城市", aliases: ["期望城市", "意向城市", "工作地点", "期望工作地", "preferred city", "desired location", "preferred location"] },
    jobType: { label: "岗位类型", aliases: ["岗位类型", "求职类型", "工作性质", "职位类型", "employment type", "job type"] },
    availableDate: { label: "到岗日期", aliases: ["到岗日期", "可到岗时间", "最快到岗", "入职时间", "available date", "start date", "date available"] },
    expectedSalary: { label: "期望薪资", aliases: ["期望薪资", "薪资期望", "期望月薪", "expected salary", "salary expectation", "desired salary"] },
    school: { label: "学校", aliases: ["毕业院校", "学校名称", "就读学校", "院校", "university", "college", "school name", "school"] },
    educationLevel: { label: "学历", aliases: ["最高学历", "学历", "education level", "highest education", "education"] },
    degree: { label: "学位", aliases: ["最高学位", "学位", "degree"] },
    major: { label: "专业", aliases: ["专业名称", "所学专业", "主修专业", "major", "field of study"] },
    educationStart: { label: "入学时间", aliases: ["入学时间", "入学日期", "教育开始时间", "education start", "enrollment date"] },
    graduationDate: { label: "毕业时间", aliases: ["毕业时间", "毕业日期", "预计毕业时间", "graduation date", "graduation time"] },
    personalWebsite: { label: "个人网站", aliases: ["个人网站", "个人主页", "个人网址", "personal website", "website", "homepage"] },
    github: { label: "GitHub", aliases: ["github地址", "github链接", "github url", "github"] },
    portfolio: { label: "作品集", aliases: ["作品集链接", "作品集", "portfolio url", "portfolio"] },
    blog: { label: "博客", aliases: ["博客地址", "个人博客", "blog url", "blog"] },
    acceptsAssignment: { label: "接受调剂", aliases: ["是否接受调剂", "是否服从调剂", "服从分配", "接受调剂", "accept reassignment", "relocation"] },
    internshipDuration: { label: "可实习时长", aliases: ["可实习时长", "实习时长", "每周实习", "internship duration", "availability per week"] },
    idNumber: { label: "证件号码", aliases: ["身份证号码", "身份证号", "证件号码", "证件号", "identity number", "id number", "passport number"], sensitive: true },
    politicalStatus: { label: "政治面貌", aliases: ["政治面貌", "political status"], sensitive: true },
    maritalStatus: { label: "婚姻状况", aliases: ["婚姻状况", "婚姻状态", "marital status"], sensitive: true }
  };

  const BLOCKED_PATTERN = /密码|password|验证码|captcha|银行卡|bank\s*card|社保|公积金|security\s*code/i;
  const LEGAL_PATTERN = /隐私|条款|声明|承诺|授权|背景调查|竞业|真实性|同意协议|privacy|terms|consent|declaration|authorize|background\s*check/i;
  const IGNORED_INPUT_TYPES = new Set(["hidden", "button", "submit", "reset", "image", "password"]);

  function normalize(value) {
    return String(value ?? "")
      .toLowerCase()
      .replace(/[\s\u00a0_:：*（）()\[\]【】/\\.,，。?？-]+/g, "")
      .trim();
  }

  function isVisible(element) {
    if (!element || element.disabled || element.hidden) return false;
    const style = globalScope.getComputedStyle ? globalScope.getComputedStyle(element) : null;
    if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) return false;
    return element.getClientRects ? element.getClientRects().length > 0 : true;
  }

  function associatedLabelText(element) {
    const parts = [];
    if (element.labels) {
      for (const label of element.labels) parts.push(label.innerText || label.textContent || "");
    }
    const ariaLabelledBy = element.getAttribute?.("aria-labelledby");
    if (ariaLabelledBy && globalScope.document) {
      for (const id of ariaLabelledBy.split(/\s+/)) {
        const node = globalScope.document.getElementById(id);
        if (node) parts.push(node.innerText || node.textContent || "");
      }
    }
    const fieldset = element.closest?.("fieldset");
    const legend = fieldset?.querySelector("legend");
    if (legend) parts.push(legend.innerText || legend.textContent || "");
    return parts.join(" ").trim();
  }

  function describeElement(element) {
    const values = [
      associatedLabelText(element),
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("placeholder"),
      element.getAttribute?.("name"),
      element.getAttribute?.("id"),
      element.getAttribute?.("autocomplete"),
      element.getAttribute?.("data-field"),
      element.getAttribute?.("data-name")
    ].filter(Boolean);
    return values.join(" | ");
  }

  function scoreAlias(description, alias) {
    const source = normalize(description);
    const target = normalize(alias);
    if (!source || !target) return 0;
    const segments = description.split("|").map(normalize).filter(Boolean);
    if (segments.includes(target)) return 1;
    if (source === target) return 1;
    if (target.length >= 3 && source.includes(target)) return 0.86;
    return 0;
  }

  function matchField(description) {
    if (!description || BLOCKED_PATTERN.test(description) || LEGAL_PATTERN.test(description)) {
      return null;
    }

    let best = null;
    for (const [key, definition] of Object.entries(PROFILE_FIELDS)) {
      for (const alias of definition.aliases) {
        const score = scoreAlias(description, alias);
        if (score > (best?.confidence || 0)) {
          best = { key, label: definition.label, confidence: score, sensitive: Boolean(definition.sensitive) };
        }
      }
    }
    return best && best.confidence >= 0.82 ? best : null;
  }

  function collectControls(doc) {
    const controls = Array.from(doc.querySelectorAll("input, select, textarea"));
    const seenRadioGroups = new Set();
    const candidates = [];

    for (const element of controls) {
      if (!isVisible(element)) continue;
      const type = (element.type || element.tagName || "").toLowerCase();
      if (IGNORED_INPUT_TYPES.has(type)) continue;

      if (type === "radio" && element.name) {
        if (seenRadioGroups.has(element.name)) continue;
        seenRadioGroups.add(element.name);
        const escapedName = globalScope.CSS?.escape ? globalScope.CSS.escape(element.name) : element.name.replace(/["\\]/g, "\\$&");
        const group = Array.from(doc.querySelectorAll(`input[type="radio"][name="${escapedName}"]`)).filter(isVisible);
        candidates.push({ element, elements: group, type: "radio", description: group.map(describeElement).join(" | ") });
        continue;
      }

      candidates.push({ element, elements: [element], type, description: describeElement(element) });
    }
    return candidates;
  }

  function currentValue(candidate) {
    if (candidate.type === "radio") {
      return candidate.elements.find((item) => item.checked)?.value || "";
    }
    if (candidate.type === "checkbox") return candidate.element.checked ? "true" : "";
    return candidate.element.value || "";
  }

  function classifyCandidate(candidate, profile) {
    if (candidate.type === "file") {
      return { key: "resumeFile", label: "简历附件", status: "unsupported", reason: "浏览器要求手动选择附件" };
    }
    if (BLOCKED_PATTERN.test(candidate.description) || LEGAL_PATTERN.test(candidate.description)) {
      return { status: "ignored", reason: "安全边界字段不会自动填写" };
    }

    const match = matchField(candidate.description);
    if (!match) return { status: "unsupported", reason: "暂未识别字段含义" };
    const value = profile?.[match.key];
    if (value === undefined || value === null || String(value).trim() === "") {
      return { ...match, status: "missing_profile_value", reason: `资料中未填写${match.label}` };
    }
    if (match.sensitive || match.confidence < 0.9) {
      return { ...match, status: "confirm_required", value: String(value), reason: match.sensitive ? "敏感信息需单独确认" : "字段匹配需要确认" };
    }
    return { ...match, status: "matched", value: String(value), reason: "可以填写" };
  }

  function scanDocument(doc, profile = {}) {
    return collectControls(doc).map((candidate, index) => ({
      id: `field-${index}`,
      candidate,
      description: candidate.description,
      currentValue: currentValue(candidate),
      ...classifyCandidate(candidate, profile)
    }));
  }

  function setNativeValue(element, value) {
    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor?.set) descriptor.set.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function optionMatches(optionText, value) {
    const option = normalize(optionText);
    const target = normalize(value);
    if (!option || !target) return false;
    if (option === target || option.includes(target) || target.includes(option)) return true;

    const synonymGroups = [
      ["男", "male", "man"], ["女", "female", "woman"],
      ["本科", "大学本科", "bachelor", "bachelorsdegree"],
      ["硕士", "研究生", "master", "mastersdegree"],
      ["博士", "phd", "doctor"],
      ["全职", "fulltime"], ["实习", "intern", "internship"], ["兼职", "parttime"],
      ["是", "yes", "true", "接受"], ["否", "no", "false", "不接受"]
    ];
    return synonymGroups.some((group) => group.some((item) => normalize(item) === target) && group.some((item) => option.includes(normalize(item))));
  }

  function fillCandidate(candidate, value) {
    const element = candidate.element;
    if (candidate.type === "select-one" || candidate.type === "select-multiple" || element.tagName?.toLowerCase() === "select") {
      const option = Array.from(element.options).find((item) => optionMatches(`${item.value} ${item.textContent}`, value));
      if (!option) throw new Error("下拉选项中没有对应值");
      setNativeValue(element, option.value);
      return;
    }

    if (candidate.type === "radio") {
      const option = candidate.elements.find((item) => optionMatches(`${item.value} ${associatedLabelText(item)}`, value));
      if (!option) throw new Error("单选项中没有对应值");
      option.click();
      option.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    if (candidate.type === "checkbox") {
      const shouldCheck = /^(true|1|yes|是|接受)$/i.test(String(value));
      if (element.checked !== shouldCheck) element.click();
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    setNativeValue(element, value);
  }

  function makeSnapshot(candidate) {
    return candidate.elements.map((element) => ({
      element,
      value: element.value,
      checked: element.checked
    }));
  }

  function restoreSnapshot(snapshot) {
    for (const item of snapshot) {
      if (typeof item.checked === "boolean" && item.element.checked !== item.checked) item.element.click();
      if ("value" in item.element) setNativeValue(item.element, item.value);
    }
  }

  function serializeResult(item) {
    return {
      id: item.id,
      fieldKey: item.key || null,
      fieldLabel: item.label || "未识别字段",
      status: item.status,
      reason: item.reason,
      confidence: item.confidence || 0,
      sensitive: Boolean(item.sensitive),
      value: item.value || "",
      description: item.description
    };
  }

  function summarize(items) {
    const counts = { matched: 0, confirm_required: 0, unsupported: 0, missing_profile_value: 0, failed: 0, ignored: 0, filled: 0 };
    for (const item of items) counts[item.status] = (counts[item.status] || 0) + 1;
    const actionable = counts.matched + counts.confirm_required + counts.missing_profile_value + counts.unsupported + counts.failed;
    const recognized = counts.matched + counts.confirm_required;
    const ratio = actionable ? recognized / actionable : 0;
    let supportLevel = "暂不支持";
    if (recognized >= 3 && ratio >= 0.75) supportLevel = "完全支持";
    else if (recognized >= 1 && ratio >= 0.35) supportLevel = "部分支持";
    else if (items.length > 0) supportLevel = "通用模式";
    return { counts, total: items.length, recognized, supportLevel };
  }

  function maskValue(key, value) {
    const text = String(value || "");
    if (key === "phone" && text.length >= 7) return `${text.slice(0, 3)}****${text.slice(-4)}`;
    if (key === "email") {
      const [name, domain] = text.split("@");
      return domain ? `${name.slice(0, 2)}***@${domain}` : "***";
    }
    if (PROFILE_FIELDS[key]?.sensitive) return text ? `${text.slice(0, 2)}********${text.slice(-2)}` : "";
    return text;
  }

  const api = {
    PROFILE_FIELDS,
    normalize,
    matchField,
    scanDocument,
    fillCandidate,
    makeSnapshot,
    restoreSnapshot,
    serializeResult,
    summarize,
    maskValue
  };

  globalScope.JobFormCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
