 #!/usr/bin/env python3
# focode_to_json.py

from __future__ import annotations

import argparse
import json
import random
import re
import sys
import time
import xml.etree.ElementTree as ET
from collections import deque
from dataclasses import dataclass, asdict
from datetime import datetime, date
from typing import Iterable, Optional
from urllib.parse import urljoin, urlparse, urldefrag

import requests
import urllib.robotparser
from bs4 import BeautifulSoup, Tag

# --- PLAYWRIGHT IMPORT ---
try:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
except ImportError:
    print("Error: playwright not installed. Run: pip install playwright && playwright install chromium", file=sys.stderr)

DEFAULT_ALLOWED_PATH_RE = r"^/(focodemag|focode)[^?#]*$" 

@dataclass
class ContentBlock:
    type: str  # "heading"|"paragraph"|"list"|"quote"|"image"|"code"
    text: Optional[str] = None
    level: Optional[int] = None
    items: Optional[list[str]] = None
    src: Optional[str] = None
    alt: Optional[str] = None

@dataclass
class PageRecord:
    source_url: str
    final_url: str
    slug: str
    title: str
    published_date: Optional[str]
    language: Optional[str]
    text: str
    blocks: list[dict]
    images: list[dict]
    html: str

# --- RENDERER CLASS ---
class JSRenderer:
    def __init__(self, user_agent: str, timeout_s: float, wait_selector: str | None = None, headless: bool = True):
        self.timeout_ms = int(timeout_s * 1000)
        self.wait_selector = wait_selector
        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(headless=headless)
        self._ctx = self._browser.new_context(user_agent=user_agent)
        self._page = self._ctx.new_page()

    def close(self):
        try:
            self._ctx.close()
            self._browser.close()
        finally:
            self._pw.stop()

    def get(self, url: str) -> tuple[str, str]:
        # Wait until DOM is loaded
        self._page.goto(url, wait_until="domcontentloaded", timeout=self.timeout_ms)

        if self.wait_selector:
            try:
                self._page.wait_for_selector(self.wait_selector, timeout=self.timeout_ms)
            except PlaywrightTimeoutError:
                print(f"[WARN] Timeout waiting for selector: {self.wait_selector}")
        else:
            # Short sleep to allow Angular components to boot
            self._page.wait_for_timeout(1000)

        # Allow network activity to settle
        try:
            self._page.wait_for_load_state("networkidle", timeout=3000)
        except PlaywrightTimeoutError:
            pass

        return self._page.content(), self._page.url

