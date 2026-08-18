// game-server/grinder.js
const arsenal = require('./defusalArsenal');
const defusal = require('./defusal');
const geometry = require('./dust2Geometry');

const GRINDER_CONFIG = {
  locationId: 'event-grinder',
  eventId: 'dust2',

  roundMs: 600000,
  roundEndMs: 20000,
  respawnMs: 0,

  baseHealth: 100,
  armorPoints: 100,
  armorAbsorb: 0.5,

  spawnClearance: 18,
  spawnCandidates: 5,
  spawnImmunityMs: 2000,

  startPrimary: 'bluechip-rifle',
  startArmor: 'seed-phrase',
};

const SPAWN_POINTS = [
  [30, 34], [-38, -19], [17, -19], [-15, 22], [-9, -36], [34, 5],
  [-4, -3], [9, 23], [-25, 2], [-20, -21], [-1, -20], [14, 38],
  [26, 19], [38, -10], [-2, 12], [8, -32], [-28, -11], [7, -10],
  [38, 24], [-24, 14], [-3, 24], [26, -12], [19, 28], [4, 3],
  [38, 14], [-1, -30],
];

const matches = new Map();
const matchByPlayer = new Map();

let nextMatchSeq = 0;

function blankMember(now) {
  return {
    alive: false,
    kills: 0,
    deaths: 0,
    streak: 0,
    bestStreak: 0,
    lastKillAt: 0,
    joinedAt: now,
    respawnAt: 0,
    primary: GRINDER_CONFIG.startPrimary,
    pistol: arsenal.DEFAULT_PISTOL,
    melee: arsenal.DEFAULT_MELEE,
    armor: GRINDER_CONFIG.startArmor,
    armorPoints: GRINDER_CONFIG.armorPoints,
    helmet: true,
    kit: false,
    grenades: [],
    grenadeLoadout: [],
    ammo: {},
    held: 'primary',
  };
}

function createMatch(instance, now = Date.now()) {
  const match = {
    id: `grinder-${nextMatchSeq++}`,
    instance,
    members: new Map(),
    phase: 'live',
    phaseUntil: now + GRINDER_CONFIG.roundMs,
    round: 1,
    grenades: [],
    startedAt: now,
    standings: [],
  };

  matches.set(match.id, match);
  return match;
}

function matchForInstance(instance) {
  for (const match of matches.values()) {
    if (match.instance === instance) return match;
  }
  return null;
}

function ensureMatch(instance, now = Date.now()) {
  return matchForInstance(instance) ?? createMatch(instance, now);
}

function matchOf(playerId) {
  const id = matchByPlayer.get(playerId);
  return id === undefined ? null : matches.get(id) || null;
}

function allMatches() {
  return Array.from(matches.values());
}

function join(match, playerId, now = Date.now()) {
  const existing = matchOf(playerId);
  if (existing && existing !== match) leave(playerId);

  let member = match.members.get(playerId);
  if (!member) {
    member = blankMember(now);
    match.members.set(playerId, member);
  }

  matchByPlayer.set(playerId, match.id);
  return member;
}

function leave(playerId) {
  const match = matchOf(playerId);
  matchByPlayer.delete(playerId);
  if (!match) return null;

  match.members.delete(playerId);
  if (match.grenades) match.grenades = match.grenades.filter((grenade) => grenade.ownerId !== playerId);
  return match;
}

function closeMatch(match) {
  for (const id of match.members.keys()) matchByPlayer.delete(id);
  matches.delete(match.id);
}

function pickSpawn(match, playerId, occupied = []) {
  const others = occupied.filter((entry) => entry.id !== playerId);

  const scored = SPAWN_POINTS.map((point) => {
    let nearest = Infinity;
    let seen = false;

    for (const other of others) {
      const distance = Math.hypot(point[0] - other.position[0], point[1] - other.position[2]);
      if (distance < nearest) nearest = distance;
      if (!seen && distance < 60) {
        seen = geometry.hasLineOfSight(
          point[0], 1.6, point[1],
          other.position[0], other.position[1] + 1.6, other.position[2]
        );
      }
    }

    return { point, nearest, seen };
  });

  if (others.length === 0) {
    const free = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
    return [free[0], 0, free[1]];
  }

  const clear = scored.filter((entry) => !entry.seen && entry.nearest >= GRINDER_CONFIG.spawnClearance);
  const spaced = scored.filter((entry) => entry.nearest >= GRINDER_CONFIG.spawnClearance);
  const pool = (clear.length > 0 ? clear : spaced.length > 0 ? spaced : scored)
    .sort((a, b) => b.nearest - a.nearest)
    .slice(0, GRINDER_CONFIG.spawnCandidates);

  const chosen = pool[Math.floor(Math.random() * pool.length)] ?? scored[0];
  return [chosen.point[0], 0, chosen.point[1]];
}

function markDead(match, playerId, killerId, now = Date.now()) {
  const member = match.members.get(playerId);
  if (!member) return null;

  member.alive = false;
  member.deaths += 1;
  member.streak = 0;
  member.respawnAt = now + GRINDER_CONFIG.respawnMs;

  const killer = killerId && killerId !== playerId ? match.members.get(killerId) : null;
  if (killer) {
    killer.kills += 1;
    killer.streak += 1;
    killer.bestStreak = Math.max(killer.bestStreak, killer.streak);
    killer.lastKillAt = now;
  }

  return killer;
}

