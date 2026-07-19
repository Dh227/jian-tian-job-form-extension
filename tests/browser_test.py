from pathlib import Path
import os
from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parent.parent
SCREENSHOT_DIR = Path("/tmp/jian-tian-browser-tests")
SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
DEFAULT_CHROME = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")


def chromium_executable(playwright):
    configured = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE")
    if configured:
        return configured
    if DEFAULT_CHROME.exists():
        return str(DEFAULT_CHROME)
    return playwright.chromium.executable_path


def assert_equal(actual, expected, message):
    if actual != expected:
        raise AssertionError(f"{message}: expected={expected!r}, actual={actual!r}")


def test_form_filling(browser):
    page = browser.new_page(viewport={"width": 1100, "height": 800})
    console_errors = []
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
    page.set_content(
        """
        <!doctype html><html><body>
          <h1>产品经理岗位申请</h1>
          <form>
            <label>中文姓名 <input id="full-name" name="candidateName"></label>
            <label>联系电话 <input id="phone" placeholder="请输入手机号码"></label>
            <label>电子邮箱 <input id="email" aria-label="Email Address"></label>
            <label>性别 <select id="gender" name="gender"><option value="">请选择</option><option value="M">男</option><option value="F">女</option></select></label>
            <label>现居城市 <input id="city" name="currentCity"></label>
            <label>通讯地址 <input id="address" value="用户已填写的地址"></label>
            <label>简历附件 <input id="resume" type="file"></label>
            <label><input id="legal" type="checkbox">我同意背景调查授权声明</label>
            <div id="dynamic"></div>
            <button type="submit">提交申请</button>
          </form>
          <script>
            window.formEvents = 0;
            document.querySelector('form').addEventListener('input', () => window.formEvents++);
            document.querySelector('form').addEventListener('submit', (event) => { event.preventDefault(); window.submitted = true; });
          </script>
        </body></html>
        """
    )
    page.evaluate(
        """
        window.chrome = { runtime: { onMessage: { addListener(fn) { window.__jtListener = fn; } } } };
        """
    )
    page.add_script_tag(path=str(ROOT / "core.js"))
    page.add_script_tag(path=str(ROOT / "content.js"))

    profile = {
        "fullName": "张明",
        "phone": "13800138000",
        "email": "demo@example.com",
        "gender": "男",
        "currentCity": "上海",
        "address": "插件中的地址",
        "targetRole": "产品经理",
    }

    scan = page.evaluate(
        """profile => new Promise(resolve => window.__jtListener({type: 'JT_SCAN', profile}, {}, resolve))""",
        profile,
    )
    assert_equal(scan["ok"], True, "扫描应成功")
    if scan["data"]["summary"]["recognized"] < 5:
        raise AssertionError(f"应识别至少 5 个字段: {scan['data']['summary']}")
    statuses = {item["fieldLabel"]: item["status"] for item in scan["data"]["items"]}
    assert_equal(statuses["简历附件"], "unsupported", "附件应提示手动选择")

    result = page.evaluate(
        """profile => new Promise(resolve => window.__jtListener({type: 'JT_FILL', profile, options: {overwrite: false}}, {}, resolve))""",
        profile,
    )
    assert_equal(result["ok"], True, "填写应成功")
    assert_equal(page.locator("#full-name").input_value(), "张明", "姓名应填入")
    assert_equal(page.locator("#phone").input_value(), "13800138000", "手机号应填入")
    assert_equal(page.locator("#email").input_value(), "demo@example.com", "邮箱应填入")
    assert_equal(page.locator("#gender").input_value(), "M", "下拉框应按显示文本匹配")
    assert_equal(page.locator("#city").input_value(), "上海", "城市应填入")
    assert_equal(page.locator("#address").input_value(), "用户已填写的地址", "已有内容不得覆盖")
    assert_equal(page.locator("#legal").is_checked(), False, "法律授权不得勾选")
    assert_equal(page.evaluate("window.submitted || false"), False, "插件不得提交表单")
    if page.evaluate("window.formEvents") < 4:
        raise AssertionError("填写应触发页面 input 事件")

    page.locator("#dynamic").evaluate("el => el.innerHTML = '<label>应聘岗位 <input id=\"role\"></label>'")
    dynamic_scan = page.evaluate(
        """profile => new Promise(resolve => window.__jtListener({type: 'JT_SCAN', profile}, {}, resolve))""",
        profile,
    )
    if not any(item["fieldLabel"] == "应聘岗位" for item in dynamic_scan["data"]["items"]):
        raise AssertionError("动态新增字段应在再次扫描时被识别")

    undo = page.evaluate(
        """() => new Promise(resolve => window.__jtListener({type: 'JT_UNDO'}, {}, resolve))"""
    )
    if undo["data"]["restored"] < 5:
        raise AssertionError("应恢复本次填写过的控件")
    assert_equal(page.locator("#full-name").input_value(), "", "撤销后姓名应恢复")
    assert_equal(page.locator("#address").input_value(), "用户已填写的地址", "撤销不得影响原有内容")
    assert_equal(console_errors, [], "表单页不应出现控制台错误")
    page.close()


