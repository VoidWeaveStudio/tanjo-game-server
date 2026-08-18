// game-server/defusal.js
const arsenal = require('./defusalArsenal');
const geometry = require('./dust2Geometry');

const DEFUSAL_CONFIG = {
  locationId: 'event-dust2',
  eventId: 'dust2',

  teamSize: 5,
  matchSize: 10,
  minMatchSize: 4,
  queueGraceMs: 90000,

  freezeMs: 8000,
  roundMs: 115000,
  bombMs: 40000,
  plantMs: 3200,
  defuseMs: 5000,
  roundEndMs: 6000,

  roundsToWin: 7,
  swapAfterRound: 6,

  plantRadius: 9,
  plantReach: 2.2,
  defuseReach: 2.5,
  bombDamage: 500,
  bombBlastRadius: 22,

  sites: {
    A: { x: 21.5, z: -13.5 },
    B: { x: -21, z: -19 },
  },

  tSpawns: [[30, 34], [27, 34], [30, 31], [30, 37], [33, 34]],
  ctSpawns: [[-3, -33], [-6, -33], [-3, -36], [-3, -30], [0, -33]],

  // Skill tree and degen stay out of this mode — the arsenal decides everything.
  baseHealth: 100,
  armorPoints: 100,
  armorAbsorb: 0.5,
};

const queue = [];
const matches = new Map();
const matchByPlayer = new Map();

let nextMatchSeq = 0;

function queuedCount() {
  return queue.reduce((total, entry) => total + entry.ids.length, 0);
}

function queueEntryOf(playerId) {
  return queue.find((entry) => entry.ids.includes(playerId)) || null;
}

function isQueued(playerId) {
  return queueEntryOf(playerId) !== null;
}

function enqueue(ids, now = Date.now()) {
  const fresh = ids.filter((id) => !isQueued(id) && !matchByPlayer.has(id));
  if (fresh.length === 0) return { ok: false, error: 'already_queued' };
  if (fresh.length > DEFUSAL_CONFIG.teamSize) return { ok: false, error: 'party_too_big' };

  const entry = { ids: fresh, joinedAt: now };
  queue.push(entry);
  return { ok: true, entry };
}

function dequeue(playerId) {
  const index = queue.findIndex((entry) => entry.ids.includes(playerId));
  if (index === -1) return false;

  const entry = queue[index];
  entry.ids = entry.ids.filter((id) => id !== playerId);
  if (entry.ids.length === 0) queue.splice(index, 1);
  return true;
}

function forgetQueued(playerId) {
  dequeue(playerId);
}

// Groups stay together: biggest first, always into whichever side has room.
function splitTeams(entries) {
  const groups = entries.slice().sort((a, b) => b.ids.length - a.ids.length);
  const t = [];
  const ct = [];

  for (const group of groups) {
    const target = t.length <= ct.length ? t : ct;
    const other = target === t ? ct : t;
    const room = DEFUSAL_CONFIG.teamSize - target.length;

    if (group.ids.length <= room) {
      target.push(...group.ids);
      continue;
    }

    for (const id of group.ids) {
      if (t.length < DEFUSAL_CONFIG.teamSize && t.length <= ct.length) t.push(id);
      else if (ct.length < DEFUSAL_CONFIG.teamSize) ct.push(id);
      else other.push(id);
    }
  }

  return { t, ct };
}

function shouldFormMatch(now) {
  const total = queuedCount();
  if (total >= DEFUSAL_CONFIG.matchSize) return true;
  if (total < DEFUSAL_CONFIG.minMatchSize) return false;

  const oldest = queue.reduce((min, entry) => Math.min(min, entry.joinedAt), Infinity);
  return now - oldest >= DEFUSAL_CONFIG.queueGraceMs;
}

