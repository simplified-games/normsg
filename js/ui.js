// ── CLOSE CHAT helper ──────────────────────────────────────
function closeChat() {
chatId = null; chatType = null;
if (msgUnsub) { msgUnsub(); msgUnsub = null; }
document.getElementById('emptyState').style.display = '';
document.getElementById('emptyState').classList.remove('hidden');
const ac = document.getElementById('activeChat');
ac.classList.add('hidden');
ac.style.display = 'none';
}

// ── LEAVE CHAT ─────────────────────────────────────────────
async function leaveChat() {
if (chatType === 'dm') {
if (!confirm('Hide this conversation on your side?')) return;
hideDM(chatId);
} else if (chatType === 'group') {
if (!confirm('Leave this group? You will be removed from the member list.')) return;
try {
const gRef  = db.collection('groups').doc(chatId);
const gSnap = await gRef.get();
const members = (gSnap.data()?.members || []).filter(uid => uid !== me.uid);

if (members.length === 0) {
    // Last person — delete the whole group and messages
    const msgs  = await db.collection(`groups/${chatId}/messages`).get();
    const batch = db.batch();
    const storeDels = [];
    msgs.docs.forEach(doc => {
        batch.delete(doc.ref);
        const sp = doc.data().storagePath;
        if (sp) storeDels.push(storage.ref(sp).delete().catch(()=>{}));
    });
    batch.delete(gRef);
    await batch.commit();
    await Promise.all(storeDels);
    showToast('Group deleted (you were the last member).');
} else {
    await gRef.update({ members: firebase.firestore.FieldValue.arrayRemove(me.uid) });
    showToast('You left the group.');
}
closeChat();
} catch(e) {
showToast('Could not leave group: ' + e.message);
}
}
}


async function openProfileModal() {
// Pre-fill current avatar
const av = document.getElementById('profAvPreview');
if (me.photoURL) {
av.innerHTML = `<img src="${me.photoURL}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
} else {
av.innerHTML = initials(me.displayName||me.email);
}

// Show pfp usage count
const snap = await getCachedUserDoc(me.uid);
const dat  = snap.data() || {};
const pfpLog = (dat.pfpChanges || []).filter(ts => {
const d = ts.toDate ? ts.toDate() : new Date(ts);
return (Date.now() - d) < 7 * 86400000;
});
document.getElementById('pfpCountLabel').textContent = `${pfpLog.length} / 3 photo changes this week`;
document.getElementById('pfpMsg').className = 'm-msg';
document.getElementById('pfpMsg').textContent = '';

// Pre-fill current username and display name in tag fields
document.getElementById('newTagIn').value = myUsername || '';
document.getElementById('newDisplayNameIn').value = me.displayName || '';
mmsg('tagMsg','','');
mmsg('displayNameMsg','','');
mmsg('bioMsg','','');

// Pre-fill bio
const bioEl = document.getElementById('bioInput');
const bioVal = dat.bio || '';
bioEl.value = bioVal;
document.getElementById('bioCharCount').textContent = `${bioVal.length} / 160`;
bioEl.oninput = () => {
    document.getElementById('bioCharCount').textContent = `${bioEl.value.length} / 160`;
};

document.getElementById('profileModal').classList.remove('hidden');
}

async function uploadPfp(event) {
const file = event.target.files[0];
event.target.value = '';
if (!file) return;

// Check weekly limit
const snap   = await getCachedUserDoc(me.uid);
const dat    = snap.data() || {};
const pfpLog = (dat.pfpChanges || []).filter(ts => {
const d = ts.toDate ? ts.toDate() : new Date(ts);
return (Date.now() - d) < 7 * 86400000;
});
if (pfpLog.length >= 3) {
return mmsg('pfpMsg', '⚠ You\'ve used all 3 photo changes this week. Try again next week or reset to initials.', 'err');
}

if (file.size > 4 * 1024 * 1024) return mmsg('pfpMsg', 'Image must be under 4 MB.', 'err');
mmsg('pfpMsg', '⟳ Uploading…', 'inf');

try {
const { url } = await uploadToCloudinary(file);

// Update auth profile
await me.updateProfile({ photoURL: url });

// Update Firestore
invalidateUserCache(me.uid); await db.collection('users').doc(me.uid).update({
photoURL:   url,
pfpChanges: firebase.firestore.FieldValue.arrayUnion(TS.now())
});

// Refresh local state
const avMain = document.getElementById('myAv');
avMain.innerHTML = `<img src="${url}" alt="">`;
const avPrev = document.getElementById('profAvPreview');
avPrev.innerHTML = `<img src="${url}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;

const newCount = pfpLog.length + 1;
document.getElementById('pfpCountLabel').textContent = `${newCount} / 3 photo changes this week`;
mmsg('pfpMsg', '✓ Profile photo updated!', 'ok');
showToast('Profile photo updated! 📷');
} catch(e) {
mmsg('pfpMsg', 'Upload failed: ' + e.message, 'err');
}
}

