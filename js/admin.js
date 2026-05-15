// ── NORMSG SUPER & ADMIN SYSTEM ────────────────────────────
// Platform owner email — hardcoded, can never be changed by others
const OWNER_EMAIL = 'simplifiedlearning10@gmail.com';
let isPlatformAdmin = false;
let superCache = {}; // uid -> bool, cached for rendering
let ultraCache = {}; // uid -> bool, cached for rendering (NorMULTRA)
let superLastLoadedAt = 0;
let superLastFriendKey = '';
let superLoadInFlight = null;

async function initAdminSystem() {
// Check if current user is platform admin (owner or granted admin)
const isOwner = me.email?.toLowerCase() === OWNER_EMAIL.toLowerCase();
if (isOwner) {
isPlatformAdmin = true;
} else {
const adminDoc = await db.collection('platformAdmins').doc(me.uid).get();
isPlatformAdmin = adminDoc.exists;
}
// Platform admins always get Ultra (highest tier)
if (isPlatformAdmin) {
userPlan = 'ultra';
updateNormAIBadge();
}

const adminBtn = document.getElementById('adminBtn');
if (adminBtn) {
adminBtn.classList.toggle('non-admin', !isPlatformAdmin);
adminBtn.title = isPlatformAdmin ? 'Admin Panel' : 'Admin tools info';
}

// Cache Super status for all friends for rendering
await refreshSuperCache();

// Check weekly leaderboard and auto-grant Super to top chatter
checkWeeklyLeaderboard();
}

function handleAdminBtnClick() {
if (isPlatformAdmin) {
openAdminPanel();
return;
}
showToast('Admin panel is for platform admins only. Ask an admin for access.');
}

async function hasSuper(uid) {
const cacheFresh = (Date.now() - superLastLoadedAt) < 45000;
if (cacheFresh && Object.prototype.hasOwnProperty.call(superCache, uid)) {
return superCache[uid] === true;
}
try {
const snap = await db.collection('users').doc(uid).get();
const until = snap.data()?.normsgSuper?.until?.toDate?.();
const isActive = !!(until && until > new Date());
superCache[uid] = isActive;
return isActive;
} catch { return false; }
}

async function hasUltra(uid) {
const cacheFresh = (Date.now() - superLastLoadedAt) < 45000;
if (cacheFresh && Object.prototype.hasOwnProperty.call(ultraCache, uid)) {
return ultraCache[uid] === true;
}
try {
const snap = await db.collection('users').doc(uid).get();
const until = snap.data()?.normsgUltra?.until?.toDate?.();
const isActive = !!(until && until > new Date());
ultraCache[uid] = isActive;
return isActive;
} catch { return false; }
}

async function refreshSuperCache({ force = false } = {}) {
const uids = [me.uid, ...friends.map(f => f.uid)];
const uniqueUids = [...new Set(uids)];
const friendKey = uniqueUids.slice().sort().join('|');
const cacheFresh = (Date.now() - superLastLoadedAt) < 45000 && friendKey === superLastFriendKey;
if (!force && cacheFresh) {
renderFriends();
return;
}
if (superLoadInFlight) return superLoadInFlight;

const nextCache = {};
const nextUltraCache = {};
superLoadInFlight = (async () => {
for (let i = 0; i < uniqueUids.length; i += 10) {
const chunk = uniqueUids.slice(i, i + 10);
if (!chunk.length) continue;
const snap = await db.collection('users')
    .where(firebase.firestore.FieldPath.documentId(), 'in', chunk)
    .get();
snap.docs.forEach(d => {
    const superUntil = d.data()?.normsgSuper?.until?.toDate?.();
    const ultraUntil = d.data()?.normsgUltra?.until?.toDate?.();
    nextCache[d.id]      = !!(superUntil && superUntil > new Date());
    nextUltraCache[d.id] = !!(ultraUntil && ultraUntil > new Date());
});
}
uniqueUids.forEach(uid => {
    superCache[uid] = nextCache[uid] || false;
    ultraCache[uid] = nextUltraCache[uid] || false;
});
superLastLoadedAt = Date.now();
superLastFriendKey = friendKey;
})();

try {
await superLoadInFlight;
} finally {
superLoadInFlight = null;
}

// Promote plan: Ultra > Super/Pro > Pro > Free
// Ultra users get ultra plan; Super/Pro users get pro plan (bidirectional)
if (ultraCache[me.uid]) {
    userPlan = 'ultra';
    updateNormAIBadge();
} else if (superCache[me.uid] && userPlan === 'free') {
    userPlan = 'pro';   // Super members automatically get Pro
    updateNormAIBadge();
}

// Show correct badge on my own profile row
const myBadge = document.getElementById('mySuperBadge');
const myHandle = document.getElementById('myHandle');
if (ultraCache[me.uid]) {
if (myBadge) { myBadge.style.display = 'block'; myBadge.innerHTML = '<span class="ultra-badge">⚡ ULTRA</span>'; }
if (myHandle) myHandle.innerHTML = `<span class="ultra-name">@${myUsername}</span>`;
} else if (superCache[me.uid] || userPlan === 'pro') {
if (myBadge) { myBadge.style.display = 'block'; myBadge.innerHTML = '<span class="super-badge">✦ SUPER</span>'; }
if (myHandle) myHandle.innerHTML = `<span class="super-name">@${myUsername}</span>`;
} else {
if (myBadge) myBadge.style.display = 'none';
if (myHandle) myHandle.textContent = `@${myUsername}`;
}
renderFriends();
}


