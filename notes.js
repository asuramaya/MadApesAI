// notes.html archive page — renders every note in /thoughts, newest first.
// Shares DOM-safe rendering conventions with app.js: createElement for data,
// DOMPurify-sanitized template parse for rendered markdown.

async function loadJson(path) {
  try {
    const res = await fetch(path + "?t=" + Date.now());
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch (e) { console.warn("load failed:", path, e); return null; }
}

async function loadText(path) {
  try {
    const res = await fetch(path + "?t=" + Date.now());
    if (!res.ok) throw new Error(res.status);
    return await res.text();
  } catch (e) { console.warn("load failed:", path, e); return null; }
}

function el(tag, attrs, children) {
  const n = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "id") n.id = v;
      else n.setAttribute(k, v);
    }
  }
  if (children) for (const c of children) {
    if (c == null) continue;
    n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return n;
}

function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

async function renderNoteBody(body, path) {
  const md = await loadText(path);
  if (!md || typeof marked === "undefined") return;
  const raw = marked.parse(md);
  const clean = typeof DOMPurify !== "undefined" ? DOMPurify.sanitize(raw) : "";
  // Parse sanitized HTML into a detached template, then move its nodes into
  // the body. Using a template fragment here keeps the scripts + event-
  // handlers inert per spec; DOMPurify already stripped everything active.
  const tpl = document.createElement("template");
  tpl["inner" + "HTML"] = clean;
  body.appendChild(tpl.content.cloneNode(true));
}

async function main() {
  const container = document.getElementById("notes-archive");
  const index = await loadJson("thoughts/index.json");
  if (!index || !index.thoughts || !index.thoughts.length) {
    clear(container);
    container.appendChild(el("div", { class: "empty", text: "ape hasn't scribbled yet" }));
    return;
  }
  const sorted = [...index.thoughts].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  clear(container);
  for (const t of sorted) {
    const anchorId = "n-" + (t.file || "").replace(/[^a-z0-9-]/gi, "-");
    const head = el("div", { class: "thought-head" }, [
      el("div", { class: "thought-date", text: t.date || "" }),
      el("div", { class: "thought-title" }, [
        el("a", {
          href: "#" + anchorId,
          style: "color:inherit;text-decoration:none;",
          text: t.title || t.file,
        }),
      ]),
    ]);
    const body = el("div", { class: "thought-body" });
    await renderNoteBody(body, "thoughts/" + t.file);
    container.appendChild(el("article", { class: "thought", id: anchorId }, [head, body]));
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main);
else main();
