// ── STATUSES ───────────────────────────────────────────────
const STATUS_COLORS = ['#7c5cfc','#2dd4bf','#f43f5e','#f59e0b','#34d399','#3b82f6','#ec4899','#8b5cf6','#1e293b','#0f172a'];
let statusCurrentUser   = null;
let statusCurrentIndex  = 0;
let statusProgressTimer = null;
let allStatuses         = {};
let stSelectedColor     = STATUS_COLORS[0];
let stType              = 'text';

// Normalise an Appwrite status doc — decode JSON fields, wrap timestamps
function normalizeStatus(d) {
    return {
        id:        d.$id,
        uid:       d.uid,
        type:      d.type,
        content:   d.content,
        bgColor:   d.bgColor,
        url:       d.url,
        reactions: awDecode(d.reactions) || {},
        views:     awDecode(d.views)     || {},
        createdAt: d.createdAt ? { toDate: () => new Date(d.createdAt) } : null,
        deleteAt:  d.deleteAt  ? { toDate: () => new Date(d.deleteAt)  } : null,
    };
}

async function loadStatuses({ force = false } = {}) {
    if (!me) return;
    renderStatusBar();

    const nowMs     = Date.now();
    const friendKey = getFriendUidsKey();
    const shouldSkipForTab = currentSidebarTab !== 'dms' && !force;
    const isFreshCache = (nowMs - statusLastLoadedAt) < 45000 && friendKey === statusLastFriendKey;
    if (shouldSkipForTab || (!force && isFreshCache)) return;
    if (statusLoadInFlight) return statusLoadInFlight;

    statusLoadInFlight = (async () => {
        try {
            const now  = new Date();
            const uids = [me.uid, ...friends.map(f => f.uid)];
            allStatuses = {};

            await Promise.all(uids.map(async uid => {
                try {
                    const docs = await awList('statuses', [
                        Query.equal('uid', uid),
                        Query.limit(20),
                    ]);
                    const active = docs
                        .map(d => normalizeStatus(d))
                        .filter(s => { const del = s.deleteAt?.toDate?.(); return del && del > now; })
                        .sort((a, b) => (a.createdAt?.toDate?.()?.getTime()||0) - (b.createdAt?.toDate?.()?.getTime()||0));
                    if (active.length) allStatuses[uid] = active;
                } catch(e) { console.warn('Status fetch failed for', uid, e.message); }
            }));
            statusLastLoadedAt  = Date.now();
            statusLastFriendKey = friendKey;
        } catch(e) {
            console.warn('loadStatuses error:', e.message);
        } finally {
            statusLoadInFlight = null;
        }
    })();

    await statusLoadInFlight;
    renderStatusBar();
}

function renderStatusBar() {
    const row = document.getElementById('statusBarRow');
    if (!row) return;
    row.innerHTML = '';
    const myStatuses = allStatuses[me.uid] || [];
    const myViewed   = getViewedStatuses();
    const myAllSeen  = myStatuses.length > 0 && myStatuses.every(s => myViewed.has(s.id));
    row.appendChild(buildStatusBubble(me.uid, me.displayName || 'You', me.photoURL, myStatuses.length > 0, myAllSeen, true));
    friends.forEach(f => {
        const sts     = allStatuses[f.uid] || [];
        const allSeen = sts.length > 0 && sts.every(s => myViewed.has(s.id));
        if (!sts.length) return;
        row.appendChild(buildStatusBubble(f.uid, f.displayName || f.username, f.photoURL, true, allSeen, false));
    });
}

function buildStatusBubble(uid, name, photoURL, hasStatus, allSeen, isMe) {
    const wrap  = ce('div'); wrap.className = 'status-bubble';
    const ring  = ce('div');
    ring.className = 'status-ring' + (allSeen ? ' seen' : '') + (isMe ? ' mine' : '');
    const inner = ce('div'); inner.className = 'status-ring-inner';
    if (photoURL) { inner.innerHTML = `<img src="${esc(photoURL)}" alt="">`; }
    else { inner.textContent = initials(name); inner.style.cssText += 'font-family:Syne,sans-serif;font-weight:700;font-size:14px;color:white;'; }
    ring.appendChild(inner);
    if (isMe) { const plus = ce('div'); plus.className = 'status-add-btn'; plus.textContent = '+'; ring.appendChild(plus); }
    const label = ce('div'); label.className = 'status-name'; label.textContent = isMe ? 'My Status' : name;
    wrap.onclick = () => {
        if (isMe && !hasStatus) { openAddStatus(); return; }
        const sts = allStatuses[uid];
        if (!sts?.length) { openAddStatus(); return; }
        openStatusViewer(uid, name, photoURL, sts);
    };
    wrap.appendChild(ring); wrap.appendChild(label);
    return wrap;
}

