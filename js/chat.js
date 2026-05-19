// ── OPEN CHAT ──────────────────────────────────────────────
function openDM(friend) {
    chatType = 'dm';
    chatId   = dmId(me.uid, friend.uid);
    clearReply();

    const av = document.getElementById('chatAv');
    av.innerHTML = friend.photoURL ? `<img src="${esc(friend.photoURL)}" alt="">` : initials(friend.displayName||'?');
    av.classList.remove('av-grp');

    const nicks = getNicknames();
    const nick  = nicks[friend.uid];
    document.getElementById('chatName').textContent = nick || friend.displayName;

    const pres = friendPresence[friend.uid];
    updateChatSubStatus(pres?.online === true, pres?.lastSeen || null);

    document.getElementById('renameChatBtn').classList.add('hidden');
    document.getElementById('leaveBtn').title = 'Hide conversation';
    document.getElementById('pollBtn').style.display       = 'none';
    document.getElementById('aiImgBtn').style.display      = 'none';
    document.getElementById('regularImgBtn').style.display = 'inline-flex';
    document.getElementById('stickerBtn').style.display    = 'inline-flex';
    document.getElementById('scheduleBtn').style.display   = 'inline-flex';
    document.getElementById('normAIBtn').style.display     = 'inline-flex';
    document.getElementById('aiModelDropdownWrap').classList.remove('visible');
    markRead(chatId);
    activateChat();
    renderFriends();
    document.getElementById('sidebar').classList.remove('open');

    subMessages(chatId, 'dm');
    runCleanup(chatId);
}

function openGroup(group) {
    chatType = 'group';
    chatId   = group.id;
    clearReply();

    const av = document.getElementById('chatAv');
    av.innerHTML = esc((group.name[0]||'G').toUpperCase());
    av.classList.add('av-grp');
    document.getElementById('chatName').textContent = group.name;
    document.getElementById('chatSub').textContent  = (group.members?.length||0) + ' members';

    document.getElementById('renameChatBtn').classList.remove('hidden');
    document.getElementById('leaveBtn').title = 'Leave group';
    document.getElementById('pollBtn').style.display       = 'inline-flex';
    document.getElementById('aiImgBtn').style.display      = 'none';
    document.getElementById('regularImgBtn').style.display = 'inline-flex';
    document.getElementById('stickerBtn').style.display    = 'inline-flex';
    document.getElementById('scheduleBtn').style.display   = 'inline-flex';
    document.getElementById('normAIBtn').style.display     = 'inline-flex';
    document.getElementById('aiModelDropdownWrap').classList.remove('visible');
    markRead(chatId);
    activateChat();
    renderGroups();
    document.getElementById('sidebar').classList.remove('open');

    subMessages(chatId, 'group');
    runCleanup(chatId);
    mentionMembers = [];
}

function activateChat() {
    document.getElementById('emptyState').classList.add('hidden');
    const ac = document.getElementById('activeChat');
    ac.classList.remove('hidden');
    ac.style.display = 'flex';
    document.getElementById('msgInput').focus();
    clearToBanner();
    subscribePinned();
}

// ── MESSAGES ───────────────────────────────────────────────
const MSG_PAGE = 40;
let _lastRenderedMsgIds = [];
let msgUnsub = null; // 👈 ADD THIS LINE HERE

function subMessages(chatIdArg, chatTypeArg) {
    if (msgUnsub) { msgUnsub(); msgUnsub = null; }
    document.getElementById('messagesArea').innerHTML = '';
    _lastRenderedMsgIds = [];

    // Initial load
    awList('messages', [
        Query.equal('chatId', chatIdArg),
        Query.orderDesc('timestamp'),
        Query.limit(MSG_PAGE),
    ]).then(docs => {
        const msgs = docs.reverse().map(d => normalizeMsg(d));
        renderMsgs(msgs);
        if (chatIdArg === chatId) markRead(chatIdArg);
    });

    // Real-time updates
    msgUnsub = awSubscribe(['messages'], response => {
        const doc = response.payload;
        if (!doc || doc.chatId !== chatIdArg) return;
        // Re-fetch to keep correct order and state
        awList('messages', [
            Query.equal('chatId', chatIdArg),
            Query.orderDesc('timestamp'),
            Query.limit(MSG_PAGE),
        ]).then(docs => {
            const msgs = docs.reverse().map(d => normalizeMsg(d));
            renderMsgs(msgs);
            if (chatIdArg === chatId) markRead(chatIdArg);
        });
    });
}