// ── VIEW USER PROFILE ──────────────────────────────────────
let _vpTargetUid = null;
let _vpTargetFriend = null;  // friend object if they're a friend

async function openUserProfile(uid, displayName, photoURL, username) {
    if (!uid || uid === me.uid) return;
    _vpTargetUid = uid;
    _vpTargetFriend = null;

    // Reset modal
    const avEl = document.getElementById('vpAv');
    avEl.innerHTML = photoURL
        ? `<img src="${esc(photoURL)}" alt="">`
        : initials(displayName || '?');
    document.getElementById('vpName').textContent   = displayName || '?';
    document.getElementById('vpHandle').textContent = username ? '@' + username : '';
    document.getElementById('vpBio').innerHTML      = '<span class="vp-bio-empty">Loading…</span>';
    document.getElementById('vpMutualFriends').innerHTML = '<span class="vp-empty-hint">Loading…</span>';
    document.getElementById('vpMutualGroups').innerHTML  = '<span class="vp-empty-hint">Loading…</span>';

    // Show/hide DM button based on friendship
    const isFriend = friends.some(f => f.uid === uid);
    _vpTargetFriend = friends.find(f => f.uid === uid) || null;
    const dmBtn = document.getElementById('vpDmBtn');
    dmBtn.style.display = isFriend ? 'block' : 'none';

    document.getElementById('viewProfileModal').classList.remove('hidden');

    // Load bio from Firestore
    try {
        const snap = await getCachedProfile(uid);
        const bio  = snap?.bio || '';
        const bioEl = document.getElementById('vpBio');
        if (bio) {
            bioEl.textContent = bio;
            bioEl.classList.remove('vp-bio-empty');
        } else {
            bioEl.innerHTML = '<span class="vp-bio-empty">No bio yet.</span>';
        }
        // Update name/photo in case cache had stale data
        const fresh = snap?.displayName || displayName;
        document.getElementById('vpName').textContent = fresh;
        if (snap?.photoURL) {
            avEl.innerHTML = `<img src="${esc(snap.photoURL)}" alt="">`;
        }
        // Show ultra or super badge if applicable
        const ultraUntil = snap?.normsgUltra?.until?.toDate?.();
        const superUntil = snap?.normsgSuper?.until?.toDate?.();
        if (ultraUntil && ultraUntil > new Date()) {
            document.getElementById('vpName').innerHTML =
                `<span class="ultra-name">${esc(fresh)}</span> <span class="ultra-badge">⚡ ULTRA</span>`;
        } else if (superUntil && superUntil > new Date()) {
            document.getElementById('vpName').innerHTML =
                `<span class="super-name">${esc(fresh)}</span> <span class="super-badge">✦ SUPER</span>`;
        }
    } catch(e) {
        document.getElementById('vpBio').innerHTML = '<span class="vp-bio-empty">Could not load bio.</span>';
    }

    // Mutual friends
    try {
        const mutualEl = document.getElementById('vpMutualFriends');
        // Their friends — fetch from both directions
        const [q1, q2] = await Promise.all([
            db.collection('friendRequests').where('fromUid','==',uid).where('status','==','accepted').limit(30).get(),
            db.collection('friendRequests').where('toUid','==',uid).where('status','==','accepted').limit(30).get()
        ]);
        const theirFriendUids = new Set();
        q1.docs.forEach(d => theirFriendUids.add(d.data().toUid));
        q2.docs.forEach(d => theirFriendUids.add(d.data().fromUid));

        const mutuals = friends.filter(f => theirFriendUids.has(f.uid));
        if (!mutuals.length) {
            mutualEl.innerHTML = '<span class="vp-empty-hint">No mutual friends.</span>';
        } else {
            mutualEl.innerHTML = '';
            mutuals.slice(0, 12).forEach(f => {
                const pill = ce('div');
                pill.className = 'vp-pill';
                pill.innerHTML = mkAv(f.displayName, f.photoURL, 20) + `<span>${esc(f.displayName)}</span>`;
                pill.onclick = () => {
                    closeModal('viewProfileModal');
                    openDM(f);
                };
                mutualEl.appendChild(pill);
            });
            if (mutuals.length > 12) {
                const more = ce('span');
                more.className = 'vp-empty-hint';
                more.textContent = `+${mutuals.length - 12} more`;
                mutualEl.appendChild(more);
            }
        }
    } catch(e) {
        document.getElementById('vpMutualFriends').innerHTML = '<span class="vp-empty-hint">Could not load.</span>';
    }

    // Mutual group chats
    try {
        const grpEl = document.getElementById('vpMutualGroups');
        const mutualGroups = myGroups.filter(g => (g.members || []).includes(uid));
        if (!mutualGroups.length) {
            grpEl.innerHTML = '<span class="vp-empty-hint">No mutual group chats.</span>';
        } else {
            grpEl.innerHTML = '';
            mutualGroups.forEach(g => {
                const pill = ce('div');
                pill.className = 'vp-grp-pill';
                pill.innerHTML = `
                    <div class="vp-grp-icon">${esc((g.name[0]||'G').toUpperCase())}</div>
                    <div style="min-width:0;flex:1;">
                        <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(g.name)}</div>
                        <div style="font-size:11px;color:var(--muted);">${g.members?.length||0} members</div>
                    </div>
                    <span style="font-size:11px;color:var(--a2);font-weight:700;">Open →</span>`;
                pill.onclick = () => {
                    closeModal('viewProfileModal');
                    openGroup(g);
                    switchTab('groups');
                };
                grpEl.appendChild(pill);
            });
        }
    } catch(e) {
        document.getElementById('vpMutualGroups').innerHTML = '<span class="vp-empty-hint">Could not load.</span>';
    }
}

