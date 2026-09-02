// game-server/dust2Bots.js
const geometry = require('./dust2Geometry');
const nav = require('./dust2Nav');
const arsenal = require('./defusalArsenal');
const defusal = require('./defusal');

const TUNING = {
  tickMs: 50,

  runSpeed: 6.2,
  approachSpeed: 4.0,
  holdSpeed: 2.2,
  strafeSpeed: 3.2,
  turnRate: 8.5,
  snapTurnRate: 16,

  fovDegrees: 118,
  sightRange: 95,
  spotMs: 80,
  reactionMinMs: 190,
  reactionMaxMs: 330,

  aimErrorSettled: 0.007,
  aimErrorFresh: 0.075,
  aimSettleMs: 650,
  aimErrorMoving: 0.05,
  aimErrorPerSprayShot: 0.011,
  aimErrorSprayCap: 0.085,
  sprayResetMs: 320,

  burstMin: 3,
  burstMax: 7,
  burstPauseMinMs: 130,
  burstPauseMaxMs: 320,
  scopedPauseMs: 900,

  hearShotRange: 45,
  hearStepRange: 17,
  contactMemoryMs: 7000,
  searchHoldMs: 3500,

  repathMs: 700,
  waypointReach: 1.2,
  attackerDivertRange: 20,
  defenderRotateRange: 34,
  separation: 1.6,

  bodyRadius: 0.42,
  bodyHeight: 1.78,

  engageStopRange: 34,
  peekIntervalMs: 1400,
  retreatHealth: 28,
};

const BOT_NAMES = [
  'Kravitz', 'Marla', 'Osric', 'Tenna', 'Bexley', 'Vulpa', 'Corso', 'Nadja',
  'Ilric', 'Pemba', 'Sable', 'Torvin', 'Wexler', 'Yuna', 'Zorin', 'Halvar',
  'Ryska', 'Odalys', 'Fenwick', 'Miko',
];

const T_ROUTES = {
  A: [
    ['OUTSIDE LONG', 'LONG DOORS', 'LONG A', 'PIT'],
    ['OUTSIDE LONG', 'LONG DOORS', 'LONG A', 'GOOSE'],
    ['T MID', 'MID DOORS', 'CT MID', 'CATWALK', 'A SHORT'],
  ],
  B: [
    ['UPPER TUNNEL', 'TUNNEL RAMP', 'LOWER TUNNEL', 'B TUNNEL'],
    ['UPPER TUNNEL', 'TUNNEL RAMP', 'LOWER TUNNEL', 'B SITE'],
    ['T MID', 'MID DOORS', 'CT MID', 'B DOORS'],
  ],
};

const CT_HOLDS = {
  A: [
    { at: [35, -13], watch: [33, 2] },
    { at: [24, -20], watch: [11, -17] },
    { at: [17, -20], watch: [9, -14] },
  ],
  B: [
    { at: [-36, -20], watch: [-25, -8] },
    { at: [-30, -15], watch: [-19, -28] },
    { at: [-22, -24], watch: [-24, -6] },
  ],
  MID: [
    { at: [0, -9], watch: [0, 6] },
  ],
};

const T_POST_PLANT = {
  A: [
    { at: [35, -14], watch: [33, 2] },
    { at: [16, -22], watch: [10, -16] },
    { at: [26, -22], watch: [14, -27] },
  ],
  B: [
    { at: [-37, -21], watch: [-25, -8] },
    { at: [-24, -22], watch: [-18, -28] },
    { at: [-31, -13], watch: [-24, -4] },
  ],
};

const GRINDER_ROAM = [
  'A SITE', 'GOOSE', 'A SHORT', 'CATWALK', 'CT MID', 'MID DOORS', 'T MID',
  'LOWER TUNNEL', 'B TUNNEL', 'B SITE', 'B PLAT', 'B DOORS', 'CT SPAWN',
  'A CROSS', 'LONG A', 'PIT', 'LONG DOORS', 'OUTSIDE LONG', 'T SPAWN',
  'UPPER TUNNEL', 'TUNNEL RAMP',
];

const bots = new Map();
const brainsByMatch = new Map();

let nextBotSeq = 0;

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function pickOne(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function shuffled(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = copy[i];
    copy[i] = copy[j];
    copy[j] = swap;
  }
  return copy;
}

function grounded(x, z) {
  const spot = nav.nearestWalkable(x, z, 8) ?? [x, z];
  return [spot[0], nav.floorAt(spot[0], spot[1]), spot[1]];
}

function resolveSpot(spot) {
  const at = grounded(spot.at[0], spot.at[1]);
  return { at, watch: [spot.watch[0], spot.watch[1]] };
}

function routePoints(labels) {
  const points = [];
  for (const label of labels) {
    const point = nav.calloutPoint(label);
    if (point) points.push(point);
  }
  return points;
}

const CLOSED_WS = { readyState: 3, send() { } };

function usedNames() {
  const names = new Set();
  for (const bot of bots.values()) names.add(bot.nickname);
  return names;
}

