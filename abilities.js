// game-server/abilities.js
const skills = require('./skills');

const ABILITY_META = {
  overdrive: { school: 'weapon' },
  combat_roll: { school: 'weapon', dash: true, chargeStat: 'dashCharges' },
  kinetic_barrier: { school: 'weapon', shield: true, cooldownStat: 'supportCooldown' },
  bulwark: { school: 'weapon' },
  frag_grenade: { school: 'weapon', offensive: true, aoe: true, chargeStat: 'grenadeCharges', cooldownStat: 'supportCooldown' },
  suppression_field: { school: 'weapon', offensive: true, zone: true, cooldownStat: 'supportCooldown' },
  marked_target: { school: 'weapon', offensive: true, cooldownStat: 'supportCooldown' },
  shockwave: { school: 'weapon', offensive: true, aoe: true, cooldownStat: 'supportCooldown' },
  barrage: { school: 'weapon', offensive: true, aoe: true, zone: true, cooldownStat: 'supportCooldown' },
  shatter_ward: { school: 'spell', offensive: true },
  chain_lightning: { school: 'spell', offensive: true },
  meteor: { school: 'spell', offensive: true, aoe: true, zone: true },
  ascendance: { school: 'spell' },
  blink: { school: 'spell', dash: true, chargeStat: 'dashCharges' },
  mana_shield: { school: 'spell', shield: true },
  reflect_ward: { school: 'spell', shield: true },
  phase_step: { school: 'spell' },
  slow_field: { school: 'spell', offensive: true, zone: true, cooldownStat: 'controlCooldown' },
  gravity_well: { school: 'spell', offensive: true, zone: true, cooldownStat: 'controlCooldown' },
  healing_rune: { school: 'spell', zone: true, healing: true },
  hex: { school: 'spell', offensive: true, cooldownStat: 'controlCooldown' },
  time_dilation: { school: 'spell', offensive: true, zone: true, cooldownStat: 'controlCooldown' },
  cataclysm: { school: 'spell', offensive: true, zone: true, cooldownStat: 'controlCooldown' },
};

const MAX_CAST_RANGE = 60;
const MAX_GROUND_RANGE = 40;
const MAX_TARGET_RANGE = 45;

for (const node of skills.SKILL_NODES) {
  if (node.ability && !ABILITY_META[node.ability.id]) {
    throw new Error(`[abilities] no meta for ability ${node.ability.id}`);
  }
}

function metaFor(abilityId) {
  return ABILITY_META[abilityId] || null;
}

function definitionFor(abilityId) {
  return skills.abilityDefinition(abilityId);
}

function maxRangeFor(castType) {
  if (castType === 'ground') return MAX_GROUND_RANGE;
  if (castType === 'target') return MAX_TARGET_RANGE;
  return MAX_CAST_RANGE;
}

function createAbilityState(maxEnergy) {
  return {
    energy: maxEnergy,
    lastRegenAt: Date.now(),
    cooldowns: {},
    memeCooldowns: {},
    charges: {},
    shield: 0,
    shieldMax: 0,
    shieldExpiresAt: 0,
    shieldManaPerDamage: 0,
    iframesUntil: 0,
    triggerReadyAt: {},
    lastCastAt: 0,
  };
}

function resetAbilityState(state, maxEnergy) {
  state.energy = maxEnergy;
  state.lastRegenAt = Date.now();
  state.cooldowns = {};
  state.charges = {};
  state.shield = 0;
  state.shieldMax = 0;
  state.shieldExpiresAt = 0;
  state.shieldManaPerDamage = 0;
  state.iframesUntil = 0;
  state.lastCastAt = 0;
}

function percentOf(stats, key) {
  return (stats.percent[key] || 0) / 100;
}

