// game-server/progression.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CATALOG_PATH = path.join(__dirname, 'progression.catalog.json');
const CATALOG_RAW = fs.readFileSync(CATALOG_PATH);
const catalog = JSON.parse(CATALOG_RAW.toString());

const CATALOG_HASH = crypto.createHash('sha256').update(CATALOG_RAW).digest('hex').slice(0, 12);

const MAX_LEVEL = catalog.maxLevel;
const XP_CURVE = catalog.xpCurve;
const ENERGY = catalog.energy;
const RESPEC = catalog.respec;
const XP_SOURCES = catalog.xpSources;
const QUEST_XP = catalog.questXp;
const PVP_SCALING = catalog.pvpScaling;
const BRANCHES = catalog.branches;
const TIERS = catalog.tiers;
const MEME_ABILITIES = catalog.memeAbilities;
const WEAPON_TIERS = catalog.weaponTiers;

const MEME_ABILITIES_BY_ID = new Map(MEME_ABILITIES.map((m) => [m.id, m]));
const BRANCH_IDS = new Set(BRANCHES.map((b) => b.id));

function xpToNext(level) {
  if (level >= MAX_LEVEL) return 0;
  return Math.round(XP_CURVE.base * Math.pow(level, XP_CURVE.exponent));
}

const LEVEL_XP = buildLevelTable();

function buildLevelTable() {
  const table = [0, 0];
  for (let level = 1; level < MAX_LEVEL; level++) {
    table[level + 1] = table[level] + xpToNext(level);
  }
  return table;
}

function totalXpForLevel(level) {
  const clamped = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  return LEVEL_XP[clamped];
}

function levelFromTotalXp(totalXp) {
  const xp = Math.max(0, Math.floor(Number(totalXp) || 0));
  let level = 1;
  while (level < MAX_LEVEL && xp >= LEVEL_XP[level + 1]) level++;
  return {
    level,
    xpIntoLevel: xp - LEVEL_XP[level],
    xpForLevel: xpToNext(level),
  };
}

function skillPointsForLevel(level) {
  const clamped = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  const perLevel = (clamped - 1) * catalog.skillPoints.perLevel;
  const bonus = catalog.skillPoints.bonusLevels.filter((l) => l <= clamped).length;
  return perLevel + bonus;
}

function tierForLevel(level) {
  let current = TIERS[0];
  for (const tier of TIERS) {
    if (level >= tier.minLevel) current = tier;
  }
  return current;
}

function weaponTierForLevel(level) {
  let current = WEAPON_TIERS[0];
  for (const tier of WEAPON_TIERS) {
    if (level >= tier.minLevel) current = tier;
  }
  return current;
}

function memeAbilityIdsForLevel(level) {
  return TIERS.filter((t) => level >= t.minLevel).map((t) => t.memeAbility);
}

function memeAbilityById(id) {
  return MEME_ABILITIES_BY_ID.get(id) || null;
}

function respecCostAsh(level, respecCount) {
  if (level < RESPEC.freeBelowLevel) return 0;
  const raw = RESPEC.baseCostAsh * Math.pow(RESPEC.growth, Math.max(0, respecCount));
  return Math.min(RESPEC.maxCostAsh, Math.round(raw));
}

function isBranchId(value) {
  return typeof value === 'string' && BRANCH_IDS.has(value);
}

function enemyXp(maxHealth, isBoss) {
  const multiplier = isBoss ? XP_SOURCES.bossHealthMultiplier : XP_SOURCES.enemyHealthMultiplier;
  return Math.max(1, Math.round((Number(maxHealth) || 0) * multiplier));
}

function levelGapMultiplier(playerLevel, contentLevel) {
  const gap = Math.max(0, playerLevel - contentLevel);
  const raw = 1 - XP_SOURCES.levelGapPenaltyPerLevel * gap;
  return Math.max(XP_SOURCES.levelGapPenaltyFloor, Math.min(1, raw));
}

function canyonSegmentXp(segment, alreadyCleared) {
  const base = XP_SOURCES.canyonSegmentBase + XP_SOURCES.canyonSegmentPerSegment * Math.max(0, segment - 1);
  return Math.round(alreadyCleared ? base * XP_SOURCES.canyonRepeatMultiplier : base);
}

function questXp(questId) {
  return Math.max(0, Math.floor(QUEST_XP[questId] || 0));
}

function scalePvpDamage(damage, damageClass, targetMaxHealth) {
  const scale = PVP_SCALING[damageClass];
  if (typeof scale !== 'number') return damage;

  const scaled = damage * scale;
  if (damageClass !== 'ultimate') return scaled;

  const cap = targetMaxHealth * PVP_SCALING.ultimateMaxHealthFraction;
  return Math.min(scaled, cap);
}

module.exports = {
  CATALOG_HASH,
  MAX_LEVEL,
  XP_CURVE,
  ENERGY,
  RESPEC,
  XP_SOURCES,
  QUEST_XP,
  PVP_SCALING,
  BRANCHES,
  TIERS,
  MEME_ABILITIES,
  WEAPON_TIERS,
  xpToNext,
  totalXpForLevel,
  levelFromTotalXp,
  skillPointsForLevel,
  tierForLevel,
  weaponTierForLevel,
  memeAbilityIdsForLevel,
  memeAbilityById,
  respecCostAsh,
  isBranchId,
  enemyXp,
  levelGapMultiplier,
  canyonSegmentXp,
  questXp,
  scalePvpDamage,
};