function takeFromQueue() {
  const taken = [];
  let total = 0;

  while (queue.length > 0 && total < DEFUSAL_CONFIG.matchSize) {
    const entry = queue[0];
    if (total + entry.ids.length > DEFUSAL_CONFIG.matchSize) break;
    queue.shift();
    taken.push(entry);
    total += entry.ids.length;
  }

  return taken;
}

function createMatch(instance, now = Date.now()) {
  const entries = takeFromQueue();
  if (entries.length === 0) return null;

  const { t, ct } = splitTeams(entries);
  const members = new Map();

  const blank = (team, slot) => ({
    team,
    slot,
    alive: false,
    money: arsenal.DEFUSAL_ECONOMY.startMoney,
    lossStreak: 0,
    primary: null,
    pistol: arsenal.DEFAULT_PISTOL,
    melee: arsenal.DEFAULT_MELEE,
    armor: null,
    kit: false,
    grenades: [],
    held: 'pistol',
    armorPoints: 0,
    helmet: false,
  });

  t.forEach((id, index) => members.set(id, blank('t', index)));
  ct.forEach((id, index) => members.set(id, blank('ct', index)));

  const match = {
    id: `defusal-${nextMatchSeq++}`,
    instance,
    members,
    score: { t: 0, ct: 0 },
    round: 0,
    phase: 'warmup',
    phaseUntil: now + 3000,
    swapped: false,
    bomb: null,
    grenades: [],
    startedAt: now,
    winner: null,
  };

  matches.set(match.id, match);
  for (const id of members.keys()) matchByPlayer.set(id, match.id);

  return match;
}

function matchOf(playerId) {
  const id = matchByPlayer.get(playerId);
  return id === undefined ? null : matches.get(id) || null;
}

function allMatches() {
  return Array.from(matches.values());
}

function teamOf(match, playerId) {
  return match.members.get(playerId)?.team ?? null;
}

function membersOfTeam(match, team) {
  const ids = [];
  for (const [id, member] of match.members) {
    if (member.team === team) ids.push(id);
  }
  return ids;
}

function aliveOfTeam(match, team) {
  return membersOfTeam(match, team).filter((id) => match.members.get(id).alive);
}

// Sides swap at half time, so the scoreboard tracks the side a player is on now.
function sideOf(match, playerId) {
  const base = teamOf(match, playerId);
  if (!base) return null;
  if (!match.swapped) return base;
  return base === 't' ? 'ct' : 't';
}

function scoreFor(match, side) {
  return match.score[side] ?? 0;
}

function spawnFor(match, playerId) {
  const member = match.members.get(playerId);
  if (!member) return null;

  const side = sideOf(match, playerId);
  const points = side === 't' ? DEFUSAL_CONFIG.tSpawns : DEFUSAL_CONFIG.ctSpawns;
  const point = points[member.slot % points.length];
  return [point[0], 0, point[1]];
}

function startRound(match, now) {
  match.round += 1;
  match.phase = 'freeze';
  match.phaseUntil = now + DEFUSAL_CONFIG.freezeMs;

  for (const member of match.members.values()) member.alive = true;

  const attackers = membersOfTeam(match, match.swapped ? 'ct' : 't');
  const carrier = attackers.length > 0 ? attackers[Math.floor(Math.random() * attackers.length)] : null;

  match.bomb = {
    carrierId: carrier,
    state: 'carried',
    site: null,
    x: 0,
    z: 0,
    plantedAt: 0,
    explodesAt: 0,
    planting: null,
    defusing: null,
  };
}

const HELD_SLOTS = ['primary', 'pistol', 'melee', 'grenade1', 'grenade2'];

function heldItemId(member) {
  if (!member) return null;
  if (member.held === 'primary') return member.primary;
  if (member.held === 'melee') return member.melee;
  if (member.held === 'grenade1') return member.grenades[0] ?? null;
  if (member.held === 'grenade2') return member.grenades[1] ?? null;
  return member.pistol;
}