# --- UTILS ---
def normalize_ws(s: str) -> str:
    s = re.sub(r"[ \t\r\f\v]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()

def get_slug(u: str) -> str:
    path = urlparse(u).path.rstrip("/")
    return path.split("/")[-1] if path else "home"

def parse_date_from_slug(slug: str) -> Optional[str]:
    m = re.search(r"(\d{2})(\d{2})(\d{2})", slug)
    if not m: return None
    dd, mm, yy = map(int, m.groups())
    year = 2000 + yy if yy < 70 else 1900 + yy
    try:
        return date(year, mm, dd).isoformat()
    except ValueError: return None

def absolutize(url: str, base: str) -> str:
    return urljoin(base, url)

def same_site(a: str, b: str) -> bool:
    return urlparse(a).netloc.lower() == urlparse(b).netloc.lower()

def is_http_url(u: str) -> bool:
    return urlparse(u).scheme in ("http", "https")

def strip_unwanted(container: Tag) -> None:
    for sel in ["script", "style", "noscript", "svg", "form", "iframe", "header", "footer", "nav", "aside"]:
        for t in container.select(sel):
            t.decompose()
    noise_kw = re.compile(r"(share|social|comment|related|cookie|ads?|promo|newsletter)", re.I)
        # Remove common “noise” by class/id keywords
    noise_kw = re.compile(r"(share|social|comment|related|cookie|ads?|promo|newsletter)", re.I)

    # IMPORTANT: iterate bottom-up; decomposing a parent decomposes its children too
    for t in list(container.find_all(True))[::-1]:
        attrs = getattr(t, "attrs", None)
        if attrs is None:
            continue

        cls_val = attrs.get("class", [])
        if isinstance(cls_val, (list, tuple)):
            cls = " ".join(cls_val)
        else:
            cls = str(cls_val or "")

        tid = attrs.get("id", "") or ""

        if noise_kw.search(cls) or noise_kw.search(tid):
            t.decompose()


def pick_content_container(soup: BeautifulSoup, content_css: Optional[str]) -> Tag:
    if content_css:
        hit = soup.select_one(content_css)
        if isinstance(hit, Tag): return hit
    for sel in ["article", "main", "div.entry-content", "div.post-content", "div.post-body"]:
        hit = soup.select_one(sel)
        if isinstance(hit, Tag): return hit
    return soup.body if soup.body else soup

def extract_title(soup: BeautifulSoup) -> str:
    for meta_sel in [('meta', {"property": "og:title"}), ('meta', {"name": "twitter:title"})]:
        tag = soup.find(*meta_sel)
        if tag and tag.get("content"): return normalize_ws(tag["content"])
    h1 = soup.find("h1")
    if h1: return normalize_ws(h1.get_text(" ", strip=True))
    return normalize_ws(soup.title.string) if soup.title else ""

def extract_lang(soup: BeautifulSoup) -> Optional[str]:
    html = soup.find("html")
    return html.get("lang") if html and html.get("lang") else None

def extract_published_date(soup: BeautifulSoup, slug: str) -> Optional[str]:
    for attrs in [{"property": "article:published_time"}, {"name": "article:published_time"}, {"name": "date"}, {"itemprop": "datePublished"}]:
        t = soup.find("meta", attrs=attrs)
        if t and t.get("content"):
            try: return datetime.fromisoformat(t["content"].strip().replace("Z", "+00:00")).date().isoformat()
            except: pass
    tm = soup.find("time")
    if tm and tm.get("datetime"):
        try: return datetime.fromisoformat(tm["datetime"].strip().replace("Z", "+00:00")).date().isoformat()
        except: pass
    return parse_date_from_slug(slug)

def extract_blocks(container: Tag, base_url: str) -> tuple[list[ContentBlock], list[dict]]:
    blocks: list[ContentBlock] = []
    images: list[dict] = []
    def add_image(img: Tag):
        src = img.get("src") or img.get("data-src") or ""
        if not src: return
        src = absolutize(src, base_url)
        alt = img.get("alt") or None
        images.append({"src": src, "alt": alt})
        blocks.append(ContentBlock(type="image", src=src, alt=alt))

    for el in container.find_all(["h1", "h2", "h3", "h4", "h5", "p", "ul", "ol", "blockquote", "pre", "img"], recursive=True):
        if not isinstance(el, Tag): continue
        name = el.name.lower()
        if name == "img": add_image(el)
        elif name.startswith("h"):
            txt = normalize_ws(el.get_text(" ", strip=True))
            if txt: blocks.append(ContentBlock(type="heading", level=int(name[1]), text=txt))
        elif name == "p":
            imgs = el.find_all("img")
            if imgs and normalize_ws(el.get_text(" ", strip=True)) == "":
                for i in imgs: add_image(i)
            else:
                txt = normalize_ws(el.get_text(" ", strip=True))
                if txt: blocks.append(ContentBlock(type="paragraph", text=txt))
        elif name in ("ul", "ol"):
            items = [normalize_ws(li.get_text(" ", strip=True)) for li in el.find_all("li", recursive=False) if normalize_ws(li.get_text())]
            if items: blocks.append(ContentBlock(type="list", items=items))
        elif name == "blockquote":
            txt = normalize_ws(el.get_text(" ", strip=True))
            if txt: blocks.append(ContentBlock(type="quote", text=txt))
        elif name == "pre":
            txt = el.get_text("\n", strip=True).strip("\n")
            if txt: blocks.append(ContentBlock(type="code", text=txt))
    return blocks, images

def blocks_to_text(blocks: list[ContentBlock]) -> str:
    parts = []
    for b in blocks:
        if b.type in ("heading", "paragraph", "quote") and b.text: parts.append(b.text)
        elif b.type == "list" and b.items: parts.extend([f"- {i}" for i in b.items])
        elif b.type == "code" and b.text: parts.append(b.text)
    return normalize_ws("\n".join(parts))

def discover_sitemaps(base: str, session: requests.Session, timeout: float) -> list[str]:
    sitemaps = []
    try:
        r = session.get(urljoin(base, "/robots.txt"), timeout=timeout)
        if r.ok:
            for line in r.text.splitlines():
                if line.lower().startswith("sitemap:"):
                    sitemaps.append(line.split(":", 1)[1].strip())
    except: pass
    sitemaps.extend([urljoin(base, "/sitemap_index.xml"), urljoin(base, "/sitemap.xml")])
    return list(dict.fromkeys(sitemaps))

def parse_sitemap_urls(sitemap_xml: str) -> list[str]:
    urls = []
    try:
        root = ET.fromstring(sitemap_xml)
        ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        if root.tag.endswith("sitemapindex"):
            urls = [loc.text.strip() for loc in root.findall(".//sm:sitemap/sm:loc", ns) if loc.text]
        elif root.tag.endswith("urlset"):
            urls = [loc.text.strip() for loc in root.findall(".//sm:url/sm:loc", ns) if loc.text]
    except: pass
    return urls

def build_robot_parser(base: str, session: requests.Session, timeout: float) -> Optional[urllib.robotparser.RobotFileParser]:
    rp = urllib.robotparser.RobotFileParser()
    try:
        r = session.get(urljoin(base, "/robots.txt"), timeout=timeout)
        if r.ok:
            rp.parse(r.text.splitlines())
            return rp
    except: pass
    return None

def fetch(session: requests.Session, url: str, timeout: float, retries: int) -> tuple[str, str]:
    last_err = None
    for attempt in range(retries + 1):
        try:
            resp = session.get(url, timeout=timeout, allow_redirects=True)
            resp.raise_for_status()
            resp.encoding = resp.apparent_encoding or resp.encoding
            return resp.text, resp.url
        except Exception as e:
            last_err = e
            if attempt < retries: time.sleep(0.8 * (2 ** attempt) + random.random() * 0.2)
    raise RuntimeError(f"Fetch failed for {url}: {last_err}")

# --- MAIN CRAWL LOGIC ---
def crawl_and_export(
    start_url: str, out_path: str, max_pages: int, sleep_s: float, timeout: float,
    retries: int, user_agent: str, obey_robots: bool, allowed_path_re: str,
    content_css: Optional[str], fmt: str, use_js: bool, wait_selector: Optional[str], headed: bool
) -> None:
    allowed_re = re.compile(allowed_path_re)
    session = requests.Session()
    session.headers.update({"User-Agent": user_agent})
    rp = build_robot_parser(start_url, session, timeout) if obey_robots else None
    
    renderer = None
    if use_js:
        renderer = JSRenderer(user_agent, timeout, wait_selector, not headed)

    def allowed(u: str) -> bool:
        if not is_http_url(u) or not same_site(u, start_url): return False
        if not allowed_re.match(urlparse(u).path): return False
        if rp and not rp.can_fetch(user_agent, u): return False
        return True

    queue, seen, records = deque(), set(), []
    def enqueue(u: str):
        u = urldefrag(u)[0]
        if u and u not in seen and allowed(u):
            seen.add(u)
            queue.append(u)

    # Sitemap Discovery
    for sm in discover_sitemaps(start_url, session, timeout):
        try:
            xml, _ = fetch(session, sm, timeout, retries)
            urls = parse_sitemap_urls(xml)
            for u in urls:
                if u.endswith(".xml"): # Nested sitemap
                    nxml, _ = fetch(session, u, timeout, retries)
                    for nu in parse_sitemap_urls(nxml): enqueue(nu)
                else: enqueue(u)
        except: continue

    if not queue: enqueue(start_url)

    try:
        while queue and len(records) < max_pages:
            url = queue.popleft()
            print(f"[FETCHING] {url}")
            try:
                if renderer:
                    html, final_url = renderer.get(url)
                else:
                    html, final_url = fetch(session, url, timeout, retries)
            except Exception as e:
                print(f"[WARN] {e}", file=sys.stderr)
                continue

            soup = BeautifulSoup(html, "lxml")
            # Extract links
            for a in soup.find_all("a", href=True):
                href = a.get("href", "").strip()
                if href and not href.startswith(("mailto:", "tel:", "javascript:")):
                    enqueue(absolutize(href, final_url))

            slug = get_slug(final_url)
            container = pick_content_container(soup, content_css)
            if isinstance(container, Tag): strip_unwanted(container)

            blocks, images = extract_blocks(container, final_url) if isinstance(container, Tag) else ([], [])
            text = blocks_to_text(blocks) or normalize_ws(soup.get_text("\n", strip=True))

            records.append(PageRecord(
                source_url=url, final_url=final_url, slug=slug, title=extract_title(soup) or slug,
                published_date=extract_published_date(soup, slug), language=extract_lang(soup),
                text=text, blocks=[asdict(b) for b in blocks], images=images,
                html=str(container) if isinstance(container, Tag) else ""
            ))
            if sleep_s > 0: time.sleep(sleep_s + random.random() * 0.15)
    finally:
        if renderer: renderer.close()

    # Export
    with open(out_path, "w", encoding="utf-8") as f:
        if fmt == "json":
            json.dump([asdict(r) for r in records], f, ensure_ascii=False, indent=2)
        else:
            for r in records: f.write(json.dumps(asdict(r), ensure_ascii=False) + "\n")

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="https://www.focode.org/")
    ap.add_argument("--out", default="focode_export.jsonl")
    ap.add_argument("--max-pages", type=int, default=500)
    ap.add_argument("--sleep", type=float, default=0.6)
    ap.add_argument("--timeout", type=float, default=20.0)
    ap.add_argument("--retries", type=int, default=3)
    ap.add_argument("--user-agent", default="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
    ap.add_argument("--no-robots", action="store_true")
    ap.add_argument("--allowed-path-re", default=DEFAULT_ALLOWED_PATH_RE)
    ap.add_argument("--content-css", default=None)
    ap.add_argument("--format", choices=["json", "jsonl"], default="jsonl")
    ap.add_argument("--js", action="store_true", help="Use Playwright for JS rendering")
    ap.add_argument("--wait-selector", default=None)
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()

    crawl_and_export(
        args.start, args.out, args.max_pages, args.sleep, args.timeout, args.retries,
        args.user_agent, not args.no_robots, args.allowed_path_re, args.content_css,
        args.format, args.js, args.wait_selector, args.headed
    )

    py .\parser.py --js --start "https://focode.org/focodemag" --allowed-path-re "^/focodemag.*$" --out ".\focode_export.jsonl" --format jsonl --max-pages 2000


if __name__ == "__main__":
    main()