function openDMFromProfile() {
    if (!_vpTargetFriend) return;
    closeModal('viewProfileModal');
    switchTab('dms');
    openDM(_vpTargetFriend);
}

// ── WEEKLY MESSAGE COUNT ────────────────────────────────────
function incrementWeeklyCount() {
if (!me) return;
const weekKey = getWeekKey();
db.collection('users').doc(me.uid).set({
weeklyCount:  firebase.firestore.FieldValue.increment(1),
weeklyKey:    weekKey
}, { merge: true }).catch(()=>{});
}

function getWeekKey() {
const d = new Date();
const jan1 = new Date(d.getFullYear(), 0, 1);
const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
return `${d.getFullYear()}-W${week}`;
}

async function checkWeeklyLeaderboard() {
try {
const weekKey = getWeekKey();
const snap = await db.collection('users')
.where('weeklyKey','==', weekKey)
.orderBy('weeklyCount','desc')
.limit(1).get();
if (snap.empty) return;
const top = snap.docs[0];
if (top.id === me.uid) {
// I'm the top chatter — auto-grant 1 month Super if not already
const current = await hasSuper(me.uid);
if (!current) {
    await grantSuperToUid(me.uid, 30);
    showToast('🏆 You\'re the top chatter this week! Enjoy 1 month of NorMSG Super! ✦');
    await refreshSuperCache();
}
}
} catch(e) { /* needs weeklyCount index — will work after first message */ }
}

async function grantSuperToUid(uid, days) {
const until = new Date(Date.now() + days * 86400000);
await db.collection('users').doc(uid).set({
normsgSuper: { until: TS.fromDate(until), days, grantedAt: SV() }
}, { merge: true });
}

async function grantUltraToUid(uid, days) {
const until = new Date(Date.now() + days * 86400000);
await db.collection('users').doc(uid).set({
normsgUltra: { until: TS.fromDate(until), days, grantedAt: SV() },
plan: 'ultra'
}, { merge: true });
}

// ── ADMIN PANEL ─────────────────────────────────────────────
async function openAdminPanel() {
if (!isPlatformAdmin) return;
mmsg('giftMsg','','');
mmsg('giftAdminMsg','','');
mmsg('annMsg','','');
document.getElementById('giftSuperIn').value  = '';
document.getElementById('giftAdminIn').value  = '';
document.getElementById('annTextIn').value    = '';
document.getElementById('adminModal').classList.remove('hidden');
loadLeaderboard();
loadActiveAnnPreview();
}

// ── ANNOUNCEMENTS ────────────────────────────────────────────
const ANN_STYLES = {
info:    { bg: 'linear-gradient(90deg,#1e40af,#3b82f6)', color: '#fff' },
warn:    { bg: 'linear-gradient(90deg,#92400e,#f59e0b)', color: '#fff' },
danger:  { bg: 'linear-gradient(90deg,#9f1239,#f43f5e)', color: '#fff' },
success: { bg: 'linear-gradient(90deg,#065f46,#34d399)', color: '#fff' },
};