function heldItem(member) {
  const id = heldItemId(member);
  return id ? arsenal.ARSENAL_BY_ID.get(id) ?? null : null;
}

function isHoldingGrenade(member) {
  return member?.held === 'grenade1' || member?.held === 'grenade2';
}

// A slot you cannot fill falls back to the pistol, which every player always has.
function selectSlot(member, slot) {
  if (!member || !HELD_SLOTS.includes(slot)) return false;

  if (slot === 'primary' && !member.primary) return false;
  if (slot === 'grenade1' && !member.grenades[0]) return false;
  if (slot === 'grenade2' && !member.grenades[1]) return false;

  member.held = slot;
  return true;
}

function normaliseHeld(member) {
  if (heldItemId(member)) return;
  member.held = member.primary ? 'primary' : 'pistol';
}

function award(member, amount) {
  member.money = Math.max(0, Math.min(arsenal.DEFUSAL_ECONOMY.maxMoney, member.money + amount));
}

function canBuy(match, playerId, itemId) {
  const member = match.members.get(playerId);
  const item = arsenal.ARSENAL_BY_ID.get(itemId);

  if (!member || !item) return { ok: false, error: 'unknown_item' };
  if (match.phase !== 'freeze' && match.phase !== 'warmup') return { ok: false, error: 'buy_closed' };
  if (item.price <= 0) return { ok: false, error: 'not_for_sale' };

  const side = sideOf(match, playerId);
  if (item.side !== 'both' && item.side !== side) return { ok: false, error: 'wrong_side' };
  if (member.money < item.price) return { ok: false, error: 'too_poor' };

  if (item.slot === 'grenade' && member.grenades.length >= arsenal.GRENADE_LIMIT) {
    return { ok: false, error: 'grenades_full' };
  }
  if (item.slot === 'armor' && member.armor === itemId) return { ok: false, error: 'already_owned' };
  if (item.slot === 'kit' && member.kit) return { ok: false, error: 'already_owned' };
  if (item.slot === 'primary' && member.primary === itemId) return { ok: false, error: 'already_owned' };

  return { ok: true, member, item };
}

function applyPurchase(match, playerId, itemId) {
  const verdict = canBuy(match, playerId, itemId);
  if (!verdict.ok) return verdict;

  const { member, item } = verdict;
  member.money -= item.price;

  if (item.slot === 'primary') {
    member.primary = item.id;
    member.held = 'primary';
  } else if (item.slot === 'pistol') {
    member.pistol = item.id;
    if (!member.primary) member.held = 'pistol';
  } else if (item.slot === 'armor') {
    member.armor = item.id;
    member.armorPoints = DEFUSAL_CONFIG.armorPoints;
    member.helmet = item.id === 'seed-phrase';
  } else if (item.slot === 'grenade') {
    member.grenades.push(item.id);
  } else if (item.slot === 'kit') {
    member.kit = true;
  }

  return { ok: true, member, item };
}

// Losing streaks pay more, a win resets them — same shape as the game it borrows from.
function payRound(match, winningSide) {
  const economy = arsenal.DEFUSAL_ECONOMY;

  for (const [id, member] of match.members) {
    const side = sideOf(match, id);
    if (side === winningSide) {
      member.lossStreak = 0;
      award(member, economy.winReward);
      continue;
    }

    const loss = Math.min(economy.lossMax, economy.lossBase + member.lossStreak * economy.lossStep);
    member.lossStreak = Math.min(4, member.lossStreak + 1);
    award(member, loss);

    const attackers = match.swapped ? 'ct' : 't';
    if (side === attackers && match.bomb?.state === 'planted') {
      award(member, economy.plantTeamConsolation);
    }
  }
}

function resetLoadouts(match) {
  for (const member of match.members.values()) {
    member.primary = null;
    member.pistol = arsenal.DEFAULT_PISTOL;
    member.armor = null;
    member.armorPoints = 0;
    member.helmet = false;
    member.kit = false;
    member.grenades = [];
    member.held = 'pistol';
    member.money = arsenal.DEFUSAL_ECONOMY.startMoney;
    member.lossStreak = 0;
  }
}