function regenEnergy(state, combat, now) {
  const elapsed = Math.max(0, now - state.lastRegenAt);
  if (elapsed <= 0) return;

  state.lastRegenAt = now;
  if (state.energy >= combat.maxEnergy) {
    state.energy = combat.maxEnergy;
    return;
  }

  state.energy = Math.min(combat.maxEnergy, state.energy + combat.energyRegen * (elapsed / 1000));
}

function energyCostFor(abilityId, definition, stats, carrier, now) {
  if (metaFor(abilityId).school === 'spell' && hasEffect(carrier, 'ascendance', now)) return 0;

  const scaled = definition.energyCost * (1 + percentOf(stats, 'manaCost'));
  return Math.max(0, Math.round(scaled));
}

function cooldownFor(abilityId, definition, stats) {
  const meta = metaFor(abilityId);
  const reduction = meta.cooldownStat ? percentOf(stats, meta.cooldownStat) : 0;
  return Math.max(500, Math.round(definition.cooldownMs * (1 + reduction)));
}

function maxChargesFor(abilityId, stats) {
  const meta = metaFor(abilityId);
  if (!meta.chargeStat) return 1;
  return Math.max(1, 1 + (stats.add[meta.chargeStat] || 0));
}

function chargeEntry(state, abilityId, maxCharges) {
  let entry = state.charges[abilityId];
  if (!entry) {
    entry = { available: maxCharges, rechargeAt: 0 };
    state.charges[abilityId] = entry;
  }
  if (entry.available > maxCharges) entry.available = maxCharges;
  return entry;
}

function tickCharges(state, stats, now) {
  for (const abilityId of Object.keys(state.charges)) {
    const entry = state.charges[abilityId];
    if (entry.rechargeAt === 0) continue;

    const definition = definitionFor(abilityId);
    if (!definition) {
      delete state.charges[abilityId];
      continue;
    }

    const maxCharges = maxChargesFor(abilityId, stats);
    while (entry.rechargeAt !== 0 && now >= entry.rechargeAt) {
      entry.available = Math.min(maxCharges, entry.available + 1);
      entry.rechargeAt = entry.available >= maxCharges
        ? 0
        : entry.rechargeAt + cooldownFor(abilityId, definition, stats);
    }
  }
}

function readyAtFor(state, abilityId, stats, now) {
  const definition = definitionFor(abilityId);
  if (!definition) return 0;

  const maxCharges = maxChargesFor(abilityId, stats);
  if (maxCharges > 1) {
    const entry = chargeEntry(state, abilityId, maxCharges);
    return entry.available > 0 ? 0 : entry.rechargeAt;
  }

  const readyAt = state.cooldowns[abilityId] || 0;
  return readyAt > now ? readyAt : 0;
}

function consumeCooldown(state, abilityId, stats, now) {
  const definition = definitionFor(abilityId);
  const cooldownMs = cooldownFor(abilityId, definition, stats);
  const maxCharges = maxChargesFor(abilityId, stats);

  if (maxCharges > 1) {
    const entry = chargeEntry(state, abilityId, maxCharges);
    entry.available = Math.max(0, entry.available - 1);
    if (entry.rechargeAt === 0) entry.rechargeAt = now + cooldownMs;
    return entry.available > 0 ? 0 : entry.rechargeAt;
  }

  state.cooldowns[abilityId] = now + cooldownMs;
  return state.cooldowns[abilityId];
}

function cooldownPayload(state, loadout, stats, now) {
  const payload = {};
  for (const abilityId of Object.values(loadout)) {
    if (typeof abilityId !== 'string') continue;
    payload[abilityId] = readyAtFor(state, abilityId, stats, now);
  }
  return payload;
}

function effectsOf(carrier) {
  if (!Array.isArray(carrier.effects)) carrier.effects = [];
  return carrier.effects;
}

function addEffect(carrier, effect) {
  const effects = effectsOf(carrier);
  const index = effects.findIndex((e) => e.id === effect.id);
  if (index === -1) effects.push(effect);
  else if (effects[index].expiresAt <= effect.expiresAt) effects[index] = effect;
}

