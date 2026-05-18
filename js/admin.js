// ── NORMSG SUPER & ADMIN SYSTEM ────────────────────────────
const OWNER_EMAIL = 'simplifiedlearning10@gmail.com';
let isPlatformAdmin  = false;
let superCache       = {};
let ultraCache       = {};
let superLastLoadedAt  = 0;
let superLastFriendKey = '';
let superLoadInFlight  = null;

async function initAdminSystem() {
    const isOwner = me.email?.toLowerCase() === OWNER_EMAIL.toLowerCase();
    if (isOwner) {
        isPlatformAdmin = true;
    } else {
        try { await awGet('platformadmins', me.uid); isPlatformAdmin = true; }
        catch { isPlatformAdmin = false; }
    }
    if (isPlatformAdmin) { userPlan = 'ultra'; updateNormAIBadge(); }

    const adminBtn = document.getElementById('adminBtn');
    if (adminBtn) {
        adminBtn.classList.toggle('non-admin', !isPlatformAdmin);
        adminBtn.title = isPlatformAdmin ? 'Admin Panel' : 'Admin tools info';
    }
    await refreshSuperCache();
    checkWeeklyLeaderboard();
}

function handleAdminBtnClick() {
    if (isPlatformAdmin) { openAdminPanel(); return; }
    showToast('Admin panel is for platform admins only.');
}

async function hasSuper(uid) {
    const cacheFresh = (Date.now() - superLastLoadedAt) < 45000;
    if (cacheFresh && Object.prototype.hasOwnProperty.call(superCache, uid)) return superCache[uid] === true;
    try {
        const doc   = await awGet('users', uid);
        const data  = awDecodeUser(doc);
        const until = data?.normsgSuper?.until?.toDate?.();
        superCache[uid] = !!(until && until > new Date());
        return superCache[uid];
    } catch { return false; }
}

async function hasUltra(uid) {
    const cacheFresh = (Date.now() - superLastLoadedAt) < 45000;
    if (cacheFresh && Object.prototype.hasOwnProperty.call(ultraCache, uid)) return ultraCache[uid] === true;
    try {
        const doc   = await awGet('users', uid);
        const data  = awDecodeUser(doc);
        const until = data?.normsgUltra?.until?.toDate?.();
        ultraCache[uid] = !!(until && until > new Date());
        return ultraCache[uid];
    } catch { return false; }
}

async function refreshSuperCache({ force = false } = {}) {
    const uids      = [me.uid, ...friends.map(f => f.uid)];
    const uniqueUids = [...new Set(uids)];
    const friendKey  = uniqueUids.slice().sort().join('|');
    const cacheFresh = (Date.now() - superLastLoadedAt) < 45000 && friendKey === superLastFriendKey;
    if (!force && cacheFresh) { renderFriends(); return; }
    if (superLoadInFlight) return superLoadInFlight;

    const nextCache      = {};
    const nextUltraCache = {};
    superLoadInFlight = (async () => {
        // Appwrite supports up to 100 IDs in a single Query.equal('$id', [...])
        for (let i = 0; i < uniqueUids.length; i += 100) {
            const chunk = uniqueUids.slice(i, i + 100);
            if (!chunk.length) continue;
            const docs = await awList('users', [Query.equal('$id', chunk), Query.limit(100)]);
            docs.forEach(d => {
                const data       = awDecodeUser(d);
                const superUntil = data?.normsgSuper?.until?.toDate?.();
                const ultraUntil = data?.normsgUltra?.until?.toDate?.();
                nextCache[d.$id]      = !!(superUntil && superUntil > new Date());
                nextUltraCache[d.$id] = !!(ultraUntil && ultraUntil > new Date());
            });
        }
        uniqueUids.forEach(uid => {
            superCache[uid] = nextCache[uid] || false;
            ultraCache[uid] = nextUltraCache[uid] || false;
        });
        superLastLoadedAt  = Date.now();
        superLastFriendKey = friendKey;
    })();

    try { await superLoadInFlight; } finally { superLoadInFlight = null; }

    if (ultraCache[me.uid]) { userPlan = 'ultra'; updateNormAIBadge(); }
    else if (superCache[me.uid] && userPlan === 'free') { userPlan = 'pro'; updateNormAIBadge(); }

    const myBadge  = document.getElementById('mySuperBadge');
    const myHandle = document.getElementById('myHandle');
    if (ultraCache[me.uid]) {
        if (myBadge)  { myBadge.style.display = 'block'; myBadge.innerHTML = '<span class="ultra-badge">⚡ ULTRA</span>'; }
        if (myHandle) myHandle.innerHTML = `<span class="ultra-name">@${myUsername}</span>`;
    } else if (superCache[me.uid] || userPlan === 'pro') {
        if (myBadge)  { myBadge.style.display = 'block'; myBadge.innerHTML = '<span class="super-badge">✦ SUPER</span>'; }
        if (myHandle) myHandle.innerHTML = `<span class="super-name">@${myUsername}</span>`;
    } else {
        if (myBadge)  myBadge.style.display = 'none';
        if (myHandle) myHandle.textContent = `@${myUsername}`;
    }
    renderFriends();
}