async function postAnnouncement() {
if (!isPlatformAdmin) return;
const text  = document.getElementById('annTextIn').value.trim();
const hours = parseInt(document.getElementById('annDuration').value);
const style = document.getElementById('annStyle').value;
if (!text) return mmsg('annMsg', 'Enter an announcement message.', 'err');
mmsg('annMsg', 'Posting…', 'inf');
try {
const expiresAt = new Date(Date.now() + hours * 3600000);
await db.collection('siteConfig').doc('announcement').set({
    text, style, hours,
    expiresAt: TS.fromDate(expiresAt),
    postedBy:  me.uid,
    postedAt:  SV(),
});
mmsg('annMsg', `✓ Announcement posted for ${hours < 24 ? hours+'h' : (hours/24)+'d'}!`, 'ok');
document.getElementById('annTextIn').value = '';
loadActiveAnnPreview();
checkAnnouncement(); // show it immediately
} catch(e) { mmsg('annMsg', 'Error: ' + e.message, 'err'); }
}

async function cancelAnnouncement() {
if (!isPlatformAdmin) return;
try {
await db.collection('siteConfig').doc('announcement').delete();
document.getElementById('activeAnnPreview').innerHTML = '';
hideAnnouncementBanner();
mmsg('annMsg', 'Announcement removed.', 'ok');
} catch(e) { mmsg('annMsg', 'Error: ' + e.message, 'err'); }
}

async function loadActiveAnnPreview() {
const el = document.getElementById('activeAnnPreview');
try {
const snap = await db.collection('siteConfig').doc('announcement').get();
if (!snap.exists) { el.innerHTML = ''; return; }
const d = snap.data();
const expires = d.expiresAt?.toDate?.();
if (!expires || expires < new Date()) { el.innerHTML = ''; return; }
const s = ANN_STYLES[d.style] || ANN_STYLES.info;
const timeLeft = timeUntil(expires);
el.innerHTML = `
    <div style="background:${s.bg};color:${s.color};border-radius:10px;padding:9px 13px;
        font-size:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span style="flex:1;font-weight:600;">Active: "${esc(d.text)}"</span>
        <span style="opacity:0.75;font-size:11px;">Expires in ${timeLeft}</span>
        <button onclick="cancelAnnouncement()" style="
            background:rgba(0,0,0,0.25);border:none;color:inherit;border-radius:8px;
            padding:3px 10px;font-size:11px;cursor:pointer;font-family:'Figtree',sans-serif;
            font-weight:700;white-space:nowrap;">✕ Remove</button>
    </div>`;
} catch(e) { el.innerHTML = ''; }
}

function timeUntil(date) {
const ms = date - new Date();
if (ms <= 0) return 'expired';
const h = Math.floor(ms / 3600000);
const m = Math.floor((ms % 3600000) / 60000);
if (h >= 24) return Math.floor(h/24) + 'd ' + (h%24) + 'h';
if (h > 0)   return h + 'h ' + m + 'm';
return m + 'm';
}

async function checkAnnouncement() {
// Called on login and periodically — shows banner if active announcement exists
try {
const snap = await db.collection('siteConfig').doc('announcement').get();
if (!snap.exists) { hideAnnouncementBanner(); return; }
const d = snap.data();
const expires = d.expiresAt?.toDate?.();
if (!expires || expires < new Date()) { hideAnnouncementBanner(); return; }

// Check if user already dismissed this specific announcement
const dismissKey = 'normsg_ann_dismissed_' + (d.postedAt?.seconds || '');
if (localStorage.getItem(dismissKey)) { hideAnnouncementBanner(); return; }

showAnnouncementBanner(d.text, d.style, dismissKey);
} catch(e) { /* silently ignore */ }
}

function showAnnouncementBanner(text, style, dismissKey) {
const banner = document.getElementById('annBanner');
const s = ANN_STYLES[style] || ANN_STYLES.info;
banner.style.background = s.bg;
banner.style.color      = s.color;
document.getElementById('annBannerText').textContent = text;
banner._dismissKey = dismissKey;
banner.style.display = 'flex';
// Push content down so banner doesn't cover the landing card / sidebar
document.body.style.paddingTop = banner.offsetHeight + 'px';
}

function hideAnnouncementBanner() {
const banner = document.getElementById('annBanner');
banner.style.display = 'none';
document.body.style.paddingTop = '';
}

function dismissAnnouncement() {
const banner = document.getElementById('annBanner');
if (banner._dismissKey) {
try { localStorage.setItem(banner._dismissKey, '1'); } catch {}
}
hideAnnouncementBanner();
}

async function loadLeaderboard() {
const el = document.getElementById('adminLeaderboard');
try {
const weekKey = getWeekKey();
const snap = await db.collection('users')
.where('weeklyKey','==',weekKey)
.orderBy('weeklyCount','desc')
.limit(5).get();
if (snap.empty) { el.textContent = 'No messages this week yet.'; return; }
el.innerHTML = snap.docs.map((d,i) => {
const data = d.data();
const medals = ['🥇','🥈','🥉','4️⃣','5️⃣'];
return `<div style="padding:5px 0;display:flex;gap:8px;align-items:center;">
    <span style="font-size:16px;">${medals[i]}</span>
    <span style="font-size:12px;font-weight:600;">${esc(data.displayName||data.username||'?')}</span>
    <span style="font-size:11px;color:var(--muted);">@${esc(data.username||'')}</span>
    <span style="font-size:11px;color:var(--a2);margin-left:auto;">${data.weeklyCount||0} msgs</span>
</div>`;
}).join('');
} catch(e) {
el.textContent = 'Could not load (may need Firestore index on weeklyCount).';
}
}

