#!/usr/bin/env node
// Generate print-ready PDFs from lesson markdown files.
//
//   node generate.js                      # all lessons
//   node generate.js 2026-10-18 lessons/2026-10-11.md   # only these
//
// Each lesson is scaled to fill exactly two Letter pages, with the date and
// leaders in the page header and a small last week / next week recap.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { marked } from "marked";
import puppeteer from "puppeteer";
import { PDFDocument } from "pdf-lib";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const LESSONS_DIR = path.join(ROOT, "lessons");
const OUTPUT_DIR = path.join(ROOT, "output");

const MAX_PAGES = 2;
const MIN_FONT_PT = 7;
const MAX_FONT_PT = 13;
const FONT_STEP_PT = 0.25;

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// gray-matter parses YAML dates as UTC midnight; keep them as YYYY-MM-DD.
const isoDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d));

const formatDate = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  });

function takeaways(body) {
  const section = body.match(/^###\s+Takeaways\s*$([\s\S]*?)(?=^#{1,3}\s|(?![\s\S]))/m);
  if (!section) return [];
  return [...section[1].matchAll(/^\s*[-*]\s+(.+)$/gm)].map((m) => m[1].trim());
}

async function loadLessons() {
  const files = (await fs.readdir(LESSONS_DIR)).filter((f) => f.endsWith(".md")).sort();
  const lessons = await Promise.all(
    files.map(async (file) => {
      const { data, content } = matter(await fs.readFile(path.join(LESSONS_DIR, file), "utf8"));
      return {
        file,
        data,
        content,
        date: isoDate(data.date ?? path.basename(file, ".md")),
        takeaways: takeaways(content),
      };
    }),
  );
  return lessons.sort((a, b) => a.date.localeCompare(b.date));
}

// Accepts dates ("2026-10-18"), file names, or paths.
function selectLessons(lessons, args) {
  if (args.length === 0) return lessons;
  return args.map((arg) => {
    const key = path.basename(arg, ".md");
    const lesson = lessons.find((l) => path.basename(l.file, ".md") === key || l.date === key);
    if (!lesson) throw new Error(`No lesson found for "${arg}"`);
    return lesson;
  });
}

function recapHtml(last, next) {
  const lastHtml = last
    ? `<div class="recap-col">
        <h4>Last Week · ${escapeHtml(formatDate(last.date))}</h4>
        <p><strong>Topic:</strong> ${escapeHtml(last.data.title)}</p>
        ${last.data.memoryVerse ? `<p><strong>Memory Verse:</strong> “${escapeHtml(last.data.memoryVerse)}” — ${escapeHtml(last.data.memoryVerseRef)}</p>` : ""}
        ${last.takeaways.length ? `<p><strong>Takeaways:</strong></p><ul>${last.takeaways.map((t) => `<li>${marked.parseInline(t)}</li>`).join("")}</ul>` : ""}
      </div>`
    : "";
  const nextHtml = next
    ? `<div class="recap-col recap-next">
        <h4>Next Week · ${escapeHtml(formatDate(next.date))}</h4>
        <p><strong>Topic:</strong> ${escapeHtml(next.data.title)}</p>
      </div>`
    : "";
  return lastHtml || nextHtml ? `<section class="recap">${lastHtml}${nextHtml}</section>` : "";
}

function lessonHtml(lesson, last, next) {
  const body = recapHtml(last, next) + marked.parse(lesson.content);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(lesson.data.title)}</title>
<style>
  :root { --font-size: 11pt; }
  html { font-size: var(--font-size); }
  body { margin: 0; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; line-height: 1.35; color: #111; }
  h1 { font-size: 1.6rem; margin: 0 0 0.4rem; line-height: 1.2; }
  h3 { font-size: 1.1rem; margin: 0.9rem 0 0.3rem; padding-bottom: 0.1rem; border-bottom: 1px solid #bbb; break-after: avoid; }
  h4 { font-size: 1rem; margin: 0.6rem 0 0.2rem; break-after: avoid; }
  p { margin: 0 0 0.45rem; }
  ul { margin: 0 0 0.45rem; padding-left: 1.3rem; }
  li { margin: 0 0 0.15rem; break-inside: avoid; }
  li > p { margin: 0; }
  em { color: #444; }

  .recap { display: flex; gap: 1rem; margin: 0 0 0.6rem; padding: 0.35rem 0.6rem;
           border: 1px solid #ccc; border-radius: 4px; background: #f5f5f5;
           font-size: 0.78rem; line-height: 1.25; break-inside: avoid; }
  .recap-col { flex: 2; }
  .recap-next { flex: 1; border-left: 1px solid #ccc; padding-left: 0.8rem; }
  .recap h4 { margin: 0 0 0.2rem; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.03em; color: #555; }
  .recap p, .recap ul { margin: 0 0 0.15rem; }
  .recap li { margin: 0; }
</style></head>
<body>${body}</body></html>`;
}

function headerTemplate(lesson) {
  const leaders = lesson.data.leaders ? `Leaders: ${escapeHtml(lesson.data.leaders)}` : "";
  return `<div style="width:100%; margin:0 0.5in; font-size:9pt; font-family:Helvetica, Arial, sans-serif; color:#555;
                      display:flex; justify-content:space-between; border-bottom:1px solid #ccc; padding-bottom:3px;">
    <span>${escapeHtml(formatDate(lesson.date))}</span><span>${leaders}</span>
  </div>`;
}

const footerTemplate = `<div style="width:100%; text-align:center; font-size:8pt; font-family:Helvetica, Arial, sans-serif; color:#888;">
  Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`;

async function renderPdf(page, lesson, fontPt) {
  await page.evaluate((pt) => document.documentElement.style.setProperty("--font-size", `${pt}pt`), fontPt);
  return page.pdf({
    format: "Letter",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: headerTemplate(lesson),
    footerTemplate,
    margin: { top: "0.7in", bottom: "0.55in", left: "0.5in", right: "0.5in" },
  });
}

const pageCount = async (pdf) => (await PDFDocument.load(pdf)).getPageCount();

// Find the largest font size that still fits in MAX_PAGES.
async function fitToPages(page, lesson) {
  const steps = Math.round((MAX_FONT_PT - MIN_FONT_PT) / FONT_STEP_PT);
  let lo = 0, hi = steps, best = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const fontPt = MIN_FONT_PT + mid * FONT_STEP_PT;
    const pdf = await renderPdf(page, lesson, fontPt);
    if ((await pageCount(pdf)) <= MAX_PAGES) {
      best = { pdf, fontPt };
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best) return best;
  const pdf = await renderPdf(page, lesson, MIN_FONT_PT);
  return { pdf, fontPt: MIN_FONT_PT, overflow: await pageCount(pdf) };
}

async function main() {
  const lessons = await loadLessons();
  const selected = selectLessons(lessons, process.argv.slice(2));
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const browser = await puppeteer.launch();
  try {
    const page = await browser.newPage();
    for (const lesson of selected) {
      const i = lessons.indexOf(lesson);
      await page.setContent(lessonHtml(lesson, lessons[i - 1], lessons[i + 1]), { waitUntil: "load" });
      const { pdf, fontPt, overflow } = await fitToPages(page, lesson);
      const outFile = path.join(OUTPUT_DIR, `${path.basename(lesson.file, ".md")}.pdf`);
      await fs.writeFile(outFile, pdf);
      const note = overflow ? ` — WARNING: still ${overflow} pages at minimum size` : "";
      console.log(`${path.relative(ROOT, outFile)} (${fontPt}pt)${note}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