// ── VIEW USER PROFILE ──────────────────────────────────────
let _vpTargetUid    = null;
let _vpTargetFriend = null;

async function openUserProfile(uid, displayName, photoURL, username) {
    if (!uid || uid === me.uid) return;
    _vpTargetUid    = uid;
    _vpTargetFriend = null;

    const avEl = document.getElementById('vpAv');
    avEl.innerHTML = photoURL ? `<img src="${esc(photoURL)}" alt="">` : initials(displayName || '?');
    document.getElementById('vpName').textContent   = displayName || '?';
    document.getElementById('vpHandle').textContent = username ? '@' + username : '';
    document.getElementById('vpBio').innerHTML      = '<span class="vp-bio-empty">Loading…</span>';
    document.getElementById('vpMutualFriends').innerHTML = '<span class="vp-empty-hint">Loading…</span>';
    document.getElementById('vpMutualGroups').innerHTML  = '<span class="vp-empty-hint">Loading…</span>';

    const isFriend = friends.some(f => f.uid === uid);
    _vpTargetFriend = friends.find(f => f.uid === uid) || null;
    document.getElementById('vpDmBtn').style.display = isFriend ? 'block' : 'none';
    document.getElementById('viewProfileModal').classList.remove('hidden');

    // Bio & badges
    try {
        const snap = await getCachedProfile(uid);
        const bio  = snap?.bio || '';
        const bioEl = document.getElementById('vpBio');
        if (bio) { bioEl.textContent = bio; bioEl.classList.remove('vp-bio-empty'); }
        else { bioEl.innerHTML = '<span class="vp-bio-empty">No bio yet.</span>'; }
        const fresh = snap?.displayName || displayName;
        document.getElementById('vpName').textContent = fresh;
        if (snap?.photoURL) avEl.innerHTML = `<img src="${esc(snap.photoURL)}" alt="">`;
        const ultraUntil = snap?.normsgUltra?.until?.toDate?.();
        const superUntil = snap?.normsgSuper?.until?.toDate?.();
        if (ultraUntil && ultraUntil > new Date()) {
            document.getElementById('vpName').innerHTML = `<span class="ultra-name">${esc(fresh)}</span> <span class="ultra-badge">⚡ ULTRA</span>`;
        } else if (superUntil && superUntil > new Date()) {
            document.getElementById('vpName').innerHTML = `<span class="super-name">${esc(fresh)}</span> <span class="super-badge">✦ SUPER</span>`;
        }
    } catch { document.getElementById('vpBio').innerHTML = '<span class="vp-bio-empty">Could not load bio.</span>'; }

    // Mutual friends
    try {
        const mutualEl = document.getElementById('vpMutualFriends');
        const [q1, q2] = await Promise.all([
            awList('friendrequests', [Query.equal('fromUid', uid), Query.equal('status', 'accepted'), Query.limit(30)]),
            awList('friendrequests', [Query.equal('toUid',   uid), Query.equal('status', 'accepted'), Query.limit(30)]),
        ]);
        const theirFriendUids = new Set();
        q1.forEach(d => theirFriendUids.add(d.toUid));
        q2.forEach(d => theirFriendUids.add(d.fromUid));
        const mutuals = friends.filter(f => theirFriendUids.has(f.uid));
        if (!mutuals.length) {
            mutualEl.innerHTML = '<span class="vp-empty-hint">No mutual friends.</span>';
        } else {
            mutualEl.innerHTML = '';
            mutuals.slice(0, 12).forEach(f => {
                const pill = ce('div'); pill.className = 'vp-pill';
                pill.innerHTML = mkAv(f.displayName, f.photoURL, 20) + `<span>${esc(f.displayName)}</span>`;
                pill.onclick = () => { closeModal('viewProfileModal'); openDM(f); };
                mutualEl.appendChild(pill);
            });
            if (mutuals.length > 12) {
                const more = ce('span'); more.className = 'vp-empty-hint';
                more.textContent = `+${mutuals.length - 12} more`;
                mutualEl.appendChild(more);
            }
        }
    } catch { document.getElementById('vpMutualFriends').innerHTML = '<span class="vp-empty-hint">Could not load.</span>'; }

    // Mutual groups
    try {
        const grpEl = document.getElementById('vpMutualGroups');
        const mutualGroups = myGroups.filter(g => (g.members || []).includes(uid));
        if (!mutualGroups.length) {
            grpEl.innerHTML = '<span class="vp-empty-hint">No mutual group chats.</span>';
        } else {
            grpEl.innerHTML = '';
            mutualGroups.forEach(g => {
                const pill = ce('div'); pill.className = 'vp-grp-pill';
                pill.innerHTML = `
                    <div class="vp-grp-icon">${esc((g.name[0]||'G').toUpperCase())}</div>
                    <div style="min-width:0;flex:1;">
                        <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(g.name)}</div>
                        <div style="font-size:11px;color:var(--muted);">${g.members?.length||0} members</div>
                    </div>
                    <span style="font-size:11px;color:var(--a2);font-weight:700;">Open →</span>`;
                pill.onclick = () => { closeModal('viewProfileModal'); openGroup(g); switchTab('groups'); };
                grpEl.appendChild(pill);
            });
        }
    } catch { document.getElementById('vpMutualGroups').innerHTML = '<span class="vp-empty-hint">Could not load.</span>'; }
}