async function giftSuper() {
const uname = document.getElementById('giftSuperIn').value.trim().toLowerCase().replace('@','');
const days  = parseInt(document.getElementById('giftDuration').value);
if (!uname) return;
mmsg('giftMsg','Looking up user…','inf');
try {
const uid = await getCachedUid(uname);
if (!uid) return mmsg('giftMsg',`@${uname} not found.`,'err');
await grantSuperToUid(uid, days);
mmsg('giftMsg', `✓ NorMSG Super gifted to @${uname} for ${days} day${days!==1?'s':''}! ✦`, 'ok');
document.getElementById('giftSuperIn').value = '';
superCache[uid] = true;
renderFriends();
} catch(e) { mmsg('giftMsg','Error: '+e.message,'err'); }
}

async function giftUltra() {
const uname = document.getElementById('giftUltraIn').value.trim().toLowerCase().replace('@','');
const days  = parseInt(document.getElementById('giftUltraDuration').value);
if (!uname) return;
mmsg('giftUltraMsg','Looking up user…','inf');
try {
const uid = await getCachedUid(uname);
if (!uid) return mmsg('giftUltraMsg',`@${uname} not found.`,'err');
await grantUltraToUid(uid, days);
mmsg('giftUltraMsg', `✓ NorMULTRA gifted to @${uname} for ${days} day${days!==1?'s':''}! ⚡`, 'ok');
document.getElementById('giftUltraIn').value = '';
ultraCache[uid] = true;
superCache[uid] = true; // Ultra implies Super
renderFriends();
} catch(e) { mmsg('giftUltraMsg','Error: '+e.message,'err'); }
}

async function giftAdmin() {
const uname = document.getElementById('giftAdminIn').value.trim().toLowerCase().replace('@','');
if (!uname) return;
mmsg('giftAdminMsg','Looking up user…','inf');
try {
const uid = await getCachedUid(uname);
if (!uid) return mmsg('giftAdminMsg',`@${uname} not found.`,'err');
await db.collection('platformAdmins').doc(uid).set({ grantedBy: me.uid, grantedAt: SV() });
mmsg('giftAdminMsg',`✓ @${uname} is now a platform admin!`,'ok');
document.getElementById('giftAdminIn').value = '';
} catch(e) { mmsg('giftAdminMsg','Error: '+e.message,'err'); }
}

function showToast(msg) {
const t = document.getElementById('toast');
t.textContent = msg; t.classList.add('show');
setTimeout(()=>t.classList.remove('show'), 3000);
}

// ── @ MENTION SYSTEM ───────────────────────────────────────
let mentionSearch  = null; // current search string after @
let mentionStart   = -1;   // cursor pos where @ was typed
let mentionIndex   = 0;    // selected item index
let mentionMembers = [];   // group members for suggestions

function onMsgInputChange() {
if (!chatId || !me) return;

const inp = document.getElementById('msgInput');

// : emoji search
checkColonTrigger(inp);

// @ mention detection (groups only)
if (chatType !== 'group') return;
const val = inp.value;
const pos = inp.selectionStart;
const before = val.slice(0, pos);
const atIdx  = before.lastIndexOf('@');
if (atIdx !== -1 && !before.slice(atIdx+1).includes(' ')) {
mentionSearch = before.slice(atIdx+1).toLowerCase();
mentionStart  = atIdx;
showMentionBox();
} else {
hideMentionBox();
}
}

async function showMentionBox() {
// Get group members if not cached
if (!mentionMembers.length && chatId) {
const snap = await db.collection('groups').doc(chatId).get();
const uids = (snap.data()?.members || []).filter(u => u !== me.uid);
const chunks = [];
for (let i = 0; i < uids.length; i+=10) chunks.push(uids.slice(i,i+10));
mentionMembers = [];
for (const chunk of chunks) {
if (!chunk.length) continue;
const s = await db.collection('users').where(firebase.firestore.FieldPath.documentId(),'in',chunk).get();
s.docs.forEach(d => mentionMembers.push({ uid: d.id, ...d.data() }));
}
}

const filtered = [
// Always include @AI as first option in groups
{ uid: 'AI', username: 'AI', displayName: '✦ AI Assistant', photoURL: null, isAI: true },
...mentionMembers.filter(u =>
(u.username||'').toLowerCase().startsWith(mentionSearch) ||
(u.displayName||'').toLowerCase().startsWith(mentionSearch)
)
].filter(u => u.isAI
? 'ai'.startsWith(mentionSearch)
: true
).slice(0, 7);

const box = document.getElementById('mentionBox');
if (!filtered.length) { box.style.display='none'; return; }

box.innerHTML = '';
mentionIndex = 0;
filtered.forEach((u, i) => {
const it = ce('div');
it.className = 'mention-item' + (i===0?' active':'');
it.innerHTML = `${mkAv(u.displayName||'?', u.photoURL||null, 26)}<div><div class="mention-name">${esc(u.displayName||'')}</div><div class="mention-handle">@${esc(u.username||'')}</div></div>`;
it.onmousedown = (e) => { e.preventDefault(); insertMention(u.username); };
box.appendChild(it);
});
box.style.display = 'block';
box._filtered = filtered;
}

