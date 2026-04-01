import { spawn } from 'node:child_process'

const SEARCH_ENDPOINT =
  'https://www.bing.com/search?format=rss&cc=us&setlang=en-US&mkt=en-US&q='
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
const MAX_SEARCH_RESULTS = 8
const MAX_FETCH_CHARS = 20_000

export type WebSearchResult = {
  title: string
  url: string
  snippet: string
  domain: string
}

export type WebFetchResult = {
  url: string
  title: string
  contentType: string
  text: string
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&#(\d+);/g, (_, code) => {
      const parsed = Number(code)
      return Number.isFinite(parsed) ? String.fromCharCode(parsed) : _
    })
}

function stripTags(value: string): string {
  return decodeEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|li|h1|h2|h3|h4|h5|h6|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\r/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim(),
  )
}

function normalizeText(value: string, maxChars = MAX_FETCH_CHARS): string {
  const normalized = value
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()

  return normalized.length > maxChars
    ? `${normalized.slice(0, maxChars)}\n...[truncated]`
    : normalized
}

function extractTag(html: string, tagName: string): string {
  const match = html.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'))
  return match?.[1] ? stripTags(match[1]) : ''
}

async function fetchText(url: string): Promise<{
  finalUrl: string
  contentType: string
  text: string
}> {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'user-agent': DEFAULT_USER_AGENT,
        accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain,application/json;q=0.8,*/*;q=0.5',
        'accept-language': 'en-US,en;q=0.8',
      },
    })

    if (!response.ok) {
      throw new Error(`Request failed with ${response.status} ${response.statusText}`)
    }

    return {
      finalUrl: response.url,
      contentType: response.headers.get('content-type') || 'unknown',
      text: await response.text(),
    }
  } catch (error) {
    if (process.platform !== 'win32') {
      throw error
    }

    return powershellFetchText(url)
  }
}

async function powershellFetchText(url: string): Promise<{
  finalUrl: string
  contentType: string
  text: string
}> {
  const escapedUrl = url.replace(/'/g, "''")
  const escapedAgent = DEFAULT_USER_AGENT.replace(/'/g, "''")
  const script = [
    "$ProgressPreference='SilentlyContinue'",
    `$headers=@{ 'User-Agent'='${escapedAgent}'; 'Accept-Language'='en-US,en;q=0.8' }`,
    `$response=Invoke-WebRequest -UseBasicParsing -MaximumRedirection 5 -Headers $headers -Uri '${escapedUrl}'`,
    "$payload = [pscustomobject]@{ finalUrl = $response.BaseResponse.ResponseUri.AbsoluteUri; contentType = $response.Headers['Content-Type']; text = $response.Content }",
    '$payload | ConvertTo-Json -Compress -Depth 4',
  ].join('\n')

  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })

    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `PowerShell fetch failed with code ${code}`))
        return
      }

      try {
        const parsed = JSON.parse(stdout) as {
          finalUrl?: string
          contentType?: string
          text?: string
        }
        resolve({
          finalUrl: parsed.finalUrl || url,
          contentType: parsed.contentType || 'unknown',
          text: parsed.text || '',
        })
      } catch (error) {
        reject(
          error instanceof Error
            ? error
            : new Error('Failed to parse PowerShell web fetch output'),
        )
      }
    })
  })
}

function parseRssSearch(xml: string): WebSearchResult[] {
  const results: WebSearchResult[] = []

  for (const itemMatch of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const block = itemMatch[1] || ''
    const title = decodeEntities(block.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() || '')
    const url = decodeEntities(block.match(/<link>([\s\S]*?)<\/link>/i)?.[1]?.trim() || '')
    const snippet = decodeEntities(
      block.match(/<description>([\s\S]*?)<\/description>/i)?.[1]?.trim() || '',
    )

    if (!title || !url) {
      continue
    }

    let domain = ''
    try {
      domain = new URL(url).hostname
    } catch {
      continue
    }

    results.push({
      title: stripTags(title),
      url,
      snippet: stripTags(snippet),
      domain,
    })
  }

  return results
}

function filterSearchResults(
  results: WebSearchResult[],
  allowedDomains?: string[],
  blockedDomains?: string[],
  maxResults = MAX_SEARCH_RESULTS,
): WebSearchResult[] {
  const allowed = (allowedDomains || [])
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)
  const blocked = (blockedDomains || [])
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)

  const matchesDomain = (candidate: string, domains: string[]): boolean =>
    domains.some(domain => candidate === domain || candidate.endsWith(`.${domain}`))

  return results
    .filter(result => !allowed.length || matchesDomain(result.domain.toLowerCase(), allowed))
    .filter(result => !blocked.length || !matchesDomain(result.domain.toLowerCase(), blocked))
    .slice(0, Math.max(1, Math.min(maxResults, MAX_SEARCH_RESULTS)))
}

export async function webSearch(args: {
  query: string
  allowedDomains?: string[]
  blockedDomains?: string[]
  maxResults?: number
}): Promise<WebSearchResult[]> {
  const query = args.query.trim()
  if (!query) {
    return []
  }

  const allowed = (args.allowedDomains || []).map(item => item.trim()).filter(Boolean)
  const blocked = (args.blockedDomains || []).map(item => item.trim()).filter(Boolean)
  const siteTerms = [
    ...allowed.map(domain => `site:${domain}`),
    ...blocked.map(domain => `-site:${domain}`),
  ].join(' ')
  const effectiveQuery = siteTerms ? `${query} ${siteTerms}` : query

  const { text } = await fetchText(`${SEARCH_ENDPOINT}${encodeURIComponent(effectiveQuery)}`)
  const parsed = parseRssSearch(text)

  return filterSearchResults(
    parsed,
    allowed,
    blocked,
    args.maxResults,
  )
}

export async function webFetch(url: string): Promise<WebFetchResult> {
  const target = url.trim()
  if (!target) {
    throw new Error('URL is required')
  }

  const { finalUrl, contentType, text } = await fetchText(target)
  const normalizedType = contentType.toLowerCase()

  if (
    normalizedType.includes('image/') ||
    normalizedType.includes('audio/') ||
    normalizedType.includes('video/') ||
    normalizedType.includes('application/pdf') ||
    normalizedType.includes('application/octet-stream')
  ) {
    throw new Error(`Unsupported content type for text fetch: ${contentType}`)
  }

  if (
    normalizedType.includes('application/json') ||
    normalizedType.includes('text/plain') ||
    normalizedType.includes('text/markdown') ||
    normalizedType.includes('application/xml') ||
    normalizedType.includes('text/xml')
  ) {
    return {
      url: finalUrl,
      title: finalUrl,
      contentType,
      text: normalizeText(text),
    }
  }

  const title = extractTag(text, 'title') || finalUrl
  const bodyMatch = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  const extracted = stripTags(bodyMatch?.[1] || text)

  return {
    url: finalUrl,
    title,
    contentType,
    text: normalizeText(extracted),
  }
}
