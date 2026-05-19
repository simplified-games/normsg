// ── SUBSCRIPTIONS ──────────────────────────────────────────
function subscribeAll() {
    subFriends();
    subRequests();
    subGroups();
    setPresence(true);
    clearInterval(presenceTimer);
    presenceTimer = setInterval(() => setPresence(true), 60000);
}

// ── FRIENDS ────────────────────────────────────────────────
function subFriends() {
    if (unsubF) { unsubF(); unsubF = null; }
    let fromF = [], toF = [];

    async function loadFriends() {
        const [from, to] = await Promise.all([
            awList('friendRequests', [
                Query.equal('fromUid', me.uid),
                Query.equal('status', 'accepted'),
                Query.limit(200),
            ]),
            awList('friendRequests', [
                Query.equal('toUid', me.uid),
                Query.equal('status', 'accepted'),
                Query.limit(200),
            ]),
        ]);
        fromF = from.map(x => ({ uid: x.toUid,   displayName: x.toName,   username: x.toUsername,   photoURL: x.toPhoto   }));
        toF   = to.map(x =>   ({ uid: x.fromUid, displayName: x.fromName, username: x.fromUsername, photoURL: x.fromPhoto }));
        const prevKey = getFriendUidsKey();
        friends = dedup([...fromF, ...toF]);
        const nextKey = getFriendUidsKey();
        subscribePresence();
        subDmLastAts();
        renderFriends();
        if (nextKey !== prevKey || statusRefreshQueued) {
            scheduleStatusesRefresh();
            refreshSuperCache().catch(() => {});
        }
    }

    loadFriends();

    const unsub = awSubscribe(['friendRequests'], response => {
        const doc = response.payload;
        if (!doc || (doc.fromUid !== me.uid && doc.toUid !== me.uid)) return;
        loadFriends();
    });

    unsubF = unsub;
}

// ── DM LAST-AT ─────────────────────────────────────────────
let dmBatchUnsub = null;

function subDmLastAts() {
    if (dmBatchUnsub) { dmBatchUnsub(); dmBatchUnsub = null; }
    if (!friends.length) return;

    const myDmIds = friends.map(f => dmId(me.uid, f.uid));
    let initialized = false;

    // Initial load of lastAt values
    awList('conversations', [
        Query.equal('$id', myDmIds),
        Query.limit(200),
    ]).then(docs => {
        docs.forEach(d => { dmLastAt[d.$id] = d.lastAt ? new Date(d.lastAt) : null; });
        // Clean stale keys
        Object.keys(dmLastAt).forEach(cid => { if (!myDmIds.includes(cid)) delete dmLastAt[cid]; });
        initialized = true;
        renderFriends();
    });

    // Real-time
    const unsub = awSubscribe(['conversations'], response => {
        const doc = response.payload;
        if (!doc) return;
        const cid = doc.$id;
        if (!myDmIds.includes(cid)) return;

        const newLastAt  = doc.lastAt ? new Date(doc.lastAt) : null;
        const prevLastAt = dmLastAt[cid];
        dmLastAt[cid] = newLastAt;
        renderFriends();

        if (!initialized || !newLastAt || !prevLastAt) return;
        if (newLastAt.getTime() <= prevLastAt.getTime()) return;
        if (doc.lastSenderUid === me.uid || cid === chatId) return;

        const f = friends.find(fr => dmId(me.uid, fr.uid) === cid);
        fireNotification({
            senderUid:      doc.lastSenderUid,
            senderUsername: doc.lastSenderUsername || '',
            text:           doc.lastText || '',
            type:           doc.lastType || 'text'
        }, f?.displayName || f?.username || 'DM', 'dm');
    });

    dmBatchUnsub = unsub;
}

// ── FRIEND REQUESTS ────────────────────────────────────────
function subRequests() {
    if (unsubR) { unsubR(); unsubR = null; }

    async function loadRequests() {
        pendingReqs = await awList('friendRequests', [
            Query.equal('toUid', me.uid),
            Query.equal('status', 'pending'),
            Query.limit(50),
        ]);
        // Add $id as id for compatibility with renderRequests
        pendingReqs = pendingReqs.map(r => ({ id: r.$id, ...r }));
        renderRequests();
        const b = document.getElementById('reqBadge');
        if (pendingReqs.length) { b.textContent = pendingReqs.length; b.classList.remove('hidden'); }
        else b.classList.add('hidden');
    }

    loadRequests();

    unsubR = awSubscribe(['friendRequests'], response => {
        const doc = response.payload;
        if (!doc) return;
        if (doc.toUid === me.uid || doc.fromUid === me.uid) loadRequests();
    });
}