// Convert an Appwrite message doc to the shape renderMsgs expects
function normalizeMsg(d) {
    return {
        id:             d.$id,
        chatId:         d.chatId,
        chatType:       d.chatType,
        senderUid:      d.senderUid,
        senderName:     d.senderName,
        senderUsername: d.senderUsername,
        senderPhoto:    d.senderPhoto,
        senderSuper:    d.senderSuper,
        text:           d.text,
        type:           d.type,
        imageUrl:       d.imageUrl,
        videoUrl:       d.videoUrl,
        storagePath:    d.storagePath,
        usedSuper:      d.usedSuper,
        question:       d.question,
        options:        d.options || [],
        deletedByUsername: d.deletedByUsername,
        timestamp:      d.timestamp ? { toDate: () => new Date(d.timestamp) } : null,
        deleteAt:       d.deleteAt  ? { toDate: () => new Date(d.deleteAt)  } : null,
        replyTo:        awDecode(d.replyTo),
        votes:          awDecode(d.votes)   || {},
        reactions:      awDecode(d.reactions) || {},
    };
}

function renderMsgs(msgs) {
    const area = document.getElementById('messagesArea');
    area.innerHTML = '';
    const hiddenMsgs = getHiddenMsgs();
    let lastDate = null;

    msgs.filter(m => !hiddenMsgs.has(m.id)).forEach((msg, i, arr) => {
        const ts   = msg.timestamp?.toDate?.() || new Date();
        const ds   = dateLabel(ts);
        const mine = msg.senderUid === me.uid;
        const nxt  = arr[i+1];
        const same = nxt && nxt.senderUid === msg.senderUid;

        if (ds !== lastDate) {
            lastDate = ds;
            const div = ce('div'); div.className = 'date-div';
            div.innerHTML = `<span>${ds}</span>`;
            area.appendChild(div);
        }

        const row = ce('div');
        const mid = msg.id;
        row.className = 'msg-row' + (mine ? ' sent' : '');
        row.dataset.mid = mid;

        const avClickAttr = (!same && msg.senderUid && msg.senderUid !== 'AI')
            ? `onclick="openUserProfile('${msg.senderUid.replace(/'/g,"\\'")}','${esc(msg.senderName||'?').replace(/'/g,"\\'")}','${(msg.senderPhoto||'').replace(/'/g,"\\'")}','${(msg.senderUsername||'').replace(/'/g,"\\'")}')"`
            : '';
        const avPart = mine ? '' :
            `<div class="msg-av ${same?'inv':''}" ${avClickAttr}>` +
            (msg.senderPhoto ? `<img src="${esc(msg.senderPhoto)}" alt="">` : initials(msg.senderName||'?')) +
            `</div>`;

        let bubble = '';
        if (msg.type === 'sticker') {
            bubble = `<div class="sticker-bubble" data-mid="${mid}">
                <img src="${esc(msg.imageUrl||'')}" loading="lazy" onclick="openLB('${esc(msg.imageUrl||'')}')">
            </div>`;
        } else if (msg.type === 'deleted') {
            bubble = `<div class="bubble ${mine?'sent':'recv'}" style="opacity:0.45;font-style:italic;font-size:12px;">
                🗑 Message deleted by @${esc(msg.deletedByUsername||'admin')}
            </div>`;
        } else if (msg.type === 'ai') {
            const superBadge = msg.usedSuper ? `<span class="ai-super-badge">✦ SUPER</span>` : '';
            bubble = `<div class="bubble ai">
                <div class="ai-header"><div class="ai-avatar">✦</div> AI Assistant${superBadge}</div>
                ${renderAIText(msg.text)}
            </div>`;
        } else if (msg.type === 'ai-thinking') {
            bubble = `<div class="bubble ai">
                <div class="ai-header"><div class="ai-avatar">✦</div> AI Assistant</div>
                <div class="ai-thinking"><div class="typing-dots"><span></span><span></span><span></span></div> Thinking…</div>
            </div>`;
        } else if (msg.type === 'image') {
            bubble = `<div class="bubble ${mine?'sent':'recv'} img-bub">
                ${msg.replyTo ? renderQuote(msg.replyTo, mine) : ''}
                <img class="msg-img" src="${esc(msg.imageUrl)}" loading="lazy" onclick="openLB('${esc(msg.imageUrl)}')">
            </div>`;
        } else if (msg.type === 'video') {
            bubble = `<div class="bubble ${mine?'sent':'recv'} img-bub">
                ${msg.replyTo ? renderQuote(msg.replyTo, mine) : ''}
                <video class="msg-img" src="${esc(msg.videoUrl)}" controls preload="metadata"
                    style="max-width:280px;max-height:220px;border-radius:10px;display:block;"></video>
            </div>`;
        } else if (msg.type === 'poll') {
            const votes  = msg.votes  || {};
            const opts   = msg.options || [];
            const total  = Object.keys(votes).length;
            const myVote = votes[me.uid] !== undefined ? votes[me.uid] : -1;
            const optHTML = opts.map((opt, i) => {
                const count = Object.values(votes).filter(v => v === i).length;
                const pct   = total ? Math.round(count / total * 100) : 0;
                const isMe  = myVote === i;
                return `<div class="poll-opt${isMe?' voted':''}" onclick="votePoll('${mid}',${i})">
                    <div class="poll-opt-bar" style="width:${pct}%"></div>
                    <span class="poll-opt-label">${esc(opt)}</span>
                    <span class="poll-opt-pct">${pct}%</span>
                </div>`;
            }).join('');
            bubble = `<div class="poll-bubble">
                <div class="poll-q">${esc(msg.question||'Poll')}</div>
                ${optHTML}
                <div class="poll-footer">${total} vote${total===1?'':'s'}${myVote>=0?' · You voted':''}${mine?` · <span style="cursor:pointer;color:var(--danger);" onclick="delMsg('${mid}','','',false)">Delete</span>`:''}</div>
            </div>`;
        } else {
            bubble = `<div class="bubble ${mine?'sent':'recv'}">
                ${msg.replyTo ? renderQuote(msg.replyTo, mine) : ''}
                ${renderMsgText(msg.text)}
            </div>`;
        }

        const showName = chatType==='group' && !mine && !same;
        const senderIsSuper = msg.senderSuper === true;
        const senderNameHTML = senderIsSuper
            ? `<span class="msg-sender-name super-name">@${esc(msg.senderUsername||msg.senderName||'')} <span class="super-badge">✦ SUPER</span></span>`
            : `<span class="msg-sender-name">@${esc(msg.senderUsername||msg.senderName||'')}</span>`;

        const isGroupAdmin = chatType === 'group' && (() => {
            const grp = myGroups.find(g => g.id === chatId);
            return grp && ((grp.admins||[]).includes(me.uid) || grp.createdBy === me.uid);
        })();

        const isAIMsg   = msg.type === 'ai' || msg.type === 'ai-thinking';
        const isPollMsg = msg.type === 'poll';
        const replySnip = msg.type === 'image' ? '[Image]' : msg.type === 'video' ? '[Video]' : msg.type === 'poll' ? '[Poll]' : msg.type === 'sticker' ? '[Sticker]' : (msg.text||'').slice(0,60);

        const actionBtn = (msg.type === 'deleted' || isAIMsg || isPollMsg) ? '' : (mine
            ? `<button class="msg-del" onclick="delMsg('${mid}','','${(msg.storagePath||'').replace(/'/g,"\\'")}',false)">Delete</button>
               ${chatType==='group' ? `<button class="msg-del" style="color:var(--a2);" onclick="pinMessage('${mid}','${replySnip.replace(/'/g,"\\'").replace(/\n/g,' ')}')">📌</button>` : ''}`
            : isGroupAdmin
                ? `<button class="msg-del" onclick="delMsg('${mid}','','',true)" style="color:var(--warn);">🛡 Del</button>
                   <button class="msg-del" style="color:var(--a2);" onclick="pinMessage('${mid}','${replySnip.replace(/'/g,"\\'").replace(/\n/g,' ')}')">📌</button>`
                : `<button class="msg-del" onclick="hideForMe('${mid}')" style="color:var(--muted);">Hide</button>`);

        const replyBtn    = (isAIMsg || isPollMsg) ? '' : `<button class="msg-reply-btn" onclick="setReply('${mid}','${esc((msg.senderUsername||msg.senderName||'?')).replace(/'/g,"\\'")}','${replySnip.replace(/'/g,"\\'").replace(/\n/g,' ')}')">↩</button>`;
        const emojiTrigger = (isAIMsg || isPollMsg) ? '' : `<button class="emoji-trigger" onclick="openEmojiPicker(event,'${mid}')">😊</button>`;

        // Reactions
        const reactions = msg.reactions || {};
        let reactHTML = '';
        if (!isAIMsg) {
            const grouped = {};
            Object.entries(reactions).forEach(([uid, emoji]) => {
                if (!grouped[emoji]) grouped[emoji] = [];
                grouped[emoji].push(uid);
            });
            const chips = Object.entries(grouped).map(([emoji, uids]) => {
                const iMine = uids.includes(me.uid);
                return `<span class="reaction-chip${iMine?' mine':''}" onclick="toggleReaction('${mid}','${emoji}')">${emoji} <span class="reaction-count">${uids.length}</span></span>`;
            }).join('');
            if (chips) reactHTML = `<div class="reactions-row">${chips}</div>`;
        }

        row.innerHTML = `${avPart}
<div class="bwrap">
    <div style="display:flex;align-items:flex-start;gap:4px;${mine?'flex-direction:row-reverse;':''}">
        ${bubble}
        ${emojiTrigger}
    </div>
    ${reactHTML}
    <div class="msg-meta">
        ${showName ? senderNameHTML : ''}
        ${!same ? `<span class="msg-time">${fmtTime(ts)}</span>` : ''}
        ${replyBtn}
        ${actionBtn}
    </div>
</div>`;

        area.appendChild(row);
    });

    requestAnimationFrame(() => {
        area.scrollTop = area.scrollHeight;
        typesetAIMathIn(area);
    });
    if (msgs.length > 0) {
        const last = msgs[msgs.length - 1];
        if (last && last.senderUid && last.senderUid !== me?.uid) playMsgSound('receive');
    }
}

