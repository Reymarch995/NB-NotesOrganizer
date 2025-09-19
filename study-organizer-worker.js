// Study Organizer Worker — Direct Upload (Name-based, Admin Review + No Misc)
// Cloudflare Workers + R2 (NO Queues required)
// Routes by *filename only* into your strict structure:
//   <Stream>/<Subject>/(General Notes | Chapters | General Practice)/[Chapter N]/<filename>
// If the subject or stream can't be determined → "Admin Review/<filename>" at root.

/**
 * wrangler.toml
 * --------------
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
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });

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

    // Direct upload (write to final key)
    if (req.method === "POST" && url.pathname === "/upload") {
      const name = getIncomingName(url, req) || "upload.bin";
      const ct = req.headers.get("content-type") || "application/octet-stream";
      const targetKey = determineTargetPath(name);
      await env.STUDY_BUCKET.put(targetKey, req.body, { httpMetadata: { contentType: ct } });
      return json({ ok: true, key: targetKey });
    }

    return new Response("Study Organizer (name-based, direct upload)", { headers: corsHeaders() });
  }
};

function getIncomingName(url, req) { return url.searchParams.get("name") || req.headers.get("x-filename"); }
function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...corsHeaders() } }); }
function corsHeaders() { return { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, GET, OPTIONS", "access-control-allow-headers": "content-type, x-filename" }; }

// ------------------ Classification (token-based, aliases) ------------------
function tokenize(s) { return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); }

// Streams — only create keys under known streams; else Admin Review
function detectStream(lower, tokens) {
  if (tokens.includes("h2") || tokens.includes("h1") || tokens.includes("jc") || hasAny(tokens, JC_SCHOOLS_LC) || /\ba[- ]?levels?\b/.test(lower)) return "A levels";
  if (/\bo[- ]?levels?\b/.test(lower) || tokens.some(t => /^sec[1-5]$/.test(t))) return "O levels";
  if (tokens.includes("psle") || tokens.includes("primary")) return "PSLE";
  if (tokens.includes("ip") || lower.includes("integrated programme")) return "Integrated Programme";
  if (tokens.includes("ib") || lower.includes("international baccalaureate")) return "International Baccalaureate Diploma";
  if (hasAny(tokens, ["nus","ntu","smu","sutd","sit","suss","university"])) return "University";
  return null; // unknown → Admin Review
}

function detectSubject(tokens) {
  const has = (w) => tokens.includes(w);
  // multi-word
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
  // short forms
  if (has("amath") || (has("am") && has("math"))) return "Additional Math";
  if (has("emath") || (has("em") && has("math"))) return "Elementary Math";
  if (has("ss")) return "Social Studies";
  if (has("hcl")) return "Higher Chinese"; if (has("hml")) return "Higher Malay"; if (has("htl")) return "Higher Tamil";
  if (has("cl")) return "Chinese"; if (has("ml")) return "Malay"; if (has("tl")) return "Tamil";
  // singles / common abbrev
  if (has("eng") || has("english") || has("el")) return "English";
  if (has("phy")) return "Physics"; if (has("chem") || has("chemistry")) return "Chemistry"; if (has("bio") || has("biology")) return "Biology";
  if (has("geog") || has("geography")) return "Geography"; if (has("lit") || has("literature")) return "Literature";
  if (has("poa")) return "Principles of Accounts"; if (has("sci") || has("science")) return "Science";
  if (has("computing")) return "Computing"; if (has("economics") || has("econs")) return "Economics";
  return null; // unknown → Admin Review
}

function detectResourceType(lower) {
  if (/(\bprelim(s)?\b|\bpromo(s)?\b|\bmye\b|\beoy\b|\bmid[- ]?year\b|\bend[- ]?of[- ]?year\b|\bpaper\s?(1|2|3|4)\b|\bp[12]\b|\bexam\b|\bpast\s?year\b|\btys\b)/.test(lower)) return "exam";
  if (/(\btopical\b|\bchapter(s)?\b|\btopic\b|\bunit\b|\bworksheet(s)?\b|\bpractice\b|\brevision\b)/.test(lower)) return "topical";
  if (/(\bnotes?\b|\bsummary\b|\bmind\s?map\b|\bcheat\s?sheet\b|\bsyllabus\b)/.test(lower)) return "notes";
  return null; // unknown → treat as exam/practice default later
}

const JC_SCHOOLS = ["ACJC","AJC","ASRJC","CJC","DHS","EJC","HCI","IJC","JJC","JPJC","MI","MJC","NJC","NYJC","PJC","RI","RVHS","SAJC","SRJC","TJC","TMJC","VJC","YIJC","YJC"]; const JC_SCHOOLS_LC = JC_SCHOOLS.map(s=>s.toLowerCase());

function determineTargetPath(name) {
  const filename = basename(name);
  const lower = filename.toLowerCase();
  const tokens = tokenize(lower);

  const subject = detectSubject(tokens);
  const stream = detectStream(lower, tokens);

  // Fallback policy: unknown subject OR unknown stream → Admin Review at root
  if (!subject || !stream) return joinPath("Admin Review", filename);

  // H1/H2 label only decorates subject name; does not create separate folders
  let finalSubject = subject;
  if (stream === "A levels" && (tokens.includes("h2") || tokens.includes("h1"))) {
    const level = tokens.includes("h2") ? "H2" : "H1";
    const levelable = new Set(["Chemistry","Physics","Biology","Mathematics","Economics","Computing"]);
    if (levelable.has(subject)) finalSubject = `${level} ${subject}`;
  }

  const type = detectResourceType(lower);

  // Map resource type → your exact folder set
  if (type === "notes") {
    return joinPath(stream, finalSubject, "General Notes", filename);
  }
  if (type === "topical") {
    const ch = extractChapter(lower);
    if (ch) return joinPath(stream, finalSubject, "Chapters", `Chapter ${ch}`, filename);
    return joinPath(stream, finalSubject, "Chapters", filename);
  }
  // exams and unknown → General Practice
  return joinPath(stream, finalSubject, "General Practice", filename);
}

function extractChapter(lower) { const m = lower.match(/chapter\s*(\d{1,2})/); return m ? Number(m[1]) : null; }

// ------------------ Helpers ------------------
function basename(p){return p.split("/").pop();}
function joinPath(...parts){return parts.filter(Boolean).join("/").replace(/\/+/,"/");}
function hasAny(tokens,arr){return arr.some(x=>tokens.includes(x));}
