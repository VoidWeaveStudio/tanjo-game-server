// game-server/scripts/check-abilities.js
const abilities = require('../abilities');
const skills = require('../skills');

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`);
}

const emptyStats = skills.computeBuildStats({});
const now = Date.now();

console.log('cooldowns and charges');
{
  const state = abilities.createAbilityState(100);
  const def = abilities.definitionFor('blink');

  check('blink ready at start', abilities.readyAtFor(state, 'blink', emptyStats, now) === 0);
  const readyAt = abilities.consumeCooldown(state, 'blink', emptyStats, now);
  check('blink on cooldown after cast', readyAt === now + def.cooldownMs, `readyAt=${readyAt}`);
  check('blink blocked while cooling', abilities.readyAtFor(state, 'blink', emptyStats, now + 1000) > now + 1000);
  check('blink ready after cooldown', abilities.readyAtFor(state, 'blink', emptyStats, now + def.cooldownMs + 1) === 0);
}

console.log('\ndash charges from Double Tap');
{
  const withCharge = skills.computeBuildStats({ gun_double_tap: 1 });
  check('dashCharges stat present', withCharge.add.dashCharges === 1, JSON.stringify(withCharge.add));
  check('two roll charges', abilities.maxChargesFor('combat_roll', withCharge) === 2);

  const state = abilities.createAbilityState(100);
  abilities.consumeCooldown(state, 'combat_roll', withCharge, now);
  check('still ready after first roll', abilities.readyAtFor(state, 'combat_roll', withCharge, now) === 0);
  abilities.consumeCooldown(state, 'combat_roll', withCharge, now);
  check('locked after second roll', abilities.readyAtFor(state, 'combat_roll', withCharge, now) > now);

  const cd = abilities.cooldownFor('combat_roll', abilities.definitionFor('combat_roll'), withCharge);
  abilities.tickCharges(state, withCharge, now + cd + 1);
  check('one charge back after cooldown', abilities.readyAtFor(state, 'combat_roll', withCharge, now + cd + 1) === 0);
}

console.log('\ncooldown reduction');
{
  const insight = skills.computeBuildStats({ arc_runic_insight: 3 });
  const base = abilities.definitionFor('slow_field').cooldownMs;
  const reduced = abilities.cooldownFor('slow_field', abilities.definitionFor('slow_field'), insight);
  check('control cooldown reduced 22%', reduced === Math.round(base * 0.78), `${base} -> ${reduced}`);

  const untouched = abilities.cooldownFor('blink', abilities.definitionFor('blink'), insight);
  check('blink unaffected by control cooldown', untouched === abilities.definitionFor('blink').cooldownMs);
}

console.log('\nenergy cost');
{
  const velocity = skills.computeBuildStats({ arc_spell_velocity: 3 });
  const carrier = { effects: [] };
  const def = abilities.definitionFor('chain_lightning');
  const cost = abilities.energyCostFor('chain_lightning', def, velocity, carrier, now);
  check('mana cost reduced 15%', cost === Math.round(def.energyCost * 0.85), `${def.energyCost} -> ${cost}`);

  abilities.addEffect(carrier, { id: 'ascendance', expiresAt: now + 5000, spellDamagePercent: 20 });
  check('ascendance makes spells free', abilities.energyCostFor('chain_lightning', def, velocity, carrier, now) === 0);
  check('ascendance does not free gun skills',
    abilities.energyCostFor('frag_grenade', abilities.definitionFor('frag_grenade'), velocity, carrier, now) > 0);
}

console.log('\ndamage scaling');
{
  const carrier = { effects: [] };
  const demolition = skills.computeBuildStats({ gun_demolition: 3 });
  check('aoe damage +50%',
    Math.abs(abilities.damageMultiplier('frag_grenade', demolition, carrier, now) - 1.5) < 1e-9,
    String(abilities.damageMultiplier('frag_grenade', demolition, carrier, now)));

  const focus = skills.computeBuildStats({ arc_focused_core: 3 });
  check('spell damage +12%',
    Math.abs(abilities.damageMultiplier('chain_lightning', focus, carrier, now) - 1.12) < 1e-9);

  abilities.addEffect(carrier, { id: 'ascendance', expiresAt: now + 5000, spellDamagePercent: 20 });
  check('ascendance stacks on spells',
    Math.abs(abilities.damageMultiplier('chain_lightning', focus, carrier, now) - 1.12 * 1.2) < 1e-9);
  check('ascendance ignored for gun skills',
    Math.abs(abilities.damageMultiplier('frag_grenade', demolition, carrier, now) - 1.5) < 1e-9);
}

console.log('\nzone radius and duration');
{
  const amplify = skills.computeBuildStats({ arc_amplify: 3 });
  check('zone radius +50%', Math.abs(abilities.radiusMultiplier('slow_field', amplify) - 1.5) < 1e-9);
  check('zone duration +50%', Math.abs(abilities.durationMultiplier('slow_field', amplify) - 1.5) < 1e-9);
  check('non-zone ability keeps duration', abilities.durationMultiplier('hex', amplify) === 1);
  check('mana feedback tick', abilities.zoneTickBonus(skills.computeBuildStats({ arc_mana_feedback: 3 })) === 24);
}

console.log('\nshields');
{
  const state = abilities.createAbilityState(100);
  abilities.grantShield(state, 120, 6000, 0, now);
  const first = abilities.absorbWithShield(state, 50, now);
  check('shield absorbs fully', first.absorbed === 50 && first.remaining === 0);

  const second = abilities.absorbWithShield(state, 100, now);
  check('shield absorbs remainder', second.absorbed === 70 && second.remaining === 30, JSON.stringify(second));
  check('shield broke', second.broke === true);
  check('no shield left', abilities.shieldRemaining(state, now) === 0);

  const expired = abilities.createAbilityState(100);
  abilities.grantShield(expired, 120, 1000, 0, now);
  const late = abilities.absorbWithShield(expired, 40, now + 2000);
  check('expired shield absorbs nothing', late.absorbed === 0 && late.remaining === 40);
}

console.log('\nmana shield drains energy');
{
  const state = abilities.createAbilityState(100);
  state.energy = 20;
  abilities.grantShield(state, 120, 6000, 0.5, now);

  const hit = abilities.absorbWithShield(state, 100, now);
  check('absorb limited by mana', hit.absorbed === 40, `absorbed=${hit.absorbed}`);
  check('energy drained to zero', state.energy === 0, `energy=${state.energy}`);
  check('shield collapses without mana', hit.broke === true && hit.remaining === 60, JSON.stringify(hit));
}

console.log('\neffects');
{
  const carrier = { effects: [] };
  abilities.addEffect(carrier, { id: 'marked', expiresAt: now + 1000, damageTakenPercent: 15 });
  abilities.addEffect(carrier, { id: 'hexed', expiresAt: now + 1000, damageTakenPercent: 18, slowPercent: 20 });

  const mult = abilities.damageTakenMultFromEffects(carrier, now);
  check('marks stack multiplicatively', Math.abs(mult - 1.15 * 1.18) < 1e-9, String(mult));
  check('slow applies', Math.abs(abilities.speedMultFromEffects(carrier, now) - 0.8) < 1e-9);

  abilities.pruneEffects(carrier, now + 2000);
  check('effects expire', carrier.effects.length === 0);
  check('expired effects neutral', abilities.damageTakenMultFromEffects(carrier, now + 2000) === 1);

  abilities.addEffect(carrier, { id: 'bulwark', expiresAt: now + 1000, damageTakenMult: 0.4 });
  check('bulwark mitigates', Math.abs(abilities.damageTakenMultFromEffects(carrier, now) - 0.4) < 1e-9);
}

console.log('\ninvulnerability');
{
  const carrier = { effects: [] };
  const state = abilities.createAbilityState(100);
  check('not invulnerable by default', abilities.isInvulnerable(carrier, state, now) === false);

  state.iframesUntil = now + 250;
  check('iframes count', abilities.isInvulnerable(carrier, state, now) === true);
  check('iframes lapse', abilities.isInvulnerable(carrier, state, now + 300) === false);

  abilities.addEffect(carrier, { id: 'phase_step', expiresAt: now + 3000 });
  check('phase step counts', abilities.isInvulnerable(carrier, state, now + 300) === true);
}

console.log('\naim geometry');
{
  const ground = abilities.groundPointFromAim([0, 5, 0], [0, -1, 0], 0, 40);
  check('straight down lands under caster', Math.abs(ground[0]) < 1e-9 && Math.abs(ground[2]) < 1e-9);

  const flat = abilities.groundPointFromAim([0, 5, 0], [0, 0, -1], 0, 40);
  check('flat aim clamps to max range', Math.abs(flat[2] + 40) < 1e-9, JSON.stringify(flat));

  const angled = abilities.groundPointFromAim([0, 4, 0], abilities.normalizeDirection([0, -1, -1]), 0, 40);
  check('45 degrees lands 4m out', Math.abs(angled[2] + 4) < 1e-6, JSON.stringify(angled));

  check('rejects zero direction', abilities.normalizeDirection([0, 0, 0]) === null);
  check('rejects malformed aim', abilities.isValidAim({ origin: [0, 0], direction: [0, 0, 1] }) === false);
  check('rejects NaN aim', abilities.isValidAim({ origin: [0, NaN, 0], direction: [0, 0, 1] }) === false);
  check('accepts good aim', abilities.isValidAim({ origin: [1, 2, 3], direction: [0, 0, 1] }) === true);
}

console.log('\ntriggers');
{
  const state = abilities.createAbilityState(100);
  check('trigger ready initially', abilities.triggerReady(state, 'second_wind', now) === true);

  abilities.startTriggerCooldown(state, 'second_wind', 300000, now);
  check('trigger on cooldown', abilities.triggerReady(state, 'second_wind', now + 1000) === false);
  check('trigger back after cooldown', abilities.triggerReady(state, 'second_wind', now + 300001) === true);
}

console.log('\nfire modes');
{
  const progression = require('../progression');
  const modeNodes = skills.SKILL_NODES.filter((n) => n.mode);

  check('four unlockable fire modes', modeNodes.length === 4, `got ${modeNodes.length}`);
  check('single mode is always available', skills.hasMode({}, 'single') === true);
  check('locked modes are refused', skills.hasMode({}, 'marksman') === false);

  const branches = modeNodes.map((n) => skills.modeBranch(n.mode.id));
  check('every mode belongs to a branch', branches.every((b) => b === 'gunslinger' || b === 'arcanist'));
  check('rifle modes are gunslinger', skills.modeBranch('marksman') === 'gunslinger' && skills.modeBranch('auto') === 'gunslinger');
  check('staff modes are arcanist', skills.modeBranch('charged') === 'arcanist' && skills.modeBranch('split') === 'arcanist');

  const marksman = skills.modeDefinition('marksman');
  const auto = skills.modeDefinition('auto');
  const charged = skills.modeDefinition('charged');
  const split = skills.modeDefinition('split');

  check('marksman reloads between shots', marksman.fireRateMs > progression.WEAPONS.rifle.fireRateMs * 3);
  check('marksman one-shots a basic enemy', marksman.damageMult * 25 >= 100, `${marksman.damageMult * 25} damage`);
  check('no mode fires in bursts', modeNodes.every((n) => !n.mode.burstSize));
  check('auto trades damage for cadence', auto.fireRateMs < progression.WEAPONS.rifle.fireRateMs && auto.damageMult < 1);
  check('charged pays for its punch', charged.damageMult > 1 && charged.manaCostMult > 1 && charged.chargeMs > 0);
  check('charged pierces', charged.pierceCount > 0);
  check('split trades damage for count', split.projectiles > 1 && split.damageMult < 1);
  check('split total damage below single', split.projectiles * split.damageMult < 1.5, `${(split.projectiles * split.damageMult).toFixed(2)}x`);

  const singleDps = 1 / progression.WEAPONS.rifle.fireRateMs;
  const marksmanDps = marksman.damageMult / marksman.fireRateMs;
  check('marksman trades dps for punch',
    marksmanDps < singleDps && marksmanDps > singleDps * 0.6,
    `${(marksmanDps / singleDps).toFixed(2)}x`);

  const autoDps = auto.damageMult / auto.fireRateMs;
  check('auto dps within 40% of single', autoDps / singleDps < 1.4, `${(autoDps / singleDps).toFixed(2)}x`);

  const staff = progression.WEAPONS.staff;
  const flightMs = (staff.maxRange / staff.projectileSpeed) * 1000;
  check('bolt flight is noticeable but short', flightMs > 500 && flightMs < 4000, `${Math.round(flightMs)}ms across max range`);
}

console.log('\nmeme abilities');
{
  const progression = require('../progression');
  const memes = progression.MEME_ABILITIES;

  check('ten meme abilities', memes.length === 10, `got ${memes.length}`);
  check('one meme per tier', progression.TIERS.every((t) => memes.some((m) => m.id === t.memeAbility)));
  check('none unlocked above max level', progression.TIERS.every((t) => t.minLevel <= progression.MAX_LEVEL));
  check('cooldown always outlasts duration', memes.every((m) => m.cooldownMs > m.durationMs));
  check('every meme has an emoji and a description', memes.every((m) => m.emoji && m.description));

  const byId = new Map(memes.map((m) => [m.id, m]));
  const radiusMemes = ['ink_dump', 'copium_cloud', 'whale_splash', 'airdrop'];
  check('area memes declare a radius', radiusMemes.every((id) => (byId.get(id).params.radius || 0) > 0));
  check('ink darkens but does not blind', byId.get('ink_dump').params.screenDarken > 0 && byId.get('ink_dump').params.screenDarken < 1);
  check('airdrop heals', byId.get('airdrop').params.allyHeal > 0);
  check('moon launch actually launches', byId.get('moon_launch').params.launchHeight > 0);
  check('no meme deals damage', memes.every((m) => !('damage' in m.params) && !('damagePerSecond' in m.params)));

  const level1 = progression.memeAbilityIdsForLevel(1);
  const level50 = progression.memeAbilityIdsForLevel(50);
  check('first tier grants exactly one meme', level1.length === 1 && level1[0] === 'shrimp_squeak');
  check('max level grants all ten', level50.length === 10);

  const state = abilities.createAbilityState(100);
  check('meme ready at start', abilities.memeReadyAt(state, 'shrimp_squeak', now) === 0);

  const readyAt = abilities.startMemeCooldown(state, 'shrimp_squeak', byId.get('shrimp_squeak').cooldownMs, now);
  check('meme goes on cooldown', abilities.memeReadyAt(state, 'shrimp_squeak', now + 1000) === readyAt);
  check('meme returns after cooldown', abilities.memeReadyAt(state, 'shrimp_squeak', readyAt + 1) === 0);
  check('meme cooldowns are separate from skills', Object.keys(state.cooldowns).length === 0);

  abilities.resetAbilityState(state, 100);
  check('respec does not refund meme cooldowns', abilities.memeReadyAt(state, 'shrimp_squeak', now + 1000) === readyAt);

  const payload = abilities.memeCooldownPayload(state, level50, now);
  check('cooldown payload covers every unlocked meme', Object.keys(payload).length === 10);
}

console.log('\nshot passives');
{
  const progression = require('../progression');

  const ricochet = skills.computeBuildStats({ gun_ricochet: 2 });
  check('ricochet chance 45% at max rank', ricochet.percent.ricochetChance === 45, String(ricochet.percent.ricochetChance));
  check('ricochet keeps half the damage', ricochet.percent.ricochetDamage === 50, String(ricochet.percent.ricochetDamage));

  const explosive = skills.computeBuildStats({ gun_explosive_rounds: 2 });
  check('every fourth round detonates at max rank', explosive.set.explosiveEveryNthShot === 4, String(explosive.set.explosiveEveryNthShot));
  check('detonation is weaker than the shot', explosive.percent.explosiveDamage > 0 && explosive.percent.explosiveDamage < 100, String(explosive.percent.explosiveDamage));
  check('detonation radius stays small', explosive.set.explosiveRadius > 0 && explosive.set.explosiveRadius <= 5, String(explosive.set.explosiveRadius));

  const burn = skills.computeBuildStats({ arc_elemental_attunement: 3 });
  const burnSeconds = burn.set.burnDurationMs / 1000;
  const burnPerSecond = burn.add.burnDamage / burnSeconds;
  check('burn lasts several seconds', burnSeconds >= 3 && burnSeconds <= 10, `${burnSeconds}s`);
  check('burn ticks below a rifle shot', burnPerSecond < 25, `${burnPerSecond}/s vs 25 per shot`);
  check('burn is scaled down in pvp',
    progression.scalePvpDamage(burnPerSecond, 'zoneTick', 100) < burnPerSecond,
    String(progression.scalePvpDamage(burnPerSecond, 'zoneTick', 100)));

  const piercing = skills.computeBuildStats({ gun_armor_piercing: 3 });
  check('armor piercing never voids a shield', piercing.percent.armorPen > 0 && piercing.percent.armorPen <= 90, String(piercing.percent.armorPen));

  const hollow = skills.computeBuildStats({ gun_hollow_point: 3 });
  check('hollow point beats a flat damage node',
    hollow.percent.damageVsUnshielded > skills.computeBuildStats({ gun_steady_aim: 3 }).percent.weaponDamage,
    String(hollow.percent.damageVsUnshielded));

  const branchOf = (nodeId) => skills.branchOfColumn(skills.NODES_BY_ID.get(nodeId).column);
  check('ricochet and explosive rounds are gunslinger',
    branchOf('gun_ricochet') === 'gunslinger' && branchOf('gun_explosive_rounds') === 'gunslinger');
  check('burn is arcanist', branchOf('arc_elemental_attunement') === 'arcanist');
}

console.log('\nno stat is dead');
{
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const sources = ['abilities.js', 'skills.js', 'progression.js']
    .map((file) => fs.readFileSync(path.join(root, file), 'utf8'))
    .concat(server)
    .join('\n');

  const stats = new Set();
  for (const node of skills.SKILL_NODES) {
    for (const effect of node.effects || []) stats.add(effect.stat);
  }

  const unmentioned = [...stats].filter((stat) => !sources.includes(stat));
  check(`all ${stats.size} skill stats are mentioned by the server`, unmentioned.length === 0, unmentioned.join(', '));

  const start = server.indexOf('function computeCombatStats');
  const end = server.indexOf('function refreshCombatStats');
  check('combat stats block found', start !== -1 && end > start);

  const built = server.slice(start, end);
  const elsewhere = server.slice(0, start) + server.slice(end);
  const fields = [...built.matchAll(/^ {4}(\w+):/gm)].map((m) => m[1]);

  const unread = fields.filter((field) => !new RegExp(`combat\\.${field}\\b`).test(elsewhere));
  check(`all ${fields.length} combat fields are read somewhere`, unread.length === 0, unread.join(', '));
}

console.log('\nevery catalog ability has meta and definition');
{
  const active = skills.SKILL_NODES.filter((n) => n.ability);
  const missing = active.filter((n) => !abilities.metaFor(n.ability.id) || !abilities.definitionFor(n.ability.id));
  check(`all ${active.length} abilities resolvable`, missing.length === 0, missing.map((n) => n.id).join(', '));

  const offensive = active.filter((n) => abilities.metaFor(n.ability.id).offensive);
  check('offensive abilities tagged', offensive.length === 13, `got ${offensive.length}`);
}

console.log(failures === 0 ? '\nall ability checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);