async function resetPfp() {
// Reset is always free — unlimited
await me.updateProfile({ photoURL: null });
invalidateUserCache(me.uid); await db.collection('users').doc(me.uid).update({ photoURL: null });

const name   = me.displayName || me.email;
const avMain = document.getElementById('myAv');
avMain.innerHTML = initials(name);
const avPrev = document.getElementById('profAvPreview');
avPrev.innerHTML = initials(name);

mmsg('pfpMsg', '✓ Reset to initials (free, unlimited).', 'ok');
showToast('Reset to initials!');
}

// ── CHANGE TAG ─────────────────────────────────────────────
async function changeTag() {
const newTag = document.getElementById('newTagIn').value.trim().toLowerCase();
if (!newTag) return mmsg('tagMsg', 'Enter a new username.', 'err');
if (newTag.length < 3) return mmsg('tagMsg', 'Minimum 3 characters.', 'err');
if (!/^[a-z0-9_.]+$/.test(newTag)) return mmsg('tagMsg', 'Letters, numbers, _ and . only.', 'err');
if (newTag === myUsername) return mmsg('tagMsg', 'That\'s already your username!', 'err');

mmsg('tagMsg', 'Checking…', 'inf');
const ex = await db.collection('usernames').doc(newTag).get();
if (ex.exists) return mmsg('tagMsg', 'Username taken — try another!', 'err');

const batch = db.batch();
// Claim new
batch.set(db.collection('usernames').doc(newTag), { uid: me.uid });
// Free old
if (myUsername) batch.delete(db.collection('usernames').doc(myUsername));
// Update user doc
batch.update(db.collection('users').doc(me.uid), { username: newTag });
await batch.commit();

const oldTag = myUsername;
myUsername   = newTag;
document.getElementById('myHandle').textContent = '@' + newTag + ' ✎';
mmsg('tagMsg', `✓ Username changed from @${oldTag} to @${newTag}!`, 'ok');
showToast('Username updated! 🎉');
}

// ── CHANGE DISPLAY NAME (2x per week) ──────────────────────
async function changeDisplayName() {
const newName = document.getElementById('newDisplayNameIn').value.trim();
if (!newName) return mmsg('displayNameMsg', 'Enter a display name.', 'err');
if (newName.length < 2) return mmsg('displayNameMsg', 'Minimum 2 characters.', 'err');
if (newName === me.displayName) return mmsg('displayNameMsg', 'That\'s already your name!', 'err');

// Check 2x per week limit
const snap  = await getCachedUserDoc(me.uid);
const dat   = snap.data() || {};
const nameLog = (dat.nameChanges || []).filter(ts => {
const d = ts.toDate ? ts.toDate() : new Date(ts);
return (Date.now() - d) < 7 * 86400000;
});
if (nameLog.length >= 2) {
return mmsg('displayNameMsg', '⚠ You\'ve used both name changes this week. Try again next week.', 'err');
}

mmsg('displayNameMsg', 'Saving…', 'inf');
try {
await me.updateProfile({ displayName: newName });
invalidateUserCache(me.uid); await db.collection('users').doc(me.uid).update({
displayName: newName,
nameChanges: firebase.firestore.FieldValue.arrayUnion(TS.now())
});
document.getElementById('myName').textContent = newName;
mmsg('displayNameMsg', `✓ Name changed to "${newName}"! (${nameLog.length+1}/2 this week)`, 'ok');
showToast('Display name updated! ✓');
} catch(e) {
mmsg('displayNameMsg', 'Failed: ' + e.message, 'err');
}
}

// ── SAVE BIO ────────────────────────────────────────────────
async function saveBio() {
const bio = document.getElementById('bioInput').value.trim();
if (bio.length > 160) return mmsg('bioMsg', 'Bio must be 160 chars or less.', 'err');
mmsg('bioMsg', 'Saving…', 'inf');
try {
    invalidateUserCache(me.uid);
    await db.collection('users').doc(me.uid).update({ bio });
    mmsg('bioMsg', '✓ Bio saved!', 'ok');
    showToast('Bio updated!');
} catch(e) { mmsg('bioMsg', 'Failed: ' + e.message, 'err'); }
}



