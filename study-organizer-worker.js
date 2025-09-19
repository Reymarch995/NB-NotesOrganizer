// Coded with <3 by Rayhan and Team Notesbubble

// Study Organizer Worker — Direct Upload (No Tree) — Secured
// Cloudflare Workers + R2 — DIRECT upload only (no Queues, no tree reads).
// Based on your current v2 file; adds:
//   • x-api-key auth on /upload (use wrangler secret UPLOAD_API_KEY)
//   • Overwrite guard (auto-suffix " (1)", "(2)" if key exists)
//   • Basic size guard via Content-Length (configurable)
//   • CORS allows x-api-key header
// Routing logic remains unchanged (A level / O level only).

/** wrangler.toml (no Queues)
name = "study-organizer"
main = "study-organizer-worker.js"
compatibility_date = "2025-09-01"

[[r2_buckets]]
binding = "STUDY_BUCKET"
bucket_name = "notesbubble"
*/

// ===== Config =====
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB cap; adjust if needed

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });

    if (req.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, service: 'study-organizer-direct' }, 200, req);
    }

    if (req.method === 'GET' && url.pathname === '/dry-run') {
      const name = cleanName(getIncomingName(url, req) || '');
      const key = determineTargetKey(name);
      return json({ name, targetKey: key }, 200, req);
    }

    if (req.method === 'POST' && url.pathname === '/upload') {
      if (!checkAuth(req, env)) return unauthorized(req);

      const name = cleanName(getIncomingName(url, req) || 'upload.bin');
      const ct = req.headers.get('content-type') || 'application/octet-stream';

      // Size guard (best-effort; depends on Content-Length header presence)
      const len = Number(req.headers.get('content-length') || '0');
      if (len && len > MAX_BYTES) {
        return json({ error: 'too_large', limit: MAX_BYTES }, 413, req);
      }

      const rawKey = determineTargetKey(name);
      const key = await ensureUniqueKey(env.STUDY_BUCKET, rawKey);

      await env.STUDY_BUCKET.put(key, req.body, { httpMetadata: { contentType: ct } });
      return json({ ok: true, key }, 200, req);
    }

    return new Response('Study Organizer (direct, no tree)', { headers: cors(req) });
  }
};

// ---------------------------- Routing ----------------------------
function determineTargetKey(name) {
  const filename = basename(name); // NEVER mutate original filename
  const lower = filename.toLowerCase();
  const tokens = tokenize(lower);

  const stream = detectStream(lower, tokens); // 'A level' | 'O level' | 'PSLE' | null
  if (!stream) return join('Admin Review', filename);

  if (stream === 'A level') {
    const aLevel = detectALevel(tokens); // 'H3'|'H2'|'H1'|null
    const subject = detectASubject(tokens);
    if (!aLevel || !subject) return join('Admin Review', filename);

    const leaf = subject; // e.g., 'Chemistry', 'Mathematics'
    return routeByType(lower, [stream, aLevel, leaf], filename);
  }

  if (stream === 'O level') {
    const band = detectOSecondaryBand(lower, tokens); // Upper/Lower labels
    const { group, leaf } = detectOSubject(tokens);
    if (!band || !group || !leaf) return join('Admin Review', filename);

    return routeByType(lower, [stream, band, group, leaf], filename);
  }

  // PSLE or others not modeled → Admin Review (strict policy)
  return join('Admin Review', filename);
}

function routeByType(lower, baseParts, filename) {
  const type = detectResourceType(lower);
  if (type === 'notes') return join(...baseParts, 'General Notes', filename);
  if (type === 'topical') {
    const ch = extractChapter(lower);
    return ch
      ? join(...baseParts, 'Chapters', `Chapter ${ch}`, filename)
      : join(...baseParts, 'Chapters', filename);
  }
  // exams and unknown → General Practice
  return join(...baseParts, 'General Practice', filename);
}

// ---------------------------- Detection ----------------------------
function tokenize(s){ return s.split(/[^a-z0-9]+/).filter(Boolean); }

function detectStream(lower, tokens){
  // *** Give O-level precedence when we clearly see Sec + number ***
  if (isOLevelBySec(tokens, lower)) return 'O level';

  // A level cues: H1/H2/H3, JC/MI, or explicit 'A level(s)'
  if (tokens.includes('h3') || tokens.includes('h2') || tokens.includes('h1')) return 'A level';
  const jcTokens = ['jc','acjc','ajc','asrjc','cjc','dhs','ejc','hci','ijc','jjc','jpjc','mi','mjc','njc','nyjc','pjc','ri','rvhs','sajc','srjc','tjc','tmjc','vjc','yijc','yjc','rjc'];
  if (hasAny(tokens, jcTokens) || /\ba[- ]?levels?\b/.test(lower)) return 'A level';

  // O-level cues (secondary without number)
  if (/\bo[- ]?levels?\b/.test(lower) || /\bsecondary\b/.test(lower)) return 'O level';
  if (/(upper\s*secondary|lower\s*secondary)/.test(lower)) return 'O level';

  if (tokens.includes('psle') || tokens.includes('primary')) return 'PSLE';
  return null;
}

