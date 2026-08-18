// game-server/arena.js
const ARENA_CONFIG = {
  locationId: 'event-arena',
  candleHealth: 3000,
  candlePosition: [0, 0, 0],
  arenaRadius: 52,
  prepMs: 5000,
  pauseMs: 15000,
  reviveMs: 3000,
  reviveReach: 4,
  maxLiveEnemies: 30,
  bossEveryWaves: 5,
  biomeCount: 5,
  wavesPerBiome: 5,
  ashPerWave: 25,
  ashCap: 1500,
  xpPerWave: 50,
  xpCap: 3000,
  cooldownMs: 60 * 60 * 1000,
  spawnGates: [
    [32.5, 0, -32.5],
    [32.5, 0, 32.5],
    [-32.5, 0, 32.5],
    [-32.5, 0, -32.5],
  ],
};

const runs = new Map();
const runByPlayer = new Map();

let nextRunSeq = 0;

function isBossWave(wave) {
  return wave % ARENA_CONFIG.bossEveryWaves === 0;
}

function biomeIndexForWave(wave) {
  const step = Math.floor((wave - 1) / ARENA_CONFIG.wavesPerBiome);
  return Math.min(step, ARENA_CONFIG.biomeCount - 1);
}

function waveComposition(wave) {
  const boss = isBossWave(wave);
  const beyond = Math.max(0, wave - ARENA_CONFIG.biomeCount * ARENA_CONFIG.wavesPerBiome);

  const mobs = boss
    ? Math.min(6 + Math.floor(wave / 2), ARENA_CONFIG.maxLiveEnemies - 1)
    : Math.min(4 + Math.floor(wave * 1.4), ARENA_CONFIG.maxLiveEnemies);

  return {
    biomeIndex: biomeIndexForWave(wave),
    mobs,
    bosses: boss ? 1 : 0,
    healthMult: 1 + (wave - 1) * 0.12 + beyond * 0.1,
    damageMult: 1 + (wave - 1) * 0.07 + beyond * 0.05,
  };
}

function rewardsFor(wavesCleared, config = null) {
  const ashPerWave = Number.isFinite(config?.ashPerWave) ? config.ashPerWave : ARENA_CONFIG.ashPerWave;
  const xpPerWave = Number.isFinite(config?.xpPerWave) ? config.xpPerWave : ARENA_CONFIG.xpPerWave;
  const ashCap = Number.isFinite(config?.ashCap) ? config.ashCap : ARENA_CONFIG.ashCap;
  const xpCap = Number.isFinite(config?.xpCap) ? config.xpCap : ARENA_CONFIG.xpCap;

  return {
    ash: Math.min(ashPerWave * wavesCleared, ashCap),
    xp: Math.min(xpPerWave * wavesCleared, xpCap),
  };
}

function runForInstance(instance) {
  return runs.get(instance) || null;
}

function runForPlayer(playerId) {
  const instance = runByPlayer.get(playerId);
  return instance === undefined ? null : runs.get(instance) || null;
}

function createRun(instance, memberIds, now = Date.now()) {
  if (runs.has(instance)) return { ok: false, error: 'instance_busy' };
  if (memberIds.length === 0) return { ok: false, error: 'no_members' };

  const run = {
    id: `arena-${nextRunSeq++}`,
    instance,
    memberIds: memberIds.slice(),
    downIds: new Set(),
    leftIds: new Set(),
    wave: 0,
    wavesCleared: 0,
    phase: 'prep',
    phaseUntil: now + ARENA_CONFIG.prepMs,
    candleHealth: ARENA_CONFIG.candleHealth,
    enemies: new Map(),
    nextEnemySeq: 0,
    startedAt: now,
  };

  runs.set(instance, run);
  for (const id of memberIds) runByPlayer.set(id, instance);

  return { ok: true, run };
}

function activeMembers(run) {
  return run.memberIds.filter((id) => !run.leftIds.has(id));
}

function standingMembers(run) {
  return run.memberIds.filter((id) => !run.leftIds.has(id) && !run.downIds.has(id));
}

function bindMember(run, playerId) {
  runByPlayer.set(playerId, run.instance);
}

function dropMember(run, playerId) {
  run.leftIds.add(playerId);
  run.downIds.delete(playerId);
  runByPlayer.delete(playerId);
}

function markDown(run, playerId) {
  if (run.leftIds.has(playerId)) return;
  run.downIds.add(playerId);
}

function markUp(run, playerId) {
  run.downIds.delete(playerId);
}

function isOver(run) {
  if (run.candleHealth <= 0) return true;
  return standingMembers(run).length === 0;
}

function endRun(run) {
  run.phase = 'over';
  for (const id of run.memberIds) {
    if (runByPlayer.get(id) === run.instance) runByPlayer.delete(id);
  }
  runs.delete(run.instance);
}

function allRuns() {
  return Array.from(runs.values());
}

module.exports = {
  ARENA_CONFIG,
  isBossWave,
  biomeIndexForWave,
  waveComposition,
  rewardsFor,
  createRun,
  runForInstance,
  runForPlayer,
  activeMembers,
  standingMembers,
  bindMember,
  dropMember,
  markDown,
  markUp,
  isOver,
  endRun,
  allRuns,
};
