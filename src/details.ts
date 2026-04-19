/**
 * Utility for fetching and parsing structured job data from detail pages.
 * Optimized for performance by avoiding heavy DOM parsing where possible.
 */

export interface JobDetails {
  jobDescription: string;
  hiringOrganization: string;
  title: string;
  datePosted: string;
  source: string;
}

/**
 * Strips HTML tags and decodes common entities using high-performance regex.
 */
function stripHtml(html: string): string {
  if (!html) return "";
  
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Fetches a job page and attempts to extract structured metadata via JSON-LD or raw JSON strings.
 */
export async function fetchWorkdayJobDetails(jobURL: string): Promise<JobDetails | null> {
  try {
    const resp = await fetch(jobURL, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });
    
    if (!resp.ok) return null;
    const html = await resp.text();

    // 1. Try JSON-LD first (Standard SEO format)
    const ldMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    if (ldMatches) {
      for (const match of ldMatches) {
        try {
          const rawJson = match.replace(/<script[^>]*>|<\/script>/gi, "").trim();
          const parsed = JSON.parse(rawJson);
          const jobData = Array.isArray(parsed) ? parsed.find(j => j["@type"]?.includes("Job")) : parsed;
          
          if (jobData && (jobData.description || jobData.jobDescription)) {
            return {
              title: jobData.title || jobData.name || "",
              jobDescription: stripHtml(jobData.description || jobData.jobDescription || ""),
              hiringOrganization: jobData.hiringOrganization?.name || jobData.hiringOrganization || "",
              datePosted: jobData.datePosted || "",
              source: "json-ld"
            };
          }
        } catch (e) { /* skip malformed blocks */ }
      }
    }

    // 2. Fallback: Regex extraction from raw JSON-like strings in HTML
    return {
      title: extractRawValue(html, "title") || extractRawValue(html, "name"),
      jobDescription: stripHtml(extractRawValue(html, "jobDescription") || extractRawValue(html, "description")),
      hiringOrganization: extractRawValue(html, "hiringOrganization") || extractRawValue(html, "hiringOrganizationName"),
      datePosted: extractRawValue(html, "datePosted"),
      source: "regex-fallback"
    };

  } catch (error) {
    return null;
  }
}

/**
 * Extracts a value from a raw JSON string embedded in HTML using regex.
 */
function extractRawValue(html: string, key: string): string {
  const pattern = new RegExp(`["']${key}["']\\s*:\\s*("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*')`, 'i');
  const match = html.match(pattern);
  if (!match || !match[1]) return "";
  
  try {
    const unquoted = JSON.parse(match[1]);
    return typeof unquoted === 'string' ? unquoted : String(unquoted);
  } catch (e) {
    return match[1].replace(/^["']|["']$/g, "").replace(/\\(["'])/g, "$1");
  }
}