// ── REPLY STATE ────────────────────────────────────────────
let replyTo = null;

function setReply(msgId, who, snippet) {
    replyTo = { msgId, who, snippet };
    document.getElementById('replyWho').textContent    = '↩ ' + who;
    document.getElementById('replySnippet').textContent = snippet;
    document.getElementById('replyBar').classList.add('on');
    document.getElementById('msgInput').focus();
}

function clearReply() {
    replyTo = null;
    document.getElementById('replyBar').classList.remove('on');
}

function renderQuote(rt, isSent) {
    return `<div class="reply-quote">
        <div class="reply-quote-who">↩ ${esc(rt.who)}</div>
        <div class="reply-quote-txt">${esc(rt.snippet)}</div>
    </div>`;
}

// ── SEND ───────────────────────────────────────────────────
async function sendMsg() {
    if (chatType === 'ai') { sendAIChatMsg(); return; }
    const inp  = document.getElementById('msgInput');
    const text = inp.value.trim();
    if (!text || !chatId) return;

    const validErr = validateMsg(text);
    if (validErr) { showToast(validErr); return; }

    if (!await checkSend('text', text)) return;
    inp.value = ''; inp.style.height = '';
    const rt = replyTo ? { ...replyTo } : null;
    clearReply();
    await pushMsg({ type: 'text', text, ...(rt ? { replyTo: rt } : {}) });
    ntOnMessage();

    if (chatType === 'group' && /@AI\b/i.test(text)) triggerAIResponse(text);
}

