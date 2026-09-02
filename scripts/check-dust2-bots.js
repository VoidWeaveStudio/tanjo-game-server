// game-server/scripts/check-dust2-bots.js
const defusal = require('../defusal');
const grinder = require('../grinder');
const arsenal = require('../defusalArsenal');
const nav = require('../dust2Nav');
const bots = require('../dust2Bots');

let failures = 0;

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  failures++;
}

function zoneMultiplier(zone, weapon) {
  if (zone === 'head') return weapon?.headshotMult ?? 4;
  if (zone === 'chest') return 1;
  if (zone === 'stomach') return 1.25;
  return 0.75;
}

function damageFor(member, weapon, zone, distance, config) {
  const zoneMult = zoneMultiplier(zone, weapon);
  let damage = (weapon?.damage ?? 26) * zoneMult;
  damage *= Math.pow(weapon?.rangeModifier ?? 1, Math.max(0, distance) / 12.7);

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

function actorsOf(match, mode) {
  const actors = [];
  for (const [id, member] of match.members) {
    const bot = bots.get(id);
    if (!bot) continue;
    actors.push({
      id,
      isBot: true,
      alive: bot.alive && member.alive,
      position: bot.position,
      side: mode === 'defusal' ? defusal.sideOf(match, id) : null,
      lastShotAt: bot.lastShotAt,
      moving: bot.lastMoveDistance > 0.05,
    });
  }
  return actors;
}

function runDefusalMatch(seconds, rounds) {
  const stats = {
    shots: 0,
    hits: 0,
    kills: 0,
    plants: 0,
    defuses: 0,
    buys: 0,
    offGrid: 0,
    moved: new Map(),
    roundOutcomes: [],
  };

  const created = [];
  for (let i = 0; i < 10; i++) created.push(bots.createBot('sim-match', 'defusal'));

  const match = defusal.createDirectMatch(9001, [created[0].id]);
  if (!match) throw new Error('could not create the simulated match');
  match.id = 'sim-match';

  for (let i = 1; i < created.length; i++) {
    defusal.addMember(match, created[i].id, i < 5 ? 't' : 'ct');
  }

  let now = 1000000;
  const step = bots.TUNING.tickMs;

  const spawnAll = () => {
    for (const bot of created) {
      const spawn = defusal.spawnFor(match, bot.id) ?? [0, 0, 0];
      bots.resetForRound(bot, bots.grounded(spawn[0], spawn[2]), now);
      const member = match.members.get(bot.id);
      member.alive = true;
      defusal.normaliseHeld(member);
      stats.moved.set(bot.id, 0);
    }
  };

  for (let round = 0; round < rounds; round++) {
    defusal.startRound(match, now);
    spawnAll();

    const previous = new Map(created.map((bot) => [bot.id, [...bot.position]]));
    const deadline = now + seconds * 1000;
    let ended = null;

    while (now < deadline) {
      if (match.phase === 'freeze' && now >= match.phaseUntil) {
        match.phase = 'live';
        match.phaseUntil = now + defusal.DEFUSAL_CONFIG.roundMs;
      }

      const bomb = match.bomb;
      if (bomb && bomb.planting && now >= bomb.planting.until) {
        bomb.state = 'planted';
        bomb.site = bomb.planting.site;
        bomb.x = bomb.planting.x;
        bomb.z = bomb.planting.z;
        bomb.explodesAt = now + defusal.DEFUSAL_CONFIG.bombMs;
        bomb.carrierId = null;
        bomb.planting = null;
        match.phase = 'planted';
        stats.plants++;
      }
      if (bomb && bomb.defusing && now >= bomb.defusing.until) {
        bomb.state = 'defused';
        bomb.defusing = null;
        stats.defuses++;
      }

      const actors = actorsOf(match, 'defusal');
      const events = bots.tick(match, 'defusal', { actors }, now, step);

      for (const event of events) {
        const bot = bots.get(event.botId);
        if (!bot) continue;

        if (event.kind === 'shoot') {
          stats.shots++;
          continue;
        }

        if (event.kind === 'buy') {
          const result = defusal.applyPurchase(match, bot.id, event.itemId);
          if (result.ok) stats.buys++;
          continue;
        }

        if (event.kind === 'plant') {
          const site = defusal.siteAt(bot.position[0], bot.position[2]);
          if (site && match.bomb && match.bomb.state === 'carried' && !match.bomb.planting) {
            match.bomb.planting = {
              playerId: bot.id,
              site,
              x: bot.position[0],
              z: bot.position[2],
              until: now + defusal.DEFUSAL_CONFIG.plantMs,
            };
          }
          continue;
        }

        if (event.kind === 'defuse') {
          if (match.bomb && match.bomb.state === 'planted' && !match.bomb.defusing) {
            match.bomb.defusing = { playerId: bot.id, until: now + defusal.DEFUSAL_CONFIG.defuseMs };
          }
          continue;
        }

        if (event.kind === 'hit') {
          const victim = bots.get(event.targetId);
          const member = match.members.get(event.targetId);
          if (!victim || !member || !victim.alive) continue;
          if (defusal.sideOf(match, bot.id) === defusal.sideOf(match, victim.id)) continue;

          stats.hits++;
          const weapon = bots.gunOf(match.members.get(bot.id));
          const damage = damageFor(member, weapon, event.zone, event.distance, defusal.DEFUSAL_CONFIG);
          victim.health -= damage;

          if (victim.health <= 0) {
            bots.markDead(victim);
            defusal.markDead(match, victim.id);
            stats.kills++;
          }
        }
      }

      for (const bot of created) {
        const before = previous.get(bot.id);
        const travelled = Math.hypot(bot.position[0] - before[0], bot.position[2] - before[2]);
        stats.moved.set(bot.id, stats.moved.get(bot.id) + travelled);
        previous.set(bot.id, [...bot.position]);

        if (bot.alive && !nav.isWalkable(bot.position[0], bot.position[2])) stats.offGrid++;
      }

      const outcome = defusal.roundOutcome(match, now);
      if (outcome) {
        ended = outcome;
        break;
      }

      now += step;
    }

    stats.roundOutcomes.push(ended ? ended.reason : 'unresolved');
    now += 2000;
  }

  for (const bot of created) bots.removeBot(bot.id);
  defusal.endMatch(match);

  return stats;
}

function runGrinderMatch(seconds) {
  const stats = { shots: 0, hits: 0, kills: 0, offGrid: 0, moved: new Map() };

  const match = grinder.ensureMatch(9002, 1000000);
  match.id = 'sim-grinder';

  const created = [];
  for (let i = 0; i < 8; i++) {
    const bot = bots.createBot('sim-grinder', 'grinder');
    grinder.join(match, bot.id, 1000000);
    created.push(bot);
  }

  let now = 1000000;
  const step = bots.TUNING.tickMs;

  for (const bot of created) {
    const member = match.members.get(bot.id);
    grinder.respawn(member);
    member.primary = grinder.GRINDER_CONFIG.startPrimary;
    member.armor = grinder.GRINDER_CONFIG.startArmor;
    member.armorPoints = grinder.GRINDER_CONFIG.armorPoints;
    member.helmet = true;
    member.held = 'primary';
    const spawn = grinder.pickSpawn(match, bot.id, []);
    bots.resetForRound(bot, bots.grounded(spawn[0], spawn[2]), now);
    stats.moved.set(bot.id, 0);
  }

  const previous = new Map(created.map((bot) => [bot.id, [...bot.position]]));
  const deadline = now + seconds * 1000;

  while (now < deadline) {
    const actors = actorsOf(match, 'grinder');
    const events = bots.tick(match, 'grinder', { actors }, now, step);

    for (const event of events) {
      if (event.kind === 'shoot') {
        stats.shots++;
        continue;
      }
      if (event.kind !== 'hit') continue;

      const shooter = bots.get(event.botId);
      const victim = bots.get(event.targetId);
      const member = match.members.get(event.targetId);
      if (!shooter || !victim || !member || !victim.alive) continue;

      stats.hits++;
      const weapon = bots.gunOf(match.members.get(shooter.id));
      const damage = damageFor(member, weapon, event.zone, event.distance, grinder.GRINDER_CONFIG);
      victim.health -= damage;

      if (victim.health <= 0) {
        bots.markDead(victim);
        grinder.markDead(match, victim.id, shooter.id, now);
        stats.kills++;
      }
    }

    for (const id of grinder.readyToRespawn(match, now)) {
      const bot = bots.get(id);
      if (!bot) continue;
      const member = match.members.get(id);
      grinder.respawn(member);
      member.primary = grinder.GRINDER_CONFIG.startPrimary;
      member.armorPoints = grinder.GRINDER_CONFIG.armorPoints;
      member.held = 'primary';
      const spawn = grinder.pickSpawn(match, id, []);
      bots.resetForRound(bot, bots.grounded(spawn[0], spawn[2]), now);
      previous.set(id, [...bot.position]);
    }

    for (const bot of created) {
      const before = previous.get(bot.id);
      const travelled = Math.hypot(bot.position[0] - before[0], bot.position[2] - before[2]);
      if (travelled < 20) stats.moved.set(bot.id, stats.moved.get(bot.id) + travelled);
      previous.set(bot.id, [...bot.position]);

      if (bot.alive && !nav.isWalkable(bot.position[0], bot.position[2])) stats.offGrid++;
    }

    now += step;
  }

  for (const bot of created) bots.removeBot(bot.id);
  grinder.closeMatch(match);

  return stats;
}

console.log('dust2 bot simulation — defusal, 4 rounds of up to 115s');
const started = Date.now();
const defusalStats = runDefusalMatch(116, 4);
const defusalElapsed = Date.now() - started;

const distances = Array.from(defusalStats.moved.values());
const stuck = distances.filter((distance) => distance < 25).length;

console.log(`       shots ${defusalStats.shots}, hits ${defusalStats.hits}, kills ${defusalStats.kills}`);
console.log(`       plants ${defusalStats.plants}, defuses ${defusalStats.defuses}, buys ${defusalStats.buys}`);
console.log(`       rounds ended by: ${defusalStats.roundOutcomes.join(', ')}`);
console.log(`       travel per bot: ${distances.map((d) => d.toFixed(0)).join(', ')} m`);
console.log(`       simulated 464s of match in ${defusalElapsed}ms`);

check('bots leave spawn and cross the map', stuck === 0, `${stuck} bot(s) moved under 25m`);
check('bots buy during the freeze window', defusalStats.buys > 0);
check('bots find each other and open fire', defusalStats.shots > 40, `${defusalStats.shots} shots`);
check('bot fire actually connects', defusalStats.hits > 0, `${defusalStats.hits} hits`);
check('duels resolve into kills', defusalStats.kills > 0, `${defusalStats.kills} kills`);
check('attackers reach a site and plant', defusalStats.plants > 0);
check('every round reaches a decision', !defusalStats.roundOutcomes.includes('unresolved'),
  defusalStats.roundOutcomes.join(', '));
check('bots never stand outside the navigable map', defusalStats.offGrid === 0, `${defusalStats.offGrid} samples`);
check('simulation runs far faster than real time', defusalElapsed < 20000, `${defusalElapsed}ms for 464s`);

console.log('\ndust2 bot simulation — grinder, 60s');
const grinderStarted = Date.now();
const grinderStats = runGrinderMatch(60);
const grinderElapsed = Date.now() - grinderStarted;

const grinderDistances = Array.from(grinderStats.moved.values());
const grinderStuck = grinderDistances.filter((distance) => distance < 25).length;

console.log(`       shots ${grinderStats.shots}, hits ${grinderStats.hits}, kills ${grinderStats.kills}`);
console.log(`       travel per bot: ${grinderDistances.map((d) => d.toFixed(0)).join(', ')} m`);
console.log(`       simulated 60s of match in ${grinderElapsed}ms`);

check('grinder bots roam the map', grinderStuck === 0, `${grinderStuck} bot(s) moved under 25m`);
check('grinder bots fight', grinderStats.kills > 0, `${grinderStats.kills} kills`);
check('grinder bots stay on the navigable map', grinderStats.offGrid === 0, `${grinderStats.offGrid} samples`);

if (failures === 0) {
  console.log('\ndust2 bot checks passed');
  process.exit(0);
}

console.log(`\n${failures} problem(s) found`);
process.exit(1);
