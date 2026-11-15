#!/usr/bin/env python3
"""Build assets/texts from the Kavana app's bundled resources.

Usage: python3 scripts/build_texts.py /path/to/ios/Kavana/Resources

Writes one small JSON file per prayer section so the server reads only what a
request needs.
"""
import json, os, re, shutil, sys

src = sys.argv[1]
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "texts")
shutil.rmtree(out, ignore_errors=True)

def clean(text):
    # <small> marks an instruction inside a line; keep it, in parentheses.
    text = re.sub(r"<small[^>]*>\s*(.*?)\s*</small>", lambda m: f" ({m.group(1)}) " if m.group(1) else " ", text or "", flags=re.S)
    text = re.sub(r"</?(b|small|i|em|strong|big|span)[^>]*>", "", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return re.sub(r"[ \t]*\n[ \t]*", "\n", text).strip()

def paragraphs(section):
    result = []
    for p in section["paragraphs"]:
        he, en = clean(p.get("he")), clean(p.get("en"))
        if not he and not en:
            continue
        item = {"he": he}
        if en:
            item["en"] = en
        if p.get("heading"):
            item["kind"] = "heading"
        elif p.get("rubric"):
            item["kind"] = "instruction"
        elif p.get("blessing"):
            item["kind"] = "blessing"
        result.append(item)
    return result

def write(path, data):
    full = os.path.join(out, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

index = {"traditions": {}}
names = {"sephardic": "Sephardic (Edot HaMizrach)", "ashkenaz": "Ashkenaz", "sefard": "Nusach Sefard"}
files = 0
for tradition in ("sephardic", "ashkenaz", "sefard"):
    book = json.load(open(os.path.join(src, f"siddur_{tradition}.json"), encoding="utf-8"))
    services = []
    for service in book["services"]:
        sections = []
        for section in service["sections"]:
            body = paragraphs(section)
            if not body:
                continue
            write(f"{tradition}/{service['id']}.{section['id']}.json", {
                "tradition": tradition, "service": service["id"], "service_title": service["title"],
                "id": section["id"], "title": section["title"], "paragraphs": body,
            })
            files += 1
            sections.append({"id": section["id"], "title": section["title"], "paragraphs": len(body)})
        services.append({"id": service["id"], "title": service["title"], "sections": sections})
    index["traditions"][tradition] = {"name": names[tradition], "source": book["source"], "services": services}

psalms = json.load(open(os.path.join(src, "tehillim.json"), encoding="utf-8"))
for section in psalms["service"]["sections"]:
    number = int(section["id"].split("-")[1])
    write(f"tehillim/{number}.json", {"chapter": number, "title": section["title"], "verses": paragraphs(section)})
    files += 1
index["tehillim"] = {
    "chapters": len(psalms["service"]["sections"]),
    "source": f"{psalms['source']} · Hebrew: {psalms['hebrewVersion']} · English: {psalms['englishVersion']} · {psalms['license']}",
}

blessings = json.load(open(os.path.join(src, "berachot.json"), encoding="utf-8"))
write("berachot.json", blessings)
write("index.json", index)
print(f"{files + 2} files written to {os.path.normpath(out)}")