// ── GROUPS ─────────────────────────────────────────────────
function subGroups() {
    if (unsubG) { unsubG(); unsubG = null; }
    const prevGroupLastAt = {};
    let groupsInitialized = false;

    async function loadGroups() {
        const docs = await awList('groups', [
            Query.contains('members', me.uid),
            Query.limit(100),
        ]);
        myGroups = docs.map(d => ({ id: d.$id, ...d }));

        if (!groupsInitialized) {
            myGroups.forEach(g => {
                prevGroupLastAt[g.id] = g.lastAt ? new Date(g.lastAt) : null;
            });
            groupsInitialized = true;
        }
        renderGroups();
    }

    loadGroups();

    unsubG = awSubscribe(['groups'], response => {
        const doc = response.payload;
        if (!doc || !Array.isArray(doc.members)) return;
        if (!doc.members.includes(me.uid)) return;

        const g         = { id: doc.$id, ...doc };
        const newLastAt = g.lastAt ? new Date(g.lastAt) : null;
        const prev      = prevGroupLastAt[g.id];

        if (groupsInitialized && newLastAt && prev &&
            newLastAt.getTime() > prev.getTime() &&
            g.lastSenderUid !== me.uid && g.id !== chatId) {
            fireNotification({
                senderUid:      g.lastSenderUid,
                senderUsername: g.lastSenderUsername || '',
                text:           g.lastText || '',
                type:           g.lastType || 'text'
            }, g.name || 'Group', 'group');
        }
        prevGroupLastAt[g.id] = newLastAt;
        loadGroups();
    });
}

// ── RENDER SIDEBAR ─────────────────────────────────────────
function renderFriends() {
    const el     = document.getElementById('dmsList');
    const q      = document.getElementById('dmSearch').value.toLowerCase();
    const hidden = getHiddenDMs();
    const nicks  = getNicknames();

    const vis = friends.filter(f => {
        const cid  = dmId(me.uid, f.uid);
        const nick = nicks[f.uid] || '';
        return !hidden.has(cid) && (
            (f.displayName||'').toLowerCase().includes(q) ||
            (f.username||'').toLowerCase().includes(q) ||
            nick.toLowerCase().includes(q)
        );
    });

    vis.sort((a, b) => {
        const la = dmLastAt[dmId(me.uid, a.uid)]?.getTime() || 0;
        const lb = dmLastAt[dmId(me.uid, b.uid)]?.getTime() || 0;
        return lb - la;
    });

    if (!vis.length) {
        el.innerHTML = `<div class="no-items"><div class="no-ico">👥</div><div class="no-txt">${friends.length ? 'No match.' : 'No friends yet!<br>Add one below.'}</div></div>`;
        return;
    }

    el.innerHTML = '';
    vis.forEach(f => {
        const cid      = dmId(me.uid, f.uid);
        const pres     = friendPresence[f.uid] || {};
        const isOnline = pres.online === true;
        const lastAt   = dmLastAt[cid] || null;
        const unread   = isUnread(cid, lastAt) && chatId !== cid;
        const nick     = nicks[f.uid] || '';
        const fIsSuper = superCache[f.uid] === true;
        const fIsUltra = ultraCache[f.uid] === true;
        const displayLabel = nick
            ? `${esc(nick)} <span class="nick-badge">@${esc(f.username||'')}</span>`
            : fIsUltra
                ? `<span class="ultra-name">${esc(f.displayName)}</span> <span class="ultra-badge">⚡</span>`
                : fIsSuper
                ? `<span class="super-name">${esc(f.displayName)}</span> <span class="super-badge">✦</span>`
                : esc(f.displayName);
        const statusTxt = isOnline
            ? '<span style="font-size:10px;color:var(--green);font-weight:600;">● Online</span>'
            : (() => { const ago = timeAgo(pres?.lastSeen); return ago ? `<span style="font-size:10px;color:var(--muted);">${ago}</span>` : `<span style="font-size:10px;color:var(--muted);">@${esc(f.username||'')}</span>`; })();

        const d = ce('div');
        d.className = 'conv-item' + (chatId === cid ? ' on' : '') + (unread ? ' unread' : '');
        d.innerHTML = `
            <div style="position:relative;flex-shrink:0;">
                ${mkAv(f.displayName, f.photoURL, 34)}
                ${isOnline ? `<span class="online-dot" style="position:absolute;bottom:0;right:0;"></span>` : ''}
            </div>
            <div class="cv-info min-w-0">
                <div class="cv-name">${displayLabel}</div>
                <div class="cv-last">${statusTxt}</div>
            </div>
            <div style="display:flex;gap:3px;flex-shrink:0;">
                <button class="conv-del" style="opacity:0;position:static;transform:none;background:rgba(167,139,250,0.12);color:var(--a2);border-radius:7px;padding:3px 7px;font-size:11px;" onclick="event.stopPropagation();openNicknameModal('${f.uid}','${esc(f.displayName).replace(/'/g,"\\'")}')">✎</button>
                <button class="conv-del" style="opacity:0;position:static;transform:none;" onclick="event.stopPropagation();hideDM('${cid}')">✕</button>
                <button class="conv-del" style="opacity:0;position:static;transform:none;background:rgba(244,63,94,0.1);color:var(--danger);border-radius:7px;padding:3px 7px;font-size:11px;" onclick="event.stopPropagation();unfriend('${f.uid}')">🚫</button>
            </div>`;
        d.addEventListener('mouseenter', () => d.querySelectorAll('.conv-del').forEach(b => b.style.opacity='1'));
        d.addEventListener('mouseleave', () => d.querySelectorAll('.conv-del').forEach(b => b.style.opacity='0'));
        d.onclick = () => openDM(f);
        el.appendChild(d);
    });
}