function pruneEffects(carrier, now) {
  const effects = effectsOf(carrier);
  if (effects.length === 0) return false;

  const kept = effects.filter((e) => e.expiresAt > now);
  if (kept.length === effects.length) return false;

  carrier.effects = kept;
  return true;
}

function findEffect(carrier, id, now) {
  const effect = effectsOf(carrier).find((e) => e.id === id);
  if (!effect) return null;
  return effect.expiresAt > now ? effect : null;
}

function hasEffect(carrier, id, now) {
  return findEffect(carrier, id, now) !== null;
}

function clearEffects(carrier) {
  carrier.effects = [];
}

function damageTakenMultFromEffects(carrier, now) {
  let mult = 1;
  for (const effect of effectsOf(carrier)) {
    if (effect.expiresAt <= now) continue;
    if (typeof effect.damageTakenMult === 'number') mult *= effect.damageTakenMult;
    if (typeof effect.damageTakenPercent === 'number') mult *= 1 + effect.damageTakenPercent / 100;
  }
  return Math.max(0, mult);
}

function speedMultFromEffects(carrier, now) {
  let mult = 1;
  for (const effect of effectsOf(carrier)) {
    if (effect.expiresAt <= now) continue;
    if (typeof effect.slowPercent === 'number') mult *= Math.max(0, 1 - effect.slowPercent / 100);
    if (typeof effect.speedPercent === 'number') mult *= 1 + effect.speedPercent / 100;
  }
  return Math.max(0, mult);
}

function isStunned(carrier, now) {
  return hasEffect(carrier, 'stunned', now);
}

function isInvulnerable(carrier, state, now) {
  if (state && state.iframesUntil > now) return true;
  return hasEffect(carrier, 'phase_step', now);
}

function damageMultiplier(abilityId, stats, carrier, now) {
  const meta = metaFor(abilityId);
  let mult = 1;

  if (meta.aoe) mult *= 1 + percentOf(stats, 'aoeDamage');
  if (meta.school === 'spell') mult *= 1 + percentOf(stats, 'spellDamage');

  const ascendance = meta.school === 'spell' ? findEffect(carrier, 'ascendance', now) : null;
  if (ascendance) mult *= 1 + (ascendance.spellDamagePercent || 0) / 100;

  return Math.max(0, mult);
}

function radiusMultiplier(abilityId, stats) {
  const meta = metaFor(abilityId);
  let mult = 1;

  if (meta.aoe) mult *= 1 + percentOf(stats, 'aoeRadius');
  if (meta.zone) mult *= 1 + percentOf(stats, 'zoneRadius');

  return Math.max(0.1, mult);
}

function durationMultiplier(abilityId, stats) {
  const meta = metaFor(abilityId);
  if (!meta.zone) return 1;
  return Math.max(0.1, 1 + percentOf(stats, 'zoneDuration'));
}

function healMultiplier(stats) {
  return Math.max(0, 1 + percentOf(stats, 'healingPower'));
}

function zoneTickBonus(stats) {
  return Math.max(0, stats.add.zoneTickDamage || 0);
}

function grantShield(state, amount, durationMs, manaPerDamage, now) {
  const total = Math.max(0, Math.round(amount));
  state.shield = total;
  state.shieldMax = total;
  state.shieldExpiresAt = now + durationMs;
  state.shieldManaPerDamage = Math.max(0, manaPerDamage || 0);
}

function shieldRemaining(state, now) {
  if (state.shield <= 0) return 0;
  if (state.shieldExpiresAt <= now) return 0;
  return state.shield;
}

function breakShield(state) {
  state.shield = 0;
  state.shieldMax = 0;
  state.shieldExpiresAt = 0;
  state.shieldManaPerDamage = 0;
}