// ── IMAGE/VIDEO UPLOAD — CLOUDINARY ───────────────────────
const CLOUDINARY_CLOUD  = 'dc6349v8c';
const CLOUDINARY_PRESET = 'NorMSG';
let uploadAbortController = null;

async function compressImage(file, maxSizeMB = 1.5) {
    if (file.type === 'image/gif' || file.size < 300 * 1024) return file;
    return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;
            const maxDim = 1920;
            if (width > maxDim || height > maxDim) {
                const scale = maxDim / Math.max(width, height);
                width  = Math.round(width  * scale);
                height = Math.round(height * scale);
            }
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            canvas.toBlob(blob => {
                if (blob && blob.size > maxSizeMB * 1024 * 1024) {
                    canvas.toBlob(b2 => resolve(b2 || blob), 'image/jpeg', 0.65);
                } else { resolve(blob || file); }
            }, 'image/jpeg', 0.82);
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
        img.src = url;
    });
}

async function uploadToCloudinary(fileOrBlob, resourceType = 'image') {
    uploadAbortController = new AbortController();
    const fd = new FormData();
    fd.append('file', fileOrBlob);
    fd.append('upload_preset', CLOUDINARY_PRESET);
    const res = await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/${resourceType}/upload`,
        { method: 'POST', body: fd, signal: uploadAbortController.signal }
    );
    uploadAbortController = null;
    if (!res.ok) throw new Error(`Cloudinary ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return { url: data.secure_url, publicId: data.public_id };
}

function dataUrlToBlob(dataUrl) {
    const [header, b64] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)[1];
    const bin  = atob(b64);
    const arr  = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
}

async function uploadDataUrl(dataUrl) {
    const blob = dataUrlToBlob(dataUrl);
    const { url } = await uploadToCloudinary(blob);
    return url;
}

function cancelUpload() {
    if (uploadAbortController) { uploadAbortController.abort(); uploadAbortController = null; }
    document.getElementById('upInd').classList.remove('on');
    showToast('Upload cancelled.');
}