function hideMentionBox() {
document.getElementById('mentionBox').style.display = 'none';
mentionSearch = null; mentionStart = -1;
}

function insertMention(username) {
const inp = document.getElementById('msgInput');
const val = inp.value;
const before = val.slice(0, mentionStart);
const after  = val.slice(inp.selectionStart);
inp.value = before + '@' + username + ' ' + after;
const newPos = before.length + username.length + 2;
inp.setSelectionRange(newPos, newPos);
hideMentionBox();
inp.focus();
}

// Handle keyboard nav in mention box
document.addEventListener('keydown', (e) => {
const box = document.getElementById('mentionBox');
if (!box || box.style.display==='none') return;
const items = box.querySelectorAll('.mention-item');
if (!items.length) return;
if (e.key === 'ArrowDown') { e.preventDefault(); mentionIndex = (mentionIndex+1)%items.length; items.forEach((it,i)=>it.classList.toggle('active',i===mentionIndex)); }
else if (e.key === 'ArrowUp') { e.preventDefault(); mentionIndex = (mentionIndex-1+items.length)%items.length; items.forEach((it,i)=>it.classList.toggle('active',i===mentionIndex)); }
else if (e.key === 'Tab' || (e.key==='Enter' && box.style.display!=='none')) {
const u = box._filtered?.[mentionIndex];
if (u) { e.preventDefault(); insertMention(u.username); }
} else if (e.key === 'Escape') { hideMentionBox(); }
});

