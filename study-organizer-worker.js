// Study Organizer Worker — Direct Upload (Name-based, token+aliases)
// Cloudflare Workers + R2 (NO Queues required)
// Uploads directly to R2 at the computed target key based on the *filename* only.
// Fixes: robust token-based matching; safe stream detection (no PSLE from "P2");
// made with <3 by rayhan

/**
 * wrangler.toml
 * -----------------
 * name = "study-organizer"
 * main = "study-organizer-worker.js"
 * compatibility_date = "2025-09-01"
 *
 * [[r2_buckets]]
 * binding = "STUDY_BUCKET"
 * bucket_name = "notesbubble"
 */

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Health
    if (req.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "study-organizer-direct" });
    }

    // Dry run (no write)
    if (req.method === "GET" && url.pathname === "/dry-run") {
      const name = getIncomingName(url, req) || "";
      const targetKey = determineTargetPath(name);
      return json({ name, targetKey });
    }

    // Direct upload (streamed write to R2)
    if (req.method === "POST" && url.pathname === "/upload") {
      const name = getIncomingName(url, req) || "upload.bin";
      const ct = req.headers.get("content-type") || "application/octet-stream";

      const targetKey = determineTargetPath(name) || `General/Misc/Other/${basename(name)}`;
      await env.STUDY_BUCKET.put(targetKey, req.body, { httpMetadata: { contentType: ct } });
      return json({ ok: true, key: targetKey });
    }

    return new Response("Study Organizer (name-based, direct upload)", { headers: corsHeaders() });
  }
};

function getIncomingName(url, req) {
  return url.searchParams.get("name") || req.headers.get("x-filename");
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders() }
  });
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-allow-headers": "content-type, x-filename"
  };
}

// ------------------ Name-only classification (token-based) ------------------

