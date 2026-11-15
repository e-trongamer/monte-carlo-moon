"""Build index.html: inline ../app_data.json and the NASA photos into template.html.

    python export_app_data.py [--quick]
    python app_mockup/build_mockup.py            # uses template.html
    python app_mockup/build_mockup.py --assemble # first rebuild template.html from
                                                 # _head.html + _core_script.js + _app_script.js
"""
import base64, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
P = lambda *a: os.path.join(HERE, *a)

if "--assemble" in sys.argv:
    parts = [open(P(n), encoding="utf-8").read() for n in ("_head.html", "_core_script.js", "_app_script.js", "_scene3d.js", "_features.js")]
    with open(P("template.html"), "w", encoding="utf-8") as f:
        f.write(parts[0].rstrip() + "\n\n<script>\n" + "\n".join(p.rstrip() for p in parts[1:]) + "\n</script>\n")
    print("assembled template.html")

with open(P("..", "app_data.json"), encoding="utf-8") as f:
    data = json.load(f)
with open(P("template.html"), encoding="utf-8") as f:
    html = f.read()
html = html.replace("__APP_DATA__", json.dumps(data, separators=(",", ":")).replace("</", "<\\/"))
for tag, name in (("__IMG_7100__", "as12-48-7100.jpg"), ("__IMG_7134__", "as12-48-7134.jpg"), ("__IMG_7121__", "as12-48-7121.jpg"), ("__IMG_MOON__", "moon_2k.jpg"), ("__IMG_SEMB__", "sem_before.jpg"), ("__IMG_SEMA__", "sem_after.jpg")):
    if tag in html:
        with open(P("assets", name), "rb") as f:
            html = html.replace(tag, "data:image/jpeg;base64," + base64.b64encode(f.read()).decode())
with open(P("index.html"), "w", encoding="utf-8") as f:
    f.write(html)
print(f"wrote {P('index.html')} ({len(html) / 1024:.0f} KB, quick={data.get('quick')})")