function renderRequests() {
    const el  = document.getElementById('reqList');
    const sec = document.getElementById('reqSection');
    if (!pendingReqs.length) { sec.style.display='none'; return; }
    sec.style.display = 'block';
    document.getElementById('reqCount').textContent = `(${pendingReqs.length})`;
    el.innerHTML = '';
    pendingReqs.forEach(r => {
        const d = ce('div'); d.className = 'req-card';
        d.innerHTML = `
            <div style="display:flex;align-items:center;gap:9px;">
                ${mkAv(r.fromName, r.fromPhoto, 30)}
                <div><div style="font-size:12px;font-weight:600;">${esc(r.fromName)}</div><div style="font-size:11px;color:var(--muted);">@${esc(r.fromUsername||'')}</div></div>
            </div>
            <div class="req-acts">
                <button class="btn-acc" onclick="acceptReq('${r.id}')">✓ Accept</button>
                <button class="btn-dec" onclick="declineReq('${r.id}')">✕ Decline</button>
            </div>`;
        el.appendChild(d);
    });
}

function renderGroups() {
    const el = document.getElementById('groupsList');
    if (!myGroups.length) {
        el.innerHTML = `<div class="no-items"><div class="no-ico">💬</div><div class="no-txt">No groups yet.<br>Create one below!</div></div>`;
        return;
    }
    const sorted = [...myGroups].sort((a, b) => {
        const la = a.lastAt ? new Date(a.lastAt).getTime() : 0;
        const lb = b.lastAt ? new Date(b.lastAt).getTime() : 0;
        return lb - la;
    });
    el.innerHTML = '';
    sorted.forEach(g => {
        const lastAt    = g.lastAt ? new Date(g.lastAt) : null;
        const unread    = isUnread(g.id, lastAt) && chatId !== g.id;
        const isCreator = g.createdBy === me.uid;
        const d = ce('div');
        d.className = 'conv-item' + (chatId === g.id ? ' on' : '') + (unread ? ' unread' : '');
        d.innerHTML = `<div class="av av-grp" style="width:34px;height:34px;font-size:13px;flex-shrink:0;">${esc((g.name[0]||'G').toUpperCase())}</div><div class="cv-info"><div class="cv-name">${esc(g.name)}</div><div class="cv-last">${g.members?.length||0} members</div></div>${isCreator ? `<button class="conv-del" onclick="event.stopPropagation();startDeleteGroup('${g.id}','${esc(g.name)}')">🗑</button>` : ''}`;
        d.onclick = () => openGroup(g);
        el.appendChild(d);
    });
}

// ── TABS ───────────────────────────────────────────────────
function switchTab(t) {
    const dms = t==='dms', grp = t==='groups', ai = t==='ai', gms = t==='games';
    currentSidebarTab = t;
    document.getElementById('tabDMs').classList.toggle('on', dms);
    document.getElementById('tabGroups').classList.toggle('on', grp);
    document.getElementById('tabAI').classList.toggle('on', ai);
    document.getElementById('tabGames').classList.toggle('on', gms);
    document.getElementById('dmsPanel').style.display    = dms ? 'flex' : 'none';
    document.getElementById('groupsPanel').style.display = grp ? 'flex' : 'none';
    document.getElementById('aiPanel').style.display     = ai  ? 'flex' : 'none';
    document.getElementById('gamesPanel').style.display  = gms ? 'flex' : 'none';
    if (dms) scheduleStatusesRefresh();
    if (ai) { renderAIChats(); updateAIRateBar(); }
}