async function handleImg(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file || !chatId) return;

    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isImage && !isVideo) return showToast('Please select an image or video file.');
    if (isVideo && userPlan === 'free') return showToast('🎥 Video uploads are a Pro/Super feature.');

    const maxMB = isVideo ? 150 : (userPlan !== 'free' ? 100 : 25);
    if (file.size > maxMB*1024*1024) return showToast(`File too large — max ${maxMB} MB.`);
    if (!await checkSend('image', '')) return;

    document.getElementById('upInd').classList.add('on');
    document.querySelector('#upInd span:last-child').textContent = isVideo ? 'Uploading video…' : 'Uploading image…';
    try {
        if (isVideo) {
            const { url, publicId } = await uploadToCloudinary(file, 'video');
            const rt = replyTo ? { ...replyTo } : null; clearReply();
            await pushMsg({ type: 'video', videoUrl: url, storagePath: publicId, text: '', ...(rt ? { replyTo: rt } : {}) });
        } else {
            const compressed = await compressImage(file);
            const { url, publicId } = await uploadToCloudinary(compressed);
            const rt = replyTo ? { ...replyTo } : null; clearReply();
            await pushMsg({ type: 'image', imageUrl: url, storagePath: publicId, text: '', ...(rt ? { replyTo: rt } : {}) });
        }
    } catch(e) {
        if (e?.name === 'AbortError') showToast('Upload cancelled.');
        else { showToast('Upload failed: ' + e.message); console.error('handleImg:', e); }
    } finally {
        document.getElementById('upInd').classList.remove('on');
        document.querySelector('#upInd span:last-child').textContent = 'Uploading image…';
    }
}

// ── PUSH MESSAGE ───────────────────────────────────────────
async function pushMsg(extra) {
    const parentCol = chatType === 'dm' ? 'conversations' : 'groups';
    const isSuper   = userPlan === 'pro' || userPlan === 'ultra' || superCache[me.uid] === true || ultraCache[me.uid] === true;

    const summary = {
        lastAt:             awNow(),
        lastSenderUid:      me.uid,
        lastSenderUsername: myUsername || me.displayName || '',
        lastText:           extra.type === 'image' ? '' : (extra.text || ''),
        lastType:           extra.type || 'text',
    };

    await awUpsert(parentCol, chatId, summary);

    const msgData = {
        chatId,
        chatType,
        senderUid:      me.uid,
        senderName:     me.displayName || me.email,
        senderUsername: myUsername,
        senderPhoto:    me.photoURL || null,
        senderSuper:    isSuper,
        timestamp:      awNow(),
        type:           extra.type || 'text',
        text:           extra.text || null,
        imageUrl:       extra.imageUrl   || null,
        videoUrl:       extra.videoUrl   || null,
        storagePath:    extra.storagePath || null,
        question:       extra.question   || null,
        options:        extra.options    || null,
        replyTo:        extra.replyTo ? awEncode(extra.replyTo) : null,
        votes:          extra.votes   ? awEncode(extra.votes)   : null,
        reactions:      null,
        deleteAt:       extra.deleteAt ? (extra.deleteAt instanceof Date ? extra.deleteAt.toISOString() : extra.deleteAt) : null,
    };

    await awAdd('messages', msgData);
    incrementWeeklyCount();
    playMsgSound('send');
}

// ── DELETE ─────────────────────────────────────────────────
async function delMsg(msgId, _msgPath, _storagePath, isAdminDel = false) {
    if (!confirm(isAdminDel ? 'Delete this message as admin?' : 'Delete this message?')) return;
    try {
        if (isAdminDel) {
            await awUpdate('messages', msgId, {
                text: '', type: 'deleted',
                deletedBy: me.uid,
                deletedByUsername: myUsername || me.displayName,
                deletedAt: awNow(),
            });
        } else {
            await awDelete('messages', msgId);
        }
    } catch(e) { showToast('Could not delete message.'); }
}

// ── CLEANUP (auto-delete expired) ─────────────────────────
async function runCleanup(chatIdArg) {
    try {
        const now  = new Date().toISOString();
        const docs = await awList('messages', [
            Query.equal('chatId', chatIdArg),
            Query.lessThan('deleteAt', now),
            Query.limit(50),
        ]);
        if (!docs.length) return;
        await Promise.all(docs.map(doc => awDelete('messages', doc.$id)));
    } catch(e) {
        console.warn('Cleanup skipped:', e.message);
    }
}

// ── REACTIONS ──────────────────────────────────────────────
const REACTION_EMOJIS = ['❤️','😂','😮','🔥','😢','👍','🎉','💯'];
let _emojiPickerMid = null;