function readyToRespawn(match, now) {
  const ids = [];
  for (const [id, member] of match.members) {
    if (!member.alive && now >= member.respawnAt) ids.push(id);
  }
  return ids;
}

function respawn(member) {
  member.alive = true;
  member.respawnAt = 0;
  member.armorPoints = member.armor ? GRINDER_CONFIG.armorPoints : 0;
  member.grenades = (member.grenadeLoadout ?? []).slice();
  member.held = member.primary ? 'primary' : 'pistol';
  defusal.normaliseHeld(member);
}

function standings(match) {
  return Array.from(match.members.entries())
    .map(([id, member]) => ({ id, member }))
    .sort((a, b) => {
      if (b.member.kills !== a.member.kills) return b.member.kills - a.member.kills;
      if (a.member.deaths !== b.member.deaths) return a.member.deaths - b.member.deaths;
      return (a.member.lastKillAt || a.member.joinedAt) - (b.member.lastKillAt || b.member.joinedAt);
    });
}

function startRound(match, now = Date.now()) {
  match.round += 1;
  match.phase = 'live';
  match.phaseUntil = now + GRINDER_CONFIG.roundMs;
  match.standings = [];
  match.grenades = [];

  for (const member of match.members.values()) {
    member.kills = 0;
    member.deaths = 0;
    member.streak = 0;
    member.bestStreak = 0;
    member.lastKillAt = 0;
    member.respawnAt = now;
    member.alive = false;
  }
}

function finishRound(match, now = Date.now()) {
  match.phase = 'over';
  match.phaseUntil = now + GRINDER_CONFIG.roundEndMs;
  match.standings = standings(match).map(({ id, member }) => ({
    id,
    kills: member.kills,
    deaths: member.deaths,
    bestStreak: member.bestStreak,
  }));
  return match.standings[0] ?? null;
}

function applyPick(match, playerId, itemId) {
  const member = match.members.get(playerId);
  const item = arsenal.ARSENAL_BY_ID.get(itemId);

  if (!member || !item) return { ok: false, error: 'unknown_item' };
  if (item.slot === 'kit' || item.slot === 'melee') return { ok: false, error: 'not_for_sale' };
  if (match.phase !== 'live') return { ok: false, error: 'buy_closed' };

  if (item.slot === 'grenade') {
    if (member.grenades.length >= arsenal.GRENADE_LIMIT) return { ok: false, error: 'grenades_full' };
    member.grenades.push(item.id);
    if (!member.grenadeLoadout) member.grenadeLoadout = [];
    if (member.grenadeLoadout.length < arsenal.GRENADE_LIMIT) member.grenadeLoadout.push(item.id);
    return { ok: true, member, item };
  }

  if (item.slot === 'primary') {
    if (member.primary === item.id) return { ok: false, error: 'already_owned' };
    member.primary = item.id;
    member.held = 'primary';
    return { ok: true, member, item };
  }

  if (item.slot === 'pistol') {
    if (member.pistol === item.id) return { ok: false, error: 'already_owned' };
    member.pistol = item.id;
    return { ok: true, member, item };
  }

  if (item.slot === 'armor') {
    if (member.armor === item.id) return { ok: false, error: 'already_owned' };
    member.armor = item.id;
    member.armorPoints = GRINDER_CONFIG.armorPoints;
    member.helmet = item.id === 'seed-phrase';
    return { ok: true, member, item };
  }

  return { ok: false, error: 'not_for_sale' };
}

let nextGrenadeSeq = 0;

function throwGrenade(match, playerId, itemId, origin, direction, now = Date.now()) {
  const member = match.members.get(playerId);
  if (!member || !member.alive) return null;

  const index = member.grenades.indexOf(itemId);
  if (index === -1) return null;
  member.grenades.splice(index, 1);
  defusal.normaliseHeld(member);

  const physics = defusal.GRENADE_PHYSICS;
  const speed = physics.throwSpeed;

  const grenade = {
    id: `grind-nade-${nextGrenadeSeq++}`,
    itemId,
    ownerId: playerId,
    x: origin[0],
    y: origin[1] + 1.5,
    z: origin[2],
    vx: direction[0] * speed,
    vy: Math.max(2, direction[1] * speed + 4),
    vz: direction[2] * speed,
    detonatesAt: now + physics.fuseMs,
    detonated: false,
  };

  if (!match.grenades) match.grenades = [];
  match.grenades.push(grenade);
  return grenade;
}

function serializeMatch(match, nicknames) {
  const roster = [];
  for (const [id, member] of match.members) {
    roster.push({
      id,
      nickname: nicknames.get(id) ?? 'Player',
      kills: member.kills,
      deaths: member.deaths,
      streak: member.streak,
      alive: member.alive,
      armor: member.armor,
      helmet: member.helmet,
      held: member.held,
      primary: member.primary,
      pistol: member.pistol,
      grenades: member.grenades.slice(),
      kit: false,
    });
  }

  return {
    type: 'grinderState',
    matchId: match.id,
    phase: match.phase,
    phaseUntil: match.phaseUntil,
    round: match.round,
    roundMs: GRINDER_CONFIG.roundMs,
    roster,
  };
}

module.exports = {
  GRINDER_CONFIG,
  SPAWN_POINTS,
  ensureMatch,
  matchForInstance,
  matchOf,
  allMatches,
  join,
  leave,
  closeMatch,
  pickSpawn,
  markDead,
  readyToRespawn,
  respawn,
  standings,
  startRound,
  finishRound,
  applyPick,
  throwGrenade,
  serializeMatch,
};