// ── SEND FRIEND REQUEST ────────────────────────────────────
async function sendFriendReq() {
    const input = document.getElementById('addIn');
    const uname = input.value.trim().toLowerCase().replace('@','');
    if (!uname) return;
    if (uname === myUsername) return showAddMsg('You can\'t add yourself!', 'err');

    const alreadyFriend = friends.find(f => f.username === uname);
    if (alreadyFriend) return showAddMsg('Already friends!', 'err');

    const targetUid = await getCachedUid(uname);
    if (!targetUid) return showAddMsg('No user @' + uname, 'err');

    const updata = await getCachedProfile(targetUid) || {};

    const [dup, rev] = await Promise.all([
        awList('friendRequests', [
            Query.equal('fromUid', me.uid),
            Query.equal('toUid', targetUid),
            Query.equal('status', 'pending'),
            Query.limit(1),
        ]),
        awList('friendRequests', [
            Query.equal('fromUid', targetUid),
            Query.equal('toUid', me.uid),
            Query.equal('status', 'pending'),
            Query.limit(1),
        ]),
    ]);

    if (dup.length) return showAddMsg('Request already sent!', 'err');

    if (rev.length) {
        await awUpdate('friendRequests', rev[0].$id, { status: 'accepted' });
        input.value = '';
        return showAddMsg(`@${uname} already sent you a request — accepted! 🎉`, 'ok');
    }

    await awAdd('friendRequests', {
        fromUid:      me.uid,
        fromName:     me.displayName || me.email,
        fromUsername: myUsername,
        fromPhoto:    me.photoURL || null,
        toUid:        targetUid,
        toName:       updata.displayName || updata.email || '',
        toUsername:   updata.username || '',
        toPhoto:      updata.photoURL || null,
        status:       'pending',
        createdAt:    awNow(),
    });

    input.value = '';
    showAddMsg(`Request sent to @${uname}! 🎉`, 'ok');
}

function showAddMsg(txt, type) {
    const el = document.getElementById('addMsg');
    el.textContent = txt; el.className = 'add-msg ' + type;
    setTimeout(() => { el.className = 'add-msg'; el.textContent = ''; }, 4500);
}

async function acceptReq(id) {
    await awUpdate('friendRequests', id, { status: 'accepted' });
    showToast('Friend added! 🎉');
}
async function declineReq(id) {
    await awUpdate('friendRequests', id, { status: 'rejected' });
}

// ── CREATE GROUP ───────────────────────────────────────────
function openGroupModal() {
    document.getElementById('grpNameIn').value = '';
    mmsg('grpMsg','','');
    const el = document.getElementById('grpMemberList');
    el.innerHTML = '';
    if (!friends.length) {
        el.innerHTML = `<div style="font-size:12px;color:var(--muted);padding:12px 8px;">Add some friends first!</div>`;
    } else {
        friends.forEach(f => {
            const lb = ce('label'); lb.className = 'member-item';
            lb.innerHTML = `<input type="checkbox" value="${f.uid}"> ${mkAv(f.displayName, f.photoURL, 26)} <div><div class="mi-name">${esc(f.displayName)}</div><div class="mi-user">@${esc(f.username||'')}</div></div>`;
            el.appendChild(lb);
        });
    }
    document.getElementById('groupModal').classList.remove('hidden');
}

async function createGroup() {
    const name = document.getElementById('grpNameIn').value.trim();
    if (!name) return mmsg('grpMsg','Enter a group name.','err');
    const checked = [...document.querySelectorAll('#grpMemberList input:checked')].map(c => c.value);
    if (!checked.length) return mmsg('grpMsg','Select at least one friend.','err');
    const members = [me.uid, ...checked];
    await awAdd('groups', { name, members, createdBy: me.uid, createdAt: awNow() });
    closeModal('groupModal');
    showToast(`"${name}" created! 🎉`);
    switchTab('groups');
}

// Updated fallback function to return a Set as expected by the rendering code
function getHiddenDMs() {
    try {
        const data = JSON.parse(localStorage.getItem('normsg_hidden_dms') || '[]');
        return new Set(Array.isArray(data) ? data : []);
    } catch (e) {
        return new Set();
    }
}