function openEmojiPicker(event, mid) {
    event.stopPropagation();
    document.getElementById('emojiReactPicker')?.remove();
    _emojiPickerMid = mid;

    const picker = ce('div');
    picker.id = 'emojiReactPicker';
    picker.style.cssText = `position:fixed;z-index:999;background:var(--panel);border:1px solid var(--border2);
        border-radius:14px;padding:8px 10px;display:flex;gap:8px;flex-wrap:wrap;max-width:220px;
        box-shadow:0 8px 32px rgba(0,0,0,0.5);`;
    REACTION_EMOJIS.forEach(em => {
        const sp = ce('span');
        sp.style.cssText = 'cursor:pointer;font-size:22px;transition:transform 0.1s;';
        sp.textContent = em;
        sp.onmouseenter = () => sp.style.transform = 'scale(1.3)';
        sp.onmouseleave = () => sp.style.transform = '';
        sp.onclick = (e) => {
            e.stopPropagation();
            picker.remove();
            toggleReaction(mid, em);
        };
        picker.appendChild(sp);
    });

    const rect = event.target.getBoundingClientRect();
    picker.style.top  = (rect.top - 60) + 'px';
    picker.style.left = Math.min(rect.left, window.innerWidth - 240) + 'px';
    document.body.appendChild(picker);

    setTimeout(() => {
        document.addEventListener('click', function closePicker() {
            picker.remove();
            document.removeEventListener('click', closePicker);
        }, { once: true });
    }, 0);
}

async function toggleReaction(msgId, emoji) {
    try {
        const doc      = await awGet('messages', msgId);
        const reactions = awDecode(doc.reactions) || {};
        const cur = reactions[me.uid];
        if (cur === emoji) { delete reactions[me.uid]; }
        else { reactions[me.uid] = emoji; }
        await awUpdate('messages', msgId, { reactions: awEncode(reactions) });
    } catch(e) { showToast('Could not react.'); }
}

// ── VOTE ON POLL ───────────────────────────────────────────
async function votePoll(msgId, optIndex) {
    try {
        const doc   = await awGet('messages', msgId);
        const votes = awDecode(doc.votes) || {};
        votes[me.uid] = optIndex;
        await awUpdate('messages', msgId, { votes: awEncode(votes) });
    } catch(e) { showToast('Could not vote.'); }
}

// ── PINNED MESSAGES ────────────────────────────────────────
let pinnedUnsub = null;

function subscribePinned() {
    if (pinnedUnsub) { pinnedUnsub(); pinnedUnsub = null; }
    if (chatType !== 'group') { clearPinnedBanner(); return; }

    // Load initial pinned state from current group
    const grp = myGroups.find(g => g.id === chatId);
    if (grp) renderPinnedBanner(awDecode(grp.pinned));

    // Real-time updates
    pinnedUnsub = awSubscribe(['groups'], response => {
        const doc = response.payload;
        if (!doc || doc.$id !== chatId) return;
        renderPinnedBanner(awDecode(doc.pinned));
    });
}

function renderPinnedBanner(pinned) {
    const banner = document.getElementById('pinnedBanner');
    if (!banner) return;
    if (!pinned?.snippet) { banner.classList.add('hidden'); return; }
    const el = document.getElementById('pinnedText');
    if (el) el.textContent = '📌 ' + pinned.snippet;
    banner.classList.remove('hidden');
}

function clearPinnedBanner() {
    const banner = document.getElementById('pinnedBanner');
    if (banner) banner.classList.add('hidden');
}

async function pinMessage(msgId, snippet) {
    if (!chatId || chatType !== 'group') return;
    try {
        const pinned = { msgId, snippet, pinnedBy: me.uid, pinnedAt: awNow() };
        await awUpdate('groups', chatId, { pinned: awEncode(pinned) });
        showToast('Message pinned! 📌');
    } catch(e) { showToast('Could not pin: ' + e.message); }
}

// ── SPAM & MODERATION ──────────────────────────────────────
const SWEAR = /\b(fuck|shit|bitch|cunt|dick|piss|asshole|bastard|cock)\b/i;

async function checkSend(type, text) {
        // Corrected code:
    const snap = await getCachedUserDoc(me.uid);
    const dat  = snap || {}; // Access snap directly instead of calling .data()
    // Corrected code:
    const dbTO = dat.timeoutUntil ? new Date(dat.timeoutUntil) : null;
    if (dbTO && dbTO > new Date()) {
        const s = Math.ceil((dbTO - new Date()) / 1000);
        showToBanner(`🤐 Timed out for swearing — ${s}s remaining.`, dbTO);
        return false;
    }

    if (localTOUntil && localTOUntil > new Date()) {
        const s = Math.ceil((localTOUntil - new Date()) / 1000);
        showToBanner(`⚡ Slow down! ${s}s remaining.`, localTOUntil);
        return false;
    }

    const now = Date.now();
    spamTs = spamTs.filter(t => now - t < 60000);
    if (spamTs.length >= 25) {
        localTOUntil = new Date(now + 60000);
        spamTs = [];
        showToBanner('⚡ Sending too fast! Timed out for 1 minute.', localTOUntil);
        return false;
    }
    spamTs.push(now);

    if (type === 'text' && SWEAR.test(text)) {
        const until = new Date(Date.now() + 5 * 60000);
        invalidateUserCache(me.uid);
        await awUpdate('users', me.uid, {
            timeoutUntil:  until.toISOString(),
            timeoutReason: 'swearing',
        });
        showToBanner('🤐 Watch the language! Timed out for 5 minutes.', until);
        return false;
    }

    clearToBanner();
    return true;
}