// ── STATUS VIEWER ──────────────────────────────────────────
function openStatusViewer(uid, name, photoURL, statuses) {
    statusCurrentUser  = { uid, name, photoURL, statuses };
    statusCurrentIndex = 0;
    document.getElementById('statusViewer').classList.remove('hidden');
    renderStatusViewerItem();
}

function renderStatusViewerItem() {
    const { name, photoURL, statuses } = statusCurrentUser;
    const s = statuses[statusCurrentIndex];
    if (!s) { closeStatusViewer(); return; }

    const avEl = document.getElementById('svAv');
    if (photoURL) avEl.innerHTML = `<img src="${esc(photoURL)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    else avEl.textContent = initials(name);
    document.getElementById('svName').textContent = name;
    document.getElementById('svTime').textContent = timeAgo(s.createdAt?.toDate?.() || new Date());

    const isOwner = statusCurrentUser.uid === me.uid;
    let delBtn = document.getElementById('svDeleteBtn');
    let addBtn = document.getElementById('svAddBtn');
    if (!delBtn) {
        delBtn = ce('button'); delBtn.id = 'svDeleteBtn';
        delBtn.style.cssText = 'background:rgba(244,63,94,0.2);border:1px solid rgba(244,63,94,0.4);color:#f43f5e;border-radius:9px;padding:5px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:Figtree,sans-serif;margin-left:auto;';
        delBtn.textContent = '🗑 Delete';
        document.getElementById('svHeader').appendChild(delBtn);
    }
    if (!addBtn) {
        addBtn = ce('button'); addBtn.id = 'svAddBtn';
        addBtn.style.cssText = 'background:rgba(124,92,252,0.2);border:1px solid rgba(124,92,252,0.4);color:var(--a2);border-radius:9px;padding:5px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:Figtree,sans-serif;margin-left:4px;';
        addBtn.textContent = '+ Add';
        document.getElementById('svHeader').appendChild(addBtn);
    }
    delBtn.style.display = isOwner ? 'inline-block' : 'none';
    addBtn.style.display = isOwner ? 'inline-block' : 'none';
    delBtn.onclick = () => deleteStatus(s.id);
    addBtn.onclick = () => { closeStatusViewer(); openAddStatus(); };

    const prog = document.getElementById('svProgress');
    prog.innerHTML = '';
    statuses.forEach((_, i) => {
        const seg = ce('div'); seg.className = 'sv-seg';
        const fill = ce('div'); fill.className = 'sv-seg-fill';
        if (i < statusCurrentIndex) fill.style.width = '100%';
        seg.appendChild(fill); prog.appendChild(seg);
    });

    const cont = document.getElementById('svContent');
    cont.querySelectorAll('img,video,.sv-text-card').forEach(el => el.remove());
    if (s.type === 'text') {
        cont.style.background = s.bgColor || '#1e293b';
        const card = ce('div'); card.className = 'sv-text-card'; card.textContent = s.content;
        cont.insertBefore(card, cont.firstChild);
    } else if (s.type === 'photo') {
        cont.style.background = '#000';
        const img = ce('img'); img.src = s.url; img.style.maxWidth='100%'; img.style.maxHeight='100%';
        cont.insertBefore(img, cont.firstChild);
    } else if (s.type === 'video') {
        cont.style.background = '#000';
        const vid = ce('video'); vid.src = s.url; vid.controls = true; vid.autoplay = true;
        vid.style.maxWidth='100%'; vid.style.maxHeight='100%';
        cont.insertBefore(vid, cont.firstChild);
    }

    // Reactions row
    const reactRow = document.getElementById('svReactionsRow');
    reactRow.innerHTML = '';
    const reactions = s.reactions || {};
    const grouped   = {};
    Object.entries(reactions).forEach(([uid, emoji]) => {
        if (!grouped[emoji]) grouped[emoji] = [];
        grouped[emoji].push(uid);
    });
    Object.entries(grouped).forEach(([emoji, uids]) => {
        const chip = ce('span');
        chip.className = 'sv-reaction-chip' + (uids.includes(me.uid) ? ' mine' : '');
        chip.innerHTML = `${emoji} <span class="sv-reaction-count">${uids.length}</span>`;
        chip.title  = uids.length + ' reaction' + (uids.length !== 1 ? 's' : '');
        chip.onclick = () => toggleStatusReaction(s.id, emoji);
        reactRow.appendChild(chip);
    });

    // Views (owner only)
    const viewsEl = document.getElementById('svViews');
    if (isOwner && s.views) {
        const viewUids  = Object.keys(s.views);
        const count     = viewUids.length;
        const likeCount = Object.values(reactions).filter(e => e === '❤️').length;
        viewsEl.innerHTML = '';
        const viewBtn = ce('button');
        viewBtn.style.cssText = 'background:none;border:none;color:rgba(255,255,255,0.6);font-size:12px;cursor:pointer;display:flex;align-items:center;gap:5px;padding:0;font-family:Figtree,sans-serif;';
        viewBtn.innerHTML = `👁 <span>${count} view${count !== 1 ? 's' : ''}</span>`;
        viewBtn.onclick = () => openStatusViewsPanel(s);
        viewsEl.appendChild(viewBtn);
        if (likeCount > 0) {
            const likeSpan = ce('span');
            likeSpan.style.cssText = 'color:rgba(255,255,255,0.55);font-size:12px;margin-left:8px;';
            likeSpan.textContent = `❤️ ${likeCount}`;
            viewsEl.appendChild(likeSpan);
        }
    } else { viewsEl.innerHTML = ''; }

    // Interact bar (viewer)
    const interactBar = document.getElementById('svInteractBar');
    if (!isOwner) {
        interactBar.style.display = 'flex';
        const likeBtn     = document.getElementById('svLikeBtn');
        const alreadyLiked = (s.reactions || {})[me.uid] === '❤️';
        likeBtn.className = 'sv-react-btn' + (alreadyLiked ? ' liked' : '');
        likeBtn.textContent = alreadyLiked ? '❤️ Liked' : '❤️';
        interactBar.dataset.sid = s.id;
        document.getElementById('svReplyIn').value = '';
        // Record view
        if (!isOwner) recordStatusView(s.id);
    } else { interactBar.style.display = 'none'; }

    markStatusViewed(s.id);

    if (statusProgressTimer) clearTimeout(statusProgressTimer);
    const duration = s.type === 'video' ? 30000 : 5000;
    const fillEl   = prog.children[statusCurrentIndex]?.querySelector('.sv-seg-fill');
    if (fillEl) {
        fillEl.style.transition = `width ${duration}ms linear`;
        fillEl.style.width = '100%';
    }
    statusProgressTimer = setTimeout(() => svNext(), duration);
}

async function recordStatusView(statusId) {
    try {
        const doc     = await awGet('statuses', statusId);
        const views   = awDecode(doc.views) || {};
        views[me.uid] = awNow();
        await awUpdate('statuses', statusId, { views: awEncode(views) });
    } catch { /* silent */ }
}

function svNext() {
    if (!statusCurrentUser) return;
    if (statusCurrentIndex < statusCurrentUser.statuses.length - 1) {
        statusCurrentIndex++; renderStatusViewerItem();
    } else { closeStatusViewer(); }
}

function svPrev() {
    if (!statusCurrentUser) return;
    if (statusCurrentIndex > 0) { statusCurrentIndex--; renderStatusViewerItem(); }
}

async function deleteStatus(statusId) {
    if (!confirm('Delete this status?')) return;
    try {
        await awDelete('statuses', statusId);
        showToast('Status deleted.');
        if (allStatuses[me.uid]) allStatuses[me.uid] = allStatuses[me.uid].filter(s => s.id !== statusId);
        if (statusCurrentUser?.statuses) {
            statusCurrentUser.statuses = statusCurrentUser.statuses.filter(s => s.id !== statusId);
            if (statusCurrentUser.statuses.length > 0) {
                statusCurrentIndex = Math.min(statusCurrentIndex, statusCurrentUser.statuses.length - 1);
                renderStatusViewerItem();
            } else { closeStatusViewer(); }
        }
    } catch(e) { showToast('Could not delete: ' + e.message); }
}

// ── STATUS INTERACTIONS ────────────────────────────────────
const SV_EMOJIS = ['❤️','🔥','😂','😮','😢','🎉','👏','💯','😍','🥲','😭','🤩','😎','💪','🙏'];
let svEmojiPickerEl = null;

function svPauseProgress() { if (statusProgressTimer) { clearTimeout(statusProgressTimer); statusProgressTimer = null; } }
function svResumeProgress(s) {
    if (!s || statusProgressTimer) return;
    const duration = s.type === 'video' ? 30000 : 5000;
    const prog = document.getElementById('svProgress');
    const fillEl = prog?.children[statusCurrentIndex]?.querySelector('.sv-seg-fill');
    if (fillEl) {
        const remaining = duration * (1 - parseFloat(fillEl.style.width) / 100);
        statusProgressTimer = setTimeout(() => svNext(), Math.max(remaining, 500));
    }
}

async function toggleStatusLike() {
    svPauseProgress();
    const sid = document.getElementById('svInteractBar').dataset.sid;
    if (!sid) return;
    const s = statusCurrentUser?.statuses?.[statusCurrentIndex];
    try {
        const doc       = await awGet('statuses', sid);
        const reactions = awDecode(doc.reactions) || {};
        if (reactions[me.uid] === '❤️') { delete reactions[me.uid]; }
        else { reactions[me.uid] = '❤️'; }
        await awUpdate('statuses', sid, { reactions: awEncode(reactions) });
        if (s) s.reactions = reactions;
        renderStatusViewerItem();
    } catch(e) { showToast('Could not react: ' + e.message); }
    svResumeProgress(s);
}

async function toggleStatusReaction(sid, emoji) {
    svPauseProgress();
    const s = statusCurrentUser?.statuses?.[statusCurrentIndex];
    try {
        const doc       = await awGet('statuses', sid);
        const reactions = awDecode(doc.reactions) || {};
        if (reactions[me.uid] === emoji) { delete reactions[me.uid]; }
        else { reactions[me.uid] = emoji; }
        await awUpdate('statuses', sid, { reactions: awEncode(reactions) });
        if (s) s.reactions = reactions;
        renderStatusViewerItem();
    } catch(e) { showToast('Could not react: ' + e.message); }
    svResumeProgress(s);
}

function toggleStatusEmojiPicker(event) {
    event.stopPropagation(); svPauseProgress();
    if (svEmojiPickerEl) { svEmojiPickerEl.remove(); svEmojiPickerEl = null; return; }
    const bar    = document.getElementById('svInteractBar');
    const picker = ce('div'); picker.className = 'sv-emoji-picker';
    SV_EMOJIS.forEach(em => {
        const sp = ce('span'); sp.className = 'sv-ep-emoji'; sp.textContent = em;
        sp.onclick = (e) => {
            e.stopPropagation(); picker.remove(); svEmojiPickerEl = null;
            const sid = bar.dataset.sid;
            if (sid) toggleStatusReaction(sid, em);
        };
        picker.appendChild(sp);
    });
    bar.style.position = 'relative'; bar.appendChild(picker);
    svEmojiPickerEl = picker;
    setTimeout(() => {
        document.addEventListener('click', function closePicker() {
            picker.remove(); svEmojiPickerEl = null;
            document.removeEventListener('click', closePicker);
        }, { once: true });
    }, 0);
}

async function sendStatusReply() {
    const inp  = document.getElementById('svReplyIn');
    const text = inp.value.trim();
    if (!text) return;
    const s = statusCurrentUser?.statuses?.[statusCurrentIndex];
    if (!s) return;
    const targetUid = statusCurrentUser.uid;
    const friend    = friends.find(f => f.uid === targetUid);
    if (!friend) { showToast('Add them as a friend to reply!'); return; }

    const preview = s.type === 'text' ? (s.content||'').slice(0,60) : s.type === 'photo' ? '📷 Photo status' : s.type === 'video' ? '🎥 Video status' : 'Status';
    const replyPayload = { type: 'text', text, replyTo: { msgId: s.id, who: statusCurrentUser.name, snippet: `📌 Status: ${preview}` } };

    const savedChat = chatId, savedType = chatType;
    chatId   = dmId(me.uid, targetUid);
    chatType = 'dm';
    await awUpsert('conversations', chatId, { lastAt: awNow() });
    await pushMsg(replyPayload);
    chatId   = savedChat;
    chatType = savedType;

    inp.value = '';
    showToast('Reply sent! 💬');
    closeStatusViewer();
    switchTab('dms');
    openDM(friend);
}

async function openStatusViewsPanel(s) {
    svPauseProgress();
    document.getElementById('svViewsPanel')?.remove();
    const panel    = ce('div'); panel.id = 'svViewsPanel'; panel.className = 'sv-views-panel';
    const backdrop = ce('div'); backdrop.className = 'sv-views-backdrop';
    backdrop.onclick = () => { panel.remove(); svResumeProgress(statusCurrentUser?.statuses?.[statusCurrentIndex]); };
    const sheet = ce('div'); sheet.className = 'sv-views-sheet';
    sheet.innerHTML = `<span class="sv-views-handle"></span><div class="sv-views-title">👁 Viewed by</div><div id="svViewerList"><div style="color:var(--muted);font-size:13px;padding:8px 0;">Loading…</div></div>`;
    panel.appendChild(backdrop); panel.appendChild(sheet);
    document.body.appendChild(panel);

    try {
        const viewUids  = Object.keys(s.views || {});
        const reactions = s.reactions || {};
        if (!viewUids.length) {
            document.getElementById('svViewerList').innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0;">No views yet.</div>';
            return;
        }
        const profiles = {};
        for (let i = 0; i < viewUids.length; i += 100) {
            const chunk = viewUids.slice(i, i + 100);
            const docs  = await awList('users', [Query.equal('$id', chunk), Query.limit(100)]);
            docs.forEach(d => { profiles[d.$id] = awDecodeUser(d); });
        }
        const list = document.getElementById('svViewerList');
        list.innerHTML = '';
        viewUids.forEach(uid => {
            const p    = profiles[uid] || {};
            const when = s.views[uid] ? new Date(s.views[uid]) : null;
            const rx   = reactions[uid] || null;
            const row  = ce('div'); row.className = 'sv-viewer-row';
            row.innerHTML = `
                ${mkAv(p.displayName||'?', p.photoURL||null, 32)}
                <div class="sv-viewer-name">${esc(p.displayName||p.username||'?')}<br>
                    <span style="font-size:11px;color:var(--muted);font-weight:400;">@${esc(p.username||'')}</span>
                </div>
                ${rx ? `<span class="sv-viewer-reaction">${rx}</span>` : ''}
                <span class="sv-viewer-time">${when ? timeAgo(when) : ''}</span>`;
            list.appendChild(row);
        });
    } catch(e) {
        document.getElementById('svViewerList').innerHTML = `<div style="color:var(--danger);font-size:13px;">${esc(e.message)}</div>`;
    }
}

function closeStatusViewer() {
    if (statusProgressTimer) clearTimeout(statusProgressTimer);
    document.getElementById('statusViewer').classList.add('hidden');
    document.getElementById('svContent').style.background = '#000';
    document.getElementById('svDeleteBtn')?.remove();
    document.getElementById('svAddBtn')?.remove();
    document.getElementById('svViewsPanel')?.remove();
    if (svEmojiPickerEl) { svEmojiPickerEl.remove(); svEmojiPickerEl = null; }
    document.getElementById('svReactionsRow').innerHTML = '';
    document.getElementById('svInteractBar').style.display = 'none';
    document.getElementById('svViews').innerHTML = '';
    statusCurrentUser = null;
    renderStatusBar();
}

function getViewedStatuses()  { try { return new Set(JSON.parse(localStorage.getItem('normsg_viewed_st')||'[]')); } catch { return new Set(); } }
function markStatusViewed(id) { const s = getViewedStatuses(); s.add(id); localStorage.setItem('normsg_viewed_st', JSON.stringify([...s].slice(-500))); }

// ── ADD STATUS ─────────────────────────────────────────────
function openAddStatus() {
    stType = 'text';
    document.getElementById('stTextArea').classList.remove('hidden');
    document.getElementById('stMediaArea').classList.add('hidden');
    document.getElementById('stTextIn').value = '';
    document.getElementById('stMediaIn').value = '';
    document.getElementById('stImgPreview').style.display = 'none';
    document.getElementById('stVidPreview').style.display = 'none';
    document.getElementById('stMediaPreviewWrap').classList.add('hidden');
    mmsg('stMsg','','');
    const sw = document.getElementById('stSwatches');
    sw.innerHTML = '';
    STATUS_COLORS.forEach((c, i) => {
        const s = ce('div'); s.className = 'swatch' + (i===0?' on':'');
        s.style.background = c;
        s.onclick = () => {
            stSelectedColor = c;
            sw.querySelectorAll('.swatch').forEach(el => el.classList.remove('on'));
            s.classList.add('on');
            document.getElementById('stPreview').style.background = c;
        };
        sw.appendChild(s);
    });
    stSelectedColor = STATUS_COLORS[0];
    document.getElementById('stPreview').style.background = STATUS_COLORS[0];
    document.getElementById('stPreview').textContent = 'Your text here…';
    updateTypeButtons();
    document.getElementById('addStatusModal').classList.remove('hidden');
}

function setStatusType(type) {
    stType = type;
    document.getElementById('stTextArea').classList.toggle('hidden', type !== 'text');
    document.getElementById('stMediaArea').classList.toggle('hidden', type === 'text');
    document.getElementById('stMediaIcon').textContent  = type === 'video' ? '🎥' : '📷';
    document.getElementById('stMediaLabel').textContent = type === 'video' ? 'Click to choose a video (max 100 MB)' : 'Click to choose a photo';
    document.getElementById('stMediaIn').accept = type === 'video' ? 'video/*' : 'image/*';
    updateTypeButtons();
}

function updateTypeButtons() {
    ['text','photo','video'].forEach(t => {
        document.getElementById('stType'+t.charAt(0).toUpperCase()+t.slice(1)).classList.toggle('on', t === stType);
    });
}

function updateStatusPreview() {
    document.getElementById('stPreview').textContent = document.getElementById('stTextIn').value || 'Your text here…';
}

function previewStatusMedia(event) {
    const file = event.target.files[0];
    if (!file) return;
    const wrap = document.getElementById('stMediaPreviewWrap');
    const img  = document.getElementById('stImgPreview');
    const vid  = document.getElementById('stVidPreview');
    const url  = URL.createObjectURL(file);
    if (file.type.startsWith('image/')) { img.src=url; img.style.display='block'; vid.style.display='none'; }
    else { vid.src=url; vid.style.display='block'; img.style.display='none'; }
    wrap.classList.remove('hidden');
    document.getElementById('stMediaLabel').textContent = file.name;
}

async function postStatus() {
    mmsg('stMsg','⟳ Posting…','inf');
    try {
        const now      = new Date();
        const deleteAt = new Date(now.getTime() + 24 * 3600000).toISOString();
        let statusData = {
            uid:         me.uid,
            createdAt:   now.toISOString(),
            deleteAt,
            views:       awEncode({}),
            reactions:   awEncode({}),
        };

        if (stType === 'text') {
            const txt = document.getElementById('stTextIn').value.trim();
            if (!txt) return mmsg('stMsg','Enter some text.','err');
            statusData = { ...statusData, type: 'text', content: txt, bgColor: stSelectedColor };
        } else {
            const file = document.getElementById('stMediaIn').files[0];
            if (!file) return mmsg('stMsg','Select a file first.','err');
            const maxSize = stType === 'video' ? 100 : 20;
            if (file.size > maxSize * 1024 * 1024) return mmsg('stMsg', `File too large — max ${maxSize} MB.`, 'err');
            const resType = stType === 'video' ? 'video' : 'image';
            const { url } = await uploadToCloudinary(file, resType);
            statusData = { ...statusData, type: stType, url };
        }

        await awAdd('statuses', statusData);
        closeModal('addStatusModal');
        showToast('Status posted! ✨');
        await loadStatuses({ force: true });
    } catch(e) {
        mmsg('stMsg', 'Failed: ' + e.message, 'err');
        console.error('postStatus:', e);
    }
}
