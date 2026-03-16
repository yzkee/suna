/**
 * Static File Server Plugin
 *
 * Starts a persistent HTTP server on port 3211 that serves HTML files with
 * full relative-asset support (CSS, JS, images, fonts, etc.).
 *
 * How it works:
 *  - /open?path=/abs/path/file.html  — entry-point loader. Injects a <base>
 *    tag so relative URLs (./style.css, ../img/logo.png) resolve through /abs/.
 *  - /abs/path/to/asset.css          — direct asset serving, no base injection.
 *  - /health                          — health check → {"status":"ok"}
 */

import type { PluginContext, PluginResult } from './opencode-pty/src/plugin/types.ts'
import { dirname, extname, normalize, join } from 'path'
import { existsSync, readFileSync, statSync } from 'fs'

const PORT = 3211
const ALLOWED_ROOTS = ['/workspace', '/tmp', '/home', '/opt', '/Users']

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.cjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map':  'application/json; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
  '.md':   'text/plain; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.avif': 'image/avif',
  '.pdf':  'application/pdf',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.otf':  'font/otf',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-cache',
}

function getMime(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  return MIME_TYPES[ext] ?? 'application/octet-stream'
}

function isHtmlFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  return ext === '.html' || ext === '.htm'
}

function toAbsPath(rawPath: string): string | null {
  if (!rawPath || typeof rawPath !== 'string') return null
  const decoded = decodeURIComponent(rawPath).trim()
  if (!decoded.startsWith('/')) return null
  return normalize(decoded)
}

function isAllowed(absPath: string): boolean {
  return ALLOWED_ROOTS.some((root) => absPath === root || absPath.startsWith(root + '/'))
}

/**
 * Inject <base href="…"> into an HTML document so all relative asset URLs
 * resolve through the /abs/ route of this server.
 *
 * e.g. file at /workspace/project/index.html gets:
 *   <base href="http://localhost:3211/abs/workspace/project/">
 *
 * The browser then resolves:
 *   ./style.css   → http://localhost:3211/abs/workspace/project/style.css  ✓
 *   ../img/x.png  → http://localhost:3211/abs/workspace/img/x.png          ✓
 */
function injectBase(html: string, absFilePath: string, baseUrl: string): string {
  const dir = dirname(absFilePath)
  // /abs/ + strip leading "/" from dir
  const baseHref = `${baseUrl}/abs${dir}/`
  const baseTag = `<base href="${baseHref}">`

  if (/<head(\s[^>]*)?>/i.test(html)) {
    return html.replace(/(<head(\s[^>]*)?>)/i, `$1\n  ${baseTag}`)
  }
  if (/<html(\s[^>]*)?>/i.test(html)) {
    return html.replace(/(<html(\s[^>]*)?>)/i, `$1\n${baseTag}`)
  }
  // Fragment with no head/html tag — prepend
  return `${baseTag}\n${html}`
}

function serveFile(absPath: string, baseUrl: string, injectBaseTag = false): Response {
  try {
    if (!isAllowed(absPath)) {
      return new Response(`Forbidden. Allowed roots: ${ALLOWED_ROOTS.join(', ')}`, {
        status: 403,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders },
      })
    }
    if (!existsSync(absPath)) {
      return new Response(`Not found: ${absPath}`, {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders },
      })
    }

    const stat = statSync(absPath)

    // Directory → try index.html / index.htm auto-index
    if (stat.isDirectory()) {
      const indexHtml = join(absPath, 'index.html')
      const indexHtm  = join(absPath, 'index.htm')
      if (existsSync(indexHtml)) return serveFile(indexHtml, baseUrl, injectBaseTag)
      if (existsSync(indexHtm))  return serveFile(indexHtm,  baseUrl, injectBaseTag)
      return new Response(`No index.html in ${absPath}`, {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders },
      })
    }

    if (!stat.isFile()) {
      return new Response(`Not a file: ${absPath}`, {
        status: 400,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders },
      })
    }

    const mime = getMime(absPath)

    // For HTML entry points, inject <base> so relative assets resolve correctly
    if (injectBaseTag && isHtmlFile(absPath)) {
      const raw = readFileSync(absPath, 'utf-8')
      const patched = injectBase(raw, absPath, baseUrl)
      return new Response(patched, {
        headers: { 'Content-Type': mime, ...corsHeaders },
      })
    }

    const data = readFileSync(absPath)
    return new Response(data, {
      headers: { 'Content-Type': mime, ...corsHeaders },
    })
  } catch (err) {
    return new Response(`Read error: ${err instanceof Error ? err.message : String(err)}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders },
    })
  }
}

export const StaticFileServerPlugin = async (_ctx: PluginContext): Promise<PluginResult> => {
  const server = Bun.serve({
    port: PORT,
    hostname: '0.0.0.0',

    fetch(req) {
      const url = new URL(req.url)
      const baseUrl = `${url.protocol}//${url.host}`
      const pathname = decodeURIComponent(url.pathname)

      // CORS preflight
      if (req.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': '*',
          },
        })
      }

      // Health check
      if (pathname === '/health') {
        return new Response(JSON.stringify({ status: 'ok', port: PORT }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        })
      }

      // /open?path=/abs/path/file.html — entry point, injects <base> tag
      if (pathname === '/open') {
        const p = url.searchParams.get('path')
        const absPath = toAbsPath(p ?? '')
        if (!absPath) {
          return new Response('Missing or invalid ?path=/absolute/file', {
            status: 400,
            headers: { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders },
          })
        }
        return serveFile(absPath, baseUrl, /* injectBase= */ true)
      }

      // /abs/path/to/asset — direct asset serving (no base injection)
      // This is what the browser fetches for relative URLs after <base> resolves them
      if (pathname.startsWith('/abs/')) {
        const rawPath = '/' + pathname.slice('/abs/'.length)
        const absPath = toAbsPath(rawPath)
        if (!absPath) {
          return new Response('Invalid absolute path', {
            status: 400,
            headers: { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders },
          })
        }
        return serveFile(absPath, baseUrl, /* injectBase= */ false)
      }

      // Root — help page
      return new Response(`<!doctype html><html><head><meta charset="utf-8">
<title>Static File Server :${PORT}</title></head><body>
<h1>Static File Server</h1>
<p><b>/open?path=/workspace/project/index.html</b> — entry point (injects &lt;base&gt; for relative assets)</p>
<p><b>/abs/workspace/project/style.css</b> — direct asset serving</p>
<p><b>/health</b> — health check</p>
</body></html>`, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders },
      })
    },
  })

  console.log(`[static-file-server] Listening on http://localhost:${PORT}`)
  console.log(`[static-file-server]   /open?path=/abs/path/file.html  (entry point, injects <base>)`)
  console.log(`[static-file-server]   /abs/path/to/asset              (asset serving)`)
  console.log(`[static-file-server]   /health                         (health check)`)

  return {}
}

export default StaticFileServerPlugin
