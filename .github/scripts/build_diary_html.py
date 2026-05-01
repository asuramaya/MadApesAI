#!/usr/bin/env python3
"""Generate static HTML pages for each diary entry.

Each thoughts/<slug>.md becomes thoughts/<slug>.html with:
- og:title / og:description / og:image  (X cards + Telegram previews)
- twitter:card=summary_large_image
- canonical URL set to madapesai.com/thoughts/<slug>
- Markdown body rendered to HTML inline (so the page works without the SPA)
- Top nav back to madapesai.com

Frontmatter (optional YAML at top of .md):
  ---
  title: ...
  date: 2026-05-01
  slug: 2026-05-01_my-entry
  summary: short blurb shown in card preview
  cover: thoughts/2026-05-01_my-entry.png  # OR pulled from assets.json[0]
  tweet: optional editorial tweet text
  ---

When frontmatter is absent, falls back to thoughts/index.json + assets.json
(legacy entries already shipped that way).
"""

from __future__ import annotations
import json
import re
import sys
import html as htmllib
from pathlib import Path
import markdown  # pip install markdown
import yaml      # pip install pyyaml

ROOT = Path(__file__).resolve().parents[2]   # MadApes.ai repo root
THOUGHTS = ROOT / "thoughts"
SITE_URL = "https://madapesai.com"
DEFAULT_COVER = "/assets/madapes-cover.webp"  # fallback if entry has none

INDEX_JSON = THOUGHTS / "index.json"
ASSETS_JSON = THOUGHTS / "assets.json"


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """Strip YAML frontmatter, return (meta_dict, body). No frontmatter → empty meta."""
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.DOTALL)
    if not m:
        return {}, text
    try:
        meta = yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError:
        meta = {}
    return meta, m.group(2)


def first_paragraph(md_body: str, max_chars: int = 280) -> str:
    """First non-header paragraph, stripped of MD syntax — used for og:description."""
    for para in re.split(r"\n\s*\n", md_body.strip()):
        cleaned = re.sub(r"<[^>]+>", "", para)            # drop HTML tags
        cleaned = re.sub(r"^[#>*\-+\d.\s]+", "", cleaned) # drop list/heading markers
        cleaned = re.sub(r"\*\*?(.+?)\*\*?", r"\1", cleaned)  # bold/italic
        cleaned = re.sub(r"`([^`]+)`", r"\1", cleaned)
        cleaned = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", cleaned)  # links
        cleaned = cleaned.strip()
        if cleaned and not cleaned.startswith("---"):
            if len(cleaned) > max_chars:
                cleaned = cleaned[: max_chars - 1].rstrip() + "…"
            return cleaned
    return ""


def cover_for(slug: str, meta: dict, assets: dict) -> str:
    """Resolve the cover image URL for og:image, absolute (X requires absolute)."""
    if meta.get("cover"):
        rel = meta["cover"].lstrip("/")
        return f"{SITE_URL}/{rel}"
    # Legacy: first asset entry from assets.json
    md_filename = f"{slug}.md"
    items = assets.get(md_filename) or []
    if items and items[0].get("asset"):
        return f"{SITE_URL}/{items[0]['asset']}"
    return f"{SITE_URL}{DEFAULT_COVER}"


def title_for(slug: str, meta: dict, index: list[dict], md_body: str) -> str:
    if meta.get("title"):
        return meta["title"]
    md_filename = f"{slug}.md"
    for item in index:
        if item.get("file") == md_filename and item.get("title"):
            return item["title"]
    # First H1
    for line in md_body.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return slug


PAGE_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title_esc} — MadApesAI</title>
<link rel="canonical" href="{canonical}">

<meta property="og:type" content="article">
<meta property="og:url" content="{canonical}">
<meta property="og:title" content="{title_esc}">
<meta property="og:description" content="{summary_esc}">
<meta property="og:image" content="{cover}">
<meta property="og:site_name" content="MadApesAI">
<meta property="article:published_time" content="{date}">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title_esc}">
<meta name="twitter:description" content="{summary_esc}">
<meta name="twitter:image" content="{cover}">

