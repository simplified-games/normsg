// ── PRESENCE ───────────────────────────────────────────────
let presenceUnsubs  = {};
let friendPresence  = {}; // uid -> { online, lastSeen }
let presenceTimer   = null;

function setPresence(online) {
if (!me) return;
db.collection('users').doc(me.uid).update({
online:   online,
lastSeen: SV()
}).catch(() => {});
}

function subscribePresence() {
if (document.hidden) return;
// Watch all friends' presence
friends.forEach(f => {
if (presenceUnsubs[f.uid]) return;
presenceUnsubs[f.uid] = db.collection('users').doc(f.uid)
.onSnapshot(snap => {
    const d = snap.data() || {};
    const ls = d.lastSeen?.toDate?.() || new Date(0);
    const isOnline = d.online === true && (Date.now() - ls) < 3 * 60000;
    friendPresence[f.uid] = { online: isOnline, lastSeen: ls };
    renderFriends();
    // Update chat header if this is the open DM
    if (chatType === 'dm' && chatId === dmId(me.uid, f.uid)) {
        updateChatSubStatus(isOnline, ls);
    }
});
});
// Unsub from removed friends
Object.keys(presenceUnsubs).forEach(uid => {
if (!friends.find(f => f.uid === uid)) {
presenceUnsubs[uid]();
delete presenceUnsubs[uid];
delete friendPresence[uid];
}
});
}

function pausePresenceSubscriptions() {
Object.values(presenceUnsubs).forEach(u => u && u());
presenceUnsubs = {};
}

function updateChatSubStatus(isOnline, lastSeen) {
const el = document.getElementById('chatSub');
if (!el || chatType !== 'dm') return;
const friend = friends.find(f => dmId(me.uid, f.uid) === chatId);
if (!friend) return;
if (isOnline) {
el.innerHTML = `<span class="ch-online">● Online</span>`;
} else {
const ago = timeAgo(lastSeen);
el.textContent = ago ? `Last seen ${ago}` : `@${friend.username||''}`;
}
}

function timeAgo(date) {
if (!date || !(date instanceof Date) || isNaN(date) || date < new Date('2020-01-01')) return '';
const s = Math.floor((Date.now() - date) / 1000);
if (s < 60)   return 'just now';
if (s < 3600) return `${Math.floor(s/60)}m ago`;
if (s < 86400) return `${Math.floor(s/3600)}h ago`;
return date.toLocaleDateString();
}

// ── TYPING INDICATORS ──────────────────────────────────────

// ── UNFRIEND ───────────────────────────────────────────────
async function unfriend(friendUid) {
if (!confirm('Remove this friend? This will hide your DM conversation too.')) return;
try {
// Find and delete the friendRequest doc
const q1 = await db.collection('friendRequests')
.where('fromUid','==', me.uid).where('toUid','==', friendUid).limit(1).get();
const q2 = await db.collection('friendRequests')
.where('fromUid','==', friendUid).where('toUid','==', me.uid).limit(1).get();
const batch = db.batch();
[...q1.docs, ...q2.docs].forEach(d => batch.delete(d.ref));
await batch.commit();

// Also hide DM if open
const cid = dmId(me.uid, friendUid);
const hidden = getHiddenDMs(); hidden.add(cid); saveHiddenDMs(hidden);
if (chatId === cid) closeChat();
showToast('Friend removed.');
} catch(e) {
showToast('Could not remove friend: ' + e.message);
}
}

// ── GROUP RENAME & ADMINS ──────────────────────────────────
let manageGroupId = null;