function openDMFromProfile() {
    if (!_vpTargetFriend) return;
    closeModal('viewProfileModal');
    switchTab('dms');
    openDM(_vpTargetFriend);
}

// ── WEEKLY MESSAGE COUNT ────────────────────────────────────
// Uses the weeklyMsgCounts collection (one doc per user per week)
function getWeekKey() {
    const d    = new Date();
    const jan1 = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
    return `${d.getFullYear()}-W${week}`;
}

async function incrementWeeklyCount() {
    if (!me) return;
    try {
        const weekKey = getWeekKey();
        const docId   = `${me.uid}_${weekKey}`;
        let doc;
        try { doc = await awGet('weeklyMsgCounts', docId); } catch { doc = null; }
        if (doc) {
            await awUpdate('weeklyMsgCounts', docId, { count: (doc.count || 0) + 1 });
        } else {
            await awDatabases.createDocument(AW_DB_ID, 'weeklyMsgCounts', docId, {
                uid: me.uid, username: myUsername || '', count: 1, weekKey,
            });
        }
    } catch { /* fire-and-forget */ }
}

async function checkWeeklyLeaderboard() {
    try {
        const weekKey = getWeekKey();
        const docs = await awList('weeklyMsgCounts', [
            Query.equal('weekKey', weekKey),
            Query.orderDesc('count'),
            Query.limit(1),
        ]);
        if (!docs.length) return;
        const top = docs[0];
        if (top.uid === me.uid) {
            const current = await hasSuper(me.uid);
            if (!current) {
                await grantSuperToUid(me.uid, 30);
                showToast('🏆 You\'re the top chatter this week! 1 month of NorMSG Super! ✦');
                await refreshSuperCache();
            }
        }
    } catch { /* needs weeklyMsgCounts index */ }
}

