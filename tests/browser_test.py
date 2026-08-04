from pathlib import Path
import os
import base64
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import tempfile
from threading import Thread
import zipfile
from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parent.parent
SCREENSHOT_DIR = Path("/tmp/jian-tian-browser-tests")
SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
DEFAULT_CHROME = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
BASE_URL = ""


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format, *_args):
        pass


def create_sample_docx(path):
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    </Types>"""
    rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>"""
    lines = [
        "张明", "求职意向：售前工程师", "13800138000 demo@example.com",
        "教育经历", "示例大学 | 物联网工程 | 本科", "2022.09 - 2026.06", "- GPA 3.6，专业前 10%。",
        "实习经历", "示例科技有限公司 | 售前实习生", "2025.03 - 2025.09", "- 梳理 30 家竞品参数，支持 2 个客户方案。",
        "项目经历", "智能设备平台 | 项目负责人", "2024.09 - 2025.01", "- 组织 20 名用户测试并完成两轮迭代。"
    ]
    paragraphs = "".join(f'<w:p><w:r><w:t>{line}</w:t></w:r></w:p>' for line in lines)
    document = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{paragraphs}</w:body></w:document>'''
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", rels)
        archive.writestr("word/document.xml", document)


def create_sample_pdf(path, text="Zhang Ming 13800138000 demo@example.com"):
    safe_text = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    stream = f"BT /F1 12 Tf 72 720 Td ({safe_text}) Tj ET".encode("ascii") if safe_text else b""
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
    ]
    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{index} 0 obj\n".encode())
        output.extend(obj)
        output.extend(b"\nendobj\n")
    xref = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n".encode())
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode())
    output.extend(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    path.write_bytes(output)


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
          <script type="application/ld+json">
            {"@context":"https://schema.org","@type":"JobPosting","title":"产品经理","description":"负责产品规划和跨团队协作。","hiringOrganization":{"name":"示例科技有限公司"},"jobLocation":{"address":{"addressLocality":"杭州"}}}
          </script>
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
    page.add_script_tag(path=str(ROOT / "job-core.js"))
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

    job = page.evaluate(
        """() => new Promise(resolve => window.__jtListener({type: 'JT_EXTRACT_JOB'}, {}, resolve))"""
    )
    assert_equal(job["ok"], True, "岗位提取应成功")
    assert_equal(job["data"]["company"], "示例科技有限公司", "应优先读取 JobPosting 公司")
    assert_equal(job["data"]["title"], "产品经理", "应优先读取 JobPosting 岗位")

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
        window.__jtStore = JSON.parse(localStorage.getItem('__jtStore') || '{}');
        window.chrome = { storage: { local: {
          async get(keys) { const result = {}; for (const key of keys) if (key in window.__jtStore) result[key] = window.__jtStore[key]; return result; },
          async set(value) { Object.assign(window.__jtStore, value); localStorage.setItem('__jtStore', JSON.stringify(window.__jtStore)); },
          async remove(keys) { for (const key of keys) delete window.__jtStore[key]; localStorage.setItem('__jtStore', JSON.stringify(window.__jtStore)); }
        } } };
        window.confirm = () => true;
        """
    )
    page.goto(f"{BASE_URL}/options.html")
    page.wait_for_load_state("networkidle")
    page.locator('[name="fullName"]').fill("张明")
    page.locator('[name="phone"]').fill("13800138000")
    page.locator('[name="email"]').fill("demo@example.com")
    page.locator('[name="school"]').fill("示例大学")
    page.get_by_role("button", name="保存基本资料").click()
    page.wait_for_function("window.__jtStore.profile && window.__jtStore.profile.fullName === '张明'")
    assert_equal(page.evaluate("window.__jtStore.onboardingComplete"), True, "保存后应完成引导")
    assert_equal(page.evaluate("window.__jtStore.profile.school"), "示例大学", "教育资料应保存")
    if "基本资料已保存在当前浏览器" not in page.locator("#saveStatus").inner_text():
        raise AssertionError("保存后应显示明确反馈")

    with tempfile.TemporaryDirectory() as directory:
        document_path = Path(directory) / "张明_母版简历.docx"
        corrupt_docx_path = Path(directory) / "损坏简历.docx"
        pdf_path = Path(directory) / "张明_母版简历.pdf"
        empty_pdf_path = Path(directory) / "扫描版空简历.pdf"
        screenshot_path = Path(directory) / "示例岗位.png"
        create_sample_docx(document_path)
        corrupt_docx_path.write_bytes(b"not-a-docx")
        create_sample_pdf(pdf_path)
        create_sample_pdf(empty_pdf_path, "")
        screenshot_path.write_bytes(base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
        ))

        page.locator("#resumeImportFile").set_input_files(str(empty_pdf_path))
        page.wait_for_function("document.querySelector('#resumeIssueList').textContent.includes('未提取到文本')")
        page.get_by_role("button", name="取消", exact=True).click()

        page.locator("#resumeImportFile").set_input_files(str(pdf_path))
        page.wait_for_function("document.querySelector('#resumeRawText').value.includes('demo@example.com')")
        page.get_by_role("button", name="取消", exact=True).click()

        page.locator("#resumeImportFile").set_input_files(str(corrupt_docx_path))
        page.wait_for_function("document.querySelector('#resumeStatus').textContent.includes('解析失败')")

        page.locator("#resumeImportFile").set_input_files(str(document_path))
        page.wait_for_function("!document.querySelector('#resumeImportPanel').classList.contains('hidden')")
        if "张明" not in page.locator("#resumeRawText").input_value():
            raise AssertionError("DOCX 应在本地提取出姓名")
        page.get_by_role("button", name="保存母版并同步勾选资料").click()
        page.wait_for_function("document.querySelector('#resumeStatus').textContent.includes('母版已保存')")
        assert_equal(page.locator('[name="school"]').input_value(), "示例大学", "识别结果应同步到基本资料")
        if not page.evaluate("JobStorage.getResumeMaster().then(master => master.fieldMetadata.some(item => item.source === 'resume_import' && typeof item.confidence === 'number'))"):
            raise AssertionError("母版应持久化字段来源和置信度")

        page.get_by_role("button", name="手工新建岗位").click()
        page.locator('#jobForm [name="company"]').fill("星河科技有限公司")
        page.locator('#jobForm [name="title"]').fill("售前工程师")
        page.locator('#jobForm [name="description"]').fill("负责客户需求分析、方案演示与项目跟进。")
        page.locator("#jobScreenshotFile").set_input_files(str(screenshot_path))
        page.get_by_role("button", name="保存岗位", exact=True).click()
        page.wait_for_function("document.querySelector('#jobList').textContent.includes('星河科技有限公司')")
        page.get_by_role("button", name="查看 / 生成提示词").click()
        page.get_by_role("button", name="生成提示词", exact=True).click()
        page.wait_for_function("document.querySelector('#promptPreview').value.includes('必须交付')")
        prompt = page.locator("#promptPreview").input_value()
        if ".docx" not in prompt or ".pdf" not in prompt or "不得虚构" not in prompt:
            raise AssertionError("提示词应包含双格式交付和真实性约束")
        page.get_by_role("button", name="关闭").click()

        with page.expect_download() as download_info:
            page.get_by_role("button", name="下载母版").click()
        assert_equal(download_info.value.suggested_filename, "张明_母版简历.docx", "应可重新下载原始母版")

        page.reload(wait_until="networkidle")
        page.wait_for_function("document.querySelector('#jobList').textContent.includes('星河科技有限公司')")
        if page.locator("#resumeCurrent").is_hidden():
            raise AssertionError("刷新后母版应继续存在")
        page.get_by_role("button", name="查看 / 生成提示词").click()
        page.wait_for_selector("#jobScreenshotList .screenshot-item")
        assert_equal(page.locator("#jobScreenshotList .screenshot-item").count(), 1, "刷新后岗位截图应继续存在")
        page.get_by_role("button", name="删除岗位").click()
        page.wait_for_function("!document.querySelector('#jobList').textContent.includes('星河科技有限公司')")

        page.get_by_role("button", name="删除母版").click()
        page.wait_for_function("!document.querySelector('#resumeEmpty').classList.contains('hidden')")
        assert_equal(page.locator('[name="fullName"]').input_value(), "张明", "删除母版不得删除已同步的基本资料")

    page.screenshot(path=str(SCREENSHOT_DIR / "options.png"), full_page=True)
    assert_equal(console_errors, [], "资料页不应出现控制台错误")
    page.close()


def test_job_draft_confirmation(browser):
    page = browser.new_page(viewport={"width": 1200, "height": 850})
    console_errors = []
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
    page.add_init_script(
        """
        const draftKey = 'jobDraft:test-token';
        const draft = {
          job: {company: '确认前公司', title: '确认前岗位', description: '岗位职责正文', status: '准备投递'},
          screenshot: {fileName: '确认前岗位截图.png', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='}
        };
        window.chrome = { storage: {
          local: {async get() { return {profile: {fullName: '张明', phone: '13800138000'}}; }, async set() {}, async remove() {}},
          session: {
            async get(key) { return key === draftKey ? {[draftKey]: draft} : {}; },
            async remove(key) { if (key === draftKey) window.__draftRemoved = true; }
          }
        } };
        window.confirm = () => true;
        """
    )
    page.goto(f"{BASE_URL}/options.html#draft=test-token")
    page.wait_for_function("document.querySelector('#jobDialog').open")
    assert_equal(page.evaluate("JobStorage.getJobs().then(jobs => jobs.length)"), 0, "确认前不得创建持久岗位档案")
    assert_equal(page.locator("#jobScreenshotList .screenshot-item").count(), 1, "会话草稿应显示待确认截图")
    page.get_by_role("button", name="保存岗位", exact=True).click()
    page.wait_for_function("document.querySelector('#jobList').textContent.includes('确认前公司')")
    assert_equal(page.evaluate("JobStorage.getJobs().then(jobs => jobs.length)"), 1, "确认后才应写入岗位档案")
    assert_equal(page.evaluate("window.__draftRemoved || false"), True, "确认完成后应清除会话草稿")
    assert_equal(console_errors, [], "岗位确认流程不应出现控制台错误")
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
          storage: {
            local: {async get() { return {profile}; }},
            session: {async set(value) { window.__jobDraft = value; }}
          },
          tabs: {
            async query() { return [{id: 7, url: 'https://jobs.example.cn/apply', title: '示例公司岗位申请'}]; },
            async sendMessage(_id, message) {
              if (message.type === 'JT_FILL') return {ok: true, data: {...scanData, canUndo: true, summary: {...scanData.summary, counts: {...scanData.summary.counts, matched: 0, filled: 4}}}};
              if (message.type === 'JT_UNDO') return {ok: true, data: {restored: 4}};
              if (message.type === 'JT_EXTRACT_JOB') return {ok: true, data: {company: '示例科技有限公司', title: '产品经理', description: '负责产品规划和跨团队协作。', sourceUrl: 'https://jobs.example.cn/apply'}};
              return {ok: true, data: scanData};
            },
            async create(options) { window.__openedDraftUrl = options.url; }
          },
          scripting: {async executeScript() {}},
          runtime: {
            openOptionsPage() { window.__openedOptions = true; },
            async sendMessage() { return {ok: true, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='}; },
            getURL(path) { return `chrome-extension://test/${path}`; }
          }
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
    page.get_by_role("button", name="保存当前岗位").click()
    page.wait_for_function("window.__openedDraftUrl && window.__openedDraftUrl.includes('#draft=')")
    if not page.evaluate("Object.keys(window.__jobDraft || {}).some(key => key.startsWith('jobDraft:'))"):
        raise AssertionError("岗位应先进入会话草稿，确认前不得写入持久岗位档案")
    page.screenshot(path=str(SCREENSHOT_DIR / "popup.png"), full_page=True)
    assert_equal(console_errors, [], "弹窗不应出现控制台错误")
    page.close()


def main():
    global BASE_URL
    handler = partial(QuietHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    BASE_URL = f"http://127.0.0.1:{server.server_port}"
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=True,
                executable_path=chromium_executable(playwright),
            )
            try:
                test_form_filling(browser)
                test_options_page(browser)
                test_job_draft_confirmation(browser)
                test_popup_page(browser)
            finally:
                browser.close()
    finally:
        server.shutdown()
        thread.join(timeout=2)
    print(f"browser tests passed; screenshots: {SCREENSHOT_DIR}")


if __name__ == "__main__":
    main()