// ── DELETE GROUP (15s countdown) ──────────────────────────
let delGroupTarget = null;   // { id, name }
let delGroupTimer  = null;

function startDeleteGroup(groupId, groupName) {
delGroupTarget = { id: groupId, name: groupName };
mmsg('delGrpMsg','','');
const btn = document.getElementById('confirmDelBtn');
btn.style.opacity = '0.4';
btn.style.pointerEvents = 'none';
document.getElementById('delGroupModal').classList.remove('hidden');

let secsLeft = 15; // 15 seconds
function tick() {
if (secsLeft <= 0) {
clearInterval(delGroupTimer);
document.getElementById('delCountdown').textContent = '0';
document.getElementById('delCountSub').textContent  = 'You can now confirm the deletion.';
btn.style.opacity = '1';
btn.style.pointerEvents = 'auto';
return;
}
document.getElementById('delCountdown').textContent = secsLeft;
document.getElementById('delCountSub').textContent  = 'Please wait before you can confirm…';
secsLeft--;
}
tick();
delGroupTimer = setInterval(tick, 1000);
}

function cancelDeleteGroup() {
if (delGroupTimer) { clearInterval(delGroupTimer); delGroupTimer = null; }
delGroupTarget = null;
closeModal('delGroupModal');
}

async function confirmDeleteGroup() {
if (!delGroupTarget) return;
mmsg('delGrpMsg', '⟳ Deleting group…', 'inf');

try {
const gid = delGroupTarget.id;

// Delete all messages in sub-collection
const msgs = await db.collection(`groups/${gid}/messages`).get();
const batch = db.batch();
const storeDels = [];
msgs.docs.forEach(doc => {
batch.delete(doc.ref);
const sp = doc.data().storagePath;
if (sp) storeDels.push(storage.ref(sp).delete().catch(()=>{}));
});
await batch.commit();
await Promise.all(storeDels);

// Delete group doc
await db.collection('groups').doc(gid).delete();

if (delGroupTimer) { clearInterval(delGroupTimer); delGroupTimer = null; }
closeModal('delGroupModal');
if (chatId === gid) closeChat();
showToast('Group deleted.');
delGroupTarget = null;
} catch(e) {
mmsg('delGrpMsg', 'Delete failed: ' + e.message, 'err');
}
}

// ── NICKNAMES (localStorage) ───────────────────────────────
function getNicknames()     { try { return JSON.parse(localStorage.getItem('normsg_nicks')||'{}'); } catch { return {}; } }
function saveNicknames(obj) { localStorage.setItem('normsg_nicks', JSON.stringify(obj)); }

let nickTargetUid = null, nickTargetName = null;

function openNicknameModal(uid, displayName) {
nickTargetUid  = uid;
nickTargetName = displayName;
const nicks = getNicknames();
document.getElementById('nickInput').value = nicks[uid] || '';
document.getElementById('nickModalSub').textContent = `Rename "${displayName}" — only you will see this.`;
mmsg('nickMsg','','');
document.getElementById('nicknameModal').classList.remove('hidden');
setTimeout(() => document.getElementById('nickInput').focus(), 80);
}

function saveNickname() {
const val = document.getElementById('nickInput').value.trim();
if (!nickTargetUid) return;
const nicks = getNicknames();
if (val) nicks[nickTargetUid] = val; else delete nicks[nickTargetUid];
saveNicknames(nicks);
closeModal('nicknameModal');
renderFriends();
showToast(val ? `Renamed to "${val}" ✓` : 'Nickname cleared.');
}

function clearNickname() {
if (!nickTargetUid) return;
const nicks = getNicknames();
delete nicks[nickTargetUid];
saveNicknames(nicks);
closeModal('nicknameModal');
renderFriends();
showToast('Nickname cleared.');
}

// ── FRIEND SUGGESTIONS ─────────────────────────────────────
let suggestTimer = null;

