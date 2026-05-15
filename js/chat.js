// ── OPEN CHAT ──────────────────────────────────────────────
function openDM(friend) {chatType = 'dm';
chatId   = dmId(me.uid, friend.uid);
clearReply();

const av = document.getElementById('chatAv');
av.innerHTML = friend.photoURL ? `<img src="${friend.photoURL}" alt="">` : initials(friend.displayName||'?');
av.classList.remove('av-grp');

const nicks = getNicknames();
const nick  = nicks[friend.uid];
document.getElementById('chatName').textContent = nick || friend.displayName;

// Show presence in subtitle
const pres = friendPresence[friend.uid];
updateChatSubStatus(pres?.online === true, pres?.lastSeen || null);

// Hide manage group button for DMs
document.getElementById('renameChatBtn').classList.add('hidden');
document.getElementById('leaveBtn').title = 'Hide conversation';
document.getElementById('pollBtn').style.display = 'none'; // polls only in groups
document.getElementById('aiImgBtn').style.display = 'none'; // image analysis only in AI chats
document.getElementById('regularImgBtn').style.display = 'inline-flex';
document.getElementById('stickerBtn').style.display = 'inline-flex';
document.getElementById('scheduleBtn').style.display = 'inline-flex';
document.getElementById('normAIBtn').style.display = 'inline-flex';
document.getElementById('aiModelDropdownWrap').classList.remove('visible');
markRead(chatId);
activateChat();
renderFriends();
document.getElementById('sidebar').classList.remove('open');

subMessages(`conversations/${chatId}/messages`);
runCleanup(`conversations/${chatId}/messages`);
}

function openGroup(group) {chatType = 'group';
chatId   = group.id;
clearReply();

const av = document.getElementById('chatAv');
av.innerHTML = esc((group.name[0]||'G').toUpperCase());
av.classList.add('av-grp');
document.getElementById('chatName').textContent = group.name;
document.getElementById('chatSub').textContent  = (group.members?.length||0) + ' members';

// Show manage button to all group members
document.getElementById('renameChatBtn').classList.remove('hidden');
document.getElementById('leaveBtn').title = 'Leave group';
document.getElementById('pollBtn').style.display = 'inline-flex'; // polls available in groups
document.getElementById('aiImgBtn').style.display = 'none'; // image analysis only in AI chats
document.getElementById('regularImgBtn').style.display = 'inline-flex';
document.getElementById('stickerBtn').style.display = 'inline-flex';
document.getElementById('scheduleBtn').style.display = 'inline-flex';
document.getElementById('normAIBtn').style.display = 'inline-flex';
document.getElementById('aiModelDropdownWrap').classList.remove('visible');
markRead(chatId);
activateChat();
renderGroups();
document.getElementById('sidebar').classList.remove('open');

subMessages(`groups/${chatId}/messages`);
runCleanup(`groups/${chatId}/messages`);
mentionMembers = []; // reset @ cache for new group
}

function activateChat() {
document.getElementById('emptyState').classList.add('hidden');
const ac = document.getElementById('activeChat');
ac.classList.remove('hidden');
ac.style.display = 'flex';
document.getElementById('msgInput').focus();
clearToBanner();
// Pinned banner
subscribePinned();
}

// ── MESSAGES ───────────────────────────────────────────────
const MSG_PAGE = 40;  // reads per page — change to load more

function subMessages(path) {
if (msgUnsub) { msgUnsub(); msgUnsub = null; }
document.getElementById('messagesArea').innerHTML = '';

msgUnsub = db.collection(path)
.orderBy('timestamp','asc')
.limitToLast(MSG_PAGE)
.onSnapshot(snap => {
renderMsgs(snap.docs.map(d => ({ id: d.id, _path: path, ...d.data() })));
if (chatId) markRead(chatId);
});
}