// Kit and armour survive the round; ammunition and grenades do not.
function carryLoadout(match) {
  for (const [id, member] of match.members) {
    member.held = member.primary ? 'primary' : 'pistol';
    if (!member.alive) {
      member.primary = null;
      member.armor = null;
      member.armorPoints = 0;
      member.helmet = false;
      member.grenades = [];
      member.held = 'pistol';
    }
    if (member.armor) member.armorPoints = DEFUSAL_CONFIG.armorPoints;
  }
}

const GRENADE_PHYSICS = {
  throwSpeed: 22,
  gravity: 19,
  bounce: 0.32,
  friction: 0.72,
  fuseMs: 1900,
  radius: 0.12,
  flashRange: 16,
  flashMaxMs: 3400,
  cloudRange: 9,
  cloudMs: 12000,
  maxStepMetres: 0.35,
};

let nextGrenadeSeq = 0;

function throwGrenade(match, playerId, itemId, origin, direction, now = Date.now()) {
  const member = match.members.get(playerId);
  if (!member || !member.alive) return null;

  const index = member.grenades.indexOf(itemId);
  if (index === -1) return null;
  member.grenades.splice(index, 1);
  normaliseHeld(member);

  const flat = Math.hypot(direction[0], direction[2]) || 1;
  const speed = GRENADE_PHYSICS.throwSpeed;

  const grenade = {
    id: `nade-${nextGrenadeSeq++}`,
    itemId,
    ownerId: playerId,
    side: sideOf(match, playerId),
    x: origin[0],
    y: origin[1] + 1.5,
    z: origin[2],
    vx: direction[0] * speed,
    vy: Math.max(2, direction[1] * speed + 4),
    vz: direction[2] * speed,
    detonatesAt: now + GRENADE_PHYSICS.fuseMs,
    detonated: false,
  };

  if (!match.grenades) match.grenades = [];
  match.grenades.push(grenade);
  return grenade;
}

// Grenades bounce off the map, not just the floor: the step is split fine
// enough that nothing tunnels through a wall, and each hit reflects the axis
// it came in on while the other two lose speed to friction.
function bounceOffBlockers(grenade) {
  const r = GRENADE_PHYSICS.radius;

  for (const box of geometry.BLOCKERS) {
    if (grenade.x + r <= box.minX || grenade.x - r >= box.maxX) continue;
    if (grenade.y + r <= box.minY || grenade.y - r >= box.maxY) continue;
    if (grenade.z + r <= box.minZ || grenade.z - r >= box.maxZ) continue;

    const west = grenade.x + r - box.minX;
    const east = box.maxX + r - grenade.x;
    const below = grenade.y + r - box.minY;
    const above = box.maxY + r - grenade.y;
    const south = grenade.z + r - box.minZ;
    const north = box.maxZ + r - grenade.z;

    const push = Math.min(west, east, below, above, south, north);

    if (push === west || push === east) {
      grenade.x += push === west ? -west : east;
      grenade.vx = -grenade.vx * GRENADE_PHYSICS.bounce;
      grenade.vy *= GRENADE_PHYSICS.friction;
      grenade.vz *= GRENADE_PHYSICS.friction;
    } else if (push === below || push === above) {
      grenade.y += push === below ? -below : above;
      grenade.vy = -grenade.vy * GRENADE_PHYSICS.bounce;
      grenade.vx *= GRENADE_PHYSICS.friction;
      grenade.vz *= GRENADE_PHYSICS.friction;
      if (push === above && Math.abs(grenade.vy) < 0.6) grenade.vy = 0;
    } else {
      grenade.z += push === south ? -south : north;
      grenade.vz = -grenade.vz * GRENADE_PHYSICS.bounce;
      grenade.vx *= GRENADE_PHYSICS.friction;
      grenade.vy *= GRENADE_PHYSICS.friction;
    }
  }
}

