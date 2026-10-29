"""把 *.src.html 里的 Mermaid 图预先渲染成 SVG，生成不依赖网络和脚本的 *.html。

用法（在 macOS 上，需要装有 Google Chrome，命令行能访问 cdn.jsdelivr.net）：
    python3 -I docs/scenarios/build.py                      # 渲染 docs/scenarios/index.src.html
    python3 -I docs/scenarios/build.py 某个/页面.src.html     # 渲染指定的源文件，输出到同目录的 页面.html

改图只改 .src.html，然后运行本脚本；不要直接改生成的 .html。
"""

import pathlib
import re
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
SOURCE = HERE / "index.src.html"
OUTPUT = HERE / "index.html"
MERMAID_URL = "https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
NOTICE = "<!-- 由 build.py 从 index.src.html 生成，不要直接修改本文件 -->\n"


def render_dom(source_html: str, work_dir: pathlib.Path) -> str:
    mermaid_file = work_dir / "mermaid.min.js"
    subprocess.run(["curl", "-sS", "-m", "60", "-o", str(mermaid_file), MERMAID_URL], check=True)
    page = work_dir / "page.html"
    page.write_text(source_html.replace(MERMAID_URL, "mermaid.min.js"), encoding="utf-8")
    result = subprocess.run(
        [CHROME, "--headless=new", "--disable-gpu", "--allow-file-access-from-files",
         "--virtual-time-budget=30000", "--dump-dom", page.as_uri()],
        check=True, capture_output=True, text=True,
    )
    return result.stdout


def main() -> int:
    global SOURCE, OUTPUT, NOTICE
    if len(sys.argv) > 1:
        SOURCE = pathlib.Path(sys.argv[1]).resolve()
        if not SOURCE.name.endswith(".src.html"):
            print("源文件名必须以 .src.html 结尾", file=sys.stderr)
            return 2
        OUTPUT = SOURCE.with_name(SOURCE.name[: -len(".src.html")] + ".html")
        NOTICE = f"<!-- 由 docs/scenarios/build.py 从 {SOURCE.name} 生成，不要直接修改本文件 -->\n"
    source_html = SOURCE.read_text(encoding="utf-8")
    expected = source_html.count('<pre class="mermaid">')
    with tempfile.TemporaryDirectory() as tmp:
        dom = render_dom(source_html, pathlib.Path(tmp))

    rendered = len(re.findall(r'<svg[^>]+id="mermaid-', dom))
    errors = dom.count("Syntax error")
    if rendered != expected or errors:
        print(f"渲染失败：应有 {expected} 张图，实际 {rendered} 张，语法错误 {errors} 处", file=sys.stderr)
        return 1

    # 去掉画图库的加载标签；页面里剩下的脚本只负责版本筛选
    dom = re.sub(r'<script src="mermaid\.min\.js"></script>\s*', "", dom)
    OUTPUT.write_text("<!doctype html>\n" + NOTICE + dom, encoding="utf-8")
    print(f"已生成 {OUTPUT}，共 {rendered} 张图")
    return 0


if __name__ == "__main__":
    sys.exit(main())
