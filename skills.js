// game-server/skills.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CATALOG_PATH = path.join(__dirname, 'skills.catalog.json');
const CATALOG_RAW = fs.readFileSync(CATALOG_PATH);
const catalog = JSON.parse(CATALOG_RAW.toString());

const CATALOG_HASH = crypto.createHash('sha256').update(CATALOG_RAW).digest('hex').slice(0, 12);

const SKILL_COLUMNS = catalog.columns;
const SKILL_NODES = catalog.nodes;
const CAPSTONE_COLUMN_POINTS = catalog.capstoneColumnPoints;

const COLUMNS_BY_ID = new Map(SKILL_COLUMNS.map((c) => [c.id, c]));
const NODES_BY_ID = new Map(SKILL_NODES.map((n) => [n.id, n]));
const ABILITY_NODES_BY_ABILITY_ID = new Map(
  SKILL_NODES.filter((n) => n.ability).map((n) => [n.ability.id, n])
);
const MODE_NODES_BY_MODE_ID = new Map(
  SKILL_NODES.filter((n) => n.mode).map((n) => [n.mode.id, n])
);

function branchOfColumn(columnId) {
  const column = COLUMNS_BY_ID.get(columnId);
  return column ? column.branch : null;
}

function rankOf(ranks, nodeId) {
  const node = NODES_BY_ID.get(nodeId);
  if (!node) return 0;
  const rank = Math.floor(Number(ranks[nodeId]) || 0);
  return Math.max(0, Math.min(node.maxRank, rank));
}

function pointsSpent(ranks) {
  let total = 0;
  for (const nodeId of Object.keys(ranks)) total += rankOf(ranks, nodeId);
  return total;
}

function columnPoints(ranks, columnId) {
  let total = 0;
  for (const nodeId of Object.keys(ranks)) {
    const node = NODES_BY_ID.get(nodeId);
    if (!node || node.column !== columnId) continue;
    total += rankOf(ranks, nodeId);
  }
  return total;
}

function canLearn(nodeId, state) {
  const node = NODES_BY_ID.get(nodeId);
  if (!node) return { ok: false, reason: 'unknown_node' };

  const nodeBranch = branchOfColumn(node.column);
  if (nodeBranch !== 'core' && nodeBranch !== state.branch) {
    return { ok: false, reason: 'wrong_branch' };
  }

  if (rankOf(state.ranks, nodeId) >= node.maxRank) return { ok: false, reason: 'max_rank' };
  if (state.level < node.requires.level) return { ok: false, reason: 'level_too_low' };
  if (columnPoints(state.ranks, node.column) < node.requires.columnPoints) {
    return { ok: false, reason: 'column_points_too_low' };
  }
  if (state.availablePoints < 1) return { ok: false, reason: 'no_points' };

  return { ok: true };
}

function computeBuildStats(ranks) {
  const stats = { add: {}, percent: {}, set: {} };

  for (const nodeId of Object.keys(ranks)) {
    const node = NODES_BY_ID.get(nodeId);
    if (!node || !node.effects) continue;

    const rank = rankOf(ranks, nodeId);
    if (rank <= 0) continue;

    for (const effect of node.effects) {
      const value = effect.perRank[rank - 1];
      if (typeof value !== 'number') continue;

      if (effect.op === 'add') {
        stats.add[effect.stat] = (stats.add[effect.stat] || 0) + value;
      } else if (effect.op === 'addPercent') {
        stats.percent[effect.stat] = (stats.percent[effect.stat] || 0) + value;
      } else {
        stats.set[effect.stat] = value;
      }
    }
  }

  return stats;
}

function statValue(stats, key, base) {
  const added = base + (stats.add[key] || 0);
  const percent = stats.percent[key] || 0;
  return added * (1 + percent / 100);
}

function unlockedAbilityIds(ranks) {
  return SKILL_NODES.filter((n) => n.ability && rankOf(ranks, n.id) > 0).map((n) => n.ability.id);
}

function unlockedModeIds(ranks) {
  return SKILL_NODES.filter((n) => n.mode && rankOf(ranks, n.id) > 0).map((n) => n.mode.id);
}

function unlockedTriggers(ranks) {
  return SKILL_NODES.filter((n) => n.trigger && rankOf(ranks, n.id) > 0).map((n) => n.trigger);
}

function abilityDefinition(abilityId) {
  const node = ABILITY_NODES_BY_ABILITY_ID.get(abilityId);
  return node ? node.ability : null;
}

function modeDefinition(modeId) {
  const node = MODE_NODES_BY_MODE_ID.get(modeId);
  return node ? node.mode : null;
}

function modeBranch(modeId) {
  const node = MODE_NODES_BY_MODE_ID.get(modeId);
  return node ? branchOfColumn(node.column) : null;
}

function hasAbility(ranks, abilityId) {
  const node = ABILITY_NODES_BY_ABILITY_ID.get(abilityId);
  return !!node && rankOf(ranks, node.id) > 0;
}

function hasMode(ranks, modeId) {
  if (modeId === 'single') return true;
  const node = MODE_NODES_BY_MODE_ID.get(modeId);
  return !!node && rankOf(ranks, node.id) > 0;
}

function sanitizeRanks(raw, branch) {
  if (!raw || typeof raw !== 'object') return {};
  const ranks = {};

  for (const [nodeId, value] of Object.entries(raw)) {
    const node = NODES_BY_ID.get(nodeId);
    if (!node) continue;

    const nodeBranch = branchOfColumn(node.column);
    if (nodeBranch !== 'core' && nodeBranch !== branch) continue;

    const rank = Math.floor(Number(value));
    if (!Number.isFinite(rank) || rank <= 0) continue;

    ranks[nodeId] = Math.min(node.maxRank, rank);
  }

  return ranks;
}

function validateBuild(ranks, level, branch, availablePoints) {
  const sanitized = sanitizeRanks(ranks, branch);
  const nodeIds = Object.keys(sanitized).sort((a, b) => {
    const left = NODES_BY_ID.get(a);
    const right = NODES_BY_ID.get(b);
    return left.requires.columnPoints - right.requires.columnPoints || left.row - right.row;
  });

  const rebuilt = {};
  let spent = 0;

  for (const nodeId of nodeIds) {
    const node = NODES_BY_ID.get(nodeId);
    const wanted = sanitized[nodeId];

    for (let rank = 0; rank < wanted; rank++) {
      const check = canLearn(nodeId, {
        level,
        branch,
        ranks: rebuilt,
        availablePoints: availablePoints - spent,
      });
      if (!check.ok) break;

      rebuilt[nodeId] = (rebuilt[nodeId] || 0) + 1;
      spent++;
    }
  }

  return { ranks: rebuilt, spent };
}

module.exports = {
  CATALOG_HASH,
  SKILL_COLUMNS,
  SKILL_NODES,
  CAPSTONE_COLUMN_POINTS,
  NODES_BY_ID,
  branchOfColumn,
  rankOf,
  pointsSpent,
  columnPoints,
  canLearn,
  computeBuildStats,
  statValue,
  unlockedAbilityIds,
  unlockedModeIds,
  unlockedTriggers,
  abilityDefinition,
  modeDefinition,
  modeBranch,
  hasAbility,
  hasMode,
  sanitizeRanks,
  validateBuild,
};
