// game-server/scripts/check-party.js
const party = require('../party');

let failures = 0;

function section(name) {
  console.log(`\n${name}`);
}

function check(name, condition) {
  if (condition) {
    console.log(`  ok   ${name}`);
    return;
  }
  console.log(`  FAIL ${name}`);
  failures += 1;
}

const ROSTER = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X', 'Y', 'Z', 'Q'];

function reset() {
  for (const id of ROSTER) party.forgetPlayer(id);
  party.pruneInvites(Date.now() + party.INVITE_TTL_MS * 2);
}

// Everyone but the leader, enough to leave exactly one open seat.
function fillersFor(seatsToLeave) {
  return ROSTER.slice(1, party.MAX_PARTY_SIZE - seatsToLeave);
}

section('forming a party');
reset();
check('invite to yourself is refused', party.invite('A', 'A').error === 'self');
check('invite lands', party.invite('A', 'B').ok === true);
check('same invite twice is refused', party.invite('A', 'B').error === 'already_invited');
check('no party exists before the invite is answered', party.partyOf('A') === null);
check('accepting creates the party', party.accept('B', 'A').ok === true);
check('inviter leads', party.partyOf('A').leaderId === 'A');
check('roster holds both', party.membersOf('A').length === 2);

section('answering invites');
reset();
party.invite('A', 'B');
party.invite('C', 'B');
check('first accept works', party.accept('B', 'A').ok === true);
check('second invite is gone after joining', party.accept('B', 'C').error === 'no_invite');
check('inviting someone already grouped is refused', party.invite('C', 'B').error === 'target_in_party');
check('declining removes the invite', party.decline('B', 'C').ok === false);

section('size limit');
reset();
for (const id of fillersFor(1)) {
  party.invite('A', id);
  party.accept(id, 'A');
}

party.invite('A', 'Y');
party.invite('A', 'Z');
check('two invites go out while there is room', party.accept('Y', 'A').ok === true);
check(`party holds ${party.MAX_PARTY_SIZE}`, party.membersOf('A').length === party.MAX_PARTY_SIZE);
check('the invite left over cannot take a seat that filled up', party.accept('Z', 'A').error === 'full');
check('a full party cannot invite', party.invite('A', 'Q').error === 'full');

section('allies');
check('members are allies', party.areAllies('B', 'Y') === true);
check('outsiders are not', party.areAllies('B', 'Z') === false);
check('nobody is their own ally', party.areAllies('B', 'B') === false);

section('leaving and kicking');
check('a member cannot kick', party.kick('B', 'Y').error === 'not_leader');
check('the leader cannot kick themselves', party.kick('A', 'A').error === 'self');
check('the leader kicks', party.kick('A', 'Y').ok === true);
check('the kicked player is free', party.areAllies('A', 'Y') === false);
check('leaving passes leadership', party.leave('A').party.leaderId === 'B');

reset();
party.invite('A', 'B');
party.accept('B', 'A');
check('the last two shrink to nothing', party.leave('B').disbanded === true);
check('the survivor has no party', party.partyOf('A') === null);

section('disconnects and stale invites');
reset();
party.invite('A', 'B');
party.forgetPlayer('A');
check('an invite dies with the inviter', party.accept('B', 'A').error === 'no_invite');
party.invite('X', 'Y', Date.now() - party.INVITE_TTL_MS - 1000);
const expired = party.pruneInvites();
check('expired invites are pruned', expired.length === 1 && expired[0].targetId === 'Y');
check('a pruned invite cannot be accepted', party.accept('Y', 'X').error === 'no_invite');

if (failures > 0) {
  console.log(`\n${failures} party check(s) failed`);
  process.exit(1);
}

console.log('\nall party checks passed');