function showToBanner(msg, until) {
    const b = document.getElementById('timeoutBanner');
    b.classList.remove('hidden');
    if (toInterval) clearInterval(toInterval);
    function tick() {
        const s = Math.ceil((until - new Date()) / 1000);
        if (s <= 0) { clearToBanner(); return; }
        // Corrected code:
        let disp = msg;
        if (disp.includes('5 minutes')) {
            disp = `🤐 Watch the language! Timed out — ${s}s remaining.`;
        } else {
            disp = disp.replace(/\d+s remaining/, s+'s remaining').replace(/\d+s left/, s+'s left');
        }
        document.getElementById('toMsg').textContent = disp;
    }
    tick();
    toInterval = setInterval(tick, 1000);
}

function clearToBanner() {
    document.getElementById('timeoutBanner').classList.add('hidden');
    if (toInterval) { clearInterval(toInterval); toInterval = null; }
}

// ── DOWNLOAD HISTORY ───────────────────────────────────────
async function downloadHistory() {
    if (!chatId) return;
    const docs  = await awList('messages', [
        Query.equal('chatId', chatId),
        Query.orderAsc('timestamp'),
        Query.limit(2000),
    ]);
    const title = document.getElementById('chatName').textContent;
    let out = `NorMSG — Chat History\nConversation: ${title}\nExported: ${new Date().toLocaleString()}\n${'─'.repeat(52)}\n\n`;
    docs.forEach(d => {
        const ts  = d.timestamp ? new Date(d.timestamp) : new Date();
        const dt  = ts.toLocaleDateString() + ' ' + fmtTime(ts);
        const who = d.senderUsername ? '@'+d.senderUsername : (d.senderName||'?');
        // Corrected code:
        if (d.type === 'image') out += `[${dt}] ${who}: [Image] ${d.imageUrl}\n`;
        else if (d.type === 'video') out += `[${dt}] ${who}: [Video] ${d.videoUrl}\n`;
        else if (d.type === 'sticker') out += `[${dt}] ${who}: [Sticker] ${d.imageUrl}\n`;
        else if (d.type === 'poll') out += `[${dt}] ${who}: [Poll] ${d.question}\n`;
        else out += `[${dt}] ${who}: ${d.text || ''}\n`;
    });
    const blob = new Blob([out], { type: 'text/plain' });
    const a    = ce('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `normsg_${title.replace(/[^a-z0-9]/gi,'_')}_${Date.now()}.txt`;
    a.click();
    showToast('History downloaded! 📥');
}

// ── HIDDEN DMs / MESSAGES (localStorage) ──────────────────
function getHiddenDMs()   { try { return new Set(JSON.parse(localStorage.getItem('normsg_hidden_dms')||'[]')); } catch { return new Set(); } }
function saveHiddenDMs(s) { localStorage.setItem('normsg_hidden_dms', JSON.stringify([...s])); }

function hideDM(convId) {
    if (!confirm('Hide this conversation on your side?')) return;
    const s = getHiddenDMs(); s.add(convId); saveHiddenDMs(s);
    if (chatId === convId) closeChat();
    renderFriends();
    showToast('Conversation hidden.');
}

function getHiddenMsgs()   { try { return new Set(JSON.parse(localStorage.getItem('normsg_hidden_msgs')||'[]')); } catch { return new Set(); } }
function saveHiddenMsgs(s) { localStorage.setItem('normsg_hidden_msgs', JSON.stringify([...s])); }

function hideForMe(msgId) {
    const s = getHiddenMsgs(); s.add(msgId); saveHiddenMsgs(s);
    showToast('Message hidden for you.');
    if (chatId) subMessages(chatId, chatType);
}

// ── @ MENTIONS ─────────────────────────────────────────────
let mentionSearch  = null;
let mentionStart   = -1;
let mentionIndex   = 0;
let mentionMembers = [];

function onMsgInputChange() {
    if (!chatId || !me) return;
    const inp = document.getElementById('msgInput');
    checkColonTrigger(inp);
    if (chatType !== 'group') return;
    const val    = inp.value;
    const pos    = inp.selectionStart;
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
    if (!mentionMembers.length && chatId) {
        try {
            const grp  = await awGet('groups', chatId);
            const uids = (grp.members || []).filter(u => u !== me.uid);
            const chunks = [];
            for (let i = 0; i < uids.length; i += 100) chunks.push(uids.slice(i, i + 100));
            mentionMembers = [];
            for (const chunk of chunks) {
                if (!chunk.length) continue;
                const docs = await awList('users', [Query.equal('$id', chunk), Query.limit(100)]);
                docs.forEach(d => mentionMembers.push({ uid: d.$id, ...awDecodeUser(d) }));
            }
        } catch(e) { console.warn('mentionMembers fetch failed', e); }
    }

    const filtered = [
        { uid: 'AI', username: 'AI', displayName: '✦ AI Assistant', photoURL: null, isAI: true },
        ...mentionMembers.filter(u =>
            (u.username||'').toLowerCase().startsWith(mentionSearch) ||
            (u.displayName||'').toLowerCase().startsWith(mentionSearch)
        )
    ].filter(u => u.isAI ? 'ai'.startsWith(mentionSearch) : true).slice(0, 7);

    const box = document.getElementById('mentionBox');
    if (!filtered.length) { box.style.display = 'none'; return; }

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
}

function hideMentionBox() {
    const box = document.getElementById('mentionBox');
    if (box) box.style.display = 'none';
    mentionSearch = null; mentionStart = -1;
}

function insertMention(username) {
    const inp = document.getElementById('msgInput');
    const val = inp.value;
    const pos = inp.selectionStart;
    inp.value = val.slice(0, mentionStart) + '@' + username + ' ' + val.slice(pos);
    const np  = mentionStart + username.length + 2;
    inp.setSelectionRange(np, np);
    hideMentionBox();
    inp.focus();
    autoGrow(inp);
}

function onMsgInputKeydown(e) {
    const box = document.getElementById('mentionBox');
    if (box && box.style.display !== 'none') {
        const items = box.querySelectorAll('.mention-item');
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            mentionIndex = (mentionIndex + 1) % items.length;
            items.forEach((it, i) => it.classList.toggle('active', i === mentionIndex));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            mentionIndex = (mentionIndex - 1 + items.length) % items.length;
            items.forEach((it, i) => it.classList.toggle('active', i === mentionIndex));
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            const active = box.querySelector('.mention-item.active');
            if (active) { e.preventDefault(); active.onmousedown(e); return; }
        } else if (e.key === 'Escape') {
            hideMentionBox();
        }
    }
    if (e.key === 'Enter' && !e.shiftKey && (!box || box.style.display !== 'block')) {
        e.preventDefault(); sendMsg();
    }
}

