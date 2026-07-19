const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../core.js");

test("识别常见中英文字段别名", () => {
  assert.equal(core.matchField("手机号码").key, "phone");
  assert.equal(core.matchField("Phone Number").key, "phone");
  assert.equal(core.matchField("电子邮箱").key, "email");
  assert.equal(core.matchField("English Name").key, "englishName");
  assert.equal(core.matchField("毕业院校").key, "school");
  assert.equal(core.matchField("Expected Salary").key, "expectedSalary");
});

test("优先区分相近字段", () => {
  assert.equal(core.matchField("现居城市").key, "currentCity");
  assert.equal(core.matchField("期望城市").key, "preferredCity");
  assert.equal(core.matchField("入学时间").key, "educationStart");
  assert.equal(core.matchField("毕业时间").key, "graduationDate");
});

test("拦截密码、验证码和法律声明", () => {
  assert.equal(core.matchField("登录密码 password"), null);
  assert.equal(core.matchField("短信验证码"), null);
  assert.equal(core.matchField("我同意背景调查授权声明"), null);
  assert.equal(core.matchField("银行卡号"), null);
});

test("将身份证和政治面貌标记为敏感字段", () => {
  assert.equal(core.matchField("身份证号码").sensitive, true);
  assert.equal(core.matchField("政治面貌").sensitive, true);
});

test("汇总填写状态并计算网站支持等级", () => {
  const summary = core.summarize([
    { status: "matched" },
    { status: "matched" },
    { status: "matched" },
    { status: "confirm_required" },
    { status: "missing_profile_value" }
  ]);
  assert.equal(summary.counts.matched, 3);
  assert.equal(summary.recognized, 4);
  assert.equal(summary.supportLevel, "完全支持");
});

test("预览时隐藏手机号、邮箱和敏感信息", () => {
  assert.equal(core.maskValue("phone", "13800138000"), "138****8000");
  assert.equal(core.maskValue("email", "demo@example.com"), "de***@example.com");
  assert.equal(core.maskValue("idNumber", "110101199001011234"), "11********34");
});
