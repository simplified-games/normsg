// ── NOTIFICATION SETTINGS ──────────────────────────────────
function getNotifSettings() {
try {
const stored = JSON.parse(localStorage.getItem('normsg_notif') || 'null');
return {
push:      false,
inApp:     true,
sound:     true,
tabBadge:  true,
groupAll:  true,   // notify for ALL group messages by default
mentions:  true,   // always notify for @mentions by default
...stored
};
} catch { return { push: false, inApp: true, sound: true, tabBadge: true, groupAll: true, mentions: true }; }
}

function saveNotifSettings(s) {
localStorage.setItem('normsg_notif', JSON.stringify(s));
}

function openSettingsModal() {
const s = getNotifSettings();
document.getElementById('settingPush').checked      = s.push;
document.getElementById('settingInApp').checked     = s.inApp;
document.getElementById('settingSound').checked     = s.sound;
document.getElementById('settingTabBadge').checked  = s.tabBadge;
document.getElementById('settingGroupAll').checked  = s.groupAll;
document.getElementById('settingMentions').checked  = s.mentions;
mmsg('settingsMsg','','');
document.getElementById('settingsModal').classList.remove('hidden');
}

async function onSettingChange() {
const pushOn = document.getElementById('settingPush').checked;

// If push just turned on, request browser permission
if (pushOn) {
if (Notification.permission === 'denied') {
document.getElementById('settingPush').checked = false;
mmsg('settingsMsg', '⚠ Notifications are blocked in your browser. Go to browser Settings → Site Settings → Notifications and allow NorMSG.', 'err');
return;
}
if (Notification.permission !== 'granted') {
const perm = await Notification.requestPermission();
if (perm !== 'granted') {
    document.getElementById('settingPush').checked = false;
    mmsg('settingsMsg', '⚠ Permission denied. You can change this in your browser\'s site settings.', 'err');
    return;
}
}
mmsg('settingsMsg', '✓ Push notifications enabled!', 'ok');
} else {
mmsg('settingsMsg','','');
}

saveNotifSettings({
push:     document.getElementById('settingPush').checked,
inApp:    document.getElementById('settingInApp').checked,
sound:    document.getElementById('settingSound').checked,
tabBadge: document.getElementById('settingTabBadge').checked,
groupAll: document.getElementById('settingGroupAll').checked,
mentions: document.getElementById('settingMentions').checked
});
}

// ── NOTIFICATION LOGIC ─────────────────────────────────────
let unreadCount   = 0;
const NOTIF_ICON  = 'faviconnormsg.ico';

// Lazily create the ping sound via Web Audio API (no file needed)
let audioCtx = null;

// Initialise AudioContext on first user interaction so sound is never blocked
function ensureAudio() {
if (!audioCtx) {
try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
}
if (audioCtx?.state === 'suspended') audioCtx.resume().catch(()=>{});
}
document.addEventListener('click', ensureAudio, { once: true });
document.addEventListener('keydown', ensureAudio, { once: true });

function playPing(freq = 880) {
try {
ensureAudio();
if (!audioCtx || audioCtx.state !== 'running') return;
const osc  = audioCtx.createOscillator();
const gain = audioCtx.createGain();
osc.connect(gain);
gain.connect(audioCtx.destination);
osc.type            = 'sine';
osc.frequency.value = freq;
gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);
osc.start(audioCtx.currentTime);
osc.stop(audioCtx.currentTime + 0.35);
} catch(e) {}
}

