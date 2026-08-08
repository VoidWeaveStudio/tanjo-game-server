// game-server/factionQuests.js
const X_POST_URL_PREFIX = 'https://x.com/';
const QUEST_LISTING_FEE_ASH = 1;
const QUEST_MIN_SLOTS = 1;
const QUEST_MAX_SLOTS = 10000;
const QUEST_MIN_REWARD_ASH = 1;
const QUEST_MAX_REWARD_ASH = 100000;

const FACTION_QUEST_TYPES = [
  {
    key: 'x_post_view',
    label: 'View a post on X',
    description: 'Players open your post on X and confirm the view to earn the reward.',
  },
];

function isValidXPostUrl(url) {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed.startsWith(X_POST_URL_PREFIX)) return false;
  if (trimmed.length <= X_POST_URL_PREFIX.length) return false;
  if (trimmed.length > 512) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' && parsed.hostname === 'x.com';
  } catch {
    return false;
  }
}

function questTotalCostAsh(slotsTotal, rewardAsh) {
  return slotsTotal * rewardAsh + QUEST_LISTING_FEE_ASH;
}

module.exports = {
  X_POST_URL_PREFIX,
  QUEST_LISTING_FEE_ASH,
  QUEST_MIN_SLOTS,
  QUEST_MAX_SLOTS,
  QUEST_MIN_REWARD_ASH,
  QUEST_MAX_REWARD_ASH,
  FACTION_QUEST_TYPES,
  isValidXPostUrl,
  questTotalCostAsh,
};