// Render message text — parses lightweight markdown + @mentions
function renderMsgText(text) {
if (!text) return '';
// Escape HTML first, then apply formatting
let out = esc(text);

// Heading: line starting with # (must be at start of line)
out = out.replace(/(^|<br>)#[ \t]+(.+)/g, '$1<span class="msg-heading">$2</span>');

// Bold: **text** or __text__
out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
out = out.replace(/__(.+?)__/g, '<strong>$1</strong>');

// Italic: *text* or _text_ (single, not double)
out = out.replace(/\*(?!\*)(.+?)(?<!\*)\*/g, '<em>$1</em>');
out = out.replace(/_(?!_)(.+?)(?<!_)_/g, '<em>$1</em>');

// Inline code: `text`
out = out.replace(/`([^`]+)`/g, '<code>$1</code>');

// Newlines → <br>
out = out.replace(/\n/g, '<br>');

// Clickable links — sanitized
out = out.replace(/(https?:\/\/[^\s&lt;&gt;"]+)/g, (url) => {
const safe = sanitizeUrl(url);
return `<a href="${safe}" target="_blank" rel="noopener noreferrer" style="color:var(--a2);text-decoration:underline;">${url}</a>`;
});

// @mentions
out = out.replace(/@([a-z0-9_.]+)/gi, (match, uname) => {
const isMe = uname.toLowerCase() === (myUsername||'').toLowerCase();
return `<span class="ping-highlight${isMe?' me':''}">${match}</span>`;
});

return out;
}

// Apply formatting to selected text in the textarea (or wrap cursor)
function applyFmt(type) {
const inp = document.getElementById('msgInput');
const start = inp.selectionStart;
const end   = inp.selectionEnd;
const val   = inp.value;
const sel   = val.slice(start, end);
let wrap = ['',''];

if (type === 'bold')    wrap = ['**','**'];
if (type === 'italic')  wrap = ['_','_'];
if (type === 'code')    wrap = ['`','`'];
if (type === 'heading') {
// Insert # at start of the current line
const lineStart = val.lastIndexOf('\n', start - 1) + 1;
const lineText  = val.slice(lineStart);
if (lineText.startsWith('# ')) {
// Remove heading
inp.value = val.slice(0, lineStart) + lineText.slice(2);
} else {
inp.value = val.slice(0, lineStart) + '# ' + val.slice(lineStart);
inp.setSelectionRange(start + 2, end + 2);
}
inp.focus();
autoGrow(inp);
return;
}

if (sel) {
// Wrap selection
inp.value = val.slice(0, start) + wrap[0] + sel + wrap[1] + val.slice(end);
inp.setSelectionRange(start + wrap[0].length, end + wrap[0].length);
} else {
// Place cursor between markers
inp.value = val.slice(0, start) + wrap[0] + wrap[1] + val.slice(start);
inp.setSelectionRange(start + wrap[0].length, start + wrap[0].length);
}
inp.focus();
autoGrow(inp);
}

function updateFmtToolbar(inp) {
// Highlight toolbar buttons based on what's around the cursor
const val = inp.value.slice(0, inp.selectionEnd);
document.getElementById('fmtBold').classList.toggle('active', /\*\*[^*]*$/.test(val));
document.getElementById('fmtItalic').classList.toggle('active', /_[^_]*$/.test(val));
document.getElementById('fmtCode').classList.toggle('active', /`[^`]*$/.test(val));
}

// ── FIX PEOPLE DISCOVERY — standalone sendFriendReqTo ──────
async function sendFriendReqTo(username, btn) {
if (!username) return;
btn.disabled = true; btn.textContent = '…';
try {
const targetUid = await getCachedUid(username);
if (!targetUid) { btn.textContent = '✗ Not found'; return; }
const alreadyFriend = friends.some(f => f.uid === targetUid);
if (alreadyFriend) { btn.textContent = '✓ Friends'; btn.disabled = true; return; }
const dup = await db.collection('friendRequests')
.where('fromUid','==',me.uid).where('toUid','==',targetUid).where('status','==','pending').limit(1).get();
if (!dup.empty) { btn.textContent = '✓ Sent'; return; }
const updata = await getCachedProfile(targetUid) || {};
await db.collection('friendRequests').add({
fromUid: me.uid, fromName: me.displayName||me.email, fromUsername: myUsername, fromPhoto: me.photoURL||null,
toUid: targetUid, toName: updata.displayName||updata.email, toUsername: updata.username||'', toPhoto: updata.photoURL||null,
status: 'pending', createdAt: SV()
});
btn.textContent = '✓ Sent';
showToast(`Request sent! 🎉`);
} catch(e) { btn.textContent = '✗ Error'; console.error(e); }
}

// ── ADD MEMBER TO GROUP ────────────────────────────────────
async function addMemberToGroup() {
const uname = document.getElementById('addMemberIn').value.trim().toLowerCase().replace('@','');
if (!uname) return;
mmsg('addMemberMsg','','');

// Check permission
const gSnap = await db.collection('groups').doc(manageGroupId).get();
const gdata = gSnap.data() || {};
const isOwner = gdata.createdBy === me.uid;
const isAdmin = (gdata.admins||[]).includes(me.uid) || isOwner;
const adminOnly = gdata.addMembersAdminOnly === true;
if (adminOnly && !isAdmin) return mmsg('addMemberMsg','Only admins can add members.','err');

const targetUid = await getCachedUid(uname);
if (!targetUid) return mmsg('addMemberMsg',`@${uname} not found.`,'err');

if ((gdata.members||[]).includes(targetUid)) return mmsg('addMemberMsg','Already a member!','err');

await db.collection('groups').doc(manageGroupId).update({
members: firebase.firestore.FieldValue.arrayUnion(targetUid)
});
document.getElementById('addMemberIn').value = '';
mmsg('addMemberMsg',`✓ @${uname} added!`,'ok');
showToast(`@${uname} added to group!`);
mentionMembers = []; // reset cache
openManageGroup(); // refresh
}

// ── TOGGLE ADD PERMISSION ──────────────────────────────────
async function toggleAddPerm() {
const gSnap = await db.collection('groups').doc(manageGroupId).get();
const cur   = gSnap.data()?.addMembersAdminOnly === true;
await db.collection('groups').doc(manageGroupId).update({ addMembersAdminOnly: !cur });
document.getElementById('addPermDesc').textContent = !cur ? 'Admins only can add' : 'Everyone can add';
document.getElementById('addPermBtn').textContent  = !cur ? 'Allow Everyone' : 'Admin Only';
showToast(!cur ? 'Now admin-only adding.' : 'Everyone can now add members.');
}
async function openPeopleModal() {
document.getElementById('peopleModal').classList.remove('hidden');
const el = document.getElementById('peopleList');
el.innerHTML = `<div style="text-align:center;padding:28px;color:var(--muted);font-size:13px;">🔍 Loading suggestions…</div>`;

try {
const myFriendUids = new Set(friends.map(f => f.uid));
myFriendUids.add(me.uid);

// discovered[uid] = { degree, via[] }
const discovered = {};

// Degree-2: friends of my friends
for (const f of friends.slice(0, 12)) {
const [q1, q2] = await Promise.all([
    db.collection('friendRequests')
        .where('fromUid','==',f.uid).where('status','==','accepted').limit(20).get(),
    db.collection('friendRequests')
        .where('toUid','==',f.uid).where('status','==','accepted').limit(20).get()
]);
const fof = new Set();
q1.docs.forEach(d => fof.add(d.data().toUid));
q2.docs.forEach(d => fof.add(d.data().fromUid));
fof.forEach(uid => {
    if (myFriendUids.has(uid)) return;
    if (!discovered[uid]) discovered[uid] = { degree: 2, via: [] };
    const name = f.displayName || f.username || '?';
    if (!discovered[uid].via.includes(name)) discovered[uid].via.push(name);
});
}

// Degree-3: friends of degree-2 (capped at 5 to avoid too many reads)
const fofKeys = Object.keys(discovered).slice(0, 5);
for (const fofUid of fofKeys) {
const [q1, q2] = await Promise.all([
    db.collection('friendRequests')
        .where('fromUid','==',fofUid).where('status','==','accepted').limit(10).get(),
    db.collection('friendRequests')
        .where('toUid','==',fofUid).where('status','==','accepted').limit(10).get()
]);
const fof2 = new Set();
q1.docs.forEach(d => fof2.add(d.data().toUid));
q2.docs.forEach(d => fof2.add(d.data().fromUid));
fof2.forEach(uid => {
    if (myFriendUids.has(uid) || discovered[uid]) return;
    const viaName = discovered[fofUid]?.via?.[0] || '?';
    discovered[uid] = { degree: 3, via: [viaName] };
});
}

const allUids = Object.keys(discovered);
if (!allUids.length) {
el.innerHTML = `<div style="text-align:center;padding:28px;color:var(--muted);font-size:13px;">No suggestions yet — add more friends to grow your network! 🌱</div>`;
return;
}

// Batch-fetch user profiles (10 per query)
const profiles = {};
for (let i = 0; i < allUids.length; i += 10) {
const chunk = allUids.slice(i, i + 10);
if (!chunk.length) continue;
const snap = await db.collection('users')
    .where(firebase.firestore.FieldPath.documentId(), 'in', chunk).get();
snap.docs.forEach(d => {
    const data = d.data();
    if (data.username) profiles[d.id] = { uid: d.id, ...data };
});
}

el.innerHTML = '';

const deg2 = allUids.filter(uid => profiles[uid] && discovered[uid].degree === 2);
const deg3 = allUids.filter(uid => profiles[uid] && discovered[uid].degree === 3);

if (deg2.length) {
const sec = ce('div'); sec.className = 'people-section';
sec.innerHTML = `<span class="people-sec-label">👥 Friends of Friends</span>`;
deg2.slice(0, 15).forEach(uid => {
    const via = discovered[uid].via.slice(0, 2).join(' & ');
    sec.appendChild(buildPersonCard(profiles[uid], via ? `via ${via}` : ''));
});
el.appendChild(sec);
}

if (deg3.length) {
const sec = ce('div'); sec.className = 'people-section';
sec.innerHTML = `<span class="people-sec-label">🌐 Extended Network</span>`;
deg3.slice(0, 8).forEach(uid => {
    const via = discovered[uid].via[0] || '';
    sec.appendChild(buildPersonCard(profiles[uid], via ? `3° via ${via}` : '3°'));
});
el.appendChild(sec);
}

if (!deg2.length && !deg3.length) {
el.innerHTML = `<div style="text-align:center;padding:28px;color:var(--muted);font-size:13px;">No suggestions yet — add more friends to grow your network! 🌱</div>`;
}

} catch(e) {
el.innerHTML = `<div style="text-align:center;padding:28px;color:var(--danger);font-size:13px;">Could not load suggestions: ${esc(e.message)}</div>`;
console.error('openPeopleModal:', e);
}
}

function buildPersonCard(u, via) {
const alreadyFriend = friends.some(f => f.uid === u.uid);
const card = ce('div'); card.className = 'people-card';
card.innerHTML = `
${mkAv(u.displayName||'?', u.photoURL||null, 36)}
<div class="people-card-info">
<div class="people-card-name">${esc(u.displayName||u.username||'?')}</div>
<div class="people-card-tag">@${esc(u.username||'')}</div>
${via ? `<div class="people-via">${esc(via)}</div>` : ''}
</div>
<button class="btn-add-person" ${alreadyFriend?'disabled':''} onclick="sendFriendReqTo('${esc(u.username||'')}',this)">
${alreadyFriend ? '✓ Friends' : '+ Add'}
</button>`;
return card;
}

// ══════════════════════════════════════════════════════════════
//  NORMAI CHAT — dedicated AI conversation tab
// ══════════════════════════════════════════════════════════════

const AI_MAX_CHATS  = 3;
const AI_RATE_WIN   = 60000;                          // 1 min window
const AI_FREE_RPM   = 4;   const AI_PRO_RPM  = 6;  const AI_ULTRA_RPM = 10;  // requests per minute
// No per-chat message cap (was 12 / 24 / 50 by plan — localStorage size is the practical limit)

let activeAIChatId  = null;           // currently open AI chat
let aiReqTs         = {};             // chatId → [timestamps] in-memory rate tracking
