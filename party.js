// game-server/party.js
const MAX_PARTY_SIZE = 4;
const INVITE_TTL_MS = 60000;

const parties = new Map();
const partyByPlayer = new Map();
const invites = new Map();

let nextPartyId = 0;

function inviteKey(targetId, fromId) {
  return `${targetId}|${fromId}`;
}

function partyOf(playerId) {
  const partyId = partyByPlayer.get(playerId);
  return partyId ? parties.get(partyId) || null : null;
}

function membersOf(playerId) {
  const party = partyOf(playerId);
  return party ? party.memberIds.slice() : [];
}

function areAllies(aId, bId) {
  if (aId === bId) return false;
  const partyId = partyByPlayer.get(aId);
  return !!partyId && partyId === partyByPlayer.get(bId);
}

function isFull(party) {
  return party.memberIds.length >= MAX_PARTY_SIZE;
}

function dissolve(party) {
  for (const memberId of party.memberIds) {
    partyByPlayer.delete(memberId);
    for (const [key, record] of invites) {
      if (record.fromId === memberId) invites.delete(key);
    }
  }
  parties.delete(party.id);
}

function createParty(leaderId) {
  const id = `party-${nextPartyId++}`;
  const party = { id, leaderId, memberIds: [leaderId] };
  parties.set(id, party);
  partyByPlayer.set(leaderId, id);
  return party;
}

function invite(fromId, targetId, now = Date.now()) {
  if (fromId === targetId) return { ok: false, error: 'self' };
  if (partyByPlayer.has(targetId)) return { ok: false, error: 'target_in_party' };

  const party = partyOf(fromId);
  if (party && isFull(party)) return { ok: false, error: 'full' };

  const key = inviteKey(targetId, fromId);
  const existing = invites.get(key);
  if (existing && existing.expiresAt > now) return { ok: false, error: 'already_invited' };

  const record = { fromId, targetId, expiresAt: now + INVITE_TTL_MS };
  invites.set(key, record);

  return { ok: true, invite: record };
}

function accept(playerId, fromId, now = Date.now()) {
  const key = inviteKey(playerId, fromId);
  const record = invites.get(key);
  if (!record) return { ok: false, error: 'no_invite' };

  invites.delete(key);
  if (record.expiresAt <= now) return { ok: false, error: 'expired' };
  if (partyByPlayer.has(playerId)) return { ok: false, error: 'already_in_party' };

  let party = partyOf(fromId);
  if (party) {
    if (isFull(party)) return { ok: false, error: 'full' };
  } else {
    party = createParty(fromId);
  }

  party.memberIds.push(playerId);
  partyByPlayer.set(playerId, party.id);

  for (const [otherKey, other] of invites) {
    if (other.targetId === playerId) invites.delete(otherKey);
  }

  return { ok: true, party };
}

function decline(playerId, fromId) {
  const key = inviteKey(playerId, fromId);
  const record = invites.get(key);
  if (!record) return { ok: false, error: 'no_invite' };

  invites.delete(key);
  return { ok: true, invite: record };
}

function leave(playerId) {
  const party = partyOf(playerId);
  if (!party) return { party: null, disbanded: false, removed: false };

  party.memberIds = party.memberIds.filter((id) => id !== playerId);
  partyByPlayer.delete(playerId);

  if (party.memberIds.length <= 1) {
    const remaining = party.memberIds.slice();
    dissolve(party);
    return { party, disbanded: true, removed: true, remaining };
  }

  if (party.leaderId === playerId) party.leaderId = party.memberIds[0];

  return { party, disbanded: false, removed: true, remaining: party.memberIds.slice() };
}

function kick(leaderId, targetId) {
  const party = partyOf(leaderId);
  if (!party) return { ok: false, error: 'no_party' };
  if (party.leaderId !== leaderId) return { ok: false, error: 'not_leader' };
  if (targetId === leaderId) return { ok: false, error: 'self' };
  if (!party.memberIds.includes(targetId)) return { ok: false, error: 'not_member' };

  const result = leave(targetId);
  return { ok: true, party, ...result };
}

function forgetPlayer(playerId) {
  for (const [key, record] of invites) {
    if (record.fromId === playerId || record.targetId === playerId) invites.delete(key);
  }
  return leave(playerId);
}

function pruneInvites(now = Date.now()) {
  const expired = [];
  for (const [key, record] of invites) {
    if (record.expiresAt <= now) {
      invites.delete(key);
      expired.push(record);
    }
  }
  return expired;
}

function activeParties() {
  return Array.from(parties.values()).filter((party) => party.memberIds.length > 1);
}

module.exports = {
  MAX_PARTY_SIZE,
  INVITE_TTL_MS,
  partyOf,
  membersOf,
  areAllies,
  invite,
  accept,
  decline,
  leave,
  kick,
  forgetPlayer,
  pruneInvites,
  activeParties,
};