function isOLevelBySec(tokens, lower){
  // Matches: "sec 3", "sec3", "secondary 4" etc.
  if (/(sec\s*[1-5]|secondary\s*[1-5])/.test(lower)) return true;
  // Token pattern: [ 'sec', '4' ] etc.
  const hasSec = tokens.includes('sec');
  const hasNum = tokens.some(t => ['1','2','3','4','5'].includes(t));
  return hasSec && hasNum;
}

function detectALevel(tokens){ if (tokens.includes('h3')) return 'H3'; if (tokens.includes('h2')) return 'H2'; if (tokens.includes('h1')) return 'H1'; return null; }

// A-level subjects — leaf names (inside H1/H2/H3)
function detectASubject(tokens){
  const has = (w)=>tokens.includes(w);
  if (has('chem') || has('chemistry')) return 'Chemistry';
  if (has('physics') || has('phy')) return 'Physics';
  if (has('biology') || has('bio')) return 'Biology';
  if (has('math') || has('maths') || has('mathematics')) return 'Mathematics';
  if (has('econs') || has('economics')) return 'Economics';
  if (has('computing')) return 'Computing';
  if (has('gp') || (has('general') && has('paper'))) return 'General Paper';
  if (has('ki') || (has('knowledge') && has('inquiry')) ) return 'Knowledge and Inquiry';
  if (has('chinese') || has('cl')) return 'Chinese';
  if (has('malay') || has('ml')) return 'Malay';
  if (has('tamil') || has('tl')) return 'Tamil';
  return null;
}

// O-level band (Upper vs Lower Secondary)
const O_UPPER = 'Upper Secondary (Secondary 3-4)';
const O_LOWER = 'Lower Secondary (Secondary 1-2)';
function detectOSecondaryBand(lower, tokens){
  if (/(sec\s*3|sec3|secondary\s*3|sec\s*4|sec4|secondary\s*4|upper\s*secondary)/.test(lower)) return O_UPPER;
  if (/(sec\s*1|sec1|secondary\s*1|sec\s*2|sec2|secondary\s*2|lower\s*secondary)/.test(lower)) return O_LOWER;
  for (const t of tokens){ const m=t.match(/^sec(\d)$/); if(m){ const n=Number(m[1]); return n>=3?O_UPPER:O_LOWER; }}
  if (tokens.includes('sec')){
    // If just 'sec' + number as separate tokens
    const nTok = tokens.find(t=>['1','2','3','4','5'].includes(t));
    if (nTok){ const n=Number(nTok); return n>=3?O_UPPER:O_LOWER; }
  }
  return null;
}

// O-level subject groups & leaves (based on your screenshot/text)
function detectOSubject(tokens){
  const has=(w)=>tokens.includes(w);
  // Pure Science
  if (has('pure') && (has('chem')||has('chemistry'))) return { group:'Pure Science (PP-PB-PC)', leaf:'Pure Chemistry' };
  if (has('pure') && (has('physics')||has('phy'))) return { group:'Pure Science (PP-PB-PC)', leaf:'Pure Physics' };
  if (has('pure') && (has('biology')||has('bio'))) return { group:'Pure Science (PP-PB-PC)', leaf:'Pure Biology' };
  // Combined Science
  if ((has('combined')||has('comb')) && (has('chem')||has('chemistry'))) return { group:'Combined Science (CP-CB-CC)', leaf:'Combined Chemistry' };
  if ((has('combined')||has('comb')) && (has('physics')||has('phy'))) return { group:'Combined Science (CP-CB-CC)', leaf:'Combined Physics' };
  if ((has('combined')||has('comb')) && (has('biology')||has('bio'))) return { group:'Combined Science (CP-CB-CC)', leaf:'Combined Biology' };
  if (has('combined') || (has('science') && !has('pure'))) return { group:'Combined Science (CP-CB-CC)', leaf:'Combined Science' };
  // English
  if (has('english') || has('eng') || has('el')) return { group:'English', leaf:'English' };
  // Mathematics
  if (has('amath') || has('a-math') || (has('am')&&(has('math')||has('maths')))) return { group:'Mathematics (AM-EM-POA)', leaf:'Additional Math' };
  if (has('emath') || has('e-math') || (has('em')&&(has('math')||has('maths')))) return { group:'Mathematics (AM-EM-POA)', leaf:'Elementary Math' };
  if (has('poa') || (has('principles')&&has('of')&&has('accounts'))) return { group:'Mathematics (AM-EM-POA)', leaf:'Principles of Accounts' };
  if (has('math') || has('maths') || has('mathematics')) return { group:'Mathematics (AM-EM-POA)', leaf:'Mathematics' };
  // MTLs
  if ((has('higher') && has('chinese')) || has('hcl')) return { group:'MTL (incl. Higher MTL and NTIL)', leaf:'Higher Chinese' };
  if ((has('higher') && has('malay')) || has('hml')) return { group:'MTL (incl. Higher MTL and NTIL)', leaf:'Higher Malay' };
  if ((has('higher') && has('tamil')) || has('htl')) return { group:'MTL (incl. Higher MTL and NTIL)', leaf:'Higher Tamil' };
  if (has('chinese') || has('cl')) return { group:'MTL (incl. Higher MTL and NTIL)', leaf:'Chinese' };
  if (has('malay') || has('ml')) return { group:'MTL (incl. Higher MTL and NTIL)', leaf:'Malay' };
  if (has('tamil') || has('tl')) return { group:'MTL (incl. Higher MTL and NTIL)', leaf:'Tamil' };
  // Humanities
  if ((has('social')&&has('studies')) || has('ss')) return { group:'Elective Humanities (EH-EG-SS)', leaf:'Social Studies' };
  if ((has('elective')&&has('history')) || has('ehist')) return { group:'Elective Humanities (EH-EG-SS)', leaf:'Elective History' };
  if ((has('elective')&&has('geography')) || has('egeo')) return { group:'Elective Humanities (EH-EG-SS)', leaf:'Elective Geography' };
  if (has('pure')&&has('history')) return { group:'Pure Humanities (PH-PG-PL)', leaf:'Pure History' };
  if (has('pure')&&has('geography')) return { group:'Pure Humanities (PH-PG-PL)', leaf:'Pure Geography' };
  if ((has('pure')&&has('literature')) || has('lit')) return { group:'Pure Humanities (PH-PG-PL)', leaf:'Pure Literature' };
  // Creative Arts
  if (has('dnt') || (has('design')&&has('technology'))) return { group:'Creative Arts (DNT-ART-MUS-NFS)', leaf:'Design and Technology' };
  if (has('art')) return { group:'Creative Arts (DNT-ART-MUS-NFS)', leaf:'Art' };
  if (has('music')) return { group:'Creative Arts (DNT-ART-MUS-NFS)', leaf:'Music' };
  if ((has('nutrition')&&has('food')&&has('science')) || has('nfs')) return { group:'Creative Arts (DNT-ART-MUS-NFS)', leaf:'Nutrition and Food Science' };
  // Special Subjects
  if (has('computing')) return { group:'Special Subjects (COM-ELC-ECN)', leaf:'Computing' };
  if (has('electronics') || has('elc')) return { group:'Special Subjects (COM-ELC-ECN)', leaf:'Electronics' };
  if (has('economics') || has('econs')) return { group:'Special Subjects (COM-ELC-ECN)', leaf:'Economics' };
  return { group: null, leaf: null };
}