function renderMsgs(msgs) {
const area    = document.getElementById('messagesArea');
area.innerHTML = '';
const hiddenMsgs = getHiddenMsgs();
let lastDate  = null;

msgs.filter(m => !hiddenMsgs.has(m.id)).forEach((msg, i, arr) => {
const ts     = msg.timestamp?.toDate?.() || new Date();
const ds     = dateLabel(ts);
const mine   = msg.senderUid === me.uid;
const nxt    = arr[i+1];
const same   = nxt && nxt.senderUid === msg.senderUid;

if (ds !== lastDate) {
lastDate = ds;
const div = ce('div');
div.className = 'date-div';
div.innerHTML = `<span>${ds}</span>`;
area.appendChild(div);
}

const row = ce('div');

const sp   = (msg.storagePath||'').replace(/'/g,"\\'");
const pid  = (msg._path||'').replace(/'/g,"\\'");
const mid  = msg.id;

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
    <img src="${esc(msg.imageUrl||'')}" loading="lazy"
         onclick="openLB('${esc(msg.imageUrl||'')}')">
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
    <img class="msg-img" src="${esc(msg.imageUrl)}" loading="lazy"
        onclick="openLB('${esc(msg.imageUrl)}')">
</div>`;
} else if (msg.type === 'video') {
bubble = `<div class="bubble ${mine?'sent':'recv'} img-bub">
    ${msg.replyTo ? renderQuote(msg.replyTo, mine) : ''}
    <video class="msg-img" src="${esc(msg.videoUrl)}" controls preload="metadata"
        style="max-width:280px;max-height:220px;border-radius:10px;display:block;"></video>
</div>`;
} else if (msg.type === 'poll') {
const votes   = msg.votes || {};
const opts    = msg.options || [];
const total   = Object.keys(votes).length;
const myVote  = votes[me.uid] !== undefined ? votes[me.uid] : -1;
const optHTML = opts.map((opt, i) => {
    const count = Object.values(votes).filter(v => v === i).length;
    const pct   = total ? Math.round(count / total * 100) : 0;
    const isMe  = myVote === i;
    const pid2  = (msg._path||'').replace(/'/g,"\\'");
    return `<div class="poll-opt${isMe?' voted':''}" onclick="votePoll('${msg.id}','${pid2}',${i})">
        <div class="poll-opt-bar" style="width:${pct}%"></div>
        <span class="poll-opt-label">${esc(opt)}</span>
        <span class="poll-opt-pct">${pct}%</span>
    </div>`;
}).join('');
bubble = `<div class="poll-bubble">
    <div class="poll-q">${esc(msg.question||'Poll')}</div>
    ${optHTML}
    <div class="poll-footer">${total} vote${total===1?'':'s'}${myVote>=0?' · You voted':''}${mine?' · <span style="cursor:pointer;color:var(--danger);" onclick="delMsg(\''+mid+'\',\''+( (msg._path||'').replace(/'/g,"\\'") )+'\',\'\',false)">Delete</span>':''}</div>
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
// Check if current user is group admin
const isGroupAdmin = chatType === 'group' && (() => {
const grp = myGroups.find(g => g.id === chatId);
return grp && ((grp.admins||[]).includes(me.uid) || grp.createdBy === me.uid);
})();

const isAIMsg   = msg.type === 'ai' || msg.type === 'ai-thinking';
const isPollMsg = msg.type === 'poll';

const replySnip = msg.type === 'image' ? '[Image]' : msg.type === 'video' ? '[Video]' : msg.type === 'poll' ? '[Poll]' : msg.type === 'sticker' ? '[Sticker]' : (msg.text||'').slice(0,60);

const actionBtn = (msg.type === 'deleted' || isAIMsg || isPollMsg) ? '' : (mine
? `<button class="msg-del" onclick="delMsg('${mid}','${pid}','${sp}',false)">Delete</button>
   ${chatType==='group' ? `<button class="msg-del" style="color:var(--a2);" onclick="pinMessage('${mid}','${pid}','${replySnip.replace(/'/g,"\\'")}')">📌</button>` : ''}`
: isGroupAdmin
    ? `<button class="msg-del" onclick="delMsg('${mid}','${pid}','${sp}',true)" style="color:var(--warn);">🛡 Del</button>
       <button class="msg-del" style="color:var(--a2);" onclick="pinMessage('${mid}','${pid}','${replySnip.replace(/'/g,"\\'")}')">📌</button>`
    : `<button class="msg-del" onclick="hideForMe('${mid}')" style="color:var(--muted);">Hide</button>`);
const replyBtn  = (isAIMsg || isPollMsg) ? '' : `<button class="msg-reply-btn" onclick="setReply('${mid}','${esc((msg.senderUsername||msg.senderName||'?')).replace(/'/g,"\\'")}','${replySnip.replace(/'/g,"\\'").replace(/\n/g,' ')}')">↩</button>`;
const emojiTrigger = (isAIMsg || isPollMsg) ? '' : `<button class="emoji-trigger" onclick="openEmojiPicker(event,'${mid}','${pid}')">😊</button>`;

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
    return `<span class="reaction-chip${iMine?' mine':''}" onclick="toggleReaction('${mid}','${pid}','${emoji}')">${emoji} <span class="reaction-count">${uids.length}</span></span>`;
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
// Play receive sound if last message is not from me
if (msgs.length > 0) {
const last = msgs[msgs.length - 1];
if (last && last.senderUid && last.senderUid !== me?.uid) playMsgSound('receive');
}
}

// ── REPLY STATE ────────────────────────────────────────────
let replyTo = null; // { msgId, who, snippet }

function setReply(msgId, who, snippet) {
replyTo = { msgId, who, snippet };
document.getElementById('replyWho').textContent = '↩ ' + who;
document.getElementById('replySnippet').textContent = snippet;
document.getElementById('replyBar').classList.add('on');
document.getElementById('msgInput').focus();
}

function clearReply() {
replyTo = null;
document.getElementById('replyBar').classList.remove('on');
}

function renderQuote(rt, isSent) {
return `<div class="reply-quote" onclick="">
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
await pushMsg({ type:'text', text, ...(rt ? { replyTo: rt } : {}) });

// Trigger AI if @AI is mentioned in a group chat
if (chatType === 'group' && /@AI\b/i.test(text)) {
triggerAIResponse(text);
}
}

// ── IMAGE/VIDEO UPLOAD — CLOUDINARY ───────────────────────
const CLOUDINARY_CLOUD  = 'dc6349v8c';
const CLOUDINARY_PRESET = 'NorMSG';
let uploadAbortController = null;

// Compress an image file to a JPEG blob before uploading
// Skips compression for GIFs (would break animation) and small files
async function compressImage(file, maxSizeMB = 1.5) {
if (file.type === 'image/gif' || file.size < 300 * 1024) return file; // skip small/gif
return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        // Scale down if > 1920px on longest side
        const maxDim = 1920;
        if (width > maxDim || height > maxDim) {
            const scale = maxDim / Math.max(width, height);
            width  = Math.round(width  * scale);
            height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width  = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        // Try quality 0.82 first, drop to 0.65 if still too big
        canvas.toBlob(blob => {
            if (blob && blob.size > maxSizeMB * 1024 * 1024) {
                canvas.toBlob(b2 => resolve(b2 || blob), 'image/jpeg', 0.65);
            } else {
                resolve(blob || file);
            }
        }, 'image/jpeg', 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
});
}

// Upload a File or Blob to Cloudinary
async function uploadToCloudinary(fileOrBlob, resourceType = 'image') {
uploadAbortController = new AbortController();
const fd = new FormData();
fd.append('file',          fileOrBlob);
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

// For paste uploads where we only have a data URL, convert to blob first
function dataUrlToBlob(dataUrl) {
const [header, b64] = dataUrl.split(',');
const mime = header.match(/:(.*?);/)[1];
const bin  = atob(b64);
const arr  = new Uint8Array(bin.length);
for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
return new Blob([arr], { type: mime });
}

// Legacy alias
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
if (file.size > maxMB*1024*1024) return showToast(`File too large — max ${maxMB} MB${userPlan==='free' ? ' (Pro gets 100 MB)' : ''}.`);
if (!await checkSend('image','')) return;

document.getElementById('upInd').classList.add('on');
document.querySelector('#upInd span:last-child').textContent = isVideo ? 'Uploading video…' : 'Uploading image…';
try {
  if (isVideo) {
    const { url, publicId } = await uploadToCloudinary(file, 'video');
    const rt = replyTo ? { ...replyTo } : null;
    clearReply();
    await pushMsg({ type:'video', videoUrl: url, storagePath: publicId, text:'', ...(rt ? { replyTo: rt } : {}) });
  } else {
    const compressed = await compressImage(file);
    const { url, publicId } = await uploadToCloudinary(compressed);
    const rt = replyTo ? { ...replyTo } : null;
    clearReply();
    await pushMsg({ type:'image', imageUrl: url, storagePath: publicId, text:'', ...(rt ? { replyTo: rt } : {}) });
  }
} catch(e) {
if (e?.name === 'AbortError') showToast('Upload cancelled.');
else { showToast('Upload failed: ' + e.message); console.error('handleImg:', e); }
} finally {
document.getElementById('upInd').classList.remove('on');
document.querySelector('#upInd span:last-child').textContent = 'Uploading image…';
}
}

async function pushMsg(extra) {
const msgPath    = chatType==='dm' ? `conversations/${chatId}/messages` : `groups/${chatId}/messages`;
const parentPath = chatType==='dm' ? `conversations/${chatId}`          : `groups/${chatId}`;

// Use cached Super/Ultra status — Pro/Super/Ultra users all get the enhanced treatment
const isSuper = userPlan === 'pro' || userPlan === 'ultra' || superCache[me.uid] === true || ultraCache[me.uid] === true;

const summary = {
lastAt:             SV(),
lastSenderUid:      me.uid,
lastSenderUsername: myUsername || me.displayName || '',
lastText:           extra.type === 'image' ? '' : (extra.text || ''),
lastType:           extra.type || 'text'
};

await db.doc(parentPath).set(summary, { merge: true });
await db.collection(msgPath).add({
senderUid:      me.uid,
senderName:     me.displayName || me.email,
senderUsername: myUsername,
senderPhoto:    me.photoURL || null,
senderSuper:    isSuper,
timestamp:      SV(),
...extra
});

// Fire-and-forget — never block message send on this
incrementWeeklyCount();
playMsgSound('send');
}

// ── DELETE ─────────────────────────────────────────────────
async function delMsg(msgId, msgPath, _storagePath, isAdminDel = false) {
if (!confirm(isAdminDel ? 'Delete this message as admin?' : 'Delete this message?')) return;
try {
if (isAdminDel) {
// Replace with deleted placeholder instead of removing entirely
await db.collection(msgPath).doc(msgId).update({
    text:        '',
    type:        'deleted',
    deletedBy:   me.uid,
    deletedByUsername: myUsername || me.displayName,
    deletedAt:   SV()
});
} else {
await db.collection(msgPath).doc(msgId).delete();
}
} catch(e) {
showToast('Could not delete message.');
}
}

// ── CLEANUP (auto-delete expired) ──────────────────────────
// NOTE: Firestore needs a single-field index on `deleteAt` for this query.
// The first time it runs, your browser console will show a link to create it.
async function runCleanup(msgPath) {
try {
const now  = TS.now();
const snap = await db.collection(msgPath).where('deleteAt','<',now).get();
if (snap.empty) return;
const batch = db.batch();
const dels  = [];
snap.docs.forEach(doc => {
batch.delete(doc.ref);
const sp = doc.data().storagePath;
if (sp) dels.push(storage.ref(sp).delete().catch(()=>{}));
});
await batch.commit();
await Promise.all(dels);
} catch(e) {
// Usually just means the index hasn't been created yet
console.warn('Cleanup skipped (may need Firestore index on deleteAt):', e.message);
}
}

// ── SPAM & MODERATION ──────────────────────────────────────
const SWEAR = /\b(fuck|shit|bitch|cunt|dick|piss|asshole|bastard|cock)\b/i;

async function checkSend(type, text) {
// 1. Firestore timeout (swear)
const snap = await getCachedUserDoc(me.uid);
const dat  = snap.data() || {};
const dbTO = dat.timeoutUntil?.toDate?.();
if (dbTO && dbTO > new Date()) {
const s = Math.ceil((dbTO - new Date()) / 1000);
showToBanner(`🤐 Timed out for swearing — ${s}s remaining.`, dbTO);
return false;
}

// 2. Local spam timeout
if (localTOUntil && localTOUntil > new Date()) {
const s = Math.ceil((localTOUntil - new Date()) / 1000);
showToBanner(`⚡ Slow down! ${s}s remaining.`, localTOUntil);
return false;
}

// 3. Spam rate (>25 per 60s)
const now = Date.now();
spamTs = spamTs.filter(t => now-t < 60000);
if (spamTs.length >= 25) {
localTOUntil = new Date(now + 60000);
spamTs = [];
showToBanner('⚡ Sending too fast! Timed out for 1 minute.', localTOUntil);
return false;
}
spamTs.push(now);

// 4. Swear filter
if (type==='text' && SWEAR.test(text)) {
const until = new Date(Date.now() + 5*60000);
invalidateUserCache(me.uid); await db.collection('users').doc(me.uid).update({
timeoutUntil:  TS.fromDate(until),
timeoutReason: 'swearing'
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
const disp = msg.replace(/\d+s remaining/, s+'s remaining').replace(/\d+s left/, s+'s left');
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
const msgPath = chatType==='dm' ? `conversations/${chatId}/messages` : `groups/${chatId}/messages`;
const snap    = await db.collection(msgPath).orderBy('timestamp','asc').get();
const title   = document.getElementById('chatName').textContent;

let out = `NorMSG — Chat History\nConversation: ${title}\nExported: ${new Date().toLocaleString()}\n${'─'.repeat(52)}\n\n`;
snap.docs.forEach(doc => {
const d  = doc.data();
const ts = d.timestamp?.toDate?.() || new Date();
const dt = ts.toLocaleDateString() + ' ' + fmtTime(ts);
const who = d.senderUsername ? '@'+d.senderUsername : (d.senderName||'?');
if (d.type==='image') out += `[${dt}] ${who}: [Image] ${d.imageUrl}\n`;
else                  out += `[${dt}] ${who}: ${d.text}\n`;
});

const blob = new Blob([out], {type:'text/plain'});
const a    = ce('a');
a.href     = URL.createObjectURL(blob);
a.download = `normsg_${title.replace(/[^a-z0-9]/gi,'_')}_${Date.now()}.txt`;
a.click();
showToast('History downloaded! 📥');
}

// ── HIDDEN DMs (localStorage) ──────────────────────────────
function getHiddenDMs()   { try { return new Set(JSON.parse(localStorage.getItem('normsg_hidden_dms')||'[]')); } catch { return new Set(); } }
function saveHiddenDMs(s) { localStorage.setItem('normsg_hidden_dms', JSON.stringify([...s])); }

function hideDM(convId) {
if (!confirm('Hide this conversation on your side? (You can re-add this friend to restore it)')) return;
const s = getHiddenDMs();
s.add(convId);
saveHiddenDMs(s);
if (chatId === convId) closeChat();
renderFriends();
showToast('Conversation hidden.');
}

// ── HIDDEN MESSAGES (localStorage) ────────────────────────
function getHiddenMsgs()   { try { return new Set(JSON.parse(localStorage.getItem('normsg_hidden_msgs')||'[]')); } catch { return new Set(); } }
function saveHiddenMsgs(s) { localStorage.setItem('normsg_hidden_msgs', JSON.stringify([...s])); }

function hideForMe(msgId) {
const s = getHiddenMsgs();
s.add(msgId);
saveHiddenMsgs(s);
// Re-render without re-fetching
document.querySelectorAll('.msg-row').forEach(row => {
// Find and remove the row containing this message
});
// Easiest: just trigger a full re-render via the existing snapshot
// The snapshot listener will re-fire if we force it, but simpler:
// Just remove the DOM element whose delete/hide btn had this id
showToast('Message hidden for you.');
// Force re-render by re-subscribing
if (chatId) {
const path = chatType==='dm' ? `conversations/${chatId}/messages` : `groups/${chatId}/messages`;
subMessages(path);
}
}