function pickName() {
  const taken = usedNames();
  const free = BOT_NAMES.filter((name) => !taken.has(name));
  const base = free.length > 0 ? pickOne(free) : pickOne(BOT_NAMES);
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}${suffix}`)) suffix++;
  return `${base}${suffix}`;
}

function createBot(matchId, mode) {
  const id = `bot-${nextBotSeq++}`;

  const bot = {
    id,
    matchId,
    mode,
    isBot: true,
    nickname: pickName(),
    ws: CLOSED_WS,
    authenticated: true,
    locationId: null,
    instance: 1,

    position: [0, 0, 0],
    rotation: 0,
    pitch: 0,
    headYaw: 0,
    headPitch: 0,
    state: 'idle',
    jumping: false,
    velocityY: 0,
    weaponEquipped: true,
    isShooting: false,
    shieldVisible: false,
    alive: false,
    health: 100,
    maxHealth: 100,
    positionHistory: [],

    aimYaw: 0,
    aimPitch: 0,
    desiredYaw: 0,
    desiredPitch: 0,

    path: null,
    pathIndex: 0,
    repathAt: 0,
    goal: null,
    goalKind: 'idle',

    route: null,
    routeIndex: 0,
    holdSpot: null,

    targetId: null,
    targetSince: 0,
    targetLastSeen: 0,
    targetLastPos: null,
    firstSightAt: 0,
    fireReadyAt: 0,
    nextShotAt: 0,
    burstLeft: 0,
    sprayShots: 0,
    lastShotAt: 0,
    reloadUntil: 0,
    ammoLeft: 0,
    ammoWeaponId: null,

    searchUntil: 0,
    nextBuyAt: 0,
    strafeDir: Math.random() < 0.5 ? -1 : 1,
    strafeUntil: 0,
    lastSeenBySelf: new Map(),
    nextThinkAt: 0,
    spawnedAt: 0,
    lastMoveDistance: 0,
  };

  bots.set(id, bot);
  return bot;
}

function isBot(id) {
  return typeof id === 'string' && bots.has(id);
}

function get(id) {
  return bots.get(id) ?? null;
}

function all() {
  return Array.from(bots.values());
}

function botsOfMatch(matchId) {
  const list = [];
  for (const bot of bots.values()) {
    if (bot.matchId === matchId) list.push(bot);
  }
  return list;
}

function removeBot(id) {
  const bot = bots.get(id);
  if (!bot) return null;
  bots.delete(id);
  return bot;
}

function releaseMatch(matchId) {
  const removed = [];
  for (const bot of Array.from(bots.values())) {
    if (bot.matchId !== matchId) continue;
    bots.delete(bot.id);
    removed.push(bot);
  }
  brainsByMatch.delete(matchId);
  return removed;
}

function brainOf(match) {
  let brain = brainsByMatch.get(match.id);
  if (!brain) {
    brain = {
      plan: null,
      planRound: -1,
      contacts: new Map(),
      lastSeen: new Map(),
      bombSeenAt: 0,
    };
    brainsByMatch.set(match.id, brain);
  }
  return brain;
}

function rememberContact(brain, actorId, position, now, confidence) {
  const existing = brain.contacts.get(actorId);
  if (existing && existing.at > now - 120 && existing.confidence >= confidence) return;
  brain.contacts.set(actorId, {
    x: position[0],
    z: position[2],
    at: now,
    confidence,
  });
}

function forgetStaleContacts(brain, now) {
  for (const [id, contact] of brain.contacts) {
    if (now - contact.at > TUNING.contactMemoryMs) brain.contacts.delete(id);
  }
}

function eyeOf(actor) {
  return [actor.position[0], actor.position[1] + nav.EYE_HEIGHT, actor.position[2]];
}

function canSee(bot, actor) {
  const from = eyeOf(bot);
  const chest = [actor.position[0], actor.position[1] + 1.1, actor.position[2]];
  if (geometry.hasLineOfSight(from[0], from[1], from[2], chest[0], chest[1], chest[2])) return true;
  const head = [actor.position[0], actor.position[1] + nav.EYE_HEIGHT, actor.position[2]];
  return geometry.hasLineOfSight(from[0], from[1], from[2], head[0], head[1], head[2]);
}

function withinFov(bot, actor) {
  const dx = actor.position[0] - bot.position[0];
  const dz = actor.position[2] - bot.position[2];
  const distance = Math.hypot(dx, dz);
  if (distance < 2.5) return true;

  const toward = Math.atan2(dx, dz);
  let delta = toward - bot.aimYaw;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;

  return Math.abs(delta) <= (TUNING.fovDegrees * Math.PI) / 360;
}

function heldWeapon(member) {
  return defusal.heldItem(member) ?? null;
}

function gunOf(member) {
  const item = heldWeapon(member);
  if (!item) return null;
  return item.slot === 'primary' || item.slot === 'pistol' ? item : null;
}

function syncAmmo(bot, weapon, now) {
  if (!weapon) {
    bot.ammoWeaponId = null;
    bot.ammoLeft = 0;
    return;
  }
  if (bot.ammoWeaponId !== weapon.id) {
    bot.ammoWeaponId = weapon.id;
    bot.ammoLeft = weapon.magSize;
    bot.reloadUntil = 0;
  }
  if (bot.ammoLeft <= 0 && bot.reloadUntil === 0) {
    bot.reloadUntil = now + (weapon.reloadMs || 2100);
  }
  if (bot.reloadUntil > 0 && now >= bot.reloadUntil) {
    bot.ammoLeft = weapon.magSize;
    bot.reloadUntil = 0;
  }
}

function angleTo(from, to) {
  return Math.atan2(to[0] - from[0], to[2] - from[2]);
}

function pitchTo(from, to) {
  const flat = Math.hypot(to[0] - from[0], to[2] - from[2]);
  return Math.atan2(to[1] - from[1], Math.max(0.001, flat));
}

function turnToward(current, desired, maxDelta) {
  let delta = desired - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  if (Math.abs(delta) <= maxDelta) return desired;
  return current + Math.sign(delta) * maxDelta;
}

function aimError(bot, now, moving) {
  const settled = Math.min(1, (now - bot.firstSightAt) / TUNING.aimSettleMs);
  let error = TUNING.aimErrorFresh + (TUNING.aimErrorSettled - TUNING.aimErrorFresh) * settled;
  if (moving) error += TUNING.aimErrorMoving;
  error += Math.min(TUNING.aimErrorSprayCap, bot.sprayShots * TUNING.aimErrorPerSprayShot);
  return error;
}

function directionFrom(yaw, pitch) {
  const cosPitch = Math.cos(pitch);
  return [Math.sin(yaw) * cosPitch, Math.sin(pitch), Math.cos(yaw) * cosPitch];
}

function jitterDirection(direction, spread) {
  if (spread <= 0) return direction;

  const [dx, dy, dz] = direction;
  const flat = Math.hypot(dx, dz) || 1e-6;

  const rightX = -dz / flat;
  const rightZ = dx / flat;
  const upX = -(dx * dy) / flat;
  const upY = flat;
  const upZ = -(dz * dy) / flat;

  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(Math.random()) * spread;
  const ox = Math.cos(angle) * radius;
  const oy = Math.sin(angle) * radius;

  const x = dx + rightX * ox + upX * oy;
  const y = dy + upY * oy;
  const z = dz + rightZ * ox + upZ * oy;
  const length = Math.hypot(x, y, z) || 1;

  return [x / length, y / length, z / length];
}

function rayHitsActor(origin, direction, actor) {
  const flat = Math.hypot(direction[0], direction[2]);
  if (flat < 1e-6) return null;

  const dirX = direction[0] / flat;
  const dirZ = direction[2] / flat;
  const toX = actor.position[0] - origin[0];
  const toZ = actor.position[2] - origin[2];

  const along = toX * dirX + toZ * dirZ;
  if (along <= 0) return null;

  const perpX = toX - dirX * along;
  const perpZ = toZ - dirZ * along;
  const perp = Math.hypot(perpX, perpZ);
  if (perp > TUNING.bodyRadius) return null;

  const travel = along / flat;
  const height = origin[1] + direction[1] * travel;
  const feet = actor.position[1];
  if (height < feet || height > feet + TUNING.bodyHeight) return null;

  return {
    distance: Math.hypot(along, height - origin[1]),
    point: [origin[0] + direction[0] * travel, height, origin[2] + direction[2] * travel],
    height: height - feet,
  };
}

function hitZoneFor(heightAboveFeet) {
  if (heightAboveFeet > 1.35) return 'head';
  if (heightAboveFeet > 1) return 'chest';
  if (heightAboveFeet > 0.6) return 'stomach';
  return 'legs';
}

function resolveShot(bot, origin, direction, enemies, friends, maxRange) {
  let best = null;

  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    const hit = rayHitsActor(origin, direction, enemy);
    if (!hit || hit.distance > maxRange) continue;
    if (best === null || hit.distance < best.hit.distance) best = { actor: enemy, hit };
  }

  if (!best) return null;

  for (const friend of friends) {
    if (!friend.alive || friend.id === bot.id) continue;
    const blocked = rayHitsActor(origin, direction, friend);
    if (blocked && blocked.distance < best.hit.distance) return null;
  }

  if (!geometry.hasLineOfSight(origin[0], origin[1], origin[2], best.hit.point[0], best.hit.point[1], best.hit.point[2])) {
    return null;
  }

  return best;
}

function clearPath(bot) {
  bot.path = null;
  bot.pathIndex = 0;
}

function setGoal(bot, kind, x, z, now, force = false) {
  const changed = !bot.goal || Math.hypot(bot.goal[0] - x, bot.goal[1] - z) > 1.5 || bot.goalKind !== kind;
  bot.goalKind = kind;
  bot.goal = [x, z];

  if (force || changed || bot.path === null || now >= bot.repathAt) {
    const path = nav.findPath(bot.position[0], bot.position[2], x, z);
    bot.path = path;
    bot.pathIndex = 0;
    bot.repathAt = now + TUNING.repathMs + Math.random() * 200;
  }
}

function advanceAlongPath(bot, speed, delta, others) {
  if (!bot.path || bot.pathIndex >= bot.path.length) {
    bot.lastMoveDistance = 0;
    return false;
  }

  let budget = speed * delta;
  let moved = 0;

  while (budget > 0 && bot.pathIndex < bot.path.length) {
    const waypoint = bot.path[bot.pathIndex];
    const dx = waypoint[0] - bot.position[0];
    const dz = waypoint[1] - bot.position[2];
    const distance = Math.hypot(dx, dz);

    if (distance <= Math.max(TUNING.waypointReach, budget)) {
      bot.position[0] = waypoint[0];
      bot.position[2] = waypoint[1];
      budget -= distance;
      moved += distance;
      bot.pathIndex++;
      continue;
    }

    const step = budget / distance;
    bot.position[0] += dx * step;
    bot.position[2] += dz * step;
    moved += budget;
    budget = 0;
  }

  applySeparation(bot, others);
  bot.position[1] = nav.floorAt(bot.position[0], bot.position[2]);
  bot.lastMoveDistance = moved;

  return moved > 0.0001;
}

function applySeparation(bot, others) {
  let pushX = 0;
  let pushZ = 0;

  for (const other of others) {
    if (other.id === bot.id || !other.alive) continue;
    const dx = bot.position[0] - other.position[0];
    const dz = bot.position[2] - other.position[2];
    const distance = Math.hypot(dx, dz);
    if (distance >= TUNING.separation || distance < 1e-4) continue;
    const push = (TUNING.separation - distance) / TUNING.separation;
    pushX += (dx / distance) * push;
    pushZ += (dz / distance) * push;
  }

  if (pushX === 0 && pushZ === 0) return;

  const candidateX = bot.position[0] + pushX * 0.35;
  const candidateZ = bot.position[2] + pushZ * 0.35;
  if (nav.isWalkable(candidateX, candidateZ)) {
    bot.position[0] = candidateX;
    bot.position[2] = candidateZ;
  }
}

function strafe(bot, delta, now) {
  if (now >= bot.strafeUntil) {
    bot.strafeDir = Math.random() < 0.5 ? -1 : 1;
    bot.strafeUntil = now + randomBetween(500, 1200);
  }

  const side = bot.aimYaw + Math.PI / 2;
  const step = TUNING.strafeSpeed * delta * bot.strafeDir;
  const candidateX = bot.position[0] + Math.sin(side) * step;
  const candidateZ = bot.position[2] + Math.cos(side) * step;

  if (nav.isWalkable(candidateX, candidateZ)) {
    bot.position[0] = candidateX;
    bot.position[2] = candidateZ;
    bot.position[1] = nav.floorAt(candidateX, candidateZ);
    bot.lastMoveDistance = Math.abs(step);
    return;
  }

  bot.strafeDir *= -1;
  bot.lastMoveDistance = 0;
}

function perceive(bot, enemies, brain, now) {
  let closest = null;
  let closestDistance = Infinity;

  for (const enemy of enemies) {
    if (!enemy.alive) continue;

    const dx = enemy.position[0] - bot.position[0];
    const dz = enemy.position[2] - bot.position[2];
    const distance = Math.hypot(dx, dz);

    const shotRecently = enemy.lastShotAt && now - enemy.lastShotAt < 900;
    if (shotRecently && distance < TUNING.hearShotRange) {
      rememberContact(brain, enemy.id, enemy.position, now, 0.7);
    } else if (enemy.moving && distance < TUNING.hearStepRange) {
      rememberContact(brain, enemy.id, enemy.position, now, 0.5);
    }

    if (distance > TUNING.sightRange) continue;
    if (!withinFov(bot, enemy)) continue;
    if (!canSee(bot, enemy)) continue;

    const seenAt = bot.lastSeenBySelf.get(enemy.id) ?? 0;
    if (now - seenAt > 400) bot.lastSeenBySelf.set(enemy.id, now);

    rememberContact(brain, enemy.id, enemy.position, now, 1);

    if (distance < closestDistance) {
      closestDistance = distance;
      closest = enemy;
    }
  }

  if (closest) {
    if (bot.targetId !== closest.id) {
      bot.targetId = closest.id;
      bot.firstSightAt = now + TUNING.spotMs;
      bot.fireReadyAt = now + TUNING.spotMs + randomBetween(TUNING.reactionMinMs, TUNING.reactionMaxMs);
      bot.sprayShots = 0;
    }
    bot.targetLastSeen = now;
    bot.targetLastPos = [closest.position[0], closest.position[1], closest.position[2]];
    return closest;
  }

  if (bot.targetId && now - bot.targetLastSeen > 1500) {
    bot.targetId = null;
  }

  return null;
}

function bestKnownContact(bot, brain, enemies, now) {
  let best = null;
  let bestScore = Infinity;

  for (const [id, contact] of brain.contacts) {
    if (now - contact.at > TUNING.contactMemoryMs) continue;
    const enemy = enemies.find((entry) => entry.id === id);
    if (!enemy || !enemy.alive) continue;

    const distance = Math.hypot(contact.x - bot.position[0], contact.z - bot.position[2]);
    const age = (now - contact.at) / 1000;
    const score = distance + age * 6 + (1 - contact.confidence) * 20;
    if (score < bestScore) {
      bestScore = score;
      best = { id, contact };
    }
  }

  return best;
}

function fireIfAble(bot, member, visibleTarget, enemies, friends, now, events) {
  const weapon = gunOf(member);
  syncAmmo(bot, weapon, now);

  if (!weapon || !visibleTarget) {
    bot.isShooting = false;
    return;
  }
  if (bot.reloadUntil > 0 || bot.ammoLeft <= 0) {
    bot.isShooting = false;
    return;
  }
  if (now < bot.fireReadyAt || now < bot.nextShotAt) {
    bot.isShooting = false;
    return;
  }

  const origin = eyeOf(bot);
  const aimTarget = [
    visibleTarget.position[0],
    visibleTarget.position[1] + randomBetween(1.0, 1.45),
    visibleTarget.position[2],
  ];

  const desiredYaw = angleTo(bot.position, aimTarget);
  const desiredPitch = pitchTo(origin, aimTarget);

  let yawDelta = desiredYaw - bot.aimYaw;
  while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
  while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
  const pitchDelta = desiredPitch - bot.aimPitch;
  const offAim = Math.hypot(yawDelta, pitchDelta);

  const distance = Math.hypot(
    visibleTarget.position[0] - bot.position[0],
    visibleTarget.position[2] - bot.position[2]
  );
  const angularSize = Math.atan2(TUNING.bodyRadius, Math.max(1, distance));
  if (offAim > angularSize + 0.06) {
    bot.isShooting = false;
    return;
  }

  if (now - bot.lastShotAt > TUNING.sprayResetMs) bot.sprayShots = 0;

  const moving = bot.lastMoveDistance > 0.02;
  const spread = aimError(bot, now, moving);
  const direction = jitterDirection(directionFrom(bot.aimYaw, bot.aimPitch), spread);

  bot.ammoLeft--;
  bot.sprayShots++;
  bot.lastShotAt = now;
  bot.isShooting = true;

  if (bot.ammoLeft <= 0) bot.reloadUntil = now + (weapon.reloadMs || 2100);

  events.push({ kind: 'shoot', botId: bot.id, origin, direction });

  const resolved = resolveShot(bot, origin, direction, enemies, friends, weapon.maxRange);
  if (resolved) {
    events.push({
      kind: 'hit',
      botId: bot.id,
      targetId: resolved.actor.id,
      zone: hitZoneFor(resolved.hit.height),
      distance: resolved.hit.distance,
      point: resolved.hit.point,
    });
  }

  if (weapon.scoped) {
    bot.nextShotAt = now + Math.max(weapon.fireRateMs, TUNING.scopedPauseMs);
    return;
  }

  if (!weapon.automatic) {
    bot.nextShotAt = now + weapon.fireRateMs + randomBetween(30, 120);
    return;
  }

  if (bot.burstLeft <= 0) {
    bot.burstLeft = Math.round(randomBetween(TUNING.burstMin, TUNING.burstMax));
  }

  bot.burstLeft--;
  if (bot.burstLeft <= 0) {
    bot.nextShotAt = now + randomBetween(TUNING.burstPauseMinMs, TUNING.burstPauseMaxMs);
    bot.sprayShots = 0;
  } else {
    bot.nextShotAt = now + weapon.fireRateMs;
  }
}

function faceToward(bot, point, delta, snap) {
  const rate = (snap ? TUNING.snapTurnRate : TUNING.turnRate) * delta;
  const eye = eyeOf(bot);
  bot.desiredYaw = angleTo(bot.position, point);
  bot.desiredPitch = pitchTo(eye, point);
  bot.aimYaw = turnToward(bot.aimYaw, bot.desiredYaw, rate);
  bot.aimPitch = turnToward(bot.aimPitch, bot.desiredPitch, rate);
  bot.rotation = bot.aimYaw;
  bot.pitch = bot.aimPitch;
  bot.headYaw = 0;
  bot.headPitch = -bot.aimPitch;
}

function faceTarget(bot, target, delta) {
  const point = [target.position[0], target.position[1] + 1.2, target.position[2]];
  faceToward(bot, point, delta, true);
}

function faceMovement(bot, delta) {
  if (!bot.path || bot.pathIndex >= bot.path.length) return;
  const waypoint = bot.path[bot.pathIndex];
  faceToward(bot, [waypoint[0], bot.position[1] + 1.2, waypoint[1]], delta, false);
}

function buyFor(match, bot, member, now, events) {
  if (now < bot.nextBuyAt) return;
  bot.nextBuyAt = now + 600;

  const side = defusal.sideOf(match, bot.id);
  if (!side) return;

  const wants = [];
  const rifle = side === 't' ? 'pump-rifle' : 'bluechip-rifle';
  const riflePrice = arsenal.ARSENAL_BY_ID.get(rifle)?.price ?? 3000;
  const awpPrice = arsenal.ARSENAL_BY_ID.get('moon-ladder')?.price ?? 4750;

  const rich = member.money >= awpPrice + 1000;
  const canRifle = member.money >= riflePrice + 650;

  if (!member.primary) {
    if (rich && Math.random() < 0.22) wants.push('moon-ladder');
    else if (canRifle) wants.push(rifle);
    else if (member.money >= 1400) wants.push('whale-cannon');
  }

  if (!member.armor) {
    wants.push(member.money >= 2000 ? 'seed-phrase' : 'cold-wallet');
  }

  if (side === 'ct' && !member.kit && member.money >= 1500) wants.push('audit-kit');

  if (member.grenades.length < arsenal.GRENADE_LIMIT) {
    if (member.money >= 1200) wants.push('rug-flash');
    if (member.money >= 1600) wants.push(Math.random() < 0.5 ? 'liquidation' : 'fud-cloud');
  }

  for (const itemId of wants) {
    const verdict = defusal.canBuy(match, bot.id, itemId);
    if (!verdict.ok) continue;
    events.push({ kind: 'buy', botId: bot.id, itemId });
  }
}

function planForRound(match, brain) {
  if (brain.planRound === match.round && brain.plan) return brain.plan;

  const site = Math.random() < 0.5 ? 'A' : 'B';
  brain.plan = { site, decidedAt: Date.now() };
  brain.planRound = match.round;
  brain.contacts.clear();
  return brain.plan;
}

function assignDefusalRoles(match, matchBots, brain) {
  const plan = planForRound(match, brain);

  const attackers = [];
  const defenders = [];

  for (const bot of matchBots) {
    const side = defusal.sideOf(match, bot.id);
    if (side === 't') attackers.push(bot);
    else if (side === 'ct') defenders.push(bot);
  }

  const routes = shuffled(T_ROUTES[plan.site]);
  attackers.forEach((bot, index) => {
    const labels = routes[index % routes.length];
    bot.route = routePoints(labels);
    bot.routeIndex = 0;
    bot.holdSpot = null;
  });

  const holdA = shuffled(CT_HOLDS.A).map(resolveSpot);
  const holdB = shuffled(CT_HOLDS.B).map(resolveSpot);
  const holdMid = CT_HOLDS.MID.map(resolveSpot);

  defenders.forEach((bot, index) => {
    let spot;
    if (index % 5 === 4) spot = holdMid[0];
    else if (index % 2 === 0) spot = holdA[Math.floor(index / 2) % holdA.length];
    else spot = holdB[Math.floor(index / 2) % holdB.length];
    bot.holdSpot = spot;
    bot.route = null;
    bot.routeIndex = 0;
  });
}

function nextRoutePoint(bot) {
  if (!bot.route || bot.route.length === 0) return null;
  while (bot.routeIndex < bot.route.length) {
    const point = bot.route[bot.routeIndex];
    const distance = Math.hypot(point[0] - bot.position[0], point[1] - bot.position[2]);
    if (distance > 3.5) return point;
    bot.routeIndex++;
  }
  return null;
}

function engage(bot, member, target, enemies, blockers, crowd, delta, now, events) {
  faceTarget(bot, target, delta);

  const distance = Math.hypot(
    target.position[0] - bot.position[0],
    target.position[2] - bot.position[2]
  );

  const weapon = gunOf(member);
  const wantsCloser = distance > TUNING.engageStopRange && (!weapon || !weapon.scoped);
  const hurt = bot.health <= TUNING.retreatHealth;

  if (bot.reloadUntil > 0 || hurt) {
    const away = [
      bot.position[0] - (target.position[0] - bot.position[0]) * 0.35,
      bot.position[2] - (target.position[2] - bot.position[2]) * 0.35,
    ];
    if (nav.isWalkable(away[0], away[1])) {
      setGoal(bot, 'retreat', away[0], away[1], now);
      advanceAlongPath(bot, TUNING.approachSpeed, delta, crowd);
    } else {
      strafe(bot, delta, now);
    }
  } else if (wantsCloser) {
    setGoal(bot, 'chase', target.position[0], target.position[2], now);
    advanceAlongPath(bot, TUNING.approachSpeed, delta, crowd);
  } else {
    strafe(bot, delta, now);
  }

  fireIfAble(bot, member, target, enemies, blockers, now, events);
  bot.state = bot.lastMoveDistance > 0.02 ? 'walk' : 'idle';
}

function hunt(bot, brain, enemies, friends, delta, now, maxRange = Infinity) {
  const known = bestKnownContact(bot, brain, enemies, now);
  if (known && Math.hypot(known.contact.x - bot.position[0], known.contact.z - bot.position[2]) <= maxRange) {
    setGoal(bot, 'hunt', known.contact.x, known.contact.z, now);
    faceMovement(bot, delta);
    advanceAlongPath(bot, TUNING.approachSpeed, delta, friends);
    bot.state = 'walk';
    return true;
  }
  return false;
}

function roam(bot, friends, delta, now) {
  if (!bot.goal || bot.goalKind !== 'roam' || bot.pathIndex >= (bot.path?.length ?? 0)) {
    const label = pickOne(GRINDER_ROAM);
    const point = nav.calloutPoint(label) ?? nav.randomWalkableNear(bot.position[0], bot.position[2], 25);
    if (point) setGoal(bot, 'roam', point[0], point[1], now, true);
  }

  faceMovement(bot, delta);
  advanceAlongPath(bot, TUNING.runSpeed, delta, friends);
  bot.state = 'sprint';
}

function holdAngle(bot, delta, now, friends) {
  const spot = bot.holdSpot;
  if (!spot) return;

  const distance = Math.hypot(spot.at[0] - bot.position[0], spot.at[2] - bot.position[2]);
  if (distance > 2) {
    setGoal(bot, 'hold', spot.at[0], spot.at[2], now);
    faceMovement(bot, delta);
    advanceAlongPath(bot, distance > 12 ? TUNING.runSpeed : TUNING.approachSpeed, delta, friends);
    bot.state = distance > 12 ? 'sprint' : 'walk';
    return;
  }

  clearPath(bot);
  const watchY = nav.floorAt(spot.watch[0], spot.watch[1]) + 1.2;
  faceToward(bot, [spot.watch[0], watchY, spot.watch[1]], delta, false);
  bot.lastMoveDistance = 0;
  bot.state = 'idle';
}

function driveDefusalBot(match, bot, context, delta, now, events) {
  const member = match.members.get(bot.id);
  if (!member) return;

  const brain = context.brain;
  const side = defusal.sideOf(match, bot.id);
  const enemies = context.actors.filter((actor) => actor.side && actor.side !== side);
  const friends = context.actors.filter((actor) => actor.side === side);

  if (match.phase === 'freeze' || match.phase === 'warmup') {
    buyFor(match, bot, member, now, events);
    const spot = bot.holdSpot;
    if (spot) faceToward(bot, [spot.watch[0], bot.position[1] + 1.2, spot.watch[1]], delta, false);
    bot.state = 'idle';
    bot.isShooting = false;
    bot.lastMoveDistance = 0;
    return;
  }

  if (match.phase === 'over' || match.phase === 'ended') {
    bot.state = 'idle';
    bot.isShooting = false;
    bot.lastMoveDistance = 0;
    return;
  }

  if (!bot.alive) return;

  const target = perceive(bot, enemies, brain, now);

  if (target) {
    engage(bot, member, target, enemies, friends, friends, delta, now, events);
    return;
  }

  const bomb = match.bomb;
  const attackers = match.swapped ? 'ct' : 't';

  if (side === attackers) {
    driveAttacker(match, bot, member, brain, bomb, enemies, friends, delta, now, events);
  } else {
    driveDefender(match, bot, member, brain, bomb, enemies, friends, delta, now, events);
  }
}

function driveAttacker(match, bot, member, brain, bomb, enemies, friends, delta, now, events) {
  const plan = planForRound(match, brain);
  const site = defusal.DEFUSAL_CONFIG.sites[plan.site];
  const carrying = bomb && bomb.carrierId === bot.id;

  if (bomb && bomb.state === 'planted') {
    if (!bot.holdSpot) {
      const spots = shuffled(T_POST_PLANT[bomb.site ?? plan.site] ?? T_POST_PLANT[plan.site]).map(resolveSpot);
      bot.holdSpot = spots[0];
    }
    holdAngle(bot, delta, now, friends);
    return;
  }

  if (carrying) {
    const onSite = Math.hypot(bot.position[0] - site.x, bot.position[2] - site.z) <= defusal.DEFUSAL_CONFIG.plantRadius - 1;
    if (onSite && !bomb.planting) {
      clearPath(bot);
      bot.lastMoveDistance = 0;
      bot.state = 'idle';
      events.push({ kind: 'plant', botId: bot.id });
      return;
    }
    if (bomb.planting && bomb.planting.playerId === bot.id) {
      clearPath(bot);
      bot.lastMoveDistance = 0;
      bot.state = 'idle';
      return;
    }
  }

  if (!carrying && hunt(bot, brain, enemies, friends, delta, now, TUNING.attackerDivertRange)) return;

  const waypoint = nextRoutePoint(bot);
  if (waypoint) {
    setGoal(bot, 'push', waypoint[0], waypoint[1], now);
    faceMovement(bot, delta);
    advanceAlongPath(bot, TUNING.runSpeed, delta, friends);
    bot.state = 'sprint';
    return;
  }

  const spread = nav.randomWalkableNear(site.x, site.z, 6) ?? [site.x, site.z];
  setGoal(bot, 'siteHold', spread[0], spread[1], now);
  faceMovement(bot, delta);
  const arrived = !advanceAlongPath(bot, TUNING.approachSpeed, delta, friends);
  if (arrived) {
    const watch = plan.site === 'A' ? [10, -16] : [-18, -28];
    faceToward(bot, [watch[0], bot.position[1] + 1.2, watch[1]], delta, false);
    bot.state = 'idle';
  } else {
    bot.state = 'walk';
  }
}

function driveDefender(match, bot, member, brain, bomb, enemies, friends, delta, now, events) {
  if (bomb && bomb.state === 'planted') {
    const distance = Math.hypot(bot.position[0] - bomb.x, bot.position[2] - bomb.z);

    if (distance <= defusal.DEFUSAL_CONFIG.defuseReach - 0.4 && !bomb.defusing) {
      clearPath(bot);
      bot.lastMoveDistance = 0;
      bot.state = 'idle';
      events.push({ kind: 'defuse', botId: bot.id });
      return;
    }
    if (bomb.defusing && bomb.defusing.playerId === bot.id) {
      clearPath(bot);
      bot.lastMoveDistance = 0;
      bot.state = 'idle';
      return;
    }

    setGoal(bot, 'retake', bomb.x, bomb.z, now);
    faceMovement(bot, delta);
    advanceAlongPath(bot, TUNING.runSpeed, delta, friends);
    bot.state = 'sprint';
    return;
  }

  const known = bestKnownContact(bot, brain, enemies, now);
  if (known && known.contact.confidence >= 0.7) {
    const distance = Math.hypot(known.contact.x - bot.position[0], known.contact.z - bot.position[2]);
    if (distance > 6 && distance <= TUNING.defenderRotateRange) {
      setGoal(bot, 'rotate', known.contact.x, known.contact.z, now);
      faceMovement(bot, delta);
      advanceAlongPath(bot, TUNING.runSpeed, delta, friends);
      bot.state = 'sprint';
      return;
    }
  }

  holdAngle(bot, delta, now, friends);
}

function driveGrinderBot(match, bot, context, delta, now, events) {
  const member = match.members.get(bot.id);
  if (!member || !bot.alive) return;

  const brain = context.brain;
  const enemies = context.actors.filter((actor) => actor.id !== bot.id);

  const target = perceive(bot, enemies, brain, now);
  if (target) {
    engage(bot, member, target, enemies, [], enemies, delta, now, events);
    return;
  }

  if (hunt(bot, brain, enemies, enemies, delta, now)) return;

  roam(bot, enemies, delta, now);
}

function tick(match, mode, context, now, deltaMs) {
  const delta = Math.min(0.25, deltaMs / 1000);
  const events = [];
  const matchBots = botsOfMatch(match.id).filter((bot) => match.members.has(bot.id));
  if (matchBots.length === 0) return events;

  const brain = brainOf(match);
  forgetStaleContacts(brain, now);

  if (mode === 'defusal') {
    if (brain.planRound !== match.round) assignDefusalRoles(match, matchBots, brain);
    reassignLooseBomb(match, matchBots);
  }

  const actors = context.actors;
  const inner = { brain, actors };

  for (const bot of matchBots) {
    const member = match.members.get(bot.id);
    syncAmmo(bot, gunOf(member), now);

    if (mode === 'defusal') driveDefusalBot(match, bot, inner, delta, now, events);
    else driveGrinderBot(match, bot, inner, delta, now, events);

    settle(bot);

    bot.positionHistory.push({ position: [...bot.position], time: now });
    if (bot.positionHistory.length > 24) bot.positionHistory.shift();
  }

  return events;
}

function settle(bot) {
  if (!bot.alive) return;

  if (!nav.isWalkable(bot.position[0], bot.position[2])) {
    const fixed = nav.nearestWalkable(bot.position[0], bot.position[2], 5);
    if (fixed) {
      bot.position[0] = fixed[0];
      bot.position[2] = fixed[1];
      clearPath(bot);
    }
  }

  bot.position[1] = nav.floorAt(bot.position[0], bot.position[2]);
}

function reassignLooseBomb(match, matchBots) {
  const bomb = match.bomb;
  if (!bomb || bomb.state !== 'carried' || bomb.carrierId) return;

  const attackers = match.swapped ? 'ct' : 't';
  const candidates = matchBots.filter((bot) => {
    if (!bot.alive) return false;
    const member = match.members.get(bot.id);
    return member && member.alive && defusal.sideOf(match, bot.id) === attackers;
  });

  if (candidates.length === 0) return;
  bomb.carrierId = pickOne(candidates).id;
}

function resetForRound(bot, position, now) {
  bot.alive = true;
  bot.health = 100;
  bot.position = [position[0], position[1], position[2]];
  bot.positionHistory = [];
  bot.path = null;
  bot.pathIndex = 0;
  bot.goal = null;
  bot.goalKind = 'idle';
  bot.routeIndex = 0;
  bot.targetId = null;
  bot.targetLastPos = null;
  bot.targetLastSeen = 0;
  bot.firstSightAt = 0;
  bot.fireReadyAt = 0;
  bot.nextShotAt = 0;
  bot.burstLeft = 0;
  bot.sprayShots = 0;
  bot.reloadUntil = 0;
  bot.ammoWeaponId = null;
  bot.ammoLeft = 0;
  bot.lastShotAt = 0;
  bot.isShooting = false;
  bot.lastSeenBySelf.clear();
  bot.spawnedAt = now;
  bot.state = 'idle';
}

function markDead(bot) {
  bot.alive = false;
  bot.health = 0;
  bot.isShooting = false;
  bot.path = null;
  bot.pathIndex = 0;
  bot.targetId = null;
}

function joinPayload(bot, locationId) {
  return {
    type: 'playerJoin',
    id: bot.id,
    nickname: bot.nickname,
    factionSymbol: null,
    factionImage: null,
    position: bot.position,
    rotation: bot.rotation,
    pitch: bot.pitch,
    headYaw: bot.headYaw,
    headPitch: bot.headPitch,
    state: bot.state,
    jumping: false,
    velocityY: 0,
    health: bot.health,
    alive: bot.alive,
    weaponEquipped: true,
    isShooting: bot.isShooting,
    shielded: false,
    locationId,
    isAdmin: false,
    isFactionCreator: false,
    branch: 'gunslinger',
    weaponTier: 1,
    skinTextureUrl: null,
    cosmeticSkinId: null,
    cosmeticAccessoryId: null,
    companionId: null,
    isBot: true,
  };
}

function statePayload(bot) {
  return {
    id: bot.id,
    position: bot.position,
    rotation: bot.rotation,
    pitch: bot.pitch,
    headYaw: bot.headYaw,
    headPitch: bot.headPitch,
    state: bot.state,
    jumping: false,
    velocityY: 0,
    health: bot.health,
    alive: bot.alive,
    weaponEquipped: true,
    isShooting: bot.isShooting,
    shielded: false,
  };
}

module.exports = {
  TUNING,
  isBot,
  get,
  all,
  botsOfMatch,
  createBot,
  removeBot,
  releaseMatch,
  brainOf,
  tick,
  resetForRound,
  markDead,
  joinPayload,
  statePayload,
  grounded,
  eyeOf,
  hitZoneFor,
  gunOf,
  syncAmmo,
  GRINDER_ROAM,
};