<link rel="stylesheet" href="/style.css">
<style>
  body {{ max-width: 720px; margin: 0 auto; padding: 24px; line-height: 1.55; }}
  .diary-nav {{ display: flex; justify-content: space-between; align-items: baseline; padding-bottom: 16px; border-bottom: 1px solid var(--border, #2a2a2a); margin-bottom: 24px; }}
  .diary-nav a {{ color: var(--fg-dim, #888); text-decoration: none; font-size: 14px; letter-spacing: 0.05em; }}
  .diary-nav a:hover {{ color: var(--fg, #ddd); }}
  .diary-meta {{ color: var(--fg-dim, #888); font-size: 13px; margin-bottom: 24px; }}
  article h1 {{ font-size: 28px; line-height: 1.2; margin: 0 0 4px; }}
  article h2 {{ margin-top: 32px; }}
  article img {{ max-width: 100%; height: auto; border-radius: 8px; margin: 16px 0; }}
  article .img-placeholder {{ background: rgba(255,255,255,0.04); border: 1px dashed var(--border, #2a2a2a); border-radius: 8px; padding: 24px; color: var(--fg-dim, #888); font-style: italic; margin: 16px 0; }}
  article a {{ color: var(--accent, #ff79c6); }}
  article code {{ background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; font-size: 0.92em; }}
  article pre {{ background: rgba(0,0,0,0.4); border: 1px solid var(--border, #2a2a2a); border-radius: 6px; padding: 12px; overflow-x: auto; }}
  article blockquote {{ border-left: 3px solid var(--border, #2a2a2a); padding-left: 16px; color: var(--fg-dim, #aaa); margin: 16px 0; }}
</style>
</head>
<body>
<nav class="diary-nav">
  <a href="/">← madapesai.com</a>
  <a href="/#thoughts">all entries</a>
</nav>
<article>
  <h1>{title_esc}</h1>
  <div class="diary-meta">{date_human}</div>
  {body_html}
</article>
</body>
</html>
"""


def render_one(md_path: Path, index: list[dict], assets: dict) -> Path | None:
    text = md_path.read_text()
    if not text.strip():
        return None
    meta, body = parse_frontmatter(text)
    slug = meta.get("slug") or md_path.stem
    title = title_for(slug, meta, index, body)
    summary = meta.get("summary") or first_paragraph(body)
    cover = cover_for(slug, meta, assets)
    date = meta.get("date") or slug[:10]  # slug typically begins YYYY-MM-DD

    body_html = markdown.markdown(
        body,
        extensions=["fenced_code", "tables", "smarty"],
    )

    html_out = PAGE_TEMPLATE.format(
        title_esc=htmllib.escape(title),
        summary_esc=htmllib.escape(summary),
        cover=htmllib.escape(cover, quote=True),
        canonical=f"{SITE_URL}/thoughts/{slug}",
        date=date,
        date_human=date,
        body_html=body_html,
    )
    out_path = THOUGHTS / f"{slug}.html"
    out_path.write_text(html_out)
    return out_path


def main() -> int:
    if not THOUGHTS.exists():
        print(f"thoughts directory not found: {THOUGHTS}", file=sys.stderr)
        return 1

    index = []
    if INDEX_JSON.exists():
        index = json.loads(INDEX_JSON.read_text()).get("thoughts", [])
    assets = {}
    if ASSETS_JSON.exists():
        assets = json.loads(ASSETS_JSON.read_text())

    rendered = 0
    for md in sorted(THOUGHTS.glob("*.md")):
        if md.name.startswith("."):
            continue
        if md.name == "README.md":
            continue
        out = render_one(md, index, assets)
        if out:
            rendered += 1
            print(f"  built {out.relative_to(ROOT)}")
    print(f"built {rendered} HTML page(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
