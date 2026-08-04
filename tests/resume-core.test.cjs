const test = require("node:test");
const assert = require("node:assert/strict");
const resumeCore = require("../resume-core.js");

test("用户上传简历后可以识别基础资料和主要章节", () => {
  const parsed = resumeCore.parseResumeText(`
张明
求职意向：售前工程师
13800138000 demo@example.com

教育经历
示例大学 | 物联网工程 | 本科
2022.09 - 2026.06
- GPA 3.6，专业前 10%。

实习经历
示例科技有限公司 | 售前实习生
2025.03 - 2025.09
- 梳理 30 家竞品参数，支持 2 个客户方案。

项目经历
智能设备平台 | 项目负责人
2024.09 - 2025.01
- 组织 20 名用户测试并完成两轮迭代。

证书
大学英语六级、HCIA-IOT
  `);

  assert.equal(parsed.basic.name, "张明");
  assert.equal(parsed.basic.target, "售前工程师");
  assert.equal(parsed.basic.phone, "13800138000");
  assert.equal(parsed.basic.email, "demo@example.com");
  assert.equal(parsed.basic.school, "示例大学");
  assert.equal(parsed.basic.major, "物联网工程");
  assert.match(parsed.basic.graduation, /2026[.\-/]06/);
  assert.equal(parsed.education.length, 1);
  assert.equal(parsed.internships.length, 1);
  assert.equal(parsed.projects.length, 1);
  assert.deepEqual(parsed.certificates, ["大学英语六级", "HCIA-IOT"]);
});

test("导入简历不会静默覆盖用户已经手填的冲突资料", () => {
  const parsed = resumeCore.parseResumeText("张明\n13800138000 demo@example.com");
  const candidates = resumeCore.buildProfileCandidates(parsed, {
    fullName: "张明",
    phone: "13900139000",
    currentCity: "上海"
  });
  const phone = candidates.find((item) => item.key === "phone");

  assert.equal(phone.status, "conflict");
  assert.equal(phone.existing, "13900139000");
  assert.equal(resumeCore.applyProfileCandidates({ phone: "13900139000" }, candidates).phone, "13900139000");
  assert.equal(resumeCore.applyProfileCandidates({ phone: "13900139000" }, candidates, ["phone"]).phone, "13800138000");
});

test("低置信度识别值不会默认同步到基本资料", () => {
  const parsed = resumeCore.parseResumeText("张明\n求职意向：产品经理\n13800138000");
  const candidates = resumeCore.buildProfileCandidates(parsed, {});
  assert.equal(candidates.find((item) => item.key === "fullName").defaultSelected, true);
  assert.equal(candidates.find((item) => item.key === "targetRole").defaultSelected, false);
});
