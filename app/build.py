"""Build the single-file app (dist/index.html) from src/.

    python build.py                          # data from ../results/app_data.json
    python build.py --data path/to/app_data.json
    python build.py --check                  # build, then fail on unresolved placeholders

The output is one self-contained HTML file: it opens straight from disk
(file://) and deploys as it is, e.g. to GitHub Pages.

What the build does, in order:
  1. src/index.html: replace every  <!-- @include partials/x.html -->  with the file.
  2. Replace every  <link rel="stylesheet" href="css/x.css">  with an inline <style>.
  3. Bundle the ES modules, starting at js/main.js (see bundle() below).
  4. Insert the model data into  <script type="application/json" id="app-data">.
  5. Replace every  assets/<name>  reference (HTML, CSS and JS) with a data: URL.

Bundling is deliberately simple, so the code stays plain modules that a browser
could also load one by one. Rules the source has to follow (the build checks them):
  * imports are named and relative:   import { a, b } from "./x.js";
  * no default exports, no "import * as", no "as" renames;
  * every top-level name is unique across all modules, because the modules are
    concatenated into one module scope.
"""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import re
import shutil
import subprocess
import tempfile
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "src"

INCLUDE = re.compile(r"[ \t]*<!--\s*@include\s+(\S+)\s*-->")
STYLESHEET = re.compile(r'[ \t]*<link rel="stylesheet" href="(css/[^"]+)">')
MODULE_TAG = re.compile(r'<script type="module" src="(js/[^"]+)"></script>')
IMPORT = re.compile(r'^import\s*\{([^}]*)\}\s*from\s*"(\./[^"]+)";?\s*$', re.M)
ANY_IMPORT = re.compile(r"^\s*import\b", re.M)
TOP_LEVEL = re.compile(r"^(?:export\s+)?(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)", re.M)
ASSET = re.compile(r"assets/([\w.-]+\.(?:jpg|jpeg|png|svg|webp))")


def fail(msg):
    sys.exit(f"build: {msg}")


def include_partials(html: str, base: Path) -> str:
    def sub(m):
        path = base / m.group(1)
        if not path.is_file():
            fail(f"missing partial {m.group(1)}")
        return include_partials(path.read_text(encoding="utf-8").rstrip(), path.parent)
    return INCLUDE.sub(sub, html)


def inline_css(html: str) -> str:
    def sub(m):
        path = SRC / m.group(1)
        if not path.is_file():
            fail(f"missing stylesheet {m.group(1)}")
        return f"<style>/* {m.group(1)} */\n{path.read_text(encoding='utf-8').strip()}\n</style>"
    return STYLESHEET.sub(sub, html)


def bundle(entry: str) -> str:
    """Concatenate the module graph in dependency order into one module body."""
    order, seen, stack = [], set(), []

    def visit(rel: str):
        if rel in seen:
            return
        if rel in stack:
            fail("import cycle: " + " -> ".join(stack + [rel]))
        path = SRC / rel
        if not path.is_file():
            fail(f"missing module {rel}")
        stack.append(rel)
        text = path.read_text(encoding="utf-8")
        for names, target in IMPORT.findall(text):
            if " as " in names:
                fail(f"{rel}: 'as' renames are not supported by the bundler")
            visit(str((Path(rel).parent / target).as_posix()).replace("/./", "/"))
        stack.pop()
        seen.add(rel)
        order.append((rel, text))

    visit(entry)
    owners, parts = {}, []
    for rel, text in order:
        body = IMPORT.sub("", text)
        if ANY_IMPORT.search(body):
            fail(f"{rel}: only  import {{ ... }} from \"./x.js\";  is supported")
        if re.search(r"^export\s+default\b", body, re.M):
            fail(f"{rel}: default exports are not supported")
        for name in TOP_LEVEL.findall(body):
            if name in owners:
                fail(f"top-level name '{name}' is defined in both {owners[name]} and {rel}")
            owners[name] = rel
        body = re.sub(r"^export\s+(?=(?:async\s+)?(?:const|let|var|function|class)\b)", "", body, flags=re.M)
        body = re.sub(r"^export\s*\{[^}]*\};?\s*$", "", body, flags=re.M)
        parts.append(f"/* ---------------------------------------------------------- {rel} */\n{body.strip()}\n")
    return "\n".join(parts)


def inline_assets(text: str) -> str:
    def sub(m):
        path = SRC.parent / "assets" / m.group(1)
        if not path.is_file():
            fail(f"missing asset {m.group(1)}")
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"
    return ASSET.sub(sub, text)


def syntax_check(js: str):
    """Parse the bundle as one ES module with Node, if Node is installed. This
    catches what the name check above cannot, e.g. `let a = 1, b = 2;` in two
    modules (a duplicate top-level name is a syntax error in a module)."""
    node = shutil.which("node")
    if not node:
        print("build: node not found, skipping the syntax check")
        return
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False, encoding="utf-8") as f:
        f.write(js)
    try:
        r = subprocess.run([node, "--check", f.name], capture_output=True, text=True)
    finally:
        Path(f.name).unlink()
    if r.returncode:
        fail("the bundled modules do not parse:\n" + r.stderr.strip())


def find_data(arg):
    candidates = [Path(arg)] if arg else [HERE.parent / "results" / "app_data.json",
                                          HERE.parent / "app_data.json", HERE / "data" / "app_data.json"]
    for p in candidates:
        if p.is_file():
            return p
    fail("app_data.json not found; pass --data (looked in: " + ", ".join(map(str, candidates)) + ")")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", help="path to app_data.json")
    ap.add_argument("--out", default=str(HERE / "dist" / "index.html"))
    ap.add_argument("--check", action="store_true", help="fail on leftover @include / @ placeholders")
    a = ap.parse_args()

    data_path = find_data(a.data)
    data = json.loads(data_path.read_text(encoding="utf-8"))
    html = (SRC / "index.html").read_text(encoding="utf-8")
    html = include_partials(html, SRC)
    html = inline_css(html)
    m = MODULE_TAG.search(html)
    if not m:
        fail('src/index.html needs <script type="module" src="js/main.js"></script>')
    js = bundle(m.group(1)).replace("</script", "<\\/script")
    html = html[:m.start()] + f'<script type="module">\n{js}</script>' + html[m.end():]
    blob = json.dumps(data, separators=(",", ":")).replace("</", "<\\/")
    html = html.replace("@APP_DATA@", blob)
    html = inline_assets(html)

    if a.check:
        for pattern in ("@include", "@APP_DATA@", 'href="css/', 'src="js/'):
            if pattern in html:
                fail(f"unresolved '{pattern}' in the output")
        syntax_check(js)

    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"wrote {out} ({len(html) / 1024:.0f} KB) from {data_path} (quick={data.get('quick')})")


if __name__ == "__main__":
    main()