"""把 *.src.html 里的 Mermaid 图预先渲染成 SVG，生成不依赖网络和脚本的 *.html。

用法（在 macOS 上，需要装有 Google Chrome，命令行能访问 cdn.jsdelivr.net 或 unpkg.com）：
    python3 -I docs/scenarios/build.py                      # 渲染 docs/scenarios/index.src.html
    python3 -I docs/scenarios/build.py 某个/页面.src.html     # 渲染指定的源文件，输出到同目录的 页面.html
    python3 -I docs/scenarios/build.py 某个/页面.src.html --shots 某个目录
        # 生成之余，给整页和每张图各截一张浅色、一张深色的图，用来自查有没有重叠、裁切

改图只改 .src.html，然后运行本脚本；不要直接改生成的 .html。
"""

import pathlib
import re
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
DEFAULT_SOURCE = HERE / "index.src.html"
MERMAID_URL = "https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"
# 有的网络连不上 jsdelivr，下载时先试它、失败再换 unpkg 上的同一版本；页面里引用的始终是 MERMAID_URL
MERMAID_DOWNLOAD_URLS = (MERMAID_URL, "https://unpkg.com/mermaid@10.9.1/dist/mermaid.min.js")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DOCTYPE = "<!doctype html>\n"
# 整页截图的窗口大小；再长的页面只看每张图的截图
PAGE_SHOT_WINDOW = "1500,16000"
FIGURE_SHOT_PADDING = 80
FIGURE_SHOT_MAX_SIDE = 6000
FIGURE_SHOT_FALLBACK_SIZE = (1400, 1000)


def run_chrome(arguments: list[str], check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        [CHROME, "--headless=new", "--disable-gpu", "--allow-file-access-from-files", *arguments],
        check=check, capture_output=True, text=True,
    )


def render_dom(source_html: str, work_dir: pathlib.Path) -> str:
    mermaid_file = work_dir / "mermaid.min.js"
    is_downloaded = False
    for url in MERMAID_DOWNLOAD_URLS:
        download = subprocess.run(["curl", "-sS", "-f", "-m", "60", "-o", str(mermaid_file), url])
        is_downloaded = download.returncode == 0
        if is_downloaded:
            break
        print(f"下载 mermaid 失败：{url}，换下一个地址", file=sys.stderr)
    if not is_downloaded:
        raise RuntimeError("mermaid 的所有下载地址都失败了")
    page = work_dir / "page.html"
    page.write_text(source_html.replace(MERMAID_URL, "mermaid.min.js"), encoding="utf-8")
    return run_chrome(["--virtual-time-budget=30000", "--dump-dom", page.as_uri()]).stdout


def with_notice(dom: str, notice: str) -> str:
    # Chrome 吐出的 DOM 自带一行 doctype，说明注释插在它后面，不再另加一个
    own_doctype = re.match(r"\s*<!doctype html>\s*", dom, re.IGNORECASE)
    if own_doctype:
        return DOCTYPE + notice + dom[own_doctype.end():]
    return DOCTYPE + notice + dom


def screenshot(target: pathlib.Path, window_size: str, page: pathlib.Path) -> None:
    # 新版无头 Chrome 截完图常以退出码 2 结束，文件写出来了就算成功
    run_chrome([f"--screenshot={target}", f"--window-size={window_size}", "--hide-scrollbars", page.as_uri()], check=False)
    if not target.exists():
        raise RuntimeError(f"截图失败：{target}")


def as_dark_page(html: str) -> str:
    return re.sub(r"<html(\s[^>]*)?>", lambda tag: f'<html{tag.group(1) or ""} data-theme="dark">', html, count=1)


def take_screenshots(dom: str, shots_dir: pathlib.Path) -> None:
    shots_dir.mkdir(parents=True, exist_ok=True)
    for theme, html in (("light", dom), ("dark", as_dark_page(dom))):
        page = shots_dir / f"_page-{theme}.html"
        page.write_text(html, encoding="utf-8")
        screenshot(shots_dir / f"page-{theme}.png", PAGE_SHOT_WINDOW, page)

    style = re.search(r"<style>[\s\S]*?</style>", dom)
    style_block = style.group(0) if style else ""
    figures = re.findall(r'<svg[^>]+id="mermaid-[\s\S]*?</svg>', dom)
    for index, svg in enumerate(figures, start=1):
        view_box = re.search(r'viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"', svg)
        if view_box:
            width = int(float(view_box.group(1))) + FIGURE_SHOT_PADDING
            height = int(float(view_box.group(2))) + FIGURE_SHOT_PADDING
        else:
            width, height = FIGURE_SHOT_FALLBACK_SIZE
        window_size = f"{min(width, FIGURE_SHOT_MAX_SIDE)},{min(height, FIGURE_SHOT_MAX_SIDE)}"
        # 套上两类图页各自的容器类（.diagram / .figure），截图里的底色和页面一致
        figure_html = (
            f'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">{style_block}</head>'
            f'<body><div class="diagram figure"><pre class="mermaid">{svg}</pre></div></body></html>'
        )
        for theme, html in (("light", figure_html), ("dark", as_dark_page(figure_html))):
            page = shots_dir / f"_fig{index:02d}-{theme}.html"
            page.write_text(html, encoding="utf-8")
            screenshot(shots_dir / f"fig{index:02d}-{theme}.png", window_size, page)
        print(f"图 {index}：{width - FIGURE_SHOT_PADDING} × {height - FIGURE_SHOT_PADDING}")
    print(f"截图在 {shots_dir}")


def main(argv: list[str]) -> int:
    source = DEFAULT_SOURCE
    notice = "<!-- 由 build.py 从 index.src.html 生成，不要直接修改本文件 -->\n"
    shots_dir = None
    arguments = iter(argv)
    for argument in arguments:
        if argument == "--shots":
            shots_dir = pathlib.Path(next(arguments, "")).expanduser().resolve()
            continue
        source = pathlib.Path(argument).resolve()
        if not source.name.endswith(".src.html"):
            print("源文件名必须以 .src.html 结尾", file=sys.stderr)
            return 2
        notice = f"<!-- 由 docs/scenarios/build.py 从 {source.name} 生成，不要直接修改本文件 -->\n"
    output = source.with_name(source.name[: -len(".src.html")] + ".html")

    source_html = source.read_text(encoding="utf-8")
    expected = source_html.count('<pre class="mermaid">')
    with tempfile.TemporaryDirectory() as tmp:
        dom = render_dom(source_html, pathlib.Path(tmp))

    rendered = len(re.findall(r'<svg[^>]+id="mermaid-', dom))
    errors = dom.count("Syntax error")
    if rendered != expected or errors:
        print(f"渲染失败：应有 {expected} 张图，实际 {rendered} 张，语法错误 {errors} 处", file=sys.stderr)
        return 1

    # 去掉画图库的加载标签；页面里剩下的脚本有 window.mermaid 守卫，生成后不再做事
    dom = re.sub(r'<script src="mermaid\.min\.js"></script>\s*', "", dom)
    output.write_text(with_notice(dom, notice), encoding="utf-8")
    print(f"已生成 {output}，共 {rendered} 张图")
    if shots_dir is not None:
        take_screenshots(dom, shots_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