function absorbWithShield(state, damage, now) {
  const available = shieldRemaining(state, now);
  if (available <= 0) {
    if (state.shield > 0) breakShield(state);
    return { absorbed: 0, remaining: damage, broke: false };
  }

  let absorbed = Math.min(available, damage);

  if (state.shieldManaPerDamage > 0) {
    absorbed = Math.min(absorbed, state.energy / state.shieldManaPerDamage);
  }

  absorbed = Math.floor(absorbed);
  if (state.shieldManaPerDamage > 0) {
    state.energy = Math.max(0, state.energy - absorbed * state.shieldManaPerDamage);
  }

  state.shield = Math.max(0, state.shield - absorbed);

  const broke = state.shield <= 0 || (state.shieldManaPerDamage > 0 && state.energy <= 0);
  if (broke) breakShield(state);

  return { absorbed, remaining: Math.max(0, damage - absorbed), broke };
}

function memeReadyAt(state, memeId, now) {
  const readyAt = state.memeCooldowns[memeId] || 0;
  return readyAt > now ? readyAt : 0;
}

function startMemeCooldown(state, memeId, cooldownMs, now) {
  state.memeCooldowns[memeId] = now + cooldownMs;
  return state.memeCooldowns[memeId];
}

function memeCooldownPayload(state, memeIds, now) {
  const payload = {};
  for (const memeId of memeIds) payload[memeId] = memeReadyAt(state, memeId, now);
  return payload;
}

function triggerReady(state, triggerId, now) {
  return (state.triggerReadyAt[triggerId] || 0) <= now;
}

function startTriggerCooldown(state, triggerId, cooldownMs, now) {
  state.triggerReadyAt[triggerId] = now + cooldownMs;
}

function distance2D(a, b) {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

function withinRadius(position, x, z, radius) {
  return Math.hypot(position[0] - x, position[2] - z) <= radius;
}

function normalizeDirection(direction) {
  const [dx, dy, dz] = direction;
  const length = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(length) || length < 0.001) return null;
  return [dx / length, dy / length, dz / length];
}

function projectAim(origin, direction, distance) {
  return [
    origin[0] + direction[0] * distance,
    origin[1] + direction[1] * distance,
    origin[2] + direction[2] * distance,
  ];
}

function groundPointFromAim(origin, direction, groundY, maxDistance) {
  if (direction[1] >= -0.05) return projectAim(origin, direction, maxDistance);

  const travel = (origin[1] - groundY) / -direction[1];
  const distance = Math.min(maxDistance, Math.max(1, travel));
  const point = projectAim(origin, direction, distance);
  point[1] = groundY;
  return point;
}

function isValidAim(aim) {
  if (!aim || typeof aim !== 'object') return false;
  if (!Array.isArray(aim.origin) || aim.origin.length !== 3) return false;
  if (!Array.isArray(aim.direction) || aim.direction.length !== 3) return false;
  return aim.origin.every(Number.isFinite) && aim.direction.every(Number.isFinite);
}

module.exports = {
  ABILITY_META,
  MAX_CAST_RANGE,
  MAX_GROUND_RANGE,
  MAX_TARGET_RANGE,
  metaFor,
  definitionFor,
  maxRangeFor,
  createAbilityState,
  resetAbilityState,
  regenEnergy,
  energyCostFor,
  cooldownFor,
  maxChargesFor,
  tickCharges,
  readyAtFor,
  consumeCooldown,
  cooldownPayload,
  addEffect,
  pruneEffects,
  findEffect,
  hasEffect,
  clearEffects,
  damageTakenMultFromEffects,
  speedMultFromEffects,
  isStunned,
  isInvulnerable,
  damageMultiplier,
  radiusMultiplier,
  durationMultiplier,
  healMultiplier,
  zoneTickBonus,
  grantShield,
  shieldRemaining,
  breakShield,
  absorbWithShield,
  memeReadyAt,
  startMemeCooldown,
  memeCooldownPayload,
  triggerReady,
  startTriggerCooldown,
  distance2D,
  withinRadius,
  normalizeDirection,
  projectAim,
  groundPointFromAim,
  isValidAim,
};
