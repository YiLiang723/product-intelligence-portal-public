const fs = require("fs");
const path = require("path");
const vm = require("vm");

const privateHtmlPath = "C:\\Users\\liangyi\\Documents\\product-intelligence-portal\\index.html";
const publicHtmlPath = path.join(__dirname, "index.html");
const publicReadmePath = path.join(__dirname, "README.md");
const summaryPath = path.join(__dirname, "weekly-summary.json");

const INITIAL_VISIBLE = 6;
const BASELINE_DAYS = 90;

function readPrivateKb() {
  const html = fs.readFileSync(privateHtmlPath, "utf8");
  const start = html.indexOf("const KB = ");
  const end = html.indexOf("\n    const PAGES = {", start);
  if (start < 0 || end < 0) {
    throw new Error("Unable to locate KB object in private portal.");
  }
  const literal = html.slice(start + "const KB = ".length, end).trim().replace(/;\s*$/, "");
  return vm.runInNewContext("(" + literal + ")", {
    mcLink: id => `https://lynx.office.net/messagecenter/${id}`
  });
}

function readWeeklySummary() {
  try {
    const raw = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
    if (raw && (raw.intro || (raw.sections && raw.sections.length) || raw.text)) return raw;
    return null;
  } catch (e) {
    return null;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sortRecords(records) {
  return records.slice().sort((a, b) => `${b.date}|${b.updatedAt || ""}`.localeCompare(`${a.date}|${a.updatedAt || ""}`));
}

// Bilingual helper: emit both zh and en variants; CSS shows only the active one.
// zh/en are already-safe HTML fragments. tag/attrs let callers reuse element styling.
function bi(zh, en, tag = "span", attrs = "") {
  const a = attrs ? " " + attrs : "";
  return `<${tag} data-l="zh"${a}>${zh}</${tag}><${tag} data-l="en"${a}>${en}</${tag}>`;
}

function toPublicData(kb) {
  const sources = (kb.officialSources || []).filter(s => s.type !== "Message Center" && s.url);
  return {
    generatedAt: kb.generatedAt,
    version: kb.version || "1.0",
    groups: [
      { id: "m365-copilot", label: "M365 Copilot", records: sortRecords(kb.productCopilot || []) },
      { id: "copilot-studio", label: "Copilot Studio", records: sortRecords(kb.productPowerPlatform || []) },
      { id: "azure-ai", label: "Azure AI", records: sortRecords(kb.productAzureAI || []) }
    ],
    sources: {
      learn: sources.filter(s => s.type === "Microsoft Learn"),
      blog: sources.filter(s => s.type === "官方博客"),
      roadmap: sources.filter(s => s.type === "Roadmap"),
      adoption: sources.filter(s => s.type === "采用资源")
    }
  };
}

function clip(text, max) {
  const s = String(text || "");
  return s.length > max ? escapeHtml(s.slice(0, max)) + "…" : escapeHtml(s);
}

function urlOf(item) {
  return item.sourceLinks && item.sourceLinks[0] ? item.sourceLinks[0].url : "";
}

function renderFeatureCard(group) {
  const item = group.records[0];
  if (!item) {
    return `
        <article class="feature-card">
          <span class="chip">${escapeHtml(group.label)}</span>
          ${bi("暂无公开更新", "No public updates yet", "h3")}
          ${bi("当前没有可展示的新增内容。", "There are no new items to show right now.", "p", 'class="feature-desc"')}
        </article>`;
  }
  const url = urlOf(item);
  return `
        <article class="feature-card">
          <div class="feature-top">
            <span class="chip">${escapeHtml(group.label)}</span>
            <span class="feature-date">${escapeHtml(item.date)}</span>
          </div>
          <h3>${escapeHtml(item.title)}</h3>
          <p class="feature-desc">${clip(item.summary, 130)}</p>
          <div class="feature-actions">
            <a class="btn primary" href="#${escapeHtml(group.id)}">${bi("查看该分区", "View section")}</a>
            ${url ? `<a class="btn ghost" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${bi("打开原文", "Open source")}</a>` : ""}
          </div>
        </article>`;
}

function renderItem(item, hidden) {
  const url = urlOf(item);
  const titleHtml = url
    ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a>`
    : escapeHtml(item.title);
  return `
          <article class="item${hidden ? " is-hidden" : ""}">
            <div class="item-top">
              <span class="item-date">${escapeHtml(item.date)}</span>
              <span class="item-source">${escapeHtml(item.source)}</span>
            </div>
            <h3 class="item-title">${titleHtml}</h3>
            <p class="item-desc">${clip(item.summary, 150)}</p>
          </article>`;
}

function renderGroupSection(group) {
  const total = group.records.length;
  const items = group.records.map((item, i) => renderItem(item, i >= INITIAL_VISIBLE)).join("");
  const moreBtn = total > INITIAL_VISIBLE
    ? `<div class="more-wrap"><button class="more-btn" type="button" data-target="${escapeHtml(group.id)}" data-total="${total}"></button></div>`
    : "";
  return `
    <section class="section" id="${escapeHtml(group.id)}">
      <div class="section-head">
        <h2>${escapeHtml(group.label)}</h2>
        <span class="section-count">${bi(`近 ${BASELINE_DAYS} 天累计 ${total} 条`, `${total} in last ${BASELINE_DAYS} days`)}</span>
      </div>
      <div class="item-grid" data-group="${escapeHtml(group.id)}">
${items || `<div class="empty">${bi("当前暂无公开更新", "No public updates yet")}</div>`}
      </div>
      ${moreBtn}
    </section>`;
}

function renderSourceGroup(labelHtml, list) {
  if (!list.length) return "";
  const links = list.map(s => {
    let host = "";
    try { host = new URL(s.url).host; } catch (e) { host = ""; }
    return `<a class="source-link" href="${escapeHtml(s.url)}" target="_blank" rel="noreferrer"><span>${escapeHtml(s.name)}</span><small>${escapeHtml(host)}</small></a>`;
  }).join("");
  return `
        <div class="source-col">
          <div class="source-col-title">${labelHtml}</div>
          ${links}
        </div>`;
}

function buildHtml(data, summary) {
  const total = data.groups.reduce((sum, g) => sum + g.records.length, 0);
  const navPills = data.groups.map(g =>
    `<a class="nav-pill" href="#${escapeHtml(g.id)}"><span>${escapeHtml(g.label)}</span><b>${g.records.length}</b></a>`
  ).join("");
  const features = data.groups.map(renderFeatureCard).join("");
  const sections = data.groups.map(renderGroupSection).join("\n");
  const refreshText = escapeHtml(data.generatedAt).replace("T", " ").replace("+08:00", "");
  const summaryBlock = summary
    ? `
    <article class="summary-card">
      <div class="summary-head">
        <span class="chip">${bi("AI 本周趋势", "AI Weekly Trends")}</span>
        <span class="feature-date">${bi(`截至 ${refreshText}`, `As of ${refreshText}`)}</span>
      </div>
      ${summary.intro ? bi(escapeHtml(summary.intro), escapeHtml(summary.intro_en || summary.intro), "p", 'class="summary-intro"') : ""}
      ${summary.text ? bi(escapeHtml(summary.text), escapeHtml(summary.text_en || summary.text), "p", 'class="summary-intro"') : ""}
      ${(summary.sections || []).map(sec => {
        const titleZh = `${escapeHtml(sec.emoji || "")} ${escapeHtml(sec.title || "")}`;
        const titleEn = `${escapeHtml(sec.emoji || "")} ${escapeHtml(sec.title_en || sec.title || "")}`;
        const ptsZh = (sec.points || []).map(p => `<li>${escapeHtml(p)}</li>`).join("");
        const enPts = (sec.points_en && sec.points_en.length) ? sec.points_en : (sec.points || []);
        const ptsEn = enPts.map(p => `<li>${escapeHtml(p)}</li>`).join("");
        return `
      <div class="summary-section">
        ${bi(titleZh, titleEn, "div", 'class="summary-section-title"')}
        <ul class="summary-points" data-l="zh">${ptsZh}</ul>
        <ul class="summary-points" data-l="en">${ptsEn}</ul>
      </div>`;
      }).join("")}
    </article>`
    : "";
  const sourcesHtml = [
    renderSourceGroup(bi("Microsoft Learn", "Microsoft Learn"), data.sources.learn),
    renderSourceGroup(bi("官方博客", "Official Blogs"), data.sources.blog),
    renderSourceGroup(bi("Roadmap", "Roadmap"), data.sources.roadmap),
    renderSourceGroup(bi("采用资源", "Adoption Resources"), data.sources.adoption)
  ].join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Microsoft 产品更新公开版 · Product Updates</title>
  <script>
    (() => {
      const param = new URLSearchParams(window.location.search).get("scoutTheme");
      const theme =
        param || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      document.documentElement.setAttribute("data-theme", theme);
    })();
    (() => {
      const url = new URLSearchParams(window.location.search);
      const q = url.get("lang") || url.get("scoutLang");
      let stored = null;
      try { stored = localStorage.getItem("scoutLang"); } catch (e) {}
      const lang = (q === "en" || q === "zh") ? q : ((stored === "en" || stored === "zh") ? stored : "zh");
      document.documentElement.setAttribute("data-lang", lang);
      document.documentElement.setAttribute("lang", lang === "en" ? "en" : "zh-CN");
    })();
  </script>
  <style>
    /* Bilingual visibility — only the active language renders */
    html[data-lang="en"] [data-l="zh"] { display: none !important; }
    html:not([data-lang="en"]) [data-l="en"] { display: none !important; }
    :root {
      color-scheme: light;
      --cp-bg: #f7f4ef;
      --cp-bg-elevated: #fcfbf8;
      --cp-surface: #ffffff;
      --cp-surface-soft: #f5f5f5;
      --cp-border: #e4e0da;
      --cp-border-strong: #cfc9c1;
      --cp-text: #242424;
      --cp-text-muted: #5c5c5c;
      --cp-text-soft: #8a8580;
      --cp-accent: #b11f4b;
      --cp-accent-hover: #9a1a41;
      --cp-accent-soft: rgba(177, 31, 75, 0.08);
      --cp-accent-fg: #ffffff;
      --cp-link: #0078d4;
      --cp-card-shadow: 0 0 2px rgba(0,0,0,0.10), 0 1px 2px rgba(0,0,0,0.10);
    }
    html[data-theme="dark"] {
      color-scheme: dark;
      --cp-bg: #221f1e;
      --cp-bg-elevated: #2a2726;
      --cp-surface: #2c2928;
      --cp-surface-soft: #33302e;
      --cp-border: #423e3c;
      --cp-border-strong: #55504d;
      --cp-text: #ececec;
      --cp-text-muted: #b6b1ac;
      --cp-text-soft: #8f8a85;
      --cp-accent: #fd8ea1;
      --cp-accent-hover: #fb7b91;
      --cp-accent-soft: rgba(253, 142, 161, 0.14);
      --cp-accent-fg: #1a1a1a;
      --cp-link: #7fbfff;
      --cp-card-shadow: 0 0 2px rgba(0,0,0,0.30), 0 1px 2px rgba(0,0,0,0.30);
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      background: var(--cp-bg);
      color: var(--cp-text);
      font-family: "Segoe UI", Aptos, Calibri, -apple-system, BlinkMacSystemFont, sans-serif;
      line-height: 1.6;
    }
    a { color: var(--cp-link); text-decoration: none; }
    .shell { max-width: 1160px; margin: 0 auto; padding: 40px 24px 64px; }

    /* Hero */
    .hero { margin-bottom: 4px; position: relative; padding-right: 132px; }
    .eyebrow { margin: 0 0 10px; color: var(--cp-accent); font-size: 12px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
    h1 { margin: 0; font-size: clamp(30px, 4.4vw, 46px); line-height: 1.1; letter-spacing: -0.03em; }
    .hero-desc { margin: 16px 0 0; color: var(--cp-text-muted); max-width: 100%; font-size: 16px; }
    .hero-meta { margin-top: 18px; display: flex; flex-wrap: wrap; gap: 8px; }
    .meta-tag {
      display: inline-flex;
      align-items: center;
      padding: 6px 11px;
      border-radius: 999px;
      border: 1px solid var(--cp-border);
      background: var(--cp-surface);
      color: var(--cp-text-muted);
      font-size: 12px;
      font-weight: 600;
    }
    .meta-tag.accent { border-color: var(--cp-accent); background: var(--cp-accent-soft); color: var(--cp-accent); }

    /* Sticky anchor nav (below hero) */
    .anchor-nav {
      position: sticky;
      top: 0;
      z-index: 20;
      margin: 24px 0 8px;
      padding: 12px 16px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      border: 1px solid var(--cp-border);
      border-radius: 14px;
      background: var(--cp-surface);
      box-shadow: var(--cp-card-shadow);
    }
    .nav-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 12px;
      border-radius: 999px;
      border: 1px solid var(--cp-border);
      background: var(--cp-surface);
      color: var(--cp-text);
      font-size: 13px;
      font-weight: 600;
    }
    .nav-pill b {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 22px;
      height: 20px;
      padding: 0 6px;
      border-radius: 999px;
      background: var(--cp-accent-soft);
      color: var(--cp-accent);
      font-size: 12px;
    }
    .nav-pill:hover { border-color: var(--cp-accent); }
    .nav-legend { margin-left: auto; color: var(--cp-text-soft); font-size: 12px; }
    .lang-toggle {
      position: absolute;
      top: 2px;
      right: 0;
      display: inline-flex;
      border: 1px solid var(--cp-border-strong);
      border-radius: 999px;
      overflow: hidden;
      background: var(--cp-surface);
      box-shadow: var(--cp-card-shadow);
      z-index: 30;
    }
    .lang-btn {
      padding: 7px 15px;
      font-size: 12px;
      font-weight: 700;
      background: var(--cp-surface);
      color: var(--cp-text-muted);
      border: none;
      cursor: pointer;
      line-height: 1.4;
    }
    .lang-btn + .lang-btn { border-left: 1px solid var(--cp-border-strong); }
    .lang-btn.active { background: var(--cp-accent); color: var(--cp-accent-fg); }
    .lang-btn:not(.active):hover { color: var(--cp-accent); }

    /* Section headers */
    .block-title {
      margin: 40px 0 4px;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
      color: var(--cp-text-soft);
    }
    .section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 16px 0 14px; }
    .section-head h2 { margin: 0; font-size: 22px; letter-spacing: -0.01em; }
    .section-count { color: var(--cp-text-soft); font-size: 13px; font-weight: 600; white-space: nowrap; }

    /* AI summary card */
    .summary-card {
      margin: 14px 0 18px;
      padding: 22px 24px;
      border: 1px solid var(--cp-border);
      border-left: 4px solid var(--cp-accent);
      border-radius: 16px;
      background: var(--cp-surface);
      box-shadow: var(--cp-card-shadow);
    }
    .summary-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
    .summary-intro { margin: 0 0 16px; color: var(--cp-text); font-size: 15px; line-height: 1.85; }
    .summary-section { margin-top: 14px; }
    .summary-section-title {
      font-size: 15px;
      font-weight: 800;
      color: var(--cp-accent);
      margin-bottom: 6px;
    }
    .summary-points {
      margin: 0;
      padding-left: 0;
      list-style: none;
      display: grid;
      gap: 8px;
    }
    .summary-points li {
      color: var(--cp-text);
      font-size: 14.5px;
      line-height: 1.7;
      padding-left: 2px;
    }

    /* Feature cards */
    .feature-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    .feature-card {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 20px;
      border: 1px solid var(--cp-border);
      border-radius: 16px;
      background: var(--cp-surface);
      box-shadow: var(--cp-card-shadow);
    }
    .feature-top { display: flex; align-items: center; justify-content: space-between; }
    .chip {
      display: inline-flex;
      align-items: center;
      padding: 5px 11px;
      border-radius: 999px;
      background: var(--cp-accent-soft);
      color: var(--cp-accent);
      font-size: 12px;
      font-weight: 700;
    }
    .feature-date { color: var(--cp-text-soft); font-size: 12px; font-weight: 600; }
    .feature-card h3 { margin: 0; font-size: 17px; line-height: 1.4; }
    .feature-desc { margin: 0; color: var(--cp-text-muted); font-size: 14px; flex: 1; }
    .feature-actions { display: flex; gap: 8px; }
    .btn {
      display: inline-flex;
      align-items: center;
      padding: 8px 14px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 700;
      border: 1px solid transparent;
    }
    .btn.primary { background: var(--cp-accent); color: var(--cp-accent-fg); }
    .btn.primary:hover { background: var(--cp-accent-hover); }
    .btn.ghost { background: transparent; border-color: var(--cp-border-strong); color: var(--cp-text); }
    .btn.ghost:hover { border-color: var(--cp-accent); color: var(--cp-accent); }

    /* Item grid */
    .item-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .item {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 16px 18px;
      border: 1px solid var(--cp-border);
      border-radius: 14px;
      background: var(--cp-surface);
      box-shadow: var(--cp-card-shadow);
    }
    .item.is-hidden { display: none; }
    .item-top { display: flex; align-items: center; gap: 10px; }
    .item-date { font-size: 12px; font-weight: 700; color: var(--cp-text); }
    .item-source {
      font-size: 11px;
      font-weight: 600;
      color: var(--cp-text-soft);
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--cp-surface-soft);
    }
    .item-title { margin: 0; font-size: 15px; line-height: 1.45; }
    .item-title a { color: var(--cp-text); }
    .item-title a:hover { color: var(--cp-accent); }
    .item-desc { margin: 0; color: var(--cp-text-muted); font-size: 13px; }
    .empty { padding: 28px; text-align: center; color: var(--cp-text-soft); }

    .more-wrap { margin-top: 14px; text-align: center; }
    .more-btn {
      padding: 9px 18px;
      border-radius: 999px;
      border: 1px solid var(--cp-border-strong);
      background: var(--cp-surface);
      color: var(--cp-text);
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }
    .more-btn:hover { border-color: var(--cp-accent); color: var(--cp-accent); }

    /* Sources / footer */
    .sources {
      margin-top: 20px;
      padding: 22px 24px;
      border: 1px solid var(--cp-border);
      border-radius: 16px;
      background: var(--cp-surface);
      box-shadow: var(--cp-card-shadow);
    }
    .sources-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px; }
    .source-col-title {
      margin-bottom: 10px;
      font-size: 13px;
      font-weight: 700;
      color: var(--cp-accent);
    }
    .source-link {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 8px 0;
      border-top: 1px solid var(--cp-border);
      color: var(--cp-text);
      font-size: 13px;
    }
    .source-link:hover { color: var(--cp-accent); }
    .source-link small { color: var(--cp-text-soft); font-size: 11px; }
    .footer-meta {
      margin-top: 18px;
      color: var(--cp-text-soft);
      font-size: 13px;
    }

    @media (max-width: 900px) {
      .feature-grid { grid-template-columns: 1fr; }
      .item-grid { grid-template-columns: 1fr; }
      .sources-grid { grid-template-columns: 1fr 1fr; }
      .nav-legend { margin-left: 0; width: 100%; }
      .hero { padding-right: 108px; }
    }
    @media (max-width: 560px) {
      .sources-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="hero" id="top">
      <span class="lang-toggle" role="group" aria-label="Language">
        <button type="button" class="lang-btn" data-lang="zh">中文</button>
        <button type="button" class="lang-btn" data-lang="en">EN</button>
      </span>
      <p class="eyebrow">${bi("公开产品更新", "Public product updates")}</p>
      ${bi("Microsoft 产品更新公开版", "Microsoft Product Updates · Public Edition", "h1")}
      ${bi(
        "聚合 Microsoft 官方产品更新（M365 Copilot、Copilot Studio、Azure AI），仅保留适合公开分享的内容，数据每日自动更新。",
        "Aggregated official Microsoft product updates (M365 Copilot, Copilot Studio, Azure AI). Only publicly shareable content is kept, refreshed automatically every day.",
        "p", 'class="hero-desc"'
      )}
      <div class="hero-meta">
        ${bi(`最新更新 ${refreshText}`, `Last updated ${refreshText}`, "span", 'class="meta-tag accent"')}
        ${bi(`版本 V${escapeHtml(data.version)}`, `Version V${escapeHtml(data.version)}`, "span", 'class="meta-tag"')}
        ${bi(`近 ${BASELINE_DAYS} 天累计 ${total} 条`, `${total} updates · last ${BASELINE_DAYS} days`, "span", 'class="meta-tag"')}
      </div>
    </header>

    <nav class="anchor-nav">
      <a class="nav-pill" href="#top"><span>${bi("概览", "Overview")}</span><b>${total}</b></a>
      ${navPills}
      ${bi(`数字 = 近 ${BASELINE_DAYS} 天累计更新条数`, `Number = updates in the last ${BASELINE_DAYS} days`, "span", 'class="nav-legend"')}
    </nav>

    ${bi("本周重点", "This Week's Highlights", "div", 'class="block-title"')}
${summaryBlock}
    <div class="feature-grid">
${features}
    </div>

    ${bi("按产品浏览", "Browse by Product", "div", 'class="block-title"')}
${sections}

    ${bi("数据来源与刷新", "Sources & Refresh", "div", 'class="block-title"')}
    <div class="sources">
      <div class="sources-grid">
${sourcesHtml}
      </div>
      <div class="footer-meta">
        ${bi(
          `本站数据由自动化每日抓取上述官方公开来源并去重整理。最近刷新时间：${refreshText}（北京时间）。当前版本 V${escapeHtml(data.version)}，近 ${BASELINE_DAYS} 天累计 ${total} 条更新。`,
          `Data is aggregated and de-duplicated daily from the official public sources above. Last refreshed: ${refreshText} (Beijing time). Version V${escapeHtml(data.version)}, ${total} updates in the last ${BASELINE_DAYS} days.`,
          "span"
        )}
      </div>
    </div>
  </div>

  <script>
    const INITIAL_VISIBLE = ${INITIAL_VISIBLE};
    const MORE_LABELS = {
      showAll: { zh: n => "查看全部 " + n + " 条 ▾", en: n => "Show all " + n + " ▾" },
      collapse: { zh: "收起 ▴", en: "Collapse ▴" }
    };

    function currentLang() {
      return document.documentElement.getAttribute("data-lang") === "en" ? "en" : "zh";
    }

    function updateMoreButtons() {
      const lang = currentLang();
      document.querySelectorAll(".more-btn").forEach(btn => {
        const grid = document.querySelector('[data-group="' + btn.dataset.target + '"]');
        if (!grid) return;
        const collapsed = grid.querySelector(".item.is-hidden") !== null;
        btn.textContent = collapsed
          ? MORE_LABELS.showAll[lang](btn.dataset.total)
          : MORE_LABELS.collapse[lang];
      });
    }

    function setLang(lang) {
      lang = lang === "en" ? "en" : "zh";
      document.documentElement.setAttribute("data-lang", lang);
      document.documentElement.setAttribute("lang", lang === "en" ? "en" : "zh-CN");
      try { localStorage.setItem("scoutLang", lang); } catch (e) {}
      document.querySelectorAll(".lang-btn").forEach(b =>
        b.classList.toggle("active", b.dataset.lang === lang)
      );
      updateMoreButtons();
    }

    document.querySelectorAll(".lang-btn").forEach(b =>
      b.addEventListener("click", () => setLang(b.dataset.lang))
    );

    // Allow the host page (e.g. ABS Hub) to sync the iframe language live.
    window.addEventListener("message", e => {
      const d = e.data;
      if (d && (d.type === "setLang" || d.type === "scout:setLang") && (d.lang === "en" || d.lang === "zh")) {
        setLang(d.lang);
      }
    });

    document.querySelectorAll(".more-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const grid = document.querySelector('[data-group="' + btn.dataset.target + '"]');
        if (!grid) return;
        const hidden = grid.querySelectorAll(".item.is-hidden");
        if (hidden.length) {
          hidden.forEach(el => el.classList.remove("is-hidden"));
        } else {
          const items = grid.querySelectorAll(".item");
          items.forEach((el, i) => { if (i >= INITIAL_VISIBLE) el.classList.add("is-hidden"); });
          grid.closest("section").scrollIntoView({ behavior: "smooth", block: "start" });
        }
        updateMoreButtons();
      });
    });

    // Sync toggle + button labels with the language chosen in <head>.
    setLang(currentLang());
  </script>
</body>
</html>`;
}

function buildReadme() {
  return `# Product Intelligence Public Portal

This repository hosts the public, products-only edition of the Product Intelligence portal.

- Products only: M365 Copilot / Copilot Studio / Azure AI
- Generated from the private source portal
- \`weekly-summary.json\` holds the AI weekly-trend summary shown on the page
`;
}

function main() {
  const kb = readPrivateKb();
  const data = toPublicData(kb);
  const summary = readWeeklySummary();
  fs.writeFileSync(publicHtmlPath, buildHtml(data, summary), "utf8");
  fs.writeFileSync(publicReadmePath, buildReadme(), "utf8");
  console.log(`Wrote ${publicHtmlPath}`);
}

main();