function detectResourceType(lower){
  if (/(\bprelim(s)?\b|\bpromo(s)?\b|\bmye\b|\beoy\b|\bmid[- ]?year\b|\bend[- ]?of[- ]?year\b|\bpaper\s?(1|2|3|4)\b|\bp[12]\b|\bexam\b|\bpast\s?year\b|\btys\b)/.test(lower)) return 'exam';
  if (/(\btopical\b|\bchapter(s)?\b|\bchap\.?\b|\bch\.?\b|\btopic\b|\bunit\b|\bworksheet(s)?\b|\bpractice\b|\brevision\b)/.test(lower)) return 'topical';
  if (/(\bnotes?\b|\bsummary\b|\bmind\s?map\b|\bcheat\s?sheet\b|\bsyllabus\b)/.test(lower)) return 'notes';
  return null;
}

function extractChapter(lower){
  const m = lower.match(/\b(?:chapter|chap\.?|ch\.?)\s*(\d{1,2})\b/); // 'Chapter 7', 'Ch. 7', 'Ch7'
  return m ? Number(m[1]) : null;
}

// ---------------------------- Security helpers ----------------------------
function checkAuth(req, env){
  const k = req.headers.get('x-api-key');
  return Boolean(k && env.UPLOAD_API_KEY && k === env.UPLOAD_API_KEY);
}

function unauthorized(req){
  return json({ error: 'unauthorized' }, 401, req);
}

async function ensureUniqueKey(bucket, key){
  const slash = key.lastIndexOf('/');
  const dir = slash >= 0 ? key.slice(0, slash + 1) : '';
  const base = slash >= 0 ? key.slice(slash + 1) : key;
  const m = base.match(/^(.*?)(\.[^.]+)?$/);
  const stem = m ? m[1] : base;
  const ext = m && m[2] ? m[2] : '';
  let candidate = key;
  let i = 1;
  while (await bucket.head(candidate)) {
    candidate = `${dir}${stem} (${i++})${ext}`;
  }
  return candidate;
}

// ---------------------------- Utils ----------------------------
function getIncomingName(url, req){ return url.searchParams.get('name') || req.headers.get('x-filename'); }
function cleanName(s){ return s ? s.replace(/^['\"]+|['\"]+$/g, '').trim() : s; }
function basename(p){ return p.split('/').pop(); }
function join(...parts){ return parts.filter(Boolean).join('/').replace(/\/+/, '/'); }
function cors(req){ return { 'access-control-allow-origin': req.headers.get('origin') || '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, x-filename, x-api-key' }; }
function json(obj, status=200, req){ return new Response(JSON.stringify(obj), { status, headers: { 'content-type':'application/json', ...cors(req) } }); }
function hasAny(tokens, arr){ return arr.some(x => tokens.includes(x)); }
