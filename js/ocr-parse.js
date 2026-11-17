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

/**
 * @param {string} text   raw OCR output
 * @param {Array<{id,gamertag}>} roster
 * @returns rows sorted by appearance: { line, player, score, numbers }
 */
export function parseScoreboard(text, roster = [], minScore = 0.6) {
  const rows = [];
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    const tokens = line.split(/\s+/).filter(t => /[\w:]/.test(t));
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

    let numbers, player = null, score = 0;
    if (best.score >= minScore) {
      player = best.player; score = best.score;
      numbers = tokens.slice(best.end).map(parseNumberToken).filter(Boolean);
    } else {
      // Unmatched: assume the name is the leading run of non-number tokens
      const firstNum = tokens.findIndex(t => parseNumberToken(t));
      if (firstNum <= 0) continue;
      numbers = tokens.slice(firstNum).map(parseNumberToken).filter(Boolean);
      if (numbers.length < 3) continue; // probably not a scoreboard row
      player = { id: null, gamertag: tokens.slice(0, firstNum).join(' ').replace(/[^\w\s\-.]/g, '').trim() };
    }
    if (!numbers.length) continue;
    rows.push({ line, player, score, numbers });
  }

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