function stepGrenades(match, delta, now) {
  if (!match.grenades || match.grenades.length === 0) return [];

  const detonated = [];

  for (const grenade of match.grenades) {
    const speed = Math.hypot(grenade.vx, grenade.vy, grenade.vz);
    const steps = Math.max(1, Math.min(24, Math.ceil((speed * delta) / GRENADE_PHYSICS.maxStepMetres)));
    const step = delta / steps;

    for (let i = 0; i < steps; i++) {
      grenade.vy -= GRENADE_PHYSICS.gravity * step;
      grenade.x += grenade.vx * step;
      grenade.y += grenade.vy * step;
      grenade.z += grenade.vz * step;

      if (grenade.y <= GRENADE_PHYSICS.radius) {
        grenade.y = GRENADE_PHYSICS.radius;
        grenade.vy = Math.abs(grenade.vy) * GRENADE_PHYSICS.bounce;
        grenade.vx *= GRENADE_PHYSICS.friction;
        grenade.vz *= GRENADE_PHYSICS.friction;
        if (grenade.vy < 0.6) grenade.vy = 0;
      }

      bounceOffBlockers(grenade);
    }

    if (now >= grenade.detonatesAt) {
      grenade.detonated = true;
      detonated.push(grenade);
    }
  }

  match.grenades = match.grenades.filter((grenade) => !grenade.detonated);
  return detonated;
}

function serializeGrenades(match) {
  return (match.grenades ?? []).map((grenade) => ({
    id: grenade.id,
    itemId: grenade.itemId,
    x: grenade.x,
    y: grenade.y,
    z: grenade.z,
  }));
}

// A wall between you and the burst saves you outright; otherwise distance and
// which way you were facing decide how long you are blind for.
function flashStrength(grenade, position, facing) {
  const dx = grenade.x - position[0];
  const dz = grenade.z - position[2];
  const distance = Math.hypot(dx, dz);
  if (distance > GRENADE_PHYSICS.flashRange) return 0;

  const eyeY = position[1] + 1.6;
  if (!geometry.hasLineOfSight(grenade.x, grenade.y, grenade.z, position[0], eyeY, position[2])) return 0;

  const falloff = 1 - distance / GRENADE_PHYSICS.flashRange;
  const toward = distance > 0.001 ? (dx / distance) * Math.sin(facing) + (dz / distance) * -Math.cos(facing) : 1;
  const facingFactor = Math.max(0.12, (toward + 1) / 2);

  return Math.round(GRENADE_PHYSICS.flashMaxMs * falloff * facingFactor);
}

function siteAt(x, z) {
  for (const [name, site] of Object.entries(DEFUSAL_CONFIG.sites)) {
    const dx = x - site.x;
    const dz = z - site.z;
    if (Math.sqrt(dx * dx + dz * dz) <= DEFUSAL_CONFIG.plantRadius) return name;
  }
  return null;
}

function markDead(match, playerId) {
  const member = match.members.get(playerId);
  if (!member) return;
  member.alive = false;

  if (match.bomb && match.bomb.carrierId === playerId && match.bomb.state === 'carried') {
    match.bomb.carrierId = null;
  }
  if (match.bomb?.planting?.playerId === playerId) match.bomb.planting = null;
  if (match.bomb?.defusing?.playerId === playerId) match.bomb.defusing = null;
}

function dropMember(match, playerId) {
  markDead(match, playerId);
  match.members.delete(playerId);
  matchByPlayer.delete(playerId);
}

