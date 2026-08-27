// server.js
require('dotenv').config();
const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const worldTerrain = require('./worldTerrain');
const { FACTION_TASKS, FACTION_TASKS_BY_KEY } = require('./factionTasks');
const {
  QUEST_LISTING_FEE_ASH,
  QUEST_MIN_SLOTS,
  QUEST_MAX_SLOTS,
  QUEST_MIN_REWARD_ASH,
  QUEST_MAX_REWARD_ASH,
  FACTION_QUEST_TYPES,
  isValidXPostUrl,
  questTotalCostAsh,
} = require('./factionQuests');
const tournamentRules = require('./tournaments');
const progression = require('./progression');
const skills = require('./skills');
const abilities = require('./abilities');
const party = require('./party');
const arena = require('./arena');
const eventSchedule = require('./eventSchedule');
const defusal = require('./defusal');
const defusalArsenal = require('./defusalArsenal');
const grinder = require('./grinder');
const caveGeometry = require('./caveGeometry');
const influenceGeometry = require('./influenceGeometry');
const influence = require('./influence');

const PORT = process.env.PORT || 3001;
const MAX_CONNECTIONS = 2000;

const EMOTE_KEYS = ['laugh', 'fuck_you', 'angry', 'to_the_moon', 'green_candle'];

const COSMETIC_SLOTS = {
  trump_hair: 'accessory',
  trump_suit: 'skin',
  pepe_frog: 'skin',
  doge_shiba: 'skin',
  wojak_hoodie: 'skin',
  gigachad_marble: 'skin',
  moon_astronaut: 'skin',
  bull_market: 'skin',
  bear_market: 'skin',
  laser_eyes: 'accessory',
  deal_shades: 'accessory',
};
const COSMETIC_PRICE_ASH = 1;

const INTERNAL_HTTP_AGENT = new http.Agent({ keepAlive: true, maxSockets: 24, keepAliveMsecs: 15000 });
const INTERNAL_HTTPS_AGENT = new https.Agent({ keepAlive: true, maxSockets: 24, keepAliveMsecs: 15000 });

const internalCache = new Map();

const CONFIG = {
  world: {
    size: 1000,
    zoneSize: 50,
    aoiRadius: 2,
    maxSpeed: 15,
    maxPositionUpdateRate: 50,
  },
  network: {
    heartbeatInterval: 5000,
    heartbeatTimeout: 45000,
    staleTimeout: 90000,
    maxMessageSize: 32 * 1024,
    chatRateLimit: 3,
    updateRateLimit: 25,
    shootRateLimit: 20,
    hitRateLimit: 20,
    sellRateLimit: 20,
    buildRateLimit: 10,
    roomBuildRateLimit: 30,
    voiceRateLimit: 40,
    locationChangeRateLimit: 10,
    nicknameChangeRateLimit: 3,
    skinUpdateRateLimit: 3,
    saveProgressRateLimit: 5,
    questRateLimit: 10,
    progressionRateLimit: 10,
    abilityRateLimit: 8,
    memeRateLimit: 3,
    canyonRateLimit: 10,
    factionRateLimit: 10,
    factionSearchRateLimit: 15,
    profileRateLimit: 15,
    friendRateLimit: 10,
    friendSearchRateLimit: 15,
    mailSendRateLimit: 5,
    mailReadRateLimit: 15,
    respawnRateLimit: 3,
    stuckRateLimit: 2,
    crateRateLimit: 5,
    partyRateLimit: 5,
    arenaRateLimit: 5,
    storageRateLimit: 12,
    tokenLookupRateLimit: 1,
    supportRateLimit: 1,
    blockRateLimit: 5,
    privateMessageRateLimit: 5,
    factionChatRateLimit: 3,
    factionInviteRateLimit: 5,
    factionQuestRateLimit: 10,
    factionQuestCreateRateLimit: 3,
    emoteRateLimit: 2,
    cosmeticRateLimit: 5,
    companionRateLimit: 8,
    tournamentRateLimit: 10,
    tradeRateLimit: 8,
  },
  combat: {
    maxShotRange: 200,
    hitTolerance: 3,
    shotMatchWindowMs: 500,
  },
  siteUrl: process.env.SITE_URL || 'https://theadvenjo.online',
  internalSecret: process.env.INTERNAL_API_SECRET,
  gameTokenSecret: process.env.GAME_TOKEN_SECRET || process.env.JWT_SECRET,
  autoSaveInterval: 30000,
};

const WEAPON_CONFIG = {
  maxAmmo: 30,
  fireRateMs: 120,
  fireRateToleranceMs: 20,
  reloadDurationMs: 2000,
};

const PLAYER_WEAPON_DAMAGE_TO_ENEMY = 25;
const BASE_PVP_DAMAGE = 5;
const BASE_MAX_HEALTH = 100;

const BRANCH_UNLOCK_LEVEL = 2;
const ABILITY_SLOTS = ['s1', 's2', 's3', 's4', 's5', 's6'];
const LEGACY_ABILITY_SLOTS = { q: 's1', f: 's2', c: 's3', v: 's4', x: 's5' };
const ABILITY_TICK_MS = 200;
const ABILITY_ORIGIN_TOLERANCE = 3;
const COMBAT_MODE_MS = 10000;
const COMBAT_STATE_THROTTLE_MS = 2000;
const STUCK_COOLDOWN_MS = 60 * 60 * 1000;
const STUCK_DESTINATION_ID = 'main-world';
const HOME_TELEPORT_COOLDOWN_MS = 10 * 60 * 1000;
const HOME_TELEPORT_CAST_MS = 5000;
const SHOT_SPREAD_TOLERANCE_DEG = 6;
const CANYON_LEVELS_PER_SEGMENT = 5;
const CAVE_CONTENT_LEVEL = 15;
const MAIN_WORLD_CONTENT_LEVEL = 10;

const RTT_SAMPLE_CEILING_MS = 1000;
const RTT_SAMPLE_WINDOW = 5;
const MAX_LAG_COMPENSATION_MS = 250;

const CANYON_CONFIG = {
  tickRate: 100,
  hitTolerance: 5,
  patrolPauseMinMs: 2000,
  patrolPauseMaxMs: 5000,
};

const CANYON_HALF_WIDTH = 50;
const CANYON_HUB_LENGTH = 100;
const CANYON_START_Z = CANYON_HUB_LENGTH;
const CANYON_SAFE_ENTRANCE_DEPTH = 100;
const CANYON_COMBAT_DEPTH = 360;
const CANYON_BOSS_ZONE_DEPTH = 40;
const CANYON_SEGMENT_LENGTH = CANYON_SAFE_ENTRANCE_DEPTH + CANYON_COMBAT_DEPTH + CANYON_BOSS_ZONE_DEPTH;
const CANYON_MAX_SEGMENT_CAP = 200;
const ARENA_LOCATION_ID = arena.ARENA_CONFIG.locationId;
const CANYON_RETURN_PAD_OFFSET = 20;
const CANYON_RETURN_PAD_REACH = 6;
const CANYON_REPEAT_LOOT_MULT = 0.3;
// One meme fragment per boss, on every clear including repeats. 100 fragments
// combine into one crate, so a farmed segment is still ~100 boss kills per crate.
const CANYON_BOSS_FRAGMENTS = 1;
const CANYON_COSMETIC_FRAGMENT_FROM = 6;

const CANYON_HUB_POSITION = [0, 0, 20];

function canyonSegmentStartZ(segment) {
  return CANYON_START_Z + (segment - 1) * CANYON_SEGMENT_LENGTH;
}

function canyonSegmentName(segment) {
  const biome = canyonBiomeFor(segment);
  return segment <= CANYON_BIOMES.length ? biome.name : `${biome.name} — Segment ${segment}`;
}

const CAVE_BOSS_ARENA = caveGeometry.BOSS_ARENA;

const ENEMY_TYPES = {
  slime: {
    name: 'Slime', maxHealth: 100, attackDamage: 10, attackRange: 1.5, aggroRadius: 20, aggroLeash: 150,
    attackCooldown: 1000, chaseSpeedNear: 5, chaseSpeedFar: 17.5, chaseNearThreshold: 10,
    patrolSpeed: 1.8, patrolRadius: 18, scale: 1, lootMin: 1, lootMax: 3,
  },
  slime_boss: {
    name: 'Slime Boss', maxHealth: 600, attackDamage: 25, attackRange: 2.5, aggroRadius: 30, aggroLeash: 180,
    attackCooldown: 1200, chaseSpeedNear: 4, chaseSpeedFar: 10, chaseNearThreshold: 12,
    patrolSpeed: 1.2, patrolRadius: 10, scale: 3, lootMin: 10, lootMax: 20,
  },
  cave_warden: {
    name: 'The Hollow Warden', maxHealth: 24000, attackDamage: 0, attackRange: 0, aggroRadius: 42, aggroLeash: 999,
    attackCooldown: 2400, chaseSpeedNear: 2.2, chaseSpeedFar: 4.6, chaseNearThreshold: 22,
    patrolSpeed: 1.4, patrolRadius: 8, scale: 5, lootMin: 40, lootMax: 70,
    ranged: true, preferredRange: 17, arena: CAVE_BOSS_ARENA,
    wave: { windup: 3000, cooldown: 30000, damage: 50 },
    regenPerSecond: 400, regenIdleMs: 8000,
    attacks: [
      { id: 'spit', windup: 700, cooldown: 2400, minRange: 0, maxRange: 46, speed: 30, radius: 3, damage: 22, shots: 1, spread: 0 },
      { id: 'volley', windup: 1150, cooldown: 6200, minRange: 8, maxRange: 46, speed: 22, radius: 3.4, damage: 15, shots: 5, spread: 7 },
      { id: 'pool', windup: 1450, cooldown: 9000, minRange: 6, maxRange: 40, speed: 15, radius: 5.5, damage: 14, shots: 1, spread: 0, pool: { duration: 6500, interval: 700, damage: 9 } },
    ],
  },
  slime_warden: {
    name: 'Slime Warden', maxHealth: 1600, attackDamage: 0, attackRange: 0, aggroRadius: 58, aggroLeash: 999,
    attackCooldown: 2000, chaseSpeedNear: 3.4, chaseSpeedFar: 7, chaseNearThreshold: 18,
    patrolSpeed: 1.6, patrolRadius: 12, scale: 3.4, lootMin: 8, lootMax: 16,
    ranged: true, preferredRange: 16,
    attacks: [
      { id: 'spit', windup: 750, cooldown: 2600, minRange: 0, maxRange: 52, speed: 28, radius: 3, damage: 18, shots: 1, spread: 0 },
      { id: 'volley', windup: 1200, cooldown: 7000, minRange: 10, maxRange: 52, speed: 21, radius: 3.2, damage: 12, shots: 4, spread: 6 },
      { id: 'pool', windup: 1500, cooldown: 11000, minRange: 8, maxRange: 46, speed: 15, radius: 5, damage: 8, shots: 1, spread: 0, pool: { duration: 6000, interval: 750, damage: 6 } },
    ],
  },
  slime_seer: {
    name: 'Rift Seer', maxHealth: 2000, attackDamage: 0, attackRange: 0, aggroRadius: 52, aggroLeash: 999,
    attackCooldown: 1800, chaseSpeedNear: 3.8, chaseSpeedFar: 8, chaseNearThreshold: 18,
    patrolSpeed: 1.6, patrolRadius: 12, scale: 3.8, lootMin: 30, lootMax: 55,
    ranged: true, preferredRange: 18, arenaRadius: 46,
    attacks: [
      { id: 'spit', windup: 700, cooldown: 2400, minRange: 0, maxRange: 54, speed: 30, radius: 3.2, damage: 26, shots: 1, spread: 0 },
      { id: 'volley', windup: 1150, cooldown: 6400, minRange: 10, maxRange: 54, speed: 22, radius: 3.4, damage: 17, shots: 5, spread: 7 },
      { id: 'pool', windup: 1450, cooldown: 10000, minRange: 8, maxRange: 48, speed: 15, radius: 5.4, damage: 12, shots: 1, spread: 0, pool: { duration: 6500, interval: 700, damage: 10 } },
    ],
  },
  husk: {
    name: 'Ash Husk', maxHealth: 140, attackDamage: 14, attackRange: 1.8, aggroRadius: 24, aggroLeash: 160,
    attackCooldown: 900, chaseSpeedNear: 6, chaseSpeedFar: 15, chaseNearThreshold: 10,
    patrolSpeed: 2.2, patrolRadius: 20, scale: 1.15, lootMin: 2, lootMax: 4,
  },
  husk_boss: {
    name: 'Cinder Colossus', maxHealth: 900, attackDamage: 32, attackRange: 3, aggroRadius: 34, aggroLeash: 190,
    attackCooldown: 1300, chaseSpeedNear: 4.5, chaseSpeedFar: 11, chaseNearThreshold: 12,
    patrolSpeed: 1.3, patrolRadius: 12, scale: 3.4, lootMin: 14, lootMax: 26,
  },
  frostling: {
    name: 'Frostling', maxHealth: 120, attackDamage: 12, attackRange: 1.6, aggroRadius: 26, aggroLeash: 170,
    attackCooldown: 800, chaseSpeedNear: 7, chaseSpeedFar: 19, chaseNearThreshold: 9,
    patrolSpeed: 2.6, patrolRadius: 22, scale: 0.9, lootMin: 2, lootMax: 5,
  },
  frost_boss: {
    name: 'Glacier Warden', maxHealth: 1100, attackDamage: 36, attackRange: 3.2, aggroRadius: 36, aggroLeash: 200,
    attackCooldown: 1400, chaseSpeedNear: 4.2, chaseSpeedFar: 12, chaseNearThreshold: 13,
    patrolSpeed: 1.4, patrolRadius: 12, scale: 3.6, lootMin: 18, lootMax: 32,
  },
  sporeling: {
    name: 'Sporeling', maxHealth: 165, attackDamage: 16, attackRange: 2, aggroRadius: 22, aggroLeash: 165,
    attackCooldown: 950, chaseSpeedNear: 5.5, chaseSpeedFar: 16, chaseNearThreshold: 10,
    patrolSpeed: 2, patrolRadius: 19, scale: 1.25, lootMin: 3, lootMax: 6,
  },
  spore_boss: {
    name: 'Mycelial Heart', maxHealth: 1400, attackDamage: 40, attackRange: 3.4, aggroRadius: 34, aggroLeash: 200,
    attackCooldown: 1500, chaseSpeedNear: 3.8, chaseSpeedFar: 10.5, chaseNearThreshold: 14,
    patrolSpeed: 1.1, patrolRadius: 11, scale: 4, lootMin: 22, lootMax: 40,
  },
  voidling: {
    name: 'Voidling', maxHealth: 200, attackDamage: 20, attackRange: 1.9, aggroRadius: 30, aggroLeash: 180,
    attackCooldown: 750, chaseSpeedNear: 8, chaseSpeedFar: 21, chaseNearThreshold: 9,
    patrolSpeed: 3, patrolRadius: 24, scale: 1.05, lootMin: 4, lootMax: 8,
  },
  void_boss: {
    name: 'The Rug Puller', maxHealth: 1800, attackDamage: 46, attackRange: 3.6, aggroRadius: 40, aggroLeash: 220,
    attackCooldown: 1200, chaseSpeedNear: 5, chaseSpeedFar: 14, chaseNearThreshold: 14,
    patrolSpeed: 1.6, patrolRadius: 14, scale: 4.2, lootMin: 30, lootMax: 55,
  },
  ward_walker: {
    name: 'Ward Walker', maxHealth: 280, attackDamage: 19, attackRange: 2, aggroRadius: 24, aggroLeash: 9999,
    attackCooldown: 1250, chaseSpeedNear: 2.5, chaseSpeedFar: 3.6, chaseNearThreshold: 9,
    patrolSpeed: 1.1, patrolRadius: 16, scale: 1, lootMin: 3, lootMax: 7,
    ward: true,
  },
  ward_runner: {
    name: 'Ward Stalker', maxHealth: 190, attackDamage: 27, attackRange: 2.2, aggroRadius: 34, aggroLeash: 9999,
    attackCooldown: 850, chaseSpeedNear: 9.5, chaseSpeedFar: 16, chaseNearThreshold: 8,
    patrolSpeed: 0.9, patrolRadius: 8, scale: 0.98, lootMin: 5, lootMax: 10,
    ward: true,
    ambush: { hideRadius: 26, wakeRadius: 15, lungeSpeed: 22, lungeMs: 850, recoverMs: 1500 },
  },
  ward_brute: {
    name: 'Ward Gorger', maxHealth: 3200, attackDamage: 54, attackRange: 3.6, aggroRadius: 32, aggroLeash: 9999,
    attackCooldown: 2100, chaseSpeedNear: 2.3, chaseSpeedFar: 4.4, chaseNearThreshold: 13,
    patrolSpeed: 0.8, patrolRadius: 11, scale: 1.55, lootMin: 20, lootMax: 38,
    ward: true,
    slam: { windup: 1100, cooldown: 6500, radius: 8, damage: 48, range: 9 },
  },
  ward_herald: {
    name: 'Ward Herald', maxHealth: 11000, attackDamage: 0, attackRange: 0, aggroRadius: 46, aggroLeash: 9999,
    attackCooldown: 2000, chaseSpeedNear: 3, chaseSpeedFar: 6.2, chaseNearThreshold: 18,
    patrolSpeed: 1.4, patrolRadius: 10, scale: 1.75, lootMin: 60, lootMax: 110,
    ward: true, ranged: true, preferredRange: 16, arenaRadius: 999, cover: 'city', crystalDamage: 70,
    attacks: [
      { id: 'spit', windup: 700, cooldown: 2400, minRange: 0, maxRange: 44, speed: 30, radius: 3.2, damage: 26, shots: 1, spread: 0 },
      { id: 'volley', windup: 1150, cooldown: 6800, minRange: 8, maxRange: 44, speed: 22, radius: 3.6, damage: 18, shots: 5, spread: 8 },
      { id: 'pool', windup: 1400, cooldown: 10000, minRange: 6, maxRange: 40, speed: 15, radius: 5.6, damage: 13, shots: 1, spread: 0, pool: { duration: 6500, interval: 700, damage: 11 } },
    ],
  },
  ward_confessor: {
    name: 'The Pale Confessor', maxHealth: 46000, attackDamage: 0, attackRange: 0, aggroRadius: 48, aggroLeash: 9999,
    attackCooldown: 1900, chaseSpeedNear: 2.6, chaseSpeedFar: 5.4, chaseNearThreshold: 20,
    patrolSpeed: 1.2, patrolRadius: 7, scale: 1, lootMin: 220, lootMax: 340,
    ward: true, ranged: true, preferredRange: 15,
    arena: { x: influenceGeometry.BOSS_ARENA.x, z: influenceGeometry.BOSS_ARENA.z, radius: influenceGeometry.BOSS_ARENA.radius },
    cover: 'city',
    regenPerSecond: 900, regenIdleMs: 12000,
    wave: { windup: 3200, cooldown: 34000, damage: 62 },
    phases: [
      { key: 'litany', from: 1, summon: { walkers: 4, runners: 0, everyMs: 16000 } },
      { key: 'procession', from: 0.7, summon: { walkers: 4, runners: 2, everyMs: 14000 } },
      { key: 'toll', from: 0.4, summon: { walkers: 3, runners: 4, everyMs: 11000 } },
      { key: 'rapture', from: 0.15, summon: { walkers: 4, runners: 5, everyMs: 8000 }, speedMult: 1.35, damageMult: 1.3 },
    ],
    attacks: [
      { id: 'spit', phase: 1, windup: 640, cooldown: 2100, minRange: 0, maxRange: 48, speed: 32, radius: 3.2, damage: 30, shots: 1, spread: 0 },
      { id: 'volley', phase: 1, windup: 1100, cooldown: 6000, minRange: 8, maxRange: 48, speed: 24, radius: 3.6, damage: 21, shots: 5, spread: 8 },
      { id: 'censer', phase: 0.7, windup: 1350, cooldown: 8200, minRange: 4, maxRange: 46, speed: 19, radius: 6, damage: 26, shots: 3, spread: 11 },
      { id: 'pool', phase: 0.7, windup: 1450, cooldown: 9500, minRange: 6, maxRange: 44, speed: 16, radius: 5.8, damage: 16, shots: 1, spread: 0, pool: { duration: 7000, interval: 650, damage: 14 } },
      { id: 'grasp', phase: 0.4, windup: 1250, cooldown: 11000, minRange: 0, maxRange: 44, speed: 20, radius: 4.6, damage: 18, shots: 4, spread: 14, pool: { duration: 8000, interval: 900, damage: 12 } },
      { id: 'rapture', phase: 0.15, windup: 1600, cooldown: 9000, minRange: 0, maxRange: 52, speed: 26, radius: 4.2, damage: 34, shots: 7, spread: 16 },
    ],
  },
};

const CANYON_BIOMES = [
  { key: 'slime_valley', name: 'Slime Valley', mob: 'slime', boss: 'slime_boss', mobCount: 10 },
  { key: 'ember_wastes', name: 'Ember Wastes', mob: 'husk', boss: 'husk_boss', mobCount: 12 },
  { key: 'frozen_shelf', name: 'Frozen Shelf', mob: 'frostling', boss: 'frost_boss', mobCount: 14 },
  { key: 'spore_hollow', name: 'Spore Hollow', mob: 'sporeling', boss: 'spore_boss', mobCount: 15 },
  { key: 'void_rift', name: 'Void Rift', mob: 'voidling', boss: 'void_boss', mobCount: 16 },
];

function canyonBiomeFor(segment) {
  const index = Math.min(CANYON_BIOMES.length, Math.max(1, segment)) - 1;
  return CANYON_BIOMES[index];
}

const ORIENTATION_TARGETS = [
  { id: 'token-vendor', name: 'Tony', role: 'Trader', locationId: 'tower-main-hall' },
  { id: 'npc-alfredo', name: 'Alfredo', role: 'Appearance', locationId: 'tower-main-hall' },
  { id: 'faction-broker', name: 'Alaric', role: 'Factions', locationId: 'tower-main-hall' },
  { id: 'canyon-dispatcher', name: 'Canyon Dispatcher', role: 'Expeditions', locationId: 'tower-first-floor' },
  { id: 'gate-steward', name: 'Keeper of Gates', role: 'Token Gates', locationId: 'tower-basement' },
];

const ORIENTATION_TARGET_IDS = new Set(ORIENTATION_TARGETS.map((t) => t.id));

const MET_NPC_IDS = new Set([...ORIENTATION_TARGET_IDS, 'quest-giver-sola']);

const QUESTS = {
  sola_orientation: {
    id: 'sola_orientation',
    npc: 'sola',
    order: 1,
    title: 'Getting Your Bearings',
    description: 'Meet every steward in the tower, then come back to me. I will make sure the effort counts.',
    type: 'visit_npcs',
    targets: ORIENTATION_TARGETS,
    targetCount: ORIENTATION_TARGETS.length,
    rewardAsh: 25,
  },
  sola_kill_10: {
    id: 'sola_kill_10',
    npc: 'sola',
    order: 2,
    title: 'Pest Control',
    description: 'Kill 10 slimes in Slime Valley.',
    type: 'kill_enemies',
    locationId: 'tower-first-floor',
    targetCount: 10,
    rewardAsh: 30,
    requiresQuest: 'sola_orientation',
  },
};

const QUEST_LIST = Object.values(QUESTS).sort((a, b) => (a.order || 0) - (b.order || 0));

const DAY_NIGHT_CONFIG = {
  dayDurationMs: 40 * 60 * 1000,
  nightDurationMs: 20 * 60 * 1000,
};
const dayNightEpoch = Date.now();

if (!CONFIG.internalSecret) {
  console.error('[!] INTERNAL_API_SECRET not set. Persistence disabled.');
}
if (!CONFIG.gameTokenSecret) {
  console.error('[!] GAME_TOKEN_SECRET/JWT_SECRET not set. Auth will fail.');
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('ok');
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocket.Server({
  server,
  maxPayload: CONFIG.network.maxMessageSize,
  perMessageDeflate: false,
});

const players = new Map();
const zoneBuckets = new Map();
const AOI_RADIUS_OVERRIDES = { 'tower-basement': 8 };
const userIdToPlayer = new Map();
const walletToPlayer = new Map();
const rateLimits = new Map();
const factionTaskState = new Map();

const factionTaskHydrating = new Map();

const factionTaskGeneration = new Map();

function nextFactionTaskGeneration(factionId) {
  const gen = (factionTaskGeneration.get(factionId) || 0) + 1;
  factionTaskGeneration.set(factionId, gen);
  return gen;
}

const VALID_STATES = new Set(['idle', 'walk', 'sprint', 'jump']);
const EVENTS_LOBBY_ID = 'tower-events';

const EVENT_ROOMS = {
  'event-arena': { radius: 60, spawn: [0, 0, 46] },
  'event-dust2': { radius: 72, spawn: [24, 0, 33] },
  'event-grinder': { radius: 72, spawn: [24, 0, 33] },
  'event-pump': { radius: 58, spawn: [0, 0, 44] },
  'event-whale': { radius: 62, spawn: [0, 0, 48] },
  'event-mint': { radius: 54, spawn: [0, 0, 40] },
  'event-bridge': { radius: 58, spawn: [0, 0, 44] },
  'event-audit': { radius: 52, spawn: [0, 0, 38] },
  'event-airdrop': { radius: 60, spawn: [0, 0, 46] },
  'event-burn': { radius: 56, spawn: [0, 0, 42] },
  'event-diamond': { radius: 54, spawn: [0, 0, 40] },
};

const EVENT_ROOM_IDS = Object.keys(EVENT_ROOMS);

const EVENT_ID_BY_LOCATION = {
  'event-arena': 'arena',
  'event-dust2': 'dust2',
  'event-grinder': 'dust2',
  'event-pump': 'pump',
  'event-whale': 'whale',
  'event-mint': 'mint',
  'event-bridge': 'bridge',
  'event-audit': 'audit',
  'event-airdrop': 'airdrop',
  'event-burn': 'burn',
  'event-diamond': 'diamond',
};

const EVENT_CONFIG_POLL_MS = 30000;
const eventConfigs = new Map();

async function refreshEventConfigs(gameId) {
  if (!gameId || !CONFIG.internalSecret) return;

  const result = await callInternalApi('/api/internal/game/event-configs', { gameId }).catch((err) => {
    console.error('[Events] config refresh error:', err.message);
    return null;
  });
  if (!Array.isArray(result?.events)) return;

  eventConfigs.clear();
  for (const event of result.events) {
    if (typeof event?.id === 'string') eventConfigs.set(event.id, event);
  }
}

function eventConfigFor(eventId) {
  return eventConfigs.get(eventId) || null;
}

function eventConfigForLocation(locationId) {
  const eventId = EVENT_ID_BY_LOCATION[locationId];
  return eventId ? eventConfigFor(eventId) : null;
}


function isEventOpen(eventId) {
  const config = eventConfigFor(eventId);
  if (!config) return eventId === 'arena';
  if (config.enabled !== true) return false;
  return eventSchedule.eventWindow(config).open;
}

function eventSealedReason(eventId) {
  const config = eventConfigFor(eventId);
  if (!config || config.enabled !== true) return 'sealed';

  const window = eventSchedule.eventWindow(config);
  if (window.open) return null;
  return window.state === 'upcoming' ? 'not_started' : 'window_closed';
}

const VALID_LOCATIONS = new Set([
  'main-world',
  'cave',
  influence.INFLUENCE_LOCATION_ID,
  'tower-main-hall',
  'tower-first-floor',
  'tower-token-gates',
  'tower-basement',
  EVENTS_LOBBY_ID,
  'open-world-canyon',
  ...EVENT_ROOM_IDS,
]);

const FACTION_GATE_LOCATION_PATTERN = /^faction-gate-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLAYER_ROOM_LOCATION_PATTERN = /^player-room-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isKnownLocationId(locationId) {
  return VALID_LOCATIONS.has(locationId) ||
    FACTION_GATE_LOCATION_PATTERN.test(locationId) ||
    PLAYER_ROOM_LOCATION_PATTERN.test(locationId);
}

const GALAXY_LOCATION_ID = 'tower-basement';
const SEALED_LOCATIONS = new Set(['tower-token-gates']);
const DEFAULT_SPAWN_LOCATION_ID = 'tower-main-hall';
const PRIVATE_LOCATION_PREFIXES = ['faction-gate-', 'player-room-'];
const SHARD_CAPACITY = 50;
const SHARD_FRIEND_GRACE = 5;
const MAX_SHARDS = 64;
const GALAXY_MAX_RADIUS = 2600;
const GALAXY_MIN_Y = -1400;
const GALAXY_MAX_Y = 500;
const GALAXY_MAX_SPEED = 110;
const GALAXY_SPAWN = [0, 0, 14];
const TOKEN_GATES_LOCATION_ID = 'tower-token-gates';
const FLIGHT_LOCATION_IDS = new Set([GALAXY_LOCATION_ID, TOKEN_GATES_LOCATION_ID]);
const MOVE_VIOLATION_TOLERANCE = 2;
const PLAYER_ROOM_PREFIX = 'player-room-';

const LOCATION_MAX_RADIUS = {
  'tower-main-hall': 140,
  'tower-token-gates': 80,
  'tower-basement': GALAXY_MAX_RADIUS,
  [EVENTS_LOBBY_ID]: 58,
  cave: caveGeometry.OUTER_RADIUS + 12,
  'open-world-canyon': 150,
  [influence.INFLUENCE_LOCATION_ID]: influenceGeometry.OUTER_RADIUS + 6,
};

for (const [locationId, room] of Object.entries(EVENT_ROOMS)) {
  LOCATION_MAX_RADIUS[locationId] = room.radius;
}
const CAVE_LOCATION_ID = 'cave';
const CAVE_CHEST_REWARD = 1000;
const CAVE_CHEST_REACH = 5;
const CAVE_CHESTS = Object.fromEntries(
  caveGeometry.CHESTS.map((chest) => [chest.id, [chest.x, caveGeometry.FLOOR_Y, chest.z]])
);
const CAVE_BOSS_SPAWN = [caveGeometry.BOSS_SPAWN.x, caveGeometry.FLOOR_Y, caveGeometry.BOSS_SPAWN.z];
const CAVE_ENEMY_SPAWNS = caveGeometry.ENEMY_SPAWNS.map((s) => ({ type: s.type, position: [s.x, caveGeometry.FLOOR_Y, s.z] }));

const CAVE_CHAMBERS = caveGeometry.CHAMBERS;
const CAVE_TUNNELS = caveGeometry.TUNNELS;

const CAVE_ENEMY_CLEARANCE = 1.1;
const CAVE_PLAYER_SLACK = 3;
const CAVE_SHARD_CAPACITY = 10;
const CAVE_PARTY_RESERVATION_MS = 45000;
const CAVE_EMPTY_DISPOSE_MS = 60000;
const CAVE_CRATE_ROOMS = 3;
const CAVE_CRATE_REVEAL = 34;
const BOSS_PROVOKE_MS = 12000;
const CAVE_BOSS_CHEST_ID = 'boss';
const CAVE_SLIME_ID = 'pet-slime';
const CAVE_SLIME_CHANCE_PERCENT = 10;
const CAVE_SLIME_BONUS_FRAGMENTS = 20;
const CAVE_CHEST_FRAGMENTS_MIN = 30;
const CAVE_CHEST_FRAGMENTS_MAX = 50;
const CAVE_BOSS_CHEST_ASH = 500;
const COMPANION_ATTACK_RANGE = 18;
const COMPANION_ATTACK_DAMAGE = 12;
const COMPANION_ATTACK_COOLDOWN_MS = 2000;
const COMPANION_PROJECTILE_SPEED = 26;
const BOSS_TARGET_STICKINESS = 6;
const CAVE_DIRECT_SIGHT = 45;
const CAVE_STEER_REFRESH_MS = 400;
const CAVE_STEER_ANGLES = [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 1.95, -1.95];

const segmentDistance2D = caveGeometry.segmentDistance2D;
const caveDistance = caveGeometry.caveDistance;

function caveWalkable(x, z) {
  return caveGeometry.caveWalkable(x, z, CAVE_ENEMY_CLEARANCE);
}

function cavePlayerPositionSane(x, z) {
  return caveDistance(x, z) <= CAVE_PLAYER_SLACK;
}

function nudgeIntoCave(position) {
  if (caveWalkable(position[0], position[2])) return;

  let bestX = position[0];
  let bestZ = position[2];
  let bestDistance = caveDistance(position[0], position[2]);

  for (let ring = 1; ring <= 6; ring++) {
    const radius = ring * 1.5;
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const x = position[0] + Math.cos(angle) * radius;
      const z = position[2] + Math.sin(angle) * radius;
      const d = caveDistance(x, z);
      if (d < bestDistance) {
        bestDistance = d;
        bestX = x;
        bestZ = z;
      }
    }
    if (bestDistance <= -CAVE_ENEMY_CLEARANCE) break;
  }

  if (bestDistance > -CAVE_ENEMY_CLEARANCE) {
    const node = nearestCaveNode(position[0], position[2]);
    if (node >= 0) {
      position[0] = CAVE_NODES[node][0];
      position[2] = CAVE_NODES[node][1];
      return;
    }
  }

  position[0] = bestX;
  position[2] = bestZ;
}

const CAVE_NODES = [];
const CAVE_EDGES = [];

(function buildCaveGraph() {
  const key = (x, z) => `${x.toFixed(2)},${z.toFixed(2)}`;
  const index = new Map();

  const nodeFor = (x, z) => {
    const k = key(x, z);
    if (index.has(k)) return index.get(k);
    const id = CAVE_NODES.length;
    CAVE_NODES.push([x, z]);
    CAVE_EDGES.push([]);
    index.set(k, id);
    return id;
  };

  for (const tunnel of CAVE_TUNNELS) {
    const a = nodeFor(tunnel.ax, tunnel.az);
    const b = nodeFor(tunnel.bx, tunnel.bz);
    if (!CAVE_EDGES[a].includes(b)) CAVE_EDGES[a].push(b);
    if (!CAVE_EDGES[b].includes(a)) CAVE_EDGES[b].push(a);
  }

  for (const chamber of CAVE_CHAMBERS) {
    const centre = nodeFor(chamber.x, chamber.z);
    for (let i = 0; i < CAVE_NODES.length; i++) {
      if (i === centre) continue;
      const [nx, nz] = CAVE_NODES[i];
      if (Math.hypot(nx - chamber.x, nz - chamber.z) > chamber.radius) continue;
      if (!CAVE_EDGES[centre].includes(i)) CAVE_EDGES[centre].push(i);
      if (!CAVE_EDGES[i].includes(centre)) CAVE_EDGES[i].push(centre);
    }
  }
})();

const cavePathCache = new Map();

function caveLineClear(x1, z1, x2, z2) {
  const distance = Math.hypot(x2 - x1, z2 - z1);
  const steps = Math.max(2, Math.ceil(distance / 1.5));

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!caveWalkable(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t)) return false;
  }

  return true;
}

function nearestCaveNode(x, z) {
  let best = -1;
  let bestScore = Infinity;

  for (let i = 0; i < CAVE_NODES.length; i++) {
    const [nx, nz] = CAVE_NODES[i];
    const d = Math.hypot(nx - x, nz - z);
    if (d >= bestScore) continue;
    bestScore = d;
    best = i;
  }

  return best;
}

function caveRoute(from, to) {
  if (from === to) return [to];

  const cacheKey = from * 1000 + to;
  const cached = cavePathCache.get(cacheKey);
  if (cached) return cached;

  const previous = new Array(CAVE_NODES.length).fill(-1);
  const seen = new Array(CAVE_NODES.length).fill(false);
  const queue = [from];
  seen[from] = true;

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === to) break;
    for (const next of CAVE_EDGES[current]) {
      if (seen[next]) continue;
      seen[next] = true;
      previous[next] = current;
      queue.push(next);
    }
  }

  if (!seen[to]) return null;

  const path = [];
  for (let at = to; at !== -1; at = previous[at]) path.unshift(at);

  cavePathCache.set(cacheKey, path);
  return path;
}

function caveChaseDirection(enemy, targetX, targetZ, now) {
  if (enemy.caveSteer && now < enemy.caveSteerUntil) {
    const [gx, gz] = enemy.caveSteer;
    if (Math.hypot(gx - enemy.position[0], gz - enemy.position[2]) > 1.5) {
      return [gx - enemy.position[0], gz - enemy.position[2]];
    }
  }

  const goal = resolveCaveGoal(enemy, targetX, targetZ);
  enemy.caveSteer = goal;
  enemy.caveSteerUntil = now + CAVE_STEER_REFRESH_MS;
  return [goal[0] - enemy.position[0], goal[1] - enemy.position[2]];
}

function resolveCaveGoal(enemy, targetX, targetZ) {
  const direct = Math.hypot(targetX - enemy.position[0], targetZ - enemy.position[2]);
  if (direct <= CAVE_DIRECT_SIGHT && caveLineClear(enemy.position[0], enemy.position[2], targetX, targetZ)) {
    return [targetX, targetZ];
  }

  const from = nearestCaveNode(enemy.position[0], enemy.position[2]);
  const to = nearestCaveNode(targetX, targetZ);
  const path = caveRoute(from, to);
  if (!path) return [targetX, targetZ];

  const [ax, az] = CAVE_NODES[path[0]];
  const atFirst = Math.hypot(ax - enemy.position[0], az - enemy.position[2]) < 1.5;

  if (path.length < 2) return atFirst ? [targetX, targetZ] : [ax, az];

  const [bx, bz] = CAVE_NODES[path[1]];
  if (atFirst || caveLineClear(enemy.position[0], enemy.position[2], bx, bz)) {
    return [bx, bz];
  }

  return [ax, az];
}

function stepEnemy(enemy, dirX, dirZ, step, constrained) {
  const length = Math.hypot(dirX, dirZ) || 1;
  const nx = dirX / length;
  const nz = dirZ / length;

  if (!constrained) {
    enemy.position[0] += nx * step;
    enemy.position[2] += nz * step;
    return true;
  }

  for (const angle of CAVE_STEER_ANGLES) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const sx = nx * cos - nz * sin;
    const sz = nx * sin + nz * cos;
    const x = enemy.position[0] + sx * step;
    const z = enemy.position[2] + sz * step;

    if (caveWalkable(x, z)) {
      enemy.position[0] = x;
      enemy.position[2] = z;
      return true;
    }
  }

  return false;
}

const SNAPSHOT_INTERVAL_MS = 80;
const MAIN_WORLD_LIMIT = 480;
const MAIN_WORLD_SAFE_RADIUS = 34;
const MIN_LOCATION_CHANGE_INTERVAL_MS = 1000;
const SPAWN_PROTECTION_MS = 5000;
const CLIENT_READY_TIMEOUT_MS = 25000;
const TELEPORT_SETTLE_MS = 4000;

function getLocationMaxRadius(locationId) {
  if (LOCATION_MAX_RADIUS[locationId] != null) return LOCATION_MAX_RADIUS[locationId];
  if (locationId.startsWith('faction-gate-')) return 25;
  if (locationId.startsWith(PLAYER_ROOM_PREFIX)) return 25;
  return null;
}

function isValidPositionForLocation(locationId, pos) {
  if (!isValidPosition(pos, locationId)) return false;

  if (locationId === 'main-world') {
    const wallLimit = mainWorldPlayerLimit();
    if (wallLimit !== null) {
      const [wx, , wz] = pos;
      if (Math.sqrt(wx * wx + wz * wz) > wallLimit) return false;
    }
  }

  const maxRadius = getLocationMaxRadius(locationId);
  const [x, , z] = pos;
  if (maxRadius != null && Math.sqrt(x * x + z * z) > maxRadius) return false;

  if (locationId === CAVE_LOCATION_ID && !cavePlayerPositionSane(x, z)) return false;

  if (locationId === influence.INFLUENCE_LOCATION_ID && !influenceGeometry.insideCity(x, z, -6)) return false;

  return true;
}

function getCachedMessage(data) {
  return JSON.stringify(data);
}

function sanitizeMessage(msg) {
  return msg
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
}

const CHAT_LINK_PATTERN = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|net|org|io|gg|xyz|app|dev|me|link|to|club|shop|site|online|info|biz|co|ru|tk|top|click|icu|cc|vip|live|fun|pw|ws)\b/i;

function containsLink(msg) {
  return CHAT_LINK_PATTERN.test(msg);
}

function checkRateLimit(playerId, type, limit) {
  const now = Date.now();
  const key = `${playerId}:${type}`;
  const data = rateLimits.get(key) || { count: 0, resetTime: now + 1000 };
  if (now > data.resetTime) {
    data.count = 0;
    data.resetTime = now + 1000;
  }
  data.count++;
  rateLimits.set(key, data);
  return data.count <= limit;
}

function isValidPosition(pos, locationId) {
  if (!Array.isArray(pos) || pos.length !== 3) return false;
  const [x, y, z] = pos;
  if (
    typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number' ||
    isNaN(x) || isNaN(y) || isNaN(z) ||
    !isFinite(x) || !isFinite(y) || !isFinite(z)
  ) {
    return false;
  }

  if (FLIGHT_LOCATION_IDS.has(locationId)) {
    return y >= GALAXY_MIN_Y && y <= GALAXY_MAX_Y &&
      Math.abs(x) <= GALAXY_MAX_RADIUS && Math.abs(z) <= GALAXY_MAX_RADIUS;
  }

  if (locationId === 'main-world') {
    if (y < -30 || y > 90) return false;
    return Math.abs(x) <= MAIN_WORLD_LIMIT && Math.abs(z) <= MAIN_WORLD_LIMIT;
  }

  if (y < -30 || y > 50) return false;

  if (locationId === 'tower-first-floor') {
    return Math.abs(x) <= CANYON_HALF_WIDTH + 70 && z >= -50 && z <= CANYON_START_Z + CANYON_SEGMENT_LENGTH * CANYON_MAX_SEGMENT_CAP;
  }

  const halfSize = CONFIG.world.size / 2;
  return Math.abs(x) <= halfSize && Math.abs(z) <= halfSize;
}

function checkMovement(player, newPosition, deltaTimeMs) {
  const [ox, , oz] = player.position;
  const [nx, , nz] = newPosition;
  const dx = nx - ox;
  const dz = nz - oz;
  const distance = Math.sqrt(dx * dx + dz * dz);

  const now = Date.now();

  if (player.justSpawned || player.justTeleported || now < (player.teleportSettleUntil || 0)) {
    player.justSpawned = false;
    player.justTeleported = false;
    return { ok: true };
  }

  if (now < (player.abilityMoveGraceUntil || 0)) return { ok: true };

  const seconds = deltaTimeMs / 1000;
  const speed = distance / seconds;
  const base = FLIGHT_LOCATION_IDS.has(player.locationId) ? GALAXY_MAX_SPEED : CONFIG.world.maxSpeed;
  const limit = base * (player.combat ? player.combat.moveSpeedMult : 1) * abilityMoveSpeedMult(player, now) * 1.5;

  return { ok: speed <= limit, speed, limit };
}

function getHistoricalPosition(player, targetTime) {
  const history = player.positionHistory || [];
  if (history.length === 0) return player.position;

  const clampedTime = Math.max(history[0].time, Math.min(history[history.length - 1].time, targetTime));

  let before = history[0];
  let after = history[history.length - 1];

  for (let i = 0; i < history.length - 1; i++) {
    if (history[i].time <= clampedTime && history[i + 1].time >= clampedTime) {
      before = history[i];
      after = history[i + 1];
      break;
    }
  }

  const timeDiff = after.time - before.time;
  if (timeDiff <= 0) return before.position;

  const t = (clampedTime - before.time) / timeDiff;
  return [
    before.position[0] + (after.position[0] - before.position[0]) * t,
    before.position[1] + (after.position[1] - before.position[1]) * t,
    before.position[2] + (after.position[2] - before.position[2]) * t,
  ];
}

function distanceFromRay(origin, direction, point, maxRange) {
  const ox = point[0] - origin[0];
  const oy = point[1] - origin[1];
  const oz = point[2] - origin[2];

  const t = ox * direction[0] + oy * direction[1] + oz * direction[2];
  const clampedT = Math.max(0, Math.min(maxRange, t));

  const cx = origin[0] + direction[0] * clampedT;
  const cy = origin[1] + direction[1] * clampedT;
  const cz = origin[2] + direction[2] * clampedT;

  return Math.sqrt((point[0] - cx) ** 2 + (point[1] - cy) ** 2 + (point[2] - cz) ** 2);
}

const ENTITY_OCCLUSION_RADIUS = 0.6;

function isPathBlockedByEntity(origin, target, locationId, excludeIds, enemyPool) {
  const segX = target[0] - origin[0];
  const segZ = target[2] - origin[2];
  const segLenSq = segX * segX + segZ * segZ;
  if (segLenSq < 0.0001) return false;

  function blocks(pos) {
    const px = pos[0] - origin[0];
    const pz = pos[2] - origin[2];
    const t = (px * segX + pz * segZ) / segLenSq;
    if (t <= 0.02 || t >= 0.98) return false; 
    const cx = origin[0] + segX * t;
    const cz = origin[2] + segZ * t;
    const dx = pos[0] - cx;
    const dz = pos[2] - cz;
    return Math.sqrt(dx * dx + dz * dz) <= ENTITY_OCCLUSION_RADIUS;
  }

  for (const p of players.values()) {
    if (!p.authenticated || !p.alive) continue;
    if (excludeIds.has(p.id)) continue;
    if (p.locationId !== locationId) continue;
    if (blocks(p.position)) return true;
  }
  if (enemyPool) {
    for (const e of enemyPool) {
      if (!e.alive) continue;
      if (excludeIds.has(e.id)) continue;
      if (blocks(e.position)) return true;
    }
  }
  return false;
}

function findMatchingShot(player, targetHistoricalPos, now, tolerance = CONFIG.combat.hitTolerance) {
  const shots = player.recentShots || [];
  for (let i = shots.length - 1; i >= 0; i--) {
    const shot = shots[i];
    const age = now - shot.time;
    if (age > shotLifetimeMs(shot)) continue;

    const range = shot.maxRange || CONFIG.combat.maxShotRange;
    const dist = distanceFromRay(shot.origin, shot.direction, targetHistoricalPos, range);
    if (dist > tolerance) continue;

    if (shot.speed > 0 && !projectileTimingPlausible(shot, targetHistoricalPos, age)) continue;

    shot.hitsLeft -= 1;
    if (shot.hitsLeft <= 0) shots.splice(i, 1);
    return shot;
  }
  return null;
}

function safeSend(ws, data) {
  if (ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(data));
    return true;
  } catch (err) {
    console.error('[WS] Send error:', err.message);
    return false;
  }
}

function generateUniqueNickname(base = 'Player') {
  const existing = Array.from(players.values()).map(p => p.nickname);
  if (!existing.includes(base)) return base;
  let suffix = 1;
  while (existing.includes(`${base}${suffix}`)) suffix++;
  return `${base}${suffix}`;
}

async function assignUniqueNickname(player, base) {
  const result = await callInternalApi('/api/internal/game/nickname/set', {
    userId: player.userId, gameId: player.gameId, nickname: base, allowSuffix: true,
  }).catch((err) => {
    console.error('[Nickname] auto-assign error:', err.message);
    return null;
  });
  return result?.nickname || generateUniqueNickname(base);
}

function generateId() {
  return crypto.randomBytes(16).toString('hex');
}

const reportedTickErrors = new Set();

function safeInterval(fn, ms) {
  return setInterval(() => {
    try {
      fn();
    } catch (err) {
      const key = `${fn.name || 'anonymous'}:${err.message}`;
      if (reportedTickErrors.has(key)) return;
      reportedTickErrors.add(key);
      console.error(`[!] Interval tick error in ${fn.name || 'anonymous'}:`, err.stack || err.message);
    }
  }, ms);
}

function zoneIndex(value) {
  return Math.floor((value + CONFIG.world.size / 2) / CONFIG.world.zoneSize);
}

function aoiRadiusFor(locationId) {
  return AOI_RADIUS_OVERRIDES[locationId] ?? CONFIG.world.aoiRadius;
}

function zoneKeyFor(player) {
  return `${player.locationId}|${player.instance}|${zoneIndex(player.position[0])}|${zoneIndex(player.position[2])}`;
}

function removePlayerZone(player) {
  if (!player.zoneKey) return;
  const bucket = zoneBuckets.get(player.zoneKey);
  if (bucket) {
    bucket.delete(player.id);
    if (bucket.size === 0) zoneBuckets.delete(player.zoneKey);
  }
  player.zoneKey = null;
}

function updatePlayerZone(player) {
  const key = zoneKeyFor(player);
  if (key === player.zoneKey) return false;

  removePlayerZone(player);

  let bucket = zoneBuckets.get(key);
  if (!bucket) {
    bucket = new Set();
    zoneBuckets.set(key, bucket);
  }
  bucket.add(player.id);
  player.zoneKey = key;
  return true;
}

function forEachNearbyPlayer(player, fn) {
  const zx = zoneIndex(player.position[0]);
  const zz = zoneIndex(player.position[2]);
  const radius = aoiRadiusFor(player.locationId);

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const bucket = zoneBuckets.get(`${player.locationId}|${player.instance}|${zx + dx}|${zz + dz}`);
      if (!bucket) continue;

      for (const id of bucket) {
        if (id === player.id) continue;
        const other = players.get(id);
        if (other && other.authenticated && other.ws.readyState === WebSocket.OPEN) fn(other);
      }
    }
  }
}

function isInAOI(player, other) {
  if (player.locationId !== other.locationId) return false;
  if (player.instance !== other.instance && isShardedLocation(player.locationId)) return false;

  if (player.locationId === 'tower-first-floor') {
    return !!(player.canyon && other.canyon && player.canyon.inHub && other.canyon.inHub);
  }

  const radius = aoiRadiusFor(player.locationId);
  const dx = Math.abs(zoneIndex(player.position[0]) - zoneIndex(other.position[0]));
  const dz = Math.abs(zoneIndex(player.position[2]) - zoneIndex(other.position[2]));
  return dx <= radius && dz <= radius;
}

function buildPlayerStatePayload(p) {
  return {
    id: p.id,
    position: p.position,
    rotation: p.rotation,
    pitch: p.pitch,
    headYaw: p.headYaw,
    state: p.state,
    jumping: p.jumping,
    velocityY: p.velocityY,
    health: p.health,
    alive: p.alive,
    weaponEquipped: p.weaponEquipped,
    isShooting: p.isShooting,
    shielded: !!p.shieldVisible,
  };
}

function buildPlayerJoinPayload(p) {
  return {
    type: 'playerJoin',
    id: p.id,
    nickname: p.nickname,
    factionSymbol: p.displayedFactionSymbol,
    factionImage: p.displayedFactionImage,
    position: p.position,
    rotation: p.rotation,
    pitch: p.pitch,
    headYaw: p.headYaw,
    state: p.state || 'idle',
    jumping: p.jumping || false,
    velocityY: p.velocityY || 0,
    health: p.health,
    alive: p.alive,
    weaponEquipped: p.weaponEquipped,
    isShooting: p.isShooting,
    shielded: !!p.shieldVisible,
    locationId: p.locationId,
    isAdmin: !!p.isAdmin,
    isFactionCreator: !!p.isFactionCreator,
    skinTextureUrl: p.skinTextureUrl || null,
    cosmeticSkinId: p.cosmeticSkinId || null,
    cosmeticAccessoryId: p.cosmeticAccessoryId || null,
    companionId: p.companions?.equipped || null,
    level: p.progression.level,
    tier: progression.tierForLevel(p.progression.level).id,
    branch: p.progression.branch,
    weaponTier: progression.weaponTierForLevel(p.progression.level).tier,
  };
}

function recomputeAOI(player) {
  updatePlayerZone(player);

  const newNeighbors = new Set();

  forEachNearbyPlayer(player, (other) => {
    if (isInAOI(player, other)) newNeighbors.add(other.id);
  });

  const oldNeighbors = player.aoiNeighbors;

  for (const id of newNeighbors) {
    if (oldNeighbors.has(id)) continue;
    const other = players.get(id);
    if (!other) continue;
    if (other.ready) safeSend(player.ws, buildPlayerJoinPayload(other));
    if (player.ready) safeSend(other.ws, buildPlayerJoinPayload(player));
    other.aoiNeighbors.add(player.id);
  }

  for (const id of oldNeighbors) {
    if (newNeighbors.has(id)) continue;
    const other = players.get(id);
    safeSend(player.ws, { type: 'playerLeave', playerId: id });
    if (other) {
      safeSend(other.ws, { type: 'playerLeave', playerId: player.id });
      other.aoiNeighbors.delete(player.id);
    }
  }

  player.aoiNeighbors = newNeighbors;
}

function notifyAOILeave(player) {
  for (const id of player.aoiNeighbors) {
    const other = players.get(id);
    if (!other) continue;
    other.aoiNeighbors.delete(player.id);
    safeSend(other.ws, { type: 'playerLeave', playerId: player.id });
  }
  player.aoiNeighbors = new Set();
}

function discardPendingAuth(player) {
  player.authenticated = false;

  if (player.readyTimer) {
    clearTimeout(player.readyTimer);
    player.readyTimer = null;
  }

  if (player.userId && userIdToPlayer.get(player.userId) === player) {
    userIdToPlayer.delete(player.userId);
  }
  if (player.wallet && walletToPlayer.get(player.wallet) === player) {
    walletToPlayer.delete(player.wallet);
  }

  if (players.get(player.id) === player) {
    players.delete(player.id);
    notifyAOILeave(player);
  }
  removePlayerZone(player);

  if (player.userId) {
    callInternalApi('/api/internal/game/presence', { userId: player.userId, online: false }).catch((err) => {
      console.error('[Presence] offline update error:', err.message);
    });
  }

  console.log(`[!] Auth aborted (socket closed) for ${player.id} (${player.userId || 'unauth'})`);
}

function notifyLocationTransition(player, oldLocationId, newLocationId) {
  clearPlayerAbilityBuffs(player, false);

  const oldNeighbors = player.aoiNeighbors;
  player.aoiNeighbors = new Set();
  for (const id of oldNeighbors) {
    const other = players.get(id);
    if (!other) continue;
    other.aoiNeighbors.delete(player.id);
    safeSend(other.ws, {
      type: 'playerLeaveLocation',
      playerId: player.id,
      fromLocation: oldLocationId,
      toLocation: newLocationId,
    });
  }

  updatePlayerZone(player);

  forEachNearbyPlayer(player, (other) => {
    const id = other.id;
    if (!isInAOI(player, other)) return;
    player.aoiNeighbors.add(id);
    other.aoiNeighbors.add(player.id);
    if (player.ready) safeSend(other.ws, {
      type: 'playerJoinLocation',
      id: player.id,
      nickname: player.nickname,
      factionSymbol: player.displayedFactionSymbol,
      factionImage: player.displayedFactionImage,
      position: player.position,
      rotation: player.rotation,
      pitch: player.pitch,
      headYaw: player.headYaw,
      state: player.state || 'idle',
      jumping: player.jumping || false,
      velocityY: player.velocityY || 0,
      health: player.health,
      alive: player.alive,
      weaponEquipped: player.weaponEquipped,
      isShooting: player.isShooting,
      locationId: newLocationId,
      isAdmin: !!player.isAdmin,
      isFactionCreator: !!player.isFactionCreator,
      skinTextureUrl: player.skinTextureUrl || null,
      cosmeticSkinId: player.cosmeticSkinId || null,
      cosmeticAccessoryId: player.cosmeticAccessoryId || null,
      companionId: player.companions?.equipped || null,
    });
    if (other.ready) safeSend(player.ws, {
      type: 'playerJoinLocation',
      id: other.id,
      nickname: other.nickname,
      factionSymbol: other.displayedFactionSymbol,
      factionImage: other.displayedFactionImage,
      position: other.position,
      rotation: other.rotation,
      pitch: other.pitch,
      headYaw: other.headYaw,
      state: other.state || 'idle',
      jumping: other.jumping || false,
      velocityY: other.velocityY || 0,
      health: other.health,
      alive: other.alive,
      weaponEquipped: other.weaponEquipped,
      isShooting: other.isShooting,
      locationId: other.locationId,
      isAdmin: !!other.isAdmin,
      isFactionCreator: !!other.isFactionCreator,
      companionId: other.companions?.equipped || null,
      skinTextureUrl: other.skinTextureUrl || null,
      cosmeticSkinId: other.cosmeticSkinId || null,
      cosmeticAccessoryId: other.cosmeticAccessoryId || null,
    });
  });
}

function setPlayerLoading(player) {
  player.ready = false;
  if (player.readyTimer) clearTimeout(player.readyTimer);
  player.readyTimer = setTimeout(() => markPlayerReady(player), CLIENT_READY_TIMEOUT_MS);
}

function markPlayerReady(player) {
  if (player.readyTimer) {
    clearTimeout(player.readyTimer);
    player.readyTimer = null;
  }
  if (player.ready || !player.authenticated) return;

  player.ready = true;

  for (const id of player.aoiNeighbors) {
    const other = players.get(id);
    if (!other) continue;
    safeSend(other.ws, buildPlayerJoinPayload(player));
  }
}

function isInProtectedZone(player) {
  if (player.locationId === 'tower-main-hall') return true;
  if (player.locationId === EVENTS_LOBBY_ID) return true;
  if (player.locationId === 'main-world') {
    const [x, , z] = player.position;
    return Math.sqrt(x * x + z * z) <= MAIN_WORLD_SAFE_RADIUS;
  }
  return false;
}

function isSpawnProtected(player) {
  return !!player.invulnerableUntil && Date.now() < player.invulnerableUntil;
}

function grantSpawnProtection(player, durationMs = SPAWN_PROTECTION_MS) {
  player.invulnerableUntil = Date.now() + durationMs;
  safeSend(player.ws, { type: 'spawnProtection', untilMs: player.invulnerableUntil, durationMs });
}

function clearSpawnProtection(player) {
  if (!player.invulnerableUntil) return;
  player.invulnerableUntil = 0;
  safeSend(player.ws, { type: 'spawnProtection', untilMs: 0, durationMs: 0 });
}

function isInCombat(player) {
  return !!player && !!player.combatUntil && Date.now() < player.combatUntil;
}

function markInCombat(player) {
  if (!player || !player.authenticated || !player.alive) return;

  const now = Date.now();
  const wasInCombat = player.combatUntil > now;
  player.combatUntil = now + COMBAT_MODE_MS;
  cancelHomeTeleport(player, 'in_combat');

  if (wasInCombat && now - player.combatStateSentAt < COMBAT_STATE_THROTTLE_MS) return;

  player.combatStateSentAt = now;
  safeSend(player.ws, { type: 'combatState', until: player.combatUntil });
}

function clearCombat(player) {
  if (!player.combatUntil) return;
  player.combatUntil = 0;
  player.combatStateSentAt = 0;
  safeSend(player.ws, { type: 'combatState', until: 0 });
}

function spawnInSafeZone(player, locationId) {
  const target = locationId || player.locationId;
  if (typeof target === 'string' && (target.startsWith('faction-gate-') || target.startsWith(PLAYER_ROOM_PREFIX))) {
    player.position = [0, 0, 4];
    return;
  }
  if (target === GALAXY_LOCATION_ID) {
    player.position = [...GALAXY_SPAWN];
    return;
  }
  if (target === CAVE_LOCATION_ID) {
    player.position = [0, 0, 2];
    return;
  }
  if (target === INFLUENCE_LOCATION_ID) {
    const spot = pickInfluenceSpawn(player);
    player.position = [spot[0], influenceGeometry.FLOOR_Y, spot[2]];
    return;
  }
  const eventRoom = EVENT_ROOMS[target];
  if (eventRoom) {
    const spread = 5;
    player.position = [
      eventRoom.spawn[0] + (Math.random() - 0.5) * spread,
      eventRoom.spawn[1],
      eventRoom.spawn[2] + (Math.random() - 0.5) * spread,
    ];
    return;
  }
  const angle = Math.random() * Math.PI * 2;
  const maxRadius = getLocationMaxRadius(target);
  const spread = maxRadius == null ? 25 : Math.min(25, Math.max(0, maxRadius - 6));
  const r = spread <= 0 ? 0 : spread * (0.4 + Math.random() * 0.6);
  player.position = [Math.cos(angle) * r, 0, Math.sin(angle) * r];
}

function broadcastToLocation(locationId, data, excludeId = null, instance = null) {
  const message = getCachedMessage(data);
  players.forEach((p, id) => {
    if (id === excludeId) return;
    if (!p.authenticated || p.ws.readyState !== WebSocket.OPEN) return;
    if (p.locationId !== locationId) return;
    if (instance !== null && p.instance !== instance && isShardedLocation(locationId)) return;
    try {
      p.ws.send(message);
    } catch (err) {
      console.error('[!] Broadcast error:', err.message);
    }
  });
}

function isShardedLocation(locationId) {
  if (typeof locationId !== 'string') return false;
  if (locationId === influence.INFLUENCE_LOCATION_ID) return false;
  return !PRIVATE_LOCATION_PREFIXES.some((prefix) => locationId.startsWith(prefix));
}

function shardOccupancy(locationId) {
  const counts = new Map();
  players.forEach((p) => {
    if (!p.authenticated || p.locationId !== locationId) return;
    counts.set(p.instance, (counts.get(p.instance) || 0) + 1);
  });
  return counts;
}

function countShardPlayers(locationId, instance) {
  return shardOccupancy(locationId).get(instance) || 0;
}

function listShards(locationId) {
  const counts = shardOccupancy(locationId);

  const highest = counts.size > 0 ? Math.max(...counts.keys()) : 1;
  const shards = [];
  for (let i = 1; i <= Math.max(1, highest); i++) {
    shards.push({ instance: i, count: counts.get(i) || 0 });
  }
  return shards;
}

function partyShardFor(player, locationId) {
  const group = party.partyOf(player.id);
  if (!group) return null;

  for (const id of group.memberIds) {
    if (id === player.id) continue;
    const member = players.get(id);
    if (member && member.authenticated && member.locationId === locationId) return member.instance;
  }
  return null;
}

const caveSeatReservations = new Map();

function shardCapacityFor(locationId) {
  if (locationId === CAVE_LOCATION_ID) return CAVE_SHARD_CAPACITY;
  if (locationId === INFLUENCE_LOCATION_ID) return influence.INFLUENCE_CONFIG.capacity;
  return SHARD_CAPACITY;
}

function caveReservedSeats(instance, partyId) {
  const held = caveSeatReservations.get(instance);
  if (!held) return 0;
  if (held.until < Date.now()) {
    caveSeatReservations.delete(instance);
    return 0;
  }
  return held.partyId === partyId ? 0 : held.seats;
}

function consumeCaveSeat(player) {
  const held = caveSeatReservations.get(player.instance);
  if (!held) return;

  const group = party.partyOf(player.id);
  if (!group || held.partyId !== group.id) return;

  held.seats -= 1;
  if (held.seats <= 0) caveSeatReservations.delete(player.instance);
}

function cavePartyPending(player) {
  const group = party.partyOf(player.id);
  if (!group) return 0;

  return group.memberIds.filter((id) => {
    if (id === player.id) return false;
    const member = players.get(id);
    return member && member.authenticated && member.locationId !== CAVE_LOCATION_ID;
  }).length;
}

function caveSeatsNeeded(player, instance, partyId) {
  const held = caveSeatReservations.get(instance);
  if (held && held.until >= Date.now() && partyId && held.partyId === partyId) return 1;
  return 1 + cavePartyPending(player);
}

function reserveCaveSeats(player) {
  const group = party.partyOf(player.id);
  if (!group) return;

  const pending = cavePartyPending(player);

  if (pending <= 0) {
    const held = caveSeatReservations.get(player.instance);
    if (held && held.partyId === group.id) caveSeatReservations.delete(player.instance);
    return;
  }

  caveSeatReservations.set(player.instance, {
    partyId: group.id,
    seats: pending,
    until: Date.now() + CAVE_PARTY_RESERVATION_MS,
  });
}

function pickShard(locationId, requestedInstance, player = null) {
  if (!isShardedLocation(locationId)) return 1;

  const counts = shardOccupancy(locationId);
  const capacity = shardCapacityFor(locationId);
  const hardCap = locationId === CAVE_LOCATION_ID;
  const partyId = player ? party.partyOf(player.id)?.id ?? null : null;
  const taken = (instance) =>
    (counts.get(instance) || 0) + (hardCap ? caveReservedSeats(instance, partyId) : 0);

  const fits = (instance) =>
    hardCap
      ? taken(instance) + caveSeatsNeeded(player, instance, partyId) <= capacity
      : taken(instance) < capacity;

  if (Number.isInteger(requestedInstance) && requestedInstance >= 1 && requestedInstance <= MAX_SHARDS) {
    if (hardCap) {
      if (fits(requestedInstance)) return requestedInstance;
    } else if (taken(requestedInstance) < capacity + SHARD_FRIEND_GRACE) {
      return requestedInstance;
    }
  }

  for (let i = 1; i <= MAX_SHARDS; i++) {
    if (fits(i)) return i;
  }
  return MAX_SHARDS;
}

function sendLocationSync(player) {
  safeSend(player.ws, {
    type: 'locationSync',
    locationId: player.locationId,
    instance: player.instance,
    position: player.position,
  });
}

function sendShardState(player) {
  if (!isShardedLocation(player.locationId)) return;
  safeSend(player.ws, {
    type: 'shardState',
    locationId: player.locationId,
    instance: player.instance,
    capacity: SHARD_CAPACITY,
    shards: listShards(player.locationId),
  });
}

function broadcastShardState(locationId) {
  if (!isShardedLocation(locationId)) return;
  const shards = listShards(locationId);
  players.forEach((p) => {
    if (!p.authenticated || p.locationId !== locationId) return;
    safeSend(p.ws, {
      type: 'shardState',
      locationId,
      instance: p.instance,
      capacity: SHARD_CAPACITY,
      shards,
    });
  });
}

const TNJ_MINT = process.env.TNJ_TOKEN_MINT_ADDRESS || '';

const WORLD_WALL_TIERS = [
  { mc: 0, radius: 44 },
  { mc: 25000, radius: 68 },
  { mc: 60000, radius: 92 },
  { mc: 120000, radius: 116 },
  { mc: 200000, radius: 140 },
  { mc: 320000, radius: 168 },
  { mc: 500000, radius: 200 },
  { mc: 750000, radius: 400 },
  { mc: 1000000, radius: null },
];

const WORLD_WALL_MAX_TIER = WORLD_WALL_TIERS.length - 1;

const WORLD_UNLOCKS = [
  { id: 'lakes', mc: 200000 },
  { id: 'rift', mc: 500000 },
  { id: 'port', mc: 500000 },
  { id: 'tower', mc: 750000 },
];

const CAVE_PORTAL_MIN_MC = 500000;

const WALL_TIER_ENV = process.env.WORLD_WALL_TIER && Number.isFinite(Number(process.env.WORLD_WALL_TIER))
  ? Math.max(0, Math.min(WORLD_WALL_TIERS.length - 1, Math.floor(Number(process.env.WORLD_WALL_TIER))))
  : null;
const WORLD_MC_POLL_MS = 60000;
const WORLD_COMMAND_POLL_MS = 15000;
const ADMIN_COMMAND_POLL_MS = 5000;
const WORLD_PERSIST_DEBOUNCE_MS = 2000;
const WALL_STAND_CLEARANCE = 2.2;

const worldState = {
  mc: 0,
  mcPeak: 0,
  tier: 0,
  adminTier: null,
  portal: { status: 'locked', x: 0, z: 0, cooldownUntil: 0, spawnedAt: 0 },
  lastCommandId: null,
  loaded: false,
};

let worldPersistTimer = null;

function wallTierForMc(mc) {
  let tier = 0;
  for (let i = 0; i < WORLD_WALL_TIERS.length; i++) {
    if (mc >= WORLD_WALL_TIERS[i].mc) tier = i;
  }
  return tier;
}

function effectiveWallTier() {
  if (WALL_TIER_ENV !== null) return WALL_TIER_ENV;
  if (worldState.adminTier !== null) {
    return Math.max(0, Math.min(WORLD_WALL_MAX_TIER, worldState.adminTier));
  }
  return Math.max(0, Math.min(WORLD_WALL_MAX_TIER, worldState.tier));
}

function wallRadius() {
  return WORLD_WALL_TIERS[effectiveWallTier()].radius;
}

function nextWallTierMc() {
  const tier = effectiveWallTier();
  if (tier >= WORLD_WALL_MAX_TIER) return null;
  return WORLD_WALL_TIERS[tier + 1].mc;
}

function mainWorldPlayerLimit() {
  const radius = wallRadius();
  return radius === null ? null : radius + WALL_STAND_CLEARANCE;
}

function authenticatedPlayerCount() {
  let count = 0;
  players.forEach((p) => {
    if (p.authenticated) count++;
  });
  return count;
}

function buildWorldStatusPayload() {
  const tier = effectiveWallTier();

  return {
    type: 'worldStatus',
    mc: worldState.mc,
    mcPeak: worldState.mcPeak,
    tier,
    maxTier: WORLD_WALL_MAX_TIER,
    radius: WORLD_WALL_TIERS[tier].radius,
    tierMc: WORLD_WALL_TIERS[tier].mc,
    nextTierMc: nextWallTierMc(),
    portal: {
      status: worldState.portal.status,
      x: worldState.portal.x,
      z: worldState.portal.z,
      cooldownUntil: worldState.portal.cooldownUntil,
    },
    monster: { id: 'redwick', status: 'dormant', nextWindowAt: null },
    unlocks: WORLD_UNLOCKS.map((entry) => ({
      id: entry.id,
      mc: entry.mc,
      unlocked: WORLD_WALL_TIERS[tier].mc >= entry.mc,
    })),
    traders: authenticatedPlayerCount(),
  };
}

function broadcastWorldStatus() {
  const message = getCachedMessage(buildWorldStatusPayload());

  players.forEach((p) => {
    if (!p.authenticated || p.ws.readyState !== WebSocket.OPEN) return;
    try {
      p.ws.send(message);
    } catch (err) {
      console.error('[!] World status send error:', err.message);
    }
  });
}

function persistWorldState(immediate = false) {
  if (!CONFIG.internalSecret) return;
  if (worldPersistTimer) {
    if (!immediate) return;
    clearTimeout(worldPersistTimer);
  }

  worldPersistTimer = setTimeout(() => {
    worldPersistTimer = null;
    callInternalApi('/api/internal/game/world-state', {
      action: 'patch',
      state: {
        mc: worldState.mc,
        mcPeak: worldState.mcPeak,
        tier: worldState.tier,
        adminTier: worldState.adminTier,
        portal: worldState.portal,
        lastCommandId: worldState.lastCommandId,
      },
    }).catch((err) => console.error('[World] Persist failed:', err.message));
  }, immediate ? 0 : WORLD_PERSIST_DEBOUNCE_MS);
}

function pullPlayersInsideWall() {
  const limit = mainWorldPlayerLimit();
  if (limit === null) return;

  players.forEach((player) => {
    if (!player.authenticated || player.locationId !== 'main-world') return;

    const [x, , z] = player.position;
    if (Math.sqrt(x * x + z * z) <= limit) return;

    spawnInSafeZone(player, 'main-world');
    player.justTeleported = true;
    player.teleportSettleUntil = Date.now() + TELEPORT_SETTLE_MS;
    grantSpawnProtection(player);
    safeSend(player.ws, { type: 'positionCorrection', position: player.position });
  });
}

function applyMarketCap(mc) {
  if (!Number.isFinite(mc) || mc <= 0) return;

  const previousTier = effectiveWallTier();
  worldState.mc = mc;
  if (mc > worldState.mcPeak) worldState.mcPeak = mc;

  const peakTier = wallTierForMc(worldState.mcPeak);
  if (peakTier > worldState.tier) worldState.tier = peakTier;

  persistWorldState();

  if (effectiveWallTier() !== previousTier) {
    console.log(`[World] Wall tier ${previousTier} -> ${effectiveWallTier()} (mc ${Math.round(mc)})`);
    pullPlayersInsideWall();
    rebuildWorldEnemies();
  }

  broadcastWorldStatus();
}

async function fetchTokenMarketCap(address) {
  const url = new URL('/api/token-by-ca', CONFIG.siteUrl);
  url.searchParams.set('ca', address);

  const res = await fetch(url.toString());
  const json = await res.json();
  return Number(json?.mc) || 0;
}

let marketCapWarned = false;

async function pollMarketCap() {
  if (!TNJ_MINT) {
    if (!marketCapWarned) {
      marketCapWarned = true;
      console.error('[World] TNJ_MINT is not configured — market cap stays at its last saved value');
    }
    return;
  }

  try {
    const mc = await fetchTokenMarketCap(TNJ_MINT);
    if (!Number.isFinite(mc) || mc <= 0) {
      if (!marketCapWarned) {
        marketCapWarned = true;
        console.error(`[World] token-by-ca returned no usable market cap for ${TNJ_MINT} — keeping ${Math.round(worldState.mc)}`);
      }
      return;
    }

    marketCapWarned = false;
    applyMarketCap(mc);
  } catch (err) {
    console.error('[World] Market cap poll failed:', err.message);
  }
}

function applyWorldCommand(command) {
  const previousTier = effectiveWallTier();

  if (command.type === 'set_tier') {
    worldState.adminTier = Math.max(0, Math.min(WORLD_WALL_MAX_TIER, Math.floor(Number(command.tier) || 0)));
  } else if (command.type === 'clear_tier') {
    worldState.adminTier = null;
  } else if (command.type === 'force_portal') {
    console.log('[World] Admin forced a rift spawn');
    spawnCavePortal(true);
    return;
  }

  persistWorldState(true);

  if (effectiveWallTier() !== previousTier) {
    console.log(`[World] Admin set wall tier ${previousTier} -> ${effectiveWallTier()}`);
    pullPlayersInsideWall();
    rebuildWorldEnemies();
  }

  broadcastWorldStatus();
}

function playerByUserId(userId) {
  for (const player of players.values()) {
    if (player.authenticated && player.userId === userId) return player;
  }
  return null;
}

function touchAdminEconomy(player) {
  player.economyChangedAt = Date.now();
  safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });

  if (!CONFIG.internalSecret) return;

  // Re-stamping once the row is written keeps the periodic status pull from
  // reading a value the save had not reached yet and undoing the change.
  const saved = queuePlayerSave(player, buildSavePayload(player));
  if (saved && typeof saved.then === 'function') {
    saved.then(() => { player.economyChangedAt = Date.now(); }).catch(() => { });
  }
}

function applyAdminLevel(player, level, totalXp) {
  const state = player.progression;
  const previousLevel = state.level;

  state.totalXp = Math.max(0, Math.floor(totalXp));
  state.level = progression.levelFromTotalXp(state.totalXp).level;

  const validated = skills.validateBuild(state.skills, state.level, state.branch, progression.skillPointsForLevel(state.level));
  state.skills = validated.ranks;

  refreshCombatStats(player);
  sendProgressionState(player);

  if (state.level !== previousLevel) broadcastPlayerLevel(player);
  persistPlayer(player);

  console.log(`[Admin] ${player.nickname} level ${previousLevel} -> ${state.level} by admin command`);
}

function applyAdminInventoryRemoval(player, slot) {
  if (slot < 0 || slot >= player.inventory.length) return;

  const [removed] = player.inventory.splice(slot, 1);
  safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });
  persistPlayer(player);

  console.log(`[Admin] ${player.nickname} lost ${removed?.symbol || 'item'} from slot ${slot} by admin command`);
}

function applyAdminProgressionReset(player) {
  const state = player.progression;
  const previousLevel = state.level;

  state.totalXp = 0;
  state.level = 1;
  state.branch = null;
  state.skills = {};
  state.loadout = {};
  state.respecCount = 0;

  refreshCombatStats(player);
  sendProgressionState(player);
  if (previousLevel !== 1) broadcastPlayerLevel(player);
  persistPlayer(player);
}

function applyAdminStatisticsReset(player) {
  player.stats.kills = 0;
  player.stats.deaths = 0;
  player.stats.shotsFired = 0;
  player.stats.buildingsPlaced = 0;
  player.stats.playtimeSeconds = 0;
  player.sessionStart = Date.now();
  persistPlayer(player);
}

function applyAdminSkinReset(player) {
  if (!player.skinTextureUrl) return;

  player.skinTextureUrl = null;
  player.skinTextureUrlChangedAt = Date.now();
  broadcast({ type: 'skinUpdate', playerId: player.id, url: null }, null, true, player);
  safeSend(player.ws, { type: 'skinUpdate', playerId: player.id, url: null });
  persistPlayer(player);
}

const ADMIN_COMMAND_PROTOCOL = 2;
const ADMIN_APPLIED_TTL_MS = 10 * 60 * 1000;
const appliedAdminCommands = new Map();

function rememberAdminCommand(id) {
  const now = Date.now();
  appliedAdminCommands.set(id, now);
  if (appliedAdminCommands.size > 500) {
    appliedAdminCommands.forEach((at, key) => {
      if (now - at > ADMIN_APPLIED_TTL_MS) appliedAdminCommands.delete(key);
    });
  }
}

// Deltas are applied to the live copy and saved straight away. The website never
// writes these fields while the session owns them, so nothing here can be undone
// by the next autosave and nothing the player earned is rolled back.
function applyAdminCommand(command) {
  const op = command && command.op;
  if (!op || typeof op.kind !== 'string') return 'skipped';

  if (appliedAdminCommands.has(command.id)) return 'applied';

  const player = playerByUserId(command.userId);
  if (!player || !player.authenticated) return 'skipped';

  const int = (value) => {
    const parsed = Math.trunc(Number(value));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  switch (op.kind) {
    case 'ashDelta': {
      player.ash = Math.max(0, player.ash + int(op.delta));
      touchAdminEconomy(player);
      break;
    }
    case 'ashSet': {
      player.ash = Math.max(0, int(op.value));
      touchAdminEconomy(player);
      break;
    }
    case 'placeableDelta': {
      const itemId = String(op.itemId || '');
      if (!itemId) return 'skipped';
      const current = Math.max(0, int(player.placeables[itemId]));
      const next = Math.max(0, current + int(op.delta));
      if (next > 0) player.placeables[itemId] = next;
      else delete player.placeables[itemId];
      touchAdminEconomy(player);
      break;
    }
    case 'placeablesSet': {
      const source = op.placeables && typeof op.placeables === 'object' ? op.placeables : {};
      const next = {};
      for (const [itemId, amount] of Object.entries(source)) {
        const value = Math.max(0, int(amount));
        if (value > 0) next[itemId] = value;
      }
      player.placeables = next;
      touchAdminEconomy(player);
      break;
    }
    case 'placeablesEnsure': {
      const minimums = op.minimums && typeof op.minimums === 'object' ? op.minimums : {};
      for (const [itemId, minimum] of Object.entries(minimums)) {
        const target = Math.max(0, int(minimum));
        if (target <= 0) continue;
        const current = Math.max(0, int(player.placeables[itemId]));
        if (target > current) player.placeables[itemId] = target;
      }
      touchAdminEconomy(player);
      break;
    }
    case 'storageClear': {
      player.storage = {};
      player.storageOrphan = [];
      touchAdminEconomy(player);
      break;
    }
    case 'inventoryClear': {
      player.inventory = [];
      touchAdminEconomy(player);
      break;
    }
    case 'inventoryRemoveSlot': {
      applyAdminInventoryRemoval(player, int(op.slot));
      break;
    }
    case 'progressionSet': {
      applyAdminLevel(player, int(op.level), int(op.totalXp));
      break;
    }
    case 'progressionReset': {
      applyAdminProgressionReset(player);
      break;
    }
    case 'statisticsReset': {
      applyAdminStatisticsReset(player);
      break;
    }
    case 'skinReset': {
      applyAdminSkinReset(player);
      break;
    }
    default:
      return 'skipped';
  }

  rememberAdminCommand(command.id);
  console.log(`[Admin] ${player.nickname || player.userId} <- ${op.kind}`);
  return 'applied';
}

function onlineUserIds() {
  const ids = [];
  players.forEach((player) => {
    if (player.authenticated && player.userId) ids.push(player.userId);
  });
  return ids;
}

async function pollAdminCommands() {
  if (!CONFIG.internalSecret) return;
  if (players.size === 0) return;

  const result = await callInternalApi('/api/internal/game/admin-commands', {
    protocol: ADMIN_COMMAND_PROTOCOL,
    onlineUserIds: onlineUserIds(),
  }).catch((err) => {
    console.error('[Admin] Command poll failed:', err.message);
    return null;
  });

  if (!Array.isArray(result?.commands) || result.commands.length === 0) return;

  const ack = [];
  const skipped = [];
  const touched = new Set();

  for (const command of result.commands) {
    if (!command || typeof command.id !== 'string') continue;
    try {
      if (applyAdminCommand(command) === 'applied') {
        ack.push(command.id);
        touched.add(command.userId);
      } else {
        skipped.push(command.id);
      }
    } catch (err) {
      console.error('[Admin] Command failed:', err.message);
      skipped.push(command.id);
    }
  }

  if (ack.length === 0 && skipped.length === 0) return;

  // Acknowledging only once the row is written means a crash between applying
  // and saving leaves the command queued, so it is replayed rather than lost.
  const writes = [];
  touched.forEach((userId) => {
    const target = playerByUserId(userId);
    if (target && target.saveQueue && typeof target.saveQueue.then === 'function') {
      writes.push(target.saveQueue.catch(() => { }));
    }
  });
  if (writes.length > 0) await Promise.all(writes);

  // Anything this server could not place lands back on the website so it can be
  // written to the row instead of waiting for a session that is already gone.
  await callInternalApi('/api/internal/game/admin-commands', {
    protocol: ADMIN_COMMAND_PROTOCOL,
    ackOnly: true,
    ack,
    skipped,
  }).catch((err) => console.error('[Admin] Command ack failed:', err.message));
}

async function pollWorldCommands() {
  if (!CONFIG.internalSecret) return;

  const result = await callInternalApi('/api/internal/game/world-state', { action: 'get' }).catch((err) => {
    console.error('[World] Command poll failed:', err.message);
    return null;
  });

  const command = result?.state?.command;
  if (!command || typeof command.id !== 'string') return;
  if (command.id === worldState.lastCommandId) return;

  worldState.lastCommandId = command.id;
  applyWorldCommand(command);
}

async function loadWorldState() {
  if (!CONFIG.internalSecret) {
    worldState.loaded = true;
    return;
  }

  const result = await callInternalApi('/api/internal/game/world-state', { action: 'get' }).catch((err) => {
    console.error('[World] Load failed:', err.message);
    return null;
  });

  const state = result?.state;
  if (state) {
    worldState.mc = Math.max(0, Number(state.mc) || 0);
    worldState.mcPeak = Math.max(0, Number(state.mcPeak) || 0);
    worldState.tier = Math.max(0, Math.floor(Number(state.tier) || 0));
    worldState.adminTier = state.adminTier === null || state.adminTier === undefined
      ? null
      : Math.max(0, Math.floor(Number(state.adminTier) || 0));
    worldState.lastCommandId = typeof state.lastCommandId === 'string' ? state.lastCommandId : null;

    if (state.portal) {
      worldState.portal.status = state.portal.status || 'locked';
      worldState.portal.x = Number(state.portal.x) || 0;
      worldState.portal.z = Number(state.portal.z) || 0;
      worldState.portal.cooldownUntil = Number(state.portal.cooldownUntil) || 0;
      worldState.portal.spawnedAt = Number(state.portal.spawnedAt) || 0;
    }
  }

  worldState.loaded = true;
  console.log(`[World] Loaded: tier ${effectiveWallTier()}, radius ${wallRadius()}, mcPeak ${Math.round(worldState.mcPeak)}`);
  rebuildWorldEnemies();
  broadcastWorldStatus();
}

const CAVE_PORTAL_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const PORTAL_MIN_RING_GAP = 12;
const PORTAL_SAFE_MARGIN = 8;
const PORTAL_NEAR_BASE_SPAN = 26;
const PORTAL_MAX_SLOPE = 0.32;
const PORTAL_EDGE_SLOPE = 0.42;
const PORTAL_SAMPLE_ATTEMPTS = 500;

function portalUnlocked() {
  return WORLD_WALL_TIERS[effectiveWallTier()].mc >= CAVE_PORTAL_MIN_MC;
}

function portalSpotValid(x, z) {
  if (!worldTerrain.isDryLand(x, z, 1.5)) return false;
  if (worldTerrain.getSlopeAt(x, z) > PORTAL_MAX_SLOPE) return false;
  if (Math.hypot(x - worldTerrain.TOWER_X, z - worldTerrain.TOWER_Z) < worldTerrain.TOWER_FLAT_RADIUS + 6) return false;

  for (const [ox, oz] of [[4, 0], [-4, 0], [0, 4], [0, -4]]) {
    if (!worldTerrain.isDryLand(x + ox, z + oz, 1)) return false;
    if (worldTerrain.getSlopeAt(x + ox, z + oz) > PORTAL_EDGE_SLOPE) return false;
  }

  return true;
}

function pickPortalPosition(nearBase) {
  const wall = wallRadius();
  const outer = wall === null ? worldTerrain.PLAY_RADIUS - 24 : wall - PORTAL_MIN_RING_GAP;
  const inner = worldTerrain.SAFE_ZONE_RADIUS + PORTAL_SAFE_MARGIN;
  const max = nearBase ? Math.min(outer, inner + PORTAL_NEAR_BASE_SPAN) : outer;

  if (max <= inner) return null;

  for (let attempt = 0; attempt < PORTAL_SAMPLE_ATTEMPTS; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const distance = inner + Math.sqrt(Math.random()) * (max - inner);
    const x = Math.sin(angle) * distance;
    const z = -Math.cos(angle) * distance;

    if (!portalSpotValid(x, z)) continue;
    return [Math.round(x * 100) / 100, Math.round(z * 100) / 100];
  }

  return null;
}

function spawnCavePortal(nearBase) {
  const spot = pickPortalPosition(nearBase);
  if (!spot) {
    console.error('[World] Could not find a valid rift location');
    return false;
  }

  worldState.portal.status = 'active';
  worldState.portal.x = spot[0];
  worldState.portal.z = spot[1];
  worldState.portal.spawnedAt = Date.now();
  worldState.portal.cooldownUntil = 0;

  console.log(`[World] Rift opened at ${spot[0]}, ${spot[1]}`);
  persistWorldState(true);
  broadcastWorldStatus();
  return true;
}

function closeCavePortal() {
  if (worldState.portal.status !== 'active') return;

  worldState.portal.status = 'cooldown';
  worldState.portal.cooldownUntil = Date.now() + CAVE_PORTAL_COOLDOWN_MS;

  console.log('[World] Rift collapsed, cooldown started');
  persistWorldState(true);
  broadcastWorldStatus();
}

function updatePortalState() {
  if (!worldState.loaded) return;

  if (!portalUnlocked()) {
    if (worldState.portal.status === 'locked') return;
    worldState.portal.status = 'locked';
    worldState.portal.cooldownUntil = 0;
    persistWorldState(true);
    broadcastWorldStatus();
    return;
  }

  if (worldState.portal.status === 'active') return;
  if (worldState.portal.status === 'cooldown' && Date.now() < worldState.portal.cooldownUntil) return;

  spawnCavePortal(false);
}

loadWorldState().then(() => {
  updatePortalState();
  return pollMarketCap();
});

setTimeout(() => {
  loadInfluenceState().catch((err) => console.error('[Influence] load error:', err.message));
}, 0);

safeInterval(pollMarketCap, WORLD_MC_POLL_MS);
safeInterval(pollWorldCommands, WORLD_COMMAND_POLL_MS);
safeInterval(updatePortalState, WORLD_COMMAND_POLL_MS);
safeInterval(pollAdminCommands, ADMIN_COMMAND_POLL_MS);

// From this segment the biome boss also walks the combat stretch as an ordinary
// enemy. Only player.canyon.bossId opens the gate, so these never end the run.
const CANYON_ROAMING_BOSS_FROM = 6;
const CANYON_ROAMING_BOSS_MAX = 4;
const CANYON_RANGED_BOSS_FROM = 6;

function canyonRoamingBossCount(segment) {
  if (segment < CANYON_ROAMING_BOSS_FROM) return 0;
  return Math.min(CANYON_ROAMING_BOSS_MAX, 1 + Math.floor((segment - CANYON_ROAMING_BOSS_FROM) / 3));
}

function canyonSegmentBossType(segment, biome) {
  return segment >= CANYON_RANGED_BOSS_FROM ? 'slime_seer' : biome.boss;
}

function getSegmentDifficulty(segment) {
  const beyond = Math.max(0, segment - CANYON_BIOMES.length);
  const healthMult = 1 + beyond * 0.2;
  const damageMult = 1 + beyond * 0.15;
  const biome = canyonBiomeFor(segment);
  const mobCount = Math.min(biome.mobCount + beyond * 2, 26);
  return { healthMult, damageMult, mobCount };
}

function canyonPathOffsetX(z) {
  if (z <= CANYON_START_Z) return 0;
  const rel = z - CANYON_START_Z;
  return Math.sin(rel * 0.008) * 22 + Math.sin(rel * 0.021 + 1.7) * 9;
}

function canyonHalfWidthAt(z) {
  if (z <= CANYON_START_Z) return CANYON_HALF_WIDTH;
  const rel = z - CANYON_START_Z;
  return Math.max(25, CANYON_HALF_WIDTH + Math.sin(rel * 0.006 + 0.5) * 15);
}

function randomCanyonCombatPoint(segment) {
  const start = canyonSegmentStartZ(segment) + CANYON_SAFE_ENTRANCE_DEPTH;
  const end = start + CANYON_COMBAT_DEPTH;
  const z = start + Math.random() * (end - start);
  const x = canyonPathOffsetX(z) + (Math.random() * 2 - 1) * (canyonHalfWidthAt(z) - 6);
  return [x, 0, z];
}

function randomCanyonBossPoint(segment) {
  const start = canyonSegmentStartZ(segment) + CANYON_SAFE_ENTRANCE_DEPTH + CANYON_COMBAT_DEPTH;
  const end = canyonSegmentStartZ(segment) + CANYON_SEGMENT_LENGTH - 10;
  const z = start + Math.random() * (end - start);
  const x = canyonPathOffsetX(z) + (Math.random() * 2 - 1) * (canyonHalfWidthAt(z) - 10);
  return [x, 0, z];
}

function canyonSegmentEntrancePosition(segment) {
  const z = canyonSegmentStartZ(segment) + 10;
  return [canyonPathOffsetX(z), 0, z];
}

function canyonReturnPadPosition(segment) {
  const z = canyonSegmentStartZ(segment) + CANYON_SAFE_ENTRANCE_DEPTH + CANYON_COMBAT_DEPTH + CANYON_RETURN_PAD_OFFSET;
  return [canyonPathOffsetX(z), 0, z];
}

function spawnCanyonEnemy(player, type, position, healthMult = 1, damageMult = 1) {
  const cfg = ENEMY_TYPES[type];
  const id = `canyon-${player.id}-${player.canyon.nextEnemySeq++}`;
  const maxHealth = Math.round(cfg.maxHealth * healthMult);
  player.canyon.enemies.set(id, {
    id,
    type,
    position: [...position],
    spawnPoint: [...position],
    health: maxHealth,
    maxHealth,
    attackDamage: Math.round(cfg.attackDamage * damageMult),
    alive: true,
    targetId: null,
    lastAttackTime: 0,
    patrolTarget: null,
    patrolWaitUntil: 0,
    positionHistory: [],
    cast: null,
    attackCooldowns: {},
    pendingImpacts: [],
    pools: [],
    wave: null,
    waveStartedAt: 0,
    provokedBy: null,
    provokedUntil: 0,
    lastHitAt: 0,
  });
  return id;
}

function preparePlayerEnemiesForSegment(player, segment) {
  player.canyon.segment = segment;
  player.canyon.runCleared = false;
  player.canyon.enemies.clear();
  clearCanyonLoot(player);

  const { healthMult, damageMult, mobCount } = getSegmentDifficulty(segment);
  const biome = canyonBiomeFor(segment);
  for (let i = 0; i < mobCount; i++) {
    spawnCanyonEnemy(player, biome.mob, randomCanyonCombatPoint(segment), healthMult, damageMult);
  }

  const roamingBosses = canyonRoamingBossCount(segment);
  for (let i = 0; i < roamingBosses; i++) {
    spawnCanyonEnemy(player, biome.boss, randomCanyonCombatPoint(segment), healthMult, damageMult);
  }

  const bossType = canyonSegmentBossType(segment, biome);
  player.canyon.bossId = spawnCanyonEnemy(player, bossType, randomCanyonBossPoint(segment), healthMult, damageMult);
}

function populateCanyonSegment(player, segment) {
  player.canyon.inHub = false;
  cancelHomeTeleport(player, 'canyon');
  clearPlayerAbilityBuffs(player, true);
  preparePlayerEnemiesForSegment(player, segment);
  player.position = canyonSegmentEntrancePosition(segment);
  player.justTeleported = true;
  player.teleportSettleUntil = Date.now() + TELEPORT_SETTLE_MS;
  grantSpawnProtection(player);

  safeSend(player.ws, {
    type: 'canyonSegment',
    segment,
    maxSegmentReached: player.canyon.maxSegmentReached,
    cleared: player.canyon.clearedSegments.has(segment),
    name: canyonSegmentName(segment),
    biome: canyonBiomeFor(segment).key,
  });
  safeSend(player.ws, { type: 'enemyState', enemies: serializeCanyonEnemies(player) });
  sendCrateState(player);
}

function enterCanyonHub(player) {
  player.canyon.inHub = true;
  player.canyon.runCleared = false;
  clearPlayerAbilityBuffs(player, true);
  player.canyon.enemies.clear();
  clearCanyonLoot(player);
  player.position = [...CANYON_HUB_POSITION];
  player.justTeleported = true;
  player.teleportSettleUntil = Date.now() + TELEPORT_SETTLE_MS;
  grantSpawnProtection(player);

  safeSend(player.ws, {
    type: 'canyonHub',
    maxSegmentReached: player.canyon.maxSegmentReached,
  });
  safeSend(player.ws, { type: 'enemyState', enemies: [] });
  sendCrateState(player);
}

function activeEnemiesFor(player) {
  if (player.locationId === ARENA_LOCATION_ID) return arena.runForPlayer(player.id)?.enemies ?? null;
  if (player.locationId === 'tower-first-floor') return player.canyon?.enemies ?? null;
  if (player.locationId === CAVE_LOCATION_ID) return caveInstances.get(player.instance)?.enemies ?? null;
  if (player.locationId === INFLUENCE_LOCATION_ID) return influenceRun?.enemies ?? null;
  if (player.locationId === 'main-world') return worldEnemies.get(player.instance) ?? null;
  return null;
}

function serializeEnemies(enemies) {
  if (!enemies) return [];
  return Array.from(enemies.values()).map((e) => ({
    id: e.id,
    type: e.type,
    position: e.position,
    health: e.health,
    maxHealth: e.maxHealth,
    alive: e.alive,
    targetId: e.targetId,
  }));
}

function spawnEnemyInto(container, idPrefix, seq, type, position, healthMult = 1, damageMult = 1) {
  const cfg = ENEMY_TYPES[type];
  const id = `${idPrefix}-${seq}`;
  const maxHealth = Math.round(cfg.maxHealth * healthMult);

  container.set(id, {
    id,
    type,
    position: [...position],
    spawnPoint: [...position],
    health: maxHealth,
    maxHealth,
    attackDamage: Math.round(cfg.attackDamage * damageMult),
    alive: true,
    targetId: null,
    lastAttackTime: 0,
    patrolTarget: null,
    patrolWaitUntil: 0,
    positionHistory: [],
    cast: null,
    attackCooldowns: {},
    pendingImpacts: [],
    pools: [],
  });

  return id;
}

const caveInstances = new Map();

function rollCaveCrateRooms() {
  const pool = caveGeometry.CHESTS.map((chest) => chest.id);
  const picked = new Set();

  while (picked.size < CAVE_CRATE_ROOMS && pool.length > 0) {
    picked.add(pool.splice(crypto.randomInt(0, pool.length), 1)[0]);
  }

  return picked;
}

function revealCaveCrates(cave, occupants) {
  for (const player of occupants) {
    if (!player.caveKnownCrates) player.caveKnownCrates = new Set();

    for (const roomId of cave.crateRooms) {
      if (player.caveKnownCrates.has(roomId)) continue;
      if (cave.openedRooms.has(roomId)) continue;

      const spot = CAVE_CHESTS[roomId];
      if (!spot) continue;

      const dx = spot[0] - player.position[0];
      const dz = spot[2] - player.position[2];
      if (dx * dx + dz * dz > CAVE_CRATE_REVEAL * CAVE_CRATE_REVEAL) continue;

      player.caveKnownCrates.add(roomId);
      safeSend(player.ws, { type: 'caveChestSpawn', chestId: roomId, x: spot[0], z: spot[2] });
    }
  }
}

function cavePlayersIn(instance, excludeId = null) {
  const list = [];
  players.forEach((p) => {
    if (!p.authenticated) return;
    if (p.locationId !== CAVE_LOCATION_ID || p.instance !== instance) return;
    if (excludeId !== null && p.id === excludeId) return;
    list.push(p);
  });
  return list;
}

function ensureCaveInstance(instance) {
  const existing = caveInstances.get(instance);
  if (existing) return existing;

  const cave = {
    instance,
    enemies: new Map(),
    nextEnemySeq: 1,
    bossId: null,
    bossDefeated: false,
    crateRooms: rollCaveCrateRooms(),
    openedRooms: new Set(),
    createdAt: Date.now(),
  };

  for (const spawn of CAVE_ENEMY_SPAWNS) {
    spawnEnemyInto(cave.enemies, `cave-${instance}`, cave.nextEnemySeq++, spawn.type, spawn.position);
  }

  cave.bossId = spawnEnemyInto(
    cave.enemies,
    `cave-${instance}`,
    cave.nextEnemySeq++,
    'cave_warden',
    CAVE_BOSS_SPAWN
  );

  caveInstances.set(instance, cave);
  return cave;
}

function caveInstanceOf(player) {
  if (player.locationId !== CAVE_LOCATION_ID) return null;
  return caveInstances.get(player.instance) || null;
}

function enterCave(player) {
  const cave = ensureCaveInstance(player.instance);
  consumeCaveSeat(player);
  reserveCaveSeats(player);
  player.caveKnownCrates = new Set();

  safeSend(player.ws, { type: 'enemyState', enemies: serializeEnemies(cave.enemies) });
  safeSend(player.ws, { type: 'caveBossState', defeated: cave.bossDefeated });
}

function leaveCave(player, previousInstance) {
  const instance = Number.isInteger(previousInstance) ? previousInstance : player.instance;
  safeSend(player.ws, { type: 'enemyState', enemies: [] });

  const cave = caveInstances.get(instance);
  if (!cave) return;
  if (cavePlayersIn(instance, player.id).length > 0) return;

  caveInstances.delete(instance);
  if (cave.bossDefeated) closeCavePortal();
}

function serializeCanyonEnemies(player) {
  if (!player.canyon) return [];
  return Array.from(player.canyon.enemies.values()).map((e) => ({
    id: e.id,
    type: e.type,
    position: e.position,
    health: e.health,
    maxHealth: e.maxHealth,
    alive: e.alive,
    targetId: e.targetId,
  }));
}

function updateCanyonPatrol(enemy, cfg, now, constrained = false) {
  if (!enemy.patrolTarget) {
    if (now < enemy.patrolWaitUntil) return;

    const radius = constrained ? Math.min(cfg.patrolRadius, 9) : cfg.patrolRadius;

    for (let attempt = 0; attempt < (constrained ? 10 : 1); attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      const x = enemy.spawnPoint[0] + Math.cos(angle) * r;
      const z = enemy.spawnPoint[2] + Math.sin(angle) * r;

      if (!constrained || caveWalkable(x, z)) {
        enemy.patrolTarget = [x, z];
        break;
      }
    }

    if (!enemy.patrolTarget) {
      enemy.patrolWaitUntil = now + 1500;
      return;
    }
  }

  const dx = enemy.patrolTarget[0] - enemy.position[0];
  const dz = enemy.patrolTarget[1] - enemy.position[2];
  const dist = Math.sqrt(dx * dx + dz * dz);

  if (dist < 0.5) {
    enemy.patrolTarget = null;
    enemy.patrolWaitUntil = now + CANYON_CONFIG.patrolPauseMinMs +
      Math.random() * (CANYON_CONFIG.patrolPauseMaxMs - CANYON_CONFIG.patrolPauseMinMs);
    return;
  }

  const step = cfg.patrolSpeed * (CANYON_CONFIG.tickRate / 1000) * enemySpeedMult(enemy, now);
  if (!stepEnemy(enemy, dx, dz, step, constrained)) {
    enemy.patrolTarget = null;
    enemy.patrolWaitUntil = now + 800;
  }
}

function cancelHomeTeleport(player, reason) {
  if (!player.homeTeleportCastUntil) return;
  player.homeTeleportCastUntil = 0;
  safeSend(player.ws, { type: 'homeTeleportResult', casting: false, cancelled: true, reason });
}

function completeHomeTeleport(player, now) {
  player.homeTeleportCastUntil = 0;

  const refuse = (reason) => safeSend(player.ws, { type: 'homeTeleportResult', casting: false, cancelled: true, reason });

  if (!player.alive) return refuse('dead');
  if (!player.homeSpawn) return refuse('no_beacon');
  if (isInCombat(player)) return refuse('in_combat');
  if (isInCanyonSegment(player)) return refuse('canyon');

  const charges = player.placeables['home-teleport'] || 0;
  if (charges <= 0) return refuse('no_charge');

  player.placeables['home-teleport'] = charges - 1;
  player.homeTeleportUsedAt = now;
  player.economyChangedAt = now;

  const destination = `${PLAYER_ROOM_PREFIX}${player.userId}`;
  const sameRoom = player.locationId === destination;

  player.position = [...player.homeSpawn];
  player.justTeleported = true;
  player.teleportSettleUntil = now + TELEPORT_SETTLE_MS;
  player.positionHistory = [];
  player.recentShots = [];
  grantSpawnProtection(player);
  persistPlayer(player);

  safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });
  safeSend(player.ws, {
    type: 'homeTeleportResult',
    casting: false,
    done: true,
    locationId: destination,
    position: player.position,
    sameRoom,
    cooldownUntil: now + HOME_TELEPORT_COOLDOWN_MS,
    charges: player.placeables['home-teleport'],
  });
}

function partyErrorKey(code) {
  switch (code) {
    case 'self': return 'g.err.party.self';
    case 'target_in_party': return 'g.err.party.targetInParty';
    case 'already_invited': return 'g.err.party.alreadyInvited';
    case 'already_in_party': return 'g.err.party.alreadyInParty';
    case 'full': return 'g.err.party.full';
    case 'no_invite': return 'g.err.party.noInvite';
    case 'expired': return 'g.err.party.expired';
    case 'gone': return 'g.err.party.gone';
    case 'not_leader': return 'g.err.party.notLeader';
    case 'not_member': return 'g.err.party.notMember';
    case 'no_party': return 'g.err.party.noParty';
    default: return 'g.err.party.failed';
  }
}

function partyErrorMessage(code) {
  switch (code) {
    case 'self': return 'You cannot invite yourself';
    case 'target_in_party': return 'That player is already in a party';
    case 'already_invited': return 'You already invited them';
    case 'already_in_party': return 'You are already in a party';
    case 'full': return `A party holds ${party.MAX_PARTY_SIZE} people at most`;
    case 'no_invite': return 'That invite is no longer valid';
    case 'expired': return 'That invite expired';
    case 'gone': return 'That party no longer exists';
    case 'not_leader': return 'Only the party leader can do that';
    case 'not_member': return 'They are not in your party';
    case 'no_party': return 'You are not in a party';
    default: return 'Party action failed';
  }
}

function partyRosterPayload(group) {
  return {
    type: 'partyState',
    partyId: group.id,
    leaderId: group.leaderId,
    members: group.memberIds.map((id) => {
      const member = players.get(id);
      return {
        id,
        nickname: member?.nickname || 'Unknown',
        level: member?.progression?.level || 1,
        health: member?.health ?? 0,
        maxHealth: member?.maxHealth ?? BASE_MAX_HEALTH,
        alive: member?.alive !== false,
        locationId: member?.locationId || null,
      };
    }),
  };
}

const EMPTY_PARTY_PAYLOAD = { type: 'partyState', partyId: null, leaderId: null, members: [] };

function broadcastPartyState(group) {
  if (!group) return;
  const payload = partyRosterPayload(group);
  for (const id of group.memberIds) {
    const member = players.get(id);
    if (member) safeSend(member.ws, payload);
  }
}

function sendPartyDisbanded(memberIds, reason) {
  for (const id of memberIds) {
    const member = players.get(id);
    if (!member) continue;
    safeSend(member.ws, EMPTY_PARTY_PAYLOAD);
    safeSend(member.ws, { type: 'partyDisbanded', reason });
  }
}

function applyPartyDeparture(result, reason) {
  if (!result.removed) return;

  if (result.disbanded) {
    sendPartyDisbanded(result.remaining, reason);
    return;
  }

  broadcastPartyState(result.party);
}

function cancelArenaRevive(player, reason) {
  if (!player.arenaReviveUntil) return;
  player.arenaReviveUntil = 0;
  player.arenaReviveTargetId = null;
  safeSend(player.ws, { type: 'arenaReviveResult', channelling: false, cancelled: true, reason });
}

function completeArenaRevive(player, now) {
  const targetId = player.arenaReviveTargetId;
  player.arenaReviveUntil = 0;
  player.arenaReviveTargetId = null;

  const run = arena.runForPlayer(player.id);
  const target = targetId ? players.get(targetId) : null;

  if (!run || run.phase !== 'pause' || !target || !run.downIds.has(targetId)) {
    safeSend(player.ws, { type: 'arenaReviveResult', channelling: false, cancelled: true, reason: 'gone' });
    return;
  }

  arena.markUp(run, targetId);
  target.alive = true;
  target.health = Math.max(1, Math.round(target.maxHealth * 0.5));
  target.justTeleported = true;
  target.teleportSettleUntil = now + TELEPORT_SETTLE_MS;
  grantSpawnProtection(target);

  safeSend(target.ws, {
    type: 'respawn',
    locationId: target.locationId,
    position: target.position,
    health: target.health,
  });
  broadcast({ type: 'playerRespawn', id: target.id, position: target.position, health: target.health }, target.id, true, target);

  safeSend(player.ws, { type: 'arenaReviveResult', channelling: false, done: true, targetId });
  broadcastArena(run, { type: 'arenaPlayerRevived', playerId: targetId, byId: player.id });
  broadcastArenaState(run);
}

function isInCanyonSegment(player) {
  return player.locationId === 'tower-first-floor' && !!player.canyon && !player.canyon.inHub;
}

function isCombatLogout(player) {
  if (!player.alive) return false;
  return isInCombat(player) || isInCanyonSegment(player);
}

function consumeInsurance(player) {
  const charges = player.placeables['run-insurance'] || 0;
  if (charges <= 0) return false;

  player.placeables['run-insurance'] = charges - 1;
  player.economyChangedAt = Date.now();

  safeSend(player.ws, { type: 'insuranceConsumed' });
  safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });
  return true;
}

function dropRunLoot(player) {
  if (!Array.isArray(player.inventory) || player.inventory.length === 0) return { outcome: 'empty' };
  if (CRATE_BLOCKED_LOCATIONS.has(player.locationId)) return { outcome: 'kept' };

  if (consumeInsurance(player)) {
    persistPlayer(player);
    return { outcome: 'insured' };
  }

  const crate = spawnDeathCrate(player, player.position);
  persistPlayer(player);

  if (!crate) return { outcome: 'kept' };

  return {
    outcome: 'crate',
    stacks: crate.entries.length,
    expiresAt: crate.createdAt + CRATE_CONFIG.despawnMs,
    segment: crate.segment,
  };
}

function markPlayerDead(target, killerId, position) {
  target.alive = false;
  if (!dust2MemberOf(target)) target.stats.deaths++;
  clearCombat(target);
  cancelHomeTeleport(target, 'dead');
  clearPlayerAbilityBuffs(target, false);
  cancelArenaRevive(target, 'dead');
  const loot = dropRunLoot(target);

  const arenaRun = arena.runForPlayer(target.id);
  if (arenaRun) {
    arena.markDown(arenaRun, target.id);
    broadcastArena(arenaRun, { type: 'arenaPlayerDown', playerId: target.id });
    broadcastArenaState(arenaRun);
  }

  const defusalMatch = defusal.matchOf(target.id);
  if (defusalMatch) {
    const killer = killerId ? players.get(killerId) : null;
    const killerMember = killer ? defusalMatch.members.get(killer.id) : null;
    if (killerMember && defusal.sideOf(defusalMatch, killer.id) !== defusal.sideOf(defusalMatch, target.id)) {
      const weapon = defusal.heldItem(killerMember);
      defusal.award(killerMember, weapon?.killReward ?? 300);
    }

    defusal.markDead(defusalMatch, target.id);
    broadcastDefusalState(defusalMatch);
  }

  const grinderMatch = grinder.matchOf(target.id);
  if (grinderMatch) {
    grinder.markDead(grinderMatch, target.id, killerId, Date.now());
    broadcastGrinderState(grinderMatch);
  }

  const deathMessage = {
    type: 'playerDeath',
    playerId: target.id,
    killerId,
    position,
  };

  if (grinderMatch) {
    safeSend(target.ws, {
      type: 'grinderDeath',
      killerId,
      killerName: killerId ? players.get(killerId)?.nickname ?? null : null,
    });
  } else {
    safeSend(target.ws, { ...deathMessage, options: respawnOptionsFor(target), loot });
  }
  broadcast(deathMessage, target.id, true, target);
}

function respawnDestinationFor(target, requested) {
  const inCanyon = target.locationId === 'tower-first-floor' && !!target.canyon;

  if (requested === 'canyon_hub') return inCanyon ? 'canyon_hub' : 'hall';
  if (requested === 'home') return target.homeSpawn ? 'home' : 'hall';
  if (requested === 'hall') return 'hall';

  return inCanyon ? 'canyon_hub' : 'hall';
}

function respawnPlayer(target, requested) {
  if (target.alive) return;
  if (target.ws.readyState !== WebSocket.OPEN) return;

  const leavingRun = arena.runForPlayer(target.id);
  if (leavingRun) {
    arena.dropMember(leavingRun, target.id);
    safeSend(target.ws, { type: 'arenaEnded', reason: 'left', wavesCleared: 0, ash: 0, xp: 0, bestWave: target.arenaBestWave || 0, cooldownUntil: target.arenaCooldownUntil || 0 });
    broadcastArenaState(leavingRun);
  }

  const destination = respawnDestinationFor(target, requested);
  const oldLocation = target.locationId;

  if (oldLocation === INFLUENCE_LOCATION_ID) leaveInfluence(target);

  target.health = target.maxHealth;
  target.alive = true;
  clearPlayerAbilityBuffs(target, true);

  if (destination === 'canyon_hub') {
    enterCanyonHub(target);
  } else {
    target.locationId = destination === 'home' ? `${PLAYER_ROOM_PREFIX}${target.userId}` : 'tower-main-hall';
    target.weaponEquipped = false;

    if (destination === 'home') {
      target.instance = 1;
      target.position = [...target.homeSpawn];
    } else {
      spawnInSafeZone(target);
    }

    target.positionHistory = [];
    target.recentShots = [];
    safeSend(target.ws, { type: 'weaponForceUnequip' });

    if (oldLocation !== target.locationId) {
      notifyLocationTransition(target, oldLocation, target.locationId);
      if (isShardedLocation(oldLocation)) broadcastShardState(oldLocation);
      if (isShardedLocation(target.locationId)) broadcastShardState(target.locationId);
      if (destination === 'home') {
        refreshRoomEditRights(target).catch((err) => console.error('[Respawn] edit rights error:', err.message));
      }
    }
  }

  target.justTeleported = true;
  target.teleportSettleUntil = Date.now() + TELEPORT_SETTLE_MS;
  grantSpawnProtection(target);

  safeSend(target.ws, {
    type: 'respawn',
    locationId: target.locationId,
    position: target.position,
    health: target.health,
  });

  broadcast({
    type: 'playerRespawn',
    id: target.id,
    position: target.position,
    health: target.health,
  }, target.id, true, target);
}

function handleRespawnRequest(player, data) {
  if (player.alive) return;

  const grinderMatch = grinder.matchOf(player.id);
  if (grinderMatch) {
    if (data?.target !== 'hall') return;
    leaveGrinder(player);
  }

  const match = defusal.matchOf(player.id);
  if (match && match.phase !== 'ended') {
    if (data?.target !== 'hall') {
      safeSend(player.ws, { type: 'error', message: 'You are out until the round ends.', messageKey: 'g.err.outUntilRoundEnds' });
      return;
    }
    defusal.dropMember(match, player.id);
    clearDefusalLoadout(player);
  }

  respawnPlayer(player, typeof data?.target === 'string' ? data.target : null);
}

function respawnOptionsFor(player) {
  return {
    hall: true,
    home: !!player.homeSpawn,
    canyon_hub: isInCanyonSegment(player) || (player.locationId === 'tower-first-floor' && !!player.canyon),
  };
}

function damagePlayerByCanyonEnemy(player, enemy) {
  applyPlayerDamage(player, enemy.attackDamage * enemyDamageOutputMult(enemy, Date.now()), {
    attackerId: enemy.id,
    broadcast: false,
  });
}

function damagePlayerFromZone(player, enemy, damage) {
  applyPlayerDamage(player, damage * enemyDamageOutputMult(enemy, Date.now()), {
    attackerId: enemy.id,
    broadcast: false,
  });
}

function clampToArena(position, arena) {
  const dx = position[0] - arena.x;
  const dz = position[2] - arena.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist <= arena.radius) return;

  const scale = arena.radius / (dist || 1);
  position[0] = arena.x + dx * scale;
  position[2] = arena.z + dz * scale;
}

function pickBossAttack(enemy, cfg, dist, now) {
  const fraction = enemy.maxHealth > 0 ? enemy.health / enemy.maxHealth : 1;

  const usable = cfg.attacks.filter((attack) => {
    if (attack.phase !== undefined && fraction > attack.phase) return false;
    if (dist < attack.minRange || dist > attack.maxRange) return false;
    return now - (enemy.attackCooldowns[attack.id] || 0) >= attack.cooldown;
  });

  if (usable.length === 0) return null;

  const heavy = usable.filter((attack) => attack.id !== 'spit');
  const pool = heavy.length > 0 ? heavy : usable;
  return pool[Math.floor(Math.random() * pool.length)];
}

function resolveBossCast(targets, enemy, cast, now) {
  const attack = cast.attack;
  const origin = [enemy.position[0], enemy.position[1] + 2.4, enemy.position[2]];

  for (let i = 0; i < attack.shots; i++) {
    const offsetAngle = Math.random() * Math.PI * 2;
    const offsetDist = attack.shots > 1 ? Math.random() * attack.spread : 0;

    const target = [
      cast.aim[0] + Math.cos(offsetAngle) * offsetDist,
      0,
      cast.aim[2] + Math.sin(offsetAngle) * offsetDist,
    ];

    const dx = target[0] - origin[0];
    const dz = target[2] - origin[2];
    const travel = Math.max(160, (Math.sqrt(dx * dx + dz * dz) / attack.speed) * 1000);

    const projectileMessage = {
      type: 'bossProjectile',
      enemyId: enemy.id,
      attack: attack.id,
      origin,
      target,
      travel,
      radius: attack.radius,
    };
    for (const spectator of targets) safeSend(spectator.ws, projectileMessage);

    enemy.pendingImpacts.push({
      at: now + travel,
      x: target[0],
      z: target[2],
      radius: attack.radius,
      damage: attack.damage,
      pool: attack.pool || null,
    });
  }
}

function processBossImpacts(targets, enemy, now) {
  if (enemy.pendingImpacts.length === 0) return;

  const remaining = [];

  for (const impact of enemy.pendingImpacts) {
    if (impact.at > now) {
      remaining.push(impact);
      continue;
    }

    for (const target of targets) {
      if (!target.alive) continue;
      const dx = target.position[0] - impact.x;
      const dz = target.position[2] - impact.z;
      if (Math.sqrt(dx * dx + dz * dz) <= impact.radius) {
        damagePlayerFromZone(target, enemy, impact.damage);
      }
    }

    if (impact.pool) {
      enemy.pools.push({
        x: impact.x,
        z: impact.z,
        radius: impact.radius,
        damage: impact.pool.damage,
        interval: impact.pool.interval,
        expiresAt: now + impact.pool.duration,
        nextTickAt: now + impact.pool.interval,
      });

      const poolMessage = {
        type: 'bossPool',
        enemyId: enemy.id,
        x: impact.x,
        z: impact.z,
        radius: impact.radius,
        duration: impact.pool.duration,
      };
      for (const target of targets) safeSend(target.ws, poolMessage);
    }
  }

  enemy.pendingImpacts = remaining;
}

function processBossPools(targets, enemy, now) {
  if (enemy.pools.length === 0) return;

  enemy.pools = enemy.pools.filter((pool) => pool.expiresAt > now);

  for (const pool of enemy.pools) {
    if (now < pool.nextTickAt) continue;
    pool.nextTickAt = now + pool.interval;

    for (const target of targets) {
      if (!target.alive) continue;
      const dx = target.position[0] - pool.x;
      const dz = target.position[2] - pool.z;
      if (Math.sqrt(dx * dx + dz * dz) <= pool.radius) {
        damagePlayerFromZone(target, enemy, pool.damage);
      }
    }
  }
}

function bossWaveRadius(cfg, arena) {
  return Math.min(cfg.wave.radius ?? Infinity, arena.radius);
}

function startBossWave(targets, enemy, cfg, arena, now) {
  enemy.wave = { resolveAt: now + cfg.wave.windup };
  enemy.waveStartedAt = now;
  enemy.lastAttackTime = now;

  const message = {
    type: 'bossWave',
    enemyId: enemy.id,
    x: enemy.position[0],
    z: enemy.position[2],
    radius: bossWaveRadius(cfg, arena),
    windup: cfg.wave.windup,
  };

  for (const spectator of targets) safeSend(spectator.ws, message);
}

function resolveBossWave(targets, enemy, cfg, arena) {
  const radius = bossWaveRadius(cfg, arena);

  for (const target of targets) {
    if (!target.alive) continue;

    const dx = target.position[0] - enemy.position[0];
    const dz = target.position[2] - enemy.position[2];
    if (Math.sqrt(dx * dx + dz * dz) > radius) continue;

    const arenaDx = target.position[0] - arena.x;
    const arenaDz = target.position[2] - arena.z;
    if (Math.sqrt(arenaDx * arenaDx + arenaDz * arenaDz) > arena.radius) continue;

    const sheltered = cfg.cover === 'city'
      ? influenceGeometry.citySightBlocked(
        enemy.position[0],
        enemy.position[2],
        target.position[0],
        target.position[2]
      )
      : caveGeometry.caveCoverBetween(
        enemy.position[0],
        enemy.position[2],
        target.position[0],
        target.position[2]
      );
    if (sheltered) continue;

    damagePlayerFromZone(target, enemy, cfg.wave.damage);
  }
}

function bossTargetAmong(targets, enemy, cfg, arena, now) {
  let best = null;
  let bestDist = Infinity;

  const provoked = enemy.provokedUntil > now ? enemy.provokedBy : null;

  for (const candidate of targets) {
    if (!candidate.alive) continue;

    const dx = candidate.position[0] - enemy.position[0];
    const dz = candidate.position[2] - enemy.position[2];
    const dist = Math.sqrt(dx * dx + dz * dz);

    const isProvoker = candidate.id === provoked;
    if (!isProvoker && dist > cfg.aggroRadius) continue;

    const arenaDx = candidate.position[0] - arena.x;
    const arenaDz = candidate.position[2] - arena.z;
    if (!isProvoker && Math.sqrt(arenaDx * arenaDx + arenaDz * arenaDz) > arena.radius + 10) continue;

    const sticky = candidate.id === enemy.targetId ? dist - BOSS_TARGET_STICKINESS : dist;
    if (sticky < bestDist) {
      bestDist = sticky;
      best = { player: candidate, dist };
    }
  }

  return best;
}

function updateRangedBoss(targets, enemy, cfg, now) {
  const arena = cfg.arena || {
    x: enemy.spawnPoint[0],
    z: enemy.spawnPoint[2],
    radius: cfg.arenaRadius || 40,
  };

  processBossImpacts(targets, enemy, now);
  processBossPools(targets, enemy, now);

  const chosen = bossTargetAmong(targets, enemy, cfg, arena, now);
  const player = chosen ? chosen.player : null;
  const dist = chosen ? chosen.dist : Infinity;
  const engaged = chosen !== null;

  enemy.targetId = engaged ? player.id : null;

  if (enemy.wave) {
    if (now >= enemy.wave.resolveAt) {
      resolveBossWave(targets, enemy, cfg, arena);
      enemy.wave = null;
    }
    clampToArena(enemy.position, arena);
    return;
  }

  if (enemy.cast) {
    if (now >= enemy.cast.resolveAt) {
      resolveBossCast(targets, enemy, enemy.cast, now);
      enemy.attackCooldowns[enemy.cast.attack.id] = now;
      enemy.cast = null;
    }
    clampToArena(enemy.position, arena);
    return;
  }

  if (!engaged) {
    enemy.waveStartedAt = now;

    const homeDx = arena.x - enemy.position[0];
    const homeDz = arena.z - enemy.position[2];
    const homeDist = Math.sqrt(homeDx * homeDx + homeDz * homeDz);

    if (homeDist > 2) {
      const step = cfg.chaseSpeedNear * (CANYON_CONFIG.tickRate / 1000);
      enemy.position[0] += (homeDx / homeDist) * step;
      enemy.position[2] += (homeDz / homeDist) * step;
    }

    clampToArena(enemy.position, arena);
    return;
  }

  const drift = dist - cfg.preferredRange;
  if (Math.abs(drift) > 3) {
    const speed = Math.abs(drift) > cfg.chaseNearThreshold ? cfg.chaseSpeedFar : cfg.chaseSpeedNear;
    const step = speed * (CANYON_CONFIG.tickRate / 1000) * Math.sign(drift) * enemySpeedMult(enemy, now);
    const len = dist || 1;
    enemy.position[0] += ((player.position[0] - enemy.position[0]) / len) * step;
    enemy.position[2] += ((player.position[2] - enemy.position[2]) / len) * step;
  }

  clampToArena(enemy.position, arena);

  if (abilities.isStunned(enemy, now)) return;

  if (cfg.wave && now - (enemy.waveStartedAt || 0) >= cfg.wave.cooldown) {
    startBossWave(targets, enemy, cfg, arena, now);
    return;
  }

  if (now - enemy.lastAttackTime < cfg.attackCooldown) return;

  const attack = pickBossAttack(enemy, cfg, dist, now);
  if (!attack) return;

  enemy.lastAttackTime = now;
  enemy.cast = {
    attack,
    resolveAt: now + attack.windup,
    aim: [player.position[0], 0, player.position[2]],
  };

  const castMessage = {
    type: 'bossCast',
    enemyId: enemy.id,
    attack: attack.id,
    windup: attack.windup,
    aim: enemy.cast.aim,
    radius: attack.radius,
  };
  for (const spectator of targets) safeSend(spectator.ws, castMessage);
}

const WORLD_ENEMY_TICK_MS = 100;
const WARDEN_RESPAWN_MS = 110000;
const WARDEN_BAND_NEAR = 8;
const WARDEN_BAND_FAR = 34;
const WARDEN_WALL_GRIP = 3;
const WARDEN_WALL_CLEARANCE = 3;
const WARDEN_MIN_COUNT = 3;
const WARDEN_MAX_COUNT = 14;
const WARDEN_ARC_SPACING = 110;

const worldEnemies = new Map();
let worldEnemySeq = 1;

function normalizeRingAngle(value) {
  let result = value;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}

function ringPosition(angle, radius) {
  return [Math.sin(angle) * radius, 0, -Math.cos(angle) * radius];
}

function wardenCountFor(radius) {
  const suggested = Math.round((Math.PI * 2 * radius) / WARDEN_ARC_SPACING);
  return Math.max(WARDEN_MIN_COUNT, Math.min(WARDEN_MAX_COUNT, suggested));
}

function spawnWarden(pool, instance, index, count, radius) {
  const cfg = ENEMY_TYPES.slime_warden;
  const arcCenter = ((index + 0.5) * Math.PI * 2) / count;
  const band = radius + (WARDEN_BAND_NEAR + WARDEN_BAND_FAR) / 2;
  const id = `world-${instance}-${worldEnemySeq++}`;

  pool.set(id, {
    id,
    type: 'slime_warden',
    instance,
    position: ringPosition(arcCenter, band),
    spawnPoint: ringPosition(arcCenter, band),
    health: cfg.maxHealth,
    maxHealth: cfg.maxHealth,
    attackDamage: cfg.attackDamage,
    alive: true,
    targetId: null,
    lastAttackTime: 0,
    patrolTarget: null,
    patrolWaitUntil: 0,
    positionHistory: [],
    cast: null,
    attackCooldowns: {},
    pendingImpacts: [],
    pools: [],
    arcCenter,
    arcHalf: Math.PI / count,
    respawnAt: 0,
  });
}

function ensureWorldEnemies(instance) {
  let pool = worldEnemies.get(instance);
  if (!pool) {
    pool = new Map();
    worldEnemies.set(instance, pool);
  }

  const radius = wallRadius();
  if (radius === null) {
    pool.clear();
    return pool;
  }

  if (pool.size > 0) return pool;

  const count = wardenCountFor(radius);
  for (let i = 0; i < count; i++) {
    spawnWarden(pool, instance, i, count, radius);
  }

  return pool;
}

function sendWorldEnemyState(player) {
  const pool = ensureWorldEnemies(player.instance);
  safeSend(player.ws, { type: 'enemyState', enemies: serializeEnemies(pool) });
}

function broadcastWorldEnemyState(instance) {
  const pool = worldEnemies.get(instance);
  if (!pool) return;
  broadcastToLocation('main-world', { type: 'enemyState', enemies: serializeEnemies(pool) }, null, instance);
}

function rebuildWorldEnemies() {
  for (const pool of worldEnemies.values()) {
    pool.clear();
  }

  const instances = new Set();
  players.forEach((p) => {
    if (p.authenticated && p.locationId === 'main-world') instances.add(p.instance);
  });

  for (const instance of instances) {
    ensureWorldEnemies(instance);
    broadcastWorldEnemyState(instance);
  }
}

function forEachWorldPlayer(instance, fn) {
  players.forEach((p) => {
    if (!p.authenticated || p.locationId !== 'main-world') return;
    if (p.instance !== instance) return;
    if (p.ws.readyState !== WebSocket.OPEN) return;
    fn(p);
  });
}

function playerOnRampart(player, radius) {
  const [x, y, z] = player.position;
  const distance = Math.hypot(x, z);
  if (distance < radius - WARDEN_WALL_GRIP || distance > radius + WARDEN_WALL_GRIP) return false;
  return y >= worldTerrain.getHeightAt(x, z) + WARDEN_WALL_CLEARANCE;
}

function pickWardenTarget(enemy, cfg, radius) {
  let best = null;
  let bestDistance = Infinity;

  forEachWorldPlayer(enemy.instance, (player) => {
    if (!player.alive || isSpawnProtected(player)) return;
    if (!playerOnRampart(player, radius)) return;

    const distance = Math.hypot(player.position[0] - enemy.position[0], player.position[2] - enemy.position[2]);
    if (distance > cfg.aggroRadius || distance >= bestDistance) return;

    bestDistance = distance;
    best = player;
  });

  return best;
}

function clampWardenToBand(enemy, radius) {
  const near = radius + WARDEN_BAND_NEAR;
  const far = radius + WARDEN_BAND_FAR;

  const distance = Math.hypot(enemy.position[0], enemy.position[2]);
  const angle = Math.atan2(enemy.position[0], -enemy.position[2]);
  const offset = normalizeRingAngle(angle - enemy.arcCenter);

  const clampedAngle = enemy.arcCenter + Math.max(-enemy.arcHalf, Math.min(enemy.arcHalf, offset));
  const clampedDistance = Math.max(near, Math.min(far, distance));

  enemy.position[0] = Math.sin(clampedAngle) * clampedDistance;
  enemy.position[2] = -Math.cos(clampedAngle) * clampedDistance;
}

function damageWorldPlayersAt(enemy, x, z, radius, damage) {
  forEachWorldPlayer(enemy.instance, (player) => {
    if (!player.alive) return;
    if (Math.hypot(player.position[0] - x, player.position[2] - z) > radius) return;
    damagePlayerFromZone(player, enemy, damage);
  });
}

function resolveWardenCast(enemy, cast, now) {
  const attack = cast.attack;
  const origin = [enemy.position[0], enemy.position[1] + 2.4, enemy.position[2]];

  for (let i = 0; i < attack.shots; i++) {
    const offsetAngle = Math.random() * Math.PI * 2;
    const offsetDist = attack.shots > 1 ? Math.random() * attack.spread : 0;

    const target = [
      cast.aim[0] + Math.cos(offsetAngle) * offsetDist,
      0,
      cast.aim[2] + Math.sin(offsetAngle) * offsetDist,
    ];

    const dx = target[0] - origin[0];
    const dz = target[2] - origin[2];
    const travel = Math.max(160, (Math.sqrt(dx * dx + dz * dz) / attack.speed) * 1000);

    broadcastToLocation('main-world', {
      type: 'bossProjectile',
      enemyId: enemy.id,
      attack: attack.id,
      origin,
      target,
      travel,
      radius: attack.radius,
    }, null, enemy.instance);

    enemy.pendingImpacts.push({
      at: now + travel,
      x: target[0],
      z: target[2],
      radius: attack.radius,
      damage: attack.damage,
      pool: attack.pool || null,
    });
  }
}

function processWardenImpacts(enemy, now) {
  if (enemy.pendingImpacts.length === 0) return;

  const remaining = [];

  for (const impact of enemy.pendingImpacts) {
    if (impact.at > now) {
      remaining.push(impact);
      continue;
    }

    damageWorldPlayersAt(enemy, impact.x, impact.z, impact.radius, impact.damage);

    if (impact.pool) {
      enemy.pools.push({
        x: impact.x,
        z: impact.z,
        radius: impact.radius,
        damage: impact.pool.damage,
        interval: impact.pool.interval,
        expiresAt: now + impact.pool.duration,
        nextTickAt: now + impact.pool.interval,
      });

      broadcastToLocation('main-world', {
        type: 'bossPool',
        enemyId: enemy.id,
        x: impact.x,
        z: impact.z,
        radius: impact.radius,
        duration: impact.pool.duration,
      }, null, enemy.instance);
    }
  }

  enemy.pendingImpacts = remaining;
}

function processWardenPools(enemy, now) {
  if (enemy.pools.length === 0) return;

  enemy.pools = enemy.pools.filter((pool) => pool.expiresAt > now);

  for (const pool of enemy.pools) {
    if (now < pool.nextTickAt) continue;
    pool.nextTickAt = now + pool.interval;
    damageWorldPlayersAt(enemy, pool.x, pool.z, pool.radius, pool.damage);
  }
}

function updateWardenPatrol(enemy, cfg, radius, now) {
  if (!enemy.patrolTarget) {
    if (now < enemy.patrolWaitUntil) return;

    const angle = enemy.arcCenter + (Math.random() * 2 - 1) * enemy.arcHalf * 0.85;
    const band = radius + WARDEN_BAND_NEAR + Math.random() * (WARDEN_BAND_FAR - WARDEN_BAND_NEAR);
    const point = ringPosition(angle, band);
    enemy.patrolTarget = [point[0], point[2]];
  }

  const dx = enemy.patrolTarget[0] - enemy.position[0];
  const dz = enemy.patrolTarget[1] - enemy.position[2];
  const distance = Math.hypot(dx, dz);

  if (distance < 0.8) {
    enemy.patrolTarget = null;
    enemy.patrolWaitUntil = now + CANYON_CONFIG.patrolPauseMinMs +
      Math.random() * (CANYON_CONFIG.patrolPauseMaxMs - CANYON_CONFIG.patrolPauseMinMs);
    return;
  }

  const step = cfg.patrolSpeed * (WORLD_ENEMY_TICK_MS / 1000) * enemySpeedMult(enemy, now);
  enemy.position[0] += (dx / distance) * step;
  enemy.position[2] += (dz / distance) * step;
}

function updateWarden(enemy, cfg, radius, now) {
  processWardenImpacts(enemy, now);
  processWardenPools(enemy, now);

  const target = pickWardenTarget(enemy, cfg, radius);
  enemy.targetId = target ? target.id : null;

  if (enemy.cast) {
    if (now >= enemy.cast.resolveAt) {
      resolveWardenCast(enemy, enemy.cast, now);
      enemy.attackCooldowns[enemy.cast.attack.id] = now;
      enemy.cast = null;
    }
    clampWardenToBand(enemy, radius);
    return;
  }

  if (!target) {
    updateWardenPatrol(enemy, cfg, radius, now);
    clampWardenToBand(enemy, radius);
    return;
  }

  enemy.patrolTarget = null;

  const dx = target.position[0] - enemy.position[0];
  const dz = target.position[2] - enemy.position[2];
  const distance = Math.hypot(dx, dz);
  const drift = distance - cfg.preferredRange;

  if (Math.abs(drift) > 3) {
    const speed = Math.abs(drift) > cfg.chaseNearThreshold ? cfg.chaseSpeedFar : cfg.chaseSpeedNear;
    const step = speed * (WORLD_ENEMY_TICK_MS / 1000) * Math.sign(drift) * enemySpeedMult(enemy, now);
    const length = distance || 1;
    enemy.position[0] += (dx / length) * step;
    enemy.position[2] += (dz / length) * step;
  }

  clampWardenToBand(enemy, radius);

  if (now - enemy.lastAttackTime < cfg.attackCooldown) return;
  if (abilities.isStunned(enemy, now)) return;

  const attack = pickBossAttack(enemy, cfg, distance, now);
  if (!attack) return;

  enemy.lastAttackTime = now;
  enemy.cast = {
    attack,
    resolveAt: now + attack.windup,
    aim: [target.position[0], 0, target.position[2]],
  };

  broadcastToLocation('main-world', {
    type: 'bossCast',
    enemyId: enemy.id,
    attack: attack.id,
    windup: attack.windup,
    aim: enemy.cast.aim,
    radius: attack.radius,
  }, null, enemy.instance);
}

function worldEnemyTick() {
  const radius = wallRadius();
  const now = Date.now();

  const occupied = new Set();
  players.forEach((p) => {
    if (p.authenticated && p.locationId === 'main-world') occupied.add(p.instance);
  });

  for (const [instance, pool] of worldEnemies) {
    if (!occupied.has(instance)) {
      if (pool.size > 0) pool.clear();
      continue;
    }

    if (radius === null) {
      if (pool.size > 0) {
        pool.clear();
        broadcastWorldEnemyState(instance);
      }
      continue;
    }

    const cfg = ENEMY_TYPES.slime_warden;
    let respawned = false;

    for (const enemy of pool.values()) {
      if (!enemy.alive) {
        if (enemy.respawnAt > 0 && now >= enemy.respawnAt) {
          enemy.alive = true;
          enemy.health = enemy.maxHealth;
          enemy.respawnAt = 0;
          enemy.cast = null;
          enemy.pendingImpacts = [];
          enemy.pools = [];
          enemy.position = ringPosition(enemy.arcCenter, radius + (WARDEN_BAND_NEAR + WARDEN_BAND_FAR) / 2);
          respawned = true;
        }
        continue;
      }

      updateWarden(enemy, cfg, radius, now);

      enemy.positionHistory.push({ position: [...enemy.position], time: now });
      enemy.positionHistory = enemy.positionHistory.filter((entry) => now - entry.time < 1000);
    }

    if (respawned) broadcastWorldEnemyState(instance);
    else broadcastToLocation('main-world', { type: 'enemyState', enemies: serializeEnemies(pool) }, null, instance);
  }

  for (const instance of occupied) {
    if (!worldEnemies.has(instance)) {
      ensureWorldEnemies(instance);
      broadcastWorldEnemyState(instance);
    }
  }
}

safeInterval(worldEnemyTick, WORLD_ENEMY_TICK_MS);

function canyonTick() {
  const now = Date.now();

  for (const player of players.values()) {
    if (!player.authenticated) continue;
    if (player.locationId === 'main-world') continue;
    if (player.locationId === CAVE_LOCATION_ID) continue;

    const enemies = activeEnemiesFor(player);
    if (!enemies || enemies.size === 0) continue;

    const inCave = false;

    for (const enemy of enemies.values()) {
      if (!enemy.alive) continue;
      const cfg = ENEMY_TYPES[enemy.type];

      if (cfg.ranged) {
        updateRangedBoss([player], enemy, cfg, now);
        enemy.positionHistory.push({ position: [...enemy.position], time: now });
        enemy.positionHistory = enemy.positionHistory.filter((p) => now - p.time < 1000);
        continue;
      }

      driveMeleeEnemy([player], enemy, cfg, now, inCave);

      enemy.positionHistory.push({ position: [...enemy.position], time: now });
      enemy.positionHistory = enemy.positionHistory.filter((p) => now - p.time < 1000);
    }

    safeSend(player.ws, { type: 'enemyState', enemies: serializeEnemies(enemies) });
  }
}

function pickMeleeTarget(candidates, enemy, cfg) {
  const held = enemy.targetId
    ? candidates.find((candidate) => candidate.id === enemy.targetId && candidate.alive)
    : null;

  if (held) {
    const dx = held.position[0] - enemy.position[0];
    const dz = held.position[2] - enemy.position[2];
    if (Math.sqrt(dx * dx + dz * dz) <= cfg.aggroLeash) return held;
  }

  let best = null;
  let bestDist = Infinity;

  for (const candidate of candidates) {
    if (!candidate.alive) continue;
    const dx = candidate.position[0] - enemy.position[0];
    const dz = candidate.position[2] - enemy.position[2];
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > cfg.aggroRadius) continue;
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }

  return best;
}

function driveMeleeEnemy(candidates, enemy, cfg, now, inCave) {
  const target = pickMeleeTarget(candidates, enemy, cfg);
  enemy.targetId = target ? target.id : null;

  if (target) {
    enemy.patrolTarget = null;

    const dx = target.position[0] - enemy.position[0];
    const dz = target.position[2] - enemy.position[2];
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist > cfg.attackRange) {
      const speed = dist > cfg.chaseNearThreshold ? cfg.chaseSpeedFar : cfg.chaseSpeedNear;
      const step = speed * (CANYON_CONFIG.tickRate / 1000) * enemySpeedMult(enemy, now);
      const [steerX, steerZ] = inCave
        ? caveChaseDirection(enemy, target.position[0], target.position[2], now)
        : [dx, dz];
      stepEnemy(enemy, steerX, steerZ, step, inCave);
    } else if (now - enemy.lastAttackTime >= cfg.attackCooldown && !abilities.isStunned(enemy, now)) {
      enemy.lastAttackTime = now;
      damagePlayerByCanyonEnemy(target, enemy);
    }
  } else {
    updateCanyonPatrol(enemy, cfg, now, inCave);
  }

  if (inCave) nudgeIntoCave(enemy.position);
}

async function grantSlimeCompanion(player) {
  const result = await callInternalApi('/api/internal/game/companions/grant', {
    userId: player.userId, gameId: player.gameId, itemId: CAVE_SLIME_ID, quantity: 1,
  }).catch((err) => {
    console.error('[Cave] slime grant error:', err.message);
    return null;
  });

  if (!result || !result.success) return false;

  player.companions = {
    owned: Array.isArray(result.owned) ? result.owned : (player.companions?.owned || []),
    equipped: result.equipped || null,
    fragments: Math.max(0, Math.floor(Number(result.fragments) || 0)),
    crates: Math.max(0, Math.floor(Number(result.crates) || 0)),
  };
  player.companionsChangedAt = Date.now();
  return true;
}

async function openBossChest(player, cave) {
  const chest = cave.bossChest;
  if (!chest) return;
  if (chest.looted.has(player.userId)) {
    safeSend(player.ws, { type: 'error', message: 'You already took your share', messageKey: 'g.err.chestEmpty' });
    return;
  }

  const dx = chest.x - player.position[0];
  const dz = chest.z - player.position[2];
  if (Math.sqrt(dx * dx + dz * dz) > CAVE_CHEST_REACH) return;

  chest.looted.add(player.userId);

  const slime = crypto.randomInt(0, 100) < CAVE_SLIME_CHANCE_PERCENT;

  const companionFragments = slime
    ? CAVE_SLIME_BONUS_FRAGMENTS
    : CAVE_CHEST_FRAGMENTS_MIN + crypto.randomInt(0, CAVE_CHEST_FRAGMENTS_MAX - CAVE_CHEST_FRAGMENTS_MIN + 1);
  const cosmeticFragments = slime
    ? CAVE_SLIME_BONUS_FRAGMENTS
    : CAVE_CHEST_FRAGMENTS_MIN + crypto.randomInt(0, CAVE_CHEST_FRAGMENTS_MAX - CAVE_CHEST_FRAGMENTS_MIN + 1);

  if (slime) await grantSlimeCompanion(player);

  await grantCanyonBossFragments(player, companionFragments);
  await grantCanyonCosmeticFragments(player, cosmeticFragments);

  const ash = slime ? 0 : CAVE_BOSS_CHEST_ASH;
  if (ash > 0) {
    player.ash += ash;
    player.economyChangedAt = Date.now();
    persistPlayer(player);
  }

  safeSend(player.ws, {
    type: 'caveBossReward',
    slime,
    companionFragments,
    cosmeticFragments,
    ash,
  });
  safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });
}

function companionCombatTick() {
  const now = Date.now();

  for (const player of players.values()) {
    if (!player.authenticated || !player.alive) continue;
    if (player.companions?.equipped !== CAVE_SLIME_ID) continue;
    if (!petAllowedAt(player.locationId)) continue;
    if (!isInCombat(player)) continue;
    if (player.homeTeleportCastUntil > 0) continue;
    if (now - (player.companionShotAt || 0) < COMPANION_ATTACK_COOLDOWN_MS) continue;

    const enemies = activeEnemiesFor(player);
    if (!enemies || enemies.size === 0) continue;

    let best = null;
    let bestDist = COMPANION_ATTACK_RANGE;

    for (const enemy of enemies.values()) {
      if (!enemy.alive) continue;
      const dx = enemy.position[0] - player.position[0];
      const dz = enemy.position[2] - player.position[2];
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < bestDist) {
        bestDist = dist;
        best = enemy;
      }
    }

    if (!best) continue;

    player.companionShotAt = now;

    const message = {
      type: 'companionShot',
      ownerId: player.id,
      enemyId: best.id,
      origin: [player.position[0], player.position[1] + 0.6, player.position[2]],
      target: [best.position[0], best.position[1] + 0.8, best.position[2]],
      travel: Math.max(120, (bestDist / COMPANION_PROJECTILE_SPEED) * 1000),
    };

    if (player.locationId === 'main-world' || player.locationId === CAVE_LOCATION_ID || player.locationId === INFLUENCE_LOCATION_ID) {
      broadcastToLocation(player.locationId, message, null, player.instance);
    } else {
      safeSend(player.ws, message);
    }

    applyEnemyDamage(player, best, COMPANION_ATTACK_DAMAGE, { keepTarget: false });
  }
}

safeInterval(companionCombatTick, 250);

function regenerateArenaBoss(enemy, cfg, occupants, now, instance) {
  if (enemy.health >= enemy.maxHealth) return;
  if (now - (enemy.lastHitAt || 0) < cfg.regenIdleMs) return;

  const arena = cfg.arena;
  for (const player of occupants) {
    if (!player.alive) continue;
    const dx = player.position[0] - arena.x;
    const dz = player.position[2] - arena.z;
    if (Math.sqrt(dx * dx + dz * dz) <= arena.radius) return;
  }

  const healed = Math.min(
    enemy.maxHealth - enemy.health,
    Math.ceil((cfg.regenPerSecond * CANYON_CONFIG.tickRate) / 1000)
  );
  if (healed <= 0) return;

  enemy.health += healed;
  enemy.provokedBy = null;
  enemy.provokedUntil = 0;

  broadcastToLocation(
    CAVE_LOCATION_ID,
    { type: 'enemyDamaged', id: enemy.id, health: enemy.health, attackerId: null, point: enemy.position, abilityId: null },
    null,
    instance
  );
}

function caveTick() {
  const now = Date.now();

  for (const [instance, cave] of Array.from(caveInstances.entries())) {
    const occupants = cavePlayersIn(instance);

    if (occupants.length === 0) {
      if (now - cave.createdAt > CAVE_EMPTY_DISPOSE_MS) caveInstances.delete(instance);
      continue;
    }

    revealCaveCrates(cave, occupants);

    for (const enemy of cave.enemies.values()) {
      if (!enemy.alive) continue;
      const cfg = ENEMY_TYPES[enemy.type];

      if (cfg.regenPerSecond && cfg.arena) regenerateArenaBoss(enemy, cfg, occupants, now, instance);

      if (cfg.ranged) {
        updateRangedBoss(occupants, enemy, cfg, now);
      } else {
        driveMeleeEnemy(occupants, enemy, cfg, now, true);
      }

      enemy.positionHistory.push({ position: [...enemy.position], time: now });
      enemy.positionHistory = enemy.positionHistory.filter((p) => now - p.time < 1000);
    }

    broadcastToLocation(
      CAVE_LOCATION_ID,
      { type: 'enemyState', enemies: serializeEnemies(cave.enemies) },
      null,
      instance
    );
  }
}

safeInterval(canyonTick, CANYON_CONFIG.tickRate);
safeInterval(caveTick, CANYON_CONFIG.tickRate);

const INFLUENCE_LOCATION_ID = influence.INFLUENCE_LOCATION_ID;
const INFLUENCE_CONFIG = influence.INFLUENCE_CONFIG;
const INFLUENCE_CRYSTAL = influenceGeometry.CRYSTAL;
const INFLUENCE_STEER_ANGLES = [0, 0.5, -0.5, 1.05, -1.05, 1.6, -1.6, 2.2, -2.2];
const INFLUENCE_STEER_REFRESH_MS = 350;
const INFLUENCE_DIRECT_SIGHT = 44;
const INFLUENCE_CRYSTAL_REACH = 6.5;
const INFLUENCE_CRYSTAL_HIT_MULT = 1.5;
const INFLUENCE_SIEGE_HOLD_MS = 4000;
const INFLUENCE_FIELD_REBUILD_MS = 1500;
const INFLUENCE_LEASH = 70;
const INFLUENCE_PERSIST_DEBOUNCE_MS = 2000;
const INFLUENCE_COMMAND_POLL_MS = 15000;
const INFLUENCE_TICK_MS = 100;
const INFLUENCE_COLLAPSE_MAX_MS = 10 * 60 * 1000;
const INFLUENCE_AOI_RADIUS = 105;
const INFLUENCE_TELEGRAPH_RANGE = 46;
const CRYSTAL_BROADCAST_MS = 300;
const BREACH_MIN_RADIUS = 150;
const BREACH_MAX_RADIUS = 900;
const BREACH_MIN_Y = -220;
const BREACH_MAX_Y = 220;
const BREACH_INTERACT_RANGE = 14;

const influenceState = influence.defaultState();
influenceState.loaded = false;

let influenceRun = null;
let influencePersistTimer = null;

function influenceOpen() {
  return influenceState.status === 'open' || influenceState.status === 'collapsing';
}

function influencePlayersIn(excludeId = null) {
  const list = [];
  players.forEach((p) => {
    if (!p.authenticated) return;
    if (p.locationId !== INFLUENCE_LOCATION_ID) return;
    if (excludeId !== null && p.id === excludeId) return;
    list.push(p);
  });
  return list;
}

function influenceOwnerCount() {
  if (!influenceState.ownerFactionId) return 0;
  let count = 0;
  for (const player of influencePlayersIn()) {
    if (player.influenceFactionId === influenceState.ownerFactionId) count++;
  }
  return count;
}

function buildInfluenceStatePayload() {
  return {
    type: 'influenceState',
    status: influenceState.status,
    phase: influenceState.phase,
    breach: {
      x: influenceState.breach.x,
      y: influenceState.breach.y,
      z: influenceState.breach.z,
      spawnedAt: influenceState.breach.spawnedAt,
    },
    ownerFactionId: influenceState.ownerFactionId,
    ownerFactionName: influenceState.ownerFactionName,
    ownerFactionSymbol: influenceState.ownerFactionSymbol,
    ownerFactionImage: influenceState.ownerFactionImage,
    feeCurrency: influenceState.feeCurrency,
    feeAmount: influenceState.feeAmount,
    bossDefeated: influenceState.bossDefeated,
    crystalHealth: influenceState.crystalHealth,
    crystalMaxHealth: INFLUENCE_CONFIG.crystalMaxHealth,
    nextSiegeAt: influenceState.nextSiegeAt,
    occupants: influencePlayersIn().length,
    capacity: INFLUENCE_CONFIG.capacity,
    siegeWave: influenceRun?.siege?.wave ?? 0,
  };
}

function broadcastInfluenceState() {
  const message = getCachedMessage(buildInfluenceStatePayload());

  players.forEach((p) => {
    if (!p.authenticated || p.ws.readyState !== WebSocket.OPEN) return;
    try {
      p.ws.send(message);
    } catch (err) {
      console.error('[!] Influence state send error:', err.message);
    }
  });
}

function persistInfluenceState(immediate = false) {
  if (!CONFIG.internalSecret) return;
  if (influencePersistTimer) {
    if (!immediate) return;
    clearTimeout(influencePersistTimer);
  }

  influencePersistTimer = setTimeout(() => {
    influencePersistTimer = null;
    callInternalApi('/api/internal/game/influence-state', {
      action: 'patch',
      state: {
        status: influenceState.status,
        breach: influenceState.breach,
        phase: influenceState.phase,
        ownerFactionId: influenceState.ownerFactionId,
        ownerFactionName: influenceState.ownerFactionName,
        ownerFactionSymbol: influenceState.ownerFactionSymbol,
        ownerFactionImage: influenceState.ownerFactionImage,
        feeCurrency: influenceState.feeCurrency,
        feeAmount: influenceState.feeAmount,
        feeTokenCa: influenceState.feeTokenCa,
        feeWallet: influenceState.feeWallet,
        bossDefeated: influenceState.bossDefeated,
        crystalHealth: influenceState.crystalHealth,
        nextSiegeAt: influenceState.nextSiegeAt,
        capturedAt: influenceState.capturedAt,
        lastCommandId: influenceState.lastCommandId,
      },
    }).catch((err) => console.error('[Influence] Persist failed:', err.message));
  }, immediate ? 0 : INFLUENCE_PERSIST_DEBOUNCE_MS);
}

function applyInfluenceState(raw) {
  const next = influence.normalizeState(raw);
  for (const key of Object.keys(next)) influenceState[key] = next[key];
}

async function loadInfluenceState() {
  if (!CONFIG.internalSecret) {
    influenceState.loaded = true;
    return;
  }

  const result = await callInternalApi('/api/internal/game/influence-state', { action: 'get' }).catch((err) => {
    console.error('[Influence] Load failed:', err.message);
    return null;
  });

  if (result?.state) applyInfluenceState(result.state);
  influenceState.loaded = true;

  if (influenceOpen() && influenceState.nextSiegeAt <= 0) {
    influenceState.nextSiegeAt = influence.scheduleFirstSiege(Date.now());
  }

  console.log(`[Influence] Loaded: ${influenceState.status}/${influenceState.phase}, owner ${influenceState.ownerFactionId || 'none'}`);
}

async function pollInfluenceCommands() {
  if (!CONFIG.internalSecret) return;

  const result = await callInternalApi('/api/internal/game/influence-state', { action: 'get' }).catch((err) => {
    console.error('[Influence] Command poll failed:', err.message);
    return null;
  });

  const command = result?.state?.command;
  if (!command || typeof command.id !== 'string') return;
  if (command.id === influenceState.lastCommandId) return;

  influenceState.lastCommandId = command.id;
  applyInfluenceCommand(command);
}

function pickBreachSpot() {
  const angle = Math.random() * Math.PI * 2;
  const radius = BREACH_MIN_RADIUS + Math.sqrt(Math.random()) * (BREACH_MAX_RADIUS - BREACH_MIN_RADIUS);
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  const y = BREACH_MIN_Y + Math.random() * (BREACH_MAX_Y - BREACH_MIN_Y);

  return [Math.round(x * 100) / 100, Math.round(y * 100) / 100, Math.round(z * 100) / 100];
}

function openBreach(force) {
  const wasOpen = influenceOpen();
  if (wasOpen && !force) return false;

  const spot = pickBreachSpot();
  const now = Date.now();

  influenceState.status = 'open';
  influenceState.breach = { x: spot[0], y: spot[1], z: spot[2], spawnedAt: now };

  if (!wasOpen) {
    influenceState.phase = influenceState.bossDefeated
      ? (influenceState.ownerFactionId ? 'owned' : 'claimable')
      : 'sealed';
    influenceState.crystalHealth = INFLUENCE_CONFIG.crystalMaxHealth;
    influenceState.nextSiegeAt = influence.scheduleNextSiege(influenceState.nextSiegeAt, now);
  }

  console.log(`[Influence] Breach ${wasOpen ? 'moved' : 'opened'} at ${spot[0]}, ${spot[1]}, ${spot[2]}`);
  persistInfluenceState(true);
  broadcastInfluenceState();
  return true;
}

function closeBreach(reason) {
  if (influenceState.status === 'closed') return;

  for (const player of influencePlayersIn()) {
    safeSend(player.ws, { type: 'forceTeleport', locationId: GALAXY_LOCATION_ID });
  }

  influenceState.status = 'closed';
  influenceState.phase = influenceState.bossDefeated
    ? (influenceState.ownerFactionId ? 'owned' : 'claimable')
    : 'sealed';

  disposeInfluenceRun();
  console.log(`[Influence] Breach closed (${reason})`);
  persistInfluenceState(true);
  broadcastInfluenceState();
}

function resetInfluencePoint() {
  influenceState.ownerFactionId = null;
  influenceState.ownerFactionName = null;
  influenceState.ownerFactionSymbol = null;
  influenceState.ownerFactionImage = null;
  influenceState.feeCurrency = 'none';
  influenceState.feeAmount = 0;
  influenceState.feeTokenCa = null;
  influenceState.feeWallet = null;
  influenceState.bossDefeated = false;
  influenceState.crystalHealth = INFLUENCE_CONFIG.crystalMaxHealth;
  influenceState.capturedAt = 0;
  influenceState.phase = 'sealed';
  influenceState.nextSiegeAt = 0;
}

function applyInfluenceCommand(command) {
  if (command.type === 'spawn_breach') {
    console.log('[Influence] Admin opened a breach');
    openBreach(true);
    return;
  }

  if (command.type === 'close_breach') {
    closeBreach('admin');
    return;
  }

  if (command.type === 'reset_point') {
    console.log('[Influence] Admin reset the influence point');
    closeBreach('reset');
    resetInfluencePoint();
    persistInfluenceState(true);
    broadcastInfluenceState();
    return;
  }

  if (command.type === 'force_siege') {
    influenceState.nextSiegeAt = Date.now();
    persistInfluenceState(true);
    broadcastInfluenceState();
  }
}

function pickInfluenceSpawn(player) {
  const spawns = influenceGeometry.SPAWNS;
  const hostiles = influencePlayersIn(player?.id ?? null).filter((other) => {
    if (!other.alive) return false;
    if (!player) return true;
    return other.influenceFactionId !== player.influenceFactionId;
  });

  let best = spawns[0];
  let bestScore = -Infinity;

  for (const spawn of spawns) {
    let nearest = Infinity;
    for (const hostile of hostiles) {
      const distance = Math.hypot(hostile.position[0] - spawn.x, hostile.position[2] - spawn.z);
      if (distance < nearest) nearest = distance;
    }

    const score = nearest + Math.random() * 12;
    if (score > bestScore) {
      bestScore = score;
      best = spawn;
    }
  }

  return [best.x, influenceGeometry.FLOOR_Y, best.z];
}

function ensureInfluenceRun() {
  if (influenceRun) return influenceRun;

  influenceRun = {
    enemies: new Map(),
    nextEnemySeq: 1,
    bossId: null,
    containers: new Map(),
    capture: null,
    siege: null,
    fields: new Map(),
    lastFieldBuildAt: 0,
    createdAt: Date.now(),
    collapseStartedAt: 0,
    emptySince: 0,
  };

  for (const container of influenceGeometry.LOOT) {
    influenceRun.containers.set(container.id, { openedBy: new Set(), reopenAt: 0 });
  }

  if (!influenceState.bossDefeated) {
    influenceRun.bossId = spawnWardEnemy(
      'ward_confessor',
      [influenceGeometry.BOSS_SPAWN.x, influenceGeometry.FLOOR_Y, influenceGeometry.BOSS_SPAWN.z],
      1,
      1,
      'boss'
    );
  }

  for (const spawn of influenceGeometry.ZOMBIE_SPAWNS) {
    spawnWardEnemy(spawn.type, [spawn.x, influenceGeometry.FLOOR_Y, spawn.z], 1, 1, 'ambient');
  }

  return influenceRun;
}

function disposeInfluenceRun() {
  influenceRun = null;
}

function spawnWardEnemy(type, position, healthMult, damageMult, role) {
  const run = influenceRun;
  if (!run) return null;

  const id = spawnEnemyInto(run.enemies, 'ward', run.nextEnemySeq++, type, position, healthMult, damageMult);
  const enemy = run.enemies.get(id);

  enemy.role = role;
  enemy.respawnAt = 0;
  enemy.holdTargetUntil = 0;
  enemy.summonAt = 0;
  enemy.phaseKey = null;
  enemy.ambush = role === 'ambient' && ENEMY_TYPES[type].ambush ? 'hidden' : null;
  enemy.lungeUntil = 0;
  enemy.slamAt = 0;
  enemy.slamResolveAt = 0;

  return id;
}

function influenceFieldFor(targetId, x, z, now) {
  const run = influenceRun;
  if (!run) return null;

  const existing = run.fields.get(targetId);
  if (existing && now - existing.builtAt < 4000) return existing.field;

  if (now - run.lastFieldBuildAt < INFLUENCE_FIELD_REBUILD_MS) return existing?.field ?? null;

  run.lastFieldBuildAt = now;
  const field = influence.buildFlowField(x, z);
  if (!field.ok) return existing?.field ?? null;

  run.fields.set(targetId, { field, builtAt: now });

  if (run.fields.size > 3) {
    let oldestKey = null;
    let oldestAt = Infinity;
    for (const [key, entry] of run.fields) {
      if (entry.builtAt < oldestAt) {
        oldestAt = entry.builtAt;
        oldestKey = key;
      }
    }
    if (oldestKey !== null) run.fields.delete(oldestKey);
  }

  return field;
}

function cityStepEnemy(enemy, dirX, dirZ, step) {
  const length = Math.hypot(dirX, dirZ) || 1;
  const nx = dirX / length;
  const nz = dirZ / length;

  for (const angle of INFLUENCE_STEER_ANGLES) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const sx = nx * cos - nz * sin;
    const sz = nx * sin + nz * cos;
    const x = enemy.position[0] + sx * step;
    const z = enemy.position[2] + sz * step;

    if (influenceGeometry.cityWalkable(x, z, influence.FLOW_CLEARANCE + 0.05)) {
      enemy.position[0] = x;
      enemy.position[2] = z;
      return true;
    }
  }

  return false;
}

function nudgeIntoCity(position) {
  if (influenceGeometry.cityWalkable(position[0], position[2], 0.5)) return;

  influenceGeometry.pushOutOfBlockers(position, 0.8);
  influenceGeometry.clampIntoCity(position, 2.5);

  if (influenceGeometry.cityWalkable(position[0], position[2], 0.5)) return;

  for (let ring = 1; ring <= 6; ring++) {
    const radius = ring * 1.6;
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2;
      const x = position[0] + Math.cos(angle) * radius;
      const z = position[2] + Math.sin(angle) * radius;
      if (!influenceGeometry.cityWalkable(x, z, 0.6)) continue;
      position[0] = x;
      position[2] = z;
      return;
    }
  }
}

function cityChaseDirection(enemy, target, now) {
  const targetX = target.position[0];
  const targetZ = target.position[2];
  const dx = targetX - enemy.position[0];
  const dz = targetZ - enemy.position[2];
  const direct = Math.hypot(dx, dz);

  if (direct <= INFLUENCE_DIRECT_SIGHT
    && !influenceGeometry.citySightBlocked(enemy.position[0], enemy.position[2], targetX, targetZ)) {
    return [dx, dz];
  }

  const field = influenceFieldFor(target.id, targetX, targetZ, now);
  if (field) {
    const step = influence.flowDirection(field, enemy.position[0], enemy.position[2]);
    if (step) return step;

    const escape = influence.flowEscapeDirection(field, enemy.position[0], enemy.position[2]);
    if (escape) return escape;
  }

  return [dx, dz];
}

function crystalDirection(enemy) {
  const field = influence.crystalFlowField();

  const step = influence.flowDirection(field, enemy.position[0], enemy.position[2]);
  if (step) return step;

  const escape = influence.flowEscapeDirection(field, enemy.position[0], enemy.position[2]);
  if (escape) return escape;

  return [INFLUENCE_CRYSTAL.x - enemy.position[0], INFLUENCE_CRYSTAL.z - enemy.position[2]];
}

function wardTargetFor(candidates, enemy, cfg, now) {
  let best = null;
  let bestScore = Infinity;

  const provoked = enemy.provokedUntil > now ? enemy.provokedBy : null;

  for (const candidate of candidates) {
    if (!candidate.alive) continue;
    if (candidate.invulnerableUntil && now < candidate.invulnerableUntil) continue;

    const dx = candidate.position[0] - enemy.position[0];
    const dz = candidate.position[2] - enemy.position[2];
    const distance = Math.hypot(dx, dz);

    const isProvoker = candidate.id === provoked;
    let reach = cfg.aggroRadius;

    if (enemy.role === 'siege') reach = Math.min(cfg.aggroRadius, 18);
    if (enemy.role === 'add') reach = Math.max(cfg.aggroRadius, 60);
    if (enemy.targetId === candidate.id) reach += 14;

    if (!isProvoker && distance > reach) continue;

    const blocked = distance > 6
      && influenceGeometry.citySightBlocked(enemy.position[0], enemy.position[2], candidate.position[0], candidate.position[2]);
    const score = distance + (blocked ? 22 : 0) + (isProvoker ? -40 : 0);

    if (score < bestScore) {
      bestScore = score;
      best = { player: candidate, dist: distance };
    }
  }

  return best;
}

function wardAmbushCheck(enemy, cfg, candidates, now) {
  if (enemy.ambush !== 'hidden') return true;

  const wake = cfg.ambush.wakeRadius;
  for (const candidate of candidates) {
    if (!candidate.alive) continue;
    const distance = Math.hypot(candidate.position[0] - enemy.position[0], candidate.position[2] - enemy.position[2]);
    if (distance > wake) continue;

    enemy.ambush = 'lunging';
    enemy.lungeUntil = now + cfg.ambush.lungeMs;

    const ambush = {
      type: 'wardAmbush',
      enemyId: enemy.id,
      x: enemy.position[0],
      z: enemy.position[2],
    };

    for (const spectator of candidates) {
      const reach = Math.hypot(spectator.position[0] - enemy.position[0], spectator.position[2] - enemy.position[2]);
      if (reach <= INFLUENCE_TELEGRAPH_RANGE) safeSend(spectator.ws, ambush);
    }

    return true;
  }

  return false;
}

function wardBruteSlam(enemy, cfg, target, distance, now) {
  if (!cfg.slam) return false;

  if (enemy.slamResolveAt > 0) {
    if (now < enemy.slamResolveAt) return true;

    enemy.slamResolveAt = 0;
    const occupants = influencePlayersIn();

    for (const player of occupants) {
      if (!player.alive) continue;
      const reach = Math.hypot(player.position[0] - enemy.position[0], player.position[2] - enemy.position[2]);
      if (reach > cfg.slam.radius) continue;
      damagePlayerFromZone(player, enemy, cfg.slam.damage);
    }

    return true;
  }

  if (!target || distance > cfg.slam.range) return false;
  if (now - enemy.slamAt < cfg.slam.cooldown) return false;

  enemy.slamAt = now;
  enemy.slamResolveAt = now + cfg.slam.windup;

  const telegraph = {
    type: 'bossWave',
    enemyId: enemy.id,
    x: enemy.position[0],
    z: enemy.position[2],
    radius: cfg.slam.radius,
    windup: cfg.slam.windup,
    silent: true,
  };

  for (const spectator of influencePlayersIn()) {
    const reach = Math.hypot(spectator.position[0] - enemy.position[0], spectator.position[2] - enemy.position[2]);
    if (reach <= INFLUENCE_TELEGRAPH_RANGE) safeSend(spectator.ws, telegraph);
  }

  return true;
}

function attackCrystal(enemy, cfg, now) {
  if (now - enemy.lastAttackTime < cfg.attackCooldown) return;
  enemy.lastAttackTime = now;

  const base = cfg.crystalDamage ?? enemy.attackDamage;
  damageCrystal(Math.round(base * INFLUENCE_CRYSTAL_HIT_MULT), enemy.id);
}

function driveWardEnemy(candidates, enemy, cfg, now) {
  if (enemy.role === 'ambient' && cfg.ambush && !wardAmbushCheck(enemy, cfg, candidates, now)) {
    enemy.targetId = null;
    return;
  }

  const chosen = wardTargetFor(candidates, enemy, cfg, now);
  const target = chosen ? chosen.player : null;
  const distance = chosen ? chosen.dist : Infinity;

  if (target) {
    enemy.targetId = target.id;
    enemy.holdTargetUntil = now + INFLUENCE_SIEGE_HOLD_MS;
  } else if (now > enemy.holdTargetUntil) {
    enemy.targetId = null;
  }

  if (abilities.isStunned(enemy, now)) return;

  if (wardBruteSlam(enemy, cfg, target, distance, now)) {
    nudgeIntoCity(enemy.position);
    return;
  }

  const lunging = enemy.ambush === 'lunging' && now < enemy.lungeUntil;
  if (enemy.ambush === 'lunging' && now >= enemy.lungeUntil) enemy.ambush = 'awake';

  if (target) {
    if (distance <= cfg.attackRange) {
      if (now - enemy.lastAttackTime >= cfg.attackCooldown) {
        enemy.lastAttackTime = now;
        damagePlayerByCanyonEnemy(target, enemy);
      }
      nudgeIntoCity(enemy.position);
      return;
    }

    const base = lunging
      ? cfg.ambush.lungeSpeed
      : distance > cfg.chaseNearThreshold ? cfg.chaseSpeedFar : cfg.chaseSpeedNear;
    const step = base * (INFLUENCE_TICK_MS / 1000) * enemySpeedMult(enemy, now);

    let dir;
    if (enemy.citySteer && now < enemy.citySteerUntil) {
      dir = enemy.citySteer;
    } else {
      dir = cityChaseDirection(enemy, target, now);
      enemy.citySteer = dir;
      enemy.citySteerUntil = now + INFLUENCE_STEER_REFRESH_MS;
    }

    if (!cityStepEnemy(enemy, dir[0], dir[1], step)) {
      enemy.citySteerUntil = 0;
      cityStepEnemy(enemy, target.position[0] - enemy.position[0], target.position[2] - enemy.position[2], step);
    }

    nudgeIntoCity(enemy.position);
    return;
  }

  if (enemy.role === 'siege') {
    const crystalDistance = Math.hypot(
      INFLUENCE_CRYSTAL.x - enemy.position[0],
      INFLUENCE_CRYSTAL.z - enemy.position[2]
    );

    if (crystalDistance <= INFLUENCE_CRYSTAL_REACH) {
      attackCrystal(enemy, cfg, now);
      return;
    }

    const step = cfg.chaseSpeedFar * (INFLUENCE_TICK_MS / 1000) * enemySpeedMult(enemy, now);
    const dir = crystalDirection(enemy);
    if (!cityStepEnemy(enemy, dir[0], dir[1], step)) {
      cityStepEnemy(enemy, INFLUENCE_CRYSTAL.x - enemy.position[0], INFLUENCE_CRYSTAL.z - enemy.position[2], step);
    }
    nudgeIntoCity(enemy.position);
    return;
  }

  if (enemy.ambush === 'hidden') return;

  wardPatrol(enemy, cfg, now);
}

function wardPatrol(enemy, cfg, now) {
  if (cfg.patrolSpeed <= 0) return;

  const home = enemy.spawnPoint;
  const drift = Math.hypot(enemy.position[0] - home[0], enemy.position[2] - home[2]);

  if (drift > INFLUENCE_LEASH) {
    const step = cfg.chaseSpeedNear * (INFLUENCE_TICK_MS / 1000);
    cityStepEnemy(enemy, home[0] - enemy.position[0], home[2] - enemy.position[2], step);
    nudgeIntoCity(enemy.position);
    return;
  }

  if (!enemy.patrolTarget) {
    if (now < enemy.patrolWaitUntil) return;

    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * cfg.patrolRadius;
      const x = home[0] + Math.cos(angle) * radius;
      const z = home[2] + Math.sin(angle) * radius;
      if (!influenceGeometry.cityWalkable(x, z, 0.8)) continue;
      enemy.patrolTarget = [x, z];
      break;
    }

    if (!enemy.patrolTarget) {
      enemy.patrolWaitUntil = now + 2500;
      return;
    }
  }

  const dx = enemy.patrolTarget[0] - enemy.position[0];
  const dz = enemy.patrolTarget[1] - enemy.position[2];

  if (Math.hypot(dx, dz) < 1.2) {
    enemy.patrolTarget = null;
    enemy.patrolWaitUntil = now + 1500 + Math.random() * 4000;
    return;
  }

  const step = cfg.patrolSpeed * (INFLUENCE_TICK_MS / 1000);
  if (!cityStepEnemy(enemy, dx, dz, step)) enemy.patrolTarget = null;
  nudgeIntoCity(enemy.position);
}

function confessorPhase(enemy, cfg) {
  const fraction = enemy.maxHealth > 0 ? enemy.health / enemy.maxHealth : 1;
  let active = cfg.phases[0];
  for (const phase of cfg.phases) {
    if (fraction <= phase.from) active = phase;
  }
  return active;
}

function driveConfessor(candidates, enemy, cfg, now) {
  const phase = confessorPhase(enemy, cfg);

  if (enemy.phaseKey !== phase.key) {
    enemy.phaseKey = phase.key;
    enemy.summonAt = now;
    broadcastToLocation(INFLUENCE_LOCATION_ID, {
      type: 'wardBossPhase',
      enemyId: enemy.id,
      phase: phase.key,
      health: enemy.health,
      maxHealth: enemy.maxHealth,
    });
  }

  if (phase.summon && now - enemy.summonAt >= phase.summon.everyMs) {
    enemy.summonAt = now;
    summonConfessorAdds(phase.summon);
  }

  updateRangedBoss(candidates, enemy, cfg, now);
  nudgeIntoCity(enemy.position);
}

function summonConfessorAdds(summon) {
  const run = influenceRun;
  if (!run) return;

  const arena = INFLUENCE_CONFIG.bossArena;
  let live = 0;
  for (const enemy of run.enemies.values()) {
    if (enemy.alive && enemy.role === 'add') live++;
  }
  if (live >= 22) return;

  const place = () => {
    for (let attempt = 0; attempt < 24; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 12 + Math.random() * (arena.radius - 14);
      const x = arena.x + Math.cos(angle) * radius;
      const z = arena.z + Math.sin(angle) * radius;
      if (influenceGeometry.cityWalkable(x, z, 0.8)) return [x, influenceGeometry.FLOOR_Y, z];
    }
    return [arena.x, influenceGeometry.FLOOR_Y, arena.z + 12];
  };

  for (let i = 0; i < summon.walkers; i++) spawnWardEnemy('ward_walker', place(), 1.1, 1, 'add');
  for (let i = 0; i < summon.runners; i++) spawnWardEnemy('ward_runner', place(), 1.1, 1, 'add');
}

let crystalBroadcastAt = 0;

function broadcastCrystalHealth(sourceId) {
  crystalBroadcastAt = Date.now();

  broadcastToLocation(INFLUENCE_LOCATION_ID, {
    type: 'influenceCrystal',
    health: influenceState.crystalHealth,
    maxHealth: INFLUENCE_CONFIG.crystalMaxHealth,
    sourceId: sourceId ?? null,
  });
}

function damageCrystal(amount, sourceId) {
  if (amount <= 0) return;
  if (influenceState.crystalHealth <= 0) return;

  influenceState.crystalHealth = Math.max(0, influenceState.crystalHealth - amount);

  if (influenceState.crystalHealth <= 0) {
    broadcastCrystalHealth(sourceId);
    breakCrystal();
    return;
  }

  if (Date.now() - crystalBroadcastAt >= CRYSTAL_BROADCAST_MS) {
    broadcastCrystalHealth(sourceId);
    persistInfluenceState();
  }
}

function breakCrystal() {
  const occupants = influencePlayersIn();
  const lostFaction = influenceState.ownerFactionName;

  influenceState.ownerFactionId = null;
  influenceState.ownerFactionName = null;
  influenceState.ownerFactionSymbol = null;
  influenceState.ownerFactionImage = null;
  influenceState.feeCurrency = 'none';
  influenceState.feeAmount = 0;
  influenceState.feeTokenCa = null;
  influenceState.feeWallet = null;
  influenceState.capturedAt = 0;

  if (influenceRun) {
    influenceRun.capture = null;
    influenceRun.siege = null;
  }

  if (occupants.length === 0) {
    influenceState.phase = 'claimable';
    influenceState.crystalHealth = Math.round(INFLUENCE_CONFIG.crystalMaxHealth * 0.4);
    influenceState.nextSiegeAt = influence.scheduleNextSiege(influenceState.nextSiegeAt, Date.now());
    console.log(`[Influence] Crystal fell with nobody inside (${lostFaction || 'unowned'})`);
    persistInfluenceState(true);
    broadcastInfluenceState();
    return;
  }

  influenceState.status = 'collapsing';
  influenceState.phase = 'collapse';

  if (influenceRun) {
    influenceRun.collapseStartedAt = Date.now();
    influenceRun.siege = {
      mode: 'collapse',
      wave: 0,
      nextWaveAt: Date.now() + INFLUENCE_CONFIG.collapseGraceMs,
    };
  }

  console.log(`[Influence] Crystal broken — the ward is collapsing (${occupants.length} inside)`);
  persistInfluenceState(true);
  broadcastInfluenceState();
}

function influenceSiegeGate(index) {
  const gates = influenceGeometry.SIEGE_GATES;
  const gate = gates[index % gates.length];
  const spread = 5;

  for (let attempt = 0; attempt < 12; attempt++) {
    const x = gate.x + (Math.random() * 2 - 1) * spread;
    const z = gate.z + (Math.random() * 2 - 1) * spread;
    if (influenceGeometry.cityWalkable(x, z, 0.8)) return [x, influenceGeometry.FLOOR_Y, z];
  }

  return [gate.x, influenceGeometry.FLOOR_Y, gate.z];
}

function liveSiegeEnemies(run) {
  let count = 0;
  for (const enemy of run.enemies.values()) {
    if (enemy.alive && enemy.role === 'siege') count++;
  }
  return count;
}

function startSiegeWave(run, now) {
  const collapse = run.siege.mode === 'collapse';
  run.siege.wave += 1;

  const plan = collapse
    ? influence.collapseWaveComposition(run.siege.wave)
    : influence.siegeWaveComposition(run.siege.wave);

  const cap = collapse ? INFLUENCE_CONFIG.collapseMaxLive : INFLUENCE_CONFIG.siegeMaxLive;
  let budget = Math.max(0, cap - liveSiegeEnemies(run));
  let gate = Math.floor(Math.random() * influenceGeometry.SIEGE_GATES.length);

  const push = (type, count) => {
    for (let i = 0; i < count && budget > 0; i++) {
      spawnWardEnemy(type, influenceSiegeGate(gate++), plan.healthMult, plan.damageMult, 'siege');
      budget--;
    }
  };

  push('ward_brute', plan.brutes);
  push('ward_herald', plan.heralds);
  push('ward_runner', plan.runners);
  push('ward_walker', plan.walkers);

  run.siege.nextWaveAt = now + (collapse ? INFLUENCE_CONFIG.collapseWaveGapMs : INFLUENCE_CONFIG.siegeWaveGapMs);

  broadcastToLocation(INFLUENCE_LOCATION_ID, {
    type: 'influenceWave',
    wave: run.siege.wave,
    collapse,
    total: collapse ? 0 : INFLUENCE_CONFIG.siegeWaves,
  });
}

function beginSiege(now) {
  const occupants = influencePlayersIn();

  influenceState.nextSiegeAt = influence.scheduleNextSiege(influenceState.nextSiegeAt, now);

  if (!influenceState.ownerFactionId) {
    persistInfluenceState(true);
    broadcastInfluenceState();
    return;
  }

  if (occupants.length === 0) {
    console.log('[Influence] Siege resolved offline — the crystal falls');
    influenceState.crystalHealth = 0;
    breakCrystal();
    return;
  }

  const run = ensureInfluenceRun();
  run.siege = { mode: 'siege', wave: 0, nextWaveAt: now };
  influenceState.phase = 'siege';

  console.log(`[Influence] Siege begins against ${influenceState.ownerFactionName}`);
  persistInfluenceState(true);
  broadcastInfluenceState();
}

function endSiege(run) {
  run.siege = null;
  influenceState.phase = influenceState.ownerFactionId ? 'owned' : 'claimable';

  for (const [id, enemy] of Array.from(run.enemies.entries())) {
    if (enemy.role !== 'siege') continue;

    if (enemy.alive) {
      broadcastToLocation(INFLUENCE_LOCATION_ID, { type: 'enemyDeath', id, killerId: null });
    }
    run.enemies.delete(id);
  }

  broadcastToLocation(INFLUENCE_LOCATION_ID, { type: 'influenceWave', wave: 0, collapse: false, total: 0 });
  persistInfluenceState(true);
  broadcastInfluenceState();
}

function updateInfluenceCapture(run, occupants, now) {
  if (!influenceState.bossDefeated) {
    if (run.capture) {
      run.capture = null;
      broadcastCaptureState(null);
    }
    return;
  }
  if (influenceState.phase === 'collapse') return;

  const near = [];
  for (const player of occupants) {
    if (!player.alive) continue;
    const distance = Math.hypot(
      player.position[0] - INFLUENCE_CRYSTAL.x,
      player.position[2] - INFLUENCE_CRYSTAL.z
    );
    if (distance <= INFLUENCE_CONFIG.contestRadius) near.push({ player, distance });
  }

  const capture = run.capture;
  if (!capture) return;

  const holder = players.get(capture.playerId);
  const stillHere = holder
    && holder.authenticated
    && holder.alive
    && holder.locationId === INFLUENCE_LOCATION_ID
    && Math.hypot(holder.position[0] - INFLUENCE_CRYSTAL.x, holder.position[2] - INFLUENCE_CRYSTAL.z) <= INFLUENCE_CONFIG.captureRadius;

  if (!stillHere) {
    run.capture = null;
    broadcastCaptureState(null);
    return;
  }

  const contested = near.some((entry) => entry.player.influenceFactionId !== capture.factionId);
  if (contested) {
    capture.contestedUntil = now + 1500;
    capture.until += INFLUENCE_TICK_MS;
    broadcastCaptureState(capture);
    return;
  }

  if (now >= capture.until) {
    completeCapture(capture);
    return;
  }

  if (now - (capture.lastBroadcast || 0) > 900) {
    capture.lastBroadcast = now;
    broadcastCaptureState(capture);
  }
}

function broadcastCaptureState(capture) {
  broadcastToLocation(INFLUENCE_LOCATION_ID, {
    type: 'influenceCapture',
    factionId: capture?.factionId ?? null,
    factionName: capture?.factionName ?? null,
    playerId: capture?.playerId ?? null,
    until: capture?.until ?? 0,
    duration: INFLUENCE_CONFIG.captureMs,
    contested: capture ? capture.contestedUntil > Date.now() : false,
  });
}

function completeCapture(capture) {
  const run = influenceRun;
  if (!run) return;

  influenceState.ownerFactionId = capture.factionId;
  influenceState.ownerFactionName = capture.factionName;
  influenceState.ownerFactionSymbol = capture.factionSymbol;
  influenceState.ownerFactionImage = capture.factionImage;
  influenceState.feeCurrency = 'none';
  influenceState.feeAmount = 0;
  influenceState.feeTokenCa = null;
  influenceState.feeWallet = null;
  influenceState.phase = 'owned';
  influenceState.capturedAt = Date.now();
  influenceState.crystalHealth = INFLUENCE_CONFIG.crystalMaxHealth;
  influenceState.nextSiegeAt = influence.scheduleNextSiege(influenceState.nextSiegeAt, Date.now());

  run.capture = null;

  console.log(`[Influence] ${capture.factionName} now controls the ward`);
  broadcastCaptureState(null);
  broadcastToLocation(INFLUENCE_LOCATION_ID, {
    type: 'influenceCaptured',
    factionId: capture.factionId,
    factionName: capture.factionName,
  });

  persistInfluenceState(true);
  broadcastInfluenceState();
}

function repairCrystal(now) {
  if (influenceState.phase !== 'owned') return;
  if (influenceState.crystalHealth >= INFLUENCE_CONFIG.crystalMaxHealth) return;

  const perTick = (INFLUENCE_CONFIG.crystalRepairPerHour * INFLUENCE_TICK_MS) / (60 * 60 * 1000);
  influenceState.crystalRepairCarry = (influenceState.crystalRepairCarry || 0) + perTick;

  if (influenceState.crystalRepairCarry < 1) return;

  const healed = Math.floor(influenceState.crystalRepairCarry);
  influenceState.crystalRepairCarry -= healed;
  influenceState.crystalHealth = Math.min(
    INFLUENCE_CONFIG.crystalMaxHealth,
    influenceState.crystalHealth + healed
  );

  if (now - (influenceState.lastRepairBroadcast || 0) > 5000) {
    influenceState.lastRepairBroadcast = now;
    broadcastCrystalHealth(null);
    persistInfluenceState();
  }
}

function influenceRespawnAmbient(run, occupants, now) {
  for (const enemy of run.enemies.values()) {
    if (enemy.alive) continue;
    if (enemy.role !== 'ambient') continue;
    if (enemy.respawnAt === 0) {
      enemy.respawnAt = now + INFLUENCE_CONFIG.ambientRespawnMs;
      continue;
    }
    if (now < enemy.respawnAt) continue;

    let blocked = false;
    for (const player of occupants) {
      if (Math.hypot(player.position[0] - enemy.spawnPoint[0], player.position[2] - enemy.spawnPoint[2]) < 34) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    enemy.alive = true;
    enemy.health = enemy.maxHealth;
    enemy.position = [...enemy.spawnPoint];
    enemy.respawnAt = 0;
    enemy.targetId = null;
    enemy.pendingImpacts = [];
    enemy.pools = [];
    enemy.cast = null;
    if (ENEMY_TYPES[enemy.type].ambush) enemy.ambush = 'hidden';
  }
}

function serializeWardEnemies(run, player) {
  const list = [];

  for (const enemy of run.enemies.values()) {
    if (!enemy.alive) continue;

    const dx = enemy.position[0] - player.position[0];
    const dz = enemy.position[2] - player.position[2];
    if (dx * dx + dz * dz > INFLUENCE_AOI_RADIUS * INFLUENCE_AOI_RADIUS) continue;

    const entry = {
      id: enemy.id,
      type: enemy.type,
      position: [
        Math.round(enemy.position[0] * 100) / 100,
        enemy.position[1],
        Math.round(enemy.position[2] * 100) / 100,
      ],
      health: enemy.health,
      maxHealth: enemy.maxHealth,
      alive: true,
      targetId: enemy.targetId,
    };

    if (enemy.ambush === 'hidden') entry.state = 'hidden';
    else if (enemy.ambush === 'lunging') entry.state = 'lunge';

    list.push(entry);
  }

  return list;
}

function influenceTick() {
  if (!influenceState.loaded) return;

  const now = Date.now();

  if (influenceOpen() && influenceState.nextSiegeAt > 0 && now >= influenceState.nextSiegeAt
    && influenceState.phase !== 'siege' && influenceState.phase !== 'collapse') {
    beginSiege(now);
  }

  if (!influenceRun) return;

  const run = influenceRun;
  const occupants = influencePlayersIn();

  if (occupants.length === 0) {
    if (run.emptySince === 0) run.emptySince = now;

    if (influenceState.phase === 'collapse') {
      closeBreach('collapse cleared');
      resetInfluencePoint();
      persistInfluenceState(true);
      broadcastInfluenceState();
      return;
    }

    if (now - run.emptySince > CAVE_EMPTY_DISPOSE_MS) disposeInfluenceRun();
    return;
  }

  run.emptySince = 0;

  if (run.siege) {
    const collapse = run.siege.mode === 'collapse';

    if (collapse && now - run.collapseStartedAt > INFLUENCE_COLLAPSE_MAX_MS) {
      closeBreach('collapse timeout');
      resetInfluencePoint();
      persistInfluenceState(true);
      broadcastInfluenceState();
      return;
    }

    if (now >= run.siege.nextWaveAt) {
      if (!collapse && run.siege.wave >= INFLUENCE_CONFIG.siegeWaves && liveSiegeEnemies(run) === 0) {
        endSiege(run);
      } else if (!collapse && run.siege.wave >= INFLUENCE_CONFIG.siegeWaves) {
        run.siege.nextWaveAt = now + 4000;
      } else {
        startSiegeWave(run, now);
      }
    }
  }

  updateInfluenceCapture(run, occupants, now);
  influenceRespawnAmbient(run, occupants, now);
  repairCrystal(now);

  for (const enemy of run.enemies.values()) {
    if (!enemy.alive) continue;
    const cfg = ENEMY_TYPES[enemy.type];

    if (enemy.id === run.bossId) {
      if (cfg.regenPerSecond && cfg.arena) regenerateWardBoss(enemy, cfg, occupants, now);
      driveConfessor(occupants, enemy, cfg, now);
    } else if (cfg.ranged) {
      driveWardHerald(occupants, enemy, cfg, now);
    } else {
      driveWardEnemy(occupants, enemy, cfg, now);
    }

    enemy.positionHistory.push({ position: [...enemy.position], time: now });
    enemy.positionHistory = enemy.positionHistory.filter((p) => now - p.time < 1000);
  }

  for (const player of occupants) {
    safeSend(player.ws, { type: 'enemyState', enemies: serializeWardEnemies(run, player) });
  }
}

function regenerateWardBoss(enemy, cfg, occupants, now) {
  if (enemy.health >= enemy.maxHealth) return;
  if (now - (enemy.lastHitAt || 0) < cfg.regenIdleMs) return;

  const arena = cfg.arena;
  for (const player of occupants) {
    if (!player.alive) continue;
    if (Math.hypot(player.position[0] - arena.x, player.position[2] - arena.z) <= arena.radius) return;
  }

  const healed = Math.min(
    enemy.maxHealth - enemy.health,
    Math.ceil((cfg.regenPerSecond * INFLUENCE_TICK_MS) / 1000)
  );
  if (healed <= 0) return;

  enemy.health += healed;
  enemy.provokedBy = null;
  enemy.provokedUntil = 0;

  if (now - (enemy.regenBroadcastAt || 0) < 500) return;
  enemy.regenBroadcastAt = now;

  broadcastToLocation(
    INFLUENCE_LOCATION_ID,
    { type: 'enemyDamaged', id: enemy.id, health: enemy.health, attackerId: null, point: enemy.position, abilityId: null }
  );
}

const INFLUENCE_ENTRY_DENIED = {
  closed: 'g.err.influence.closed',
  solo: 'g.err.influence.factionOnly',
  full: 'g.err.influence.full',
  ownerFull: 'g.err.influence.ownerFull',
  collapsing: 'g.err.influence.collapsing',
  fee: 'g.err.influence.fee',
  payment: 'g.err.influence.payment',
};

function playerInfluenceFaction(player) {
  if (!player.factions?.length) return null;

  const displayed = player.factions.find((f) => f.isDisplayed) || player.factions[0];
  if (!displayed) return null;

  return {
    id: displayed.id,
    name: displayed.name || 'Faction',
    symbol: displayed.symbol || null,
    image: displayed.image || null,
  };
}

function influenceEntryVerdict(player) {
  if (!influenceOpen()) return { ok: false, reason: 'closed' };
  if (influenceState.status === 'collapsing') return { ok: false, reason: 'collapsing' };

  const faction = playerInfluenceFaction(player);
  if (!faction) return { ok: false, reason: 'solo' };

  const occupants = influencePlayersIn(player.id);
  if (occupants.length >= INFLUENCE_CONFIG.capacity) return { ok: false, reason: 'full' };

  if (influenceState.ownerFactionId && faction.id === influenceState.ownerFactionId) {
    if (influenceOwnerCount() >= INFLUENCE_CONFIG.ownerCapacity) return { ok: false, reason: 'ownerFull' };
  }

  const owned = influenceState.ownerFactionId !== null;
  const isOwner = owned && faction.id === influenceState.ownerFactionId;
  const chargeable = owned && !isOwner && influence.feeIsPayable(influenceState);

  return {
    ok: true,
    faction,
    fee: chargeable
      ? {
        currency: influenceState.feeCurrency,
        amount: influenceState.feeAmount,
        tokenCa: influenceState.feeTokenCa,
        wallet: influenceState.feeWallet,
      }
      : null,
  };
}

function sendInfluenceGate(player) {
  const verdict = influenceEntryVerdict(player);

  safeSend(player.ws, {
    type: 'influenceGate',
    allowed: verdict.ok,
    reason: verdict.ok ? null : verdict.reason,
    messageKey: verdict.ok ? null : INFLUENCE_ENTRY_DENIED[verdict.reason] || null,
    fee: verdict.ok ? verdict.fee : null,
    factionId: verdict.ok ? verdict.faction.id : null,
    factionName: verdict.ok ? verdict.faction.name : null,
    ownerFactionId: influenceState.ownerFactionId,
    ownerFactionName: influenceState.ownerFactionName,
    occupants: influencePlayersIn().length,
    capacity: INFLUENCE_CONFIG.capacity,
    phase: influenceState.phase,
  });
}

function onlinePlayerByWallet(wallet) {
  if (!wallet) return null;

  let found = null;
  players.forEach((p) => {
    if (found) return;
    if (p.authenticated && p.wallet === wallet) found = p;
  });
  return found;
}

async function chargeInfluenceEntry(player, fee, tx) {
  if (!fee) return { ok: true, paid: 0 };

  if (fee.currency === 'ash') {
    const amount = Math.ceil(fee.amount);
    if (player.ash < amount) return { ok: false, reason: 'fee' };

    const recipient = onlinePlayerByWallet(influenceState.feeWallet);

    const result = await callInternalApi('/api/internal/game/influence-entry', {
      userId: player.userId,
      gameId: player.gameId,
      wallet: player.wallet,
      currency: 'ash',
      amount,
      recipientWallet: influenceState.feeWallet,
      recipientOnline: !!recipient,
      factionId: influenceState.ownerFactionId,
    }).catch((err) => {
      console.error('[Influence] ash entry error:', err.message);
      return null;
    });

    if (!result?.success) return { ok: false, reason: 'payment' };

    player.ash -= amount;
    player.economyChangedAt = Date.now();
    persistPlayer(player);
    safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });

    if (recipient) {
      recipient.ash += amount;
      recipient.economyChangedAt = Date.now();
      persistPlayer(recipient);
      safeSend(recipient.ws, { type: 'inventoryUpdate', inventory: recipient.inventory, ash: recipient.ash, placeables: recipient.placeables });
      safeSend(recipient.ws, { type: 'influenceToll', amount, currency: 'ash', payer: player.nickname });
    }

    return { ok: true, paid: amount };
  }

  if (typeof tx !== 'string' || tx.length < 32) return { ok: false, reason: 'payment' };

  const result = await callInternalApi('/api/internal/game/influence-entry', {
    userId: player.userId,
    gameId: player.gameId,
    wallet: player.wallet,
    currency: fee.currency,
    amount: fee.amount,
    tokenCa: fee.tokenCa,
    recipientWallet: influenceState.feeWallet,
    recipientOnline: !!onlinePlayerByWallet(influenceState.feeWallet),
    factionId: influenceState.ownerFactionId,
    tx,
  }).catch((err) => {
    console.error('[Influence] onchain entry error:', err.message);
    return null;
  });

  if (!result?.success) return { ok: false, reason: 'payment' };

  const recipient = onlinePlayerByWallet(influenceState.feeWallet);
  if (recipient) {
    safeSend(recipient.ws, {
      type: 'influenceToll',
      amount: fee.amount,
      currency: fee.currency,
      payer: player.nickname,
    });
  }

  return { ok: true, paid: fee.amount, tx };
}

function enterInfluence(player) {
  const run = ensureInfluenceRun();
  const faction = playerInfluenceFaction(player);

  player.influenceEntryToken = 0;

  player.influenceFactionId = faction?.id ?? null;
  player.influenceFactionName = faction?.name ?? null;
  player.influenceLootTaken = 0;
  player.influenceEnteredAt = Date.now();

  grantSpawnProtection(player, INFLUENCE_CONFIG.spawnProtectionMs);

  safeSend(player.ws, { type: 'enemyState', enemies: serializeWardEnemies(run, player) });
  safeSend(player.ws, buildInfluenceStatePayload());
  safeSend(player.ws, {
    type: 'influenceLootState',
    opened: Array.from(run.containers.entries())
      .filter(([, entry]) => entry.openedBy.has(player.userId))
      .map(([id]) => id),
    taken: player.influenceLootTaken,
    perVisit: INFLUENCE_CONFIG.lootPerVisit,
  });

  broadcastInfluenceState();
}

function leaveInfluence(player) {
  safeSend(player.ws, { type: 'enemyState', enemies: [] });

  const run = influenceRun;
  player.influenceFactionId = null;
  player.influenceFactionName = null;

  if (run?.capture?.playerId === player.id) {
    run.capture = null;
    broadcastCaptureState(null);
  }

  broadcastInfluenceState();
}

function influenceCrystalPrompt(player) {
  const run = influenceRun;
  if (!run) return;

  const distance = Math.hypot(
    player.position[0] - INFLUENCE_CRYSTAL.x,
    player.position[2] - INFLUENCE_CRYSTAL.z
  );

  const manageable = influenceState.ownerFactionId
    && player.influenceFactionId === influenceState.ownerFactionId
    && player.factions?.some((f) => f.id === influenceState.ownerFactionId
      && (f.founderUserId === player.userId || f.verifiedCreatorUserId === player.userId));

  safeSend(player.ws, {
    type: 'influenceCrystalPanel',
    inRange: distance <= INFLUENCE_CONFIG.captureRadius,
    canCapture: influenceState.bossDefeated
      && influenceState.phase !== 'collapse'
      && !!player.influenceFactionId
      && player.influenceFactionId !== influenceState.ownerFactionId,
    canManage: !!manageable,
    bossDefeated: influenceState.bossDefeated,
    ownerFactionId: influenceState.ownerFactionId,
    ownerFactionName: influenceState.ownerFactionName,
    feeCurrency: influenceState.feeCurrency,
    feeAmount: influenceState.feeAmount,
    crystalHealth: influenceState.crystalHealth,
    crystalMaxHealth: INFLUENCE_CONFIG.crystalMaxHealth,
    nextSiegeAt: influenceState.nextSiegeAt,
    captureMs: INFLUENCE_CONFIG.captureMs,
  });
}

function startInfluenceCapture(player) {
  const run = influenceRun;
  if (!run) return;
  if (!influenceState.bossDefeated) {
    safeSend(player.ws, { type: 'error', message: 'The crystal is still sealed.', messageKey: 'g.err.influence.sealed' });
    return;
  }
  if (influenceState.phase === 'collapse') return;
  if (!player.influenceFactionId) {
    safeSend(player.ws, { type: 'error', message: 'Only faction members can bind the crystal.', messageKey: 'g.err.influence.factionOnly' });
    return;
  }
  if (player.influenceFactionId === influenceState.ownerFactionId) return;

  const distance = Math.hypot(
    player.position[0] - INFLUENCE_CRYSTAL.x,
    player.position[2] - INFLUENCE_CRYSTAL.z
  );
  if (distance > INFLUENCE_CONFIG.captureRadius) return;

  if (run.capture && run.capture.factionId === player.influenceFactionId) {
    run.capture.playerId = player.id;
    return;
  }

  const faction = playerInfluenceFaction(player);
  const now = Date.now();

  run.capture = {
    factionId: player.influenceFactionId,
    factionName: faction?.name ?? player.influenceFactionName ?? 'Faction',
    factionSymbol: faction?.symbol ?? null,
    factionImage: faction?.image ?? null,
    playerId: player.id,
    startedAt: now,
    until: now + INFLUENCE_CONFIG.captureMs,
    contestedUntil: 0,
    lastBroadcast: 0,
  };

  broadcastCaptureState(run.capture);
}

function cancelInfluenceCapture(player) {
  const run = influenceRun;
  if (!run?.capture) return;
  if (run.capture.playerId !== player.id) return;

  run.capture = null;
  broadcastCaptureState(null);
}

async function setInfluenceFee(player, data) {
  if (!influenceState.ownerFactionId) return;
  if (player.influenceFactionId !== influenceState.ownerFactionId) return;

  const faction = player.factions?.find((f) => f.id === influenceState.ownerFactionId);
  if (!faction) return;
  if (faction.founderUserId !== player.userId && faction.verifiedCreatorUserId !== player.userId) {
    safeSend(player.ws, { type: 'error', message: 'Only the faction head can set this.', messageKey: 'g.err.influence.leaderOnly' });
    return;
  }

  const currency = typeof data.currency === 'string' && influence.FEE_CURRENCIES.has(data.currency)
    ? data.currency
    : 'none';
  const amount = Math.max(0, Math.min(INFLUENCE_CONFIG.entryFeeMax, Math.floor(Number(data.amount) || 0)));

  if (currency === 'faction' && !faction.tokenCa) {
    safeSend(player.ws, { type: 'error', message: 'This faction has no token.', messageKey: 'g.err.influence.noToken' });
    return;
  }

  influenceState.feeCurrency = amount > 0 ? currency : 'none';
  influenceState.feeAmount = influenceState.feeCurrency === 'none' ? 0 : amount;
  influenceState.feeTokenCa = currency === 'faction' ? faction.tokenCa : null;
  influenceState.feeWallet = faction.verifiedCreatorWallet || faction.founderWallet || null;

  persistInfluenceState(true);
  broadcastInfluenceState();
  influenceCrystalPrompt(player);

  console.log(`[Influence] ${influenceState.ownerFactionName} set entry ${influenceState.feeCurrency} ${influenceState.feeAmount}`);
}

async function openInfluenceContainer(player, containerId) {
  const run = influenceRun;
  if (!run) return;
  if (typeof containerId !== 'string') return;

  const container = run.containers.get(containerId);
  if (!container) return;

  const spot = influenceGeometry.LOOT.find((entry) => entry.id === containerId);
  if (!spot) return;

  const distance = Math.hypot(player.position[0] - spot.x, player.position[2] - spot.z);
  if (distance > INFLUENCE_CONFIG.lootReach + 1.5) return;

  const now = Date.now();
  if (container.reopenAt > 0 && now >= container.reopenAt) {
    container.openedBy.clear();
    container.reopenAt = 0;
  }

  if (container.openedBy.has(player.userId)) {
    safeSend(player.ws, { type: 'error', message: 'Already searched.', messageKey: 'g.err.chestEmpty' });
    return;
  }

  if (player.influenceLootTaken >= INFLUENCE_CONFIG.lootPerVisit) {
    safeSend(player.ws, { type: 'error', message: 'You cannot carry more from this run.', messageKey: 'g.err.influence.lootCap' });
    return;
  }

  container.openedBy.add(player.userId);
  if (container.reopenAt === 0) container.reopenAt = now + INFLUENCE_CONFIG.lootReopenMs;
  player.influenceLootTaken += 1;

  const rare = spot.tier >= 2;
  const ash = rare
    ? 130 + crypto.randomInt(0, 110)
    : 45 + crypto.randomInt(0, 45);

  const companionFragments = crypto.randomInt(0, 100) < (rare ? 62 : 26)
    ? (rare ? 12 + crypto.randomInt(0, 14) : 5 + crypto.randomInt(0, 8))
    : 0;
  const cosmeticFragments = crypto.randomInt(0, 100) < (rare ? 62 : 26)
    ? (rare ? 12 + crypto.randomInt(0, 14) : 5 + crypto.randomInt(0, 8))
    : 0;

  player.ash += ash;
  player.economyChangedAt = now;
  persistPlayer(player);

  if (companionFragments > 0) await grantCanyonBossFragments(player, companionFragments);
  if (cosmeticFragments > 0) await grantCanyonCosmeticFragments(player, cosmeticFragments);

  broadcastToLocation(INFLUENCE_LOCATION_ID, { type: 'influenceContainerOpened', containerId, playerId: player.id });

  safeSend(player.ws, {
    type: 'influenceLootResult',
    containerId,
    tier: spot.tier,
    ash,
    companionFragments,
    cosmeticFragments,
    taken: player.influenceLootTaken,
    perVisit: INFLUENCE_CONFIG.lootPerVisit,
  });
  safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });
}

async function rewardConfessorKill(killer) {
  const occupants = influencePlayersIn();

  for (const player of occupants) {
    if (!player.userId) continue;

    const ash = player.id === killer?.id ? 4000 : 2200;
    player.ash += ash;
    player.economyChangedAt = Date.now();
    persistPlayer(player);

    await grantCanyonBossFragments(player, 45 + crypto.randomInt(0, 30));
    await grantCanyonCosmeticFragments(player, 45 + crypto.randomInt(0, 30));
    grantXp(player, 900, 'influence_boss');

    safeSend(player.ws, { type: 'influenceBossReward', ash, killer: player.id === killer?.id });
    safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });
  }
}

function onConfessorDefeated(killer) {
  influenceState.bossDefeated = true;
  influenceState.phase = influenceState.ownerFactionId ? 'owned' : 'claimable';

  if (influenceRun) influenceRun.bossId = null;

  console.log('[Influence] The Pale Confessor has fallen');
  persistInfluenceState(true);
  broadcastInfluenceState();

  broadcastToLocation(INFLUENCE_LOCATION_ID, {
    type: 'influenceBossDown',
    killerFactionId: killer?.influenceFactionId ?? null,
    killerFactionName: killer?.influenceFactionName ?? null,
  });

  rewardConfessorKill(killer).catch((err) => console.error('[Influence] boss reward error:', err.message));
}

function wardRangedAttack(occupants, enemy, cfg, target, distance, now) {
  processBossImpacts(occupants, enemy, now);
  processBossPools(occupants, enemy, now);

  if (enemy.cast) {
    if (now >= enemy.cast.resolveAt) {
      resolveBossCast(occupants, enemy, enemy.cast, now);
      enemy.attackCooldowns[enemy.cast.attack.id] = now;
      enemy.cast = null;
    }
    return true;
  }

  if (!target) return false;
  if (abilities.isStunned(enemy, now)) return true;
  if (now - enemy.lastAttackTime < cfg.attackCooldown) return false;

  const attack = pickBossAttack(enemy, cfg, distance, now);
  if (!attack) return false;

  enemy.lastAttackTime = now;
  enemy.cast = {
    attack,
    resolveAt: now + attack.windup,
    aim: [target.position[0], 0, target.position[2]],
  };

  const castMessage = {
    type: 'bossCast',
    enemyId: enemy.id,
    attack: attack.id,
    windup: attack.windup,
    aim: enemy.cast.aim,
    radius: attack.radius,
  };
  for (const spectator of occupants) safeSend(spectator.ws, castMessage);
  return true;
}

function driveWardHerald(occupants, enemy, cfg, now) {
  const chosen = wardTargetFor(occupants, enemy, cfg, now);
  const target = chosen ? chosen.player : null;
  const distance = chosen ? chosen.dist : Infinity;

  enemy.targetId = target ? target.id : null;

  const casting = wardRangedAttack(occupants, enemy, cfg, target, distance, now);

  if (target) {
    const drift = distance - cfg.preferredRange;
    if (!casting && Math.abs(drift) > 3.5) {
      const speed = Math.abs(drift) > cfg.chaseNearThreshold ? cfg.chaseSpeedFar : cfg.chaseSpeedNear;
      const step = speed * (INFLUENCE_TICK_MS / 1000) * Math.sign(drift) * enemySpeedMult(enemy, now);
      cityStepEnemy(enemy, (target.position[0] - enemy.position[0]) * Math.sign(step), (target.position[2] - enemy.position[2]) * Math.sign(step), Math.abs(step));
    }
    nudgeIntoCity(enemy.position);
    return;
  }

  if (enemy.role === 'siege') {
    const crystalDistance = Math.hypot(
      INFLUENCE_CRYSTAL.x - enemy.position[0],
      INFLUENCE_CRYSTAL.z - enemy.position[2]
    );

    if (crystalDistance <= INFLUENCE_CRYSTAL_REACH + 4) {
      attackCrystal(enemy, cfg, now);
      nudgeIntoCity(enemy.position);
      return;
    }

    const step = cfg.chaseSpeedFar * (INFLUENCE_TICK_MS / 1000) * enemySpeedMult(enemy, now);
    const dir = crystalDirection(enemy);
    cityStepEnemy(enemy, dir[0], dir[1], step);
  }

  nudgeIntoCity(enemy.position);
}

safeInterval(influenceTick, INFLUENCE_TICK_MS);
safeInterval(pollInfluenceCommands, INFLUENCE_COMMAND_POLL_MS);


function isArenaMemberPresent(run, member) {
  if (!member || !member.authenticated) return false;
  return member.locationId === ARENA_LOCATION_ID && member.instance === run.instance;
}

function arenaMembersInPlay(run) {
  const list = [];
  for (const id of arena.activeMembers(run)) {
    const member = players.get(id);
    if (isArenaMemberPresent(run, member)) list.push(member);
  }
  return list;
}

function broadcastArena(run, message) {
  for (const id of run.memberIds) {
    const member = players.get(id);
    if (member) safeSend(member.ws, message);
  }
}

function arenaStatePayload(run) {
  return {
    type: 'arenaState',
    runId: run.id,
    phase: run.phase,
    wave: run.wave,
    phaseUntil: run.phaseUntil,
    candleHealth: run.candleHealth,
    candleMaxHealth: arena.ARENA_CONFIG.candleHealth,
    members: run.memberIds.map((id) => ({
      id,
      nickname: players.get(id)?.nickname || 'Unknown',
      down: run.downIds.has(id),
      left: run.leftIds.has(id),
    })),
  };
}

function broadcastArenaState(run) {
  broadcastArena(run, arenaStatePayload(run));
}

function sendArenaEnemies(run) {
  const payload = { type: 'enemyState', enemies: serializeEnemies(run.enemies) };
  for (const member of arenaMembersInPlay(run)) safeSend(member.ws, payload);
}

function arenaSpawnPoint(index) {
  const gates = arena.ARENA_CONFIG.spawnGates;
  const gate = gates[index % gates.length];
  const spread = 3;
  return [
    gate[0] + (Math.random() * 2 - 1) * spread,
    0,
    gate[2] + (Math.random() * 2 - 1) * spread,
  ];
}

function startArenaWave(run, now) {
  run.wave += 1;
  run.phase = 'wave';
  run.phaseUntil = 0;

  const plan = arena.waveComposition(run.wave);
  const biome = CANYON_BIOMES[plan.biomeIndex];

  for (let i = 0; i < plan.mobs; i++) {
    spawnEnemyInto(run.enemies, `arena-${run.id}`, run.nextEnemySeq++, biome.mob, arenaSpawnPoint(i), plan.healthMult, plan.damageMult);
  }
  for (let i = 0; i < plan.bosses; i++) {
    spawnEnemyInto(run.enemies, `arena-${run.id}`, run.nextEnemySeq++, biome.boss, arenaSpawnPoint(i + 2), plan.healthMult, plan.damageMult);
  }

  broadcastArena(run, {
    type: 'arenaWaveStart',
    wave: run.wave,
    boss: plan.bosses > 0,
    biome: biome.key,
    enemies: plan.mobs + plan.bosses,
  });
  broadcastArenaState(run);
  sendArenaEnemies(run);
}

function finishArenaRun(run, reason, now) {
  const cleared = run.wavesCleared;
  const config = eventConfigFor('arena');
  const reward = arena.rewardsFor(cleared, config);
  const cooldownMs = Math.max(0, Math.round((config?.cooldownMinutes ?? arena.ARENA_CONFIG.cooldownMs / 60000) * 60000));
  const participants = [];

  for (const id of run.memberIds) {
    const member = players.get(id);
    if (!member) continue;

    if (cleared > 0) {
      member.ash += reward.ash;
      member.economyChangedAt = now;
      grantXp(member, reward.xp, 'arena');
      if (cleared > (member.arenaBestWave || 0)) member.arenaBestWave = cleared;
      if (member.userId && member.wallet) {
        participants.push({ userId: member.userId, wallet: member.wallet, ash: reward.ash, xp: reward.xp });
      }
    }

    member.arenaCooldownUntil = now + cooldownMs;
    member.arenaReviveUntil = 0;
    member.arenaReviveTargetId = null;

    safeSend(member.ws, {
      type: 'arenaEnded',
      reason,
      wavesCleared: cleared,
      ash: cleared > 0 ? reward.ash : 0,
      xp: cleared > 0 ? reward.xp : 0,
      bestWave: member.arenaBestWave || 0,
      cooldownUntil: member.arenaCooldownUntil,
    });
    safeSend(member.ws, { type: 'inventoryUpdate', inventory: member.inventory, ash: member.ash, placeables: member.placeables });
    safeSend(member.ws, { type: 'enemyState', enemies: [] });
    persistPlayer(member);
  }

  recordEventRun(run, 'arena', cleared, participants, now);
  arena.endRun(run);
}

function recordEventRun(run, eventId, wavesCleared, participants, now) {
  if (wavesCleared <= 0 || participants.length === 0) return;

  const gameId = players.get(run.memberIds[0])?.gameId;
  if (!gameId) return;

  callInternalApi('/api/internal/game/event-run', {
    gameId,
    eventId,
    wavesCleared,
    partySize: run.memberIds.length,
    durationSeconds: Math.max(0, Math.round((now - run.startedAt) / 1000)),
    participants,
  }).catch((err) => console.error('[Events] run record error:', err.message));
}

function damageCandle(run, enemy, now) {
  if (run.candleHealth <= 0) return;

  const damage = Math.max(1, Math.round(enemy.attackDamage * enemyDamageOutputMult(enemy, now)));
  run.candleHealth = Math.max(0, run.candleHealth - damage);

  broadcastArena(run, {
    type: 'arenaCandleDamage',
    damage,
    health: run.candleHealth,
    maxHealth: arena.ARENA_CONFIG.candleHealth,
    attackerId: enemy.id,
  });
}

function nearestArenaTarget(run, enemy, cfg) {
  let best = null;
  let bestDistance = Infinity;

  for (const member of arenaMembersInPlay(run)) {
    if (!member.alive || run.downIds.has(member.id)) continue;

    const dx = member.position[0] - enemy.position[0];
    const dz = member.position[2] - enemy.position[2];
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (distance > cfg.aggroRadius || distance >= bestDistance) continue;

    best = member;
    bestDistance = distance;
  }

  return best ? { player: best, distance: bestDistance } : null;
}

function moveArenaEnemy(run, enemy, cfg, now) {
  const target = nearestArenaTarget(run, enemy, cfg);
  const step = (dx, dz, dist, speed) => {
    const len = dist || 1;
    const move = speed * (CANYON_CONFIG.tickRate / 1000) * enemySpeedMult(enemy, now);
    enemy.position[0] += (dx / len) * move;
    enemy.position[2] += (dz / len) * move;
    clampToArena(enemy.position, { x: 0, z: 0, radius: arena.ARENA_CONFIG.arenaRadius });
  };

  if (target) {
    enemy.targetId = target.player.id;
    const dx = target.player.position[0] - enemy.position[0];
    const dz = target.player.position[2] - enemy.position[2];

    if (target.distance > cfg.attackRange) {
      step(dx, dz, target.distance, target.distance > cfg.chaseNearThreshold ? cfg.chaseSpeedFar : cfg.chaseSpeedNear);
    } else if (now - enemy.lastAttackTime >= cfg.attackCooldown && !abilities.isStunned(enemy, now)) {
      enemy.lastAttackTime = now;
      damagePlayerByCanyonEnemy(target.player, enemy);
    }
    return;
  }

  enemy.targetId = null;

  const candle = arena.ARENA_CONFIG.candlePosition;
  const dx = candle[0] - enemy.position[0];
  const dz = candle[2] - enemy.position[2];
  const distance = Math.sqrt(dx * dx + dz * dz);

  if (distance > cfg.attackRange + 1) {
    step(dx, dz, distance, cfg.chaseSpeedNear);
  } else if (now - enemy.lastAttackTime >= cfg.attackCooldown && !abilities.isStunned(enemy, now)) {
    enemy.lastAttackTime = now;
    damageCandle(run, enemy, now);
  }
}

function tickArenaRun(run, now) {
  for (const id of arena.activeMembers(run)) {
    if (!isArenaMemberPresent(run, players.get(id))) arena.dropMember(run, id);
  }

  if (arena.isOver(run)) {
    finishArenaRun(run, run.candleHealth <= 0 ? 'candle_lost' : 'wiped', now);
    return;
  }

  if (run.phase === 'prep') {
    if (now >= run.phaseUntil) startArenaWave(run, now);
    return;
  }

  if (run.phase === 'pause') {
    if (now >= run.phaseUntil) startArenaWave(run, now);
    return;
  }

  let living = 0;
  for (const enemy of run.enemies.values()) {
    if (!enemy.alive) continue;
    living += 1;

    moveArenaEnemy(run, enemy, ENEMY_TYPES[enemy.type], now);
    enemy.positionHistory.push({ position: [...enemy.position], time: now });
    enemy.positionHistory = enemy.positionHistory.filter((p) => now - p.time < 1000);
  }

  if (living === 0) {
    run.enemies.clear();
    run.wavesCleared = run.wave;
    run.phase = 'pause';
    run.phaseUntil = now + arena.ARENA_CONFIG.pauseMs;

    broadcastArena(run, { type: 'arenaWaveEnd', wave: run.wave, pauseUntil: run.phaseUntil });
    broadcastArenaState(run);
    sendArenaEnemies(run);
    return;
  }

  sendArenaEnemies(run);
}

function arenaTick() {
  const now = Date.now();
  for (const run of arena.allRuns()) tickArenaRun(run, now);
}

safeInterval(arenaTick, CANYON_CONFIG.tickRate);

function defusalNicknames(match) {
  const names = new Map();
  for (const id of match.members.keys()) {
    names.set(id, players.get(id)?.nickname ?? 'Player');
  }
  return names;
}

function broadcastDefusal(match, payload) {
  for (const id of match.members.keys()) {
    const player = players.get(id);
    if (player) safeSend(player.ws, payload);
  }
}

function broadcastDefusalState(match) {
  broadcastDefusal(match, defusal.serializeMatch(match, defusalNicknames(match)));
}

function broadcastQueueState() {
  const payload = defusal.serializeQueue();
  players.forEach((player) => {
    if (player.authenticated && (player.locationId === EVENTS_LOBBY_ID || defusal.isQueued(player.id))) {
      safeSend(player.ws, payload);
    }
  });
}

const DUST2_ZONE_MULT = { head: 4, chest: 1, stomach: 1.25, legs: 0.75 };
const DUST2_FALLOFF_METRES = 12.7;
const DUST2_GUN_SLOTS = new Set(['primary', 'pistol']);

function dust2MemberOf(player) {
  if (!player) return null;

  const grinderMatch = grinder.matchOf(player.id);
  if (grinderMatch) {
    return {
      mode: 'grinder',
      match: grinderMatch,
      member: grinderMatch.members.get(player.id) ?? null,
      config: grinder.GRINDER_CONFIG,
    };
  }

  const defusalMatch = defusal.matchOf(player.id);
  if (defusalMatch) {
    return {
      mode: 'defusal',
      match: defusalMatch,
      member: defusalMatch.members.get(player.id) ?? null,
      config: defusal.DEFUSAL_CONFIG,
    };
  }

  return null;
}

function dust2GunOf(entry) {
  const item = entry?.member ? defusal.heldItem(entry.member) : null;
  return item && DUST2_GUN_SLOTS.has(item.slot) ? item : null;
}

function dust2WeaponConfig(item) {
  return {
    fireRateMs: item.fireRateMs,
    fireRateToleranceMs: 20,
    maxRange: item.maxRange,
    boltEnergyCost: 0,
  };
}

function dust2HitZone(point, targetPosition) {
  const height = point[1] - targetPosition[1];
  if (height > 1.35) return 'head';
  if (height > 1) return 'chest';
  if (height > 0.6) return 'stomach';
  return 'legs';
}

function syncArsenalAmmo(player, member, weapon, now = Date.now()) {
  if (!member.ammo) member.ammo = {};

  const previous = player.defusalWeaponId;
  if (previous && Number.isFinite(player.weaponAmmo)) member.ammo[previous] = player.weaponAmmo;

  if (!weapon) {
    player.weaponAmmo = 0;
    return;
  }

  const stored = member.ammo[weapon.id];
  player.weaponAmmo = Number.isFinite(stored) ? Math.min(stored, weapon.magSize) : weapon.magSize;
  if (player.weaponAmmo <= 0) player.ammoEmptyAt = now;
}

function refillArsenalAmmo(member, itemId) {
  if (!member) return;
  if (!member.ammo) member.ammo = {};
  if (itemId) delete member.ammo[itemId];
  else member.ammo = {};
}

function applyArsenalLoadout(player) {
  const entry = dust2MemberOf(player);
  if (!entry || !entry.member) return;

  const { member, config } = entry;
  const weapon = defusal.heldItem(member);
  const holdingGrenade = defusal.isHoldingGrenade(member);

  syncArsenalAmmo(player, member, holdingGrenade ? null : dust2GunOf(entry));

  player.combat = {
    ...player.combat,
    weapon: 'rifle',
    maxHealth: config.baseHealth,
    moveSpeedMult: holdingGrenade ? 1.06 : weapon?.moveSpeedMult ?? 1,
    enemyDamage: holdingGrenade ? 0 : weapon?.damage ?? 26,
    pvpDamage: holdingGrenade ? 0 : weapon?.damage ?? 26,
    magSize: holdingGrenade ? 0 : weapon?.magSize || 0,
    reloadMs: weapon?.reloadMs || 2100,
    armorPen: weapon?.armorPen ?? 0.5,
    damageTakenMult: 1,
    lowHealthDamageTakenMult: 1,
    damageVsUnshielded: 0,
    healOnKill: 0,
    energyOnKill: 0,
    shieldStrength: 0,
    postShieldRegen: 0,
    postDashSpeed: 0,
    postDashDamageTaken: 0,
    reloadWhileDashing: false,
    allyDamageInZone: 0,
    markedAllyFireRate: 0,
    bleedDamage: 0,
    bleedDurationMs: 0,
    clusterCount: 0,
    clusterDamage: 0,
    ricochetChance: 0,
    ricochetDamage: 0,
    explosiveEveryNthShot: 0,
    explosiveDamage: 0,
    explosiveRadius: 0,
    burnDamage: 0,
    burnDurationMs: 0,
  };

  player.maxHealth = config.baseHealth;
  player.defusalLocked = true;
  player.defusalWeaponId = weapon?.id ?? null;
  player.defusalHolding = member?.held ?? 'pistol';

  safeSend(player.ws, buildProgressionPayload(player));
}

function applyDefusalLoadout(player) {
  applyArsenalLoadout(player);
}

function clearDefusalLoadout(player) {
  if (!player) return;
  player.defusalLocked = false;
  player.defusalWeaponId = null;
  refreshCombatStats(player);
  player.weaponAmmo = player.combat.magSize;
  player.ammoEmptyAt = 0;
  safeSend(player.ws, buildProgressionPayload(player));
}


function arsenalDamage(attacker, target, zone, distance) {
  const targetEntry = dust2MemberOf(target);
  const member = targetEntry?.member;
  if (!member) return 0;

  const attackerEntry = dust2MemberOf(attacker);
  const weapon = attackerEntry ? defusal.heldItem(attackerEntry.member) : null;
  const config = targetEntry.config;

  const zoneMult = zone === 'head' ? weapon?.headshotMult ?? DUST2_ZONE_MULT.head : DUST2_ZONE_MULT[zone];
  let damage = (weapon?.damage ?? 26) * zoneMult;
  damage *= Math.pow(weapon?.rangeModifier ?? 1, Math.max(0, distance) / DUST2_FALLOFF_METRES);

  const covered = zone !== 'legs' && (zone !== 'head' || member.helmet);
  if (covered && member.armorPoints > 0) {
    const penetration = Math.min(1, Math.max(0, weapon?.armorPen ?? 0.5));
    let through = damage * penetration;
    let armorLoss = (damage - through) * config.armorAbsorb;

    if (armorLoss > member.armorPoints) {
      through += (armorLoss - member.armorPoints) / config.armorAbsorb;
      armorLoss = member.armorPoints;
    }

    member.armorPoints = Math.max(0, member.armorPoints - armorLoss);
    damage = through;
  }

  return Math.max(1, Math.round(damage));
}

function respawnForRound(match, now) {
  for (const [id, member] of match.members) {
    const player = players.get(id);
    if (!player) continue;

    const spawn = defusal.spawnFor(match, id);
    if (spawn) player.position = spawn;

    player.alive = true;
    member.alive = true;
    player.health = defusal.DEFUSAL_CONFIG.baseHealth;
    player.positionHistory = [];
    player.recentShots = [];
    player.justTeleported = true;
    player.teleportSettleUntil = now + TELEPORT_SETTLE_MS;
    clearPlayerAbilityBuffs(player, false);

    refillArsenalAmmo(member);
    player.defusalWeaponId = null;
    applyDefusalLoadout(player);

    safeSend(player.ws, {
      type: 'defusalRespawn',
      position: player.position,
      health: player.health,
      side: defusal.sideOf(match, id),
    });
    broadcast({ type: 'playerRespawn', id, position: player.position, health: player.health }, id, true, player);
  }
}

function finishDefusalRound(match, outcome, now) {
  match.score[outcome.side] += 1;
  match.phase = 'over';
  match.phaseUntil = now + defusal.DEFUSAL_CONFIG.roundEndMs;

  defusal.payRound(match, outcome.side);
  defusal.carryLoadout(match);

  broadcastDefusal(match, {
    type: 'defusalRoundEnd',
    round: match.round,
    side: outcome.side,
    reason: outcome.reason,
    score: { t: match.score.t, ct: match.score.ct },
  });
  broadcastDefusalState(match);
}

function explodeBomb(match, now) {
  const bomb = match.bomb;
  bomb.state = 'exploded';

  const config = defusal.DEFUSAL_CONFIG;
  for (const [id, member] of match.members) {
    if (!member.alive) continue;
    const player = players.get(id);
    if (!player) continue;

    const distance = Math.hypot(player.position[0] - bomb.x, player.position[2] - bomb.z);
    if (distance > config.bombBlastRadius) continue;

    applyPlayerDamage(player, config.bombDamage, { ignoreShield: true });
  }

  broadcastDefusal(match, { type: 'defusalBombExploded', x: bomb.x, z: bomb.z });
}

function detonateGrenade(match, grenade, now) {
  const physics = defusal.GRENADE_PHYSICS;

  broadcastDefusal(match, {
    type: 'defusalGrenadeBurst',
    id: grenade.id,
    itemId: grenade.itemId,
    x: grenade.x,
    y: grenade.y,
    z: grenade.z,
  });

  if (grenade.itemId === 'liquidation') {
    const item = defusalArsenal.ARSENAL_BY_ID.get('liquidation');
    for (const [id, member] of match.members) {
      if (!member.alive) continue;
      const target = players.get(id);
      if (!target) continue;

      const distance = Math.hypot(target.position[0] - grenade.x, target.position[2] - grenade.z);
      if (distance > item.maxRange) continue;

      const falloff = 1 - distance / item.maxRange;
      applyPlayerDamage(target, Math.max(1, Math.round(item.damage * falloff)), {
        attackerId: grenade.ownerId,
        ignoreShield: true,
      });
    }
    return;
  }

  if (grenade.itemId === 'rug-flash') {
    for (const [id, member] of match.members) {
      if (!member.alive) continue;
      const target = players.get(id);
      if (!target) continue;

      const blindMs = defusal.flashStrength(grenade, target.position, target.rotation || 0);
      if (blindMs > 250) safeSend(target.ws, { type: 'defusalFlashed', durationMs: blindMs });
    }
    return;
  }

  broadcastDefusal(match, {
    type: 'defusalCloud',
    x: grenade.x,
    z: grenade.z,
    radius: physics.cloudRange,
    untilMs: now + physics.cloudMs,
  });
}

function tickDefusalMatch(match, now) {
  for (const id of Array.from(match.members.keys())) {
    const player = players.get(id);
    const present = player && player.authenticated && player.locationId === defusal.DEFUSAL_CONFIG.locationId;
    if (!present) defusal.dropMember(match, id);
  }

  if (match.members.size === 0) {
    defusal.endMatch(match);
    return;
  }

  for (const grenade of defusal.stepGrenades(match, 0.25, now)) detonateGrenade(match, grenade, now);
  if ((match.grenades ?? []).length > 0) {
    broadcastDefusal(match, { type: 'defusalGrenades', grenades: defusal.serializeGrenades(match) });
  }

  const bomb = match.bomb;

  if (bomb && bomb.planting && now >= bomb.planting.until) {
    bomb.state = 'planted';
    bomb.site = bomb.planting.site;
    bomb.x = bomb.planting.x;
    bomb.z = bomb.planting.z;
    bomb.plantedAt = now;
    bomb.explodesAt = now + defusal.DEFUSAL_CONFIG.bombMs;
    bomb.carrierId = null;
    bomb.planting = null;
    match.phase = 'planted';
    match.phaseUntil = bomb.explodesAt;
    broadcastDefusal(match, { type: 'defusalBombPlanted', site: bomb.site, x: bomb.x, z: bomb.z, explodesAt: bomb.explodesAt });
    broadcastDefusalState(match);
  }

  if (bomb && bomb.defusing && now >= bomb.defusing.until) {
    bomb.state = 'defused';
    bomb.defusing = null;
    broadcastDefusal(match, { type: 'defusalBombDefused' });
  }

  if (bomb && bomb.state === 'planted' && now >= bomb.explodesAt) {
    explodeBomb(match, now);
  }

  if (match.phase === 'warmup' && now >= match.phaseUntil) {
    defusal.startRound(match, now);
    respawnForRound(match, now);
    broadcastDefusalState(match);
    return;
  }

  if (match.phase === 'freeze' && now >= match.phaseUntil) {
    match.phase = 'live';
    match.phaseUntil = now + defusal.DEFUSAL_CONFIG.roundMs;
    broadcastDefusalState(match);
    return;
  }

  if (match.phase === 'live' || match.phase === 'planted') {
    const outcome = defusal.roundOutcome(match, now);
    if (outcome) finishDefusalRound(match, outcome, now);
    return;
  }

  if (match.phase === 'over' && now >= match.phaseUntil) {
    if (defusal.isMatchOver(match)) {
      const winner = match.score.t > match.score.ct ? 't' : 'ct';
      broadcastDefusal(match, {
        type: 'defusalMatchEnd',
        winner,
        score: { t: match.score.t, ct: match.score.ct },
      });
      for (const id of match.members.keys()) clearDefusalLoadout(players.get(id));
      defusal.endMatch(match);
      return;
    }

    if (match.round === defusal.DEFUSAL_CONFIG.swapAfterRound && !match.swapped) {
      match.swapped = true;
      defusal.resetLoadouts(match);
      broadcastDefusal(match, { type: 'defusalSideSwap' });
    }

    defusal.startRound(match, now);
    respawnForRound(match, now);
    broadcastDefusalState(match);
  }
}

function defusalTick() {
  const now = Date.now();

  for (const match of defusal.allMatches()) tickDefusalMatch(match, now);

  if (defusal.shouldFormMatch(now)) {
    const match = defusal.createMatch(1, now);
    if (match) {
      for (const id of match.members.keys()) {
        const player = players.get(id);
        if (!player) continue;

        player.locationId = defusal.DEFUSAL_CONFIG.locationId;
        player.instance = 1;
        player.position = defusal.spawnFor(match, id) ?? [0, 0, 0];
        player.weaponEquipped = true;
        applyDefusalLoadout(player);

        safeSend(player.ws, {
          type: 'forceTeleport',
          locationId: defusal.DEFUSAL_CONFIG.locationId,
          position: player.position,
        });
      }
      broadcastDefusalState(match);
    }
    broadcastQueueState();
  }
}

safeInterval(defusalTick, 250);

function grinderNicknames(match) {
  const names = new Map();
  for (const id of match.members.keys()) {
    names.set(id, players.get(id)?.nickname ?? 'Player');
  }
  return names;
}

function broadcastGrinder(match, payload) {
  for (const id of match.members.keys()) {
    const player = players.get(id);
    if (player) safeSend(player.ws, payload);
  }
}

function broadcastGrinderState(match) {
  broadcastGrinder(match, grinder.serializeMatch(match, grinderNicknames(match)));
}

function applyGrinderLoadout(player) {
  applyArsenalLoadout(player);
}

function livingGrinderPositions(match) {
  const entries = [];
  for (const [id, member] of match.members) {
    if (!member.alive) continue;
    const player = players.get(id);
    if (player) entries.push({ id, position: player.position });
  }
  return entries;
}

function respawnInGrinder(match, player, now) {
  const member = match.members.get(player.id);
  if (!member) return;

  grinder.respawn(member);

  player.position = grinder.pickSpawn(match, player.id, livingGrinderPositions(match));
  player.alive = true;
  player.health = grinder.GRINDER_CONFIG.baseHealth;
  player.positionHistory = [];
  player.recentShots = [];
  player.justTeleported = true;
  player.teleportSettleUntil = now + TELEPORT_SETTLE_MS;
  player.weaponEquipped = true;
  clearPlayerAbilityBuffs(player, false);

  refillArsenalAmmo(member);
  player.defusalWeaponId = null;
  applyGrinderLoadout(player);
  grantSpawnProtection(player, grinder.GRINDER_CONFIG.spawnImmunityMs);

  safeSend(player.ws, {
    type: 'grinderRespawn',
    position: player.position,
    health: player.health,
  });
  broadcast(
    { type: 'playerRespawn', id: player.id, position: player.position, health: player.health },
    player.id,
    true,
    player
  );
}

function enterGrinder(player, now = Date.now()) {
  const match = grinder.ensureMatch(player.instance, now);
  grinder.join(match, player.id, now);
  respawnInGrinder(match, player, now);
  broadcastGrinderState(match);
}

function leaveGrinder(player) {
  const match = grinder.leave(player.id);
  clearDefusalLoadout(player);
  if (!match) return;

  if (match.members.size === 0) grinder.closeMatch(match);
  else broadcastGrinderState(match);
}

function detonateGrinderGrenade(match, grenade, now) {
  const physics = defusal.GRENADE_PHYSICS;

  broadcastGrinder(match, {
    type: 'defusalGrenadeBurst',
    id: grenade.id,
    itemId: grenade.itemId,
    x: grenade.x,
    y: grenade.y,
    z: grenade.z,
  });

  if (grenade.itemId === 'liquidation') {
    const item = defusalArsenal.ARSENAL_BY_ID.get('liquidation');
    for (const [id, member] of match.members) {
      if (!member.alive) continue;
      const target = players.get(id);
      if (!target) continue;

      const distance = Math.hypot(target.position[0] - grenade.x, target.position[2] - grenade.z);
      if (distance > item.maxRange) continue;

      const falloff = 1 - distance / item.maxRange;
      applyPlayerDamage(target, Math.max(1, Math.round(item.damage * falloff)), {
        attackerId: grenade.ownerId,
        ignoreShield: true,
      });
    }
    return;
  }

  if (grenade.itemId === 'rug-flash') {
    for (const [id, member] of match.members) {
      if (!member.alive) continue;
      const target = players.get(id);
      if (!target) continue;

      const blindMs = defusal.flashStrength(grenade, target.position, target.rotation || 0);
      if (blindMs > 250) safeSend(target.ws, { type: 'defusalFlashed', durationMs: blindMs });
    }
    return;
  }

  broadcastGrinder(match, {
    type: 'defusalCloud',
    x: grenade.x,
    z: grenade.z,
    radius: physics.cloudRange,
    untilMs: now + physics.cloudMs,
  });
}

function tickGrinderMatch(match, now) {
  for (const id of Array.from(match.members.keys())) {
    const player = players.get(id);
    const present = player && player.authenticated && player.locationId === grinder.GRINDER_CONFIG.locationId;
    if (!present) grinder.leave(id);
  }

  if (match.members.size === 0) {
    grinder.closeMatch(match);
    return;
  }

  for (const grenade of defusal.stepGrenades(match, 0.1, now)) detonateGrinderGrenade(match, grenade, now);
  if ((match.grenades ?? []).length > 0) {
    broadcastGrinder(match, { type: 'defusalGrenades', grenades: defusal.serializeGrenades(match) });
  }

  let changed = false;

  if (match.phase === 'live' && now >= match.phaseUntil) {
    const winner = grinder.finishRound(match, now);
    broadcastGrinder(match, {
      type: 'grinderRoundEnd',
      round: match.round,
      winnerId: winner?.id ?? null,
      winnerName: winner ? players.get(winner.id)?.nickname ?? 'Player' : null,
      standings: match.standings.map((entry) => ({
        ...entry,
        nickname: players.get(entry.id)?.nickname ?? 'Player',
      })),
    });
    changed = true;
  } else if (match.phase === 'over' && now >= match.phaseUntil) {
    grinder.startRound(match, now);
    changed = true;
  }

  for (const id of grinder.readyToRespawn(match, now)) {
    const player = players.get(id);
    if (!player) continue;
    respawnInGrinder(match, player, now);
    changed = true;
  }

  if (changed) broadcastGrinderState(match);
}

function grinderTick() {
  const now = Date.now();
  for (const match of grinder.allMatches()) tickGrinderMatch(match, now);
}

safeInterval(grinderTick, 100);

const GRINDER_PICK_ERRORS = {
  buy_closed: 'The round is over — wait for the next one.',
  grenades_full: 'You are carrying enough grenades.',
  already_owned: 'You already have that.',
  not_for_sale: 'Not available here.',
};

const GRINDER_PICK_ERROR_KEYS = {
  buy_closed: 'g.err.grinder.buyClosed',
  grenades_full: 'g.err.grenadesFull',
  already_owned: 'g.err.alreadyHaveThat',
  not_for_sale: 'g.err.notAvailableHere',
};

function handleGrinderBuy(player, match, itemId) {
  const result = grinder.applyPick(match, player.id, itemId);
  if (!result.ok) {
    safeSend(player.ws, { type: 'error', message: GRINDER_PICK_ERRORS[result.error] ?? 'Cannot take that.', messageKey: GRINDER_PICK_ERROR_KEYS[result.error] ?? 'g.err.cannotTakeThat' });
    return;
  }

  refillArsenalAmmo(result.member, result.item.id);
  applyGrinderLoadout(player);
  broadcastGrinderState(match);
}

function handleGrinderSwitch(player, match, slot) {
  const member = match.members.get(player.id);
  if (!member || !defusal.selectSlot(member, slot)) return;

  applyGrinderLoadout(player);
  broadcastGrinderState(match);
}

function handleGrinderThrow(player, match, direction) {
  if (!player.alive || match.phase !== 'live') return;
  if (!Array.isArray(direction) || direction.length !== 3) return;
  if (!direction.every((value) => Number.isFinite(value))) return;

  const member = match.members.get(player.id);
  if (!defusal.isHoldingGrenade(member)) return;

  const itemId = defusal.heldItemId(member);
  if (!itemId) return;

  clearSpawnProtection(player);

  const grenade = grinder.throwGrenade(match, player.id, itemId, player.position, direction, Date.now());
  if (!grenade) return;

  broadcastGrinder(match, {
    type: 'defusalGrenadeThrown',
    id: grenade.id,
    itemId: grenade.itemId,
    ownerId: grenade.ownerId,
    x: grenade.x,
    y: grenade.y,
    z: grenade.z,
  });

  applyGrinderLoadout(player);
  broadcastGrinderState(match);
}

function handleGrinderMelee(player, match) {
  const member = match.members.get(player.id);
  if (!member || !player.alive || match.phase !== 'live') return;
  if (member.held !== 'melee') return;

  const now = Date.now();
  if (now < (player.defusalSwingUntil || 0)) return;

  clearSpawnProtection(player);

  const knife = defusalArsenal.ARSENAL_BY_ID.get(member.melee);
  player.defusalSwingUntil = now + knife.fireRateMs;
  broadcastGrinder(match, { type: 'defusalSwing', playerId: player.id });

  const [px, , pz] = player.position;
  const facing = player.rotation || 0;
  const forwardX = Math.sin(facing);
  const forwardZ = Math.cos(facing);

  let best = null;
  let bestDistance = Infinity;

  for (const [id, other] of match.members) {
    if (id === player.id || !other.alive) continue;

    const target = players.get(id);
    if (!target || !target.alive) continue;

    const dx = target.position[0] - px;
    const dz = target.position[2] - pz;
    const distance = Math.hypot(dx, dz);
    if (distance > knife.maxRange || distance >= bestDistance) continue;

    const dot = distance > 0.001 ? (dx / distance) * forwardX + (dz / distance) * forwardZ : 1;
    if (dot < 0.5) continue;

    best = target;
    bestDistance = distance;
  }

  if (!best) return;

  const theirFacing = best.rotation || 0;
  const behind = forwardX * Math.sin(theirFacing) + forwardZ * Math.cos(theirFacing) > 0.35;
  const damage = arsenalDamage(player, best, 'chest', bestDistance) * (behind ? 3 : 1);

  applyBulletDamage(player, best, Math.round(damage), { point: best.position });
}

const SHOP_ITEMS = {
  'sign-on-a-stick': { id: 'sign-on-a-stick', name: 'g.placeable.sign-on-a-stick.name', price: 100, maxOwned: 10 },
  'sphere': { id: 'sphere', name: 'g.placeable.sphere.name', price: 100, maxOwned: 50, tradeable: true },
  'wall-poster': { id: 'wall-poster', name: 'g.placeable.wall-poster.name', price: 100, maxOwned: 4 },
  'home-teleport': { id: 'home-teleport', name: 'g.placeable.home-teleport.name', price: 250, maxOwned: 10 },
  'storage-crate': { id: 'storage-crate', name: 'g.placeable.storage-crate.name', price: 200, maxOwned: null },
  'run-insurance': { id: 'run-insurance', name: 'g.placeable.run-insurance.name', price: 1000, maxOwned: 1, blockedInCombat: true },
  'pet-dog': { id: 'pet-dog', name: 'g.pet.pet-dog.name', price: 0, maxOwned: 1, ashPurchasable: false, pet: true },
};

const SHOP_MAX_QTY_PER_PURCHASE = 100;
const SHOP_UNCAPPED_MAX_OWNED = 1000;

const shopPriceOverrides = new Map();

async function refreshShopPrices(gameId) {
  if (!gameId || !CONFIG.internalSecret) return;
  const result = await callInternalApi('/api/internal/game/shop-prices', { gameId }).catch((err) => {
    console.error('[Shop] price refresh error:', err.message);
    return null;
  });
  if (!result?.items) return;
  shopPriceOverrides.clear();
  for (const item of result.items) {
    shopPriceOverrides.set(item.itemId, item);
  }
}

function shopPriceFor(itemId, fallbackPrice) {
  const override = shopPriceOverrides.get(itemId);
  if (!override) return fallbackPrice;
  if (override.currency !== 'ash') return null;
  return Math.max(0, Math.floor(Number(override.priceAsh) || 0));
}

function shopItemEnabled(itemId) {
  const override = shopPriceOverrides.get(itemId);
  return !override || override.enabled !== false;
}

const SIGN_LIFETIME_MS = 6 * 60 * 60 * 1000;

const PET_ITEM_ID = 'pet-dog';
const PET_FETCH_RADIUS = 28;
const PET_SPEED = 9;
const PET_FETCH_GRACE_MS = 400;
const PET_BLOCKED_LOCATION_PREFIX = 'event-';

function hasPet(player) {
  if (player.companions?.equipped) return true;
  return (player.placeables?.[PET_ITEM_ID] || 0) > 0;
}

function petAllowedAt(locationId) {
  return typeof locationId === 'string' && !locationId.startsWith(PET_BLOCKED_LOCATION_PREFIX);
}

function petCanFetch(player, loot) {
  if (!hasPet(player)) return false;
  if (!petAllowedAt(player.locationId)) return false;
  return loot.ownerId === player.id;
}

const LOOT_CONFIG = {
  pollIntervalMs: 10000,
  minDrop: 1,
  maxDrop: 3,
  pickupRadius: 3,
  despawnMs: 5 * 60 * 1000,
  maxInventory: 200,
};

let tokenPool = [];
const lootDrops = new Map();
let nextLootId = 0;

const activeTrades = new Map();
const pendingPlaceableRefunds = new Map();
const TRADE_SETTLING_TIMEOUT_MS = 2 * 60 * 1000;

function refundPlaceable(userId, itemId, quantity) {
  if (!userId || !itemId || quantity <= 0) return;

  const owner = userIdToPlayer.get(userId);
  if (owner) {
    owner.placeables[itemId] = (owner.placeables[itemId] || 0) + quantity;
    owner.economyChangedAt = Date.now();
    persistPlayer(owner);
    safeSend(owner.ws, { type: 'inventoryUpdate', inventory: owner.inventory, ash: owner.ash, placeables: owner.placeables });
    return;
  }

  const bucket = pendingPlaceableRefunds.get(userId) || {};
  bucket[itemId] = (bucket[itemId] || 0) + quantity;
  pendingPlaceableRefunds.set(userId, bucket);
  console.error('[Trade] escrow refund deferred, owner offline:', { userId, itemId, quantity });
}

function applyPendingPlaceableRefunds(player) {
  const bucket = pendingPlaceableRefunds.get(player.userId);
  if (!bucket) return;
  pendingPlaceableRefunds.delete(player.userId);

  for (const [itemId, quantity] of Object.entries(bucket)) {
    if (!SHOP_ITEMS[itemId] || !(quantity > 0)) continue;
    player.placeables[itemId] = (player.placeables[itemId] || 0) + quantity;
  }
  player.economyChangedAt = Date.now();
  console.log(`[Trade] delivered deferred escrow refund to ${player.userId}`);
}

async function companionEscrowCall(session, action, userId) {
  const result = await callInternalApi('/api/internal/game/companions/escrow', {
    action,
    userId,
    gameId: session.gameId,
    itemId: session.itemId,
  }).catch((err) => {
    console.error('[Trade] companion escrow error:', { action, itemId: session.itemId, message: err.message });
    return null;
  });

  if (result && result.success) {
    const holder = userIdToPlayer.get(userId);
    if (holder) {
      holder.companions = {
        owned: Array.isArray(result.owned) ? result.owned : (holder.companions?.owned || []),
        equipped: result.equipped || null,
        fragments: Math.max(0, Math.floor(Number(result.fragments) || 0)),
        crates: Math.max(0, Math.floor(Number(result.crates) || 0)),
      };
      holder.companionsChangedAt = Date.now();
    }
  }

  return !!(result && result.success);
}

async function holdTradeEscrow(session) {
  if (session.escrowed) return true;

  if (session.itemKind === 'companion') {
    const held = await companionEscrowCall(session, 'hold', session.sellerId);
    if (held) session.escrowed = true;
    return held;
  }

  const seller = userIdToPlayer.get(session.sellerId);
  if (!seller || !(seller.placeables[session.itemId] > 0)) return false;

  seller.placeables[session.itemId] = Math.max(0, seller.placeables[session.itemId] - 1);
  seller.economyChangedAt = Date.now();
  session.escrowed = true;
  persistPlayer(seller);
  safeSend(seller.ws, { type: 'inventoryUpdate', inventory: seller.inventory, ash: seller.ash, placeables: seller.placeables });
  return true;
}

function releaseTradeEscrow(session) {
  if (!session.escrowed) return;
  session.escrowed = false;

  if (session.itemKind === 'companion') {
    companionEscrowCall(session, 'release', session.sellerId).then((ok) => {
      if (!ok) {
        console.error('[Trade] CRITICAL: companion escrow not returned to seller:', {
          tradeId: session.id, sellerId: session.sellerId, itemId: session.itemId,
        });
      }
    });
    return;
  }

  refundPlaceable(session.sellerId, session.itemId, 1);
}

function buildTradeSnapshot(session) {
  return {
    tradeId: session.id,
    phase: session.phase,
    sellerId: session.sellerId,
    itemId: session.itemId,
    itemName: session.itemName,
    priceTnj: session.priceTnj,
    participants: Object.values(session.participants).map((p) => ({
      userId: p.userId, wallet: p.wallet, nickname: p.nickname, ready: p.ready,
    })),
  };
}

function sendToTradeParticipants(session, message) {
  for (const uid of Object.keys(session.participants)) {
    const p = userIdToPlayer.get(uid);
    if (p) safeSend(p.ws, message);
  }
}

function broadcastTradeState(session) {
  sendToTradeParticipants(session, { type: 'tradeSession', ...buildTradeSnapshot(session) });
}

function endTrade(session, phase, extra) {
  session.phase = phase;
  if (phase !== 'completed') releaseTradeEscrow(session);
  for (const uid of Object.keys(session.participants)) {
    const p = userIdToPlayer.get(uid);
    if (p && p.activeTradeId === session.id) p.activeTradeId = null;
  }
  activeTrades.delete(session.id);
  sendToTradeParticipants(session, { type: 'tradeSession', ...buildTradeSnapshot(session), ...(extra || {}) });
}

safeInterval(() => {
  const now = Date.now();
  for (const session of Array.from(activeTrades.values())) {
    if (session.phase === 'settling') {
      if (session.settlingSince && now - session.settlingSince > TRADE_SETTLING_TIMEOUT_MS) {
        console.error('[Trade] settlement stuck, releasing escrow:', { tradeId: session.id, sellerId: session.sellerId, itemId: session.itemId });
        endTrade(session, 'failed', { reason: 'settlement_timeout', critical: true });
      }
      continue;
    }
    const awaitingAge = session.awaitingPaymentSince ? now - session.awaitingPaymentSince : 0;
    if (session.phase === 'awaiting_payment' && awaitingAge > 5 * 60 * 1000) {
      endTrade(session, 'expired');
    } else if (now - session.createdAt > 15 * 60 * 1000) {
      endTrade(session, 'expired');
    }
  }
}, 30000);

let factionGatesList = [];
let displayedFactionGatesList = [];
let accountCount = 0;
let lastBroadcastAccountCount = -1;

async function refreshFactionGates() {
  const result = await callInternalApi('/api/internal/game/faction/gates-list', {}).catch((err) => {
    console.error('[FactionGates] refresh error:', err.message);
    return null;
  });
  if (result?.success && Array.isArray(result.gates)) {
    factionGatesList = result.gates;
  }
  if (typeof result?.accountCount === 'number') {
    accountCount = result.accountCount;
  }

  const prevIds = new Set(displayedFactionGatesList.map((g) => g.factionId));
  const nextIds = new Set(factionGatesList.map((g) => g.factionId));
  const changed =
    prevIds.size !== nextIds.size ||
    Array.from(prevIds).some((id) => !nextIds.has(id)) ||
    accountCount !== lastBroadcastAccountCount;

  displayedFactionGatesList = factionGatesList;

  if (changed) {
    lastBroadcastAccountCount = accountCount;
    broadcastToLocation(GALAXY_LOCATION_ID, {
      type: 'factionGatesState',
      gates: displayedFactionGatesList,
      accountCount,
    });
  }
}

refreshFactionGates();
safeInterval(refreshFactionGates, 15000);

async function refreshTokenPool() {
  try {
    const url = new URL('/api/new-tokens', CONFIG.siteUrl).toString();
    const res = await fetch(url);
    if (!res.ok) return;
    const tokens = await res.json();
    if (Array.isArray(tokens) && tokens.length > 0) {
      tokenPool = tokens;
    }
  } catch (err) {
    console.error('[TokenPool] refresh error:', err.message);
  }
}

refreshTokenPool();
safeInterval(refreshTokenPool, LOOT_CONFIG.pollIntervalMs);

function serializeLoot(instance) {
  return Array.from(lootDrops.values())
    .filter((l) => !l.ownerId && l.instance === instance)
    .map((l) => ({
      id: l.id,
      position: l.position,
      tokens: l.tokens,
    }));
}

const worldSigns = new Map();
let signsLoadPromise = null;

function serializeSigns(instance) {
  return Array.from(worldSigns.values()).filter((sign) => sign.instance === instance);
}

async function ensureSignsLoaded(gameId) {
  if (signsLoadPromise) return signsLoadPromise;

  signsLoadPromise = (async () => {
    const result = await callInternalApi('/api/internal/game/signs/list', { gameId }).catch((err) => {
      console.error('[Signs] load error:', err.message);
      return null;
    });
    for (const sign of result?.signs || []) {
      sign.createdAtMs = new Date(sign.createdAt).getTime();
      sign.instance = 1;
      worldSigns.set(sign.id, sign);
    }
  })();

  return signsLoadPromise;
}

async function deleteSign(sign) {
  const result = await callInternalApi('/api/internal/game/signs/delete', {
    signId: sign.id, userId: sign.ownerId,
  }).catch((err) => {
    console.error('[Signs] delete error:', err.message);
    return null;
  });
  if (!result || !result.success) return false;
  worldSigns.delete(sign.id);
  broadcastToLocation('main-world', { type: 'signDespawn', id: sign.id }, null, sign.instance);
  return true;
}

safeInterval(() => {
  const now = Date.now();
  for (const sign of Array.from(worldSigns.values())) {
    if (now - sign.createdAtMs > SIGN_LIFETIME_MS) {
      deleteSign(sign);
    }
  }
}, 60000);

const FACTION_ROOM_PREFIX = 'faction-gate-';

const ROOM_BUILD_TYPE_MAX = 40;
const ROOM_BUILD_KEY_MAX = 64;
const ROOM_BUILD_ENV_MAX = 24;
const ROOM_BUILD_PAINT_URL_MAX = 300;
const ROOM_BUILD_CELL_MAX = 1024;
const ROOM_BUILD_LEVEL_MAX = 15;

function isRoomLocationId(locationId) {
  return typeof locationId === 'string' && PRIVATE_LOCATION_PREFIXES.some((prefix) => locationId.startsWith(prefix));
}

function isBuildIndex(value, max) {
  return Number.isInteger(value) && value >= 0 && value <= max;
}

function sanitizeRoomBuildOp(op) {
  if (!op || typeof op !== 'object') return null;

  if (op.kind === 'place') {
    const raw = op.piece;
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.t !== 'string' || raw.t.length === 0 || raw.t.length > ROOM_BUILD_TYPE_MAX) return null;
    if (!isBuildIndex(raw.x, ROOM_BUILD_CELL_MAX) || !isBuildIndex(raw.z, ROOM_BUILD_CELL_MAX)) return null;
    if (!isBuildIndex(raw.l, ROOM_BUILD_LEVEL_MAX) || !isBuildIndex(raw.r, 3)) return null;

    const piece = { t: raw.t, x: raw.x, z: raw.z, l: raw.l, r: raw.r };
    if (raw.d !== undefined && raw.d !== null) {
      if (typeof raw.d !== 'string' || !raw.d.startsWith('https://') || raw.d.length > ROOM_BUILD_PAINT_URL_MAX) return null;
      piece.d = raw.d;
    }
    return { kind: 'place', piece };
  }

  if (op.kind === 'erase') {
    if (typeof op.key !== 'string' || op.key.length === 0 || op.key.length > ROOM_BUILD_KEY_MAX) return null;
    return { kind: 'erase', key: op.key };
  }

  if (op.kind === 'env') {
    if (typeof op.sky !== 'string' || op.sky.length === 0 || op.sky.length > ROOM_BUILD_ENV_MAX) return null;
    if (typeof op.light !== 'string' || op.light.length === 0 || op.light.length > ROOM_BUILD_ENV_MAX) return null;
    return { kind: 'env', sky: op.sky, light: op.light };
  }

  if (op.kind === 'clear') return { kind: 'clear' };

  return null;
}

async function refreshRoomEditRights(player) {
  player.roomCanEdit = false;

  const locationId = player.locationId;
  if (!isRoomLocationId(locationId)) return;

  const result = await callInternalApi('/api/internal/game/room/can-edit', {
    userId: player.userId,
    locationId,
  }).catch((err) => {
    console.error('[RoomBuild] edit rights error:', err.message);
    return null;
  });

  if (player.locationId !== locationId) return;
  player.roomCanEdit = result?.canEdit === true;
}

function addTokensToInventory(player, tokens) {
  for (const t of tokens) {
    const existing = player.inventory.find((e) => e.address === t.address);
    if (existing) {
      existing.quantity++;
    } else if (player.inventory.length < LOOT_CONFIG.maxInventory) {
      player.inventory.push({
        address: t.address,
        name: t.name,
        symbol: t.symbol,
        image: t.image,
        quantity: 1,
      });
    }
  }
}

const STORAGE_SLOTS = 50;
const STORAGE_REACH = 4;

function sanitizeStorageEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.address !== 'string' || raw.address.length === 0) return null;

  const quantity = Math.floor(Number(raw.quantity));
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  return {
    address: raw.address,
    name: typeof raw.name === 'string' ? raw.name : '',
    symbol: typeof raw.symbol === 'string' ? raw.symbol : '',
    image: typeof raw.image === 'string' ? raw.image : null,
    quantity,
  };
}

function storageBucket(player, key) {
  if (!Array.isArray(player.storage[key])) player.storage[key] = [];
  return player.storage[key];
}

function stackIntoStorage(bucket, entry) {
  const existing = bucket.find((e) => e.address === entry.address);
  if (existing) {
    existing.quantity += entry.quantity;
    return entry.quantity;
  }

  if (bucket.length >= STORAGE_SLOTS) return 0;
  bucket.push({ ...entry });
  return entry.quantity;
}

function filledStorageKeys(player) {
  return Object.keys(player.storage).filter((key) => (player.storage[key] || []).length > 0);
}

function sendStorageState(player, key = null) {
  safeSend(player.ws, {
    type: 'storageState',
    key,
    slots: STORAGE_SLOTS,
    entries: key ? (player.storage[key] || []) : [],
    filled: filledStorageKeys(player),
  });
}

function isOwnRoom(player) {
  return player.locationId === `${PLAYER_ROOM_PREFIX}${player.userId}`;
}

function storageInReach(player, key) {
  const spot = player.storages.get(key);
  if (!spot) return false;

  const [px, , pz] = player.position;
  return Math.sqrt((spot[0] - px) ** 2 + (spot[2] - pz) ** 2) <= STORAGE_REACH;
}

function reconcileStorage(player) {
  let changed = false;
  let recovered = 0;

  for (const key of Object.keys(player.storage)) {
    if (player.storages.has(key)) continue;

    const entries = player.storage[key] || [];
    delete player.storage[key];
    if (entries.length > 0) {
      player.storageOrphan.push(...entries);
      changed = true;
    }
  }

  while (player.storageOrphan.length > 0) {
    const entry = player.storageOrphan[0];
    let placed = false;

    for (const key of player.storages.keys()) {
      if (stackIntoStorage(storageBucket(player, key), entry) > 0) {
        placed = true;
        break;
      }
    }

    if (!placed) break;

    player.storageOrphan.shift();
    recovered += 1;
    changed = true;
  }

  if (!changed) return;

  if (recovered > 0) {
    safeSend(player.ws, {
      type: 'error',
      message: `📦 ${recovered} stack${recovered === 1 ? '' : 's'} from a removed crate moved into your storage`,
      messageKey: recovered === 1 ? 'g.err.crateRecoveredOne' : 'g.err.crateRecoveredMany',
      messageVars: { count: recovered },
    });
  } else if (player.storageOrphan.length > 0) {
    safeSend(player.ws, {
      type: 'error',
      message: '📦 Your crate is gone — its tokens are held safe until you build another one',
      messageKey: 'g.err.crateGoneSafe',
    });
  }

  persistPlayer(player);
  sendStorageState(player);
}

function applyHomeFixtures(player, status) {
  if (status.fixtures !== true) return;

  const spawn = status.homeSpawn;
  player.homeSpawn = spawn && [spawn.x, spawn.y, spawn.z].every((v) => Number.isFinite(v))
    ? [spawn.x, spawn.y, spawn.z]
    : null;

  const next = new Map();
  for (const entry of Array.isArray(status.storages) ? status.storages : []) {
    if (typeof entry?.key !== 'string') continue;
    if (![entry.x, entry.y, entry.z].every((v) => Number.isFinite(v))) continue;
    next.set(entry.key, [entry.x, entry.y, entry.z]);
  }

  player.storages = next;
  reconcileStorage(player);
}

function ashForMarketCap(mc) {
  if (mc < 10000) return 1;
  if (mc < 50000) return 2;
  if (mc < 100000) return 4;
  if (mc < 500000) return 10;
  return 20;
}

function scaleLootCount(count, mult) {
  if (mult >= 1) return count;
  const scaled = Math.max(0, count * mult);
  const whole = Math.floor(scaled);
  return whole + (Math.random() < scaled - whole ? 1 : 0);
}

function rollLootTokens(minCount, maxCount, mult = 1) {
  if (tokenPool.length === 0) return [];
  const rolled = minCount + Math.floor(Math.random() * (maxCount - minCount + 1));
  const count = scaleLootCount(rolled, mult);
  const tokens = [];
  for (let i = 0; i < count; i++) {
    const t = tokenPool[Math.floor(Math.random() * tokenPool.length)];
    tokens.push({
      address: t.address, 
      name: t.name,
      symbol: t.symbol,
      image: t.image,
    });
  } 
  return tokens;
}

function dropLoot(position, instance = 1, minCount = null, maxCount = null) {
  const tokens = rollLootTokens(
    minCount === null ? LOOT_CONFIG.minDrop : minCount,
    maxCount === null ? LOOT_CONFIG.maxDrop : maxCount
  );
  if (tokens.length === 0) return;

  const id = `loot-${nextLootId++}`;
  const loot = { id, ownerId: null, instance, position: [...position], tokens, createdAt: Date.now() };
  lootDrops.set(id, loot);

  broadcastToLocation('main-world', {
    type: 'lootSpawn',
    id: loot.id,
    position: loot.position,
    tokens: loot.tokens,
  }, null, instance);
}

function clearCanyonLoot(player) {
  for (const [id, loot] of lootDrops) {
    if (loot.ownerId === player.id) {
      lootDrops.delete(id);
      safeSend(player.ws, { type: 'lootDespawn', id });
    }
  }
}

function dropCanyonLoot(player, position, minCount, maxCount, mult = 1) {
  const tokens = rollLootTokens(minCount, maxCount, mult);
  if (tokens.length === 0) return;

  const id = `loot-${nextLootId++}`;
  const loot = { id, ownerId: player.id, instance: player.instance, position: [...position], tokens, createdAt: Date.now() };
  lootDrops.set(id, loot);

  safeSend(player.ws, {
    type: 'lootSpawn',
    id: loot.id,
    position: loot.position,
    tokens: loot.tokens,
    owned: true,
  });
}

safeInterval(() => {
  const now = Date.now();
  for (const [id, loot] of lootDrops) {
    if (now - loot.createdAt > LOOT_CONFIG.despawnMs) {
      lootDrops.delete(id);
      if (loot.ownerId) {
        const owner = players.get(loot.ownerId);
        if (owner) safeSend(owner.ws, { type: 'lootDespawn', id });
      } else {
        broadcastToLocation('main-world', { type: 'lootDespawn', id }, null, loot.instance);
      }
    }
  }
}, 30000);

const CRATE_CONFIG = {
  despawnMs: 5 * 60 * 1000,
  pickupRadius: 3,
};

const CRATE_BLOCKED_LOCATIONS = new Set([ARENA_LOCATION_ID, INFLUENCE_LOCATION_ID, ...EVENT_ROOM_IDS]);

const deathCrates = new Map();
let nextCrateId = 0;

function isPrivateCrateLocation(locationId) {
  return locationId === 'tower-first-floor';
}

function crateVisibleTo(crate, viewer) {
  if (viewer.locationId !== crate.locationId) return false;
  if (isShardedLocation(crate.locationId) && viewer.instance !== crate.instance) return false;
  if (!isPrivateCrateLocation(crate.locationId)) return true;

  const viewerSegment = viewer.canyon && !viewer.canyon.inHub ? viewer.canyon.segment : null;
  if (viewerSegment !== crate.segment) return false;
  if (crate.segment === null) return true;
  return crate.ownerId === viewer.id;
}

function serializeCrate(crate) {
  return {
    id: crate.id,
    position: crate.position,
    stacks: crate.entries.length,
    ownerNickname: crate.ownerNickname,
  };
}

function broadcastCrate(crate, message) {
  players.forEach((viewer) => {
    if (!viewer.authenticated || viewer.ws.readyState !== WebSocket.OPEN) return;
    if (!crateVisibleTo(crate, viewer)) return;
    safeSend(viewer.ws, message);
  });
}

function sendCrateState(player) {
  const crates = [];
  for (const crate of deathCrates.values()) {
    if (crateVisibleTo(crate, player)) crates.push(serializeCrate(crate));
  }
  safeSend(player.ws, { type: 'crateState', crates });
}

function spawnDeathCrate(player, position) {
  if (CRATE_BLOCKED_LOCATIONS.has(player.locationId)) return null;
  if (!Array.isArray(player.inventory) || player.inventory.length === 0) return null;

  const segment = isPrivateCrateLocation(player.locationId) && player.canyon && !player.canyon.inHub
    ? player.canyon.segment
    : null;

  const id = `crate-${nextCrateId++}`;
  const crate = {
    id,
    locationId: player.locationId,
    instance: player.instance,
    segment,
    ownerId: player.id,
    ownerNickname: player.nickname,
    position: [...position],
    entries: player.inventory,
    createdAt: Date.now(),
  };

  player.inventory = [];
  deathCrates.set(id, crate);

  safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });
  broadcastCrate(crate, { type: 'crateSpawn', crate: serializeCrate(crate) });
  return crate;
}

function despawnCrate(crate) {
  deathCrates.delete(crate.id);
  broadcastCrate(crate, { type: 'crateDespawn', id: crate.id });
}

function moveCrateEntriesToInventory(player, crate) {
  let moved = 0;
  const leftover = [];

  for (const entry of crate.entries) {
    const slot = player.inventory.find((e) => e.address === entry.address);
    if (slot) {
      slot.quantity += entry.quantity;
      moved += 1;
    } else if (player.inventory.length < LOOT_CONFIG.maxInventory) {
      player.inventory.push({ ...entry });
      moved += 1;
    } else {
      leftover.push(entry);
    }
  }

  crate.entries = leftover;
  return moved;
}

safeInterval(() => {
  const now = Date.now();
  for (const crate of Array.from(deathCrates.values())) {
    if (now - crate.createdAt > CRATE_CONFIG.despawnMs) despawnCrate(crate);
  }
}, 15000);

safeInterval(() => {
  for (const record of party.pruneInvites()) {
    const target = players.get(record.targetId);
    if (target) safeSend(target.ws, { type: 'partyInviteExpired', fromId: record.fromId });
  }
}, 10000);

safeInterval(() => {
  for (const group of party.activeParties()) {
    const vitals = {
      type: 'partyVitals',
      members: group.memberIds.map((id) => {
        const member = players.get(id);
        return {
          id,
          health: member?.health ?? 0,
          maxHealth: member?.maxHealth ?? BASE_MAX_HEALTH,
          alive: member?.alive !== false,
          locationId: member?.locationId || null,
        };
      }),
    };

    for (const id of group.memberIds) {
      const member = players.get(id);
      if (member) safeSend(member.ws, vitals);
    }
  }
}, 500);

function cachedInternalCall(key, ttlMs, factory) {
  const now = Date.now();
  const entry = internalCache.get(key);

  if (entry) {
    if (entry.pending) return entry.pending;
    if (now - entry.at < ttlMs) return Promise.resolve(entry.value);
  }

  const pending = factory()
    .then((value) => {
      internalCache.set(key, { value, at: Date.now(), pending: null });
      return value;
    })
    .catch((err) => {
      internalCache.delete(key);
      throw err;
    });

  internalCache.set(key, { value: entry?.value ?? null, at: entry?.at ?? 0, pending });
  return pending;
}

safeInterval(() => {
  const now = Date.now();
  internalCache.forEach((entry, key) => {
    if (!entry.pending && now - entry.at > 60000) internalCache.delete(key);
  });
}, 60000);

async function callInternalApi(endpoint, data) {
  if (!CONFIG.internalSecret) {
    console.warn('[Internal] INTERNAL_API_SECRET not set, skipping:', endpoint);
    return null;
  }

  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, CONFIG.siteUrl);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const postData = JSON.stringify(data);

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'X-Internal-Secret': CONFIG.internalSecret,
      },
      agent: isHttps ? INTERNAL_HTTPS_AGENT : INTERNAL_HTTP_AGENT,
    };

    const req = lib.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Invalid JSON from ${endpoint}: ${body}`));
        }
      });
    });

    req.on('error', (err) => {
      console.error(`[Internal] ${endpoint} error:`, err.message);
      reject(err);
    });

    req.setTimeout(10000, () => {
      req.destroy(new Error(`Timeout calling ${endpoint}`));
    });

    req.write(postData);
    req.end();
  });
}

async function verifyGameToken(token) {
  try {
    const result = await callInternalApi('/api/internal/game/verify-token', { token });
    return result;
  } catch (err) {
    console.error('[Auth] Verify token error:', err.message);
    return { valid: false, error: 'verification_failed' };
  }
}

async function loadPlayerProgress(userId, gameId) {
  try {
    return await callInternalApi('/api/internal/game/load-progress', { userId, gameId });
  } catch (err) {
    console.error('[Progress] Load error:', err.message);
    return null;
  }
}

async function savePlayerProgress(userId, gameId, data) {
  try {
    return await callInternalApi('/api/internal/game/save-progress', {
      userId,
      gameId,
      ...data,
    });
  } catch (err) {
    console.error('[Progress] Save error:', err.message);
    return null;
  }
}

function createProgressionState() {
  return {
    totalXp: 0,
    level: 1,
    branch: null,
    skills: {},
    loadout: {},
    fireMode: 'single',
    respecCount: 0,
  };
}

function progressionPoints(player) {
  const total = progression.skillPointsForLevel(player.progression.level);
  const spent = skills.pointsSpent(player.progression.skills);
  return { total, spent, available: Math.max(0, total - spent) };
}

function weaponIdFor(player) {
  const branch = progression.BRANCHES.find((b) => b.id === player.progression.branch);
  return branch ? branch.weapon : 'rifle';
}

function weaponConfigFor(player) {
  return progression.WEAPONS[weaponIdFor(player)];
}

function computeCombatStats(player) {
  const stats = skills.computeBuildStats(player.progression.skills);
  const percent = (key) => (stats.percent[key] || 0) / 100;

  const isStaff = weaponIdFor(player) === 'staff';
  const damageStat = isStaff ? 'spellDamage' : 'weaponDamage';
  const weaponMult = isStaff ? progression.WEAPONS.staff.boltDamageMult : 1;

  return {
    stats,
    weapon: isStaff ? 'staff' : 'rifle',
    maxHealth: Math.round(skills.statValue(stats, 'maxHealth', BASE_MAX_HEALTH)),
    enemyDamage: skills.statValue(stats, damageStat, PLAYER_WEAPON_DAMAGE_TO_ENEMY) * weaponMult,
    pvpDamage: skills.statValue(stats, damageStat, BASE_PVP_DAMAGE) * weaponMult,
    damageTakenMult: Math.max(0.2, 1 + percent('damageTaken')),
    armorPen: Math.min(0.9, Math.max(0, percent('armorPen'))),
    damageVsUnshielded: Math.max(0, percent('damageVsUnshielded')),
    magSize: Math.max(1, Math.round(skills.statValue(stats, 'magSize', WEAPON_CONFIG.maxAmmo))),
    reloadMs: Math.max(400, Math.round(WEAPON_CONFIG.reloadDurationMs / (1 + percent('reloadSpeed')))),
    moveSpeedMult: Math.max(1, 1 + percent('moveSpeed')),
    maxEnergy: Math.round(skills.statValue(stats, 'maxEnergy', progression.ENERGY.base)),
    energyRegen: skills.statValue(stats, 'energyRegen', progression.ENERGY.regenPerSecond),
    healOnKill: stats.add.healOnKill || 0,
    energyOnKill: stats.add.energyOnKill || 0,
    lootMult: Math.max(1, 1 + percent('lootBonus')),
    shieldStrength: stats.add.shieldStrength || 0,
    lowHealthDamageTakenMult: Math.max(0.2, 1 + percent('lowHealthDamageTaken')),
    lowHealthThreshold: stats.set.lowHealthThreshold || 0,
    postShieldRegen: stats.add.postShieldRegen || 0,
    postShieldRegenMs: stats.set.postShieldRegenMs || 0,
    postDashSpeed: percent('postDashSpeed'),
    postDashDamageTaken: percent('postDashDamageTaken'),
    reloadWhileDashing: !!stats.set.reloadWhileDashing,
    allyDamageInZone: percent('allyDamageInZone'),
    markedAllyFireRate: percent('markedAllyFireRate'),
    bleedDamage: stats.add.bleedDamage || 0,
    bleedDurationMs: stats.set.bleedDurationMs || 0,
    clusterCount: stats.add.clusterCount || 0,
    clusterDamage: percent('clusterDamage'),
    manaCostMult: Math.max(0.2, 1 + percent('manaCost')),
    projectileSpeedMult: Math.max(0.5, 1 + percent('projectileSpeed')),
    ricochetChance: Math.min(1, Math.max(0, percent('ricochetChance'))),
    ricochetDamage: Math.max(0, percent('ricochetDamage')),
    explosiveEveryNthShot: Math.max(0, Math.round(stats.set.explosiveEveryNthShot || 0)),
    explosiveDamage: Math.max(0, percent('explosiveDamage')),
    explosiveRadius: Math.max(0, stats.set.explosiveRadius || 0),
    burnDamage: stats.add.burnDamage || 0,
    burnDurationMs: stats.set.burnDurationMs || 0,
  };
}

function refreshCombatStats(player) {
  if (player.defusalLocked) return;
  player.combat = computeCombatStats(player);

  if (!player.ability) player.ability = abilities.createAbilityState(player.combat.maxEnergy);
  else player.ability.energy = Math.min(player.ability.energy, player.combat.maxEnergy);

  const previousMax = player.maxHealth;
  player.maxHealth = player.combat.maxHealth;

  if (player.maxHealth > previousMax && player.alive) {
    player.health = Math.min(player.maxHealth, player.health + (player.maxHealth - previousMax));
  } else if (player.health > player.maxHealth) {
    player.health = player.maxHealth;
  }

  if (player.weaponAmmo > player.combat.magSize) player.weaponAmmo = player.combat.magSize;
}

function buildCombatStatsPayload(player) {
  return {
    maxHealth: player.combat.maxHealth,
    magSize: player.combat.magSize,
    reloadMs: player.combat.reloadMs,
    moveSpeedMult: player.combat.moveSpeedMult,
    maxEnergy: player.combat.maxEnergy,
    energyRegen: player.combat.energyRegen,
    boltSpeed: boltSpeedFor(player, progression.WEAPONS.staff),
    boltRange: progression.WEAPONS.staff.maxRange,
    boltEnergyCost: boltEnergyCost(player, progression.WEAPONS.staff, progression.SINGLE_FIRE_MODE),
  };
}

function abilityCooldownPayload(player, now) {
  return abilities.cooldownPayload(player.ability, player.progression.loadout, player.combat.stats, now);
}

function buildProgressionPayload(player) {
  const state = player.progression;
  const levelState = progression.levelFromTotalXp(state.totalXp);
  const points = progressionPoints(player);
  const tier = progression.tierForLevel(state.level);
  const weaponTier = progression.weaponTierForLevel(state.level);

  return {
    type: 'progressionState',
    level: state.level,
    totalXp: state.totalXp,
    xpIntoLevel: levelState.xpIntoLevel,
    xpForLevel: levelState.xpForLevel,
    branch: state.branch,
    branchUnlocked: state.level >= BRANCH_UNLOCK_LEVEL,
    skills: state.skills,
    loadout: state.loadout,
    fireMode: state.fireMode,
    fireModes: skills.unlockedModeIds(state.skills),
    weapon: player.combat.weapon,
    respecCount: state.respecCount,
    respecCostAsh: progression.respecCostAsh(state.level, state.respecCount),
    skillPoints: points.available,
    skillPointsTotal: points.total,
    tier: tier.id,
    tierIndex: tier.index,
    weaponTier: weaponTier.tier,
    memeAbilities: progression.memeAbilityIdsForLevel(state.level),
    memeCooldowns: abilities.memeCooldownPayload(
      player.ability,
      progression.memeAbilityIdsForLevel(state.level),
      Date.now()
    ),
    stats: buildCombatStatsPayload(player),
    health: player.health,
    energy: Math.floor(player.ability.energy),
    cooldowns: abilityCooldownPayload(player, Date.now()),
  };
}

function sendProgressionState(player) {
  safeSend(player.ws, buildProgressionPayload(player));
}

function broadcastPlayerLevel(player) {
  broadcastToLocation(player.locationId, {
    type: 'playerLevelUpdate',
    playerId: player.id,
    level: player.progression.level,
    tier: progression.tierForLevel(player.progression.level).id,
    branch: player.progression.branch,
    weaponTier: progression.weaponTierForLevel(player.progression.level).tier,
  }, player.id, player.instance);
}

function contentLevelFor(player) {
  if (player.locationId === CAVE_LOCATION_ID) return CAVE_CONTENT_LEVEL;
  if (player.locationId === 'main-world') return MAIN_WORLD_CONTENT_LEVEL;
  if (player.locationId === 'tower-first-floor') {
    const segment = Math.max(1, player.canyon?.segment || 1);
    return Math.min(progression.MAX_LEVEL, 1 + (segment - 1) * CANYON_LEVELS_PER_SEGMENT);
  }
  return player.progression.level;
}

function isBossType(type) {
  return type.endsWith('_boss') || type.endsWith('_warden');
}

function grantXp(player, amount, source) {
  if (!player.authenticated) return 0;

  const gain = Math.max(0, Math.floor(amount));
  if (gain <= 0) return 0;

  const state = player.progression;
  const previousLevel = state.level;
  state.totalXp += gain;

  const levelState = progression.levelFromTotalXp(state.totalXp);
  state.level = levelState.level;

  safeSend(player.ws, {
    type: 'xpGain',
    amount: gain,
    source: source || 'unknown',
    totalXp: state.totalXp,
    level: state.level,
    xpIntoLevel: levelState.xpIntoLevel,
    xpForLevel: levelState.xpForLevel,
  });

  if (state.level > previousLevel) {
    const tier = progression.tierForLevel(state.level);
    const previousTier = progression.tierForLevel(previousLevel);
    const weaponTier = progression.weaponTierForLevel(state.level);
    const previousWeaponTier = progression.weaponTierForLevel(previousLevel);

    safeSend(player.ws, {
      type: 'levelUp',
      level: state.level,
      previousLevel,
      skillPoints: progressionPoints(player).available,
      tier: tier.id,
      tierName: tier.name,
      tierChanged: tier.id !== previousTier.id,
      newMemeAbility: tier.id !== previousTier.id ? tier.memeAbility : null,
      weaponTier: weaponTier.tier,
      weaponTierChanged: weaponTier.tier !== previousWeaponTier.tier,
      branchUnlocked: state.branch === null && state.level >= BRANCH_UNLOCK_LEVEL,
    });

    broadcastPlayerLevel(player);
    sendProgressionState(player);
    persistPlayer(player);
  }

  return gain;
}

function grantEnemyKillXp(player, enemyType) {
  const cfg = ENEMY_TYPES[enemyType];
  if (!cfg) return 0;

  const base = progression.enemyXp(cfg.maxHealth, isBossType(enemyType));
  const multiplier = progression.levelGapMultiplier(player.progression.level, contentLevelFor(player));
  return grantXp(player, base * multiplier, `enemy:${enemyType}`);
}

function broadcastToFaction(factionId, message, excludePlayerId, senderUserId = null) {
  players.forEach((p) => {
    if (p.authenticated && p.id !== excludePlayerId && p.factions?.some((f) => f.id === factionId)) {
      if (senderUserId && p.blockedUserIds?.has(senderUserId)) return;
      safeSend(p.ws, message);
    }
  });
}

async function hydrateFactionTaskState(factionId, gameId) {
  const myGen = nextFactionTaskGeneration(factionId);

  const result = await callInternalApi('/api/internal/game/faction/get-by-id', {
    gameId, factionId,
  }).catch((err) => {
    console.error('[FactionTask] hydrate error:', err.message);
    return null;
  });

  if (factionTaskGeneration.get(factionId) !== myGen) {
    return factionTaskState.get(factionId) || null;
  }

  const faction = result?.faction;
  if (!faction || !faction.activeTask) {
    factionTaskState.delete(factionId);
    return null;
  }

  const def = FACTION_TASKS_BY_KEY.get(faction.activeTask.key);
  const state = {
    taskKey: faction.activeTask.key,
    metric: def ? def.metric : null,
    target: faction.activeTask.target,
    progress: faction.activeTask.progress,
    dirty: false,
    contributions: new Map(),
  };
  factionTaskState.set(factionId, state);
  return state;
}

async function completeFactionTask(factionId, taskKey, gameId, contributions) {
  factionTaskState.delete(factionId);

  const contributionsPayload = contributions
    ? Array.from(contributions.entries()).map(([userId, amount]) => ({ userId, amount }))
    : [];

  const result = await callInternalApi('/api/internal/game/faction/complete-task', {
    factionId, taskKey, contributions: contributionsPayload,
  }).catch((err) => {
    console.error('[FactionTask] complete error:', err.message);
    return null;
  });

  if (!result || !result.success) return;

  const recipient = userIdToPlayer.get(result.rewardUserId);
  if (recipient) {
    recipient.ash += result.rewardAsh;
    safeSend(recipient.ws, { type: 'inventoryUpdate', inventory: recipient.inventory, ash: recipient.ash });
  }

  const def = FACTION_TASKS_BY_KEY.get(taskKey);
  broadcastToFaction(factionId, {
    type: 'factionTaskCompleted',
    taskKey,
    label: def ? def.label : taskKey,
    rewardAsh: result.rewardAsh,
    rewardNickname: result.rewardNickname,
  });

  const fresh = await callInternalApi('/api/internal/game/faction/get-by-id', {
    gameId, factionId,
  }).catch((err) => {
    console.error('[FactionTask] refresh error:', err.message);
    return null;
  });
  if (fresh?.faction) {
    broadcastToFaction(factionId, { type: 'factionInfo', faction: fresh.faction });
  }
}

async function getOrHydrateFactionTaskState(factionId, gameId) {
  const cached = factionTaskState.get(factionId);
  if (cached) return cached;

  let inflight = factionTaskHydrating.get(factionId);
  if (!inflight) {
    inflight = hydrateFactionTaskState(factionId, gameId).finally(() => {
      factionTaskHydrating.delete(factionId);
    });
    factionTaskHydrating.set(factionId, inflight);
  }
  return inflight;
}

async function bumpSingleFactionTask(factionId, gameId, metric, amount, userId) {
  const state = await getOrHydrateFactionTaskState(factionId, gameId);
  if (!state || !state.taskKey || state.metric !== metric) return;
  if (factionTaskState.get(factionId) !== state) return;

  state.progress += amount;
  state.dirty = true;

  if (userId) {
    if (!state.contributions) state.contributions = new Map();
    state.contributions.set(userId, (state.contributions.get(userId) || 0) + amount);
  }

  if (state.progress >= state.target) {
    await completeFactionTask(factionId, state.taskKey, gameId, state.contributions);
  }
}

async function bumpFactionTaskProgress(player, metric, amount) {
  if (!player.factions?.length || amount <= 0) return;
  await Promise.all(player.factions.map((f) => bumpSingleFactionTask(f.id, player.gameId, metric, amount, player.userId)));
}

function getQuestState(player, questId) {
  return player.quests[questId] || { status: 'not_started', progress: 0, visited: [] };
}

function incrementKillQuests(player) {
  for (const quest of Object.values(QUESTS)) {
    if (quest.type !== 'kill_enemies') continue;
    if (quest.locationId && player.locationId !== quest.locationId) continue;

    const state = getQuestState(player, quest.id);
    if (state.status !== 'active') continue;

    state.progress = Math.min(quest.targetCount, state.progress + 1);
    if (state.progress >= quest.targetCount) {
      state.status = 'ready_to_turn_in';
    }
    player.quests[quest.id] = state;
    persistPlayer(player);

    safeSend(player.ws, {
      type: 'questUpdate',
      questId: quest.id,
      status: state.status,
      progress: state.progress,
      targetCount: quest.targetCount,
    });
  }
}

function applyKillRewards(player) {
  if (!player.alive) return;

  if (player.combat.healOnKill > 0) {
    const healed = Math.min(player.maxHealth, player.health + player.combat.healOnKill);
    if (healed !== player.health) {
      player.health = healed;
      safeSend(player.ws, { type: 'playerHealed', health: player.health, maxHealth: player.maxHealth });
    }
  }

  if (player.combat.energyOnKill > 0) {
    player.ability.energy = Math.min(player.combat.maxEnergy, player.ability.energy + player.combat.energyOnKill);
  }
}

// Every canyon boss drops exactly one meme fragment. Fired and forgotten: a
// failed grant must never block the kill from resolving, so it only logs.
async function grantCanyonCosmeticFragments(player, amount) {
  const result = await callInternalApi('/api/internal/game/cosmetic-crates/grant-fragments', {
    userId: player.userId, gameId: player.gameId, fragments: amount,
  }).catch((err) => {
    console.error('[CosmeticCrates] fragment grant error:', err.message);
    return null;
  });

  if (!result || !result.success) return;

  player.cosmeticCrates = {
    fragments: Math.max(0, Math.floor(Number(result.fragments) || 0)),
    crates: Math.max(0, Math.floor(Number(result.crates) || 0)),
  };

  safeSend(player.ws, {
    type: 'cosmeticCrateState',
    fragments: player.cosmeticCrates.fragments,
    crates: player.cosmeticCrates.crates,
  });
  safeSend(player.ws, { type: 'fragmentsGranted', amount: result.granted, source: 'canyon_boss_cosmetic' });
}

async function grantCanyonBossFragments(player, amount) {
  const result = await callInternalApi('/api/internal/game/companions/grant-fragments', {
    userId: player.userId, gameId: player.gameId, fragments: amount,
  }).catch((err) => {
    console.error('[Canyon] fragment grant error:', err.message);
    return null;
  });

  if (!result || !result.success) return;

  player.companions = {
    owned: Array.isArray(result.owned) ? result.owned : (player.companions?.owned || []),
    equipped: result.equipped || null,
    fragments: Math.max(0, Math.floor(Number(result.fragments) || 0)),
    crates: Math.max(0, Math.floor(Number(result.crates) || 0)),
  };
  player.companionsChangedAt = Date.now();

  safeSend(player.ws, {
    type: 'companionState',
    owned: player.companions.owned,
    equipped: player.companions.equipped,
    fragments: player.companions.fragments,
    crates: player.companions.crates,
  });
  safeSend(player.ws, { type: 'fragmentsGranted', amount: result.granted, source: 'canyon_boss' });
}

function applyEnemyDamage(player, enemy, amount, options = {}) {
  if (!enemy.alive) return false;

  markInCombat(player);

  const now = Date.now();
  const damage = Math.max(1, Math.round(amount * abilities.damageTakenMultFromEffects(enemy, now)));
  enemy.health = Math.max(0, enemy.health - damage);

  const shared = player.locationId === 'main-world';
  const inCave = player.locationId === CAVE_LOCATION_ID;
  const inInfluence = player.locationId === INFLUENCE_LOCATION_ID;
  const broadcastShared = shared || inCave || inInfluence;
  const arenaRun = player.locationId === ARENA_LOCATION_ID ? arena.runForPlayer(player.id) : null;
  const damagedMessage = {
    type: 'enemyDamaged',
    id: enemy.id,
    health: enemy.health,
    attackerId: player.id,
    point: options.point || enemy.position,
    abilityId: options.abilityId || null,
  };

  if (arenaRun) broadcastArena(arenaRun, damagedMessage);
  else if (broadcastShared) broadcastToLocation(player.locationId, damagedMessage, null, player.instance);
  else safeSend(player.ws, damagedMessage);

  if (inCave || inInfluence) {
    enemy.lastHitAt = now;
    const cfg = ENEMY_TYPES[enemy.type];
    if (cfg.arena) {
      enemy.provokedBy = player.id;
      enemy.provokedUntil = now + BOSS_PROVOKE_MS;
    }
  }

  if (enemy.health > 0) {
    if (options.keepTarget !== false) enemy.targetId = player.id;
    return false;
  }

  enemy.alive = false;
  enemy.targetId = null;
  abilities.clearEffects(enemy);

  const deathMessage = { type: 'enemyDeath', id: enemy.id, killerId: player.id };
  if (arenaRun) broadcastArena(arenaRun, deathMessage);
  else if (broadcastShared) broadcastToLocation(player.locationId, deathMessage, null, player.instance);
  else safeSend(player.ws, deathMessage);

  incrementKillQuests(player);
  applyKillRewards(player);

  if (arenaRun) return true;

  grantEnemyKillXp(player, enemy.type);

  const cfg = ENEMY_TYPES[enemy.type];

  if (shared) {
    enemy.cast = null;
    enemy.pendingImpacts = [];
    enemy.pools = [];
    enemy.respawnAt = Date.now() + WARDEN_RESPAWN_MS;
    dropLoot(enemy.position, player.instance, cfg.lootMin, cfg.lootMax);
    return true;
  }

  if (inInfluence) {
    enemy.cast = null;
    enemy.pendingImpacts = [];
    enemy.pools = [];

    if (influenceRun && enemy.id === influenceRun.bossId && !influenceState.bossDefeated) {
      onConfessorDefeated(player);
    } else if (influenceRun && enemy.role !== 'ambient') {
      influenceRun.enemies.delete(enemy.id);
    }

    return true;
  }

  if (inCave) {
    const cave = caveInstances.get(player.instance);
    if (cave && enemy.id === cave.bossId && !cave.bossDefeated) {
      cave.bossDefeated = true;
      cave.bossChest = {
        x: enemy.position[0],
        z: enemy.position[2],
        looted: new Set(),
      };

      for (const occupant of cavePlayersIn(player.instance)) {
        grantXp(occupant, progression.XP_SOURCES.caveBossXp, 'cave_boss');
      }

      broadcastToLocation(
        CAVE_LOCATION_ID,
        { type: 'caveBossState', defeated: true },
        null,
        player.instance
      );
      broadcastToLocation(
        CAVE_LOCATION_ID,
        { type: 'caveChestSpawn', chestId: CAVE_BOSS_CHEST_ID, x: cave.bossChest.x, z: cave.bossChest.z },
        null,
        player.instance
      );
    }
    return true;
  }

  const alreadyCleared = player.canyon.clearedSegments.has(player.canyon.segment);
  dropCanyonLoot(
    player,
    enemy.position,
    cfg.lootMin,
    Math.round(cfg.lootMax * player.combat.lootMult * memeLootMult(player, now)),
    alreadyCleared ? CANYON_REPEAT_LOOT_MULT : 1
  );

  if (enemy.id === player.canyon.bossId) {
    const clearedSegment = player.canyon.segment;
    player.canyon.runCleared = true;
    if (!alreadyCleared) {
      player.canyon.clearedSegments.add(clearedSegment);
    }
    grantXp(player, progression.canyonSegmentXp(clearedSegment, alreadyCleared), `canyon:${clearedSegment}`);
    const nextSegment = Math.min(clearedSegment + 1, CANYON_MAX_SEGMENT_CAP);
    if (nextSegment > player.canyon.maxSegmentReached) {
      player.canyon.maxSegmentReached = nextSegment;
    }
    persistPlayer(player);

    grantCanyonBossFragments(player, CANYON_BOSS_FRAGMENTS);
    if (clearedSegment >= CANYON_COSMETIC_FRAGMENT_FROM) {
      grantCanyonCosmeticFragments(player, CANYON_BOSS_FRAGMENTS);
    }

    player.canyon.pendingSegment = nextSegment;

    safeSend(player.ws, {
      type: 'canyonCleared',
      clearedSegment,
      segment: nextSegment,
      maxSegmentReached: player.canyon.maxSegmentReached,
      name: canyonSegmentName(nextSegment),
      biome: canyonBiomeFor(nextSegment).key,
    });
  }

  return true;
}

function incomingDamageMultiplier(target, now) {
  let mult = target.combat.damageTakenMult * abilities.damageTakenMultFromEffects(target, now);

  const threshold = target.combat.lowHealthThreshold;
  if (threshold > 0 && target.health <= target.maxHealth * threshold) {
    mult *= target.combat.lowHealthDamageTakenMult;
  }

  return Math.max(0, mult);
}

function syncShieldVisibility(player, now) {
  const active = abilities.shieldRemaining(player.ability, now) > 0;
  if (active === !!player.shieldVisible) return;

  player.shieldVisible = active;
  broadcast({ type: 'playerShield', playerId: player.id, active }, player.id, true, player);
}

function sendAbilityMeter(player) {
  const now = Date.now();
  safeSend(player.ws, {
    type: 'abilityMeter',
    energy: Math.floor(player.ability.energy),
    maxEnergy: player.combat.maxEnergy,
    shield: abilities.shieldRemaining(player.ability, now),
    shieldMax: player.ability.shieldMax,
  });
}

function applyPlayerDamage(target, amount, options = {}) {
  if (!target.alive) return 0;

  const attacker = options.attacker || null;
  if (attacker && attacker !== target) markInCombat(attacker);

  const now = Date.now();
  if (isSpawnProtected(target)) return 0;
  if (abilities.isInvulnerable(target, target.ability, now)) return 0;

  cancelHomeTeleport(target, 'damaged');
  cancelArenaRevive(target, 'damaged');
  markInCombat(target);

  const raw = Math.max(1, Math.round(amount * incomingDamageMultiplier(target, now)));
  const penetration = Math.min(0.9, Math.max(0, options.penetration || 0));
  const throughShield = Math.round(raw * penetration);

  const absorb = options.ignoreShield
    ? { absorbed: 0, remaining: raw - throughShield, broke: false }
    : abilities.absorbWithShield(target.ability, raw - throughShield, now);

  const applied = absorb.remaining + throughShield;
  if (absorb.absorbed > 0) {
    sendAbilityMeter(target);
    if (absorb.broke) startPostShieldRegen(target, now);
  }

  if (applied > 0) {
    target.health = Math.max(0, target.health - applied);
    target.lastDamageTime = now;
  }

  const damageMessage = {
    type: 'playerDamaged',
    targetId: target.id,
    attackerId: options.attackerId || null,
    damage: applied,
    absorbed: absorb.absorbed,
    health: target.health,
    point: options.point || target.position,
    historicalPosition: options.point || target.position,
    abilityId: options.abilityId || null,
  };

  safeSend(target.ws, damageMessage);
  if (options.broadcast !== false) broadcast(damageMessage, target.id, true, target);

  if (attacker && applied > 0) reflectDamage(target, attacker, applied, now);

  if (target.health <= 0) {
    if (attemptDeathTrigger(target, !!attacker, now)) return applied;

    if (attacker && !dust2MemberOf(attacker)) {
      attacker.stats.kills++;
      bumpFactionTaskProgress(attacker, 'kills', 1).catch((err) => console.error('[FactionTask] bump error:', err.message));
      applyKillRewards(attacker);
    }
    markPlayerDead(target, options.attackerId || null, options.point || target.position);
  }

  return applied;
}

function reflectDamage(target, attacker, applied, now) {
  const reflect = abilities.findEffect(target, 'reflect_ward', now);
  if (!reflect || !attacker.alive) return;

  const share = applied * (reflect.reflectPercent || 0) / 100;
  const scaled = progression.scalePvpDamage(share, reflect.damageClass || 'singleHit', attacker.maxHealth);
  if (scaled < 1) return;

  applyPlayerDamage(attacker, scaled, {
    attackerId: target.id,
    abilityId: 'reflect_ward',
    point: attacker.position,
  });
}

function startPostShieldRegen(player, now) {
  if (player.combat.postShieldRegen <= 0 || player.combat.postShieldRegenMs <= 0) return;

  abilities.addEffect(player, {
    id: 'post_shield_regen',
    expiresAt: now + player.combat.postShieldRegenMs,
    healPerSecond: player.combat.postShieldRegen,
  });
}

function attemptDeathTrigger(player, inPvp, now) {
  const triggers = skills.unlockedTriggers(player.progression.skills);
  if (triggers.length === 0) return false;

  const trigger = triggers[0];
  const cooldownMs = inPvp ? trigger.pvpCooldownMs : trigger.cooldownMs;
  if (!abilities.triggerReady(player.ability, trigger.id, now)) return false;

  abilities.startTriggerCooldown(player.ability, trigger.id, cooldownMs, now);

  player.health = Math.min(player.maxHealth, trigger.params.reviveHealth);
  player.ability.iframesUntil = now + trigger.params.invulnerabilityMs;

  safeSend(player.ws, {
    type: 'abilityTrigger',
    triggerId: trigger.id,
    health: player.health,
    invulnerabilityMs: trigger.params.invulnerabilityMs,
    readyAt: player.ability.triggerReadyAt[trigger.id],
  });

  broadcast({
    type: 'abilityEffect',
    casterId: player.id,
    abilityId: trigger.id,
    kind: 'revive',
    position: player.position,
  }, player.id, true, player);

  return true;
}

const abilityZones = new Map();
const abilityImpacts = [];
let nextAbilityEntitySeq = 0;

function abilityEntityId(prefix) {
  nextAbilityEntitySeq += 1;
  return `${prefix}-${nextAbilityEntitySeq}`;
}

function sameShard(a, b) {
  if (a.locationId !== b.locationId) return false;
  if (!isShardedLocation(a.locationId)) return true;
  return a.instance === b.instance;
}

function zoneCoversPlayer(zone, player) {
  if (zone.locationId !== player.locationId) return false;
  if (isShardedLocation(zone.locationId) && zone.instance !== player.instance) return false;
  return abilities.withinRadius(player.position, zone.x, zone.z, zone.radius);
}

function allyDamageBonus(player) {
  let bonus = 0;
  for (const zone of abilityZones.values()) {
    if (zone.allyDamagePercent <= 0) continue;
    if (!zoneCoversPlayer(zone, player)) continue;
    bonus += zone.allyDamagePercent;
  }
  return 1 + bonus / 100;
}

function enemyDamageOutputMult(enemy, now) {
  let mult = 1;
  for (const effect of enemy.effects || []) {
    if (effect.expiresAt <= now) continue;
    if (typeof effect.damageOutputPercent === 'number') mult *= 1 + effect.damageOutputPercent / 100;
  }
  return Math.max(0, mult);
}

function enemySpeedMult(enemy, now) {
  if (abilities.isStunned(enemy, now)) return 0;
  return abilities.speedMultFromEffects(enemy, now);
}

function canAbilityHitPlayer(caster, target) {
  if (!target.authenticated || !target.alive) return false;
  if (target.id === caster.id) return false;
  if (party.areAllies(caster.id, target.id)) return false;
  if (!sameShard(caster, target)) return false;
  if (isInProtectedZone(caster) || isInProtectedZone(target)) return false;
  if (isSpawnProtected(target)) return false;
  return true;
}

function forEachAbilityTargetPlayer(caster, fn) {
  players.forEach((other) => {
    if (!canAbilityHitPlayer(caster, other)) return;
    fn(other);
  });
}

function forEachAbilityAlly(caster, fn) {
  players.forEach((other) => {
    if (!other.authenticated || !other.alive) return;
    if (!sameShard(caster, other)) return;
    fn(other);
  });
}

function damageEnemiesInRadius(player, x, z, radius, damage, options = {}) {
  const enemies = activeEnemiesFor(player);
  if (!enemies) return 0;

  let hits = 0;
  for (const enemy of Array.from(enemies.values())) {
    if (!enemy.alive) continue;
    if (!abilities.withinRadius(enemy.position, x, z, radius)) continue;

    applyEnemyDamage(player, enemy, damage, options);
    hits += 1;
  }
  return hits;
}

function damagePlayersInRadius(caster, x, z, radius, damage, damageClass, options = {}) {
  let hits = 0;
  forEachAbilityTargetPlayer(caster, (target) => {
    if (!abilities.withinRadius(target.position, x, z, radius)) return;

    const scaled = progression.scalePvpDamage(damage, damageClass, target.maxHealth);
    if (scaled < 1) return;

    applyPlayerDamage(target, scaled, {
      attacker: caster,
      attackerId: caster.id,
      abilityId: options.abilityId || null,
      point: target.position,
    });
    hits += 1;
  });
  return hits;
}

function applyEnemyEffectsInRadius(player, x, z, radius, effect) {
  const enemies = activeEnemiesFor(player);
  if (!enemies) return;

  for (const enemy of enemies.values()) {
    if (!enemy.alive) continue;
    if (!abilities.withinRadius(enemy.position, x, z, radius)) continue;
    abilities.addEffect(enemy, { ...effect });
  }
}

const RICOCHET_RANGE = 14;

function shotPassiveDamage(player, shot, targetKind) {
  const base = targetKind === 'enemy' ? player.combat.enemyDamage : player.combat.pvpDamage;
  return base * shot.damageMult * allyDamageBonus(player);
}

function applyBulletDamage(player, target, damage, options = {}) {
  const shielded = abilities.shieldRemaining(target.ability, Date.now()) > 0;
  const scaled = shielded ? damage : damage * (1 + player.combat.damageVsUnshielded);

  return applyPlayerDamage(target, scaled, {
    ...options,
    attacker: player,
    attackerId: player.id,
    penetration: player.combat.armorPen,
  });
}

function advanceExplosiveRound(player) {
  if (player.combat.explosiveEveryNthShot <= 0) return false;

  player.explosiveShotCount = (player.explosiveShotCount || 0) + 1;
  if (player.explosiveShotCount < player.combat.explosiveEveryNthShot) return false;

  player.explosiveShotCount = 0;
  return true;
}

function detonateExplosiveShot(player, shot, point) {
  const radius = player.combat.explosiveRadius;
  if (radius <= 0 || player.combat.explosiveDamage <= 0) return;

  broadcastToLocation(player.locationId, {
    type: 'abilityEffect',
    casterId: player.id,
    abilityId: 'explosive_rounds',
    kind: 'impact',
    position: point,
    radius,
  }, null, player.instance);

  damageEnemiesInRadius(
    player,
    point[0],
    point[2],
    radius,
    shotPassiveDamage(player, shot, 'enemy') * player.combat.explosiveDamage,
    { abilityId: 'explosive_rounds', point }
  );

  const pvpDamage = shotPassiveDamage(player, shot, 'player') * player.combat.explosiveDamage;
  forEachAbilityTargetPlayer(player, (target) => {
    if (!abilities.withinRadius(target.position, point[0], point[2], radius)) return;

    applyBulletDamage(player, target, pvpDamage, {
      abilityId: 'explosive_rounds',
      point: target.position,
    });
  });
}

function ricochetTarget(player, from, excludeId) {
  let best = null;
  let bestDistance = RICOCHET_RANGE;

  const enemies = activeEnemiesFor(player);
  if (enemies) {
    for (const enemy of enemies.values()) {
      if (!enemy.alive || enemy.id === excludeId) continue;

      const distance = abilities.distance2D(from, enemy.position);
      if (distance >= bestDistance) continue;

      best = { kind: 'enemy', entity: enemy };
      bestDistance = distance;
    }
  }

  forEachAbilityTargetPlayer(player, (other) => {
    if (other.id === excludeId) return;

    const distance = abilities.distance2D(from, other.position);
    if (distance >= bestDistance) return;

    best = { kind: 'player', entity: other };
    bestDistance = distance;
  });

  return best;
}

function applyRicochet(player, shot, from, excludeId) {
  if (player.combat.ricochetChance <= 0 || player.combat.ricochetDamage <= 0) return;
  if (Math.random() >= player.combat.ricochetChance) return;

  const target = ricochetTarget(player, from, excludeId);
  if (!target) return;

  const damage = shotPassiveDamage(player, shot, target.kind) * player.combat.ricochetDamage;

  if (target.kind === 'enemy') {
    applyEnemyDamage(player, target.entity, damage, {
      abilityId: 'ricochet',
      point: target.entity.position,
    });
  } else {
    applyBulletDamage(player, target.entity, damage, {
      abilityId: 'ricochet',
      point: target.entity.position,
    });
  }

  broadcastToLocation(player.locationId, {
    type: 'abilityEffect',
    casterId: player.id,
    abilityId: 'ricochet',
    kind: 'chain',
    position: target.entity.position,
    radius: 0,
    chain: [from, target.entity.position],
  }, null, player.instance);
}

function applyBoltBurn(player, shot, hit, now) {
  if (shot.mode !== 'charged') return;
  if (player.combat.burnDamage <= 0 || player.combat.burnDurationMs <= 0) return;

  const perSecond = player.combat.burnDamage / (player.combat.burnDurationMs / 1000);

  abilities.addEffect(hit.entity, {
    id: 'burning',
    expiresAt: now + player.combat.burnDurationMs,
    damagePerSecond: hit.kind === 'enemy'
      ? perSecond
      : progression.scalePvpDamage(perSecond, 'zoneTick', hit.entity.maxHealth),
    casterId: player.id,
  });
}

function applyShotPassives(player, shot, hit, point) {
  if (shot.explosive) detonateExplosiveShot(player, shot, point);
  if (hit.entity.alive) applyBoltBurn(player, shot, hit, Date.now());
  applyRicochet(player, shot, point, hit.entity.id);
}

function pickAimTarget(player, origin, direction, maxRange) {
  let best = null;

  const consider = (kind, entity, position) => {
    const dx = position[0] - origin[0];
    const dy = position[1] + 1 - origin[1];
    const dz = position[2] - origin[2];

    const along = dx * direction[0] + dy * direction[1] + dz * direction[2];
    if (along < 0 || along > maxRange) return;

    const offX = dx - direction[0] * along;
    const offY = dy - direction[1] * along;
    const offZ = dz - direction[2] * along;
    if (Math.hypot(offX, offY, offZ) > 2.5) return;

    if (!best || along < best.along) best = { kind, entity, along };
  };

  const enemies = activeEnemiesFor(player);
  if (enemies) {
    for (const enemy of enemies.values()) {
      if (enemy.alive) consider('enemy', enemy, enemy.position);
    }
  }

  forEachAbilityTargetPlayer(player, (other) => consider('player', other, other.position));

  return best;
}

function spawnAbilityZone(player, abilityId, config, silent = false) {
  const now = Date.now();
  const zone = {
    id: abilityEntityId('zone'),
    casterId: player.id,
    abilityId,
    locationId: player.locationId,
    instance: player.instance,
    x: config.x,
    y: config.y || 0,
    z: config.z,
    radius: config.radius,
    expiresAt: now + config.durationMs,
    nextTickAt: now,
    silent,
    damagePerSecond: config.damagePerSecond || 0,
    damageClass: config.damageClass || 'zoneTick',
    healPerSecond: config.healPerSecond || 0,
    enemySlowPercent: config.enemySlowPercent || 0,
    allySpeedPercent: config.allySpeedPercent || 0,
    enemyDamagePercent: config.enemyDamagePercent || 0,
    allyDamagePercent: config.allyDamagePercent || 0,
    pullStrength: config.pullStrength || 0,
    hostile: config.hostile !== false,
  };

  abilityZones.set(zone.id, zone);
  if (silent) return zone;

  broadcastToLocation(player.locationId, zoneAnnouncement(zone, config.durationMs), null, player.instance);

  return zone;
}

function zoneAnnouncement(zone, durationMs) {
  return {
    type: 'abilityZone',
    zoneId: zone.id,
    casterId: zone.casterId,
    abilityId: zone.abilityId,
    position: [zone.x, zone.y, zone.z],
    radius: zone.radius,
    durationMs,
    slowPercent: zone.hostile ? zone.enemySlowPercent : 0,
  };
}

function sendActiveZones(player) {
  const now = Date.now();

  for (const zone of abilityZones.values()) {
    if (zone.silent || zone.expiresAt <= now) continue;
    if (zone.locationId !== player.locationId) continue;
    if (isShardedLocation(zone.locationId) && zone.instance !== player.instance) continue;

    safeSend(player.ws, zoneAnnouncement(zone, zone.expiresAt - now));
  }
}

function scheduleAbilityImpact(player, abilityId, config) {
  const impact = {
    casterId: player.id,
    abilityId,
    locationId: player.locationId,
    instance: player.instance,
    x: config.x,
    y: config.y || 0,
    z: config.z,
    radius: config.radius,
    damage: config.damage,
    damageClass: config.damageClass || 'singleHit',
    resolveAt: config.resolveAt,
    knockback: config.knockback || 0,
    stunMs: config.stunMs || 0,
    groundFire: config.groundFire || null,
    cluster: config.cluster || null,
    bleed: config.bleed || null,
  };

  const now = Date.now();
  if (impact.resolveAt > now) {
    abilityImpacts.push(impact);
    broadcastToLocation(player.locationId, {
      type: 'abilityImpactPending',
      casterId: player.id,
      abilityId,
      position: [impact.x, impact.y, impact.z],
      radius: impact.radius,
      resolveInMs: impact.resolveAt - now,
    }, null, player.instance);
    return;
  }

  resolveAbilityImpact(impact, now);
}

function resolveAbilityImpact(impact, now) {
  const caster = players.get(impact.casterId);
  if (!caster || !caster.authenticated) return;
  if (caster.locationId !== impact.locationId) return;

  broadcastToLocation(impact.locationId, {
    type: 'abilityEffect',
    casterId: caster.id,
    abilityId: impact.abilityId,
    kind: 'impact',
    position: [impact.x, impact.y, impact.z],
    radius: impact.radius,
  }, null, impact.instance);

  damageEnemiesInRadius(caster, impact.x, impact.z, impact.radius, impact.damage, {
    abilityId: impact.abilityId,
    point: [impact.x, impact.y, impact.z],
  });
  damagePlayersInRadius(caster, impact.x, impact.z, impact.radius, impact.damage, impact.damageClass, {
    abilityId: impact.abilityId,
  });

  if (impact.knockback > 0 || impact.stunMs > 0) {
    const enemies = activeEnemiesFor(caster);
    if (enemies) {
      for (const enemy of enemies.values()) {
        if (!enemy.alive) continue;
        if (!abilities.withinRadius(enemy.position, impact.x, impact.z, impact.radius)) continue;

        if (impact.knockback > 0) pushEnemyAway(enemy, impact.x, impact.z, impact.knockback);
        if (impact.stunMs > 0) {
          abilities.addEffect(enemy, { id: 'stunned', expiresAt: now + impact.stunMs });
        }
      }
    }
  }

  if (impact.bleed && impact.bleed.damage > 0) {
    applyEnemyEffectsInRadius(caster, impact.x, impact.z, impact.radius, {
      id: 'bleeding',
      expiresAt: now + impact.bleed.durationMs,
      damagePerSecond: impact.bleed.damage / (impact.bleed.durationMs / 1000),
      casterId: caster.id,
    });
  }

  if (impact.groundFire) {
    spawnAbilityZone(caster, impact.abilityId, {
      x: impact.x,
      y: impact.y,
      z: impact.z,
      radius: impact.radius,
      durationMs: impact.groundFire.durationMs,
      damagePerSecond: impact.groundFire.damagePerSecond,
      damageClass: 'zoneTick',
    });
  }

  if (impact.cluster && impact.cluster.count > 0) {
    for (let i = 0; i < impact.cluster.count; i++) {
      const angle = (Math.PI * 2 * i) / impact.cluster.count;
      const spread = impact.radius * 0.7;
      scheduleAbilityImpact(caster, impact.abilityId, {
        x: impact.x + Math.cos(angle) * spread,
        y: impact.y,
        z: impact.z + Math.sin(angle) * spread,
        radius: impact.radius * 0.6,
        damage: impact.cluster.damage,
        damageClass: impact.damageClass,
        resolveAt: now + 500,
      });
    }
  }
}

function pushEnemyAway(enemy, x, z, distance) {
  const dx = enemy.position[0] - x;
  const dz = enemy.position[2] - z;
  const length = Math.hypot(dx, dz) || 1;

  enemy.position[0] += (dx / length) * distance;
  enemy.position[2] += (dz / length) * distance;
}

function pullEnemyToward(enemy, x, z, distance) {
  const dx = x - enemy.position[0];
  const dz = z - enemy.position[2];
  const length = Math.hypot(dx, dz);
  if (length < 0.4) return;

  const step = Math.min(distance, length);
  enemy.position[0] += (dx / length) * step;
  enemy.position[2] += (dz / length) * step;
}

function tickAbilityZone(zone, now, deltaSeconds) {
  const caster = players.get(zone.casterId);
  if (!caster || !caster.authenticated) return false;

  const enemies = activeEnemiesFor(caster);
  const lapse = ABILITY_TICK_MS * 2;

  if (enemies && caster.locationId === zone.locationId) {
    for (const enemy of Array.from(enemies.values())) {
      if (!enemy.alive) continue;
      if (!abilities.withinRadius(enemy.position, zone.x, zone.z, zone.radius)) continue;

      if (zone.enemySlowPercent > 0) {
        abilities.addEffect(enemy, {
          id: `zone_slow_${zone.id}`,
          expiresAt: now + lapse,
          slowPercent: zone.enemySlowPercent,
        });
      }

      if (zone.enemyDamagePercent !== 0) {
        abilities.addEffect(enemy, {
          id: `zone_suppress_${zone.id}`,
          expiresAt: now + lapse,
          damageOutputPercent: zone.enemyDamagePercent,
        });
      }

      if (zone.pullStrength > 0) pullEnemyToward(enemy, zone.x, zone.z, zone.pullStrength * deltaSeconds);

      if (zone.damagePerSecond > 0) {
        applyEnemyDamage(caster, enemy, zone.damagePerSecond * deltaSeconds, {
          abilityId: zone.abilityId,
          point: enemy.position,
          keepTarget: false,
        });
      }
    }
  }

  if (zone.hostile && zone.damagePerSecond > 0) {
    damagePlayersInRadius(
      caster,
      zone.x,
      zone.z,
      zone.radius,
      zone.damagePerSecond * deltaSeconds,
      zone.damageClass,
      { abilityId: zone.abilityId }
    );
  }

  if (zone.hostile && zone.enemySlowPercent > 0) {
    forEachAbilityTargetPlayer(caster, (target) => {
      if (!abilities.withinRadius(target.position, zone.x, zone.z, zone.radius)) return;
      abilities.addEffect(target, {
        id: `zone_slow_${zone.id}`,
        expiresAt: now + lapse,
        slowPercent: zone.enemySlowPercent,
      });
    });
  }

  if (zone.healPerSecond > 0 || zone.allySpeedPercent > 0) {
    forEachAbilityAlly(caster, (ally) => {
      if (!zoneCoversPlayer(zone, ally)) return;

      if (zone.allySpeedPercent > 0) {
        abilities.addEffect(ally, {
          id: `zone_haste_${zone.id}`,
          expiresAt: now + lapse,
          speedPercent: zone.allySpeedPercent,
        });
      }

      if (zone.healPerSecond > 0) healPlayer(ally, zone.healPerSecond * deltaSeconds);
    });
  }

  return true;
}

function healPlayer(player, amount) {
  if (!player.alive) return;

  const healed = Math.min(player.maxHealth, player.health + amount);
  if (Math.floor(healed) === Math.floor(player.health)) {
    player.health = healed;
    return;
  }

  player.health = healed;
  safeSend(player.ws, { type: 'playerHealed', health: Math.floor(player.health), maxHealth: player.maxHealth });
}

function tickPlayerEffects(player, now, deltaSeconds) {
  const regen = abilities.findEffect(player, 'post_shield_regen', now);
  if (regen) healPlayer(player, regen.healPerSecond * deltaSeconds);

  for (const effect of player.effects || []) {
    if (effect.expiresAt <= now) continue;
    if (typeof effect.damagePerSecond === 'number' && effect.damagePerSecond > 0) {
      applyPlayerDamage(player, effect.damagePerSecond * deltaSeconds, {
        attackerId: effect.casterId || null,
        abilityId: effect.id,
        ignoreShield: true,
        broadcast: false,
      });
    }
  }
}

function tickEnemyDots(now, deltaSeconds) {
  players.forEach((player) => {
    if (!player.authenticated) return;

    const enemies = activeEnemiesFor(player);
    if (!enemies) return;

    for (const enemy of Array.from(enemies.values())) {
      if (!enemy.alive) continue;

      abilities.pruneEffects(enemy, now);
      if (!enemy.effects || enemy.effects.length === 0) continue;

      for (const effect of enemy.effects) {
        if (effect.expiresAt <= now) continue;
        if (typeof effect.damagePerSecond !== 'number' || effect.damagePerSecond <= 0) continue;
        if (effect.casterId && effect.casterId !== player.id) continue;

        applyEnemyDamage(player, enemy, effect.damagePerSecond * deltaSeconds, {
          abilityId: effect.id,
          point: enemy.position,
          keepTarget: false,
        });
      }
    }
  });
}

function abilityTick() {
  const now = Date.now();
  const deltaSeconds = ABILITY_TICK_MS / 1000;

  players.forEach((player) => {
    if (!player.authenticated || !player.combat) return;

    abilities.regenEnergy(player.ability, player.combat, now);
    abilities.tickCharges(player.ability, player.combat.stats, now);
    abilities.pruneEffects(player, now);

    if (player.ability.shield > 0 && player.ability.shieldExpiresAt <= now) {
      abilities.breakShield(player.ability);
      startPostShieldRegen(player, now);
      sendAbilityMeter(player);
    }

    syncShieldVisibility(player, now);

    if (player.homeTeleportCastUntil > 0 && now >= player.homeTeleportCastUntil) {
      completeHomeTeleport(player, now);
    }

    if (player.arenaReviveUntil > 0 && now >= player.arenaReviveUntil) {
      completeArenaRevive(player, now);
    }

    if (player.alive) tickPlayerEffects(player, now, deltaSeconds);
  });

  tickEnemyDots(now, deltaSeconds);

  for (const [zoneId, zone] of abilityZones) {
    if (now >= zone.expiresAt) {
      abilityZones.delete(zoneId);
      broadcastToLocation(zone.locationId, { type: 'abilityZoneEnded', zoneId }, null, zone.instance);
      continue;
    }

    if (!tickAbilityZone(zone, now, deltaSeconds)) {
      abilityZones.delete(zoneId);
      broadcastToLocation(zone.locationId, { type: 'abilityZoneEnded', zoneId }, null, zone.instance);
    }
  }

  for (let i = abilityImpacts.length - 1; i >= 0; i--) {
    if (now < abilityImpacts[i].resolveAt) continue;
    const [impact] = abilityImpacts.splice(i, 1);
    resolveAbilityImpact(impact, now);
  }
}

safeInterval(abilityTick, ABILITY_TICK_MS);

function clearPlayerAbilityWorld(playerId) {
  for (const [zoneId, zone] of abilityZones) {
    if (zone.casterId !== playerId) continue;
    abilityZones.delete(zoneId);
    broadcastToLocation(zone.locationId, { type: 'abilityZoneEnded', zoneId }, null, zone.instance);
  }

  for (let i = abilityImpacts.length - 1; i >= 0; i--) {
    if (abilityImpacts[i].casterId === playerId) abilityImpacts.splice(i, 1);
  }
}

function resetPlayerAbilities(player) {
  abilities.resetAbilityState(player.ability, player.combat.maxEnergy);
  abilities.clearEffects(player);
  clearPlayerAbilityWorld(player.id);
}

function clearPlayerAbilityBuffs(player, restoreEnergy) {
  if (!player.ability) return;

  abilities.clearEffects(player);
  abilities.breakShield(player.ability);
  player.ability.iframesUntil = 0;
  if (restoreEnergy) player.ability.energy = player.combat.maxEnergy;
  clearPlayerAbilityWorld(player.id);
}

function abilityFireRateMult(player, now) {
  let mult = 1;

  const overdrive = abilities.findEffect(player, 'overdrive', now);
  if (overdrive) mult *= overdrive.fireRateMult;

  const haste = abilities.findEffect(player, 'marked_ally_haste', now);
  if (haste) mult *= 1 / (1 + haste.fireRatePercent / 100);

  return Math.max(0.4, mult);
}

function abilityMoveSpeedMult(player, now) {
  return Math.max(1, abilities.speedMultFromEffects(player, now));
}

function fireModeFor(player) {
  const modeId = player.progression.fireMode || 'single';
  if (modeId === 'single') return progression.SINGLE_FIRE_MODE;
  if (!skills.hasMode(player.progression.skills, modeId)) return progression.SINGLE_FIRE_MODE;
  if (skills.modeBranch(modeId) !== player.progression.branch) return progression.SINGLE_FIRE_MODE;

  return skills.modeDefinition(modeId) || progression.SINGLE_FIRE_MODE;
}

function shotProjectileCount(mode) {
  return Math.max(1, Math.floor(mode.projectiles || 1));
}

function shotIntervalFor(player, weapon, mode, now) {
  const base = mode.fireRateMs || weapon.fireRateMs;
  const interval = mode.chargeMs ? Math.max(base, mode.chargeMs) : base;

  return interval * abilityFireRateMult(player, now);
}

function boltEnergyCost(player, weapon, mode) {
  const raw = weapon.boltEnergyCost * (mode.manaCostMult || 1) * player.combat.manaCostMult;
  return Math.max(0, Math.round(raw));
}

function boltSpeedFor(player, weapon) {
  return weapon.projectileSpeed * player.combat.projectileSpeedMult;
}

function shotLifetimeMs(shot) {
  if (!shot.speed) return CONFIG.combat.shotMatchWindowMs;
  return CONFIG.combat.shotMatchWindowMs + (shot.maxRange / shot.speed) * 1000;
}

function alongRay(origin, direction, point) {
  return (point[0] - origin[0]) * direction[0]
    + (point[1] - origin[1]) * direction[1]
    + (point[2] - origin[2]) * direction[2];
}

function projectileTimingPlausible(shot, point, age) {
  const travel = Math.max(0, alongRay(shot.origin, shot.direction, point));
  const expected = (travel / shot.speed) * 1000;
  return Math.abs(age - expected) <= CONFIG.combat.shotMatchWindowMs;
}

function readShotDirections(data, limit, spreadDegrees) {
  const raw = Array.isArray(data.directions) && data.directions.length > 0
    ? data.directions
    : [data.direction];

  if (raw.length > limit) return null;

  const normalized = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length !== 3) return null;
    if (!entry.every(Number.isFinite)) return null;

    const direction = abilities.normalizeDirection(entry);
    if (!direction) return null;
    normalized.push(direction);
  }

  if (normalized.length > 1) {
    const maxAngle = Math.cos(((spreadDegrees + SHOT_SPREAD_TOLERANCE_DEG) * Math.PI) / 180);
    const [first] = normalized;

    for (let i = 1; i < normalized.length; i++) {
      const dot = first[0] * normalized[i][0] + first[1] * normalized[i][1] + first[2] * normalized[i][2];
      if (dot < maxAngle) return null;
    }
  }

  return normalized;
}

function grantDashGrace(player, now) {
  player.abilityMoveGraceUntil = now + 700;
  player.positionHistory = [];
}

function dashPlayer(player, direction, distance, now) {
  const flat = Math.hypot(direction[0], direction[2]);
  if (flat < 0.001) return null;

  const target = [
    player.position[0] + (direction[0] / flat) * distance,
    player.position[1],
    player.position[2] + (direction[2] / flat) * distance,
  ];

  const maxRadius = getLocationMaxRadius(player.locationId);
  if (maxRadius != null) {
    const reach = Math.hypot(target[0], target[2]);
    if (reach > maxRadius - 1) {
      const scale = (maxRadius - 1) / reach;
      target[0] *= scale;
      target[2] *= scale;
    }
  }

  player.position = target;
  grantDashGrace(player, now);

  if (player.combat.postDashSpeed !== 0 || player.combat.postDashDamageTaken !== 0) {
    abilities.addEffect(player, {
      id: 'post_dash',
      expiresAt: now + 2000,
      speedPercent: player.combat.postDashSpeed * 100,
      damageTakenPercent: player.combat.postDashDamageTaken * 100,
    });
  }

  return target;
}

function abilityScaledDamage(player, abilityId, base, now) {
  return base * abilities.damageMultiplier(abilityId, player.combat.stats, player, now);
}

function abilityScaledRadius(player, abilityId, base) {
  return base * abilities.radiusMultiplier(abilityId, player.combat.stats);
}

function abilityScaledDuration(player, abilityId, base) {
  return Math.round(base * abilities.durationMultiplier(abilityId, player.combat.stats));
}

function zoneBaseConfig(player, abilityId, point, params, durationMs) {
  return {
    x: point[0],
    y: point[1],
    z: point[2],
    radius: abilityScaledRadius(player, abilityId, params.radius),
    durationMs: abilityScaledDuration(player, abilityId, durationMs),
    damagePerSecond: abilities.zoneTickBonus(player.combat.stats),
    allyDamagePercent: player.combat.allyDamageInZone * 100,
  };
}

function bleedConfig(player) {
  if (player.combat.bleedDamage <= 0 || player.combat.bleedDurationMs <= 0) return null;
  return { damage: player.combat.bleedDamage, durationMs: player.combat.bleedDurationMs };
}

function clusterConfig(player, damage) {
  if (player.combat.clusterCount <= 0) return null;
  return {
    count: player.combat.clusterCount,
    damage: damage * player.combat.clusterDamage,
  };
}

function isControlImmune(carrier, now) {
  const bulwark = abilities.findEffect(carrier, 'bulwark', now);
  return !!bulwark && !!bulwark.ccImmune;
}

function controlAimTarget(player, target, effect, durationMs, now) {
  const slowPercent = effect.slowPercent || 0;
  const immune = slowPercent > 0 && target.kind === 'player' && isControlImmune(target.entity, now);

  markAimTarget(target, immune ? { ...effect, slowPercent: 0 } : effect);
  if (immune || slowPercent <= 0 || target.kind !== 'player') return;

  safeSend(target.entity.ws, {
    type: 'playerControl',
    casterId: player.id,
    abilityId: effect.id,
    slowPercent,
    durationMs,
  });
}

function damageAimTarget(player, target, damage, damageClass, abilityId) {
  if (target.kind === 'enemy') {
    applyEnemyDamage(player, target.entity, damage, { abilityId, point: target.entity.position });
    return;
  }

  const scaled = progression.scalePvpDamage(damage, damageClass, target.entity.maxHealth);
  if (scaled < 1) return;

  applyPlayerDamage(target.entity, scaled, {
    attacker: player,
    attackerId: player.id,
    abilityId,
    point: target.entity.position,
  });
}

function markAimTarget(target, effect) {
  abilities.addEffect(target.entity, effect);
}

function chainLightningTargets(player, first, params, now) {
  const visited = new Set([first.entity.id]);
  const chain = [first];

  const candidates = [];
  const enemies = activeEnemiesFor(player);
  if (enemies) {
    for (const enemy of enemies.values()) {
      if (enemy.alive) candidates.push({ kind: 'enemy', entity: enemy });
    }
  }
  forEachAbilityTargetPlayer(player, (other) => candidates.push({ kind: 'player', entity: other }));

  let current = first;
  for (let jump = 0; jump < params.jumps; jump++) {
    let next = null;
    let nextDistance = Infinity;

    for (const candidate of candidates) {
      if (visited.has(candidate.entity.id)) continue;

      const distance = abilities.distance2D(current.entity.position, candidate.entity.position);
      if (distance > params.jumpRange || distance >= nextDistance) continue;

      next = candidate;
      nextDistance = distance;
    }

    if (!next) break;

    visited.add(next.entity.id);
    chain.push(next);
    current = next;
  }

  return chain;
}

function executeAbility(player, abilityId, definition, origin, direction, now) {
  const params = definition.params || {};
  const stats = player.combat.stats;
  const groundPoint = () => abilities.groundPointFromAim(origin, direction, player.position[1], abilities.MAX_GROUND_RANGE);

  switch (abilityId) {
    case 'overdrive': {
      abilities.addEffect(player, {
        id: 'overdrive',
        expiresAt: now + definition.durationMs,
        noReload: !!params.noReload,
        fireRateMult: params.fireRateMult,
      });
      return { kind: 'self' };
    }

    case 'bulwark': {
      abilities.addEffect(player, {
        id: 'bulwark',
        expiresAt: now + definition.durationMs,
        damageTakenMult: params.damageTakenMult,
        ccImmune: !!params.ccImmune,
      });
      return { kind: 'self' };
    }

    case 'ascendance': {
      abilities.addEffect(player, {
        id: 'ascendance',
        expiresAt: now + definition.durationMs,
        spellDamagePercent: params.spellDamagePercent,
      });
      return { kind: 'self' };
    }

    case 'phase_step': {
      abilities.addEffect(player, {
        id: 'phase_step',
        expiresAt: now + definition.durationMs,
      });
      return { kind: 'self' };
    }

    case 'reflect_ward': {
      abilities.addEffect(player, {
        id: 'reflect_ward',
        expiresAt: now + definition.durationMs,
        reflectPercent: params.reflectPercent,
        damageClass: params.damageClass,
      });
      return { kind: 'self' };
    }

    case 'kinetic_barrier':
    case 'mana_shield': {
      abilities.grantShield(
        player.ability,
        params.shield + player.combat.shieldStrength,
        definition.durationMs,
        params.manaPerDamage || 0,
        now
      );
      sendAbilityMeter(player);
      return { kind: 'shield' };
    }

    case 'combat_roll':
    case 'blink': {
      const landed = dashPlayer(player, direction, params.distance, now);
      if (!landed) return null;

      if (params.iframesMs) player.ability.iframesUntil = now + params.iframesMs;
      if (abilityId === 'combat_roll' && player.combat.reloadWhileDashing) {
        player.weaponAmmo = player.combat.magSize;
      }

      return { kind: 'dash', position: landed };
    }

    case 'shockwave': {
      const radius = abilityScaledRadius(player, abilityId, params.radius);
      scheduleAbilityImpact(player, abilityId, {
        x: player.position[0],
        y: player.position[1],
        z: player.position[2],
        radius,
        damage: abilityScaledDamage(player, abilityId, params.damage, now),
        damageClass: params.damageClass,
        resolveAt: now,
        knockback: params.knockback,
        stunMs: params.stunMs,
        bleed: bleedConfig(player),
      });
      return { kind: 'burst', position: player.position, radius };
    }

    case 'frag_grenade': {
      const point = groundPoint();
      const radius = abilityScaledRadius(player, abilityId, params.radius);
      const damage = abilityScaledDamage(player, abilityId, params.damage, now);

      scheduleAbilityImpact(player, abilityId, {
        x: point[0],
        y: point[1],
        z: point[2],
        radius,
        damage,
        damageClass: params.damageClass,
        resolveAt: now + params.fuseMs,
        bleed: bleedConfig(player),
        cluster: clusterConfig(player, damage),
      });
      return { kind: 'projectile', position: point, radius };
    }

    case 'meteor': {
      const point = groundPoint();
      const radius = abilityScaledRadius(player, abilityId, params.radius);

      scheduleAbilityImpact(player, abilityId, {
        x: point[0],
        y: point[1],
        z: point[2],
        radius,
        damage: abilityScaledDamage(player, abilityId, params.damage, now),
        damageClass: params.damageClass,
        resolveAt: now + params.impactDelayMs,
        groundFire: {
          durationMs: abilityScaledDuration(player, abilityId, params.groundFireMs),
          damagePerSecond: abilityScaledDamage(player, abilityId, params.groundFireTick, now)
            + abilities.zoneTickBonus(stats),
        },
      });
      return { kind: 'projectile', position: point, radius };
    }

    case 'barrage': {
      const point = groundPoint();
      const radius = abilityScaledRadius(player, abilityId, params.radius);
      const damage = abilityScaledDamage(player, abilityId, params.damage, now);
      const gap = definition.durationMs / params.salvos;

      for (let salvo = 0; salvo < params.salvos; salvo++) {
        const angle = Math.random() * Math.PI * 2;
        const spread = radius * 0.4 * Math.random();
        scheduleAbilityImpact(player, abilityId, {
          x: point[0] + Math.cos(angle) * spread,
          y: point[1],
          z: point[2] + Math.sin(angle) * spread,
          radius: radius * 0.7,
          damage,
          damageClass: params.damageClass,
          resolveAt: now + gap * salvo,
          bleed: bleedConfig(player),
        });
      }
      return { kind: 'ground', position: point, radius };
    }

    case 'suppression_field': {
      const point = groundPoint();
      const zone = spawnAbilityZone(player, abilityId, {
        ...zoneBaseConfig(player, abilityId, point, params, definition.durationMs),
        enemySlowPercent: params.slowPercent,
        enemyDamagePercent: params.enemyDamagePercent,
      });
      return { kind: 'ground', position: point, radius: zone.radius };
    }

    case 'slow_field': {
      const point = groundPoint();
      const zone = spawnAbilityZone(player, abilityId, {
        ...zoneBaseConfig(player, abilityId, point, params, definition.durationMs),
        enemySlowPercent: params.slowPercent,
      });
      return { kind: 'ground', position: point, radius: zone.radius };
    }

    case 'gravity_well': {
      const point = groundPoint();
      const zone = spawnAbilityZone(player, abilityId, {
        ...zoneBaseConfig(player, abilityId, point, params, definition.durationMs),
        pullStrength: params.pullStrength,
      });
      return { kind: 'ground', position: point, radius: zone.radius };
    }

    case 'time_dilation': {
      const point = groundPoint();
      const zone = spawnAbilityZone(player, abilityId, {
        ...zoneBaseConfig(player, abilityId, point, params, definition.durationMs),
        enemySlowPercent: params.enemySlowPercent,
        allySpeedPercent: params.allySpeedPercent,
      });
      return { kind: 'ground', position: point, radius: zone.radius };
    }

    case 'cataclysm': {
      const point = groundPoint();
      const base = zoneBaseConfig(player, abilityId, point, params, definition.durationMs);
      const zone = spawnAbilityZone(player, abilityId, {
        ...base,
        damagePerSecond: base.damagePerSecond + abilityScaledDamage(player, abilityId, params.damagePerSecond, now),
        damageClass: params.damageClass,
        enemySlowPercent: params.slowPercent,
      });
      return { kind: 'ground', position: point, radius: zone.radius };
    }

    case 'healing_rune': {
      const point = groundPoint();
      const base = zoneBaseConfig(player, abilityId, point, params, definition.durationMs);
      const zone = spawnAbilityZone(player, abilityId, {
        ...base,
        damagePerSecond: 0,
        healPerSecond: params.healPerSecond * abilities.healMultiplier(stats),
        hostile: false,
      });
      return { kind: 'ground', position: point, radius: zone.radius };
    }

    case 'marked_target': {
      const target = pickAimTarget(player, origin, direction, abilities.MAX_TARGET_RANGE);
      if (!target) return null;

      markAimTarget(target, {
        id: 'marked',
        expiresAt: now + definition.durationMs,
        damageTakenPercent: params.damageTakenPercent,
      });

      if (player.combat.markedAllyFireRate > 0) {
        forEachAbilityAlly(player, (ally) => {
          abilities.addEffect(ally, {
            id: 'marked_ally_haste',
            expiresAt: now + definition.durationMs,
            fireRatePercent: player.combat.markedAllyFireRate * 100,
          });
        });
      }

      return { kind: 'target', targetId: target.entity.id, position: target.entity.position };
    }

    case 'hex': {
      const target = pickAimTarget(player, origin, direction, abilities.MAX_TARGET_RANGE);
      if (!target) return null;

      controlAimTarget(player, target, {
        id: 'hexed',
        expiresAt: now + definition.durationMs,
        damageTakenPercent: params.damageTakenPercent,
        slowPercent: params.slowPercent,
      }, definition.durationMs, now);

      return { kind: 'target', targetId: target.entity.id, position: target.entity.position };
    }

    case 'shatter_ward': {
      const target = pickAimTarget(player, origin, direction, abilities.MAX_TARGET_RANGE);
      if (!target) return null;

      damageAimTarget(player, target, abilityScaledDamage(player, abilityId, params.damage, now), params.damageClass, abilityId);

      if (params.shieldStrip && target.kind === 'player') {
        abilities.breakShield(target.entity.ability);
        sendAbilityMeter(target.entity);
      }

      markAimTarget(target, {
        id: 'sundered',
        expiresAt: now + params.armorStripMs,
        damageTakenPercent: params.armorStripPercent,
      });

      return { kind: 'target', targetId: target.entity.id, position: target.entity.position };
    }

    case 'chain_lightning': {
      const first = pickAimTarget(player, origin, direction, abilities.MAX_TARGET_RANGE);
      if (!first) return null;

      const chain = chainLightningTargets(player, first, params, now);
      const base = abilityScaledDamage(player, abilityId, params.damage, now);

      chain.forEach((link, index) => {
        const falloff = Math.pow(1 - params.jumpFalloffPercent / 100, index);
        damageAimTarget(player, link, base * falloff, params.damageClass, abilityId);
      });

      return {
        kind: 'chain',
        targetId: first.entity.id,
        position: first.entity.position,
        chain: chain.map((link) => link.entity.position),
      };
    }

    default:
      return null;
  }
}

function memeLootMult(player, now) {
  const bag = abilities.findEffect(player, 'bag_holder', now);
  return bag ? 1 + (bag.lootPercent || 0) / 100 : 1;
}

function grantMemeMoveGrace(player, now, durationMs) {
  player.abilityMoveGraceUntil = Math.max(player.abilityMoveGraceUntil || 0, now + durationMs + 400);
  player.positionHistory = [];
}

function nearestEnemyTo(player, maxDistance) {
  const enemies = activeEnemiesFor(player);
  if (!enemies) return null;

  let best = null;
  let bestDistance = maxDistance;

  for (const enemy of enemies.values()) {
    if (!enemy.alive) continue;

    const distance = abilities.distance2D(player.position, enemy.position);
    if (distance > bestDistance) continue;

    best = enemy;
    bestDistance = distance;
  }

  return best;
}

function dropRugPullLoot(player, params) {
  if (Math.random() > (params.minorLootChance || 0)) return;

  const enemy = nearestEnemyTo(player, 18);
  if (!enemy) return;

  if (player.locationId === 'main-world') dropLoot(enemy.position, player.instance, 1, 1);
  else if (player.locationId === 'tower-first-floor') dropCanyonLoot(player, enemy.position, 1, 1);
}

function executeMeme(player, meme, now) {
  const params = meme.params || {};

  switch (meme.id) {
    case 'crab_walk': {
      abilities.addEffect(player, {
        id: 'crab_walk',
        expiresAt: now + meme.durationMs,
        speedPercent: ((params.moveSpeedMult || 1) - 1) * 100,
      });
      return { kind: 'self' };
    }

    case 'bag_holder': {
      abilities.addEffect(player, {
        id: 'bag_holder',
        expiresAt: now + meme.durationMs,
        lootPercent: ((params.lootMult || 1) - 1) * 100,
      });
      return { kind: 'self' };
    }

    case 'pump_it': {
      abilities.addEffect(player, {
        id: 'pump_it',
        expiresAt: now + meme.durationMs,
        jumpMult: params.jumpMult || 1,
      });
      return { kind: 'self' };
    }

    case 'shrimp_squeak':
    case 'moon_launch': {
      grantMemeMoveGrace(player, now, meme.durationMs);
      return { kind: 'self' };
    }

    case 'rug_pull': {
      grantMemeMoveGrace(player, now, meme.durationMs);
      dropRugPullLoot(player, params);
      return { kind: 'self' };
    }

    case 'whale_splash': {
      const enemies = activeEnemiesFor(player);
      if (enemies) {
        for (const enemy of enemies.values()) {
          if (!enemy.alive) continue;
          if (!abilities.withinRadius(enemy.position, player.position[0], player.position[2], params.radius)) continue;
          pushEnemyAway(enemy, player.position[0], player.position[2], params.knockback);
        }
      }
      return { kind: 'burst', radius: params.radius };
    }

    case 'airdrop': {
      spawnAbilityZone(player, meme.id, {
        x: player.position[0],
        y: player.position[1],
        z: player.position[2],
        radius: params.radius,
        durationMs: meme.durationMs,
        damagePerSecond: 0,
        healPerSecond: (params.allyHeal || 0) / (meme.durationMs / 1000),
        hostile: false,
      }, true);
      return { kind: 'zone', radius: params.radius };
    }

    case 'ink_dump':
    case 'copium_cloud':
      return { kind: 'zone', radius: params.radius };

    default:
      return null;
  }
}

function handleMemeCast(player, data) {
  if (typeof data.memeId !== 'string') return;
  if (dust2MemberOf(player)) {
    safeSend(player.ws, { type: 'memeResult', memeId: data.memeId, ok: false, reason: 'arsenal_only' });
    return;
  }

  const now = Date.now();
  const unlocked = progression.memeAbilityIdsForLevel(player.progression.level);
  if (!unlocked.includes(data.memeId)) {
    safeSend(player.ws, { type: 'memeResult', memeId: data.memeId, ok: false, reason: 'locked' });
    return;
  }

  const meme = progression.memeAbilityById(data.memeId);
  if (!meme) return;

  if (abilities.memeReadyAt(player.ability, meme.id, now) > now) {
    safeSend(player.ws, { type: 'memeResult', memeId: meme.id, ok: false, reason: 'cooldown' });
    return;
  }

  if (!player.alive) {
    safeSend(player.ws, { type: 'memeResult', memeId: meme.id, ok: false, reason: 'dead' });
    return;
  }

  const result = executeMeme(player, meme, now);
  if (!result) return;

  const readyAt = abilities.startMemeCooldown(player.ability, meme.id, meme.cooldownMs, now);

  safeSend(player.ws, {
    type: 'memeResult',
    memeId: meme.id,
    ok: true,
    readyAt,
    durationMs: meme.durationMs,
    cooldowns: abilities.memeCooldownPayload(player.ability, unlocked, now),
  });

  broadcastToLocation(player.locationId, {
    type: 'memeEffect',
    casterId: player.id,
    memeId: meme.id,
    kind: result.kind,
    position: player.position,
    radius: result.radius || 0,
    durationMs: meme.durationMs,
  }, player.id, player.instance);
}

function rejectAbility(player, abilityId, reason) {
  safeSend(player.ws, { type: 'abilityResult', abilityId, ok: false, reason });
}

function handleAbilityCast(player, data) {
  if (typeof data.abilityId !== 'string') return;
  if (!player.alive) return rejectAbility(player, data.abilityId, 'dead');
  if (dust2MemberOf(player)) return rejectAbility(player, data.abilityId, 'arsenal_only');

  const state = player.progression;
  if (!skills.hasAbility(state.skills, data.abilityId)) return rejectAbility(player, data.abilityId, 'not_learned');
  if (!ABILITY_SLOTS.some((slot) => state.loadout[slot] === data.abilityId)) {
    return rejectAbility(player, data.abilityId, 'not_bound');
  }

  const definition = abilities.definitionFor(data.abilityId);
  const meta = abilities.metaFor(data.abilityId);
  if (!definition || !meta) return;

  const now = Date.now();
  const stats = player.combat.stats;

  if (abilities.readyAtFor(player.ability, data.abilityId, stats, now) > now) {
    return rejectAbility(player, data.abilityId, 'cooldown');
  }

  if (meta.offensive && isInProtectedZone(player)) {
    return rejectAbility(player, data.abilityId, 'safe_zone');
  }

  const cost = abilities.energyCostFor(data.abilityId, definition, stats, player, now);
  if (player.ability.energy < cost) return rejectAbility(player, data.abilityId, 'energy');

  if (!abilities.isValidAim(data.aim)) return rejectAbility(player, data.abilityId, 'bad_aim');

  const direction = abilities.normalizeDirection(data.aim.direction);
  if (!direction) return rejectAbility(player, data.abilityId, 'bad_aim');

  const origin = data.aim.origin;
  if (abilities.distance2D(origin, player.position) > ABILITY_ORIGIN_TOLERANCE) {
    console.log(`[!] Ability hack: ${player.id} cast ${data.abilityId} from off-body origin`);
    return rejectAbility(player, data.abilityId, 'bad_aim');
  }

  if (meta.offensive) clearSpawnProtection(player);

  const result = executeAbility(player, data.abilityId, definition, origin, direction, now);
  if (!result) return rejectAbility(player, data.abilityId, 'no_target');

  player.ability.energy = Math.max(0, player.ability.energy - cost);
  player.ability.lastCastAt = now;
  const readyAt = abilities.consumeCooldown(player.ability, data.abilityId, stats, now);

  safeSend(player.ws, {
    type: 'abilityResult',
    abilityId: data.abilityId,
    ok: true,
    readyAt,
    energy: Math.floor(player.ability.energy),
    maxEnergy: player.combat.maxEnergy,
    kind: result.kind,
    position: result.position || player.position,
    radius: result.radius || 0,
    targetId: result.targetId || null,
    chain: result.chain || null,
    cooldowns: abilityCooldownPayload(player, now),
  });

  broadcast({
    type: 'abilityEffect',
    casterId: player.id,
    abilityId: data.abilityId,
    kind: result.kind,
    position: result.position || player.position,
    radius: result.radius || 0,
    targetId: result.targetId || null,
    chain: result.chain || null,
  }, player.id, true, player);
}

function buildSavePayload(player) {
  return {
    progression: {
      totalXp: player.progression.totalXp,
      level: player.progression.level,
      branch: player.progression.branch,
      skills: player.progression.skills,
      loadout: player.progression.loadout,
      fireMode: player.progression.fireMode,
      respecCount: player.progression.respecCount,
    },
    progress: {
      locationId: player.locationId,
      position: player.position,
      rotation: player.rotation,
      health: player.health,
      data: {
        ash: player.ash,
        placeables: player.placeables,
        quests: player.quests,
        metNpcs: Array.from(player.metNpcs || []),
        canyonProgress: {
          maxSegmentReached: player.canyon.maxSegmentReached,
          clearedSegments: Array.from(player.canyon.clearedSegments),
        },
        skinTextureUrl: player.skinTextureUrl || null,
        stuckUsedAt: player.stuckUsedAt || 0,
        arenaCooldownUntil: player.arenaCooldownUntil || 0,
        arenaBestWave: player.arenaBestWave || 0,
        homeTeleportUsedAt: player.homeTeleportUsedAt || 0,
        storage: player.storage || {},
        storageOrphan: player.storageOrphan || [],
      },
    },
    nickname: player.nickname,
    inventory: player.inventory.map((entry, index) => ({
      slot: index,
      itemId: entry.address,
      quantity: entry.quantity,
      data: { name: entry.name, symbol: entry.symbol, image: entry.image },
    })),
    statistics: {
      playtimeSeconds: player.stats.playtimeSeconds + Math.floor((Date.now() - player.sessionStart) / 1000),
      kills: player.stats.kills,
      deaths: player.stats.deaths,
      shotsFired: player.stats.shotsFired,
      buildingsPlaced: player.stats.buildingsPlaced,
    },
  };
}

function queuePlayerSave(player, payload) {
  player.saveQueue = player.saveQueue.then(() =>
    savePlayerProgress(player.userId, player.gameId, payload)
      .then((result) => {
        if (result?.unlockedAchievements?.length && player.ws.readyState === WebSocket.OPEN) {
          safeSend(player.ws, { type: 'achievementsUnlocked', achievements: result.unlockedAchievements });
        }
      })
      .catch((err) => console.error(`[Save] Error for ${player.id}:`, err.message))
  );
  return player.saveQueue;
}

function persistPlayer(player) {
  if (!CONFIG.internalSecret) return;
  queuePlayerSave(player, buildSavePayload(player));
}

safeInterval(() => {
  const dirty = [];
  players.forEach((player) => {
    if (player.stateDirty) dirty.push(player);
  });
  if (dirty.length === 0) return;

  const payloadCache = new Map();

  players.forEach((viewer) => {
    if (!viewer.authenticated || !viewer.wantsSnapshots) return;
    if (viewer.ws.readyState !== WebSocket.OPEN) return;
    if (viewer.aoiNeighbors.size === 0) return;

    const batch = [];
    for (const id of viewer.aoiNeighbors) {
      const other = players.get(id);
      if (!other || !other.stateDirty || !other.ready) continue;

      let payload = payloadCache.get(id);
      if (!payload) {
        payload = buildPlayerStatePayload(other);
        payloadCache.set(id, payload);
      }
      batch.push(payload);
    }

    if (batch.length === 0) return;
    safeSend(viewer.ws, { type: 'snapshot', players: batch });
  });

  for (const player of dirty) player.stateDirty = false;
}, SNAPSHOT_INTERVAL_MS);

safeInterval(() => {
  const now = Date.now();
  players.forEach((player) => {
    if (!player.authenticated) return;
    player.lastPingSentAt = now;
    safeSend(player.ws, { type: 'ping', t: now });
    if (now - player.lastPong > CONFIG.network.heartbeatTimeout) {
      console.log(`[!] Heartbeat timeout: ${player.id}`);
      player.ws.terminate();
    }
  });
}, CONFIG.network.heartbeatInterval);

safeInterval(() => {
  const now = Date.now();
  players.forEach((p) => {
    if (now - p.lastSeen > CONFIG.network.staleTimeout) {
      console.log(`[!] Stale player: ${p.id}`);
      p.ws.terminate();
    }
  });
  rateLimits.forEach((data, key) => {
    if (now > data.resetTime + 5000) rateLimits.delete(key);
  });
}, 10000);

safeInterval(() => {
  if (!CONFIG.internalSecret) return;

  players.forEach((player) => {
    if (!player.authenticated) return;
    persistPlayer(player);
  });
}, CONFIG.autoSaveInterval);

safeInterval(() => {
  factionTaskState.forEach((state, factionId) => {
    if (!state.dirty || !state.taskKey) return;
    state.dirty = false;
    callInternalApi('/api/internal/game/faction/task-progress', {
      factionId, taskKey: state.taskKey, progress: state.progress,
    }).catch((err) => console.error('[FactionTask] progress flush error:', err.message));
  });
}, 20000);

function applyPlayerStatus(p, status, now) {
  p.mutedUntil = status.mutedUntil || null;

  if (status.isBanned) {
    safeSend(p.ws, { type: 'auth_error', error: 'banned' });
    try { p.ws.close(4008, 'banned'); } catch (e) { }
    return;
  }

  if (now - (p.skinTextureUrlChangedAt || 0) >= 5000) {
    const nextUrl = status.skinTextureUrl || null;
    if (nextUrl !== p.skinTextureUrl) {
      p.skinTextureUrl = nextUrl;
      broadcast({ type: 'skinUpdate', playerId: p.id, url: p.skinTextureUrl }, null, true, p);
      safeSend(p.ws, { type: 'skinUpdate', playerId: p.id, url: p.skinTextureUrl });
    }
  }

  if (now - (p.economyChangedAt || 0) >= 5000) {
    const sameAsh = status.ash === p.ash;
    const samePlaceables = JSON.stringify(status.placeables) === JSON.stringify(p.placeables);
    if (!sameAsh || !samePlaceables) {
      p.ash = status.ash;
      p.placeables = status.placeables;
      safeSend(p.ws, { type: 'inventoryUpdate', inventory: p.inventory, ash: p.ash, placeables: p.placeables });
    }
  }

  if (now - (p.companionsChangedAt || 0) >= 5000) {
    if (status.companions && JSON.stringify(status.companions) !== JSON.stringify(p.companions)) {
      p.companions = status.companions;
      safeSend(p.ws, {
        type: 'companionState',
        owned: p.companions.owned,
        equipped: p.companions.equipped,
        fragments: p.companions.fragments,
        crates: p.companions.crates,
      });
    }
  }

  applyHomeFixtures(p, status);
}

safeInterval(async () => {
  if (!CONFIG.internalSecret) return;

  const authedPlayers = Array.from(players.values()).filter((p) => p.authenticated && p.userId);
  if (authedPlayers.length === 0) return;

  const byGameId = new Map();
  authedPlayers.forEach((p) => {
    const key = p.gameId || null;
    if (!byGameId.has(key)) byGameId.set(key, []);
    byGameId.get(key).push(p);
  });

  for (const [gameId, playersForGame] of byGameId) {
    const result = await callInternalApi('/api/internal/game/player-status', {
      userIds: playersForGame.map((p) => p.userId),
      gameId,
    }).catch((err) => {
      console.error('[PlayerStatus] refresh error:', err.message);
      return null;
    });

    if (!result?.statuses) continue;

    const now = Date.now();
    const statusByUserId = new Map(result.statuses.map((s) => [s.id, s]));

    playersForGame.forEach((p) => {
      const status = statusByUserId.get(p.userId);
      if (status) applyPlayerStatus(p, status, now);
    });
  }
}, 8000);

safeInterval(async () => {
  const anyPlayer = Array.from(players.values()).find((p) => p.authenticated && p.gameId);
  if (anyPlayer) await refreshShopPrices(anyPlayer.gameId);
}, 60000);

safeInterval(async () => {
  const anyPlayer = Array.from(players.values()).find((p) => p.authenticated && p.gameId);
  if (anyPlayer) await refreshEventConfigs(anyPlayer.gameId);
}, EVENT_CONFIG_POLL_MS);

safeInterval(async () => {
  if (!CONFIG.internalSecret) return;

  const authedPlayers = Array.from(players.values()).filter((p) => p.authenticated && p.userId && p.gameId);
  if (authedPlayers.length === 0) return;

  const byGameId = new Map();
  authedPlayers.forEach((p) => {
    if (!byGameId.has(p.gameId)) byGameId.set(p.gameId, []);
    byGameId.get(p.gameId).push(p);
  });

  for (const [gameId, playersForGame] of byGameId) {
    const result = await callInternalApi('/api/internal/game/license-status', {
      gameId, userIds: playersForGame.map((p) => p.userId),
    }).catch((err) => {
      console.error('[License] status refresh error:', err.message);
      return null;
    });

    if (!result?.revoked?.length) continue;

    const revokedSet = new Set(result.revoked);
    playersForGame.forEach((p) => {
      if (!revokedSet.has(p.userId)) return;
      safeSend(p.ws, { type: 'auth_error', error: 'license_revoked' });
      try { p.ws.close(4010, 'license_revoked'); } catch (e) { }
    });
  }
}, 8000);

wss.on('connection', (ws) => {
  if (players.size >= MAX_CONNECTIONS) {
    ws.close(1013, 'Server full');
    return;
  }

  const playerId = generateId();

  const player = {
    id: playerId,
    userId: null,
    wallet: null,
    gameId: null,
    gameSlug: null,
    nickname: null,
    position: [0, 0, 0],
    rotation: 0,
    pitch: 0,
    headYaw: 0,
    animation: 'idle',
    state: 'idle',
    jumping: false,
    velocityY: 0,
    lastJump: 0,
    locationId: 'tower-main-hall',
    instance: 1,
    ws,
    authenticated: false,
    lastSeen: Date.now(),
    lastPong: Date.now(),
    lastPingSentAt: 0,
    rtt: 50,
    rttSamples: [],
    lastUpdate: 0,
    moveViolations: 0,
    moveViolationLoggedAt: 0,
    justSpawned: false,
    justTeleported: false,
    teleportSettleUntil: 0,
    abilityMoveGraceUntil: 0,
    lastLocationChangeAt: 0,
    pendingLocationChange: null,
    invulnerableUntil: 0,
    caveKnownCrates: new Set(),
    ready: false,
    readyTimer: null,
    wantsSnapshots: false,
    stateDirty: false,
    zoneKey: null,
    aoiNeighbors: new Set(),
    weaponAmmo: WEAPON_CONFIG.maxAmmo,
    lastShotAt: 0,
    ammoEmptyAt: 0,
    sessionStart: Date.now(),
    health: 100,
    maxHealth: 100,
    alive: true,
    lastDamageTime: 0,
    combatUntil: 0,
    combatStateSentAt: 0,
    stuckUsedAt: 0,
    positionHistory: [],
    recentShots: [],
    weaponEquipped: true,
    isShooting: false,
    mutedUntil: null,
    isAdmin: false,
    isFactionCreator: false,
    skinTextureUrl: null,
    skinTextureUrlChangedAt: 0,
    blockedUserIds: new Set(),
    inventory: [],
    storage: {},
    storageOrphan: [],
    storages: new Map(),
    homeSpawn: null,
    homeTeleportUsedAt: 0,
    homeTeleportCastUntil: 0,
    arenaCooldownUntil: 0,
    arenaBestWave: 0,
    arenaReviveUntil: 0,
    arenaReviveTargetId: null,
    ash: 0,
    progression: createProgressionState(),
    combat: null,
    ability: null,
    effects: [],
    economyChangedAt: 0,
    placeables: {},
    roomCanEdit: false,
    activeTradeId: null,
    quests: {},
    metNpcs: new Set(),
    factions: [],
    cosmeticsOwned: new Set(),
    companions: { owned: [], equipped: null, fragments: 0, crates: 0 },
    cosmeticCrates: { fragments: 0, crates: 0 },
    companionsChangedAt: 0,
    cosmeticSkinId: null,
    cosmeticAccessoryId: null,
    displayedFactionId: null,
    displayedFactionName: null,
    displayedFactionSymbol: null,
    displayedFactionImage: null,
    influenceFactionId: null,
    influenceFactionName: null,
    influenceEntryToken: 0,
    influenceLootTaken: 0,
    influenceEnteredAt: 0,
    influencePaidAt: 0,
    canyon: {
      inHub: true,
      segment: 1,
      maxSegmentReached: 1,
      clearedSegments: new Set(),
      enemies: new Map(),
      nextEnemySeq: 0,
      pendingSegment: null,
      runCleared: false,
      bossId: null,
    },
    stats: {
      kills: 0,
      deaths: 0,
      shotsFired: 0,
      buildingsPlaced: 0,
      playtimeSeconds: 0,
    },
    saveQueue: Promise.resolve(),
    authTimeout: setTimeout(() => {
      if (!player.authenticated) {
        console.log(`[!] Auth timeout: ${playerId}`);
        safeSend(ws, { type: 'auth_error', error: 'auth_timeout' });
        ws.close(4001, 'Authentication timeout');
      }
    }, 10000),
    authAttempts: 0,
    authInFlight: false,
  };

  refreshCombatStats(player);
  players.set(playerId, player);

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      player.lastSeen = Date.now();

      if (!player.authenticated) {
        if (data.type === 'auth') {
          if (player.authInFlight) return;
          player.authAttempts++;
          if (player.authAttempts > 5) {
            safeSend(ws, { type: 'auth_error', error: 'too_many_attempts' });
            ws.close(4008, 'too_many_auth_attempts');
            return;
          }
          player.authInFlight = true;
          handleAuth(player, data).catch((err) => {
            console.error(`[!] handleAuth error for ${playerId}:`, err.message);
            if (!player.authenticated) discardPendingAuth(player);
            try { ws.close(4000, 'auth_error'); } catch (e) { }
          }).finally(() => {
            player.authInFlight = false;
          });
          return;
        } else {
          safeSend(ws, { type: 'auth_error', error: 'auth_required' });
          ws.close(4001, 'Authentication required');
          return;
        }
      }

      if (data.type === 'pong') {
        const now = Date.now();
        player.lastPong = now;
        if (typeof data.t === 'number' && data.t === player.lastPingSentAt) {
          const sample = Math.max(0, Math.min(RTT_SAMPLE_CEILING_MS, now - data.t));
          if (!Array.isArray(player.rttSamples)) player.rttSamples = [];
          player.rttSamples.push(sample);
          if (player.rttSamples.length > RTT_SAMPLE_WINDOW) player.rttSamples.shift();
          player.rtt = Math.min(...player.rttSamples);
        }
        return;
      }

      if (data.type === 'playerUpdate') {
        if (!checkRateLimit(playerId, 'update', CONFIG.network.updateRateLimit)) return;
      } else if (data.type === 'chat') {
        if (!checkRateLimit(playerId, 'chat', CONFIG.network.chatRateLimit)) {
          safeSend(ws, { type: 'error', message: 'Chat rate limit exceeded', messageKey: 'g.err.rateChat' });
          return;
        }
      } else if (data.type === 'shoot') {
        if (!checkRateLimit(playerId, 'shoot', CONFIG.network.shootRateLimit)) {
          safeSend(ws, { type: 'error', message: 'Shoot rate limit exceeded', messageKey: 'g.err.rateShoot' });
          return;
        }
      } else if (data.type === 'hit' || data.type === 'enemyHit' || data.type === 'lootPickup') {
        if (!checkRateLimit(playerId, 'hit', CONFIG.network.hitRateLimit)) {
          safeSend(ws, { type: 'error', message: 'Hit rate limit exceeded', messageKey: 'g.err.rateHit' });
          return;
        }
      } else if (data.type === 'sellToken') {
        if (!checkRateLimit(playerId, 'sell', CONFIG.network.sellRateLimit)) {
          safeSend(ws, { type: 'error', message: 'Sell rate limit exceeded', messageKey: 'g.err.rateSell' });
          return;
        }
      } else if (data.type === 'shopBuyItem' || data.type === 'signPlace' || data.type === 'signRemove' || data.type === 'signSetText' || data.type === 'signSetDrawingUrl') {
        if (!checkRateLimit(playerId, 'build', CONFIG.network.buildRateLimit)) {
          safeSend(ws, { type: 'error', message: 'Build rate limit exceeded', messageKey: 'g.err.rateBuild' });
          return;
        }
      } else if (data.type === 'roomBuildOp') {
        if (!checkRateLimit(playerId, 'roomBuild', CONFIG.network.roomBuildRateLimit)) return;
      } else if (data.type === 'voiceOffer' || data.type === 'voiceAnswer' || data.type === 'voiceIceCandidate') {
        if (!checkRateLimit(playerId, 'voice', CONFIG.network.voiceRateLimit)) return;
      } else if (data.type === 'locationChange') {
        if (!checkRateLimit(playerId, 'locationChange', CONFIG.network.locationChangeRateLimit)) return;
      } else if (data.type === 'nicknameChange') {
        if (!checkRateLimit(playerId, 'nicknameChange', CONFIG.network.nicknameChangeRateLimit)) return;
      } else if (data.type === 'skinUpdate') {
        if (!checkRateLimit(playerId, 'skinUpdate', CONFIG.network.skinUpdateRateLimit)) return;
      } else if (data.type === 'saveProgress') {
        if (!checkRateLimit(playerId, 'saveProgress', CONFIG.network.saveProgressRateLimit)) return;
      } else if (data.type === 'cosmeticListRequest' || data.type === 'cosmeticBuy' || data.type === 'cosmeticEquip') {
        if (!checkRateLimit(playerId, 'cosmetic', CONFIG.network.cosmeticRateLimit)) return;
      } else if (data.type === 'companionListRequest' || data.type === 'companionEquip' || data.type === 'companionDust' || data.type === 'companionCombine' || data.type === 'crateOpen' || data.type === 'cosmeticCrateRequest' || data.type === 'cosmeticCombine' || data.type === 'cosmeticCrateOpen') {
        if (!checkRateLimit(playerId, 'companion', CONFIG.network.companionRateLimit)) return;
      } else if (data.type === 'emote') {
        if (!checkRateLimit(playerId, 'emote', CONFIG.network.emoteRateLimit)) return;
      } else if (data.type === 'questInteract' || data.type === 'questAccept' || data.type === 'questTurnIn' || data.type === 'npcVisit' || data.type === 'npcMet') {
        if (!checkRateLimit(playerId, 'quest', CONFIG.network.questRateLimit)) return;
      } else if (data.type === 'branchSelect' || data.type === 'skillRespec' || data.type === 'skillLearn' || data.type === 'abilityBind' || data.type === 'fireModeSet') {
        if (!checkRateLimit(playerId, 'progression', CONFIG.network.progressionRateLimit)) return;
      } else if (data.type === 'abilityCast') {
        if (!checkRateLimit(playerId, 'ability', CONFIG.network.abilityRateLimit)) return;
      } else if (data.type === 'memeCast') {
        if (!checkRateLimit(playerId, 'meme', CONFIG.network.memeRateLimit)) return;
      } else if (data.type === 'canyonWarp' || data.type === 'canyonMapRequest' || data.type === 'canyonEnterDungeon' || data.type === 'canyonReturnToHub' || data.type === 'canyonCrossThreshold') {
        if (!checkRateLimit(playerId, 'canyon', CONFIG.network.canyonRateLimit)) return;
      } else if (data.type === 'factionCreate' || data.type === 'factionJoin' || data.type === 'factionLeave' || data.type === 'factionList' || data.type === 'factionInfo' || data.type === 'factionTaskListRequest' || data.type === 'factionAcceptTask' || data.type === 'factionClaimCreator' || data.type === 'factionSetDisplayed' || data.type === 'factionMyListRequest') {
        if (!checkRateLimit(playerId, 'faction', CONFIG.network.factionRateLimit)) return;
      } else if (data.type === 'factionQuestCreate') {
        if (!checkRateLimit(playerId, 'factionQuestCreate', CONFIG.network.factionQuestCreateRateLimit)) return;
      } else if (data.type === 'factionQuestListRequest' || data.type === 'factionQuestManageListRequest' || data.type === 'factionQuestClaim') {
        if (!checkRateLimit(playerId, 'factionQuest', CONFIG.network.factionQuestRateLimit)) return;
      } else if (data.type === 'tournamentListRequest' || data.type === 'tournamentEntriesRequest' || data.type === 'tournamentAction') {
        if (!checkRateLimit(playerId, 'tournament', CONFIG.network.tournamentRateLimit)) return;
      } else if (data.type === 'factionSearch') {
        if (!checkRateLimit(playerId, 'factionSearch', CONFIG.network.factionSearchRateLimit)) return;
      } else if (data.type === 'playerProfileRequest' || data.type === 'leaderboardRequest' || data.type === 'factionLeaderboardRequest') {
        if (!checkRateLimit(playerId, 'profile', CONFIG.network.profileRateLimit)) return;
      } else if (data.type === 'friendRequestSend' || data.type === 'friendRequestAccept' || data.type === 'friendRequestDecline' || data.type === 'friendRemove' || data.type === 'friendsListRequest') {
        if (!checkRateLimit(playerId, 'friend', CONFIG.network.friendRateLimit)) return;
      } else if (data.type === 'friendSearch') {
        if (!checkRateLimit(playerId, 'friendSearch', CONFIG.network.friendSearchRateLimit)) return;
      } else if (data.type === 'mailSend') {
        if (!checkRateLimit(playerId, 'mailSend', CONFIG.network.mailSendRateLimit)) {
          safeSend(ws, { type: 'error', message: 'Mail rate limit exceeded', messageKey: 'g.err.rateMail' });
          return;
        }
      } else if (data.type === 'mailInboxRequest' || data.type === 'mailMarkRead') {
        if (!checkRateLimit(playerId, 'mailRead', CONFIG.network.mailReadRateLimit)) return;
      } else if (data.type === 'respawnRequest') {
        if (!checkRateLimit(playerId, 'respawn', CONFIG.network.respawnRateLimit)) return;
      } else if (data.type === 'crateLoot') {
        if (!checkRateLimit(playerId, 'crate', CONFIG.network.crateRateLimit)) return;
      } else if (data.type === 'partyInvite' || data.type === 'partyAccept' || data.type === 'partyDecline' || data.type === 'partyLeave' || data.type === 'partyKick') {
        if (!checkRateLimit(playerId, 'party', CONFIG.network.partyRateLimit)) return;
      } else if (data.type === 'defusalQueue' || data.type === 'defusalLeaveQueue' || data.type === 'defusalPlant' || data.type === 'defusalDefuse' || data.type === 'defusalCancel' || data.type === 'defusalBuy' || data.type === 'defusalSwitch' || data.type === 'defusalThrow' || data.type === 'defusalMelee') {
        if (!checkRateLimit(playerId, 'arena', CONFIG.network.arenaRateLimit)) return;
      } else if (data.type === 'arenaStart' || data.type === 'arenaJoin' || data.type === 'arenaLeave' || data.type === 'arenaRevive') {
        if (!checkRateLimit(playerId, 'arena', CONFIG.network.arenaRateLimit)) return;
      } else if (data.type === 'stuckTeleport' || data.type === 'homeTeleport') {
        if (!checkRateLimit(playerId, 'stuck', CONFIG.network.stuckRateLimit)) return;
      } else if (data.type === 'storageOpen' || data.type === 'storageDeposit' || data.type === 'storageWithdraw') {
        if (!checkRateLimit(playerId, 'storage', CONFIG.network.storageRateLimit)) return;
      } else if (data.type === 'tokenInfoRequest') {
        if (!checkRateLimit(playerId, 'tokenLookup', CONFIG.network.tokenLookupRateLimit)) {
          safeSend(ws, { type: 'error', message: 'Token lookup rate limit exceeded', messageKey: 'g.err.rateTokenLookup' });
          return;
        }
      } else if (data.type === 'supportTicketSend') {
        if (!checkRateLimit(playerId, 'support', CONFIG.network.supportRateLimit)) {
          safeSend(ws, { type: 'error', message: 'Please wait before sending another support message', messageKey: 'g.err.rateSupport' });
          return;
        }
      } else if (data.type === 'blockUser' || data.type === 'unblockUser' || data.type === 'blockedListRequest') {
        if (!checkRateLimit(playerId, 'block', CONFIG.network.blockRateLimit)) return;
      } else if (data.type === 'privateMessage') {
        if (!checkRateLimit(playerId, 'privateMessage', CONFIG.network.privateMessageRateLimit)) {
          safeSend(ws, { type: 'error', message: 'Private message rate limit exceeded', messageKey: 'g.err.ratePrivateMessage' });
          return;
        }
      } else if (data.type === 'factionChat') {
        if (!checkRateLimit(playerId, 'factionChat', CONFIG.network.factionChatRateLimit)) {
          safeSend(ws, { type: 'error', message: 'Chat rate limit exceeded', messageKey: 'g.err.rateChat' });
          return;
        }
      } else if (data.type === 'factionInvite') {
        if (!checkRateLimit(playerId, 'factionInvite', CONFIG.network.factionInviteRateLimit)) return;
      } else if (data.type === 'tradeInvite' || data.type === 'tradeInviteRespond' || data.type === 'tradeSetOffer' || data.type === 'tradeSetReady' || data.type === 'tradeSubmitPayment' || data.type === 'tradeCancel') {
        if (!checkRateLimit(playerId, 'trade', CONFIG.network.tradeRateLimit)) {
          safeSend(ws, { type: 'error', message: 'Trade action rate limit exceeded', messageKey: 'g.err.rateTrade' });
          return;
        }
      }

      switch (data.type) {
        case 'playerUpdate': handlePlayerUpdate(player, data); break;
        case 'shoot': handleShoot(player, data); break;
        case 'nicknameChange': handleNicknameChange(player, data); break;
        case 'skinUpdate': handleSkinUpdate(player, data); break;
        case 'chat': handleChat(player, data); break;
        case 'hit': handleHit(player, data); break;
        case 'enemyHit': handleEnemyHit(player, data); break;
        case 'lootPickup': handleLootPickup(player, data); break;
        case 'crateLoot': handleCrateLoot(player, data); break;
        case 'partyInvite': handlePartyInvite(player, data); break;
        case 'partyAccept': handlePartyAccept(player, data); break;
        case 'partyDecline': handlePartyDecline(player, data); break;
        case 'partyLeave': handlePartyLeave(player); break;
        case 'partyKick': handlePartyKick(player, data); break;
        case 'influenceGateQuery': sendInfluenceGate(player); break;
        case 'influenceEnter': handleInfluenceEnter(player, data); break;
        case 'influenceLeave': handleInfluenceLeave(player); break;
        case 'influenceCrystalQuery': influenceCrystalPrompt(player); break;
        case 'influenceCaptureStart': startInfluenceCapture(player); break;
        case 'influenceCaptureStop': cancelInfluenceCapture(player); break;
        case 'influenceFee': setInfluenceFee(player, data); break;
        case 'influenceLoot': openInfluenceContainer(player, data.containerId); break;
        case 'arenaStart': handleArenaStart(player); break;
        case 'arenaJoin': handleArenaJoin(player); break;
        case 'arenaLeave': handleArenaLeave(player); break;
        case 'arenaRevive': handleArenaRevive(player, data); break;
        case 'defusalQueue': handleDefusalQueue(player); break;
        case 'defusalLeaveQueue': handleDefusalLeaveQueue(player); break;
        case 'defusalPlant': handleDefusalPlant(player); break;
        case 'defusalDefuse': handleDefusalDefuse(player); break;
        case 'defusalCancel': handleDefusalCancel(player); break;
        case 'defusalBuy': handleDefusalBuy(player, data); break;
        case 'defusalSwitch': handleDefusalSwitch(player, data); break;
        case 'defusalThrow': handleDefusalThrow(player, data); break;
        case 'defusalMelee': handleDefusalMelee(player); break;
        case 'sellToken': handleSellToken(player, data); break;
        case 'shopBuyItem': handleShopBuyItem(player, data); break;
        case 'signPlace': handleSignPlace(player, data); break;
        case 'signRemove': handleSignRemove(player, data); break;
        case 'signSetText': handleSignSetText(player, data); break;
        case 'signSetDrawingUrl': handleSignSetDrawingUrl(player, data); break;
        case 'roomBuildOp': handleRoomBuildOp(player, data); break;
        case 'voiceOffer': handleVoiceOffer(player, data); break;
        case 'voiceAnswer': handleVoiceAnswer(player, data); break;
        case 'voiceIceCandidate': handleVoiceIceCandidate(player, data); break;
        case 'saveProgress': handleSaveProgress(player); break;
        case 'locationChange': handleLocationChange(player, data); break;
        case 'clientReady':
          if (data.snapshots === true) player.wantsSnapshots = true;
          markPlayerReady(player);
          break;
        case 'emote': handleEmote(player, data); break;
        case 'cosmeticListRequest': handleCosmeticListRequest(player); break;
        case 'cosmeticBuy': handleCosmeticBuy(player, data); break;
        case 'cosmeticEquip': handleCosmeticEquip(player, data); break;
        case 'companionListRequest': handleCompanionListRequest(player); break;
        case 'companionEquip': handleCompanionEquip(player, data); break;
        case 'companionDust': handleCompanionDust(player, data); break;
        case 'companionCombine': handleCompanionCombine(player); break;
        case 'crateOpen': handleCrateOpen(player); break;
        case 'cosmeticCrateRequest': handleCosmeticCrateRequest(player); break;
        case 'cosmeticCombine': handleCosmeticCombine(player); break;
        case 'cosmeticCrateOpen': handleCosmeticCrateOpen(player); break;
        case 'questInteract': handleQuestInteract(player, data); break;
        case 'questAccept': handleQuestAccept(player, data); break;
        case 'questTurnIn': handleQuestTurnIn(player, data); break;
        case 'npcVisit': handleNpcVisit(player, data); break;
        case 'npcMet': handleNpcMet(player, data); break;
        case 'branchSelect': handleBranchSelect(player, data); break;
        case 'skillRespec': handleSkillRespec(player); break;
        case 'skillLearn': handleSkillLearn(player, data); break;
        case 'abilityBind': handleAbilityBind(player, data); break;
        case 'reload': handleReload(player); break;
        case 'abilityCast': handleAbilityCast(player, data); break;
        case 'fireModeSet': handleFireModeSet(player, data); break;
        case 'memeCast': handleMemeCast(player, data); break;
        case 'caveChestOpen': handleCaveChestOpen(player, data); break;
        case 'canyonWarp': handleCanyonWarp(player, data); break;
        case 'canyonMapRequest': handleCanyonMapRequest(player); break;
        case 'canyonEnterDungeon': handleCanyonEnterDungeon(player); break;
        case 'canyonReturnToHub': handleCanyonReturnToHub(player); break;
        case 'canyonCrossThreshold': handleCanyonCrossThreshold(player); break;
        case 'factionCreate': handleFactionCreate(player, data); break;
        case 'factionJoin': handleFactionJoin(player, data); break;
        case 'factionLeave': handleFactionLeave(player, data); break;
        case 'factionSetDisplayed': handleFactionSetDisplayed(player, data); break;
        case 'factionMyListRequest': handleFactionMyListRequest(player); break;
        case 'factionSearch': handleFactionSearch(player, data); break;
        case 'factionList': handleFactionList(player, data); break;
        case 'factionInfo': handleFactionInfo(player, data); break;
        case 'factionTaskListRequest': handleFactionTaskListRequest(player); break;
        case 'factionAcceptTask': handleFactionAcceptTask(player, data); break;
        case 'factionClaimCreator': handleFactionClaimCreator(player, data); break;
        case 'factionQuestCreate': handleFactionQuestCreate(player, data); break;
        case 'factionQuestListRequest': handleFactionQuestListRequest(player); break;
        case 'factionQuestManageListRequest': handleFactionQuestManageListRequest(player, data); break;
        case 'factionQuestClaim': handleFactionQuestClaim(player, data); break;
        case 'tournamentListRequest': handleTournamentListRequest(player); break;
        case 'tournamentEntriesRequest': handleTournamentEntriesRequest(player, data); break;
        case 'tournamentAction': handleTournamentAction(player, data); break;
        case 'playerProfileRequest': handlePlayerProfileRequest(player, data); break;
        case 'leaderboardRequest': handleLeaderboardRequest(player, data); break;
        case 'factionLeaderboardRequest': handleFactionLeaderboardRequest(player, data); break;
        case 'friendRequestSend': handleFriendRequestSend(player, data); break;
        case 'friendRequestAccept': handleFriendRequestAccept(player, data); break;
        case 'friendRequestDecline': handleFriendRequestDecline(player, data); break;
        case 'friendRemove': handleFriendRemove(player, data); break;
        case 'friendsListRequest': handleFriendsListRequest(player); break;
        case 'friendSearch': handleFriendSearch(player, data); break;
        case 'mailSend': handleMailSend(player, data); break;
        case 'mailInboxRequest': handleMailInboxRequest(player); break;
        case 'mailMarkRead': handleMailMarkRead(player, data); break;
        case 'respawnRequest': handleRespawnRequest(player, data); break;
        case 'stuckTeleport': handleStuckTeleport(player); break;
        case 'homeTeleport': handleHomeTeleport(player); break;
        case 'storageOpen': handleStorageOpen(player, data); break;
        case 'storageDeposit': handleStorageDeposit(player, data); break;
        case 'storageWithdraw': handleStorageWithdraw(player, data); break;
        case 'tokenInfoRequest': handleTokenInfoRequest(player, data); break;
        case 'supportTicketSend': handleSupportTicketSend(player, data); break;
        case 'blockUser': handleBlockUser(player, data); break;
        case 'unblockUser': handleUnblockUser(player, data); break;
        case 'blockedListRequest': handleBlockedListRequest(player); break;
        case 'privateMessage': handlePrivateMessage(player, data); break;
        case 'factionChat': handleFactionChat(player, data); break;
        case 'factionInvite': handleFactionInvite(player, data); break;
        case 'tradeInvite': handleTradeInvite(player, data); break;
        case 'tradeInviteRespond': handleTradeInviteRespond(player, data); break;
        case 'tradeSetOffer': handleTradeSetOffer(player, data); break;
        case 'tradeSetReady': handleTradeSetReady(player, data); break;
        case 'tradeSubmitPayment': handleTradeSubmitPayment(player, data); break;
        case 'tradeCancel': handleTradeCancel(player, data); break;
      }
    } catch (error) {
      console.error('[!] Message parse error:', error.message);
    }
  });

  ws.on('close', () => {
    clearTimeout(player.authTimeout);
    if (player.pendingLocationChange) {
      clearTimeout(player.pendingLocationChange);
      player.pendingLocationChange = null;
    }

    if (player.readyTimer) {
      clearTimeout(player.readyTimer);
      player.readyTimer = null;
    }

    removePlayerZone(player);
    clearPlayerAbilityWorld(player.id);
    applyPartyDeparture(party.forgetPlayer(player.id), 'disbanded');

    if (player.locationId === INFLUENCE_LOCATION_ID) {
      if (influenceRun?.capture?.playerId === player.id) {
        influenceRun.capture = null;
        broadcastCaptureState(null);
      }
      player.influenceFactionId = null;
      setTimeout(broadcastInfluenceState, 0);
    }

    const leavingRun = arena.runForPlayer(player.id);
    if (leavingRun) {
      arena.dropMember(leavingRun, player.id);
      player.arenaCooldownUntil = Date.now() + arena.ARENA_CONFIG.cooldownMs;
      broadcastArenaState(leavingRun);
    }

    defusal.forgetQueued(player.id);
    const leavingMatch = defusal.matchOf(player.id);
    if (leavingMatch) {
      defusal.dropMember(leavingMatch, player.id);
      broadcastDefusalState(leavingMatch);
    }
    broadcastQueueState();

    const leavingGrinder = grinder.leave(player.id);
    if (leavingGrinder) {
      if (leavingGrinder.members.size === 0) grinder.closeMatch(leavingGrinder);
      else broadcastGrinderState(leavingGrinder);
    }

    if (player.locationId === CAVE_LOCATION_ID) {
      leaveCave(player, player.instance);
    }

    if (player.activeTradeId) {
      const tradeSession = activeTrades.get(player.activeTradeId);
      if (tradeSession && tradeSession.phase !== 'settling') {
        endTrade(tradeSession, 'cancelled');
      }
    }

    if (player.authenticated) {
      if (isCombatLogout(player)) dropRunLoot(player);
      persistPlayer(player);
      callInternalApi('/api/internal/game/presence', { userId: player.userId, online: false }).catch((err) => {
        console.error('[Presence] offline update error:', err.message);
      });
    }

    if (player.userId && userIdToPlayer.get(player.userId) === player) {
      userIdToPlayer.delete(player.userId);
    }
    if (player.wallet && walletToPlayer.get(player.wallet) === player) {
      walletToPlayer.delete(player.wallet);
    }

    players.delete(playerId);
    console.log(`[-] Player left: ${playerId} (${player.userId || 'unauth'}). Total: ${players.size}`);

    if (player.authenticated) {
      notifyAOILeave(player);
      broadcastCount();
      if (isShardedLocation(player.locationId)) {
        broadcastShardState(player.locationId);
      }
    }
  });

  ws.on('error', (err) => {
    console.error(`[!] WS error for ${playerId}:`, err.message);
  });

  async function handleAuth(player, data) {
    const aborted = () => ws.readyState !== WebSocket.OPEN;

    const token = data.token;
    if (!token || typeof token !== 'string') {
      safeSend(ws, { type: 'auth_error', error: 'invalid_token' });
      ws.close(4001, 'Invalid token');
      return;
    }

    const verifyResult = await verifyGameToken(token);
    if (aborted()) return;

    if (!verifyResult || !verifyResult.valid) {
      const error = verifyResult?.error || 'invalid_token';
      console.log(`[!] Auth failed for ${playerId}: ${error}`);
      safeSend(ws, { type: 'auth_error', error });
      ws.close(4003, error);
      return;
    }

    const existingOwner = userIdToPlayer.get(verifyResult.userId);
    if (existingOwner && existingOwner !== player) {
      console.log(`[~] Duplicate session for user ${verifyResult.userId}, closing old connection ${existingOwner.id}`);
      if (existingOwner.authenticated) {
        persistPlayer(existingOwner);
        callInternalApi('/api/internal/game/presence', { userId: existingOwner.userId, online: false }).catch((err) => {
          console.error('[Presence] offline update error:', err.message);
        });
      }
      existingOwner.authenticated = false;
      safeSend(existingOwner.ws, { type: 'auth_error', error: 'duplicate_session' });
      try { existingOwner.ws.close(4009, 'duplicate_session'); } catch (e) { }
      if (players.get(existingOwner.id) === existingOwner) {
        players.delete(existingOwner.id);
        notifyAOILeave(existingOwner);
      }
      if (existingOwner.wallet && walletToPlayer.get(existingOwner.wallet) === existingOwner) {
        walletToPlayer.delete(existingOwner.wallet);
      }
    }
    userIdToPlayer.set(verifyResult.userId, player);
    walletToPlayer.set(verifyResult.wallet, player);

    player.userId = verifyResult.userId;
    player.wallet = verifyResult.wallet;
    player.gameId = verifyResult.gameId;
    player.gameSlug = verifyResult.gameSlug;
    player.mutedUntil = verifyResult.mutedUntil || null;
    player.isAdmin = !!verifyResult.isAdmin;

    callInternalApi('/api/internal/game/presence', { userId: player.userId, online: true }).catch((err) => {
      console.error('[Presence] online update error:', err.message);
    });

    clearTimeout(player.authTimeout);

    const savedProgress = await loadPlayerProgress(player.userId, player.gameId);
    if (aborted()) return discardPendingAuth(player);

    if (savedProgress) {
      if (savedProgress.nickname) {
        player.nickname = savedProgress.nickname;
      } else {
        player.nickname = await assignUniqueNickname(player, `Player_${player.wallet.slice(0, 4)}`);
      }

      if (savedProgress.progress) {
        player.rotation = savedProgress.progress.rotation || 0;
        player.health = savedProgress.progress.health || 100;
      }

      player.locationId = DEFAULT_SPAWN_LOCATION_ID;
      spawnInSafeZone(player, player.locationId);

      if (savedProgress.statistics) {
        player.stats.kills = savedProgress.statistics.kills || 0;
        player.stats.deaths = savedProgress.statistics.deaths || 0;
        player.stats.shotsFired = savedProgress.statistics.shotsFired || 0;
        player.stats.buildingsPlaced = savedProgress.statistics.buildingsPlaced || 0;
        player.stats.playtimeSeconds = savedProgress.statistics.playtimeSeconds || 0;
      }

      const savedProgression = savedProgress.progression;
      if (savedProgression && typeof savedProgression === 'object') {
        const state = player.progression;
        state.totalXp = Math.max(0, Math.floor(Number(savedProgression.totalXp) || 0));
        state.level = progression.levelFromTotalXp(state.totalXp).level;
        state.branch = progression.isBranchId(savedProgression.branch) ? savedProgression.branch : null;
        state.respecCount = Math.max(0, Math.floor(Number(savedProgression.respecCount) || 0));

        const validated = skills.validateBuild(
          savedProgression.skills,
          state.level,
          state.branch,
          progression.skillPointsForLevel(state.level)
        );
        state.skills = validated.ranks;

        state.fireMode = skills.hasMode(state.skills, savedProgression.fireMode)
          ? savedProgression.fireMode
          : 'single';

        refreshCombatStats(player);

        if (savedProgression.loadout && typeof savedProgression.loadout === 'object') {
          for (const [rawSlot, abilityId] of Object.entries(savedProgression.loadout)) {
            if (typeof abilityId !== 'string') continue;
            const slot = LEGACY_ABILITY_SLOTS[rawSlot] || rawSlot;
            if (!ABILITY_SLOTS.includes(slot)) continue;
            if (!skills.hasAbility(state.skills, abilityId)) continue;
            state.loadout[slot] = abilityId;
          }
        }
      }

      player.ash = Math.max(0, Math.floor(Number(savedProgress.progress?.data?.ash) || 0));

      const savedPlaceables = savedProgress.progress?.data?.placeables;
      if (savedPlaceables && typeof savedPlaceables === 'object') {
        for (const itemId of Object.keys(SHOP_ITEMS)) {
          const qty = Math.max(0, Math.floor(Number(savedPlaceables[itemId]) || 0));
          if (qty > 0) player.placeables[itemId] = qty;
        }
      }

      player.skinTextureUrl = typeof savedProgress.progress?.data?.skinTextureUrl === 'string'
        ? savedProgress.progress.data.skinTextureUrl.slice(0, 500)
        : null;

      const savedQuests = savedProgress.progress?.data?.quests;
      if (savedQuests && typeof savedQuests === 'object') {
        for (const questId of Object.keys(QUESTS)) {
          const state = savedQuests[questId];
          if (!state || typeof state !== 'object') continue;
          const validStatuses = new Set(['active', 'ready_to_turn_in', 'completed']);
          if (!validStatuses.has(state.status)) continue;
          const quest = QUESTS[questId];
          const visited = quest.type === 'visit_npcs' && Array.isArray(state.visited)
            ? state.visited.filter((id) => quest.targets.some((t) => t.id === id))
            : [];

          player.quests[questId] = {
            status: state.status,
            progress: quest.type === 'visit_npcs'
              ? visited.length
              : Math.max(0, Math.min(quest.targetCount, Math.floor(Number(state.progress) || 0))),
            visited,
          };
        }
      }

      const savedMetNpcs = savedProgress.progress?.data?.metNpcs;
      if (Array.isArray(savedMetNpcs)) {
        for (const npcId of savedMetNpcs) {
          if (MET_NPC_IDS.has(npcId)) player.metNpcs.add(npcId);
        }
      }


      const savedStuckUsedAt = Math.floor(Number(savedProgress.progress?.data?.stuckUsedAt));
      if (Number.isFinite(savedStuckUsedAt) && savedStuckUsedAt > 0) {
        player.stuckUsedAt = savedStuckUsedAt;
      }

      const savedHomeUsedAt = Math.floor(Number(savedProgress.progress?.data?.homeTeleportUsedAt));
      if (Number.isFinite(savedHomeUsedAt) && savedHomeUsedAt > 0) {
        player.homeTeleportUsedAt = savedHomeUsedAt;
      }

      const savedStorage = savedProgress.progress?.data?.storage;
      if (savedStorage && typeof savedStorage === 'object') {
        for (const [key, entries] of Object.entries(savedStorage)) {
          if (typeof key !== 'string' || !Array.isArray(entries)) continue;
          const bucket = entries.map(sanitizeStorageEntry).filter(Boolean).slice(0, STORAGE_SLOTS);
          if (bucket.length > 0) player.storage[key] = bucket;
        }
      }

      const savedOrphan = savedProgress.progress?.data?.storageOrphan;
      if (Array.isArray(savedOrphan)) {
        player.storageOrphan = savedOrphan.map(sanitizeStorageEntry).filter(Boolean);
      }

      const savedArenaCooldown = Math.floor(Number(savedProgress.progress?.data?.arenaCooldownUntil));
      if (Number.isFinite(savedArenaCooldown) && savedArenaCooldown > 0) {
        player.arenaCooldownUntil = savedArenaCooldown;
      }

      const savedArenaBest = Math.floor(Number(savedProgress.progress?.data?.arenaBestWave));
      if (Number.isFinite(savedArenaBest) && savedArenaBest > 0) {
        player.arenaBestWave = savedArenaBest;
      }

      const savedCanyon = savedProgress.progress?.data?.canyonProgress;
      if (savedCanyon && typeof savedCanyon === 'object') {
        const maxReached = Math.floor(Number(savedCanyon.maxSegmentReached));
        if (Number.isInteger(maxReached) && maxReached >= 1) {
          player.canyon.maxSegmentReached = maxReached;
        }
        if (Array.isArray(savedCanyon.clearedSegments)) {
          for (const s of savedCanyon.clearedSegments) {
            const seg = Math.floor(Number(s));
            if (Number.isInteger(seg) && seg >= 1) player.canyon.clearedSegments.add(seg);
          }
        }
      }

      if (Array.isArray(savedProgress.inventory)) {
        player.inventory = savedProgress.inventory
          .filter((i) => i && typeof i.itemId === 'string' && i.quantity > 0)
          .map((i) => ({
            address: i.itemId,
            quantity: i.quantity,
            name: i.data?.name || '',
            symbol: i.data?.symbol || '',
            image: i.data?.image || '',
          }));
      }
    } else {
      player.nickname = await assignUniqueNickname(player, `Player_${player.wallet.slice(0, 4)}`);
      spawnInSafeZone(player);
    }

    const verifyResult2 = await callInternalApi('/api/internal/game/faction/verify-memberships', {
      userId: player.userId, gameId: player.gameId, wallet: player.wallet,
    }).catch((err) => {
      console.error('[Faction] verify-memberships error:', err.message);
      return null;
    });

    if (verifyResult2) {
      applyPlayerFactions(player, verifyResult2.remaining);
      if (verifyResult2.kicked && verifyResult2.kicked.length > 0) {
        console.log(`[Faction] auto-kicked ${player.userId} from: ${verifyResult2.kicked.map((k) => k.factionName).join(', ')}`);
      }
    } else {
 
      await refreshPlayerFactions(player);
    }

    await refreshPlayerCosmetics(player);
    await refreshPlayerCompanions(player);
    await refreshPlayerCosmeticCrates(player);
    if (shopPriceOverrides.size === 0) await refreshShopPrices(player.gameId);
    if (eventConfigs.size === 0) await refreshEventConfigs(player.gameId);

    const blocksResult = await callInternalApi('/api/internal/game/blocks/list', {
      userId: player.userId, gameId: player.gameId,
    }).catch((err) => {
      console.error('[Blocks] list error:', err.message);
      return null;
    });
    player.blockedUserIds = new Set((blocksResult?.blocked || []).map((b) => b.userId));
    if (aborted()) return discardPendingAuth(player);

    applyPendingPlaceableRefunds(player);

    player.instance = pickShard(player.locationId, null);
    player.justSpawned = true;
    player.teleportSettleUntil = Date.now() + TELEPORT_SETTLE_MS;

    player.authenticated = true;
    setPlayerLoading(player);
    players.set(playerId, player);

    console.log(`[+] Authenticated: ${playerId} (${player.userId}, ${player.nickname}, loc:${player.locationId}). Total: ${players.size}`);

    updatePlayerZone(player);

    const existingPlayers = [];
    forEachNearbyPlayer(player, (p) => {
      if (!isInAOI(player, p)) return;
      if (p.ready) existingPlayers.push(buildPlayerJoinPayload(p));

      player.aoiNeighbors.add(p.id);
      p.aoiNeighbors.add(playerId);
    });

    safeSend(ws, {
      type: 'auth_success',
      playerId,
      nickname: player.nickname,
      userId: player.userId,
      wallet: player.wallet,
      gameId: player.gameId,
      locationId: player.locationId,
      instance: player.instance,
      position: player.position,
      daySyncEpoch: dayNightEpoch,
      dayDurationMs: DAY_NIGHT_CONFIG.dayDurationMs,
      nightDurationMs: DAY_NIGHT_CONFIG.nightDurationMs,
      skinTextureUrl: player.skinTextureUrl || null,
      stuckCooldownUntil: (player.stuckUsedAt || 0) + STUCK_COOLDOWN_MS,
    });

    safeSend(ws, {
      type: 'init',
      playerId,
      players: existingPlayers,
      count: Array.from(players.values()).filter((p) => p.authenticated).length,
      spawnPosition: player.position,
    });

    safeSend(ws, { type: 'factionMyListResult', factions: player.factions });
    safeSend(ws, buildWorldStatusPayload());
    sendCosmeticState(player);
    sendCompanionState(player);
    sendMetNpcs(player);
    sendActiveZones(player);
    sendStorageState(player);
    sendCrateState(player);

    if (player.locationId === 'main-world') {
      safeSend(ws, { type: 'lootState', loot: serializeLoot(player.instance) });
      await ensureSignsLoaded(player.gameId);
      if (aborted()) return;
      safeSend(ws, { type: 'signState', signs: serializeSigns(player.instance) });
      sendWorldEnemyState(player);
    }

    if (player.locationId === 'tower-first-floor') {
      enterCanyonHub(player);
    }

    if (player.locationId === GALAXY_LOCATION_ID) {
      safeSend(ws, { type: 'factionGatesState', gates: displayedFactionGatesList, accountCount });
    }

    safeSend(ws, buildInfluenceStatePayload());

    sendShardState(player);

    await refreshRoomEditRights(player);
    if (aborted()) return;

    safeSend(ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });
    sendProgressionState(player);

    if (savedProgress) {
      safeSend(ws, {
        type: 'progress_loaded',
        progress: savedProgress,
      });
    }

    let hasRunningQuest = false;
    for (const quest of QUEST_LIST) {
      const state = getQuestState(player, quest.id);
      if (state.status === 'active' || state.status === 'ready_to_turn_in') {
        hasRunningQuest = true;
        safeSend(ws, buildQuestInfoPayload(player, quest));
      }
    }

    if (!hasRunningQuest) sendOfferedQuests(player);

    broadcastCount();
  }

  function handlePlayerUpdate(player, data) {
    if (!player.alive) return;
    if (!isValidPositionForLocation(player.locationId, data.position)) return;

    const now = Date.now();
    const delta = now - player.lastUpdate;
    if (delta < CONFIG.world.maxPositionUpdateRate) return;

    const movement = checkMovement(player, data.position, delta);
    if (!movement.ok) {
      player.moveViolations = (player.moveViolations || 0) + 1;
      if (player.moveViolations <= MOVE_VIOLATION_TOLERANCE) return;

      if (now - (player.moveViolationLoggedAt || 0) > 1000) {
        player.moveViolationLoggedAt = now;
        console.log(`[!] Move hack: ${player.nickname || player.id} at ${movement.speed.toFixed(1)} m/s, limit ${movement.limit.toFixed(1)} in ${player.locationId}`);
      }

      safeSend(ws, { type: 'positionCorrection', position: player.position });
      return;
    }
    player.moveViolations = 0;

    if (data.jumping && !player.jumping) {
      if (now - player.lastJump < 400) {
        data.jumping = false;
      } else {
        player.lastJump = now;
      }
    }

    player.positionHistory.push({
      position: [...data.position],
      time: now,
    });
    player.positionHistory = player.positionHistory.filter(
      p => now - p.time < 500
    );

    player.position = data.position;
    player.rotation = typeof data.rotation === 'number' ? data.rotation : 0;
    player.pitch = typeof data.pitch === 'number' ? data.pitch : 0;
    player.headYaw = typeof data.headYaw === 'number' ? data.headYaw : 0;

    player.state = VALID_STATES.has(data.state) ? data.state : 'idle';

    player.jumping = !!data.jumping;
    player.velocityY = typeof data.velocityY === 'number' ? data.velocityY : 0;
    const requestedWeaponEquipped = data.weaponEquipped !== false;
    player.weaponEquipped = player.locationId === 'tower-main-hall' ? false : requestedWeaponEquipped;
    player.isShooting = !!data.isShooting;
    player.lastUpdate = now;

    if (updatePlayerZone(player)) recomputeAOI(player);

    if (!player.ready) return;

    player.stateDirty = true;
    sendLiveUpdate(player);
  }

  function sendLiveUpdate(player) {
    let message = null;

    for (const id of player.aoiNeighbors) {
      const other = players.get(id);
      if (!other || other.wantsSnapshots || other.ws.readyState !== WebSocket.OPEN) continue;

      if (message === null) {
        message = getCachedMessage({ type: 'playerUpdate', ...buildPlayerStatePayload(player) });
      }
      try {
        other.ws.send(message);
      } catch (err) {
        console.error('[!] Update send error:', err.message);
      }
    }
  }

  function handleReload(player) {
    if (!player.alive) return;
    if (player.combat.weapon === 'staff') return;
    if (player.weaponAmmo >= player.combat.magSize) return;

    player.weaponAmmo = 0;
    player.ammoEmptyAt = Date.now();
  }

  function handleShoot(player, data) {
    if (!player.alive) return;
    clearSpawnProtection(player);

    if (!Array.isArray(data.origin) || data.origin.length !== 3) return;
    if (!data.origin.every(Number.isFinite)) return;

    const now = Date.now();
    const arsenalEntry = dust2MemberOf(player);
    const arsenalGun = arsenalEntry ? dust2GunOf(arsenalEntry) : null;
    if (arsenalEntry && !arsenalGun) return;

    const weapon = arsenalGun ? dust2WeaponConfig(arsenalGun) : weaponConfigFor(player);
    const mode = arsenalGun ? progression.SINGLE_FIRE_MODE : fireModeFor(player);
    const isStaff = !arsenalGun && player.combat.weapon === 'staff';

    const directions = readShotDirections(data, shotProjectileCount(mode), mode.spreadDegrees || 0);
    if (!directions) {
      console.log(`[!] Shoot hack: ${playerId} sent an invalid projectile spread`);
      return;
    }

    const overdrive = abilities.findEffect(player, 'overdrive', now);
    const boltCost = isStaff ? boltEnergyCost(player, weapon, mode) : 0;

    if (isStaff) {
      if (player.ability.energy < boltCost) return;
    } else if (overdrive && overdrive.noReload) {
      player.weaponAmmo = player.combat.magSize;
    } else if (player.weaponAmmo <= 0) {
      if (now - player.ammoEmptyAt >= player.combat.reloadMs) {
        player.weaponAmmo = player.combat.magSize;
      } else {
        return;
      }
    }

    const allowedInterval = arsenalGun ? arsenalGun.fireRateMs : shotIntervalFor(player, weapon, mode, now);
    if (now - player.lastShotAt < allowedInterval - weapon.fireRateToleranceMs) {
      console.log(`[!] Shoot hack: ${playerId} firing faster than ${mode.id} allows`);
      return;
    }

    const [px, , pz] = player.position;
    const [ox, oy, oz] = data.origin;

    const distFromPlayer = Math.sqrt((ox - px) ** 2 + (oz - pz) ** 2);
    if (distFromPlayer > 3) {
      console.log(`[!] Shoot hack: origin ${distFromPlayer.toFixed(2)}m from player`);
      return;
    }

    const playerY = player.position[1];
    if (oy < playerY - 3 || oy > playerY + 5) {
      console.log(`[!] Shoot hack: invalid origin Y=${oy.toFixed(2)} at player Y=${playerY.toFixed(2)}`);
      return;
    }

    if (isInProtectedZone(player)) {
      safeSend(ws, { type: 'error', message: 'Cannot shoot in safe zone', messageKey: 'g.err.noShootSafeZone' });
      return;
    }

    if (isStaff) {
      player.ability.energy = Math.max(0, player.ability.energy - boltCost);
      sendAbilityMeter(player);
    } else {
      player.weaponAmmo--;
      if (player.weaponAmmo <= 0) player.ammoEmptyAt = now;
    }

    player.lastShotAt = now;

    player.stats.shotsFired++;
    bumpFactionTaskProgress(player, 'shots', 1).catch((err) => console.error('[FactionTask] bump error:', err.message));

    const speed = isStaff ? boltSpeedFor(player, weapon) : 0;
    const origin = [ox, oy, oz];
    const explosive = advanceExplosiveRound(player);

    for (const direction of directions) {
      player.recentShots.push({
        time: now,
        origin,
        direction,
        speed,
        maxRange: weapon.maxRange,
        damageMult: mode.damageMult,
        hitsLeft: 1 + Math.max(0, mode.pierceCount || 0),
        mode: mode.id,
        explosive,
      });
    }
    player.recentShots = player.recentShots.filter((s) => now - s.time < shotLifetimeMs(s));

    broadcast({
      type: 'shoot',
      id: playerId,
      origin,
      direction: directions[0],
      directions,
      weapon: player.combat.weapon,
      mode: mode.id,
      speed,
    }, playerId, true, player);
  }

  function handleFireModeSet(player, data) {
    if (typeof data.mode !== 'string') return;

    const state = player.progression;
    if (data.mode !== 'single') {
      if (!skills.hasMode(state.skills, data.mode)) {
        safeSend(player.ws, { type: 'error', message: 'You have not unlocked that fire mode', messageKey: 'g.err.fireModeLocked' });
        return;
      }
      if (skills.modeBranch(data.mode) !== state.branch) return;
    }

    state.fireMode = data.mode;
    persistPlayer(player);

    safeSend(player.ws, { type: 'fireModeChanged', mode: state.fireMode });
    sendProgressionState(player);
  }

  async function handleNicknameChange(player, data) {
    if (typeof data.nickname !== 'string') return;
    const newNick = data.nickname.trim().slice(0, 30);
    if (newNick.length === 0) return;

    if (newNick === player.nickname) {
      safeSend(ws, { type: 'nicknameChanged', nickname: player.nickname });
      return;
    }

    const result = await callInternalApi('/api/internal/game/nickname/set', {
      userId: player.userId, gameId: player.gameId, nickname: newNick, allowSuffix: false,
    }).catch((err) => {
      console.error('[Nickname] change error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      safeSend(ws, {
        type: 'error',
        message: result?.error === 'nickname_taken' ? 'That nickname is already taken' : 'Could not change nickname',
        messageKey: result?.error === 'nickname_taken' ? 'g.err.nicknameTaken' : 'g.err.nicknameChangeFailed',
      });
      return;
    }

    player.nickname = result.nickname;

    broadcast({
      type: 'nicknameChange',
      id: playerId,
      nickname: player.nickname,
    }, playerId, true, player);

    safeSend(ws, { type: 'nicknameChanged', nickname: player.nickname });
  }

  async function handleSkinUpdate(player, data) {
    if (typeof data.url !== 'string' || data.url.length === 0 || data.url.length > 500) return;

    let parsed;
    try {
      parsed = new URL(data.url);
    } catch (e) {
      return;
    }

    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.public.blob.vercel-storage.com')) {
      safeSend(ws, { type: 'error', message: 'Invalid skin URL', messageKey: 'g.err.invalidSkinUrl' });
      return;
    }

    player.skinTextureUrl = data.url;
    player.skinTextureUrlChangedAt = Date.now();
    persistPlayer(player);

    broadcast({
      type: 'skinUpdate',
      playerId: player.id,
      url: player.skinTextureUrl,
    }, playerId, true, player);

    safeSend(ws, { type: 'skinUpdate', playerId: player.id, url: player.skinTextureUrl });
  }

  function isMuted(player) {
    return !!player.mutedUntil && new Date(player.mutedUntil).getTime() > Date.now();
  }

  function handleChat(player, data) {
    if (typeof data.message !== 'string') return;

    if (isMuted(player)) {
      safeSend(player.ws, { type: 'error', message: `You are muted until ${new Date(player.mutedUntil).toLocaleString()}`, messageKey: 'g.err.mutedUntil', messageVars: { until: new Date(player.mutedUntil).toLocaleString() } });
      return;
    }

    const msg = sanitizeMessage(data.message.trim().slice(0, 200));
    if (msg.length === 0) return;

    if (containsLink(msg)) {
      safeSend(player.ws, { type: 'error', message: 'Links are not allowed in chat', messageKey: 'g.err.noLinksInChat' });
      return;
    }

    broadcast({
      type: 'chat',
      id: generateId(),
      sender: player.nickname,
      senderWallet: player.wallet,
      senderFactionSymbol: player.displayedFactionSymbol,
      senderFactionImage: player.displayedFactionImage,
      senderIsAdmin: !!player.isAdmin,
      senderIsFactionCreator: !!player.isFactionCreator,
      message: msg,
      timestamp: Date.now(),
    }, null, false, player, true);

    logChatMessage(player, msg, null);
  }

  function handleFactionChat(player, data) {
    if (typeof data.message !== 'string') return;
    if (typeof data.factionId !== 'string' || !data.factionId) return;

    if (isMuted(player)) {
      safeSend(player.ws, { type: 'error', message: `You are muted until ${new Date(player.mutedUntil).toLocaleString()}`, messageKey: 'g.err.mutedUntil', messageVars: { until: new Date(player.mutedUntil).toLocaleString() } });
      return;
    }

    if (!player.factions?.some((f) => f.id === data.factionId)) {
      safeSend(player.ws, { type: 'error', message: 'You are not a member of that faction', messageKey: 'g.err.notFactionMember' });
      return;
    }

    const msg = sanitizeMessage(data.message.trim().slice(0, 200));
    if (msg.length === 0) return;

    if (containsLink(msg)) {
      safeSend(player.ws, { type: 'error', message: 'Links are not allowed in chat', messageKey: 'g.err.noLinksInChat' });
      return;
    }

    broadcastToFaction(data.factionId, {
      type: 'factionChat',
      id: generateId(),
      factionId: data.factionId,
      sender: player.nickname,
      senderWallet: player.wallet,
      senderFactionSymbol: player.displayedFactionSymbol,
      senderFactionImage: player.displayedFactionImage,
      senderIsAdmin: !!player.isAdmin,
      senderIsFactionCreator: !!player.isFactionCreator,
      message: msg,
      timestamp: Date.now(),
    }, null, player.userId);

    logChatMessage(player, msg, data.factionId);
  }

  function logChatMessage(player, message, factionId) {
    callInternalApi('/api/internal/game/chat/log', {
      gameId: player.gameId,
      senderUserId: player.userId,
      senderWallet: player.wallet,
      senderNickname: player.nickname,
      factionId,
      message,
    }).catch((err) => {
      console.error('[Chat] log error:', err.message);
    });
  }

  function relayVoiceSignal(player, targetId, payload) {
    if (isMuted(player)) return;
    if (typeof targetId !== 'string') return;
    const target = players.get(targetId);
    if (!target || !target.authenticated || target.ws.readyState !== WebSocket.OPEN) return;
    if (target.locationId !== player.locationId) return;
    safeSend(target.ws, payload);
  }

  function handleVoiceOffer(player, data) {
    if (typeof data.sdp !== 'string') return;
    relayVoiceSignal(player, data.targetId, { type: 'voiceOffer', fromId: player.id, sdp: data.sdp });
  }

  function handleVoiceAnswer(player, data) {
    if (typeof data.sdp !== 'string') return;
    relayVoiceSignal(player, data.targetId, { type: 'voiceAnswer', fromId: player.id, sdp: data.sdp });
  }

  function handleVoiceIceCandidate(player, data) {
    if (!data.candidate || typeof data.candidate !== 'object') return;
    relayVoiceSignal(player, data.targetId, { type: 'voiceIceCandidate', fromId: player.id, candidate: data.candidate });
  }

  function handleHit(player, data) {
    if (!player.alive) return;

    if (!data.target || typeof data.target !== 'string') return;
    if (!Array.isArray(data.point) || data.point.length !== 3) return;

    const target = players.get(data.target);
    if (!target || !target.authenticated || !target.alive) return;
    if (data.target === playerId) return;

    const grinderMatch = grinder.matchOf(playerId);
    if (grinderMatch) {
      if (grinderMatch.phase !== 'live') return;
      if (!grinderMatch.members.has(data.target)) return;
    } else if (party.areAllies(playerId, data.target)) {
      return;
    }

    const defusalMatch = defusal.matchOf(playerId);
    if (defusalMatch) {
      if (defusalMatch.phase === 'freeze' || defusalMatch.phase === 'over') return;
      if (defusal.sideOf(defusalMatch, playerId) === defusal.sideOf(defusalMatch, data.target)) return;
    }

    if (player.locationId !== target.locationId) {
      console.log(`[!] Hit hack: different locations ${player.locationId} vs ${target.locationId}`);
      return;
    }

    if (player.instance !== target.instance && isShardedLocation(player.locationId)) {
      return;
    }

    if (isInProtectedZone(player) || isInProtectedZone(target)) {
      return;
    }

    const [px, , pz] = player.position;

    const shotTime = Date.now() - Math.min(player.rtt, MAX_LAG_COMPENSATION_MS);
    const historicalPos = getHistoricalPosition(target, shotTime);

    const [tx, , tz] = historicalPos;
    const dist = Math.sqrt((tx - px) ** 2 + (tz - pz) ** 2);
    if (dist > 300) {
      console.log(`[!] Hit hack: distance ${dist.toFixed(2)}m`);
      return;
    }

    const matchedShot = findMatchingShot(player, historicalPos, Date.now());
    if (!matchedShot) {
      console.log(`[!] Hit hack: no matching recent shot from ${playerId} explains hit on ${data.target}`);
      return;
    }

    if (isPathBlockedByEntity(player.position, historicalPos, player.locationId, new Set([playerId, data.target]))) {
      console.log(`[!] Hit rejected: shot from ${playerId} to ${data.target} blocked by another entity`);
      return;
    }

    if (isSpawnProtected(target)) return;

    const inArsenalMode = defusalMatch !== null || grinderMatch !== null;
    const baseDamage = inArsenalMode
      ? arsenalDamage(player, target, dust2HitZone(data.point, historicalPos), dist)
      : player.combat.pvpDamage * matchedShot.damageMult * allyDamageBonus(player);

    applyBulletDamage(player, target, baseDamage, { point: historicalPos });

    if (!inArsenalMode) {
      applyShotPassives(player, matchedShot, { kind: 'player', entity: target }, historicalPos);
    }
  }

  function handleEnemyHit(player, data) {
    if (!player.alive) return;
    if (typeof data.target !== 'string') return;
    if (!Array.isArray(data.point) || data.point.length !== 3) return;
    const enemies = activeEnemiesFor(player);
    if (!enemies) return;

    const enemy = enemies.get(data.target);
    if (!enemy || !enemy.alive) return;

    const [px, , pz] = player.position;

    const shotTime = Date.now() - Math.min(player.rtt, MAX_LAG_COMPENSATION_MS);
    const historicalPos = getHistoricalPosition(enemy, shotTime);

    const dist = Math.sqrt((historicalPos[0] - px) ** 2 + (historicalPos[2] - pz) ** 2);
    if (dist > 300) {
      console.log(`[!] Enemy hit hack: distance ${dist.toFixed(2)}m`);
      return;
    }

    const matchedShot = findMatchingShot(player, historicalPos, Date.now(), CANYON_CONFIG.hitTolerance);
    if (!matchedShot) {
      console.log(`[!] Enemy hit hack: no matching recent shot from ${playerId} explains hit on ${data.target}`);
      return;
    }

    if (isPathBlockedByEntity(player.position, historicalPos, player.locationId, new Set([playerId, enemy.id]), enemies.values())) {
      console.log(`[!] Enemy hit rejected: shot from ${playerId} to ${data.target} blocked by another entity`);
      return;
    }

    applyEnemyDamage(player, enemy, player.combat.enemyDamage * matchedShot.damageMult * allyDamageBonus(player), {
      point: data.point,
    });

    applyShotPassives(player, matchedShot, { kind: 'enemy', entity: enemy }, historicalPos);
  }

  async function handleCaveChestOpen(player, data) {
    if (!player.alive) return;
    const cave = caveInstanceOf(player);
    if (!cave) return;
    if (typeof data.chestId !== 'string') return;

    if (data.chestId === CAVE_BOSS_CHEST_ID) {
      await openBossChest(player, cave);
      return;
    }

    const chest = CAVE_CHESTS[data.chestId];
    if (!chest) return;

    if (!cave.crateRooms.has(data.chestId)) return;

    if (cave.openedRooms.has(data.chestId)) {
      safeSend(player.ws, { type: 'error', message: 'This crate is already empty', messageKey: 'g.err.chestEmpty' });
      return;
    }

    const [px, , pz] = player.position;
    const distance = Math.sqrt((chest[0] - px) ** 2 + (chest[2] - pz) ** 2);
    if (distance > CAVE_CHEST_REACH) return;

    const now = Date.now();
    cave.openedRooms.add(data.chestId);

    player.ash += CAVE_CHEST_REWARD;
    player.economyChangedAt = now;
    grantXp(player, progression.XP_SOURCES.caveChestXp, 'cave_chest');
    persistPlayer(player);

    broadcastToLocation(
      CAVE_LOCATION_ID,
      { type: 'caveChestOpened', chestId: data.chestId, ash: 0 },
      player.id,
      player.instance
    );
    safeSend(player.ws, { type: 'caveChestOpened', chestId: data.chestId, ash: CAVE_CHEST_REWARD });
    safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });
  }

  function handleCanyonWarp(player, data) {
    if (player.locationId !== 'tower-first-floor' || !player.canyon) return;
    if (!player.canyon.inHub) return;
    const segment = Math.floor(Number(data.segment));
    if (!Number.isInteger(segment) || segment < 1 || segment > player.canyon.maxSegmentReached) return;

    populateCanyonSegment(player, segment);
  }

  function handleCanyonEnterDungeon(player) {
    if (player.locationId !== 'tower-first-floor' || !player.canyon) return;
    if (!player.canyon.inHub) return;

    populateCanyonSegment(player, 1);
  }

  function handleCanyonCrossThreshold(player) {
    if (player.locationId !== 'tower-first-floor' || !player.canyon) return;
    if (player.canyon.inHub || player.canyon.pendingSegment == null) return;

    const nextSegment = player.canyon.pendingSegment;
    player.canyon.pendingSegment = null;
    preparePlayerEnemiesForSegment(player, nextSegment);
    safeSend(player.ws, { type: 'enemyState', enemies: serializeCanyonEnemies(player) });
  }

  function handleCanyonReturnToHub(player) {
    if (player.locationId !== 'tower-first-floor' || !player.canyon) return;
    if (player.canyon.inHub) return;

    if (!player.canyon.runCleared) {
      safeSend(player.ws, { type: 'error', message: 'The evacuation pad stays dark until the segment boss is down.', messageKey: 'g.err.evacPadLocked' });
      return;
    }

    const pad = canyonReturnPadPosition(player.canyon.segment);
    const [px, , pz] = player.position;
    const distance = Math.sqrt((pad[0] - px) ** 2 + (pad[2] - pz) ** 2);
    if (distance > CANYON_RETURN_PAD_REACH) {
      safeSend(player.ws, { type: 'error', message: 'Stand on the evacuation pad to leave.', messageKey: 'g.err.standOnEvacPad' });
      return;
    }

    enterCanyonHub(player);
  }

  function handleStuckTeleport(player) {
    const now = Date.now();
    const cooldownUntil = (player.stuckUsedAt || 0) + STUCK_COOLDOWN_MS;

    if (!player.alive) {
      safeSend(player.ws, { type: 'stuckResult', ok: false, reason: 'dead', cooldownUntil });
      return;
    }

    if (now < cooldownUntil) {
      safeSend(player.ws, { type: 'stuckResult', ok: false, reason: 'cooldown', cooldownUntil });
      return;
    }

    if (isInCombat(player)) {
      safeSend(player.ws, { type: 'stuckResult', ok: false, reason: 'in_combat', cooldownUntil });
      return;
    }

    player.stuckUsedAt = now;
    const nextCooldownUntil = now + STUCK_COOLDOWN_MS;

    if (isInCanyonSegment(player)) {
      safeSend(player.ws, {
        type: 'stuckResult',
        ok: true,
        reason: 'canyon_death',
        cooldownUntil: nextCooldownUntil,
        locationId: player.locationId,
      });
      markPlayerDead(player, 'bail-out', player.position);
      persistPlayer(player);
      return;
    }

    if (player.locationId === STUCK_DESTINATION_ID) {
      spawnInSafeZone(player, STUCK_DESTINATION_ID);
      player.justTeleported = true;
      player.teleportSettleUntil = now + TELEPORT_SETTLE_MS;
      player.positionHistory = [];
      player.recentShots = [];
      grantSpawnProtection(player);
    }

    persistPlayer(player);

    safeSend(player.ws, {
      type: 'stuckResult',
      ok: true,
      reason: null,
      cooldownUntil: nextCooldownUntil,
      locationId: STUCK_DESTINATION_ID,
    });
  }

  function handleHomeTeleport(player) {
    const now = Date.now();
    const cooldownUntil = (player.homeTeleportUsedAt || 0) + HOME_TELEPORT_COOLDOWN_MS;

    const refuse = (reason) => safeSend(player.ws, {
      type: 'homeTeleportResult',
      casting: false,
      cancelled: true,
      reason,
      cooldownUntil,
      charges: player.placeables['home-teleport'] || 0,
    });

    if (!player.alive) return refuse('dead');
    if (player.homeTeleportCastUntil > now) return refuse('casting');
    if (!player.homeSpawn) return refuse('no_beacon');
    if (isInCombat(player)) return refuse('in_combat');
    if (isInCanyonSegment(player)) return refuse('canyon');
    if (now < cooldownUntil) return refuse('cooldown');
    if (!(player.placeables['home-teleport'] > 0)) return refuse('no_charge');

    player.homeTeleportCastUntil = now + HOME_TELEPORT_CAST_MS;
    safeSend(player.ws, {
      type: 'homeTeleportResult',
      casting: true,
      castMs: HOME_TELEPORT_CAST_MS,
      cooldownUntil,
      charges: player.placeables['home-teleport'] || 0,
    });
  }

  function storageTargetKey(player, data) {
    if (typeof data.key !== 'string' || data.key.length === 0) return null;

    if (!isOwnRoom(player)) {
      safeSend(player.ws, { type: 'error', message: 'Storage crates only open in your own room', messageKey: 'g.err.crateOwnRoomOnly' });
      return null;
    }
    if (!player.storages.has(data.key)) {
      safeSend(player.ws, { type: 'error', message: 'That crate is no longer there', messageKey: 'g.err.crateGone' });
      return null;
    }
    if (!storageInReach(player, data.key)) {
      safeSend(player.ws, { type: 'error', message: 'Step closer to the crate', messageKey: 'g.err.crateTooFar' });
      return null;
    }

    return data.key;
  }

  function handleStorageOpen(player, data) {
    const key = storageTargetKey(player, data);
    if (!key) return;
    sendStorageState(player, key);
  }

  function handleStorageDeposit(player, data) {
    const key = storageTargetKey(player, data);
    if (!key) return;

    const address = typeof data.address === 'string' ? data.address : null;
    if (!address) return;

    const slot = player.inventory.find((entry) => entry.address === address);
    if (!slot) return;

    const requested = Math.floor(Number(data.quantity));
    const amount = Math.max(1, Math.min(Number.isFinite(requested) ? requested : slot.quantity, slot.quantity));

    const moved = stackIntoStorage(storageBucket(player, key), {
      address,
      name: slot.name,
      symbol: slot.symbol,
      image: slot.image,
      quantity: amount,
    });

    if (moved <= 0) {
      safeSend(player.ws, { type: 'error', message: `This crate is full — ${STORAGE_SLOTS} stacks is the limit`, messageKey: 'g.err.crateFull', messageVars: { limit: STORAGE_SLOTS } });
      return;
    }

    slot.quantity -= moved;
    if (slot.quantity <= 0) player.inventory = player.inventory.filter((entry) => entry !== slot);

    persistPlayer(player);
    safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });
    sendStorageState(player, key);
  }

  function handleStorageWithdraw(player, data) {
    const key = storageTargetKey(player, data);
    if (!key) return;

    const address = typeof data.address === 'string' ? data.address : null;
    if (!address) return;

    const bucket = storageBucket(player, key);
    const stored = bucket.find((entry) => entry.address === address);
    if (!stored) return;

    const requested = Math.floor(Number(data.quantity));
    const amount = Math.max(1, Math.min(Number.isFinite(requested) ? requested : stored.quantity, stored.quantity));

    const slot = player.inventory.find((entry) => entry.address === address);
    if (!slot && player.inventory.length >= LOOT_CONFIG.maxInventory) {
      safeSend(player.ws, { type: 'error', message: 'Your inventory is full', messageKey: 'g.err.inventoryFull' });
      return;
    }

    if (slot) {
      slot.quantity += amount;
    } else {
      player.inventory.push({
        address: stored.address,
        name: stored.name,
        symbol: stored.symbol,
        image: stored.image,
        quantity: amount,
      });
    }

    stored.quantity -= amount;
    if (stored.quantity <= 0) player.storage[key] = bucket.filter((entry) => entry !== stored);

    persistPlayer(player);
    safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });
    sendStorageState(player, key);
  }

  function handleCanyonMapRequest(player) {
    if (player.locationId !== 'tower-first-floor' || !player.canyon) return;
    safeSend(player.ws, {
      type: 'canyonMap',
      segment: player.canyon.segment,
      maxSegmentReached: player.canyon.maxSegmentReached,
      clearedSegments: Array.from(player.canyon.clearedSegments),
    });
  }

  function factionErrorKey(code) {
    switch (code) {
      case 'already_in_faction': return 'g.err.faction.alreadyMember';
      case 'name_taken': return 'g.err.faction.nameTaken';
      case 'faction_not_found': return 'g.err.faction.notFound';
      case 'invalid_name': return 'g.err.faction.invalidName';
      case 'token_not_found': return 'g.err.faction.tokenNotFound';
      case 'insufficient_token_balance': return 'g.err.faction.needTokenBalance';
      case 'balance_check_failed': return 'g.err.faction.balanceCheckFailed';
      default: return 'g.err.faction.failed';
    }
  }

  function factionErrorMessage(code) {
    switch (code) {
      case 'already_in_faction': return 'You are already a member of that faction';
      case 'name_taken': return 'A faction for that token already exists';
      case 'faction_not_found': return 'That faction no longer exists';
      case 'invalid_name': return 'Could not determine a name for that token';
      case 'token_not_found': return 'Could not find a token for that address';
      case 'insufficient_token_balance': return 'You need to hold this faction\'s token in your wallet to do that';
      case 'balance_check_failed': return 'Could not verify your token balance right now, try again shortly';
      default: return 'Faction action failed';
    }
  }

  async function handleFactionCreate(player, data) {
    safeSend(player.ws, {
      type: 'error',
      message: 'Faction creation now happens through Alaric in-game and costs 1,000,000 TNJ. Please update your client.',
      messageKey: 'g.err.factionCreateMoved',
    });
  }

  async function handleFactionJoin(player, data) {
    if (typeof data.factionId !== 'string' || !data.factionId) return;

    const result = await callInternalApi('/api/internal/game/faction/join', {
      userId: player.userId,
      gameId: player.gameId,
      wallet: player.wallet,
      factionId: data.factionId,
    }).catch((err) => {
      console.error('[Faction] join error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      safeSend(player.ws, { type: 'error', message: factionErrorMessage(result?.error), messageKey: factionErrorKey(result?.error) });
      return;
    }

    await refreshPlayerFactions(player);
    safeSend(player.ws, { type: 'factionJoined', faction: result.faction });
    broadcastFactionIdentity(player);
    notifyFactionRosterChanged(data.factionId);
  }

  async function handleFactionInvite(player, data) {
    if (typeof data.factionId !== 'string' || !data.factionId) return;
    if (typeof data.toWallet !== 'string' || !data.toWallet.trim()) return;

    if (!player.factions?.some((f) => f.id === data.factionId)) {
      safeSend(player.ws, { type: 'error', message: 'You are not a member of that faction', messageKey: 'g.err.notFactionMember' });
      return;
    }

    const result = await callInternalApi('/api/internal/game/faction/invite-mail', {
      inviterUserId: player.userId,
      gameId: player.gameId,
      factionId: data.factionId,
      toWallet: data.toWallet.trim(),
    }).catch((err) => {
      console.error('[Faction] invite error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      safeSend(player.ws, { type: 'error', message: 'Could not send faction invite', messageKey: 'g.err.factionInviteFailed' });
      return;
    }

    safeSend(player.ws, { type: 'factionInviteSent', toWallet: data.toWallet.trim() });
  }

  async function handleFactionLeave(player, data) {
    if (typeof data.factionId !== 'string' || !data.factionId) return;

    await callInternalApi('/api/internal/game/faction/leave', {
      userId: player.userId,
      gameId: player.gameId,
      factionId: data.factionId,
    }).catch((err) => console.error('[Faction] leave error:', err.message));

    await refreshPlayerFactions(player);
    safeSend(player.ws, { type: 'factionLeft', factionId: data.factionId });
    broadcastFactionIdentity(player);
    notifyFactionRosterChanged(data.factionId);
  }

  async function handleFactionSetDisplayed(player, data) {
    if (typeof data.factionId !== 'string' || !data.factionId) return;

    const result = await callInternalApi('/api/internal/game/faction/set-displayed', {
      userId: player.userId,
      gameId: player.gameId,
      factionId: data.factionId,
    }).catch((err) => {
      console.error('[Faction] set-displayed error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      safeSend(player.ws, { type: 'error', message: 'Could not switch displayed faction', messageKey: 'g.err.factionSwitchFailed' });
      return;
    }

    await refreshPlayerFactions(player);
    safeSend(player.ws, { type: 'factionDisplayedSet', faction: result.faction });
    broadcastFactionIdentity(player);
  }

  async function handleFactionMyListRequest(player) {
    await refreshPlayerFactions(player);
    safeSend(player.ws, { type: 'factionMyListResult', factions: player.factions });
  }

  async function handleFactionSearch(player, data) {
    const ca = typeof data.ca === 'string' ? data.ca : '';
    const name = typeof data.name === 'string' ? data.name : '';

    if (!ca && !name) {
      safeSend(player.ws, { type: 'factionSearchResult', results: [] });
      return;
    }

    const result = await callInternalApi('/api/internal/game/faction/search', {
      gameId: player.gameId, ca, name,
    }).catch((err) => {
      console.error('[Faction] search error:', err.message);
      return null;
    });

    safeSend(player.ws, { type: 'factionSearchResult', results: result?.results || [] });
  }

  async function handleFactionList(player, data) {
    const page = Number.isInteger(data.page) && data.page > 0 ? data.page : 1;

    const result = await callInternalApi('/api/internal/game/faction/list', {
      gameId: player.gameId, page, limit: 20,
    }).catch((err) => {
      console.error('[Faction] list error:', err.message);
      return null;
    });

    safeSend(player.ws, {
      type: 'factionListResult',
      results: result?.results || [],
      page: result?.page || page,
    });
  }

  async function handleFactionInfo(player, data) {
    if (typeof data.factionId !== 'string' || !data.factionId) return;

    const result = await callInternalApi('/api/internal/game/faction/get-by-id', {
      gameId: player.gameId, factionId: data.factionId, viewerUserId: player.userId,
    }).catch((err) => {
      console.error('[Faction] info error:', err.message);
      return null;
    });
    safeSend(player.ws, { type: 'factionInfo', faction: result?.faction || null });
  }

  async function handlePlayerProfileRequest(player, data) {
    if (typeof data.wallet !== 'string' || !data.wallet) return;

    const result = await callInternalApi('/api/internal/game/player-profile', {
      gameId: player.gameId, wallet: data.wallet,
    }).catch((err) => {
      console.error('[Profile] request error:', err.message);
      return null;
    });

    safeSend(player.ws, { type: 'playerProfile', profile: result?.profile || null });
  }

  async function handleLeaderboardRequest(player, data) {
    const limit = Number.isInteger(data.limit) && data.limit > 0 ? data.limit : 20;

    const result = await cachedInternalCall(
      `leaderboard:${player.gameId}:${limit}`,
      5000,
      () => callInternalApi('/api/internal/game/leaderboard', { gameId: player.gameId, limit })
    ).catch((err) => {
      console.error('[Leaderboard] request error:', err.message);
      return null;
    });

    safeSend(player.ws, { type: 'leaderboardResult', leaderboard: result?.leaderboard || [] });
  }

  async function handleFactionLeaderboardRequest(player, data) {
    const limit = Number.isInteger(data.limit) && data.limit > 0 ? data.limit : 50;

    const result = await cachedInternalCall(
      `factionLeaderboard:${player.gameId}:${limit}`,
      5000,
      () => callInternalApi('/api/internal/game/faction/leaderboard', { gameId: player.gameId, limit })
    ).catch((err) => {
      console.error('[Faction] leaderboard request error:', err.message);
      return null;
    });

    safeSend(player.ws, { type: 'factionLeaderboardResult', leaderboard: result?.leaderboard || [] });
  }

  function applyPlayerFactions(player, factionsList) {
    player.factions = factionsList || [];
    const displayed = player.factions.find((f) => f.isDisplayed) || null;
    player.displayedFactionId = displayed?.id || null;
    player.displayedFactionName = displayed?.name || null;
    player.displayedFactionSymbol = displayed?.symbol || null;
    player.displayedFactionImage = displayed?.image || null;
    player.isFactionCreator = player.factions.some((f) => f.verifiedCreatorWallet === player.wallet);
  }

  function broadcastFactionIdentity(player) {
    broadcast({
      type: 'playerFactionIdentity',
      id: player.id,
      factionSymbol: player.displayedFactionSymbol,
      factionImage: player.displayedFactionImage,
      isFactionCreator: player.isFactionCreator,
    }, player.id, true, player);
  }

  function notifyFactionRosterChanged(factionId) {
    if (!factionId) return;

    internalCache.forEach((entry, key) => {
      if (entry.pending) return;
      if (key.startsWith('factionLeaderboard:') || key.startsWith('factionQuests:')) internalCache.delete(key);
    });

    players.forEach((p) => {
      if (!p.authenticated || p.ws.readyState !== WebSocket.OPEN) return;

      const isMember = !!p.factions?.some((f) => f.id === factionId);
      const showsBoards = p.locationId === 'tower-main-hall';
      if (!isMember && !showsBoards) return;

      safeSend(p.ws, { type: 'factionRosterChanged', factionId, mine: isMember });
    });
  }

  async function refreshPlayerFactions(player) {
    const result = await callInternalApi('/api/internal/game/faction/my-factions', {
      userId: player.userId, gameId: player.gameId,
    }).catch((err) => {
      console.error('[Faction] my-factions error:', err.message);
      return null;
    });
    applyPlayerFactions(player, result?.factions);
  }

  function handleFactionTaskListRequest(player) {
    safeSend(player.ws, { type: 'factionTaskListResult', tasks: FACTION_TASKS });
  }

  async function handleFactionAcceptTask(player, data) {
    if (typeof data.factionId !== 'string' || !player.factions?.some((f) => f.id === data.factionId)) return;
    if (typeof data.taskKey !== 'string') return;
    const def = FACTION_TASKS_BY_KEY.get(data.taskKey);
    if (!def) {
      safeSend(player.ws, { type: 'error', message: 'Unknown task', messageKey: 'g.err.unknownTask' });
      return;
    }

    const myGen = nextFactionTaskGeneration(data.factionId);

    const result = await callInternalApi('/api/internal/game/faction/accept-task', {
      userId: player.userId, gameId: player.gameId, factionId: data.factionId,
      taskKey: def.key, target: def.target, rewardAsh: def.rewardAsh,
    }).catch((err) => {
      console.error('[FactionTask] accept error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      const message = result?.error === 'task_already_active'
        ? 'A task is already active for your faction'
        : result?.error === 'not_authorized'
          ? 'Only the faction leader or verified token creator can accept tasks'
          : 'Could not accept task';
      const messageKey = result?.error === 'task_already_active'
        ? 'g.err.task.alreadyActive'
        : result?.error === 'not_authorized'
          ? 'g.err.task.notAuthorized'
          : 'g.err.task.acceptFailed';
      safeSend(player.ws, { type: 'error', message, messageKey });
      return;
    }

    if (factionTaskGeneration.get(data.factionId) === myGen) {
      factionTaskState.set(data.factionId, {
        taskKey: def.key, metric: def.metric, target: def.target, progress: 0, dirty: false, contributions: new Map(),
      });
    }

    broadcastToFaction(data.factionId, { type: 'factionTaskAccepted', faction: result.faction }, null);
  }

  async function handleFactionClaimCreator(player, data) {
    if (typeof data.factionId !== 'string' || !player.factions?.some((f) => f.id === data.factionId)) return;

    const result = await callInternalApi('/api/internal/game/faction/claim-creator', {
      userId: player.userId, gameId: player.gameId, wallet: player.wallet, factionId: data.factionId,
    }).catch((err) => {
      console.error('[FactionTask] claim-creator error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      safeSend(player.ws, { type: 'error', message: 'Could not verify token creator right now', messageKey: 'g.err.creatorVerifyFailed' });
      return;
    }

    safeSend(player.ws, { type: 'factionCreatorClaimResult', isCreator: result.isCreator, faction: result.faction });

    if (result.isCreator) {
      broadcastToFaction(data.factionId, { type: 'factionCreatorVerified', faction: result.faction }, player.id);
    }
  }

  async function handleFactionQuestCreate(player, data) {
    if (typeof data.factionId !== 'string' || !player.factions?.some((f) => f.id === data.factionId)) return;

    const targetUrl = typeof data.targetUrl === 'string' ? data.targetUrl.trim() : '';
    if (!isValidXPostUrl(targetUrl)) {
      safeSend(player.ws, { type: 'error', message: 'The quest link must be a post on https://x.com/', messageKey: 'g.err.questLinkMustBeX' });
      return;
    }

    const slotsTotal = Number.isInteger(data.slotsTotal) ? data.slotsTotal : 0;
    const rewardAsh = Number.isInteger(data.rewardAsh) ? data.rewardAsh : 0;
    if (slotsTotal < QUEST_MIN_SLOTS || slotsTotal > QUEST_MAX_SLOTS) {
      safeSend(player.ws, { type: 'error', message: `Participants must be between ${QUEST_MIN_SLOTS} and ${QUEST_MAX_SLOTS}`, messageKey: 'g.err.participantsRange', messageVars: { min: QUEST_MIN_SLOTS, max: QUEST_MAX_SLOTS } });
      return;
    }
    if (rewardAsh < QUEST_MIN_REWARD_ASH || rewardAsh > QUEST_MAX_REWARD_ASH) {
      safeSend(player.ws, { type: 'error', message: `Reward must be between ${QUEST_MIN_REWARD_ASH} and ${QUEST_MAX_REWARD_ASH} Ash`, messageKey: 'g.err.rewardRange', messageVars: { min: QUEST_MIN_REWARD_ASH, max: QUEST_MAX_REWARD_ASH } });
      return;
    }

    const totalCost = questTotalCostAsh(slotsTotal, rewardAsh);
    if (player.ash < totalCost) {
      safeSend(player.ws, { type: 'error', message: `Not enough Ash — this quest costs ${totalCost} Ash`, messageKey: 'g.err.questCost', messageVars: { amount: totalCost } });
      return;
    }

    player.ash -= totalCost;
    player.economyChangedAt = Date.now();
    persistPlayer(player);
    safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });

    const result = await callInternalApi('/api/internal/game/faction/quest/create', {
      userId: player.userId, gameId: player.gameId, wallet: player.wallet,
      factionId: data.factionId, targetUrl, slotsTotal, rewardAsh,
    }).catch((err) => {
      console.error('[FactionQuest] create error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      player.ash += totalCost;
      player.economyChangedAt = Date.now();
      persistPlayer(player);
      const message = result?.error === 'not_verified_creator'
        ? 'Only the verified token creator can publish faction quests'
        : result?.error === 'invalid_post_url'
          ? 'The quest link must be a post on https://x.com/'
          : 'Could not publish that quest right now';
      const messageKey = result?.error === 'not_verified_creator'
        ? 'g.err.quest.notVerifiedCreator'
        : result?.error === 'invalid_post_url'
          ? 'g.err.questLinkMustBeX'
          : 'g.err.quest.publishFailed';
      safeSend(player.ws, { type: 'error', message, messageKey });
      safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });
      return;
    }

    persistPlayer(player);
    safeSend(player.ws, { type: 'factionQuestCreated', quest: result.quest, chargedAsh: totalCost });
  }

  async function handleFactionQuestListRequest(player) {
    const result = await cachedInternalCall(
      `factionQuests:${player.gameId}:${player.userId}`,
      5000,
      () => callInternalApi('/api/internal/game/faction/quest/list', {
        gameId: player.gameId, viewerUserId: player.userId, limit: 50,
      })
    ).catch((err) => {
      console.error('[FactionQuest] list error:', err.message);
      return null;
    });

    safeSend(player.ws, { type: 'factionQuestListResult', quests: result?.quests || [] });
  }

  async function handleFactionQuestManageListRequest(player, data) {
    if (typeof data.factionId !== 'string' || !player.factions?.some((f) => f.id === data.factionId)) return;

    const result = await callInternalApi('/api/internal/game/faction/quest/faction-list', {
      gameId: player.gameId, factionId: data.factionId, userId: player.userId,
    }).catch((err) => {
      console.error('[FactionQuest] faction-list error:', err.message);
      return null;
    });

    safeSend(player.ws, {
      type: 'factionQuestManageListResult',
      factionId: data.factionId,
      canManage: !!result?.canManage,
      questTypes: FACTION_QUEST_TYPES,
      listingFeeAsh: QUEST_LISTING_FEE_ASH,
      quests: result?.quests || [],
    });
  }

  async function handleFactionQuestClaim(player, data) {
    if (typeof data.questId !== 'string' || !data.questId) return;

    const result = await callInternalApi('/api/internal/game/faction/quest/claim', {
      questId: data.questId, userId: player.userId, gameId: player.gameId, wallet: player.wallet,
    }).catch((err) => {
      console.error('[FactionQuest] claim error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      const message = result?.error === 'already_completed'
        ? 'You already claimed this quest'
        : result?.error === 'quest_full'
          ? 'All reward slots for this quest are taken'
          : result?.error === 'own_quest'
            ? "You can't claim your own faction's quest"
            : 'Could not claim that quest right now';
      const messageKey = result?.error === 'already_claimed'
        ? 'g.err.quest.alreadyClaimed'
        : result?.error === 'quest_full'
          ? 'g.err.quest.full'
          : result?.error === 'own_quest'
            ? 'g.err.quest.ownQuest'
            : 'g.err.quest.claimFailed';
      safeSend(player.ws, { type: 'error', message, messageKey });
      return;
    }

    player.ash += result.rewardAsh;
    player.economyChangedAt = Date.now();
    grantXp(player, progression.XP_SOURCES.factionTaskXp, 'faction_quest');
    bumpFactionTaskProgress(player, 'ash', result.rewardAsh).catch((err) => console.error('[FactionTask] bump error:', err.message));
    persistPlayer(player);

    safeSend(player.ws, {
      type: 'factionQuestClaimed',
      questId: result.questId,
      rewardAsh: result.rewardAsh,
      slotsClaimed: result.slotsClaimed,
      slotsTotal: result.slotsTotal,
      status: result.status,
    });
    safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });
  }

  function sendTournamentList(player, tournaments) {
    safeSend(player.ws, { type: 'tournamentListResult', tournaments: tournaments || [] });
  }

  // Cached per viewer, because the board polls this on a timer while the player
  // stands in the hall and each entry carries that player's own join/vote state.
  async function handleTournamentListRequest(player) {
    const result = await cachedInternalCall(
      `tournaments:${player.gameId}:${player.userId}`,
      5000,
      () => callInternalApi('/api/internal/game/tournaments/list', {
        gameId: player.gameId, viewerUserId: player.userId,
      })
    ).catch((err) => {
      console.error('[Tournament] list error:', err.message);
      return null;
    });

    sendTournamentList(player, result?.tournaments);
  }

  async function handleTournamentEntriesRequest(player, data) {
    if (!tournamentRules.isUuid(data.tournamentId)) return;

    const result = await cachedInternalCall(
      `tournamentEntries:${data.tournamentId}:${player.userId}`,
      4000,
      () => callInternalApi('/api/internal/game/tournaments/entries', {
        tournamentId: data.tournamentId, viewerUserId: player.userId,
      })
    ).catch((err) => {
      console.error('[Tournament] entries error:', err.message);
      return null;
    });

    safeSend(player.ws, {
      type: 'tournamentEntriesResult',
      tournamentId: data.tournamentId,
      kind: result?.kind || null,
      entries: result?.entries || [],
    });
  }

  function dropTournamentCache(player, tournamentId) {
    internalCache.delete(`tournaments:${player.gameId}:${player.userId}`);
    internalCache.forEach((_entry, key) => {
      if (key.startsWith(`tournamentEntries:${tournamentId}:`)) internalCache.delete(key);
    });
  }

  async function handleTournamentAction(player, data) {
    if (!tournamentRules.isTournamentAction(data.action)) return;
    if (!tournamentRules.isUuid(data.tournamentId)) return;

    // Cheap client-side-shaped checks first, so an obviously malformed payload
    // never costs an internal round trip. The Next route validates again.
    if (data.action === 'submitSkin' && !tournamentRules.isTournamentKind(data.kind)) return;
    if (data.action === 'like' && !tournamentRules.isUuid(data.entryId)) return;
    if (data.action === 'setPost') {
      const clearing = typeof data.postUrl === 'string' && data.postUrl.trim().length === 0;
      if (!clearing && !tournamentRules.isValidXPostUrl(data.postUrl)) {
        safeSend(player.ws, {
          type: 'error',
          message: 'That is not a valid X post link',
          messageKey: 'g.err.tournament.invalidUrl',
        });
        return;
      }
    }
    if (data.action === 'submitShot' && (typeof data.shotUrl !== 'string' || data.shotUrl.length > tournamentRules.MAX_URL_LENGTH)) {
      return;
    }

    const result = await callInternalApi('/api/internal/game/tournaments/action', {
      action: data.action,
      gameId: player.gameId,
      userId: player.userId,
      tournamentId: data.tournamentId,
      kind: data.kind,
      entryId: data.entryId,
      postUrl: data.postUrl,
      shotUrl: data.shotUrl,
    }).catch((err) => {
      console.error('[Tournament] action error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      safeSend(player.ws, {
        type: 'error',
        message: 'That tournament action could not be completed',
        messageKey: tournamentRules.tournamentErrorKey(result?.error),
      });
      return;
    }

    dropTournamentCache(player, data.tournamentId);

    safeSend(player.ws, {
      type: 'tournamentActionResult',
      action: data.action,
      tournamentId: data.tournamentId,
      result: result.result || null,
    });
    sendTournamentList(player, result.tournaments);
  }

  function friendErrorKey(code) {
    switch (code) {
      case 'user_not_found': return 'g.err.friend.userNotFound';
      case 'cannot_friend_self': return 'g.err.friend.self';
      case 'already_friends': return 'g.err.friend.already';
      case 'request_already_sent': return 'g.err.friend.requestSent';
      case 'request_not_found': return 'g.err.friend.requestGone';
      default: return 'g.err.friend.failed';
    }
  }

  function friendErrorMessage(code) {
    switch (code) {
      case 'user_not_found': return 'No player found with that wallet or nickname';
      case 'cannot_friend_self': return "You can't friend yourself";
      case 'already_friends': return 'You are already friends';
      case 'request_already_sent': return 'Friend request already sent';
      case 'request_not_found': return 'That friend request no longer exists';
      default: return 'Friend action failed';
    }
  }

  async function handleFriendRequestSend(player, data) {
    const targetWallet = typeof data.wallet === 'string' && data.wallet.trim() ? data.wallet.trim() : null;
    const targetNickname = typeof data.nickname === 'string' && data.nickname.trim() ? data.nickname.trim() : null;
    if (!targetWallet && !targetNickname) return;

    if (targetWallet) {
      const targetPlayer = walletToPlayer.get(targetWallet);
      if (targetPlayer && targetPlayer.authenticated && targetPlayer.blockedUserIds?.has(player.userId)) {
        safeSend(player.ws, { type: 'error', message: 'This player is not accepting friend requests', messageKey: 'g.err.friendRequestsClosed' });
        return;
      }
    }

    const result = await callInternalApi('/api/internal/game/friends/request', {
      userId: player.userId, gameId: player.gameId, targetWallet, targetNickname,
    }).catch((err) => {
      console.error('[Friends] request error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      safeSend(player.ws, { type: 'error', message: friendErrorMessage(result?.error), messageKey: friendErrorKey(result?.error) });
      return;
    }

    safeSend(player.ws, { type: 'friendRequestSent', friend: result.friend, status: result.status });

    if (result.status !== 'accepted') {
      const targetPlayer = userIdToPlayer.get(result.friend.userId);
      if (targetPlayer && targetPlayer.authenticated) {
        safeSend(targetPlayer.ws, {
          type: 'friendRequestReceived',
          friend: { userId: player.userId, wallet: player.wallet, nickname: player.nickname },
        });
      }
    }
  }

  async function handleBlockUser(player, data) {
    const targetWallet = typeof data.wallet === 'string' && data.wallet.trim() ? data.wallet.trim() : null;
    const targetNickname = typeof data.nickname === 'string' && data.nickname.trim() ? data.nickname.trim() : null;
    if (!targetWallet && !targetNickname) return;

    const result = await callInternalApi('/api/internal/game/blocks/add', {
      blockerUserId: player.userId, gameId: player.gameId, targetWallet, targetNickname,
    }).catch((err) => {
      console.error('[Blocks] add error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      safeSend(player.ws, { type: 'error', message: 'Could not block player', messageKey: 'g.err.blockFailed' });
      return;
    }

    player.blockedUserIds.add(result.blockedUserId);

    safeSend(player.ws, {
      type: 'userBlocked',
      userId: result.blockedUserId,
      wallet: result.blockedWallet,
      nickname: result.blockedNickname,
    });
  }

  async function handleUnblockUser(player, data) {
    if (typeof data.blockedUserId !== 'string' || !data.blockedUserId) return;

    await callInternalApi('/api/internal/game/blocks/remove', {
      blockerUserId: player.userId, blockedUserId: data.blockedUserId,
    }).catch((err) => console.error('[Blocks] remove error:', err.message));

    player.blockedUserIds.delete(data.blockedUserId);

    safeSend(player.ws, { type: 'userUnblocked', blockedUserId: data.blockedUserId });
  }

  async function handleBlockedListRequest(player) {
    const result = await callInternalApi('/api/internal/game/blocks/list', {
      userId: player.userId, gameId: player.gameId,
    }).catch((err) => {
      console.error('[Blocks] list error:', err.message);
      return null;
    });

    safeSend(player.ws, { type: 'blockedListResult', blocked: result?.blocked || [] });
  }

  async function handleFriendRequestAccept(player, data) {
    if (typeof data.requestUserId !== 'string' || !data.requestUserId) return;

    const result = await callInternalApi('/api/internal/game/friends/accept', {
      userId: player.userId, gameId: player.gameId, requestUserId: data.requestUserId,
    }).catch((err) => {
      console.error('[Friends] accept error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      safeSend(player.ws, { type: 'error', message: friendErrorMessage(result?.error), messageKey: friendErrorKey(result?.error) });
      return;
    }

    safeSend(player.ws, { type: 'friendRequestAccepted', friend: result.friend });
  }

  async function handleFriendRequestDecline(player, data) {
    if (typeof data.requestUserId !== 'string' || !data.requestUserId) return;

    await callInternalApi('/api/internal/game/friends/decline', {
      userId: player.userId, requestUserId: data.requestUserId,
    }).catch((err) => console.error('[Friends] decline error:', err.message));

    safeSend(player.ws, { type: 'friendRequestDeclined', requestUserId: data.requestUserId });
  }

  async function handleFriendRemove(player, data) {
    if (typeof data.friendUserId !== 'string' || !data.friendUserId) return;

    await callInternalApi('/api/internal/game/friends/remove', {
      userId: player.userId, friendUserId: data.friendUserId,
    }).catch((err) => console.error('[Friends] remove error:', err.message));

    safeSend(player.ws, { type: 'friendRemoved', friendUserId: data.friendUserId });
  }

  async function handleFriendsListRequest(player) {
    const result = await callInternalApi('/api/internal/game/friends/list', {
      userId: player.userId, gameId: player.gameId,
    }).catch((err) => {
      console.error('[Friends] list error:', err.message);
      return null;
    });

    const withPresence = (list) => (list || []).map((f) => ({ ...f, online: userIdToPlayer.has(f.userId) }));

    safeSend(player.ws, {
      type: 'friendsListResult',
      friends: withPresence(result?.friends),
      incoming: result?.incoming || [],
      outgoing: result?.outgoing || [],
    });
  }

  async function handleFriendSearch(player, data) {
    const query = typeof data.query === 'string' ? data.query.trim() : '';
    if (!query) {
      safeSend(player.ws, { type: 'friendSearchResult', results: [] });
      return;
    }

    const result = await callInternalApi('/api/internal/game/friends/search', {
      gameId: player.gameId, userId: player.userId, query,
    }).catch((err) => {
      console.error('[Friends] search error:', err.message);
      return null;
    });

    safeSend(player.ws, { type: 'friendSearchResult', results: result?.results || [] });
  }

  function mailErrorKey(code) {
    switch (code) {
      case 'recipient_not_found': return 'g.err.mail.recipientNotFound';
      case 'cannot_mail_self': return 'g.err.mail.self';
      case 'invalid_message': return 'g.err.mail.invalidMessage';
      default: return 'g.err.mail.failed';
    }
  }

  function mailErrorMessage(code) {
    switch (code) {
      case 'recipient_not_found': return 'No player found with that wallet or nickname';
      case 'cannot_mail_self': return "You can't mail yourself";
      case 'invalid_message': return 'Subject and message cannot be empty';
      default: return 'Could not send mail';
    }
  }

  async function handleMailSend(player, data) {
    const recipientWallet = typeof data.wallet === 'string' && data.wallet.trim() ? data.wallet.trim() : null;
    const recipientNickname = typeof data.nickname === 'string' && data.nickname.trim() ? data.nickname.trim() : null;
    if (!recipientWallet && !recipientNickname) return;
    if (typeof data.subject !== 'string' || typeof data.body !== 'string') return;

    const result = await callInternalApi('/api/internal/game/mail/send', {
      userId: player.userId, gameId: player.gameId, wallet: player.wallet,
      recipientWallet, recipientNickname, subject: data.subject.slice(0, 100), body: data.body.slice(0, 2000),
    }).catch((err) => {
      console.error('[Mail] send error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      safeSend(player.ws, { type: 'error', message: mailErrorMessage(result?.error), messageKey: mailErrorKey(result?.error) });
      return;
    }

    safeSend(player.ws, { type: 'mailSent', mailId: result.mailId });

    const recipientPlayer = result.recipientUserId ? userIdToPlayer.get(result.recipientUserId) : null;
    if (recipientPlayer && recipientPlayer.authenticated) {
      safeSend(recipientPlayer.ws, {
        type: 'mailReceived',
        mailId: result.mailId,
        senderNickname: player.nickname,
        subject: data.subject,
      });
    }
  }

  async function handlePrivateMessage(player, data) {
    if (isMuted(player)) {
      safeSend(player.ws, { type: 'error', message: `You are muted until ${new Date(player.mutedUntil).toLocaleString()}`, messageKey: 'g.err.mutedUntil', messageVars: { until: new Date(player.mutedUntil).toLocaleString() } });
      return;
    }

    const toWallet = typeof data.toWallet === 'string' && data.toWallet.trim() ? data.toWallet.trim() : null;
    if (!toWallet) return;

    const text = typeof data.text === 'string' ? sanitizeMessage(data.text.trim().slice(0, 500)) : '';
    if (text.length === 0) return;

    if (containsLink(text)) {
      safeSend(player.ws, { type: 'error', message: 'Links are not allowed in chat', messageKey: 'g.err.noLinksInChat' });
      return;
    }

    const targetPlayer = walletToPlayer.get(toWallet);
    if (!targetPlayer || !targetPlayer.authenticated) {
      safeSend(player.ws, { type: 'privateMessageError', code: 'offline', toWallet });
      return;
    }

    if (targetPlayer.blockedUserIds?.has(player.userId)) {
      safeSend(player.ws, { type: 'privateMessageError', code: 'blocked', toWallet });
      return;
    }

    const timestamp = Date.now();

    safeSend(targetPlayer.ws, {
      type: 'privateMessage',
      fromWallet: player.wallet,
      fromNickname: player.nickname,
      text,
      timestamp,
    });

    safeSend(player.ws, {
      type: 'privateMessageSent',
      toWallet,
      toNickname: targetPlayer.nickname,
      text,
      timestamp,
    });
  }

  function tradePaymentErrorKey(code) {
    switch (code) {
      case 'transaction_not_found': return 'g.err.pay.notFound';
      case 'transaction_failed': return 'g.err.pay.failed';
      case 'transfer_verification_failed': return 'g.err.pay.verifyFailed';
      case 'wrong_signer': return 'g.err.pay.wrongSigner';
      case 'signature_already_used': return 'g.err.pay.signatureUsed';
      default: return 'g.err.pay.generic';
    }
  }

  function tradePaymentErrorMessage(code) {
    switch (code) {
      case 'transaction_not_found': return 'Payment not found on-chain yet — wait a few seconds and try again';
      case 'transaction_failed': return 'The transaction failed on-chain';
      case 'transfer_verification_failed': return 'Could not verify the payment amount or recipient';
      case 'wrong_signer': return 'Payment must be sent from your registered wallet';
      case 'signature_already_used': return 'This transaction was already used elsewhere';
      default: return 'Payment verification failed — please try again';
    }
  }

  function handleTradeInvite(player, data) {
    const toWallet = typeof data.toWallet === 'string' && data.toWallet.trim() ? data.toWallet.trim() : null;
    if (!toWallet) return;

    if (toWallet === player.wallet) {
      safeSend(player.ws, { type: 'tradeInviteError', code: 'self', toWallet });
      return;
    }
    if (player.activeTradeId) {
      safeSend(player.ws, { type: 'tradeInviteError', code: 'already_active', toWallet });
      return;
    }

    const target = walletToPlayer.get(toWallet);
    if (!target || !target.authenticated) {
      safeSend(player.ws, { type: 'tradeInviteError', code: 'offline', toWallet });
      return;
    }
    if (target.activeTradeId) {
      safeSend(player.ws, { type: 'tradeInviteError', code: 'target_busy', toWallet });
      return;
    }
    if (target.blockedUserIds?.has(player.userId) || player.blockedUserIds?.has(target.userId)) {
      safeSend(player.ws, { type: 'tradeInviteError', code: 'blocked', toWallet });
      return;
    }

    const tradeId = generateId();
    const session = {
      id: tradeId,
      gameId: player.gameId,
      phase: 'pending_accept',
      inviterUserId: player.userId,
      participants: {
        [player.userId]: { userId: player.userId, wallet: player.wallet, nickname: player.nickname, ready: false },
        [target.userId]: { userId: target.userId, wallet: target.wallet, nickname: target.nickname, ready: false },
      },
      sellerId: null,
      itemId: null,
      itemKind: 'placeable',
      itemName: null,
      priceTnj: null,
      escrowed: false,
      createdAt: Date.now(),
      awaitingPaymentSince: null,
      settlingSince: null,
    };
    activeTrades.set(tradeId, session);
    player.activeTradeId = tradeId;

    safeSend(player.ws, { type: 'tradeSession', ...buildTradeSnapshot(session) });
    safeSend(target.ws, { type: 'tradeInviteReceived', tradeId, fromWallet: player.wallet, fromNickname: player.nickname });
  }

  function handleTradeInviteRespond(player, data) {
    const tradeId = typeof data.tradeId === 'string' ? data.tradeId : null;
    const session = tradeId ? activeTrades.get(tradeId) : null;
    if (!session || session.phase !== 'pending_accept') return;
    if (!session.participants[player.userId] || player.userId === session.inviterUserId) return;

    if (!data.accept) {
      endTrade(session, 'declined');
      return;
    }

    if (player.activeTradeId) {
      endTrade(session, 'cancelled');
      return;
    }
    const inviter = userIdToPlayer.get(session.inviterUserId);
    if (!inviter || !inviter.authenticated || inviter.activeTradeId !== tradeId) {
      endTrade(session, 'cancelled');
      return;
    }

    session.phase = 'negotiating';
    player.activeTradeId = tradeId;
    broadcastTradeState(session);
  }

  function handleTradeSetOffer(player, data) {
    const tradeId = typeof data.tradeId === 'string' ? data.tradeId : null;
    const session = tradeId ? activeTrades.get(tradeId) : null;
    if (!session || session.phase !== 'negotiating' || !session.participants[player.userId]) return;

    const itemId = typeof data.itemId === 'string' && data.itemId ? data.itemId : null;

    if (!itemId) {
      if (session.sellerId && session.sellerId !== player.userId) return;
      session.sellerId = null;
      session.itemId = null;
      session.itemKind = 'placeable';
      session.itemName = null;
      session.priceTnj = null;
    } else {
      if (session.sellerId && session.sellerId !== player.userId) {
        safeSend(player.ws, { type: 'error', message: 'A seller is already set for this trade', messageKey: 'g.err.sellerAlreadySet' });
        return;
      }
      const companionStack = (player.companions?.owned || []).find((stack) => stack.itemId === itemId);
      const item = companionStack ? null : SHOP_ITEMS[itemId];

      if (!companionStack) {
        if (!item || !item.tradeable) {
          safeSend(player.ws, { type: 'error', message: 'This item cannot be traded', messageKey: 'g.err.itemNotTradeable' });
          return;
        }
        if (!(player.placeables[itemId] > 0)) {
          safeSend(player.ws, { type: 'error', message: "You don't own that item", messageKey: 'g.err.dontOwnItem' });
          return;
        }
      } else if (!(companionStack.quantity > 0)) {
        safeSend(player.ws, { type: 'error', message: "You don't own that item", messageKey: 'g.err.dontOwnItem' });
        return;
      }
      const priceTnj = Number.isInteger(data.priceTnj) ? data.priceTnj : null;
      if (!priceTnj || priceTnj <= 0 || priceTnj > 1_000_000_000) {
        safeSend(player.ws, { type: 'error', message: 'Invalid price', messageKey: 'g.err.invalidPrice' });
        return;
      }
      session.sellerId = player.userId;
      session.itemId = itemId;
      session.itemKind = companionStack ? 'companion' : 'placeable';
      session.itemName = companionStack ? `g.pet.${itemId}.name` : item.name;
      session.priceTnj = priceTnj;
    }

    for (const p of Object.values(session.participants)) p.ready = false;
    broadcastTradeState(session);
  }

  async function handleTradeSetReady(player, data) {
    const tradeId = typeof data.tradeId === 'string' ? data.tradeId : null;
    const session = tradeId ? activeTrades.get(tradeId) : null;
    if (!session || session.phase !== 'negotiating' || !session.participants[player.userId]) return;

    const ready = !!data.ready;
    if (ready && (!session.sellerId || !session.itemId || !session.priceTnj)) {
      safeSend(player.ws, { type: 'error', message: 'Set an item and price before readying up', messageKey: 'g.err.setItemAndPrice' });
      return;
    }

    session.participants[player.userId].ready = ready;

    const allReady = Object.values(session.participants).every((p) => p.ready);
    if (allReady && session.sellerId) {
      if (!(await holdTradeEscrow(session))) {
        for (const p of Object.values(session.participants)) p.ready = false;
        sendToTradeParticipants(session, { type: 'error', message: 'Seller no longer has this item', messageKey: 'g.err.sellerLostItem' });
        broadcastTradeState(session);
        return;
      }
      session.phase = 'awaiting_payment';
      session.awaitingPaymentSince = Date.now();
    }

    broadcastTradeState(session);
  }

  function handleTradeCancel(player, data) {
    const tradeId = typeof data.tradeId === 'string' ? data.tradeId : null;
    const session = tradeId ? activeTrades.get(tradeId) : null;
    if (!session || !session.participants[player.userId]) return;
    if (session.phase === 'settling') return;
    endTrade(session, 'cancelled');
  }

  async function handleTradeSubmitPayment(player, data) {
    const tradeId = typeof data.tradeId === 'string' ? data.tradeId : null;
    const signature = typeof data.signature === 'string' && data.signature.trim() ? data.signature.trim() : null;
    const session = tradeId ? activeTrades.get(tradeId) : null;
    if (!session || !signature) return;
    if (session.phase !== 'awaiting_payment') return;
    if (!session.participants[player.userId] || player.userId === session.sellerId) return;

    const sellerEntry = session.participants[session.sellerId];
    if (!session.escrowed) {
      sendToTradeParticipants(session, { type: 'error', message: 'Seller no longer has this item', messageKey: 'g.err.sellerLostItem' });
      endTrade(session, 'cancelled');
      return;
    }

    session.phase = 'settling';
    session.settlingSince = Date.now();
    broadcastTradeState(session);

    const result = await callInternalApi('/api/internal/game/trade/settle', {
      tradeId: session.id,
      gameId: session.gameId,
      signature,
      sellerId: session.sellerId,
      sellerWallet: sellerEntry.wallet,
      buyerId: player.userId,
      buyerWallet: player.wallet,
      itemId: session.itemId,
      itemName: session.itemName,
      quantity: 1,
      priceTnj: session.priceTnj,
    }).catch((err) => {
      console.error('[Trade] settle call error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      const errorCode = result?.error || 'internal_error';
      if (errorCode === 'settlement_record_failed') {
        console.error('[Trade] CRITICAL: payment verified on-chain but not recorded:', {
          tradeId: session.id, signature, sellerWallet: sellerEntry.wallet, buyerWallet: player.wallet,
        });
        endTrade(session, 'failed', { reason: errorCode, critical: true });
        return;
      }
      session.phase = 'awaiting_payment';
      sendToTradeParticipants(session, { type: 'error', message: tradePaymentErrorMessage(errorCode), messageKey: tradePaymentErrorKey(errorCode) });
      broadcastTradeState(session);
      return;
    }

    session.escrowed = false;

    if (session.itemKind === 'companion') {
      const delivered = await companionEscrowCall(session, 'deliver', player.userId);
      if (!delivered) {
        console.error('[Trade] CRITICAL: payment settled but companion not delivered:', {
          tradeId: session.id, buyerId: player.userId, itemId: session.itemId,
        });
        endTrade(session, 'failed', { reason: 'delivery_failed', critical: true });
        return;
      }
      sendCompanionState(player);
    } else {
      player.placeables[session.itemId] = (player.placeables[session.itemId] || 0) + 1;
      player.economyChangedAt = Date.now();
      persistPlayer(player);
      safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });
    }

    endTrade(session, 'completed');
  }

  async function handleTokenInfoRequest(player, data) {
    const ca = typeof data.ca === 'string' && data.ca.trim() ? data.ca.trim() : null;
    if (!ca) return;

    const result = await callInternalApi('/api/internal/game/token-lookup-mail', {
      userId: player.userId, ca,
    }).catch((err) => {
      console.error('[TokenLookup] error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      safeSend(player.ws, { type: 'error', message: 'Could not look up token', messageKey: 'g.err.tokenLookupFailed' });
      return;
    }

    safeSend(player.ws, { type: 'tokenInfoSent', mailId: result.mailId });
  }

  async function handleSupportTicketSend(player, data) {
    const subject = typeof data.subject === 'string' ? data.subject.trim().slice(0, 100) : '';
    const message = typeof data.message === 'string' ? data.message.trim().slice(0, 2000) : '';
    if (subject.length === 0 || message.length === 0) return;

    const result = await callInternalApi('/api/internal/game/support/send', {
      userId: player.userId, gameId: player.gameId, wallet: player.wallet, subject, message,
    }).catch((err) => {
      console.error('[Support] send error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      safeSend(player.ws, { type: 'error', message: 'Could not send message to support', messageKey: 'g.err.supportSendFailed' });
      return;
    }

    safeSend(player.ws, { type: 'supportTicketSent', ticketId: result.ticketId });
  }

  async function handleMailInboxRequest(player) {
    const result = await callInternalApi('/api/internal/game/mail/inbox', {
      userId: player.userId, gameId: player.gameId,
    }).catch((err) => {
      console.error('[Mail] inbox error:', err.message);
      return null;
    });

    safeSend(player.ws, {
      type: 'mailInboxResult',
      mail: result?.mail || [],
      unreadCount: result?.unreadCount || 0,
    });
  }

  async function handleMailMarkRead(player, data) {
    if (typeof data.mailId !== 'string' || !data.mailId) return;

    await callInternalApi('/api/internal/game/mail/mark-read', {
      userId: player.userId, mailId: data.mailId,
    }).catch((err) => console.error('[Mail] mark-read error:', err.message));

    safeSend(player.ws, { type: 'mailMarkedRead', mailId: data.mailId });
  }

  function getQuest(questId) {
    return Object.prototype.hasOwnProperty.call(QUESTS, questId) ? QUESTS[questId] : null;
  }

  function questAvailable(player, quest) {
    if (!quest.requiresQuest) return true;
    return getQuestState(player, quest.requiresQuest).status === 'completed';
  }

  function activeQuestForNpc(player, npc) {
    for (const quest of QUEST_LIST) {
      if (quest.npc !== npc) continue;
      if (!questAvailable(player, quest)) continue;
      if (getQuestState(player, quest.id).status === 'completed') continue;
      return quest;
    }
    return null;
  }

  function buildQuestInfoPayload(player, quest) {
    const state = getQuestState(player, quest.id);
    return {
      type: 'questInfo',
      questId: quest.id,
      npc: quest.npc,
      questType: quest.type,
      title: quest.title,
      description: quest.description,
      targetCount: quest.targetCount,
      rewardAsh: quest.rewardAsh,
      rewardXp: progression.questXp(quest.id),
      status: state.status,
      progress: state.progress,
      targets: quest.targets || null,
      visited: state.visited || [],
    };
  }

  function sendOfferedQuests(player) {
    const seen = new Set();

    for (const quest of QUEST_LIST) {
      if (seen.has(quest.npc)) continue;
      if (!questAvailable(player, quest)) continue;
      if (getQuestState(player, quest.id).status === 'completed') continue;

      seen.add(quest.npc);
      safeSend(player.ws, buildQuestInfoPayload(player, quest));
    }
  }

  function handleNpcVisit(player, data) {
    if (typeof data.npcId !== 'string') return;
    if (!ORIENTATION_TARGET_IDS.has(data.npcId)) return;

    for (const quest of QUEST_LIST) {
      if (quest.type !== 'visit_npcs') continue;

      const state = getQuestState(player, quest.id);
      if (state.status !== 'active') continue;

      const target = quest.targets.find((t) => t.id === data.npcId);
      if (!target) continue;
      if (target.locationId !== player.locationId) continue;

      const visited = Array.isArray(state.visited) ? state.visited : [];
      if (visited.includes(target.id)) continue;

      visited.push(target.id);
      state.visited = visited;
      state.progress = visited.length;
      if (state.progress >= quest.targetCount) state.status = 'ready_to_turn_in';
      player.quests[quest.id] = state;
      persistPlayer(player);

      safeSend(player.ws, {
        type: 'questUpdate',
        questId: quest.id,
        status: state.status,
        progress: state.progress,
        targetCount: quest.targetCount,
        visited: state.visited,
        visitedName: target.name,
      });
    }
  }

  function sendMetNpcs(player) {
    safeSend(player.ws, {
      type: 'npcMetState',
      metNpcs: Array.from(player.metNpcs || []),
    });
  }

  function handleNpcMet(player, data) {
    if (typeof data.npcId !== 'string') return;
    if (!MET_NPC_IDS.has(data.npcId)) return;
    if (player.metNpcs.has(data.npcId)) return;

    player.metNpcs.add(data.npcId);
    persistPlayer(player);
    sendMetNpcs(player);
  }

  function sendCosmeticState(player) {
    safeSend(player.ws, {
      type: 'cosmeticState',
      owned: Array.from(player.cosmeticsOwned || []),
      skinId: player.cosmeticSkinId || null,
      accessoryId: player.cosmeticAccessoryId || null,
    });
  }

  function broadcastCosmeticChange(player) {
    broadcastToLocation(player.locationId, {
      type: 'cosmeticUpdate',
      playerId: player.id,
      skinId: player.cosmeticSkinId || null,
      accessoryId: player.cosmeticAccessoryId || null,
    }, player.id);
  }

  async function refreshPlayerCosmetics(player) {
    const result = await callInternalApi('/api/internal/game/cosmetics/state', {
      userId: player.userId, gameId: player.gameId,
    }).catch((err) => {
      console.error('[Cosmetics] state error:', err.message);
      return null;
    });

    player.cosmeticsOwned = new Set(result?.owned || []);
    player.cosmeticSkinId = result?.skinId || null;
    player.cosmeticAccessoryId = result?.accessoryId || null;
  }

  async function handleCosmeticListRequest(player) {
    await refreshPlayerCosmetics(player);
    sendCosmeticState(player);
  }

  async function handleCosmeticBuy(player, data) {
    const slot = COSMETIC_SLOTS[data.itemId];
    if (!slot) return;

    if (!shopItemEnabled(data.itemId)) {
      safeSend(player.ws, { type: 'error', message: 'That item is not for sale right now', messageKey: 'g.err.itemNotForSale' });
      return;
    }

    const cosmeticPrice = shopPriceFor(data.itemId, COSMETIC_PRICE_ASH);
    if (cosmeticPrice === null) {
      safeSend(player.ws, { type: 'error', message: 'That one is sold for TNJ in the Shop', messageKey: 'g.err.tnjShopOnly' });
      return;
    }

    if (player.cosmeticsOwned?.has(data.itemId)) {
      safeSend(player.ws, { type: 'error', message: 'You already own that', messageKey: 'g.err.alreadyOwned' });
      return;
    }
    if (player.ash < cosmeticPrice) {
      safeSend(player.ws, { type: 'error', message: `Not enough Ash — this costs ${cosmeticPrice} Ash`, messageKey: 'g.err.cosmeticCost', messageVars: { amount: cosmeticPrice } });
      return;
    }

    player.ash -= cosmeticPrice;
    player.economyChangedAt = Date.now();
    persistPlayer(player);
    safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });

    const result = await callInternalApi('/api/internal/game/cosmetics/buy', {
      userId: player.userId, gameId: player.gameId, itemId: data.itemId,
    }).catch((err) => {
      console.error('[Cosmetics] buy error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      player.ash += cosmeticPrice;
      player.economyChangedAt = Date.now();
      persistPlayer(player);
      safeSend(player.ws, {
        type: 'error',
        message: result?.error === 'already_owned'
          ? 'You already own that'
          : result?.error === 'tnj_only' ? 'That one is sold for TNJ in the Shop' : 'Could not buy that right now',
        messageKey: result?.error === 'already_owned'
          ? 'g.err.alreadyOwned'
          : result?.error === 'tnj_only' ? 'g.err.tnjShopOnly' : 'g.err.buyFailed',
      });
      safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });
      return;
    }

    if (!player.cosmeticsOwned) player.cosmeticsOwned = new Set();
    player.cosmeticsOwned.add(data.itemId);
    sendCosmeticState(player);
  }

  async function handleCosmeticEquip(player, data) {
    const wantedSkin = COSMETIC_SLOTS[data.skinId] === 'skin' ? data.skinId : null;
    const wantedAccessory = COSMETIC_SLOTS[data.accessoryId] === 'accessory' ? data.accessoryId : null;

    if (wantedSkin && !player.cosmeticsOwned?.has(wantedSkin)) return;
    if (wantedAccessory && !player.cosmeticsOwned?.has(wantedAccessory)) return;

    const skinId = wantedSkin;
    const accessoryId = skinId ? null : wantedAccessory;

    const result = await callInternalApi('/api/internal/game/cosmetics/equip', {
      userId: player.userId, gameId: player.gameId, skinId, accessoryId,
    }).catch((err) => {
      console.error('[Cosmetics] equip error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      safeSend(player.ws, { type: 'error', message: 'Could not change your outfit right now', messageKey: 'g.err.outfitChangeFailed' });
      return;
    }

    player.cosmeticSkinId = result.skinId || null;
    player.cosmeticAccessoryId = result.accessoryId || null;

    sendCosmeticState(player);
    broadcastCosmeticChange(player);
  }

  function sendCompanionState(player) {
    const state = player.companions || { owned: [], equipped: null, fragments: 0, crates: 0 };
    safeSend(player.ws, {
      type: 'companionState',
      owned: state.owned,
      equipped: state.equipped,
      fragments: state.fragments,
      crates: state.crates,
    });
  }

  function applyCompanionState(player, result) {
    if (!result) return false;
    player.companionsChangedAt = Date.now();
    player.companions = {
      owned: Array.isArray(result.owned) ? result.owned : [],
      equipped: result.equipped || null,
      fragments: Math.max(0, Math.floor(Number(result.fragments) || 0)),
      crates: Math.max(0, Math.floor(Number(result.crates) || 0)),
    };
    return true;
  }

  async function refreshPlayerCompanions(player) {
    const result = await callInternalApi('/api/internal/game/companions/state', {
      userId: player.userId,
      gameId: player.gameId,
      legacyDogCount: player.placeables?.[PET_ITEM_ID] || 0,
    }).catch((err) => {
      console.error('[Companions] state error:', err.message);
      return null;
    });
    applyCompanionState(player, result);
  }

  function companionErrorKey(code) {
    if (code === 'no_duplicate') return 'g.err.companionNoDuplicate';
    if (code === 'not_enough_fragments') return 'g.err.notEnoughFragments';
    if (code === 'no_crate') return 'g.err.noCrate';
    if (code === 'not_owned') return 'g.err.companionNotOwned';
    return 'g.err.companionFailed';
  }

  function sendCompanionError(player, code) {
    safeSend(player.ws, {
      type: 'error',
      message: 'That companion action could not be completed',
      messageKey: companionErrorKey(code),
    });
  }

  async function handleCompanionListRequest(player) {
    await refreshPlayerCompanions(player);
    sendCompanionState(player);
  }

  async function handleCompanionEquip(player, data) {
    const companionId = typeof data.companionId === 'string' && data.companionId ? data.companionId : null;
    const result = await callInternalApi('/api/internal/game/companions/equip', {
      userId: player.userId, gameId: player.gameId, companionId,
    }).catch((err) => {
      console.error('[Companions] equip error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      sendCompanionError(player, result?.error);
      return;
    }

    applyCompanionState(player, result);
    sendCompanionState(player);
    broadcastToLocation(player.locationId, {
      type: 'playerCompanion',
      playerId: player.id,
      companionId: player.companions?.equipped || null,
    }, player.id);
  }

  async function handleCompanionDust(player, data) {
    const itemId = typeof data.itemId === 'string' ? data.itemId : null;
    if (!itemId) return;

    const result = await callInternalApi('/api/internal/game/companions/dust', {
      userId: player.userId, gameId: player.gameId, itemId,
    }).catch((err) => {
      console.error('[Companions] dust error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      sendCompanionError(player, result?.error);
      return;
    }

    applyCompanionState(player, result);
    safeSend(player.ws, { type: 'companionDusted', itemId, gained: Math.max(0, Math.floor(Number(result.gained) || 0)) });
    sendCompanionState(player);
  }

  async function handleCompanionCombine(player) {
    const result = await callInternalApi('/api/internal/game/companions/combine', {
      userId: player.userId, gameId: player.gameId,
    }).catch((err) => {
      console.error('[Companions] combine error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      sendCompanionError(player, result?.error);
      return;
    }

    applyCompanionState(player, result);
    sendCompanionState(player);
  }

  async function handleCrateOpen(player) {
    const result = await callInternalApi('/api/internal/game/companions/crate-open', {
      userId: player.userId, gameId: player.gameId,
    }).catch((err) => {
      console.error('[Companions] crate open error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      sendCompanionError(player, result?.error);
      return;
    }

    applyCompanionState(player, result);
    safeSend(player.ws, { type: 'crateOpened', itemId: result.itemId, rarity: result.rarity });
    sendCompanionState(player);
  }

  function sendCosmeticCrateState(player) {
    const state = player.cosmeticCrates || { fragments: 0, crates: 0 };
    safeSend(player.ws, {
      type: 'cosmeticCrateState',
      fragments: state.fragments,
      crates: state.crates,
    });
  }

  function applyCosmeticCrateState(player, result) {
    if (!result) return false;
    player.cosmeticCrates = {
      fragments: Math.max(0, Math.floor(Number(result.fragments) || 0)),
      crates: Math.max(0, Math.floor(Number(result.crates) || 0)),
    };
    return true;
  }

  function sendCosmeticCrateError(player, error) {
    safeSend(player.ws, {
      type: 'error',
      message: 'That did not work',
      messageKey: `g.err.cosmeticCrate.${error || 'failed'}`,
    });
  }

  async function refreshPlayerCosmeticCrates(player) {
    const result = await callInternalApi('/api/internal/game/cosmetic-crates/state', {
      userId: player.userId, gameId: player.gameId,
    }).catch((err) => {
      console.error('[CosmeticCrates] state error:', err.message);
      return null;
    });

    applyCosmeticCrateState(player, result);
  }

  async function handleCosmeticCrateRequest(player) {
    await refreshPlayerCosmeticCrates(player);
    sendCosmeticCrateState(player);
  }

  async function handleCosmeticCombine(player) {
    const result = await callInternalApi('/api/internal/game/cosmetic-crates/combine', {
      userId: player.userId, gameId: player.gameId,
    }).catch((err) => {
      console.error('[CosmeticCrates] combine error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      sendCosmeticCrateError(player, result?.error);
      return;
    }

    applyCosmeticCrateState(player, result);
    sendCosmeticCrateState(player);
  }

  async function handleCosmeticCrateOpen(player) {
    const result = await callInternalApi('/api/internal/game/cosmetic-crates/crate-open', {
      userId: player.userId, gameId: player.gameId,
    }).catch((err) => {
      console.error('[CosmeticCrates] crate open error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      sendCosmeticCrateError(player, result?.error);
      return;
    }

    applyCosmeticCrateState(player, result);
    await refreshPlayerCosmetics(player);
    safeSend(player.ws, { type: 'cosmeticCrateOpened', itemId: result.itemId, rarity: result.rarity });
    sendCosmeticCrateState(player);
    sendCosmeticState(player);
  }

  function handleEmote(player, data) {
    if (!player.alive) return;
    if (!EMOTE_KEYS.includes(data.key)) return;

    broadcastToLocation(player.locationId, {
      type: 'emote',
      playerId: player.id,
      key: data.key,
    }, player.id);
  }

  function handleQuestInteract(player, data) {
    const quest = typeof data.npc === 'string'
      ? activeQuestForNpc(player, data.npc)
      : (typeof data.questId === 'string' ? getQuest(data.questId) : null);

    if (!quest) {
      if (typeof data.npc === 'string') {
        safeSend(player.ws, { type: 'questInfo', npc: data.npc, questId: null, status: 'none' });
      }
      return;
    }

    safeSend(player.ws, buildQuestInfoPayload(player, quest));
  }

  function handleQuestAccept(player, data) {
    if (typeof data.questId !== 'string') return;
    const quest = getQuest(data.questId);
    if (!quest) return;

    const state = getQuestState(player, quest.id);
    if (state.status !== 'not_started') return;
    if (!questAvailable(player, quest)) return;

    player.quests[quest.id] = { status: 'active', progress: 0, visited: [] };
    persistPlayer(player);

    safeSend(player.ws, {
      type: 'questUpdate',
      questId: quest.id,
      status: 'active',
      progress: 0,
      targetCount: quest.targetCount,
    });
  }

  function handleQuestTurnIn(player, data) {
    if (typeof data.questId !== 'string') return;
    const quest = getQuest(data.questId);
    if (!quest) return;

    const state = getQuestState(player, quest.id);
    if (state.status !== 'ready_to_turn_in') return;

    player.quests[quest.id] = {
      status: 'completed',
      progress: quest.targetCount,
      visited: state.visited || [],
    };
    player.ash += quest.rewardAsh;
    player.economyChangedAt = Date.now();
    const rewardXp = grantXp(player, progression.questXp(quest.id), `quest:${quest.id}`);
    bumpFactionTaskProgress(player, 'ash', quest.rewardAsh).catch((err) => console.error('[FactionTask] bump error:', err.message));
    persistPlayer(player);

    safeSend(player.ws, {
      type: 'questUpdate',
      questId: quest.id,
      status: 'completed',
      progress: quest.targetCount,
      targetCount: quest.targetCount,
      rewardAsh: quest.rewardAsh,
      rewardXp,
    });
    safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });

    const nextQuest = activeQuestForNpc(player, quest.npc);
    if (nextQuest) safeSend(player.ws, buildQuestInfoPayload(player, nextQuest));
  }

  function handleBranchSelect(player, data) {
    if (!progression.isBranchId(data.branch)) return;

    const state = player.progression;
    if (state.branch !== null) {
      safeSend(player.ws, { type: 'error', message: 'Specialisation already chosen — respec with Sola to switch', messageKey: 'g.err.specAlreadyChosen' });
      return;
    }
    if (state.level < BRANCH_UNLOCK_LEVEL) {
      safeSend(player.ws, { type: 'error', message: "Finish Sola's orientation first", messageKey: 'g.err.finishOrientation' });
      return;
    }

    state.branch = data.branch;
    state.fireMode = 'single';
    refreshCombatStats(player);
    resetPlayerAbilities(player);
    persistPlayer(player);

    safeSend(player.ws, { type: 'branchSelected', branch: state.branch });
    sendProgressionState(player);
    broadcastPlayerLevel(player);
  }

  function handleAbilityBind(player, data) {
    if (typeof data.slot !== 'string') return;
    if (!ABILITY_SLOTS.includes(data.slot)) return;

    const state = player.progression;

    if (data.abilityId === null) {
      delete state.loadout[data.slot];
    } else {
      if (typeof data.abilityId !== 'string') return;
      if (!skills.hasAbility(state.skills, data.abilityId)) {
        safeSend(player.ws, { type: 'error', message: 'You have not learned that skill', messageKey: 'g.err.skillNotLearned' });
        return;
      }

      for (const slot of ABILITY_SLOTS) {
        if (state.loadout[slot] === data.abilityId) delete state.loadout[slot];
      }
      state.loadout[data.slot] = data.abilityId;
    }

    persistPlayer(player);
    sendProgressionState(player);
  }

  function handleSkillLearn(player, data) {
    if (typeof data.nodeId !== 'string') return;

    const state = player.progression;
    const points = progressionPoints(player);

    const check = skills.canLearn(data.nodeId, {
      level: state.level,
      branch: state.branch,
      ranks: state.skills,
      availablePoints: points.available,
    });

    if (!check.ok) {
      safeSend(player.ws, { type: 'skillLearnRejected', nodeId: data.nodeId, reason: check.reason });
      return;
    }

    state.skills[data.nodeId] = (state.skills[data.nodeId] || 0) + 1;
    refreshCombatStats(player);
    persistPlayer(player);

    safeSend(player.ws, {
      type: 'skillLearned',
      nodeId: data.nodeId,
      rank: state.skills[data.nodeId],
    });
    sendProgressionState(player);
  }

  function handleSkillRespec(player) {
    const state = player.progression;
    if (state.branch === null) return;

    const cost = progression.respecCostAsh(state.level, state.respecCount);
    if (player.ash < cost) {
      safeSend(player.ws, { type: 'error', message: `Respec costs ${cost} Ash`, messageKey: 'g.err.respecCost', messageVars: { amount: cost } });
      return;
    }

    player.ash -= cost;
    player.economyChangedAt = Date.now();
    state.skills = {};
    state.loadout = {};
    state.fireMode = 'single';
    state.branch = null;
    state.respecCount += 1;
    refreshCombatStats(player);
    resetPlayerAbilities(player);
    persistPlayer(player);

    safeSend(player.ws, { type: 'skillsRespecced', costAsh: cost });
    safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });
    sendProgressionState(player);
  }

  function handleLootPickup(player, data) {
    if (!player.alive) return;
    if (typeof data.id !== 'string') return;
    if (player.locationId !== 'main-world' && player.locationId !== 'tower-first-floor') return;

    const loot = lootDrops.get(data.id);
    if (!loot) return;
    if (loot.ownerId && loot.ownerId !== player.id) return;
    if (!loot.ownerId && player.locationId !== 'main-world') return;
    if (loot.instance !== player.instance) return;

    const [px, , pz] = player.position;
    const dist = Math.sqrt((loot.position[0] - px) ** 2 + (loot.position[2] - pz) ** 2);

    const byPet = data.byPet === true;
    if (byPet) {
      if (!petCanFetch(player, loot)) return;
      if (dist > PET_FETCH_RADIUS) return;
      const travelMs = (Math.max(0, dist - LOOT_CONFIG.pickupRadius) / PET_SPEED) * 1000;
      if (Date.now() - loot.createdAt < travelMs - PET_FETCH_GRACE_MS) return;
    } else if (dist > LOOT_CONFIG.pickupRadius) {
      return;
    }

    lootDrops.delete(data.id);

    addTokensToInventory(player, loot.tokens);
    persistPlayer(player);

    safeSend(ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });

    if (loot.ownerId) {
      safeSend(ws, { type: 'lootDespawn', id: data.id, byPet });
    } else {
      broadcastToLocation('main-world', { type: 'lootDespawn', id: data.id }, null, loot.instance);
    }
  }

  function arenaRefusal(player, reason) {
    safeSend(player.ws, { type: 'arenaStartResult', ok: false, reason, cooldownUntil: player.arenaCooldownUntil || 0 });
  }

  function arenaPartyLimit() {
    const configured = eventConfigFor('arena')?.maxParty ?? arena.ARENA_CONFIG.maxParty;
    return Math.max(1, Math.min(party.MAX_PARTY_SIZE, configured));
  }

  function handleArenaStart(player) {
    const now = Date.now();

    if (!player.alive) return arenaRefusal(player, 'dead');
    if (player.locationId !== ARENA_LOCATION_ID) return arenaRefusal(player, 'wrong_place');
    const sealed = eventSealedReason('arena');
    if (sealed) return arenaRefusal(player, sealed);
    if (arena.runForPlayer(player.id)) return arenaRefusal(player, 'already_running');
    if (arena.runForInstance(player.instance)) return arenaRefusal(player, 'instance_busy');
    if (now < (player.arenaCooldownUntil || 0)) return arenaRefusal(player, 'cooldown');

    const maxParty = arenaPartyLimit();
    const group = party.partyOf(player.id);
    const memberIds = [player.id];

    if (group) {
      for (const id of group.memberIds) {
        if (id === player.id) continue;
        if (memberIds.length >= maxParty) break;
        const member = players.get(id);
        if (!member || !member.alive) continue;
        if (member.locationId !== ARENA_LOCATION_ID || member.instance !== player.instance) continue;
        if (now < (member.arenaCooldownUntil || 0)) continue;
        memberIds.push(id);
      }
    }

    const minParty = Math.max(1, Math.min(maxParty, eventConfigFor('arena')?.minParty ?? 1));
    if (memberIds.length < minParty) return arenaRefusal(player, 'need_party');

    const created = arena.createRun(player.instance, memberIds, now);
    if (!created.ok) return arenaRefusal(player, created.error);

    safeSend(player.ws, { type: 'arenaStartResult', ok: true, reason: null, cooldownUntil: player.arenaCooldownUntil || 0 });
    broadcastArenaState(created.run);
  }

  function handleArenaJoin(player) {
    const run = arena.runForInstance(player.instance);
    if (!run || run.phase !== 'prep') return arenaRefusal(player, 'no_run');
    if (player.locationId !== ARENA_LOCATION_ID) return arenaRefusal(player, 'wrong_place');
    if (arena.runForPlayer(player.id)) return arenaRefusal(player, 'already_running');
    if (Date.now() < (player.arenaCooldownUntil || 0)) return arenaRefusal(player, 'cooldown');
    if (arena.activeMembers(run).length >= arenaPartyLimit()) return arenaRefusal(player, 'full');
    if (!run.memberIds.some((id) => party.areAllies(player.id, id))) return arenaRefusal(player, 'not_invited');

    run.memberIds.push(player.id);
    arena.bindMember(run, player.id);

    safeSend(player.ws, { type: 'arenaStartResult', ok: true, reason: null, cooldownUntil: player.arenaCooldownUntil || 0 });
    broadcastArenaState(run);
  }

  function handleArenaLeave(player) {
    const run = arena.runForPlayer(player.id);
    if (!run) return;

    arena.dropMember(run, player.id);
    player.arenaCooldownUntil = Date.now() + arena.ARENA_CONFIG.cooldownMs;
    persistPlayer(player);

    safeSend(player.ws, {
      type: 'arenaEnded',
      reason: 'left',
      wavesCleared: 0,
      ash: 0,
      xp: 0,
      bestWave: player.arenaBestWave || 0,
      cooldownUntil: player.arenaCooldownUntil,
    });
    safeSend(player.ws, { type: 'enemyState', enemies: [] });
    broadcastArenaState(run);
  }

  function handleDefusalQueue(player) {
    if (player.locationId !== EVENTS_LOBBY_ID) {
      safeSend(player.ws, { type: 'error', message: 'Queue from the Events Hall.', messageKey: 'g.err.queueFromEventsHall' });
      return;
    }
    if (!isEventOpen(defusal.DEFUSAL_CONFIG.eventId)) {
      safeSend(player.ws, { type: 'error', message: 'Dust II is sealed right now.', messageKey: 'g.err.dust2Sealed' });
      return;
    }
    if (defusal.matchOf(player.id)) return;

    const group = party.partyOf(player.id);
    const ids = group
      ? group.memberIds.filter((id) => {
        const member = players.get(id);
        return member && member.authenticated && member.locationId === EVENTS_LOBBY_ID;
      })
      : [player.id];

    const result = defusal.enqueue(ids.length > 0 ? ids : [player.id]);
    if (!result.ok) {
      safeSend(player.ws, { type: 'error', message: result.error === 'party_too_big' ? 'A party of five is the limit.' : 'Already in the queue.', messageKey: result.error === 'party_too_big' ? 'g.err.queue.partyTooBig' : 'g.err.queue.alreadyQueued' });
      return;
    }

    broadcastQueueState();
  }

  function handleDefusalLeaveQueue(player) {
    if (defusal.dequeue(player.id)) broadcastQueueState();
  }

  function handleDefusalPlant(player) {
    const match = defusal.matchOf(player.id);
    if (!match || !player.alive) return;
    if (match.phase !== 'live') return;

    const bomb = match.bomb;
    if (!bomb || bomb.state !== 'carried' || bomb.carrierId !== player.id) return;
    if (bomb.planting) return;

    const [x, , z] = player.position;
    const site = defusal.siteAt(x, z);
    if (!site) {
      safeSend(player.ws, { type: 'error', message: 'You have to be on a bomb site.', messageKey: 'g.err.mustBeOnBombSite' });
      return;
    }

    bomb.planting = {
      playerId: player.id,
      site,
      x,
      z,
      until: Date.now() + defusal.DEFUSAL_CONFIG.plantMs,
    };
    broadcastDefusalState(match);
  }

  function handleDefusalDefuse(player) {
    const match = defusal.matchOf(player.id);
    if (!match || !player.alive) return;

    const bomb = match.bomb;
    if (!bomb || bomb.state !== 'planted' || bomb.defusing) return;

    const side = defusal.sideOf(match, player.id);
    if (side !== 'ct') return;

    const distance = Math.hypot(player.position[0] - bomb.x, player.position[2] - bomb.z);
    if (distance > defusal.DEFUSAL_CONFIG.defuseReach) {
      safeSend(player.ws, { type: 'error', message: 'Get closer to the bomb.', messageKey: 'g.err.bombTooFar' });
      return;
    }

    bomb.defusing = { playerId: player.id, until: Date.now() + defusal.DEFUSAL_CONFIG.defuseMs };
    broadcastDefusalState(match);
  }

  function handleDefusalBuy(player, data) {
    if (typeof data.itemId !== 'string') return;

    const grinderMatch = grinder.matchOf(player.id);
    if (grinderMatch) {
      handleGrinderBuy(player, grinderMatch, data.itemId);
      return;
    }

    const match = defusal.matchOf(player.id);
    if (!match) return;

    const result = defusal.applyPurchase(match, player.id, data.itemId);
    if (!result.ok) {
      const messages = {
        buy_closed: 'The buy window is closed.',
        too_poor: 'Not enough money.',
        wrong_side: 'Not available to your side.',
        grenades_full: 'You are carrying enough grenades.',
        already_owned: 'You already have that.',
      };
      const messageKeys = {
        buy_closed: 'g.err.defusal.buyClosed',
        too_poor: 'g.err.notEnoughMoney',
        wrong_side: 'g.err.wrongSide',
        grenades_full: 'g.err.grenadesFull',
        already_owned: 'g.err.alreadyHaveThat',
      };
      safeSend(player.ws, { type: 'error', message: messages[result.error] ?? 'Cannot buy that.', messageKey: messageKeys[result.error] ?? 'g.err.cannotBuyThat' });
      return;
    }

    refillArsenalAmmo(result.member, result.item.id);
    applyDefusalLoadout(player);
    broadcastDefusalState(match);
  }

  function handleDefusalThrow(player, data) {
    const grinderMatch = grinder.matchOf(player.id);
    if (grinderMatch) {
      handleGrinderThrow(player, grinderMatch, data.direction);
      return;
    }

    const match = defusal.matchOf(player.id);
    if (!match || !player.alive || match.phase === 'freeze' || match.phase === 'over') return;
    if (!Array.isArray(data.direction) || data.direction.length !== 3) return;
    if (!data.direction.every((value) => Number.isFinite(value))) return;

    const member = match.members.get(player.id);
    if (!defusal.isHoldingGrenade(member)) return;

    const itemId = defusal.heldItemId(member);
    if (!itemId) return;

    clearSpawnProtection(player);

    const grenade = defusal.throwGrenade(match, player.id, itemId, player.position, data.direction, Date.now());
    if (!grenade) {
      safeSend(player.ws, { type: 'error', message: 'You are not carrying that.', messageKey: 'g.err.notCarrying' });
      return;
    }

    broadcastDefusal(match, {
      type: 'defusalGrenadeThrown',
      id: grenade.id,
      itemId: grenade.itemId,
      ownerId: grenade.ownerId,
      x: grenade.x,
      y: grenade.y,
      z: grenade.z,
    });
    broadcastDefusalState(match);
  }


  function handleDefusalMelee(player) {
    const grinderMatch = grinder.matchOf(player.id);
    if (grinderMatch) {
      handleGrinderMelee(player, grinderMatch);
      return;
    }

    const match = defusal.matchOf(player.id);
    const member = match?.members.get(player.id);
    if (!match || !member || !player.alive) return;
    if (match.phase === 'freeze' || match.phase === 'over') return;
    if (member.held !== 'melee') return;

    const now = Date.now();
    if (now < (player.defusalSwingUntil || 0)) return;

    clearSpawnProtection(player);

    const knife = defusalArsenal.ARSENAL_BY_ID.get(member.melee);
    player.defusalSwingUntil = now + knife.fireRateMs;
    broadcastDefusal(match, { type: 'defusalSwing', playerId: player.id });

    const mySide = defusal.sideOf(match, player.id);
    const [px, , pz] = player.position;
    const facing = player.rotation || 0;
    const forwardX = Math.sin(facing);
    const forwardZ = Math.cos(facing);

    let best = null;
    let bestDistance = Infinity;

    for (const [id, other] of match.members) {
      if (id === player.id || !other.alive) continue;
      if (defusal.sideOf(match, id) === mySide) continue;

      const target = players.get(id);
      if (!target || !target.alive) continue;

      const dx = target.position[0] - px;
      const dz = target.position[2] - pz;
      const distance = Math.hypot(dx, dz);
      if (distance > knife.maxRange || distance >= bestDistance) continue;

      const dot = distance > 0.001 ? (dx / distance) * forwardX + (dz / distance) * forwardZ : 1;
      if (dot < 0.5) continue;

      best = target;
      bestDistance = distance;
    }

    if (!best) return;

    const theirFacing = best.rotation || 0;
    const behind = forwardX * Math.sin(theirFacing) + forwardZ * Math.cos(theirFacing) > 0.35;
    const damage = arsenalDamage(player, best, 'chest', bestDistance) * (behind ? 3 : 1);

    applyBulletDamage(player, best, Math.round(damage), { point: best.position });
  }

  function handleDefusalSwitch(player, data) {
    const grinderMatch = grinder.matchOf(player.id);
    if (grinderMatch) {
      handleGrinderSwitch(player, grinderMatch, data.slot);
      return;
    }

    const match = defusal.matchOf(player.id);
    const member = match?.members.get(player.id);
    if (!member) return;
    if (!defusal.selectSlot(member, data.slot)) return;

    applyDefusalLoadout(player);
    broadcastDefusalState(match);
  }

  function handleDefusalCancel(player) {
    const match = defusal.matchOf(player.id);
    if (!match?.bomb) return;

    let changed = false;
    if (match.bomb.planting?.playerId === player.id) {
      match.bomb.planting = null;
      changed = true;
    }
    if (match.bomb.defusing?.playerId === player.id) {
      match.bomb.defusing = null;
      changed = true;
    }
    if (changed) broadcastDefusalState(match);
  }

  function handleArenaRevive(player, data) {
    if (typeof data.targetId !== 'string') return;
    if (!player.alive) return;

    const run = arena.runForPlayer(player.id);
    const refuse = (reason) => safeSend(player.ws, { type: 'arenaReviveResult', channelling: false, cancelled: true, reason });

    if (!run) return refuse('no_run');
    if (run.phase !== 'pause') return refuse('not_paused');
    if (player.arenaReviveUntil > 0) return refuse('busy');
    if (!run.downIds.has(data.targetId)) return refuse('not_down');

    const target = players.get(data.targetId);
    if (!target) return refuse('gone');

    const [px, , pz] = player.position;
    const [tx, , tz] = target.position;
    if (Math.sqrt((tx - px) ** 2 + (tz - pz) ** 2) > arena.ARENA_CONFIG.reviveReach) return refuse('too_far');

    player.arenaReviveUntil = Date.now() + arena.ARENA_CONFIG.reviveMs;
    player.arenaReviveTargetId = data.targetId;

    safeSend(player.ws, {
      type: 'arenaReviveResult',
      channelling: true,
      targetId: data.targetId,
      channelMs: arena.ARENA_CONFIG.reviveMs,
    });
  }

  function handlePartyInvite(player, data) {
    const toWallet = typeof data.toWallet === 'string' && data.toWallet.trim() ? data.toWallet.trim() : null;
    if (!toWallet) return;

    const target = walletToPlayer.get(toWallet);
    if (!target || !target.authenticated) {
      safeSend(player.ws, { type: 'error', message: 'That player is not online', messageKey: 'g.err.playerOffline' });
      return;
    }

    if (target.blockedUserIds?.has(player.userId) || player.blockedUserIds?.has(target.userId)) {
      safeSend(player.ws, { type: 'error', message: 'That player is not online', messageKey: 'g.err.playerOffline' });
      return;
    }

    const result = party.invite(player.id, target.id);
    if (!result.ok) {
      safeSend(player.ws, { type: 'error', message: partyErrorMessage(result.error), messageKey: partyErrorKey(result.error), messageVars: { max: party.MAX_PARTY_SIZE } });
      return;
    }

    safeSend(target.ws, {
      type: 'partyInviteReceived',
      fromId: player.id,
      fromNickname: player.nickname,
      expiresAt: result.invite.expiresAt,
    });
    safeSend(player.ws, { type: 'error', message: `Party invite sent to ${target.nickname}`, messageKey: 'g.err.partyInviteSent', messageVars: { nickname: target.nickname } });
  }

  function handlePartyAccept(player, data) {
    if (typeof data.fromId !== 'string') return;

    const result = party.accept(player.id, data.fromId);
    if (!result.ok) {
      safeSend(player.ws, { type: 'error', message: partyErrorMessage(result.error), messageKey: partyErrorKey(result.error), messageVars: { max: party.MAX_PARTY_SIZE } });
      return;
    }

    broadcastPartyState(result.party);
  }

  function handlePartyDecline(player, data) {
    if (typeof data.fromId !== 'string') return;

    const result = party.decline(player.id, data.fromId);
    if (!result.ok) return;

    const inviter = players.get(result.invite.fromId);
    if (inviter) safeSend(inviter.ws, { type: 'error', message: `${player.nickname} declined your party invite`, messageKey: 'g.err.partyInviteDeclined', messageVars: { nickname: player.nickname } });
  }

  function handlePartyLeave(player) {
    const result = party.leave(player.id);
    if (!result.removed) return;

    safeSend(player.ws, EMPTY_PARTY_PAYLOAD);
    applyPartyDeparture(result, 'disbanded');
  }

  function handlePartyKick(player, data) {
    if (typeof data.targetId !== 'string') return;

    const result = party.kick(player.id, data.targetId);
    if (!result.ok) {
      safeSend(player.ws, { type: 'error', message: partyErrorMessage(result.error), messageKey: partyErrorKey(result.error), messageVars: { max: party.MAX_PARTY_SIZE } });
      return;
    }

    const kicked = players.get(data.targetId);
    if (kicked) {
      safeSend(kicked.ws, EMPTY_PARTY_PAYLOAD);
      safeSend(kicked.ws, { type: 'partyDisbanded', reason: 'kicked' });
    }

    applyPartyDeparture(result, 'disbanded');
  }

  function handleCrateLoot(player, data) {
    if (!player.alive) return;
    if (typeof data.id !== 'string') return;

    const crate = deathCrates.get(data.id);
    if (!crate) return;
    if (!crateVisibleTo(crate, player)) return;

    const [px, , pz] = player.position;
    const dist = Math.sqrt((crate.position[0] - px) ** 2 + (crate.position[2] - pz) ** 2);
    if (dist > CRATE_CONFIG.pickupRadius) return;

    const moved = moveCrateEntriesToInventory(player, crate);
    const remaining = crate.entries.length;

    if (remaining === 0) despawnCrate(crate);
    else broadcastCrate(crate, { type: 'crateSpawn', crate: serializeCrate(crate) });

    safeSend(ws, { type: 'crateLootResult', id: crate.id, moved, remaining });

    if (moved === 0) {
      safeSend(ws, { type: 'error', message: 'Your inventory is full', messageKey: 'g.err.inventoryFull' });
      return;
    }

    persistPlayer(player);
    safeSend(ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });
  }

  function handleSellToken(player, data) {
    if (!player.alive) return;
    if (typeof data.address !== 'string') return;
    if (player.locationId !== 'tower-main-hall') {
      safeSend(ws, { type: 'error', message: 'You need to be at the vendor in the main hall to sell', messageKey: 'g.err.vendorRequired' });
      return;
    }

    const entry = player.inventory.find((e) => e.address === data.address);
    if (!entry || entry.quantity <= 0) {
      safeSend(ws, { type: 'error', message: 'You no longer have that item', messageKey: 'g.err.itemGone' });
      return;
    }

    const requestedQty = Number.isInteger(data.quantity) && data.quantity > 0 ? data.quantity : entry.quantity;
    const sellQty = Math.min(requestedQty, entry.quantity);
    if (sellQty <= 0) return;

    if (!player.sellQueue) player.sellQueue = [];
    if (player.sellQueue.length >= 32) {
      safeSend(ws, { type: 'error', message: 'Too many pending sells, slow down', messageKey: 'g.err.tooManyPendingSells' });
      return;
    }
    player.sellQueue.push({ address: data.address, quantity: sellQty });
    processSellQueue(player);
  }

  async function processSellQueue(player) {
    if (player.sellProcessing) return;
    player.sellProcessing = true;
    try {
      while (player.sellQueue && player.sellQueue.length > 0) {
        const job = player.sellQueue.shift();
        await performSell(player, job);
      }
    } finally {
      player.sellProcessing = false;
    }
  }

  async function performSell(player, job) {
    const current = player.inventory.find((e) => e.address === job.address);
    if (!current || current.quantity <= 0) return;
    const sellQty = Math.min(job.quantity, current.quantity);
    if (sellQty <= 0) return;

    let marketCap = 0;
    try {
      const url = new URL('/api/token-by-ca', CONFIG.siteUrl);
      url.searchParams.set('ca', job.address);
      const res = await fetch(url.toString());
      const json = await res.json();
      marketCap = Number(json?.mc) || 0;
    } catch (err) {
      console.error('[Vendor] Market cap lookup failed:', err.message);
      safeSend(ws, { type: 'error', message: 'Could not price token right now', messageKey: 'g.err.tokenPriceFailed' });
      return;
    }

    const finalEntry = player.inventory.find((e) => e.address === job.address);
    if (!finalEntry || finalEntry.quantity <= 0) return;
    const finalQty = Math.min(sellQty, finalEntry.quantity);

    const ashPerToken = ashForMarketCap(marketCap);
    const ashEarned = ashPerToken * finalQty;

    finalEntry.quantity -= finalQty;
    player.inventory = player.inventory.filter((e) => e.quantity > 0);
    player.ash += ashEarned;
    player.economyChangedAt = Date.now();
    bumpFactionTaskProgress(player, 'ash', ashEarned).catch((err) => console.error('[FactionTask] bump error:', err.message));

    persistPlayer(player);

    safeSend(ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });
    safeSend(ws, {
      type: 'sellResult',
      address: job.address,
      quantitySold: finalQty,
      ashEarned,
      marketCap,
    });
  }

  function handleShopBuyItem(player, data) {
    if (!player.alive) return;
    const item = SHOP_ITEMS[data.itemId];
    if (!item) {
      safeSend(player.ws, { type: 'error', message: 'Unknown item', messageKey: 'g.err.unknownItem' });
      return;
    }

    if (item.ashPurchasable === false) {
      safeSend(player.ws, { type: 'error', message: 'That item is not sold for ash', messageKey: 'g.err.itemNotForSale' });
      return;
    }

    if (item.blockedInCombat && isInCombat(player)) {
      safeSend(player.ws, { type: 'error', message: 'Not while you are in combat', messageKey: 'g.err.notInCombat' });
      return;
    }

    const owned = player.placeables[item.id] || 0;
    const maxOwned = item.maxOwned === null ? SHOP_UNCAPPED_MAX_OWNED : item.maxOwned;
    const capRemaining = maxOwned - owned;
    if (capRemaining <= 0) {
      safeSend(player.ws, { type: 'error', message: `You already own the maximum of ${maxOwned}`, messageKey: 'g.err.ownMaximum', messageVars: { max: maxOwned } });
      return;
    }

    if (!shopItemEnabled(item.id)) {
      safeSend(player.ws, { type: 'error', message: 'That item is not for sale right now', messageKey: 'g.err.itemNotForSale' });
      return;
    }

    const unitPrice = shopPriceFor(item.id, item.price);
    if (unitPrice === null) {
      safeSend(player.ws, { type: 'error', message: 'That one is sold for TNJ in the Shop', messageKey: 'g.err.tnjShopOnly' });
      return;
    }

    const requestedQty = Number.isInteger(data.quantity) && data.quantity > 0
      ? Math.min(data.quantity, SHOP_MAX_QTY_PER_PURCHASE)
      : 1;
    const affordableQty = unitPrice > 0 ? Math.floor(player.ash / unitPrice) : requestedQty;
    const qty = Math.max(0, Math.min(requestedQty, capRemaining, affordableQty));
    if (qty <= 0) {
      safeSend(player.ws, { type: 'error', message: 'Not enough ash', messageKey: 'g.err.notEnoughAsh' });
      return;
    }

    player.ash -= unitPrice * qty;
    player.placeables[item.id] = owned + qty;
    player.economyChangedAt = Date.now();
    persistPlayer(player);

    safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });
  }

  async function handleSignPlace(player, data) {
    if (!player.alive) return;
    if (player.locationId !== 'main-world') {
      safeSend(player.ws, { type: 'error', message: 'Signs can only be placed in the open world', messageKey: 'g.err.signOpenWorldOnly' });
      return;
    }
    if (isMuted(player)) {
      safeSend(player.ws, { type: 'error', message: `You are muted until ${new Date(player.mutedUntil).toLocaleString()}`, messageKey: 'g.err.mutedUntil', messageVars: { until: new Date(player.mutedUntil).toLocaleString() } });
      return;
    }
    if (!(player.placeables['sign-on-a-stick'] > 0)) {
      safeSend(player.ws, { type: 'error', message: "You don't own any signs — buy one from the Shop", messageKey: 'g.err.noSignsOwned' });
      return;
    }
    if (Array.from(worldSigns.values()).some((s) => s.ownerId === player.userId)) {
      safeSend(player.ws, { type: 'error', message: 'You can only have one sign placed at a time', messageKey: 'g.err.oneSignOnly' });
      return;
    }
    if (!isValidPositionForLocation(player.locationId, data.position)) {
      safeSend(player.ws, { type: 'error', message: 'Invalid placement position', messageKey: 'g.err.invalidPlacement' });
      return;
    }
    const rotation = typeof data.rotation === 'number' && isFinite(data.rotation) ? data.rotation : 0;

    player.placeables['sign-on-a-stick'] -= 1;

    const result = await callInternalApi('/api/internal/game/signs/create', {
      userId: player.userId, gameId: player.gameId, position: data.position, rotation,
    }).catch((err) => {
      console.error('[Signs] create error:', err.message);
      return null;
    });

    if (!result || !result.success) {
      player.placeables['sign-on-a-stick'] += 1;
      safeSend(player.ws, { type: 'error', message: 'Could not place sign right now', messageKey: 'g.err.signPlaceFailed' });
      return;
    }

    player.stats.buildingsPlaced += 1;
    player.economyChangedAt = Date.now();
    persistPlayer(player);

    const sign = {
      id: result.id,
      ownerId: player.userId,
      ownerNickname: player.nickname,
      position: data.position,
      rotation,
      contentType: null,
      textContent: null,
      drawingUrl: null,
      createdAt: result.createdAt,
      createdAtMs: Date.now(),
      instance: player.instance,
    };
    worldSigns.set(sign.id, sign);

    safeSend(player.ws, { type: 'inventoryUpdate', inventory: player.inventory, ash: player.ash, placeables: player.placeables });
    broadcastToLocation('main-world', { type: 'signSpawn', sign }, null, sign.instance);
  }

  async function handleSignSetText(player, data) {
    const sign = worldSigns.get(data.id);
    if (!sign) return;
    if (sign.ownerId !== player.userId || sign.contentType !== null) {
      safeSend(player.ws, { type: 'error', message: 'You cannot edit this sign', messageKey: 'g.err.signNotYours' });
      return;
    }
    if (isMuted(player)) {
      safeSend(player.ws, { type: 'error', message: `You are muted until ${new Date(player.mutedUntil).toLocaleString()}`, messageKey: 'g.err.mutedUntil', messageVars: { until: new Date(player.mutedUntil).toLocaleString() } });
      return;
    }
    if (typeof data.text !== 'string') return;

    const text = sanitizeMessage(data.text.trim().slice(0, 150));
    if (text.length === 0) return;
    if (containsLink(text)) {
      safeSend(player.ws, { type: 'error', message: 'Links are not allowed on signs', messageKey: 'g.err.noLinksOnSigns' });
      return;
    }

    const result = await callInternalApi('/api/internal/game/signs/set-content', {
      signId: sign.id, userId: player.userId, contentType: 'text', textContent: text,
    }).catch((err) => {
      console.error('[Signs] set-content error:', err.message);
      return null;
    });
    if (!result || !result.success) {
      safeSend(player.ws, { type: 'error', message: 'Could not save sign right now', messageKey: 'g.err.signSaveFailed' });
      return;
    }

    sign.contentType = 'text';
    sign.textContent = text;
    broadcastToLocation('main-world', { type: 'signContentSet', id: sign.id, contentType: 'text', textContent: text }, null, sign.instance);
  }

  async function handleSignSetDrawingUrl(player, data) {
    const sign = worldSigns.get(data.id);
    if (!sign) return;
    if (sign.ownerId !== player.userId || sign.contentType !== null) {
      safeSend(player.ws, { type: 'error', message: 'You cannot edit this sign', messageKey: 'g.err.signNotYours' });
      return;
    }
    if (typeof data.url !== 'string' || !data.url.startsWith('https://') || data.url.length > 512) {
      safeSend(player.ws, { type: 'error', message: 'Invalid drawing', messageKey: 'g.err.invalidDrawing' });
      return;
    }

    const result = await callInternalApi('/api/internal/game/signs/set-content', {
      signId: sign.id, userId: player.userId, contentType: 'draw', drawingUrl: data.url,
    }).catch((err) => {
      console.error('[Signs] set-content error:', err.message);
      return null;
    });
    if (!result || !result.success) {
      safeSend(player.ws, { type: 'error', message: 'Could not save sign right now', messageKey: 'g.err.signSaveFailed' });
      return;
    }

    sign.contentType = 'draw';
    sign.drawingUrl = data.url;
    broadcastToLocation('main-world', { type: 'signContentSet', id: sign.id, contentType: 'draw', drawingUrl: data.url }, null, sign.instance);
  }

  async function handleSignRemove(player, data) {
    const sign = worldSigns.get(data.id);
    if (!sign) return;
    if (sign.ownerId !== player.userId) {
      safeSend(player.ws, { type: 'error', message: 'You can only remove your own sign', messageKey: 'g.err.signRemoveNotYours' });
      return;
    }

    const removed = await deleteSign(sign);
    if (!removed) {
      safeSend(player.ws, { type: 'error', message: 'Could not remove sign right now', messageKey: 'g.err.signRemoveFailed' });
      return;
    }
  }

  function handleRoomBuildOp(player, data) {
    if (!player.roomCanEdit) return;

    const op = sanitizeRoomBuildOp(data.op);
    if (!op) return;

    broadcastToLocation(player.locationId, { type: 'roomBuildOp', op }, player.id);
  }

  function handleSaveProgress(player) {
    persistPlayer(player);
  }


  async function handleInfluenceEnter(player, data) {
    if (player.locationId === INFLUENCE_LOCATION_ID) return;

    if (player.locationId !== GALAXY_LOCATION_ID) {
      safeSend(player.ws, { type: 'error', message: 'You are not at the breach.', messageKey: 'g.err.influence.notAtBreach' });
      return;
    }

    const breach = influenceState.breach;
    const reach = Math.hypot(
      player.position[0] - breach.x,
      player.position[2] - breach.z
    );
    const lift = Math.abs(player.position[1] - breach.y);

    if (!influenceOpen() || reach > BREACH_INTERACT_RANGE || lift > BREACH_INTERACT_RANGE) {
      safeSend(player.ws, { type: 'error', message: 'You are not at the breach.', messageKey: 'g.err.influence.notAtBreach' });
      return;
    }

    const verdict = influenceEntryVerdict(player);
    if (!verdict.ok) {
      safeSend(player.ws, {
        type: 'error',
        message: 'You cannot enter the ward.',
        messageKey: INFLUENCE_ENTRY_DENIED[verdict.reason] || 'g.err.influence.closed',
      });
      sendInfluenceGate(player);
      return;
    }

    if (verdict.fee) {
      const charge = await chargeInfluenceEntry(player, verdict.fee, data.tx);
      if (!charge.ok) {
        safeSend(player.ws, {
          type: 'error',
          message: 'Entry payment failed.',
          messageKey: INFLUENCE_ENTRY_DENIED[charge.reason] || 'g.err.influence.payment',
        });
        sendInfluenceGate(player);
        return;
      }
      player.influencePaidAt = Date.now();
    }

    player.influenceEntryToken = Date.now();
    await handleLocationChange(player, { locationId: INFLUENCE_LOCATION_ID });
  }

  function handleInfluenceLeave(player) {
    if (player.locationId !== INFLUENCE_LOCATION_ID) return;

    if (influenceState.phase === 'collapse') {
      safeSend(player.ws, { type: 'error', message: 'The tear has sealed shut.', messageKey: 'g.err.influence.sealedIn' });
      return;
    }

    player.influenceEntryToken = 0;
    handleLocationChange(player, { locationId: GALAXY_LOCATION_ID });
  }

  async function handleLocationChange(player, data) {
    if (typeof data.locationId !== 'string') return;

    if (!player.alive) {
      sendLocationSync(player);
      return;
    }

    if (!isKnownLocationId(data.locationId)) {
      console.log(`[!] Invalid location: ${data.locationId} from ${player.id}`);
      sendLocationSync(player);
      return;
    }

    if (data.locationId === INFLUENCE_LOCATION_ID && !player.influenceEntryToken) {
      safeSend(player.ws, { type: 'error', message: 'You cannot enter the ward.', messageKey: 'g.err.influence.closed' });
      sendLocationSync(player);
      return;
    }

    if (SEALED_LOCATIONS.has(data.locationId)) {
      safeSend(player.ws, { type: 'error', message: 'That place is sealed for now.', messageKey: 'g.err.placeSealed' });
      sendLocationSync(player);
      return;
    }

    const eventId = EVENT_ID_BY_LOCATION[data.locationId];
    if (eventId && !isEventOpen(eventId)) {
      const config = eventConfigFor(eventId);
      const name = config?.title || 'That event';
      const reason = eventSealedReason(eventId);
      const message = reason === 'not_started'
        ? `${name} has not opened yet.`
        : reason === 'window_closed'
          ? `${name} is over for now.`
          : `${name} is sealed right now.`;
      const messageKey = reason === 'not_started'
        ? 'g.err.event.notStarted'
        : reason === 'window_closed'
          ? 'g.err.event.over'
          : 'g.err.event.sealed';

      safeSend(player.ws, { type: 'error', message, messageKey, messageVars: { name } });
      sendLocationSync(player);
      return;
    }

    const oldLocation = player.locationId;
    if (oldLocation === data.locationId) {
      if (!isShardedLocation(oldLocation)) return;
      const requested = Number.isInteger(data.instance) ? data.instance : null;
      if (requested === null || requested === player.instance) return;

      const target = pickShard(oldLocation, requested);
      if (target === player.instance) return;

      for (const id of player.aoiNeighbors) {
        const other = players.get(id);
        safeSend(player.ws, { type: 'playerLeave', playerId: id });
        if (other) {
          safeSend(other.ws, { type: 'playerLeave', playerId: player.id });
          other.aoiNeighbors.delete(player.id);
        }
      }
      player.aoiNeighbors.clear();

      player.instance = target;
      spawnInSafeZone(player, oldLocation);
      player.justTeleported = true;
      player.teleportSettleUntil = Date.now() + TELEPORT_SETTLE_MS;
      grantSpawnProtection(player);
      player.positionHistory = [];
      player.recentShots = [];

      safeSend(player.ws, { type: 'shardTeleport', position: player.position, instance: target });
      sendActiveZones(player);
      recomputeAOI(player);
      broadcastShardState(oldLocation);
      broadcastCount();
      return;
    }

    const now = Date.now();
    const sinceLast = now - player.lastLocationChangeAt;
    if (sinceLast < MIN_LOCATION_CHANGE_INTERVAL_MS) {
      if (player.pendingLocationChange) clearTimeout(player.pendingLocationChange);
      player.pendingLocationChange = setTimeout(() => {
        player.pendingLocationChange = null;
        if (player.authenticated) handleLocationChange(player, data);
      }, MIN_LOCATION_CHANGE_INTERVAL_MS - sinceLast);
      return;
    }
    if (player.pendingLocationChange) {
      clearTimeout(player.pendingLocationChange);
      player.pendingLocationChange = null;
    }
    player.lastLocationChangeAt = now;

    if (data.locationId.startsWith(PLAYER_ROOM_PREFIX) || data.locationId.startsWith(FACTION_ROOM_PREFIX)) {
      const verdict = await callInternalApi('/api/internal/game/room/can-enter', {
        userId: player.userId,
        locationId: data.locationId,
      }).catch((err) => {
        console.error('[RoomAccess] check error:', err.message);
        return null;
      });

      if (!verdict || verdict.allowed !== true) {
        safeSend(player.ws, {
          type: 'error',
          message: verdict?.reason || 'You cannot enter that room.',
          messageKey: verdict?.reason ? null : 'g.err.cannotEnterRoom',
        });
        sendLocationSync(player);
        return;
      }
    }

    if (oldLocation === 'tower-first-floor' && player.canyon) {
      player.canyon.enemies.clear();
      player.canyon.pendingSegment = null;
      clearCanyonLoot(player);
    }

    const previousInstance = player.instance;
    player.locationId = data.locationId;
    const requestedInstance = Number.isInteger(data.instance)
      ? data.instance
      : partyShardFor(player, data.locationId);
    player.instance = isShardedLocation(data.locationId)
      ? pickShard(data.locationId, requestedInstance, player)
      : 1;

    if (player.locationId === 'tower-main-hall' && player.weaponEquipped) {
      player.weaponEquipped = false;
      safeSend(ws, { type: 'weaponForceUnequip' });
    }

    spawnInSafeZone(player, data.locationId);
    player.justTeleported = true;
    player.teleportSettleUntil = Date.now() + TELEPORT_SETTLE_MS;
    grantSpawnProtection(player);
    player.positionHistory = [];
    player.recentShots = [];

    setPlayerLoading(player);
    notifyLocationTransition(player, oldLocation, data.locationId);
    sendLocationSync(player);
    broadcastCount();

    if (isShardedLocation(oldLocation) && oldLocation !== data.locationId) {
      broadcastShardState(oldLocation);
    }
    if (isShardedLocation(data.locationId)) {
      broadcastShardState(data.locationId);
    } else if (isShardedLocation(oldLocation) && oldLocation === data.locationId && previousInstance !== player.instance) {
      broadcastShardState(oldLocation);
    }

    sendActiveZones(player);
    safeSend(ws, { type: 'enemyState', enemies: [] });

    if (data.locationId === 'main-world') {
      safeSend(ws, { type: 'lootState', loot: serializeLoot(player.instance) });
      await ensureSignsLoaded(player.gameId);
      safeSend(ws, { type: 'signState', signs: serializeSigns(player.instance) });
      sendWorldEnemyState(player);
    }

    if (data.locationId === 'tower-first-floor' && player.canyon) {
      enterCanyonHub(player);
    }

    if (oldLocation === CAVE_LOCATION_ID) {
      leaveCave(player, previousInstance);
    }

    if (data.locationId === CAVE_LOCATION_ID) {
      enterCave(player);
    }

    if (oldLocation === INFLUENCE_LOCATION_ID) {
      leaveInfluence(player);
    }

    if (data.locationId === INFLUENCE_LOCATION_ID) {
      enterInfluence(player);
    }

    if (oldLocation === grinder.GRINDER_CONFIG.locationId) {
      leaveGrinder(player);
    }

    if (data.locationId === grinder.GRINDER_CONFIG.locationId) {
      enterGrinder(player);
    }

    if (data.locationId === GALAXY_LOCATION_ID) {
      safeSend(ws, { type: 'factionGatesState', gates: displayedFactionGatesList, accountCount });
    }

    safeSend(ws, buildInfluenceStatePayload());

    if (isOwnRoom(player)) sendStorageState(player);
    sendCrateState(player);

    if (data.locationId === ARENA_LOCATION_ID) {
      const activeRun = arena.runForInstance(player.instance);
      if (activeRun) safeSend(ws, arenaStatePayload(activeRun));
    }

    await refreshRoomEditRights(player);
  }
});

function broadcast(data, excludeId = null, useAOI = false, senderPlayer = null, applyBlockFilter = false) {
  const message = getCachedMessage(data);

  if (useAOI && senderPlayer) {
    for (const id of senderPlayer.aoiNeighbors) {
      if (id === excludeId) continue;

      const p = players.get(id);
      if (!p || !p.authenticated || p.ws.readyState !== WebSocket.OPEN) continue;
      if (applyBlockFilter && senderPlayer.userId && p.blockedUserIds?.has(senderPlayer.userId)) continue;

      try {
        p.ws.send(message);
      } catch (err) {
        console.error('[!] Broadcast error:', err.message);
      }
    }
    return;
  }

  players.forEach((p, id) => {
    if (id === excludeId) return;
    if (!p.authenticated || p.ws.readyState !== WebSocket.OPEN) return;

    if (useAOI && senderPlayer) {
      if (!isInAOI(senderPlayer, p)) return;
    }

    if (applyBlockFilter && senderPlayer && senderPlayer.userId && p.blockedUserIds?.has(senderPlayer.userId)) return;

    try {
      p.ws.send(message);
    } catch (err) {
      console.error('[!] Broadcast error:', err.message);
    }
  });
}

function countBucketKey(player) {
  const shard = isShardedLocation(player.locationId) ? player.instance : 0;
  return `${player.locationId}|${shard}`;
}

function broadcastCount() {
  const authenticated = Array.from(players.values()).filter((p) => p.authenticated);
  const count = authenticated.length;

  const buckets = new Map();
  for (const p of authenticated) {
    const key = countBucketKey(p);
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }

  const encoded = new Map();

  for (const p of authenticated) {
    if (p.ws.readyState !== WebSocket.OPEN) continue;

    const here = buckets.get(countBucketKey(p)) || 1;
    let msg = encoded.get(here);
    if (!msg) {
      msg = JSON.stringify({ type: 'count', count, here });
      encoded.set(here, msg);
    }

    try {
      p.ws.send(msg);
    } catch (err) { }
  }
}

const SHUTDOWN_SAVE_DEADLINE_MS = 8000;
const FATAL_SAVE_DEADLINE_MS = 3000;
let shuttingDown = false;

function flushAllSaves(deadlineMs) {
  const savePromises = [];
  try {
    players.forEach((player) => {
      if (player.authenticated && CONFIG.internalSecret) {
        savePromises.push(queuePlayerSave(player, buildSavePayload(player)));
      }
    });
  } catch (err) {
    console.error('[!] Save flush build error:', err.message);
  }

  return Promise.race([
    Promise.allSettled(savePromises),
    new Promise((resolve) => setTimeout(resolve, deadlineMs).unref?.()),
  ]);
}

function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[!] ${signal} received. Shutting down gracefully...`);

  const hardExit = setTimeout(() => {
    console.error('[!] Shutdown timed out, forcing exit');
    process.exit(exitCode || 1);
  }, SHUTDOWN_SAVE_DEADLINE_MS + 6000);
  hardExit.unref?.();

  flushAllSaves(SHUTDOWN_SAVE_DEADLINE_MS).then(() => {
    const msg = getCachedMessage({ type: 'serverShutdown', reason: 'Server restarting' });
    players.forEach((p) => {
      try {
        p.ws.send(msg);
        p.ws.close(1001, 'Server shutdown');
      } catch (err) { }
    });

    setTimeout(() => {
      wss.close(() => {
        server.close(() => {
          console.log('[✓] Shutdown complete');
          process.exit(exitCode);
        });
      });
    }, 2000);
  });
}

function fatalShutdown(reason, err) {
  console.error(`[!] FATAL (${reason}):`, err?.stack || err);

  if (shuttingDown) {
    process.exit(1);
    return;
  }
  shuttingDown = true;

  const hardExit = setTimeout(() => process.exit(1), FATAL_SAVE_DEADLINE_MS + 2000);
  hardExit.unref?.();

  flushAllSaves(FATAL_SAVE_DEADLINE_MS).then(() => {
    console.error('[!] State flushed after fatal error, exiting for restart');
    process.exit(1);
  }).catch(() => process.exit(1));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  fatalShutdown('uncaughtException', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[!] Unhandled rejection:', reason);
});

server.listen(PORT, () => {
  console.log(`[TANJO] Game server running on port ${PORT}`);
  console.log(`[TANJO] Health check: http://localhost:${PORT}/health`);
  console.log(`[TANJO] Site URL: ${CONFIG.siteUrl}`);
  console.log(`[TANJO] Persistence: ${CONFIG.internalSecret ? 'enabled' : 'DISABLED'}`);
  console.log(`[TANJO] Catalogs: progression ${progression.CATALOG_HASH}, skills ${skills.CATALOG_HASH}`);
  console.log(`[TANJO] AoI: ${CONFIG.world.zoneSize}m zones, radius ${CONFIG.world.aoiRadius}`);
});