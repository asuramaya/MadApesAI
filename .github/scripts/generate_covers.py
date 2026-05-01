#!/usr/bin/env python3
"""Generate cover images for diary entries that don't have one yet.

Pipeline order in publish-diary.yml:
  1. generate_covers.py  ← writes assets/thoughts/<slug>_cover.webp
  2. build_diary_html.py ← reads cover via assets.json[<file>][0]
  3. post_socials.py     ← homepage og: card serves the latest cover

Source of the cover prompt:
  - first <div class="img-placeholder">[IMAGE: ...]</div> in the entry's
    markdown (the operator already drops these as visual prompts)
  - fallback: the entry's `summary` frontmatter field

Backends in order of preference:
  1. RECRAFT_API_KEY → recraft.ai (paid, high quality)
  2. POLLINATIONS_API → pollinations.ai (free, no key needed)
  3. no backend → leave operator-supplied or default cover in place
"""

from __future__ import annotations
import json
import os
import re
import sys
import time
from pathlib import Path

import requests
import yaml

ROOT = Path(__file__).resolve().parents[2]
THOUGHTS = ROOT / "thoughts"
ASSETS_THOUGHTS = ROOT / "assets" / "thoughts"
ASSETS_JSON = THOUGHTS / "assets.json"


def parse_frontmatter(text: str) -> tuple[dict, str]:
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.DOTALL)
    if not m:
        return {}, text
    try:
        return yaml.safe_load(m.group(1)) or {}, m.group(2)
    except yaml.YAMLError:
        return {}, m.group(2)


def first_image_prompt(body: str) -> str | None:
    """Pull the first `[IMAGE: ...]` placeholder text from the body."""
    m = re.search(r"\[IMAGE:\s*(.+?)\]", body, re.DOTALL)
    if not m:
        return None
    return re.sub(r"\s+", " ", m.group(1).strip())


def fetch_recraft(prompt: str, api_key: str) -> bytes | None:
    """Recraft v3 — image-generation. Returns webp bytes on success."""
    try:
        resp = requests.post(
            "https://external.api.recraft.ai/v1/images/generations",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "prompt": prompt,
                "style": "digital_illustration",
                "size": "1820x1024",  # X card-friendly aspect
                "n": 1,
            },
            timeout=90,
        )
        if resp.status_code >= 300:
            print(f"  recraft failed {resp.status_code}: {resp.text[:200]}")
            return None
        url = resp.json().get("data", [{}])[0].get("url")
        if not url:
            return None
        img = requests.get(url, timeout=60)
        if img.status_code >= 300:
            return None
        return img.content
    except Exception as e:
        print(f"  recraft error: {e}")
        return None


def fetch_pollinations(prompt: str) -> bytes | None:
    """Pollinations.ai — free, no key. Plain GET with the prompt path-encoded."""
    try:
        from urllib.parse import quote
        url = f"https://image.pollinations.ai/prompt/{quote(prompt)}?width=1820&height=1024&nologo=true"
        resp = requests.get(url, timeout=120)
        if resp.status_code >= 300 or not resp.content:
            print(f"  pollinations failed {resp.status_code}")
            return None
        return resp.content
    except Exception as e:
        print(f"  pollinations error: {e}")
        return None


def cover_path_for(slug: str) -> Path:
    return ASSETS_THOUGHTS / f"{slug}_cover.webp"


def has_cover(slug: str, meta: dict, assets: dict) -> bool:
    """Already has a usable cover? Skip if (a) frontmatter cover: is set,
    (b) the slug-derived cover file exists, or (c) assets.json has any
    asset listed for this entry's md file (legacy entries)."""
    if meta.get("cover"):
        return True
    if cover_path_for(slug).exists():
        return True
    md_filename = f"{slug}.md"
    items = assets.get(md_filename) or []
    return bool(items and items[0].get("asset"))


def write_cover(slug: str, data: bytes, assets: dict) -> None:
    ASSETS_THOUGHTS.mkdir(parents=True, exist_ok=True)
    out = cover_path_for(slug)
    out.write_bytes(data)
    print(f"  wrote {out.relative_to(ROOT)} ({len(data)} bytes)")
    md_filename = f"{slug}.md"
    entry = assets.setdefault(md_filename, [])
    asset_rel = f"assets/thoughts/{slug}_cover.webp"
    if not any(item.get("asset") == asset_rel for item in entry):
        entry.insert(0, {
            "idx": 0,
            "caption": "auto-generated cover",
            "asset": asset_rel,
        })
    ASSETS_JSON.write_text(json.dumps(assets, indent=2) + "\n")


def main() -> int:
    if not THOUGHTS.exists():
        return 0
    assets = {}
    if ASSETS_JSON.exists():
        try:
            assets = json.loads(ASSETS_JSON.read_text())
        except json.JSONDecodeError:
            assets = {}

    recraft_key = os.environ.get("RECRAFT_API_KEY", "").strip()
    use_recraft = bool(recraft_key)
    use_pollinations = os.environ.get("USE_POLLINATIONS", "1").strip() not in ("0", "false", "False")

    if not use_recraft and not use_pollinations:
        print("no image backend configured (RECRAFT_API_KEY missing and pollinations disabled)")
        return 0

    backend = "recraft" if use_recraft else "pollinations"
    print(f"cover-gen backend: {backend}")

    generated = 0
    for md in sorted(THOUGHTS.glob("*.md")):
        if md.name.startswith(".") or md.name == "README.md":
            continue
        text = md.read_text()
        meta, body = parse_frontmatter(text)
        slug = meta.get("slug") or md.stem
        if has_cover(slug, meta, assets):
            continue
        prompt = first_image_prompt(body) or meta.get("summary") or meta.get("title", slug)
        prompt = f"editorial illustration: {prompt}"[:1000]
        print(f"\n--- {slug} ---")
        print(f"  prompt: {prompt[:120]}…")
        data = None
        if use_recraft:
            data = fetch_recraft(prompt, recraft_key)
        if not data and use_pollinations:
            print("  trying pollinations fallback…")
            data = fetch_pollinations(prompt)
        if data:
            write_cover(slug, data, assets)
            generated += 1
        else:
            print(f"  no cover generated for {slug} — site will use default")
        time.sleep(2)  # be polite, especially with free tier

    print(f"\ngenerated {generated} cover(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