function updateFmtToolbar(inp) {
    const val = inp.value.slice(0, inp.selectionEnd);
    document.getElementById('fmtBold').classList.toggle('active', /\*\*[^*]*$/.test(val));
    document.getElementById('fmtItalic').classList.toggle('active', /_[^_]*$/.test(val));
    document.getElementById('fmtCode').classList.toggle('active', /`[^`]*$/.test(val));
}

// ── SEND FRIEND REQUEST (from People modal) ────────────────
async function sendFriendReqTo(username, btn) {
    if (!username) return;
    btn.disabled = true; btn.textContent = '…';
    try {
        const targetUid = await getCachedUid(username);
        if (!targetUid) { btn.textContent = '✗ Not found'; return; }
        const alreadyFriend = friends.some(f => f.uid === targetUid);
        if (alreadyFriend) { btn.textContent = '✓ Friends'; btn.disabled = true; return; }

        const dup = await awList('friendrequests', [
            Query.equal('fromUid', me.uid),
            Query.equal('toUid', targetUid),
            Query.equal('status', 'pending'),
            Query.limit(1),
        ]);
        if (dup.length) { btn.textContent = '✓ Sent'; return; }

        const updata = await getCachedProfile(targetUid) || {};
        await awAdd('friendrequests', {
            fromUid: me.uid, fromName: me.displayName||me.email,
            fromUsername: myUsername, fromPhoto: me.photoURL||null,
            toUid: targetUid, toName: updata.displayName||updata.email||'',
            toUsername: updata.username||'', toPhoto: updata.photoURL||null,
            status: 'pending', createdAt: awNow(),
        });
        btn.textContent = '✓ Sent';
        showToast('Request sent! 🎉');
    } catch(e) { btn.textContent = '✗ Error'; console.error(e); }
}
