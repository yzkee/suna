#!/usr/bin/env bun
/**
 * Presentation CLI — create, manage, validate, preview and export HTML slide decks.
 *
 * Usage: bun run presentation.ts <action> [args as JSON]
 *
 * Actions:
 *   create_slide        '{"presentation_name":"my-deck","slide_number":1,"slide_title":"Intro","content":"<div>...</div>","presentation_title":"My Deck"}'
 *   list_slides         '{"presentation_name":"my-deck"}'
 *   delete_slide        '{"presentation_name":"my-deck","slide_number":1}'
 *   list_presentations
 *   delete_presentation '{"presentation_name":"my-deck"}'
 *   validate_slide      '{"presentation_name":"my-deck","slide_number":1}'
 *   export_pdf          '{"presentation_name":"my-deck"}'
 *   export_pptx         '{"presentation_name":"my-deck"}'
 *   preview             '{"presentation_name":"my-deck"}'
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync, rmSync, unlinkSync } from "fs";
import { resolve, join, dirname } from "path";
import { execSync } from "child_process";

const PRESENTATIONS_DIR = "presentations";
const SKILL_DIR = dirname(new URL(import.meta.url).pathname);
const SCRIPTS_DIR = join(SKILL_DIR, "scripts");

// ── Types ──────────────────────────────────────────────────────────────────

interface SlideMetadata { title: string; filename: string; file_path: string; created_at: string; }
interface PresentationMetadata {
  presentation_name: string; title: string; description: string;
  slides: Record<string, SlideMetadata>; created_at: string; updated_at: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function sanitizeFilename(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 80);
}

function ensurePresentationsDir(base: string): string {
  const dir = resolve(base, PRESENTATIONS_DIR);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "EACCES" || code === "EROFS") {
      const fallback = resolve(process.cwd(), PRESENTATIONS_DIR);
      mkdirSync(fallback, { recursive: true });
      return fallback;
    }
    throw err;
  }
  return dir;
}

function ensurePresentationDir(base: string, name: string): { safeName: string; path: string; presDir: string } {
  const safeName = sanitizeFilename(name);
  const presDir = ensurePresentationsDir(base);
  const path = join(presDir, safeName);
  mkdirSync(path, { recursive: true });
  return { safeName, path, presDir };
}

function loadMetadata(presentationPath: string): PresentationMetadata {
  const metaPath = join(presentationPath, "metadata.json");
  if (existsSync(metaPath)) return JSON.parse(readFileSync(metaPath, "utf-8"));
  return { presentation_name: "", title: "Presentation", description: "", slides: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
}

function saveMetadata(presentationPath: string, metadata: PresentationMetadata): void {
  metadata.updated_at = new Date().toISOString();
  writeFileSync(join(presentationPath, "metadata.json"), JSON.stringify(metadata, null, 2));
}

function createSlideHtml(content: string, slideNumber: number, presentationTitle: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=1920, initial-scale=1.0">
    <title>${presentationTitle} - Slide ${slideNumber}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
    <script src="https://d3js.org/d3.v7.min.js" async></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@3.9.1" async></script>
    <style>
        * { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
        body { height: 1080px; width: 1920px; margin: 0; padding: 0; }
    </style>
</head>
<body>
    ${content}
</body>
</html>`;
}

function generateViewer(presPath: string, metadata: PresentationMetadata): void {
  const viewerTemplatePath = join(SKILL_DIR, "viewer.html");
  if (!existsSync(viewerTemplatePath)) return;
  const slides = Object.entries(metadata.slides)
    .map(([num, data]) => ({ number: parseInt(num), title: data.title || `Slide ${num}`, filename: data.filename }))
    .sort((a, b) => a.number - b.number);
  const presData = JSON.stringify({ title: metadata.title || metadata.presentation_name || "Presentation", slides });
  const template = readFileSync(viewerTemplatePath, "utf-8");
  writeFileSync(join(presPath, "viewer.html"), template.replace("{{TITLE}}", metadata.title || "Presentation").replace("{{PRESENTATION_DATA}}", presData));
}

function runPythonScript(script: string, args: string[], timeoutMs = 300_000): string {
  const isLinux = process.platform === "linux";
  const cmd = isLinux
    ? `python3 ${script} ${args.map(a => `"${a}"`).join(" ")}`
    : `uv run ${script} ${args.map(a => `"${a}"`).join(" ")}`;
  const env: Record<string, string | undefined> = { ...process.env };
  if (!isLinux) env.UV_CACHE_DIR = env.UV_CACHE_DIR ?? join(process.env.HOME ?? "/tmp", ".cache", "uv");
  try {
    return execSync(cmd, { cwd: SCRIPTS_DIR, timeout: timeoutMs, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], env }).trim();
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const stdout = err.stdout?.trim() ?? "";
    if (stdout) { try { const p = JSON.parse(stdout); if (p.success === false) return stdout; } catch {} }
    return JSON.stringify({ success: false, error: err.stderr?.trim() || err.message || "Python script failed" });
  }
}

function out(data: unknown): void { console.log(JSON.stringify(data, null, 2)); }

// ── Actions ────────────────────────────────────────────────────────────────

function doCreateSlide(base: string, presentation_name: string, slide_number: number, slide_title: string, content: string, presentation_title: string) {
  if (!presentation_name) return out({ success: false, error: "presentation_name is required" });
  if (!slide_number || slide_number < 1) return out({ success: false, error: "slide_number must be >= 1" });
  if (!slide_title) return out({ success: false, error: "slide_title is required" });
  if (!content) return out({ success: false, error: "content is required" });

  const { safeName, path: presPath, presDir } = ensurePresentationDir(base, presentation_name);
  mkdirSync(join(presDir, "images"), { recursive: true });

  const metadata = loadMetadata(presPath);
  metadata.presentation_name = presentation_name;
  if (presentation_title !== "Presentation") metadata.title = presentation_title;

  const html = createSlideHtml(content, slide_number, presentation_title);
  const filename = `slide_${String(slide_number).padStart(2, "0")}.html`;
  writeFileSync(join(presPath, filename), html);

  const relPath = `${PRESENTATIONS_DIR}/${safeName}/${filename}`;
  metadata.slides[String(slide_number)] = { title: slide_title, filename, file_path: relPath, created_at: new Date().toISOString() };
  saveMetadata(presPath, metadata);
  generateViewer(presPath, metadata);

  out({ success: true, action: "create_slide", presentation_name, presentation_path: `${PRESENTATIONS_DIR}/${safeName}`, slide_number, slide_title, slide_file: relPath, total_slides: Object.keys(metadata.slides).length });
}

function doListSlides(base: string, presentation_name: string) {
  if (!presentation_name) return out({ success: false, error: "presentation_name is required" });
  const safeName = sanitizeFilename(presentation_name);
  const presPath = join(resolve(base, PRESENTATIONS_DIR), safeName);
  if (!existsSync(presPath)) return out({ success: true, presentation_name, slides: [], total_slides: 0 });
  const metadata = loadMetadata(presPath);
  const slides = Object.entries(metadata.slides).map(([num, data]) => ({ slide_number: parseInt(num), ...data })).sort((a, b) => a.slide_number - b.slide_number);
  out({ success: true, presentation_name, presentation_title: metadata.title, slides, total_slides: slides.length, presentation_path: `${PRESENTATIONS_DIR}/${safeName}` });
}

function doDeleteSlide(base: string, presentation_name: string, slide_number: number) {
  if (!presentation_name) return out({ success: false, error: "presentation_name is required" });
  if (!slide_number || slide_number < 1) return out({ success: false, error: "slide_number must be >= 1" });
  const safeName = sanitizeFilename(presentation_name);
  const presPath = join(resolve(base, PRESENTATIONS_DIR), safeName);
  if (!existsSync(presPath)) return out({ success: false, error: `Presentation '${presentation_name}' not found` });
  const metadata = loadMetadata(presPath);
  const key = String(slide_number);
  if (!metadata.slides[key]) return out({ success: false, error: `Slide ${slide_number} not found` });
  const slideInfo = metadata.slides[key];
  try { unlinkSync(join(presPath, slideInfo.filename)); } catch {}
  delete metadata.slides[key];
  saveMetadata(presPath, metadata);
  generateViewer(presPath, metadata);
  out({ success: true, action: "delete_slide", presentation_name, deleted_slide: slide_number, deleted_title: slideInfo.title, remaining_slides: Object.keys(metadata.slides).length });
}

function doListPresentations(base: string) {
  const presDir = resolve(base, PRESENTATIONS_DIR);
  if (!existsSync(presDir)) return out({ success: true, presentations: [], total_count: 0 });
  const presentations = readdirSync(presDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith(".") && d.name !== "images")
    .map(d => { const meta = loadMetadata(join(presDir, d.name)); return { folder: d.name, title: meta.title || d.name, description: meta.description || "", total_slides: Object.keys(meta.slides).length, created_at: meta.created_at, updated_at: meta.updated_at }; });
  out({ success: true, presentations, total_count: presentations.length });
}

function doDeletePresentation(base: string, presentation_name: string) {
  if (!presentation_name) return out({ success: false, error: "presentation_name is required" });
  const safeName = sanitizeFilename(presentation_name);
  const presPath = join(resolve(base, PRESENTATIONS_DIR), safeName);
  if (!existsSync(presPath)) return out({ success: false, error: `Presentation '${presentation_name}' not found` });
  rmSync(presPath, { recursive: true, force: true });
  out({ success: true, action: "delete_presentation", presentation_name, deleted_path: `${PRESENTATIONS_DIR}/${safeName}` });
}

function doValidateSlide(base: string, presentation_name: string, slide_number: number) {
  if (!presentation_name) return out({ success: false, error: "presentation_name is required" });
  if (!slide_number || slide_number < 1) return out({ success: false, error: "slide_number must be >= 1" });
  const safeName = sanitizeFilename(presentation_name);
  const presPath = join(resolve(base, PRESENTATIONS_DIR), safeName);
  const metadata = loadMetadata(presPath);
  const key = String(slide_number);
  if (!metadata.slides[key]) return out({ success: false, error: `Slide ${slide_number} not found` });
  const slidePath = join(resolve(base), metadata.slides[key].file_path);
  if (!existsSync(slidePath)) return out({ success: false, error: `Slide file not found: ${slidePath}` });
  const raw = runPythonScript("validate_slide.py", [slidePath]);
  try { out({ ...JSON.parse(raw), action: "validate_slide", presentation_name, slide_number }); } catch { out({ success: false, error: raw }); }
}

function doExportPdf(base: string, presentation_name: string) {
  if (!presentation_name) return out({ success: false, error: "presentation_name is required" });
  const safeName = sanitizeFilename(presentation_name);
  const presPath = join(resolve(base, PRESENTATIONS_DIR), safeName);
  if (!existsSync(presPath)) return out({ success: false, error: `Presentation '${presentation_name}' not found` });
  const outPath = join(presPath, `${safeName}.pdf`);
  const raw = runPythonScript("convert_pdf.py", [presPath, outPath]);
  try {
    const result = JSON.parse(raw);
    out(result.success ? { ...result, action: "export_pdf", presentation_name, relative_path: `${PRESENTATIONS_DIR}/${safeName}/${safeName}.pdf` } : result);
  } catch { out({ success: false, error: raw }); }
}

function doExportPptx(base: string, presentation_name: string) {
  if (!presentation_name) return out({ success: false, error: "presentation_name is required" });
  const safeName = sanitizeFilename(presentation_name);
  const presPath = join(resolve(base, PRESENTATIONS_DIR), safeName);
  if (!existsSync(presPath)) return out({ success: false, error: `Presentation '${presentation_name}' not found` });
  const outPath = join(presPath, `${safeName}.pptx`);
  const raw = runPythonScript("convert_pptx.py", [presPath, outPath]);
  try {
    const result = JSON.parse(raw);
    out(result.success ? { ...result, action: "export_pptx", presentation_name, relative_path: `${PRESENTATIONS_DIR}/${safeName}/${safeName}.pptx` } : result);
  } catch { out({ success: false, error: raw }); }
}

function doPreview(base: string, presentation_name: string) {
  if (!presentation_name) return out({ success: false, error: "presentation_name is required" });
  const safeName = sanitizeFilename(presentation_name);
  const presPath = join(resolve(base, PRESENTATIONS_DIR), safeName);
  if (!existsSync(presPath)) return out({ success: false, error: `Presentation '${presentation_name}' not found` });
  generateViewer(presPath, loadMetadata(presPath));
  out({ success: true, action: "preview", presentation_name, viewer_url: `http://localhost:3210/presentations/${safeName}/`, viewer_file: `${PRESENTATIONS_DIR}/${safeName}/viewer.html`, message: `Viewer running at http://localhost:3210 — open http://localhost:3210/presentations/${safeName}/` });
}

// ── Dispatch ───────────────────────────────────────────────────────────────

const [action, rawArgs] = process.argv.slice(2);
const args = rawArgs ? JSON.parse(rawArgs) : {};
const base = args.output_dir ?? process.cwd();

switch (action) {
  case "create_slide":        doCreateSlide(base, args.presentation_name ?? "", args.slide_number ?? 0, args.slide_title ?? "", args.content ?? "", args.presentation_title ?? "Presentation"); break;
  case "list_slides":         doListSlides(base, args.presentation_name ?? ""); break;
  case "delete_slide":        doDeleteSlide(base, args.presentation_name ?? "", args.slide_number ?? 0); break;
  case "list_presentations":  doListPresentations(base); break;
  case "delete_presentation": doDeletePresentation(base, args.presentation_name ?? ""); break;
  case "validate_slide":      doValidateSlide(base, args.presentation_name ?? "", args.slide_number ?? 0); break;
  case "export_pdf":          doExportPdf(base, args.presentation_name ?? ""); break;
  case "export_pptx":         doExportPptx(base, args.presentation_name ?? ""); break;
  case "preview":             doPreview(base, args.presentation_name ?? ""); break;
  default:
    console.error(`Unknown action: ${action}. Use: create_slide | list_slides | delete_slide | list_presentations | delete_presentation | validate_slide | export_pdf | export_pptx | preview`);
    process.exit(1);
}
