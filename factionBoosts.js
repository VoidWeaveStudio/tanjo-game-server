// game-server/factionBoosts.js
const FACTION_BOOST_EFFECTS = {
  vitality: { effect: 'maxHealth', magnitude: 0.12 },
  swiftness: { effect: 'moveSpeed', magnitude: 0.08 },
  scavenging: { effect: 'loot', magnitude: 0.2 },
  insight: { effect: 'xp', magnitude: 0.15 },
};

module.exports = { FACTION_BOOST_EFFECTS };