async function onAddInput() {
const val = document.getElementById('addIn').value.trim().toLowerCase().replace('@','');
const box = document.getElementById('suggestBox');
if (!val || val.length < 2) { box.style.display = 'none'; return; }
clearTimeout(suggestTimer);
suggestTimer = setTimeout(async () => {
try {
const snap = await db.collection('users')
    .where('username','>=', val)
    .where('username','<',  val + '\uf8ff')
    .limit(6).get();
const results = snap.docs.map(d => ({ uid: d.id, ...d.data() }))
    .filter(u => u.uid !== me.uid && u.username);
if (!results.length) { box.style.display = 'none'; return; }
box.innerHTML = '';
results.forEach(u => {
    const it = ce('div');
    it.className = 'suggest-item';
    it.innerHTML = `${mkAv(u.displayName||'?', u.photoURL||null, 28)}<div><div class="suggest-name">${esc(u.displayName||u.username)}</div><div class="suggest-handle">@${esc(u.username)}</div></div>`;
    it.onmousedown = (e) => { e.preventDefault(); document.getElementById('addIn').value = u.username; box.style.display = 'none'; };
    box.appendChild(it);
});
box.style.display = 'block';
} catch(e) { box.style.display = 'none'; }
}, 280);
}

function hideSuggestions() { setTimeout(() => { document.getElementById('suggestBox').style.display = 'none'; }, 150); }
document.addEventListener('click', (e) => { if (!e.target.closest('#addIn') && !e.target.closest('#suggestBox')) hideSuggestions(); });

// ── LIGHTBOX WITH ZOOM + PAN ───────────────────────────────
let lbScale = 1, lbX = 0, lbY = 0, lbDragging = false, lbStartX = 0, lbStartY = 0;

function openLB(src) {
lbScale = 1; lbX = 0; lbY = 0;
document.getElementById('lbImg').src = src;
document.getElementById('lbDownloadBtn').href = src;
const lb   = document.getElementById('lightbox');
const wrap = document.getElementById('lbImgWrap');
lb.classList.remove('hidden');
lbApplyTransform();

lb._wh = (e) => { e.preventDefault(); lbZoom(e.deltaY < 0 ? 0.22 : -0.22); };
lb.addEventListener('wheel', lb._wh, { passive: false });

wrap._md = (e) => { lbDragging = true; lbStartX = e.clientX - lbX; lbStartY = e.clientY - lbY; wrap.classList.add('dragging'); e.preventDefault(); };
wrap._mm = (e) => { if (!lbDragging) return; lbX = e.clientX - lbStartX; lbY = e.clientY - lbStartY; lbApplyTransform(); };
wrap._mu = () => { lbDragging = false; wrap.classList.remove('dragging'); };
wrap.addEventListener('mousedown', wrap._md);
document.addEventListener('mousemove', wrap._mm);
document.addEventListener('mouseup',   wrap._mu);

lb._bg = (e) => { if (e.target === lb) closeLightbox(); };
lb.addEventListener('click', lb._bg);
}

function closeLightbox() {
const lb   = document.getElementById('lightbox');
const wrap = document.getElementById('lbImgWrap');
lb.classList.add('hidden');
document.getElementById('lbImg').src = '';
if (lb._wh)   lb.removeEventListener('wheel', lb._wh);
if (wrap._md) { wrap.removeEventListener('mousedown', wrap._md); document.removeEventListener('mousemove', wrap._mm); document.removeEventListener('mouseup', wrap._mu); }
if (lb._bg)   lb.removeEventListener('click', lb._bg);
}

function lbZoom(d) { lbScale = Math.min(5, Math.max(0.25, lbScale + d)); lbApplyTransform(); }
function lbReset() { lbScale = 1; lbX = 0; lbY = 0; lbApplyTransform(); }
function lbApplyTransform() { document.getElementById('lbImgWrap').style.transform = `translate(${lbX}px,${lbY}px) scale(${lbScale})`; }

// ── EMOJI REACTIONS ────────────────────────────────────────
const EMOJIS = ['👍','❤️','😂','😮','😢','🔥','🎉','👀','💯','✅','😍','🤔','😎','🙏','💀','😭','🥲','💪','😡','🫡'];
let activePicker = null;