async function openManageGroup() {
if (chatType !== 'group' || !chatId) return;
manageGroupId = chatId;

const snap  = await db.collection('groups').doc(chatId).get();
const gdata = snap.data() || {};
const isOwner   = gdata.createdBy === me.uid;
const isAdmin   = (gdata.admins || []).includes(me.uid) || isOwner;
const adminOnly = gdata.addMembersAdminOnly === true;
const canAdd    = !adminOnly || isAdmin;

// Rename section: admins only
document.getElementById('grpRenameIn').value = gdata.name || '';
document.getElementById('grpRenameIn').disabled = !isAdmin;
document.querySelector('#manageGroupModal .btn-add').style.display = isAdmin ? '' : 'none';
mmsg('renameMsg','','');

// Add member section: based on permission setting
document.getElementById('addMemberIn').value = '';
document.getElementById('addMemberIn').disabled = !canAdd;
document.getElementById('addMemberIn').placeholder = canAdd ? 'username' : 'Admins only can add members';
mmsg('addMemberMsg','','');

// Show add-perm toggle for owners only
const permRow = document.getElementById('addPermRow');
if (isOwner) {
permRow.style.display = 'flex';
document.getElementById('addPermDesc').textContent = adminOnly ? 'Admins only can add' : 'Everyone can add';
document.getElementById('addPermBtn').textContent  = adminOnly ? 'Allow Everyone' : 'Admin Only';
} else {
permRow.style.display = 'none';
}

// Build member list — batch fetch
const el = document.getElementById('manageAdminList');
el.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:6px 0;">Loading…</div>';

const memberUids = gdata.members || [];
const admins     = gdata.admins  || [];
const owner      = gdata.createdBy;

const profiles = {};
for (let i = 0; i < memberUids.length; i += 10) {
const chunk = memberUids.slice(i, i+10);
if (!chunk.length) continue;
const s = await db.collection('users').where(firebase.firestore.FieldPath.documentId(),'in',chunk).get();
s.docs.forEach(d => { profiles[d.id] = d.data(); });
}

el.innerHTML = '';
for (const uid of memberUids) {
const udata       = profiles[uid] || {};
const isThisOwner = uid === owner;
const isThisAdmin = admins.includes(uid) || isThisOwner;
const isMe        = uid === me.uid;

const row = ce('div');
row.className = 'admin-row';
row.innerHTML = `
${mkAv(udata.displayName||'?', udata.photoURL||null, 28)}
<div class="admin-info">
    <div class="admin-name">${esc(udata.displayName||udata.username||'?')}</div>
    <div class="admin-tag">@${esc(udata.username||'')}</div>
</div>
${isThisOwner ? `<span class="owner-badge">Owner</span>` : isThisAdmin ? `<span class="admin-badge">Admin</span>` : ''}
${isOwner && !isThisOwner && !isMe ? `<button class="btn-toggle-admin" onclick="toggleAdmin('${uid}',${isThisAdmin})">${isThisAdmin ? 'Remove Admin' : 'Make Admin'}</button>` : ''}`;
el.appendChild(row);
}

document.getElementById('manageGroupModal').classList.remove('hidden');
// Load group roles section
if (manageGroupId) renderRolesSection(manageGroupId);
}

async function renameGroup() {
const newName = document.getElementById('grpRenameIn').value.trim();
if (!newName) return mmsg('renameMsg', 'Enter a group name.', 'err');
if (!manageGroupId) return;

const snap  = await db.collection('groups').doc(manageGroupId).get();
const gdata = snap.data() || {};
const isAdmin = (gdata.admins||[]).includes(me.uid) || gdata.createdBy === me.uid;
if (!isAdmin) return mmsg('renameMsg', 'Only admins can rename.', 'err');

await db.collection('groups').doc(manageGroupId).update({ name: newName });
document.getElementById('chatName').textContent = newName;
mmsg('renameMsg', `✓ Renamed to "${newName}"`, 'ok');
showToast('Group renamed!');
renderGroups();
}

async function toggleAdmin(uid, currentlyAdmin) {
if (!manageGroupId) return;
if (currentlyAdmin) {
await db.collection('groups').doc(manageGroupId).update({
admins: firebase.firestore.FieldValue.arrayRemove(uid)
});
showToast('Admin removed.');
} else {
await db.collection('groups').doc(manageGroupId).update({
admins: firebase.firestore.FieldValue.arrayUnion(uid)
});
showToast('Admin added! ⭐');
}
openManageGroup(); // refresh list
}