function fireNotification(msg, convName = '', convType = null) {
const s          = getNotifSettings();
const tabVisible = !document.hidden;
const senderName = msg.senderUsername ? '@' + msg.senderUsername : (msg.senderName || 'Someone');
const body       = msg.type === 'image' ? '📷 Sent an image' : (msg.text || '').slice(0, 100);
const displayName = convName || document.getElementById('chatName')?.textContent || 'NorMSG';
const isGroup    = (convType || chatType) === 'group';

// Is this message a @mention of me?
const isMention = !!(msg.text && myUsername &&
new RegExp('@' + myUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(msg.text));

// DMs always notify. Groups: notify if groupAll is on, OR if it's a @mention and mentions is on.
const shouldNotify = !isGroup || s.groupAll || (isMention && s.mentions);
if (!shouldNotify) return;

// Sound — higher pitch for mentions. AudioCtx created lazily on first user gesture.
if (s.sound) {
if (isMention) playPing(1200);
else if (tabVisible) playPing(880);
}

// Tab badge
if (s.tabBadge) {
unreadCount++;
document.title = `${isMention ? '🔔 ' : ''}(${unreadCount}) NorMSG`;
}

// In-app banner — tab is visible
if (s.inApp && tabVisible) {
showInAppNotif(senderName, body, displayName, isMention);
return;
}

// Push notification — tab hidden/closed
if (s.push && !tabVisible && Notification.permission === 'granted') {
const title = isMention
? `🔔 ${senderName} mentioned you in ${displayName}`
: `${senderName} in ${displayName}`;
const n = new Notification(title, {
body:     body || '(image)',
icon:     NOTIF_ICON,
badge:    NOTIF_ICON,
tag:      isMention ? `mention-${displayName}` : displayName,
renotify: true
});
n.onclick = () => { window.focus(); n.close(); };
}
}

// ── IN-APP NOTIFICATION BANNER ─────────────────────────────
let inAppTimer = null;

function showInAppNotif(sender, body, convName, isMention = false) {
let banner = document.getElementById('inAppBanner');
if (!banner) {
banner = document.createElement('div');
banner.id = 'inAppBanner';
if (!document.getElementById('inAppKF')) {
const s = document.createElement('style');
s.id = 'inAppKF';
s.textContent = `@keyframes slideIn { from { opacity:0; transform:translateX(60px); } to { opacity:1; transform:translateX(0); } }`;
document.head.appendChild(s);
}
banner.onclick = () => { banner.remove(); if (inAppTimer) clearTimeout(inAppTimer); };
document.body.appendChild(banner);
}

const borderColor = isMention ? 'var(--teal)' : 'var(--border2)';
banner.style.cssText = `
position:fixed; top:18px; right:18px; z-index:9999;
background:var(--panel); border:1px solid ${borderColor};
border-left: 3px solid ${borderColor};
border-radius:16px; padding:11px 16px; max-width:310px;
box-shadow:0 12px 40px rgba(0,0,0,0.6);
display:flex; align-items:center; gap:10px;
animation: slideIn 0.25s cubic-bezier(0.34,1.56,0.64,1);
cursor:pointer;
`;

banner.innerHTML = `
<img src="${NOTIF_ICON}" style="width:32px;height:32px;border-radius:8px;flex-shrink:0;" onerror="this.style.display='none'">
<div style="min-width:0;flex:1;">
<div style="font-size:12px;font-weight:700;color:${isMention?'var(--teal)':'var(--text)'};margin-bottom:2px;">${esc(sender)} · ${esc(convName)}</div>
<div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(body)}</div>
</div>
<button onclick="event.stopPropagation();document.getElementById('inAppBanner')?.remove();" style="background:none;border:none;color:var(--muted);font-size:16px;cursor:pointer;flex-shrink:0;padding:0 2px;">✕</button>
`;

if (inAppTimer) clearTimeout(inAppTimer);
inAppTimer = setTimeout(() => { banner?.remove(); }, isMention ? 8000 : 5000);
}

// ── CLEAR TAB BADGE when tab becomes visible ───────────────
document.addEventListener('visibilitychange', () => {
if (!document.hidden && unreadCount > 0) {
unreadCount = 0;
document.title = 'NorMSG';
}
if (document.hidden) {
pausePresenceSubscriptions();
} else if (me) {
subscribePresence();
renderFriends();
}
if (!document.hidden && currentSidebarTab === 'dms') {
scheduleStatusesRefresh();
}
});

