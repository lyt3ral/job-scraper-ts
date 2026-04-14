import { JSDOM } from "jsdom";

export interface JobDetails {
  jobDescription: string;
  hiringOrganization: string;
  title: string;
  datePosted: string;
  source: string;
}

export async function fetchWorkdayJobDetails(jobURL: string): Promise<JobDetails | null> {
  try {
    console.log(`      [details] GET ${jobURL}`);
    const resp = await fetch(jobURL);
    
    if (!resp.ok) {
      console.warn(`      [details] HTTP ${resp.status} for ${jobURL}`);
      return null;
    }

    const html = await resp.text();
    console.log(`      [details] Response size: ${html.length} bytes`);
    
    // Try JSON-LD first
    const ldMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    console.log(`      [details] JSON-LD script tags found: ${ldMatches?.length ?? 0}`);

    if (ldMatches) {
        for (const match of ldMatches) {
            const innerMatch = match.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
            if (innerMatch && innerMatch[1]) {
                const raw = innerMatch[1].trim();
                try {
                    const parsed = JSON.parse(raw);
                    const jobs = Array.isArray(parsed) ? parsed : [parsed];
                    
                    for (const job of jobs) {
                        if (job["@type"]?.toLowerCase().includes("job") || job.title || job.name) {
                            console.log(`      [details] Matched ld+json block — @type: ${job["@type"]}`);
                            const result = parseJsonLdJob(job);
                            console.log(`      [details] Extracted via ld+json — desc length: ${result.jobDescription.length}`);
                            return result;
                        }
                    }
                } catch (e) {
                   console.warn(`      [details] Failed to parse JSON-LD block: ${String(e).slice(0, 80)}`);
                }
            }
        }
    }

    // fallback using regex
    console.log(`      [details] Falling back to regex extraction...`);
    const result = parseUsingRegex(html);
    console.log(`      [details] Extracted via regex — desc length: ${result.jobDescription.length}`);
    return result;

  } catch (error) {
     console.error(`      [details] Exception fetching ${jobURL}: ${error}`);
     return null;
  }
}

function parseJsonLdJob(job: any): JobDetails {
    const details = {
        title: job.title || job.name || "",
        jobDescription: "",
        hiringOrganization: "",
        datePosted: job.datePosted || "",
        source: "ld+json"
    };

    if (typeof job.jobDescription === "string") {
        details.jobDescription = job.jobDescription;
    } else if (job.jobDescription?.text) {
        details.jobDescription = job.jobDescription.text;
    } else if (typeof job.description === "string") {
        details.jobDescription = job.description;
    }

    if (typeof job.hiringOrganization === "string") {
        details.hiringOrganization = job.hiringOrganization;
    } else if (job.hiringOrganization?.name) {
         details.hiringOrganization = job.hiringOrganization.name;
    } else if (job.hiringOrganizationName) {
        details.hiringOrganization = job.hiringOrganizationName;
    }

    // Strip HTML from description if it exists
    if (details.jobDescription) {
        try {
            const dom = new JSDOM("");
            const el = dom.window.document.createElement('div');
            el.innerHTML = details.jobDescription;
            details.jobDescription = el.textContent || el.innerText || "";
        } catch(e) {}
    }

    return details;
}

function parseUsingRegex(html: string): JobDetails {
    const result = {
        title: extractFieldValue(html, "title") || extractFieldValue(html, "name"),
        jobDescription: extractFieldValue(html, "jobDescription") || extractFieldValue(html, "description"),
        hiringOrganization: extractFieldValue(html, "hiringOrganization") || extractFieldValue(html, "hiringOrganizationName"),
        datePosted: extractFieldValue(html, "datePosted"),
        source: "regex"
    };

    if (result.jobDescription) {
        try {
            const dom = new JSDOM("");
            const el = dom.window.document.createElement('div');
            el.innerHTML = result.jobDescription;
            result.jobDescription = el.textContent || el.innerText || "";
        } catch(e) {}
    }

    return result;
}

function extractFieldValue(html: string, key: string): string {
    const pattern = new RegExp(`["']${key}["']\\s*:\\s*("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*')`, 'i');
    const match = html.match(pattern);
    if (match && match[1]) {
        try {
            const unquoted = JSON.parse(match[1]);
            return decodeHTMLEntities(typeof unquoted === 'string' ? unquoted : String(unquoted));
        } catch(e) {
            // fallback
            let inner = match[1].replace(/^["']/, "").replace(/["']$/, "");
            inner = inner.replace(/\\"/g, '"').replace(/\\'/g, "'");
            return decodeHTMLEntities(inner);
        }
    }
    return "";
}

function decodeHTMLEntities(str: string): string {
    return str.replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'");
}