def test_options_page(browser):
    page = browser.new_page(viewport={"width": 1320, "height": 900})
    console_errors = []
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
    page.add_init_script(
        """
        window.__jtStore = {};
        window.chrome = { storage: { local: {
          async get(keys) { const result = {}; for (const key of keys) if (key in window.__jtStore) result[key] = window.__jtStore[key]; return result; },
          async set(value) { Object.assign(window.__jtStore, value); },
          async remove(keys) { for (const key of keys) delete window.__jtStore[key]; }
        } } };
        window.confirm = () => true;
        """
    )
    page.goto((ROOT / "options.html").as_uri())
    page.wait_for_load_state("networkidle")
    page.locator('[name="fullName"]').fill("张明")
    page.locator('[name="phone"]').fill("13800138000")
    page.locator('[name="email"]').fill("demo@example.com")
    page.locator('[name="school"]').fill("示例大学")
    page.get_by_role("button", name="保存资料").click()
    page.wait_for_function("window.__jtStore.profile && window.__jtStore.profile.fullName === '张明'")
    assert_equal(page.evaluate("window.__jtStore.onboardingComplete"), True, "保存后应完成引导")
    assert_equal(page.evaluate("window.__jtStore.profile.school"), "示例大学", "教育资料应保存")
    if "资料已保存在当前浏览器" not in page.locator("#saveStatus").inner_text():
        raise AssertionError("保存后应显示明确反馈")
    page.screenshot(path=str(SCREENSHOT_DIR / "options.png"), full_page=True)
    assert_equal(console_errors, [], "资料页不应出现控制台错误")
    page.close()


def test_popup_page(browser):
    page = browser.new_page(viewport={"width": 390, "height": 680})
    console_errors = []
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
    page.add_init_script(
        """
        const profile = {fullName: '张明', phone: '13800138000', email: 'demo@example.com', currentCity: '上海'};
        const scanData = {
          url: 'https://jobs.example.cn/apply', title: '示例公司岗位申请',
          summary: {supportLevel: '完全支持', recognized: 4, counts: {matched: 3, confirm_required: 1, missing_profile_value: 1, unsupported: 2, failed: 0, ignored: 0, filled: 0}},
          items: [
            {fieldLabel: '中文姓名', status: 'matched', value: '张明'},
            {fieldLabel: '手机号', status: 'matched', value: '138****8000'},
            {fieldLabel: '邮箱', status: 'matched', value: 'de***@example.com'},
            {fieldLabel: '现居城市', status: 'confirm_required', value: '上海'}
          ]
        };
        window.chrome = {
          storage: {local: {async get() { return {profile}; }}},
          tabs: {
            async query() { return [{id: 7, url: 'https://jobs.example.cn/apply', title: '示例公司岗位申请'}]; },
            async sendMessage(_id, message) {
              if (message.type === 'JT_FILL') return {ok: true, data: {...scanData, canUndo: true, summary: {...scanData.summary, counts: {...scanData.summary.counts, matched: 0, filled: 4}}}};
              if (message.type === 'JT_UNDO') return {ok: true, data: {restored: 4}};
              return {ok: true, data: scanData};
            }
          },
          scripting: {async executeScript() {}},
          runtime: {openOptionsPage() { window.__openedOptions = true; }}
        };
        """
    )
    page.goto((ROOT / "popup.html").as_uri())
    page.wait_for_load_state("networkidle")
    page.wait_for_function("document.querySelector('#supportBadge').textContent === '完全支持'")
    assert_equal(page.locator("#recognizedCount").inner_text(), "3", "弹窗应显示可填写数量")
    assert_equal(page.locator("#confirmCount").inner_text(), "1", "弹窗应显示待确认数量")
    page.get_by_role("button", name="一键填写").click()
    page.wait_for_function("document.querySelector('#resultMessage').textContent.includes('已填写 4 项')")
    if page.locator("#undoButton").is_hidden():
        raise AssertionError("填写后应显示撤销按钮")
    page.screenshot(path=str(SCREENSHOT_DIR / "popup.png"), full_page=True)
    assert_equal(console_errors, [], "弹窗不应出现控制台错误")
    page.close()


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            executable_path=chromium_executable(playwright),
        )
        try:
            test_form_filling(browser)
            test_options_page(browser)
            test_popup_page(browser)
        finally:
            browser.close()
    print(f"browser tests passed; screenshots: {SCREENSHOT_DIR}")


if __name__ == "__main__":
    main()
