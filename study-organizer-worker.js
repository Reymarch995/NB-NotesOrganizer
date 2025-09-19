// Study Organizer Worker — Direct Upload (Name-based)
// Cloudflare Workers + R2 (NO Queues required)
// Uploads directly to R2 at the computed target key based on the *filename* only.
// If you call /upload?name=..., it will classify stream/subject/type and write to that path.
// (c) Studybubble — built by rayhan <3

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

    // Dry run (no write) — calculate where a file *would* go
    // GET /dry-run?name=<filename>
    if (req.method === "GET" && url.pathname === "/dry-run") {
      const name = getIncomingName(url, req) || "";
      const targetKey = determineTargetPath(name) || `General/Misc/Other/${basename(name || "file.bin")}`;
      return json({ name, targetKey });
    }

    // Direct upload (streamed write to R2)
    // POST /upload?name=<filename>
    if (req.method === "POST" && url.pathname === "/upload") {
      const name = getIncomingName(url, req) || "upload.bin";
      const ct = req.headers.get("content-type") || "application/octet-stream";

      // compute destination *by filename only*
      const targetKey = determineTargetPath(name) || `General/Misc/Other/${basename(name)}`;

      // idempotency: if client sends a path as name, we still compute from basename
      await env.STUDY_BUCKET.put(targetKey, req.body, { httpMetadata: { contentType: ct } });
      return json({ ok: true, key: targetKey });
    }

    return new Response("Study Organizer (name-based, direct upload)", { headers: corsHeaders() });
  }
};

function getIncomingName(url, req) {
  // Prefer explicit query param; fallback to X-Filename header for browser uploads
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

// ------------------ Name-only classification ------------------

// Subject keyword → canonical subject folder name
const SUBJECTS = new Map([
  // Languages
  ["english", "English"],
  ["el", "English"],
  ["chinese", "Chinese"],
  ["malay", "Malay"],
  ["tamil", "Tamil"],
  ["higher chinese", "Higher Chinese"],
  ["higher malay", "Higher Malay"],
  ["higher tamil", "Higher Tamil"],

  // Mathematics
  ["mathematics", "Mathematics"],
  ["math", "Mathematics"],
  ["amath", "Additional Math"],
  ["a-math", "Additional Math"],
  ["additional math", "Additional Math"],
  ["emath", "Elementary Math"],
  ["e-math", "Elementary Math"],
  ["elementary math", "Elementary Math"],
  ["poa", "Principles of Accounts"],
  ["principles of accounts", "Principles of Accounts"],

  // Sciences
  ["physics", "Physics"],
  ["chemistry", "Chemistry"],
  ["chem", "Chemistry"],
  ["biology", "Biology"],
  ["bio", "Biology"],
  ["combined physics", "Combined Physics"],
  ["combined chemistry", "Combined Chemistry"],
  ["combined biology", "Combined Biology"],
  ["science", "Science"],

  // Humanities
  ["history", "History"],
  ["geography", "Geography"],
  ["geo", "Geography"],
  ["social studies", "Social Studies"],
  ["literature", "Literature"],

  // Creative Arts & others
  ["art", "Art"],
  ["music", "Music"],
  ["dnt", "Design and Technology"],
  ["design and technology", "Design and Technology"],
  ["nutrition", "Nutrition and Food Science"],
  ["food science", "Nutrition and Food Science"],

  // Specials
  ["computing", "Computing"],
  ["economics", "Economics"],
  ["electronics", "Electronics"],
]);

// Streams / levels detected from filename
const STREAM_HINTS = [
  [/\bpsle\b|\bprimary\b|\bp[1-6]\b/i, "PSLE"],
  [/\b(o[- ]?levels?|sec(ondary)?\s*[1-5])\b/i, "O levels"],
  [/\b(a[- ]?levels?|h[12]\b|\bJC\b|\b(asrjc|acjc|ajc|cjc|dhs|e?jc|hci|ijc|jjc|mi|mjc|njc|nyjc|pjc|ri|rvhs|sajc|srjc|t(m)?jc|vjc|yijc|yjc)\b)/i, "A levels"],
  [/\b(ip|integrated programme)\b/i, "Integrated Programme"],
  [/\b(ib|international baccalaureate)\b/i, "International Baccalaureate Diploma"],
  [/\b(nus|ntu|smu|sutd|sit|suss|university)\b/i, "University"],
];

// JC & common school tags for prelim routing
const JC_SCHOOLS = [
  "ACJC","AJC","ASRJC","CJC","DHS","EJC","HCI","IJC","JJC","JPJC","MI","MJC","NJC","NYJC","PJC","RI","RVHS","SAJC","SRJC","TJC","TMJC","VJC","YIJC","YJC"
];

function determineTargetPath(name) {
  const filename = basename(name);
  const lower = filename.toLowerCase();

  const stream = detectStream(lower) || inferStreamFromContext(lower) || "General";
  const subject = detectSubject(lower) || guessFallbackSubject(lower) || "Misc";
  const type = detectResourceType(lower) || "other";

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
    const school = extractSchool(filename);
    if (school) parts.push(school);
  }
  else if (type === "topical") {
    const ch = extractChapter(lower);
    if (ch) {
      parts.push("Chapters", `Chapter ${ch}`);
    } else {
      parts.push("Topical Practice");
    }
  }
  else if (type === "notes") {
    parts.push("Notes");
  }
  else {
    parts.push("Other");
  }

  return joinPath(...parts, filename);
}

function detectResourceType(lowerName) {
  if (/(\bprelim(s)?\b|\bpromo(s)?\b|\bmye\b|\beoy\b|\bmid[- ]?year\b|\bend[- ]?of[- ]?year\b|\bpaper\s?(1|2|3|4)\b|\bp[12]\b|\bexam\b|\bpast\s?year\b|\btys\b)/.test(lowerName)) return "exam";
  if (/(\btopical\b|\bchapter(s)?\b|\btopic\b|\bunit\b|\bworksheet(s)?\b|\bpractice\b|\brevision\b)/.test(lowerName)) return "topical";
  if (/(\bnotes?\b|\bsummary\b|\bmind\s?map\b|\bcheat\s?sheet\b|\bsyllabus\b)/.test(lowerName)) return "notes";
  return null;
}

function detectStream(lowerName) {
  for (const [regex, label] of STREAM_HINTS) {
    if (regex.test(lowerName)) return label;
  }
  return null;
}

function inferStreamFromContext(lowerName) {
  if (/h2|h1|jc|prelim/.test(lowerName)) return "A levels";
  if (/sec\s?[1-5]|o[- ]?level/.test(lowerName)) return "O levels";
  if (/p[4-6]|psle/.test(lowerName)) return "PSLE";
  return null;
}

function detectSubject(lowerName) {
  for (const [kw, canonical] of SUBJECTS) {
    if (lowerName.includes(kw)) return canonical;
  }
  return null;
}

function guessFallbackSubject(lowerName) {
  const tokens = lowerName.replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(Boolean);
  const common = ["physics","chemistry","biology","english","math","geography","history","economics","computing","literature","science"];
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

function extractSchool(nameOriginal) {
  const upper = nameOriginal.toUpperCase();
  for (const s of JC_SCHOOLS) {
    if (upper.includes(s)) return s;
  }
  return null;
}

// ------------------ Helpers ------------------

function basename(p) { return p.split("/").pop(); }
function joinPath(...parts) { return parts.filter(Boolean).join("/").replace(/\/+/, "/"); }
function toTitle(s) { return s.replace(/\b\w/g, c => c.toUpperCase()); }