function roundOutcome(match, now) {
  const attackerSide = 't';
  const defenderSide = 'ct';

  const attackers = membersOfTeam(match, match.swapped ? 'ct' : 't');
  const defenders = membersOfTeam(match, match.swapped ? 't' : 'ct');
  const attackersAlive = attackers.filter((id) => match.members.get(id)?.alive).length;
  const defendersAlive = defenders.filter((id) => match.members.get(id)?.alive).length;

  if (match.bomb?.state === 'defused') return { side: defenderSide, reason: 'defused' };
  if (match.bomb?.state === 'exploded') return { side: attackerSide, reason: 'exploded' };

  if (defendersAlive === 0 && defenders.length > 0) return { side: attackerSide, reason: 'eliminated' };

  if (attackersAlive === 0 && attackers.length > 0) {
    if (match.bomb?.state === 'planted') return null;
    return { side: defenderSide, reason: 'eliminated' };
  }

  if (match.bomb?.state !== 'planted' && now >= match.phaseUntil && match.phase === 'live') {
    return { side: defenderSide, reason: 'time' };
  }

  return null;
}

function isMatchOver(match) {
  return match.score.t >= DEFUSAL_CONFIG.roundsToWin || match.score.ct >= DEFUSAL_CONFIG.roundsToWin;
}

function endMatch(match) {
  match.phase = 'ended';
  match.winner = match.score.t > match.score.ct ? 't' : match.score.ct > match.score.t ? 'ct' : null;
  for (const id of match.members.keys()) matchByPlayer.delete(id);
  matches.delete(match.id);
}

function serializeMatch(match, nicknames) {
  const roster = [];
  for (const [id, member] of match.members) {
    roster.push({
      id,
      nickname: nicknames.get(id) ?? 'Player',
      side: sideOf(match, id),
      alive: member.alive,
      hasBomb: match.bomb?.carrierId === id,
      money: member.money,
      armor: member.armor,
      helmet: member.helmet,
      held: member.held,
      primary: member.primary,
      pistol: member.pistol,
      grenades: member.grenades.slice(),
      kit: member.kit,
    });
  }

  return {
    type: 'defusalState',
    matchId: match.id,
    round: match.round,
    phase: match.phase,
    phaseUntil: match.phaseUntil,
    score: { t: match.score.t, ct: match.score.ct },
    roundsToWin: DEFUSAL_CONFIG.roundsToWin,
    swapped: match.swapped,
    bomb: match.bomb
      ? {
        state: match.bomb.state,
        site: match.bomb.site,
        x: match.bomb.x,
        z: match.bomb.z,
        explodesAt: match.bomb.explodesAt,
        carrierId: match.bomb.carrierId,
        planting: match.bomb.planting ? { playerId: match.bomb.planting.playerId, until: match.bomb.planting.until } : null,
        defusing: match.bomb.defusing ? { playerId: match.bomb.defusing.playerId, until: match.bomb.defusing.until } : null,
      }
      : null,
    roster,
  };
}

function serializeQueue() {
  return {
    type: 'defusalQueueState',
    queued: queuedCount(),
    needed: DEFUSAL_CONFIG.matchSize,
    minimum: DEFUSAL_CONFIG.minMatchSize,
  };
}

module.exports = {
  DEFUSAL_CONFIG,
  bounceOffBlockers,
  HELD_SLOTS,
  heldItemId,
  isHoldingGrenade,
  selectSlot,
  normaliseHeld,
  GRENADE_PHYSICS,
  throwGrenade,
  stepGrenades,
  serializeGrenades,
  flashStrength,
  heldItem,
  award,
  canBuy,
  applyPurchase,
  payRound,
  resetLoadouts,
  carryLoadout,
  queue,
  queuedCount,
  isQueued,
  enqueue,
  dequeue,
  forgetQueued,
  shouldFormMatch,
  createMatch,
  matchOf,
  allMatches,
  teamOf,
  sideOf,
  scoreFor,
  membersOfTeam,
  aliveOfTeam,
  spawnFor,
  startRound,
  siteAt,
  markDead,
  dropMember,
  roundOutcome,
  isMatchOver,
  endMatch,
  serializeMatch,
  serializeQueue,
};
