// Study Organizer Worker — Direct Upload (No Tree, H3 + MI)
// Cloudflare Workers + R2 (NO Queues). Name-based routing only.
// Folder policy:
//   <Stream>/<Subject>/(General Notes | Chapters | General Practice)/[Chapter N]/<filename>
// Unknown stream OR subject → Admin Review/<filename>

// Additions in this build:
//   • H1/H2/H3 detection for A-level subjects (prefix subject with H1/H2/H3 where applicable)
//   • Windows-safe filename parsing (quotes trimmed) and header-based filename support

// Endpoints:
//   GET  /health               → { ok: true }
//   GET  /dry-run?name=<file>  → { name, targetKey }
//   POST /upload?name=<file>   → writes body to targetKey in R2

/**
 * wrangler.toml
 * --------------
 * name = "study-organizer"
 * main = "study-organizer-worker.js"
 * compatibility_date = "2025-09-01"
 * account_id = "<YOUR_ACCOUNT_ID>"
 *
 * [[r2_buckets]]
 * binding = "STUDY_BUCKET"
 * bucket_name = "notesbubble"
 */

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

    // Health
    if (req.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, service: 'study-organizer-direct' });
    }

    // Dry-run (no write)
    if (req.method === 'GET' && url.pathname === '/dry-run') {
      const name = cleanName(getIncomingName(url, req) || '');
      const targetKey = determineTargetPath(name);
      return json({ name, targetKey });
    }

    // Direct upload (stream body to R2)
    if (req.method === 'POST' && url.pathname === '/upload') {
      const name = cleanName(getIncomingName(url, req) || 'upload.bin');
      const contentType = req.headers.get('content-type') || 'application/octet-stream';
      const targetKey = determineTargetPath(name);
      await env.STUDY_BUCKET.put(targetKey, req.body, { httpMetadata: { contentType } });
      return json({ ok: true, key: targetKey });
    }

    return new Response('Study Organizer (direct, no tree)', { headers: corsHeaders() });
  }
};

// ------------------------------ Router ------------------------------
function determineTargetPath(name) {
  const filename = basename(name);
  const lower = filename.toLowerCase();
  const tokens = tokenize(lower);

  const stream = detectStream(lower, tokens);
  const subject = detectSubject(tokens);

  if (!stream || !subject) return join('Admin Review', filename);

  // A-level H1/H2/H3 subject decoration (only for level-aware subjects)
  let finalSubject = subject;
  if (stream === 'A levels' && (tokens.includes('h3') || tokens.includes('h2') || tokens.includes('h1'))) {
    const level = tokens.includes('h3') ? 'H3' : tokens.includes('h2') ? 'H2' : 'H1';
    const levelable = new Set(['Chemistry','Physics','Biology','Mathematics','Economics','Computing']);
    if (levelable.has(subject)) finalSubject = `${level} ${subject}`;
  }

  const type = detectResourceType(lower);

  if (type === 'notes') return join(stream, finalSubject, 'General Notes', filename);

  if (type === 'topical') {
    const ch = extractChapter(lower);
    return ch
      ? join(stream, finalSubject, 'Chapters', `Chapter ${ch}`, filename)
      : join(stream, finalSubject, 'Chapters', filename);
  }

  // exams & unknown → General Practice
  return join(stream, finalSubject, 'General Practice', filename);
}

// -------------------------- Classification --------------------------
function tokenize(s) { return s.split(/[^a-z0-9]+/).filter(Boolean); }

function detectStream(lower, tokens) {
  // Strong A-level cues (include H3 + JC acronyms)
  if (tokens.includes('h3') || tokens.includes('h2') || tokens.includes('h1') || tokens.includes('jc') || hasAny(tokens, JC_SCHOOLS_LC) || /\ba[- ]?levels?\b/.test(lower)) {
    return 'A levels';
  }
  // O-level cues
  if (/\bo[- ]?levels?\b/.test(lower) || tokens.some(t => /^sec[1-5]$/.test(t))) return 'O levels';
  // PSLE explicit only (avoid P2/Paper 2)
  if (tokens.includes('psle') || tokens.includes('primary')) return 'PSLE';
  // Others
  if (tokens.includes('ip') || lower.includes('integrated programme')) return 'Integrated Programme';
  if (tokens.includes('ib') || lower.includes('international baccalaureate')) return 'International Baccalaureate Diploma';
  if (hasAny(tokens, ['nus','ntu','smu','sutd','sit','suss','university'])) return 'University';
  return null;
}