async function grantSuperToUid(uid, days) {
    const until = new Date(Date.now() + days * 86400000);
    await awUpdate('users', uid, {
        normsgSuper: awEncode({ until: until.toISOString(), days, grantedAt: awNow() }),
    });
}

async function grantUltraToUid(uid, days) {
    const until = new Date(Date.now() + days * 86400000);
    await awUpsert('users', uid, {
        normsgUltra: awEncode({ until: until.toISOString(), days, grantedAt: awNow() }),
        plan: 'ultra',
    });
}

// ── ADMIN PANEL ─────────────────────────────────────────────
async function openAdminPanel() {
    if (!isPlatformAdmin) return;
    mmsg('giftMsg','',''); mmsg('giftAdminMsg','',''); mmsg('annMsg','','');
    document.getElementById('giftSuperIn').value = '';
    document.getElementById('giftAdminIn').value = '';
    document.getElementById('annTextIn').value   = '';
    document.getElementById('adminModal').classList.remove('hidden');
    loadLeaderboard();
    loadActiveAnnPreview();
}

// ── ANNOUNCEMENTS ─────────────────────────────────────────
// Uses a 'siteconfig' collection with doc ID 'announcement'
// Add a 'siteconfig' collection in Appwrite with fields: text(string), style(string),
// hours(int), expiresAt(string), postedBy(string), postedAt(string)
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
        const expiresAt = new Date(Date.now() + hours * 3600000).toISOString();
        await awUpsert('siteconfig', 'announcement', {
            text, style, hours, expiresAt,
            postedBy: me.uid, postedAt: awNow(),
        });
        mmsg('annMsg', `✓ Posted for ${hours < 24 ? hours+'h' : (hours/24)+'d'}!`, 'ok');
        document.getElementById('annTextIn').value = '';
        loadActiveAnnPreview();
        checkAnnouncement();
    } catch(e) { mmsg('annMsg', 'Error: ' + e.message, 'err'); }
}

async function cancelAnnouncement() {
    if (!isPlatformAdmin) return;
    try {
        await awDelete('siteconfig', 'announcement');
        document.getElementById('activeAnnPreview').innerHTML = '';
        hideAnnouncementBanner();
        mmsg('annMsg', 'Announcement removed.', 'ok');
    } catch(e) { mmsg('annMsg', 'Error: ' + e.message, 'err'); }
}

async function loadActiveAnnPreview() {
    const el = document.getElementById('activeAnnPreview');
    try {
        const doc = await awGet('siteconfig', 'announcement');
        const expires = doc.expiresAt ? new Date(doc.expiresAt) : null;
        if (!expires || expires < new Date()) { el.innerHTML = ''; return; }
        const s = ANN_STYLES[doc.style] || ANN_STYLES.info;
        const timeLeft = timeUntil(expires);
        el.innerHTML = `
            <div style="background:${s.bg};color:${s.color};border-radius:10px;padding:9px 13px;
                font-size:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <span style="flex:1;font-weight:600;">Active: "${esc(doc.text)}"</span>
                <span style="opacity:0.75;font-size:11px;">Expires in ${timeLeft}</span>
                <button onclick="cancelAnnouncement()" style="
                    background:rgba(0,0,0,0.25);border:none;color:inherit;border-radius:8px;
                    padding:3px 10px;font-size:11px;cursor:pointer;font-family:'Figtree',sans-serif;
                    font-weight:700;white-space:nowrap;">✕ Remove</button>
            </div>`;
    } catch { el.innerHTML = ''; }
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
    try {
        const doc = await awGet('siteconfig', 'announcement');
        const expires = doc.expiresAt ? new Date(doc.expiresAt) : null;
        if (!expires || expires < new Date()) { hideAnnouncementBanner(); return; }
        const dismissKey = 'normsg_ann_dismissed_' + (doc.postedAt || '');
        if (localStorage.getItem(dismissKey)) { hideAnnouncementBanner(); return; }
        showAnnouncementBanner(doc.text, doc.style, dismissKey);
    } catch { hideAnnouncementBanner(); }
}

