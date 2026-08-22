// game-server/tournaments.js
// Mirror of the parts of src/core/lib/tournaments.ts this CommonJS server needs.
// Validation here is only a cheap first gate — the Next routes re-check everything.

const TOURNAMENT_KINDS = ['costume', 'build', 'xp24h'];
const TOURNAMENT_ACTIONS = ['join', 'submitSkin', 'submitShot', 'setPost', 'like'];

const X_POST_URL_PREFIX = 'https://x.com/';
const MAX_URL_LENGTH = 512;

function isTournamentKind(value) {
  return typeof value === 'string' && TOURNAMENT_KINDS.includes(value);
}

function isTournamentAction(value) {
  return typeof value === 'string' && TOURNAMENT_ACTIONS.includes(value);
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isValidXPostUrl(url) {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed.startsWith(X_POST_URL_PREFIX)) return false;
  if (trimmed.length <= X_POST_URL_PREFIX.length) return false;
  if (trimmed.length > MAX_URL_LENGTH) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' && parsed.hostname === 'x.com';
  } catch {
    return false;
  }
}

function tournamentErrorKey(code) {
  switch (code) {
    case 'not_open': return 'g.err.tournament.notOpen';
    case 'not_joined': return 'g.err.tournament.notJoined';
    case 'full': return 'g.err.tournament.full';
    case 'no_skin': return 'g.err.tournament.noSkin';
    case 'no_submission': return 'g.err.tournament.noSubmission';
    case 'invalid_shot': return 'g.err.tournament.invalidShot';
    case 'invalid_url': return 'g.err.tournament.invalidUrl';
    case 'own_entry': return 'g.err.tournament.ownEntry';
    case 'entry_not_found': return 'g.err.tournament.entryGone';
    case 'wrong_kind': return 'g.err.tournament.wrongKind';
    default: return 'g.err.tournament.failed';
  }
}

module.exports = {
  TOURNAMENT_KINDS,
  TOURNAMENT_ACTIONS,
  X_POST_URL_PREFIX,
  MAX_URL_LENGTH,
  isTournamentKind,
  isTournamentAction,
  isUuid,
  isValidXPostUrl,
  tournamentErrorKey,
};
