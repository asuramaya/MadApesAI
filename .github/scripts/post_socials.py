#!/usr/bin/env python3
"""Detect new diary entries and post to X + Telegram.

Idempotent via thoughts/.published.json (a list of slugs already posted). Run
on every push to main; only the diff from the tracker fires actual posts.

Required secrets (from GH Actions env):
  X_API_KEY                 — consumer key
  X_API_SECRET              — consumer secret
  X_ACCESS_TOKEN            — user access token (NEEDED for POST /2/tweets)
  X_ACCESS_TOKEN_SECRET     — user access token secret
  TELEGRAM_BOT_TOKEN        — MadApesAIBot token (public diary channel)
  TELEGRAM_CHAT_ID          — signals_chat_id; same channel diary lives in

Both posts share the URL `https://madapesai.com/thoughts/<slug>` so the
og: cards we generated render in both clients automatically.
"""

from __future__ import annotations
import json
import os
import re
import sys
from pathlib import Path

import requests
import yaml
from requests_oauthlib import OAuth1

ROOT = Path(__file__).resolve().parents[2]
THOUGHTS = ROOT / "thoughts"
PUBLISHED = THOUGHTS / ".published.json"
SITE_URL = "https://madapesai.com"


def parse_frontmatter(text: str) -> tuple[dict, str]:
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.DOTALL)
    if not m:
        return {}, text
    try:
        return yaml.safe_load(m.group(1)) or {}, m.group(2)
    except yaml.YAMLError:
        return {}, m.group(2)


def first_paragraph(md_body: str, max_chars: int = 200) -> str:
    for para in re.split(r"\n\s*\n", md_body.strip()):
        cleaned = re.sub(r"<[^>]+>", "", para)
        cleaned = re.sub(r"^[#>*\-+\d.\s]+", "", cleaned)
        cleaned = re.sub(r"\*\*?(.+?)\*\*?", r"\1", cleaned)
        cleaned = re.sub(r"`([^`]+)`", r"\1", cleaned)
        cleaned = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", cleaned)
        cleaned = cleaned.strip()
        if cleaned and not cleaned.startswith("---"):
            if len(cleaned) > max_chars:
                cleaned = cleaned[: max_chars - 1].rstrip() + "…"
            return cleaned
    return ""


def load_published() -> set[str]:
    if not PUBLISHED.exists():
        return set()
    try:
        data = json.loads(PUBLISHED.read_text())
    except json.JSONDecodeError:
        return set()
    return set(data.get("slugs", []))


def save_published(slugs: set[str]) -> None:
    PUBLISHED.write_text(json.dumps({"slugs": sorted(slugs)}, indent=2) + "\n")


def compose_tweet(meta: dict, body: str, slug: str) -> str:
    """Return the tweet body. `tweet:` field in frontmatter wins; otherwise
    composed from title + first paragraph + URL. Hard-capped at 270 chars
    so the URL has room (X auto-counts URLs as 23 chars but we play safe)."""
    url = f"{SITE_URL}/thoughts/{slug}"
    if meta.get("tweet"):
        text = str(meta["tweet"]).strip()
        if url not in text:
            text = f"{text}\n\n{url}"
        return text[:280]
    title = meta.get("title") or slug
    summary = meta.get("summary") or first_paragraph(body, max_chars=160)
    body_text = f"new entry — {title}\n\n{summary}\n\n{url}"
    return body_text[:280]


def post_x(text: str) -> dict:
    key = os.environ.get("X_API_KEY")
    secret = os.environ.get("X_API_SECRET")
    access = os.environ.get("X_ACCESS_TOKEN")
    access_secret = os.environ.get("X_ACCESS_TOKEN_SECRET")
    if not all([key, secret, access, access_secret]):
        missing = [
            n for n, v in [
                ("X_API_KEY", key),
                ("X_API_SECRET", secret),
                ("X_ACCESS_TOKEN", access),
                ("X_ACCESS_TOKEN_SECRET", access_secret),
            ] if not v
        ]
        raise RuntimeError(f"X creds missing: {missing}")
    auth = OAuth1(key, secret, access, access_secret)
    resp = requests.post(
        "https://api.twitter.com/2/tweets",
        json={"text": text},
        auth=auth,
        timeout=20,
    )
    if resp.status_code >= 300:
        raise RuntimeError(f"X POST failed {resp.status_code}: {resp.text}")
    return resp.json()


def post_telegram(text: str, html: bool = False) -> dict:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        raise RuntimeError("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing")
    payload = {
        "chat_id": chat_id,
        "text": text,
        "disable_notification": False,
    }
    if html:
        payload["parse_mode"] = "HTML"
    # Default link preview shows the OG card we generated — that's the whole point.
    resp = requests.post(
        f"https://api.telegram.org/bot{token}/sendMessage",
        json=payload,
        timeout=20,
    )
    if resp.status_code >= 300:
        raise RuntimeError(f"TG POST failed {resp.status_code}: {resp.text}")
    return resp.json()


def main() -> int:
    published = load_published()
    new_entries = []
    for md in sorted(THOUGHTS.glob("*.md")):
        if md.name in {"README.md"} or md.name.startswith("."):
            continue
        text = md.read_text()
        if not text.strip():
            continue
        meta, body = parse_frontmatter(text)
        slug = meta.get("slug") or md.stem
        if slug in published:
            continue
        new_entries.append((md, meta, body, slug))

    if not new_entries:
        print("no new entries to publish")
        return 0

    print(f"found {len(new_entries)} new entr{'y' if len(new_entries) == 1 else 'ies'}")
    failures = 0
    for md, meta, body, slug in new_entries:
        tweet_text = compose_tweet(meta, body, slug)
        url = f"{SITE_URL}/thoughts/{slug}"
        print(f"\n--- {slug} ---")
        print(f"tweet: {tweet_text!r}")

        # Telegram first — it's free and noiseless when it fails.
        tg_text = tweet_text  # same body, TG will auto-render og: card
        any_ok = False
        try:
            post_telegram(tg_text)
            print("✓ telegram posted")
            any_ok = True
        except Exception as e:
            print(f"✗ telegram failed: {e}")
            failures += 1

        # X — may fail if the 2 access tokens aren't configured yet.
        try:
            post_x(tweet_text)
            print("✓ X posted")
            any_ok = True
        except Exception as e:
            print(f"✗ X failed: {e}")
            failures += 1

        # Only mark published when at least one channel succeeded — that way
        # a config-broken first push retries on the next push instead of
        # silently dropping the entry from social distribution forever.
        if any_ok:
            published.add(slug)
        else:
            print(f"  → not marked published; next push will retry {slug}")

    save_published(published)
    print(f"\npublished tracker updated: {PUBLISHED.relative_to(ROOT)}")
    return 0 if failures == 0 else 0  # don't fail the workflow on social-post errors


if __name__ == "__main__":
    raise SystemExit(main())