function showAnnouncementBanner(text, style, dismissKey) {
    const banner = document.getElementById('annBanner');
    const s = ANN_STYLES[style] || ANN_STYLES.info;
    banner.style.background = s.bg;
    banner.style.color      = s.color;
    document.getElementById('annBannerText').textContent = text;
    banner._dismissKey = dismissKey;
    banner.style.display = 'flex';
    document.body.style.paddingTop = banner.offsetHeight + 'px';
}

function hideAnnouncementBanner() {
    const banner = document.getElementById('annBanner');
    banner.style.display = 'none';
    document.body.style.paddingTop = '';
}

function dismissAnnouncement() {
    const banner = document.getElementById('annBanner');
    if (banner._dismissKey) { try { localStorage.setItem(banner._dismissKey, '1'); } catch {} }
    hideAnnouncementBanner();
}

// ── LEADERBOARD ────────────────────────────────────────────
async function loadLeaderboard() {
    const el = document.getElementById('adminLeaderboard');
    try {
        const weekKey = getWeekKey();
        const docs = await awList('weeklyMsgCounts', [
            Query.equal('weekKey', weekKey),
            Query.orderDesc('count'),
            Query.limit(5),
        ]);
        if (!docs.length) { el.textContent = 'No messages this week yet.'; return; }
        const medals = ['🥇','🥈','🥉','4️⃣','5️⃣'];
        el.innerHTML = docs.map((d, i) => `
            <div style="padding:5px 0;display:flex;gap:8px;align-items:center;">
                <span style="font-size:16px;">${medals[i]}</span>
                <span style="font-size:12px;font-weight:600;">${esc(d.username||'?')}</span>
                <span style="font-size:11px;color:var(--a2);margin-left:auto;">${d.count||0} msgs</span>
            </div>`).join('');
    } catch(e) {
        el.textContent = 'Could not load leaderboard.';
    }
}

// ── GIFT SUPER / ULTRA / ADMIN ─────────────────────────────
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
        superCache[uid] = true; renderFriends();
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
        ultraCache[uid] = true; superCache[uid] = true; renderFriends();
    } catch(e) { mmsg('giftUltraMsg','Error: '+e.message,'err'); }
}

async function giftAdmin() {
    const uname = document.getElementById('giftAdminIn').value.trim().toLowerCase().replace('@','');
    if (!uname) return;
    mmsg('giftAdminMsg','Looking up user…','inf');
    try {
        const uid = await getCachedUid(uname);
        if (!uid) return mmsg('giftAdminMsg',`@${uname} not found.`,'err');
        await awUpsert('platformadmins', uid, { grantedBy: me.uid, grantedAt: awNow() });
        mmsg('giftAdminMsg',`✓ @${uname} is now a platform admin!`,'ok');
        document.getElementById('giftAdminIn').value = '';
    } catch(e) { mmsg('giftAdminMsg','Error: '+e.message,'err'); }
}

// ── GROUP MANAGEMENT ───────────────────────────────────────
let manageGroupId = null;