function detectSubject(tokens) {
  const has = (w) => tokens.includes(w);

  // Multi-word first
  if (has('additional') && (has('math') || has('maths'))) return 'Additional Math';
  if (has('elementary') && (has('math') || has('maths'))) return 'Elementary Math';
  if (has('principles') && has('of') && has('accounts')) return 'Principles of Accounts';
  if (has('social') && has('studies')) return 'Social Studies';
  if ((has('design') && has('and') && has('technology')) || has('dnt')) return 'Design and Technology';
  if ((has('nutrition') && has('and') && has('food') && has('science')) || has('nfs')) return 'Nutrition and Food Science';
  if ((has('comb') || has('combined')) && (has('sci') || has('science'))) return 'Combined Science';
  if (has('combined') && has('physics')) return 'Combined Physics';
  if (has('combined') && has('chemistry')) return 'Combined Chemistry';
  if (has('combined') && has('biology')) return 'Combined Biology';
  if (has('higher') && has('chinese')) return 'Higher Chinese';
  if (has('higher') && has('malay')) return 'Higher Malay';
  if (has('higher') && has('tamil')) return 'Higher Tamil';

  // Short forms / aliases
  if (has('amath') || has('a-math') || (has('am') && (has('math') || has('maths')))) return 'Additional Math';
  if (has('emath') || has('e-math') || (has('em') && (has('math') || has('maths')))) return 'Elementary Math';
  if (has('ss')) return 'Social Studies';
  if (has('hcl')) return 'Higher Chinese';
  if (has('hml')) return 'Higher Malay';
  if (has('htl')) return 'Higher Tamil';
  if (has('cl')) return 'Chinese';
  if (has('ml')) return 'Malay';
  if (has('tl')) return 'Tamil';

  // Singles
  if (has('mathematics') || has('math') || has('maths')) return 'Mathematics';
  if (has('eng') || has('english') || has('el')) return 'English';
  if (has('phy')) return 'Physics';
  if (has('chem') || has('chemistry')) return 'Chemistry';
  if (has('bio') || has('biology')) return 'Biology';
  if (has('geog') || has('geography')) return 'Geography';
  if (has('lit') || has('literature')) return 'Literature';
  if (has('poa')) return 'Principles of Accounts';
  if (has('sci') || has('science')) return 'Science';
  if (has('computing')) return 'Computing';
  if (has('economics') || has('econs')) return 'Economics';

  return null;
}

function detectResourceType(lower) {
  if (/(\bprelim(s)?\b|\bpromo(s)?\b|\bmye\b|\beoy\b|\bmid[- ]?year\b|\bend[- ]?of[- ]?year\b|\bpaper\s?(1|2|3|4)\b|\bp[12]\b|\bexam\b|\bpast\s?year\b|\btys\b)/.test(lower)) return 'exam';
  if (/(\btopical\b|\bchapter(s)?\b|\bchap\.?\b|\bch\.?\b|\btopic\b|\bunit\b|\bworksheet(s)?\b|\bpractice\b|\brevision\b)/.test(lower)) return 'topical';
  if (/(\bnotes?\b|\bsummary\b|\bmind\s?map\b|\bcheat\s?sheet\b|\bsyllabus\b)/.test(lower)) return 'notes';
  return null;
}

function extractChapter(lower) {
  // Accept: "Chapter 7", "Chap 7", "Ch 7", "Ch. 7", and tight forms like "Ch7"
  const m = lower.match(/\b(?:chapter|chap\.?|ch\.?)\s*(\d{1,2})\b/);
  return m ? Number(m[1]) : null;
}

// ------------------------------ Constants ------------------------------
// JC acronyms (token-aware). Includes MI (Millennia Institute).
const JC_SCHOOLS = [
  'ACJC','AJC','ASRJC','CJC','DHS','EJC','HCI','IJC','JJC','JPJC','MI','MJC','NJC','NYJC','PJC','RI','RVHS','SAJC','SRJC','TJC','TMJC','VJC','YIJC','YJC'
];
const JC_SCHOOLS_LC = JC_SCHOOLS.map(s => s.toLowerCase());

// ------------------------------ Utils ------------------------------
function getIncomingName(url, req) { return url.searchParams.get('name') || req.headers.get('x-filename'); }
function cleanName(s) { return s ? s.replace(/^['\"]+|['\"]+$/g, '').trim() : s; }
function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...corsHeaders() } }); }
function corsHeaders() { return { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, x-filename' }; }
function basename(p) { return p.split('/').pop(); }
function join(...parts) { return parts.filter(Boolean).join('/').replace(/\/+/, '/'); }
function hasAny(tokens, arr) { return arr.some(x => tokens.includes(x)); }
