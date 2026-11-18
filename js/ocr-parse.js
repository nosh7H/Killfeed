// Scoreboard text parsing (pure, unit-testable). Turns OCR text into
// candidate rows: { player, score, numbers[] } for the column mapper.

const CONFUSIONS = { '0': 'o', '1': 'l', '|': 'l', 'i': 'l', '5': 's', '$': 's', '8': 'b', '@': 'a' };

export function normTag(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, '')            // clan tags like [OPTX]
    .replace(/[0158|i$@]/g, c => CONFUSIONS[c] || c)
    .replace(/[^a-z0-9]/g, '');
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function similarity(a, b) {
  a = normTag(a); b = normTag(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

const NUM_RE = /^(\d{1,3}:\d{2}|\d{1,3}(?:,\d{3})+|\d+)$/;

export function parseNumberToken(tok) {
  const t = tok.replace(/[^\d:,]/g, '');
  if (!NUM_RE.test(t)) return null;
  if (t.includes(':')) {
    const [m, s] = t.split(':').map(Number);
    return { raw: t, value: m * 60 + s, isTime: true };
  }
  return { raw: t, value: Number(t.replace(/,/g, '')), isTime: false };
}

const PAIR = '\u0001'; // marks the kills half of a "17/17" token

/**
 * Caster boards show kills/deaths as "17/17". When OCR drops the slash ("1717"), split it back:
 * in one event map nobody has more than 2-digit kills or deaths, and the other rows show
 * which column holds the pair.
 */
function fixLostSlash(rows) {
  const at = rows.map(r => r.pairAt).filter(i => i >= 0);
  if (at.length < 2) return;
  const counts = at.reduce((m, i) => m.set(i, (m.get(i) || 0) + 1), new Map());
  const p = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  for (const r of rows) {
    if (r.pairAt === p) continue;
    const n = r.numbers[p];
    if (!n || n.isTime || !/^\d{2,4}$/.test(n.raw)) continue;
    const s = n.raw;
    let k, d;
    if (s.length === 4) { k = s.slice(0, 2); d = s.slice(2); }
    else if (s.length === 3) {
      // 1+2 or 2+1 digits: take the split with the more believable K/D
      const opts = [[s.slice(0, 1), s.slice(1)], [s.slice(0, 2), s.slice(2)]];
      [k, d] = opts.sort((x, y) => Math.abs(Math.log((+x[0] + 1) / (+x[1] + 1))) - Math.abs(Math.log((+y[0] + 1) / (+y[1] + 1))))[0];
    } else continue; // 2 digits: already a single kills value, leave it
    r.numbers.splice(p, 1, { raw: k, value: +k, isTime: false }, { raw: d, value: +d, isTime: false });
    r.pairAt = p;
  }
}

/** "H8ME 5425 31 73 1 [k]hype 4365 29 19" → ["H8ME 5425 31 73 1", "[k]hype 4365 29 19"] (else [line]). */
export function splitDouble(line) {
  const t = line.split(/\s+/);
  const isNum = x => /\d/.test(x) && !!parseNumberToken(x);
  const isWord = x => (x.match(/[a-z]/gi) || []).length >= 2;
  const first = t.findIndex(isWord);
  if (first < 0) return [line];
  for (let j = first + 1; j < t.length; j++) {
    if (!isWord(t[j])) continue;
    if (t.slice(first, j).filter(isNum).length >= 3 && t.slice(j).filter(isNum).length >= 3) return [t.slice(0, j).join(' '), t.slice(j).join(' ')];
  }
  return [line];
}

/**
 * @param {string} text   raw OCR output
 * @param {Array<{id,gamertag}>} roster
 * @returns rows sorted by appearance: { line, player, score, numbers }
 */
export function parseScoreboard(text, roster = [], minScore = 0.6) {
  const rows = [];
  // side-by-side boards (player POV) put a row from each team on one line → split into halves
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    .flatMap(l => { const parts = splitDouble(l); return parts.map((line, i) => ({ line, half: parts.length > 1 ? (i ? 'R' : 'L') : null })); });
  for (const { line, half } of lines) {
    if (/\b(FPS|PING|LATENCY|PACKET|GPU)\b/i.test(line)) continue; // performance overlay, not a player row
    const tokens = line.split(/\s+/)
      .flatMap(t => (/^\d{1,3}\/\d{1,3}$/.test(t) ? t.split('/').map((x, i) => (i ? x : `${x}${PAIR}`)) : [t])) // caster boards: "17/17" = kills/deaths
      .filter(t => /[\w:]/.test(t));
    if (tokens.length < 2) continue;

    // Find the best (start, end) token span that matches a roster gamertag
    let best = { score: 0, player: null, start: 0, end: 0 };
    for (let start = 0; start < Math.min(3, tokens.length); start++) {
      for (let end = start + 1; end <= Math.min(start + 4, tokens.length); end++) {
        const cand = tokens.slice(start, end).join('');
        for (const p of roster) {
          const sc = similarity(cand, p.gamertag);
          if (sc > best.score) best = { score: sc, player: p, start, end };
        }
      }
    }

    let numbers, player = null, score = 0, pairAt = -1;
    if (best.score >= minScore) {
      player = best.player; score = best.score;
      numbers = tokens.slice(best.end).map(parseNumberToken).filter(Boolean);
      pairAt = tokens.slice(best.end).filter(t => parseNumberToken(t)).findIndex(t => t.includes(PAIR));
    } else {
      // Unmatched: assume the name is the leading run of non-number tokens (after an optional rank "1")
      const lead = /^\d{1,2}$/.test(tokens[0]) && /[a-z]{2}/i.test(tokens[1] || '') ? 1 : 0;
      const firstNum = tokens.findIndex((t, i) => i >= lead && !/[a-z]/i.test(t) && parseNumberToken(t)); // "H8ME" is a name, not 8
      if (firstNum <= lead) continue;
      numbers = tokens.slice(firstNum).map(parseNumberToken).filter(Boolean);
      pairAt = tokens.slice(firstNum).filter(t => parseNumberToken(t)).findIndex(t => t.includes(PAIR));
      if (numbers.length < 3) continue; // probably not a scoreboard row
      player = { id: null, gamertag: tokens.slice(lead, firstNum).join(' ').replace(/[^\w\s\-.]/g, '').trim() };
    }
    if (!numbers.length) continue;
    rows.push({ line, player, score, numbers, half, pairAt });
  }
  fixLostSlash(rows);

  // If two lines matched the same roster player keep the stronger one
  const seen = new Map();
  for (const r of rows) {
    if (!r.player?.id) continue;
    const prev = seen.get(r.player.id);
    if (!prev || r.score > prev.score) seen.set(r.player.id, r);
  }
  return rows.filter(r => !r.player?.id || seen.get(r.player.id) === r);
}

/**
 * Apply a column mapping (array of stat keys or '' for ignore) to parsed rows.
 */
export function applyMapping(rows, mapping) {
  return rows.map(r => {
    const out = { player_id: r.player?.id || null, player_name: r.player?.gamertag || '' };
    mapping.forEach((key, i) => {
      if (!key || !r.numbers[i]) return;
      out[key] = r.numbers[i].value;
    });
    return out;
  });
}

// ---------- map score (the big numbers at the top of the scoreboard) ----------
// Read separately from the player rows: a digits-only OCR pass on the top-centre of the image
// (see recognizeScore in ocr.js). Scoreboard fonts are stylised, so we check the numbers
// against what the mode allows and fix the common misread (CDL font "250" → "200"/"290").

const TARGETS = { 'Hardpoint': 250, 'Search & Destroy': 6, 'Control': 3 };
const LIMITS = { 'Hardpoint': 250, 'Search & Destroy': 9, 'Control': 5, 'Hijack': 20 };

/** Turn one OCR pass ("250 152\n4 0", "200\n129" or "250152") into candidate [left, right] pairs. */
function pairsFrom(text, mode) {
  // score lines are sparse; lines with many numbers are player stat rows that slipped into the crop
  const lines = String(text || '').split('\n').map(l => l.match(/\d+/g) || []).filter(x => x.length && x.length <= 3);
  const flat = lines.flat().slice(0, 6);
  const out = [];
  for (let i = 0; i + 1 < flat.length; i++) out.push([+flat[i], +flat[i + 1]]);
  // two scores read as one number: "250152" → 250 / 152
  for (const n of flat) {
    if (n.length < 2 || n.length > 6) continue;
    for (let cut = 1; cut < n.length; cut++) {
      const a = n.slice(0, cut), b = n.slice(cut);
      if ((a.length > 1 && a[0] === '0') || (b.length > 1 && b[0] === '0')) continue;
      if (mode === 'Hardpoint' && !(a.length === 3 && b.length >= 2) && !(b.length === 3 && a.length >= 2)) continue;
      out.push([+a, +b, 'split']);
    }
  }
  return out;
}

/** How believable a final score is for this mode. Returns { a, b, score, adjusted } or null. */
function judge([a, b, how], mode) {
  const lim = LIMITS[mode] ?? 999, target = TARGETS[mode];
  let adjusted = false;
  if (mode === 'Hardpoint') {
    // stylised "250" often reads as 200 / 290 / 260…: a 2x0-ish number above the other score → 250
    const fix = (x, y) => (x !== 250 && x >= 200 && x <= 299 && y < 250 ? 250 : x);
    const a2 = fix(a, b), b2 = fix(b, a);
    if (a2 !== a || b2 !== b) { adjusted = true; a = a2; b = b2; }
  }
  if (a > lim || b > lim || a === b) return null;
  let score = 1;
  if (target != null && Math.max(a, b) === target) score += 3;
  if (mode === 'Hardpoint' && Math.min(a, b) < 10) score -= 1; // unlikely final HP score
  if (how === 'split') score -= 0.5;
  if (adjusted) score -= 0.5;
  return { a, b, score, adjusted };
}

/**
 * Best map score from one or more OCR passes of the score area.
 * Returns { left, right, adjusted, sure } (left = the score shown on the left / top) or null.
 */
export function pickMapScore(passes, mode) {
  const votes = new Map();
  for (const text of [].concat(passes)) {
    for (const p of pairsFrom(text, mode)) {
      const j = judge(p, mode);
      if (!j) continue;
      const k = `${j.a}-${j.b}`;
      const v = votes.get(k) || { ...j, votes: 0, best: 0 };
      v.votes++; v.best = Math.max(v.best, j.score); v.adjusted = v.adjusted && j.adjusted;
      votes.set(k, v);
    }
  }
  const ranked = [...votes.values()].sort((x, y) => (y.best + y.votes * 0.5) - (x.best + x.votes * 0.5));
  const top = ranked[0];
  if (!top) return null;
  const target = TARGETS[mode];
  return { left: top.a, right: top.b, adjusted: top.adjusted, sure: target != null ? Math.max(top.a, top.b) === target && !top.adjusted : top.votes > 1 };
}

/**
 * Which side of the scoreboard a team is on: 'left' (top on a stacked caster board) or 'right'.
 * Stacked boards: the team's rows come first or last. Side-by-side boards (player POV): each OCR line
 * holds a row from both tables, so we look at where the name sits within the line.
 */
export function teamSide(rows, isTeam) {
  const mine = rows.map((r, i) => ({ r, i })).filter(x => x.r.player && isTeam(x.r.player));
  if (!mine.length) return null;
  const halves = mine.filter(x => x.r.half);
  if (halves.length) return halves.filter(x => x.r.half === 'L').length >= halves.length / 2 ? 'left' : 'right';
  const n = Math.max(1, rows.length - 1);
  const idx = mine.reduce((a, x) => a + x.i / n, 0) / mine.length;
  if (rows.length >= 4 && idx < 0.4) return 'left';
  if (rows.length >= 4 && idx > 0.6) return 'right';
  const pos = mine.reduce((a, x) => {
    const line = x.r.line.toLowerCase(), name = (x.r.player.gamertag || '').toLowerCase();
    const at = name ? line.indexOf(name) : -1;
    return a + (at < 0 ? 0.5 : at / Math.max(1, line.length));
  }, 0) / mine.length;
  return pos < 0.45 ? 'left' : 'right';
}