async function openManageGroup() {
    if (chatType !== 'group' || !chatId) return;
    manageGroupId = chatId;

    const gdata   = await awGet('groups', chatId);
    const isOwner = gdata.createdBy === me.uid;
    const isAdmin = (gdata.admins || []).includes(me.uid) || isOwner;
    const adminOnly = gdata.addMembersAdminOnly === true;
    const canAdd    = !adminOnly || isAdmin;

    document.getElementById('grpRenameIn').value    = gdata.name || '';
    document.getElementById('grpRenameIn').disabled = !isAdmin;
    document.querySelector('#manageGroupModal .btn-add').style.display = isAdmin ? '' : 'none';
    mmsg('renameMsg','','');

    document.getElementById('addMemberIn').value       = '';
    document.getElementById('addMemberIn').disabled    = !canAdd;
    document.getElementById('addMemberIn').placeholder = canAdd ? 'username' : 'Admins only can add members';
    mmsg('addMemberMsg','','');

    const permRow = document.getElementById('addPermRow');
    if (isOwner) {
        permRow.style.display = 'flex';
        document.getElementById('addPermDesc').textContent = adminOnly ? 'Admins only can add' : 'Everyone can add';
        document.getElementById('addPermBtn').textContent  = adminOnly ? 'Allow Everyone' : 'Admin Only';
    } else {
        permRow.style.display = 'none';
    }

    const el         = document.getElementById('manageAdminList');
    const memberUids = gdata.members || [];
    const admins     = gdata.admins  || [];
    const owner      = gdata.createdBy;

    el.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:6px 0;">Loading…</div>';

    const profiles = {};
    for (let i = 0; i < memberUids.length; i += 100) {
        const chunk = memberUids.slice(i, i + 100);
        if (!chunk.length) continue;
        const docs = await awList('users', [Query.equal('$id', chunk), Query.limit(100)]);
        docs.forEach(d => { profiles[d.$id] = awDecodeUser(d); });
    }

    el.innerHTML = '';
    for (const uid of memberUids) {
        const udata       = profiles[uid] || {};
        const isThisOwner = uid === owner;
        const isThisAdmin = admins.includes(uid) || isThisOwner;
        const isMe        = uid === me.uid;
        const row = ce('div'); row.className = 'admin-row';
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
    if (manageGroupId) renderRolesSection(manageGroupId);
}

async function renameGroup() {
    const newName = document.getElementById('grpRenameIn').value.trim();
    if (!newName) return mmsg('renameMsg', 'Enter a group name.', 'err');
    if (!manageGroupId) return;
    const gdata = await awGet('groups', manageGroupId);
    const isAdmin = (gdata.admins||[]).includes(me.uid) || gdata.createdBy === me.uid;
    if (!isAdmin) return mmsg('renameMsg', 'Only admins can rename.', 'err');
    await awUpdate('groups', manageGroupId, { name: newName });
    document.getElementById('chatName').textContent = newName;
    mmsg('renameMsg', `✓ Renamed to "${newName}"`, 'ok');
    showToast('Group renamed!');
    renderGroups();
}

async function toggleAdmin(uid, currentlyAdmin) {
    if (!manageGroupId) return;
    const gdata  = await awGet('groups', manageGroupId);
    const admins = gdata.admins || [];
    const newAdmins = currentlyAdmin
        ? admins.filter(a => a !== uid)
        : [...new Set([...admins, uid])];
    await awUpdate('groups', manageGroupId, { admins: newAdmins });
    showToast(currentlyAdmin ? 'Admin removed.' : 'Admin added! ⭐');
    openManageGroup();
}

async function addMemberToGroup() {
    const uname = document.getElementById('addMemberIn').value.trim().toLowerCase().replace('@','');
    if (!uname) return;
    mmsg('addMemberMsg','','');
    const gdata   = await awGet('groups', manageGroupId);
    const isOwner = gdata.createdBy === me.uid;
    const isAdmin = (gdata.admins||[]).includes(me.uid) || isOwner;
    if (gdata.addMembersAdminOnly && !isAdmin) return mmsg('addMemberMsg','Only admins can add members.','err');

    const targetUid = await getCachedUid(uname);
    if (!targetUid) return mmsg('addMemberMsg',`@${uname} not found.`,'err');
    if ((gdata.members||[]).includes(targetUid)) return mmsg('addMemberMsg','Already a member!','err');

    const newMembers = [...new Set([...(gdata.members||[]), targetUid])];
    await awUpdate('groups', manageGroupId, { members: newMembers });
    document.getElementById('addMemberIn').value = '';
    mmsg('addMemberMsg',`✓ @${uname} added!`,'ok');
    showToast(`@${uname} added to group!`);
    mentionMembers = [];
    openManageGroup();
}

async function toggleAddPerm() {
    const gdata = await awGet('groups', manageGroupId);
    const cur   = gdata.addMembersAdminOnly === true;
    await awUpdate('groups', manageGroupId, { addMembersAdminOnly: !cur });
    document.getElementById('addPermDesc').textContent = !cur ? 'Admins only can add' : 'Everyone can add';
    document.getElementById('addPermBtn').textContent  = !cur ? 'Allow Everyone' : 'Admin Only';
    showToast(!cur ? 'Now admin-only adding.' : 'Everyone can now add members.');
}

// ── PEOPLE DISCOVERY ───────────────────────────────────────
async function openPeopleModal() {
    document.getElementById('peopleModal').classList.remove('hidden');
    const el = document.getElementById('peopleList');
    el.innerHTML = `<div style="text-align:center;padding:28px;color:var(--muted);font-size:13px;">🔍 Loading suggestions…</div>`;
    try {
        const myFriendUids = new Set(friends.map(f => f.uid));
        myFriendUids.add(me.uid);
        const discovered = {};

        for (const f of friends.slice(0, 12)) {
            const [q1, q2] = await Promise.all([
                awList('friendrequests', [Query.equal('fromUid', f.uid), Query.equal('status', 'accepted'), Query.limit(20)]),
                awList('friendrequests', [Query.equal('toUid',   f.uid), Query.equal('status', 'accepted'), Query.limit(20)]),
            ]);
            const fof = new Set();
            q1.forEach(d => fof.add(d.toUid));
            q2.forEach(d => fof.add(d.fromUid));
            fof.forEach(uid => {
                if (myFriendUids.has(uid)) return;
                if (!discovered[uid]) discovered[uid] = { degree: 2, via: [] };
                const name = f.displayName || f.username || '?';
                if (!discovered[uid].via.includes(name)) discovered[uid].via.push(name);
            });
        }

        const fofKeys = Object.keys(discovered).slice(0, 5);
        for (const fofUid of fofKeys) {
            const [q1, q2] = await Promise.all([
                awList('friendrequests', [Query.equal('fromUid', fofUid), Query.equal('status', 'accepted'), Query.limit(10)]),
                awList('friendrequests', [Query.equal('toUid',   fofUid), Query.equal('status', 'accepted'), Query.limit(10)]),
            ]);
            const fof2 = new Set();
            q1.forEach(d => fof2.add(d.toUid));
            q2.forEach(d => fof2.add(d.fromUid));
            fof2.forEach(uid => {
                if (myFriendUids.has(uid) || discovered[uid]) return;
                discovered[uid] = { degree: 3, via: [discovered[fofUid]?.via?.[0] || '?'] };
            });
        }

        const allUids = Object.keys(discovered);
        if (!allUids.length) {
            el.innerHTML = `<div style="text-align:center;padding:28px;color:var(--muted);font-size:13px;">No suggestions yet — add more friends to grow your network! 🌱</div>`;
            return;
        }

        const profiles = {};
        for (let i = 0; i < allUids.length; i += 100) {
            const chunk = allUids.slice(i, i + 100);
            const docs  = await awList('users', [Query.equal('$id', chunk), Query.limit(100)]);
            docs.forEach(d => { if (d.username) profiles[d.$id] = { uid: d.$id, ...awDecodeUser(d) }; });
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
            deg3.slice(0, 8).forEach(uid => sec.appendChild(buildPersonCard(profiles[uid], `3° via ${discovered[uid].via[0]||''}`)));
            el.appendChild(sec);
        }
        if (!deg2.length && !deg3.length) {
            el.innerHTML = `<div style="text-align:center;padding:28px;color:var(--muted);font-size:13px;">No suggestions yet — add more friends! 🌱</div>`;
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

// ── AI CHAT CONSTANTS ──────────────────────────────────────
// (AI chat data stays in localStorage — no migration needed)
const AI_MAX_CHATS = 3;
const AI_RATE_WIN  = 60000;
const AI_FREE_RPM  = 4; const AI_PRO_RPM = 6; const AI_ULTRA_RPM = 10;
let activeAIChatId = null;
let aiReqTs        = {};