function openEmojiPicker(event, msgId, msgPath) {
event.stopPropagation();
if (activePicker) { activePicker.remove(); activePicker = null; }
const btn    = event.currentTarget;
const bwrap  = btn.closest('.bwrap');
const isSent = btn.closest('.msg-row')?.classList.contains('sent');
const picker = ce('div');
picker.className = 'emoji-picker';
EMOJIS.forEach(em => {
const sp = ce('span'); sp.className = 'ep-emoji'; sp.textContent = em;
sp.onclick = (e) => { e.stopPropagation(); toggleReaction(msgId, msgPath, em); picker.remove(); activePicker = null; };
picker.appendChild(sp);
});
picker.style.cssText = `position:absolute;bottom:calc(100% + 6px);${isSent?'right':'left'}:0;z-index:200;`;
bwrap.style.position = 'relative';
bwrap.appendChild(picker);
activePicker = picker;
setTimeout(() => {
document.addEventListener('click', function cls() { picker.remove(); activePicker = null; document.removeEventListener('click', cls); }, { once: true });
}, 0);
}

async function toggleReaction(msgId, msgPath, emoji) {
const ref  = db.collection(msgPath).doc(msgId);
const snap = await ref.get();
const cur  = (snap.data()?.reactions || {})[me.uid];
if (cur === emoji) await ref.update({ [`reactions.${me.uid}`]: firebase.firestore.FieldValue.delete() });
else               await ref.update({ [`reactions.${me.uid}`]: emoji });
}

// ── PASTE IMAGE ────────────────────────────────────────────
let pastedFile = null;

function handlePaste(event) {
const items = event.clipboardData?.items;
if (!items) return;
for (const item of items) {
if (item.type.startsWith('image/')) {
event.preventDefault();
const file = item.getAsFile();
if (!file) return;
// In AI chats, paste goes straight to AI image analysis
if (chatType === 'ai') {
handleAIImageFile(file);
return;
}
pastedFile = file;
document.getElementById('pasteThumb').src = URL.createObjectURL(file);
document.getElementById('pastePreview').classList.add('on');
return;
}
}
}

async function sendPastedImg() {
if (!pastedFile || !chatId) return;
const f = pastedFile;
clearPaste();
if (!await checkSend('image','')) return;
document.getElementById('upInd').classList.add('on');
try {
const compressed = await compressImage(f);
const { url, publicId } = await uploadToCloudinary(compressed);
const rt = replyTo ? { ...replyTo } : null;
clearReply();
await pushMsg({ type:'image', imageUrl: url, storagePath: publicId, text:'', ...(rt ? { replyTo: rt } : {}) });
} catch(e) {
if (e?.name === 'AbortError') showToast('Upload cancelled.');
else { showToast('Upload failed: ' + e.message); console.error('paste upload:', e); }
} finally { document.getElementById('upInd').classList.remove('on'); }
}

function clearPaste() {
pastedFile = null;
document.getElementById('pastePreview').classList.remove('on');
document.getElementById('pasteThumb').src = '';
}

// ── MODAL ──────────────────────────────────────────────────
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function mmsg(id, txt, type) {
const el = document.getElementById(id);
el.textContent = txt;
el.className = type ? `m-msg ${type}` : 'm-msg';
}

// ── HELPERS ────────────────────────────────────────────────
function dmId(a,b) { return [a,b].sort().join('_'); }

function initials(n) {
if (!n) return '?';
return n.trim().split(/\s+/).map(w=>w[0]).join('').toUpperCase().slice(0,2);
}

function mkAv(name, photo, sz=34) {
const s = `width:${sz}px;height:${sz}px;font-size:${Math.round(sz*.37)}px;flex-shrink:0;`;
return photo
? `<div class="av" style="${s}"><img src="${photo}" alt=""></div>`
: `<div class="av" style="${s}">${initials(name)}</div>`;
}

function esc(s) {
return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// Escape a string for safe use inside new RegExp(...)
function reEsc(s) {
return String(s||'').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fmtTime(d) { return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); }

function dateLabel(d) {
const diff = Math.floor((Date.now()-d)/86400000);
if (diff===0) return 'Today';
if (diff===1) return 'Yesterday';
return d.toLocaleDateString([],{weekday:'long',month:'short',day:'numeric'});
}

function expLabel(created, hours) {
const exp     = new Date(created.getTime() + hours*3600000);
const minsLeft = Math.round((exp - new Date()) / 60000);
if (minsLeft <= 0) return null;
if (minsLeft < 60) return `${minsLeft}m left`;
const h = Math.round(minsLeft/60);
if (h < 24) return `${h}h left`;
return `${Math.round(h/24)}d left`;
}

function dedup(arr) {
const seen = new Set();
return arr.filter(f => { if (seen.has(f.uid)) return false; seen.add(f.uid); return true; });
}

function ce(tag) { return document.createElement(tag); }

function autoGrow(el) {
el.style.height = '';
el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