// Tokenize: split to lowercase alnum tokens (keeps h2, p2, etc.)
function tokenize(s) {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

// Streams (order matters). We *avoid* matching PSLE on bare "p2" etc.
function detectStream(lowerName, tokens) {
  // Strong A-level signals first
  if (tokens.includes("h2") || tokens.includes("h1") || tokens.includes("jc") || hasAny(tokens, JC_SCHOOLS_LC)) {
    return "A levels";
  }
  if (/\ba[- ]?levels?\b/.test(lowerName)) return "A levels";

  // O-level signals
  if (/\bo[- ]?levels?\b/.test(lowerName)) return "O levels";
  if (tokens.some(t => /^sec[1-5]$/.test(t))) return "O levels";

  // PSLE only when explicit words present
  if (tokens.includes("psle") || tokens.includes("primary")) return "PSLE";

  // Others
  if (tokens.includes("ip") || lowerName.includes("integrated programme")) return "Integrated Programme";
  if (tokens.includes("ib") || lowerName.includes("international baccalaureate")) return "International Baccalaureate Diploma";
  if (hasAny(tokens, ["nus","ntu","smu","sutd","sit","suss","university"])) return "University";
  return "General";
}

// Subject detection with safe, token-aware matching (avoids matching "el" inside "prelim")
function detectSubject(tokens) {
  const has = (w) => tokens.includes(w);

  // multi-word subjects first
  if (has("additional") && has("math")) return "Additional Math";
  if (has("elementary") && has("math")) return "Elementary Math";
  if (has("principles") && has("of") && has("accounts")) return "Principles of Accounts";
  if (has("social") && has("studies")) return "Social Studies";
  if ((has("design") && has("and") && has("technology")) || has("dnt")) return "Design and Technology";
  if ((has("nutrition") && has("and") && has("food") && has("science")) || has("nfs")) return "Nutrition and Food Science";
  if ((has("comb") || has("combined")) && (has("sci") || has("science"))) return "Combined Science";
  if (has("combined") && has("physics")) return "Combined Physics";
  if (has("combined") && has("chemistry")) return "Combined Chemistry";
  if (has("combined") && has("biology")) return "Combined Biology";
  if (has("higher") && has("chinese")) return "Higher Chinese";
  if (has("higher") && has("malay")) return "Higher Malay";
  if (has("higher") && has("tamil")) return "Higher Tamil";

  // short forms & common abbreviations
  if (has("amath") || (has("am") && has("math"))) return "Additional Math";
  if (has("emath") || (has("em") && has("math"))) return "Elementary Math";
  if (has("ss")) return "Social Studies";
  if (has("hcl")) return "Higher Chinese";
  if (has("hml")) return "Higher Malay";
  if (has("htl")) return "Higher Tamil";
  if (has("cl")) return "Chinese";
  if (has("ml")) return "Malay";
  if (has("tl")) return "Tamil";
  if (has("eng") || has("english") || has("el")) return "English"; // token-wise only
  if (has("phy")) return "Physics";
  if (has("chem") || has("chemistry")) return "Chemistry";
  if (has("bio") || has("biology")) return "Biology";
  if (has("geog") || has("geography")) return "Geography";
  if (has("lit") || has("literature")) return "Literature";
  if (has("poa")) return "Principles of Accounts";
  if (has("sci") || has("science")) return "Science";
  if (has("computing")) return "Computing";
  if (has("economics") || has("econs")) return "Economics";

  return null;
}

function detectResourceType(lowerName, tokens) {
  if (/(\bprelim(s)?\b|\bpromo(s)?\b|\bmye\b|\beoy\b|\bmid[- ]?year\b|\bend[- ]?of[- ]?year\b|\bpaper\s?(1|2|3|4)\b|\bp[12]\b|\bexam\b|\bpast\s?year\b|\btys\b)/.test(lowerName)) return "exam";
  if (/(\btopical\b|\bchapter(s)?\b|\btopic\b|\bunit\b|\bworksheet(s)?\b|\bpractice\b|\brevision\b)/.test(lowerName)) return "topical";
  if (/(\bnotes?\b|\bsummary\b|\bmind\s?map\b|\bcheat\s?sheet\b|\bsyllabus\b)/.test(lowerName)) return "notes";
  return null;
}

// JC & common school tags (A-level prelims)
const JC_SCHOOLS = [
  "ACJC","AJC","ASRJC","CJC","DHS","EJC","HCI","IJC","JJC","JPJC","MI","MJC","NJC","NYJC","PJC","RI","RVHS","SAJC","SRJC","TJC","TMJC","VJC","YIJC","YJC"
];
const JC_SCHOOLS_LC = JC_SCHOOLS.map(s => s.toLowerCase());

// Secondary school acronyms (extend as you go). We keep acronyms to avoid false expansions.
const SEC_SCHOOLS = [
  "AHS","BPGHS","CCHMS","CCHY","CHIJ","CGSS","DHS","EVSS","FSS","GESS","GS","HGSS","JSS","JYSS","KCPSS","KSS","MGS","NASS","NCHS","NEGS","NSS","NYGH","PHS","PRSS","QSS","RGS","RVHS","SJI","SST","TMS","TKGS","TKSS","VS","WSS","WGS","YCSS","YSS","ZSS"
];
const SEC_SCHOOLS_LC = SEC_SCHOOLS.map(s => s.toLowerCase());

function hasAny(tokens, arr) { return arr.some(x => tokens.includes(x)); }

function determineTargetPath(name) {
  const filename = basename(name);
  const lower = filename.toLowerCase();
  const tokens = tokenize(lower);

  const stream = detectStream(lower, tokens);
  let subject = detectSubject(tokens) || guessFallbackSubject(tokens) || "Misc";

  // Add H2/H1 prefix for A-level sciences/maths/econs/computing when present
  if (stream === "A levels" && (tokens.includes("h2") || tokens.includes("h1"))) {
    const level = tokens.includes("h2") ? "H2" : "H1";
    const levelable = new Set(["Chemistry","Physics","Biology","Mathematics","Economics","Computing"]);
    if (levelable.has(subject)) subject = `${level} ${subject}`;
  }

  const type = detectResourceType(lower, tokens) || "other";

  const parts = [stream, subject];

  if (type === "exam") {
    if (/\b(prelim|promo)\b/.test(lower)) {
      parts.push("Prelims");
    } else if (/\b(mye|mid[- ]?year|eoy|end[- ]?of[- ]?year|exam|tys|past\s?year)\b/.test(lower)) {
      parts.push("Exam Papers");
    } else {
      parts.push("Exam Papers");
    }
    const year = extractYear(lower);
    if (year) parts.push(String(year));

    const school = extractSchool(filename, tokens, stream);
    if (school) parts.push(school);
  } else if (type === "topical") {
    const ch = extractChapter(lower);
    if (ch) {
      parts.push("Chapters", `Chapter ${ch}`);
    } else {
      parts.push("Topical Practice");
    }
  } else if (type === "notes") {
    parts.push("Notes");
  } else {
    parts.push("Other");
  }

  return joinPath(...parts, filename);
}

function guessFallbackSubject(tokens) {
  const common = ["physics","chemistry","biology","english","math","mathematics","geography","history","economics","computing","literature","science"];
  for (const t of tokens) {
    if (common.includes(t)) return toTitle(t === "math" ? "Mathematics" : t);
  }
  return null;
}

function extractYear(lowerName) {
  const m = lowerName.match(/\b(20\d{2}|19\d{2})\b/);
  return m ? Number(m[1]) : null;
}

function extractChapter(lowerName) {
  const m = lowerName.match(/chapter\s*(\d{1,2})/);
  return m ? Number(m[1]) : null;
}

function extractSchool(nameOriginal, tokens, stream) {
  const upper = nameOriginal.toUpperCase();
  // JC first (A-level prelims)
  for (const s of JC_SCHOOLS) {
    if (upper.includes(s)) return s;
  }
  // Secondary schools (O-level prelims). Accept acronym hits, or patterns like "<Name> Sec" / "<Name> Secondary".
  for (const s of SEC_SCHOOLS) {
    if (upper.includes(s)) return s;
  }
  // Pattern: e.g., "Victoria Sec", "Tanjong Katong Secondary"
  const secIdx = upper.indexOf(" SEC");
  if (secIdx > 0) {
    const before = upper.slice(Math.max(0, secIdx - 25), secIdx).trim();
    const tokensUp = before.split(/[^A-Z0-9]+/).filter(Boolean);
    if (tokensUp.length) return toTitle(tokensUp.join(" ")) + " Sec";
  }
  const secondaryIdx = upper.indexOf(" SECONDARY");
  if (secondaryIdx > 0) {
    const before = upper.slice(Math.max(0, secondaryIdx - 25), secondaryIdx).trim();
    const tokensUp = before.split(/[^A-Z0-9]+/).filter(Boolean);
    if (tokensUp.length) return toTitle(tokensUp.join(" ")) + " Secondary";
  }
  return null;
}

// ------------------ Helpers ------------------

function basename(p) { return p.split("/").pop(); }
function joinPath(...parts) { return parts.filter(Boolean).join("/").replace(/\/+/, "/"); }
function toTitle(s) { return s.replace(/\b\w/g, c => c.toUpperCase()); }