// ── EMOJI SEARCH (: trigger) ───────────────────────────────
const ALL_EMOJI = [
['😀','grinning face'],['😁','grin beaming'],['😂','joy tears laugh'],['🤣','rofl rolling'],
['😊','smile blushing'],['😍','heart eyes love'],['🥰','hearts smiling'],['😎','cool sunglasses'],
['🤔','thinking'],['😅','sweat smile'],['😆','laughing'],['😭','crying sob'],['😢','cry sad'],
['😡','angry rage'],['🤯','mind blown exploding'],['😴','sleeping tired'],['🥲','smile tear'],
['🥳','party face celebrating'],['🤝','handshake'],['👋','wave hello'],['👍','thumbs up like'],
['👎','thumbs down dislike'],['❤️','heart love red'],['🧡','orange heart'],['💛','yellow heart'],
['💚','green heart'],['💙','blue heart'],['💜','purple heart'],['🖤','black heart'],
['💔','broken heart'],['🔥','fire hot'],['✨','sparkles stars'],['🎉','party celebration tada'],
['🎊','confetti celebration'],['🎶','music notes'],['🎵','musical note'],['🚀','rocket launch'],
['⭐','star'],['🌟','glowing star'],['💫','dizzy star'],['💯','100 percent perfect'],
['✅','check green yes'],['❌','cross no wrong'],['⚡','lightning bolt fast'],['💥','explosion boom'],
['💧','droplet water'],['🌊','wave ocean'],['🌈','rainbow'],['🌙','moon night'],['☀️','sun sunny'],
['⛅','partly cloudy'],['❄️','snowflake cold'],['🌸','cherry blossom'],['🍀','four leaf clover'],
['👀','eyes watching'],['👁️','eye'],['💀','skull dead'],['💪','muscle strong flex'],
['🙏','pray hands please thank'],['🫡','salute'],['🤞','fingers crossed luck'],
['👏','clapping hands applause'],['🤦','facepalm'],['🤷','shrug whatever'],['😤','triumph snort'],
['😏','smirk'],['🙄','eye roll'],['😬','grimacing'],['🤗','hugging'],['😇','angel halo'],
['🤩','star struck'],['🥺','pleading eyes'],['😳','flushed embarrassed'],['😱','scream shocked'],
['🍕','pizza'],['🍔','burger'],['🍣','sushi'],['🧁','cupcake'],['🎂','birthday cake'],
['☕','coffee'],['🧋','bubble tea boba'],['🍵','tea'],['🍺','beer'],['🥤','drink cup'],
['🐶','dog puppy'],['🐱','cat kitten'],['🐸','frog'],['🦆','duck'],['🐧','penguin'],
['🦊','fox'],['🐻','bear'],['🦁','lion'],['🐼','panda'],['🐨','koala'],
['🥀','withered rose dead flower'],['🌹','rose flower'],['🌺','hibiscus flower'],['🌻','sunflower'],['🌷','tulip flower']
];

let colonStart = -1;
let esearchActive = false;

function checkColonTrigger(inp) {
const val    = inp.value;
const pos    = inp.selectionStart;
const before = val.slice(0, pos);
const cIdx   = before.lastIndexOf(':');
const box    = document.getElementById('emojiSearchBox');

if (cIdx !== -1) {
const afterColon = before.slice(cIdx + 1);
// Only activate if no space after the colon
if (!afterColon.includes(' ') && afterColon.length > 0) {
colonStart    = cIdx;
esearchActive = true;
const q = afterColon.toLowerCase();
document.getElementById('esearchIn').value = q;
searchEmoji(q);
box.style.display = 'block';
return;
}
}
// Close if not active
colonStart    = -1;
esearchActive = false;
box.style.display = 'none';
}

function searchEmoji(q) {
const res     = document.getElementById('esearchResults');
const matches = q
? ALL_EMOJI.filter(([, name]) => name.includes(q.toLowerCase())).slice(0, 36)
: ALL_EMOJI.slice(0, 36);

res.innerHTML = '';
if (!matches.length) {
res.innerHTML = `<span style="font-size:11px;color:var(--muted);padding:4px;">No match</span>`;
return;
}
matches.forEach(([em]) => {
const sp = ce('span');
sp.className   = 'esearch-item';
sp.textContent = em;
sp.title       = em;
sp.onmousedown = (e) => { e.preventDefault(); insertEmoji(em); };
res.appendChild(sp);
});
}

function insertEmoji(em) {
const inp = document.getElementById('msgInput');
const val = inp.value;
const pos = inp.selectionStart;
// Replace from colonStart to cursor with the emoji
inp.value = val.slice(0, colonStart) + em + val.slice(pos);
const np  = colonStart + [...em].length + 1;
inp.setSelectionRange(np, np);
document.getElementById('emojiSearchBox').style.display = 'none';
colonStart = -1; esearchActive = false;
inp.focus();
autoGrow(inp);
}

function onEsearchKey(e) {
// Let Enter/Tab select first result; Escape closes
if (e.key === 'Escape') {
document.getElementById('emojiSearchBox').style.display = 'none';
esearchActive = false;
document.getElementById('msgInput').focus();
}
}

// Close emoji box on outside click
document.addEventListener('click', (e) => {
if (!e.target.closest('#emojiSearchBox') && !e.target.closest('#msgInput')) {
const box = document.getElementById('emojiSearchBox');
if (box) { box.style.display = 'none'; esearchActive = false; colonStart = -1; }
}
});

