// ── FIRESTORE READ CACHE ───────────────────────────────────
// Reduces redundant reads without restructuring any functions.
// userDocCache  : uid  → { data, ts }   (5-min TTL, invalidated on own writes)
// usernameCache : name → uid            (permanent — usernames don't change)
// userProfileCache: uid → data          (2-min TTL for other users' profiles)

const USER_DOC_TTL     = 5 * 60 * 1000;   // 5 min
const USER_PROFILE_TTL = 2 * 60 * 1000;   // 2 min
const userDocCache     = {};               // uid → {data, ts}
const usernameCache    = {};               // username → uid
const userProfileCache = {};               // uid → {data, ts}

// Cached fetch of any users/{uid} doc
async function getCachedUserDoc(uid) {
const cached = userDocCache[uid];
if (cached && (Date.now() - cached.ts < USER_DOC_TTL)) return cached.snap;
const snap = await db.collection('users').doc(uid).get();
userDocCache[uid] = { snap, ts: Date.now() };
return snap;
}

// Invalidate own cache entry after a write so next read is fresh
function invalidateUserCache(uid) {
delete userDocCache[uid];
}

// Cached username → uid lookup (permanent cache — usernames are immutable)
async function getCachedUid(uname) {
if (usernameCache[uname]) return usernameCache[uname];
const doc = await db.collection('usernames').doc(uname).get();
if (doc.exists) usernameCache[uname] = doc.data().uid;
return usernameCache[uname] || null;
}

// Cached fetch of another user's profile (lighter TTL)
async function getCachedProfile(uid) {
const cached = userProfileCache[uid];
if (cached && (Date.now() - cached.ts < USER_PROFILE_TTL)) return cached.data;
const snap = await db.collection('users').doc(uid).get();
const data = snap.data() || null;
userProfileCache[uid] = { data, ts: Date.now() };
return data;
}

// ── SECURITY ───────────────────────────────────────────────

// 1. Message limits
const MAX_MSG_LENGTH = 2000;   // chars — prevents oversized Firestore docs
const MAX_MSG_LINES  = 75;     // line limit

// 2. AI rate limiting — max 10 @AI calls per minute per user
const AI_RATE_WINDOW = 60000;
const AI_RATE_MAX    = 10;
let aiCallTs = [];
function checkAIRateLimit() {
const now = Date.now();
aiCallTs   = aiCallTs.filter(t => now - t < AI_RATE_WINDOW);
if (aiCallTs.length >= AI_RATE_MAX) return false;
aiCallTs.push(now);
return true;
}

// 3. Session inactivity timeout — auto-logout after 60 min of no interaction
const SESSION_TIMEOUT_MS = 60 * 60 * 1000;
let sessionTimer = null;
function resetSessionTimer() {
clearTimeout(sessionTimer);
sessionTimer = setTimeout(() => {
    showToast('Session expired — logging you out for security.');
    setTimeout(() => logout(), 2000);
}, SESSION_TIMEOUT_MS);
}
['click','keydown','mousemove','touchstart'].forEach(ev =>
document.addEventListener(ev, resetSessionTimer, { passive: true })
);

// 4. URL sanitizer — only allow safe protocols in user-generated links
function sanitizeUrl(url) {
try {
    const u = new URL(url);
    return ['https:','http:','mailto:'].includes(u.protocol) ? url : '#';
} catch { return '#'; }
}

// 5. Message content validation — called before any send
function validateMsg(text) {
if (!text || !text.trim()) return 'Message is empty.';
if (text.length > MAX_MSG_LENGTH)
    return `Message too long (${text.length}/${MAX_MSG_LENGTH} chars).`;
if ((text.match(/\n/g)||[]).length > MAX_MSG_LINES)
    return `Too many lines (max ${MAX_MSG_LINES}).`;
return null;  // null = valid
}

// ── STATE ──────────────────────────────────────────────────
let me           = null;   // auth user
let myUsername   = null;
let friends      = [];     // accepted friends
let pendingReqs  = [];     // incoming requests
let myGroups     = [];
let chatId       = null;   // current convId or groupId
let chatType     = null;   // 'dm' | 'group'
let msgUnsub     = null;
let toInterval   = null;

// Spam tracking
let spamTs       = [];     // timestamps of recent sends
let localTOUntil = null;   // Date — local spam timeout

// Unsubscribe handles
let unsubF = null, unsubR = null, unsubG = null;
let statusRefreshTimer = null;
let statusRefreshQueued = false;
let statusLastLoadedAt = 0;
let statusLastFriendKey = '';
let statusLoadInFlight = null;
let currentSidebarTab = 'dms';

// ── UNREAD / LAST-AT TRACKING ──────────────────────────────
let dmLastAt = {};   // convId/groupId -> Date
let dmUnsubLastAt = {};  // convId -> unsub fn

function getLastRead(id)       { try { return parseInt(localStorage.getItem('normsg_read_'+id)||'0',10); } catch { return 0; } }
function markRead(id)          { try { localStorage.setItem('normsg_read_'+id, Date.now()); } catch {} }
function isUnread(id, lastAt)  { if (!lastAt) return false; return lastAt.getTime() > getLastRead(id); }

// ── AUTH ───────────────────────────────────────────────────
let _googleSignInPending = false;
function login() {
    if (_googleSignInPending) return;
    _googleSignInPending = true;
    const btn = document.querySelector('.btn-primary');
    if (btn) { btn.disabled = true; btn.innerHTML = '🔒 &nbsp; Opening…'; }
    auth.signInWithPopup(gProv)
        .then(() => {
            // onAuthStateChanged handles the rest
        })
        .catch(e => {
            showToast('Sign-in failed: ' + (e.message || e.code));
            console.error('Google sign-in error:', e);
        })
        .finally(() => {
            _googleSignInPending = false;
            if (btn) { btn.disabled = false; btn.innerHTML = '🔒 &nbsp; Continue with Google'; }
        });
}

function openLoginModal() {
document.getElementById('loginUsernameIn').value = '';
document.getElementById('loginPasswordIn').value = '';
document.getElementById('captchaIn') && (document.getElementById('captchaIn').value = '');
mmsg('loginMsg', '', '');
updateLoginUI();
document.getElementById('loginModal').classList.remove('hidden');
setTimeout(() => {
    if (!isLockedOut()) document.getElementById('loginUsernameIn').focus();
}, 80);
}

// ── Login security state ─────────────────────────────────────
const LOGIN_MAX_ATTEMPTS   = 5;      // lockout after this many failures
const LOGIN_LOCKOUT_BASE   = 30;     // first lockout: 30s
const LOGIN_LOCKOUT_MULT   = 2;      // doubles each lockout: 30 → 60 → 120 → …
const LOGIN_CAPTCHA_AFTER  = 3;      // show captcha after this many failures
const LS_KEY_ATTEMPTS      = 'nor_login_attempts';
const LS_KEY_LOCKOUT_UNTIL = 'nor_login_lockout_until';
const LS_KEY_LOCKOUT_COUNT = 'nor_login_lockout_count';

let _captchaAnswer = null;
let _lockoutInterval = null;

function getLoginState() {
    return {
        attempts:     parseInt(localStorage.getItem(LS_KEY_ATTEMPTS)     || '0'),
        lockoutUntil: parseInt(localStorage.getItem(LS_KEY_LOCKOUT_UNTIL)|| '0'),
        lockoutCount: parseInt(localStorage.getItem(LS_KEY_LOCKOUT_COUNT)|| '0'),
    };
}
function setLoginAttempts(n)     { localStorage.setItem(LS_KEY_ATTEMPTS,      n); }
function setLockoutUntil(ts)     { localStorage.setItem(LS_KEY_LOCKOUT_UNTIL, ts); }
function setLockoutCount(n)      { localStorage.setItem(LS_KEY_LOCKOUT_COUNT,  n); }
function clearLoginState()       {
    localStorage.removeItem(LS_KEY_ATTEMPTS);
    localStorage.removeItem(LS_KEY_LOCKOUT_UNTIL);
    localStorage.removeItem(LS_KEY_LOCKOUT_COUNT);
}
function isLockedOut() {
    const { lockoutUntil } = getLoginState();
    return Date.now() < lockoutUntil;
}

function generateCaptcha() {
    const a = Math.floor(Math.random() * 12) + 1;
    const b = Math.floor(Math.random() * 12) + 1;
    const ops = [
        { q: `${a} + ${b}`, ans: a + b },
        { q: `${a + b} − ${b}`, ans: a },
        { q: `${a} × ${b > 6 ? 2 : b}`, ans: a * (b > 6 ? 2 : b) },
    ];
    const pick = ops[Math.floor(Math.random() * ops.length)];
    _captchaAnswer = pick.ans;
    document.getElementById('captchaQ').textContent = pick.q;
    document.getElementById('captchaIn').value = '';
}

function updateLoginUI() {
    const { attempts, lockoutUntil, lockoutCount } = getLoginState();
    const locked   = Date.now() < lockoutUntil;
    const btn      = document.getElementById('loginSubmitBtn');
    const hint     = document.getElementById('loginAttemptsHint');
    const captcha  = document.getElementById('captchaBox');
    const lockBnr  = document.getElementById('lockoutTimer');

    // Lockout banner
    if (locked) {
        lockBnr.classList.add('visible');
        btn.disabled = true;
        if (_lockoutInterval) clearInterval(_lockoutInterval);
        _lockoutInterval = setInterval(() => {
            const rem = Math.ceil((lockoutUntil - Date.now()) / 1000);
            if (rem <= 0) {
                clearInterval(_lockoutInterval);
                updateLoginUI();
            } else {
                document.getElementById('lockoutCountdown').textContent = rem;
            }
        }, 500);
        document.getElementById('lockoutCountdown').textContent = Math.ceil((lockoutUntil - Date.now()) / 1000);
        hint.textContent = '';
        captcha.classList.remove('visible');
        return;
    }

    // Not locked
    lockBnr.classList.remove('visible');
    btn.disabled = false;
    if (_lockoutInterval) { clearInterval(_lockoutInterval); _lockoutInterval = null; }

    // Captcha
    const showCaptcha = attempts >= LOGIN_CAPTCHA_AFTER;
    if (showCaptcha) {
        captcha.classList.add('visible');
        if (_captchaAnswer === null) generateCaptcha();
    } else {
        captcha.classList.remove('visible');
        _captchaAnswer = null;
    }

    // Attempt hint
    const remaining = LOGIN_MAX_ATTEMPTS - attempts;
    if (attempts === 0) {
        hint.textContent = '';
        hint.className   = 'login-attempts';
    } else if (remaining > 1) {
        hint.textContent = `⚠ ${remaining} attempts remaining before lockout.`;
        hint.className   = 'login-attempts warn';
    } else if (remaining === 1) {
        hint.textContent = `🚨 1 attempt remaining — next failure locks you out.`;
        hint.className   = 'login-attempts danger';
    } else {
        hint.textContent = '';
    }
}

async function doLoginWithCredentials() {
    if (isLockedOut()) return;

    const username = document.getElementById('loginUsernameIn').value.trim().toLowerCase();
    const password = document.getElementById('loginPasswordIn').value;
    if (!username) return mmsg('loginMsg', 'Enter your username.', 'err');
    if (!password) return mmsg('loginMsg', 'Enter your password.', 'err');

    const { attempts } = getLoginState();

    // Captcha check
    if (attempts >= LOGIN_CAPTCHA_AFTER) {
        const given = parseInt(document.getElementById('captchaIn').value);
        if (isNaN(given) || given !== _captchaAnswer) {
            generateCaptcha();
            return mmsg('loginMsg', '🤖 Incorrect answer — try the new captcha.', 'err');
        }
    }

    // Artificial delay to slow automated attacks (grows with attempt count)
    const delayMs = Math.min(500 + attempts * 400, 3000);
    const btn = document.getElementById('loginSubmitBtn');
    btn.disabled = true;
    mmsg('loginMsg', 'Signing in…', 'inf');
    await new Promise(r => setTimeout(r, delayMs));

    try {
        await auth.signInWithEmailAndPassword(username + '@normsg.local', password);

        // Success — clear lockout state
        clearLoginState();
        _captchaAnswer = null;
        document.getElementById('loginModal').classList.add('hidden');

    } catch(e) {
        const isWrongCred = ['auth/user-not-found','auth/wrong-password','auth/invalid-credential','auth/invalid-email'].includes(e.code);
        const msg = isWrongCred ? 'Incorrect username or password.' : 'Sign-in failed: ' + e.message;
        mmsg('loginMsg', msg, 'err');

        // Clear password field on failure
        document.getElementById('loginPasswordIn').value = '';

        if (isWrongCred) {
            const newAttempts = attempts + 1;
            setLoginAttempts(newAttempts);

            // Generate new captcha on each failure
            if (newAttempts >= LOGIN_CAPTCHA_AFTER) {
                _captchaAnswer = null;
                generateCaptcha();
            }

            // Log to Firestore so admins can see brute-force attempts
            db.collection('securityLogs').add({
                event:     'failed_login',
                username,
                attempts:  newAttempts,
                ua:        navigator.userAgent.slice(0, 200),
                ts:        SV(),
            }).catch(() => {});

            // Trigger lockout if max attempts reached
            if (newAttempts >= LOGIN_MAX_ATTEMPTS) {
                const { lockoutCount } = getLoginState();
                const newCount     = lockoutCount + 1;
                const lockSecs     = LOGIN_LOCKOUT_BASE * Math.pow(LOGIN_LOCKOUT_MULT, newCount - 1);
                const lockUntil    = Date.now() + lockSecs * 1000;
                setLockoutUntil(lockUntil);
                setLockoutCount(newCount);
                setLoginAttempts(0);
                mmsg('loginMsg', `🔒 Account locked for ${lockSecs}s due to too many failures.`, 'err');
            }
        }

        btn.disabled = false;
        updateLoginUI();
    }
}

async function adminCreateAccount() {
if (!isPlatformAdmin) return;
const username    = document.getElementById('createAccUsernameIn').value.trim().toLowerCase();
const displayName = document.getElementById('createAccDisplayIn').value.trim();
const password    = document.getElementById('createAccPasswordIn').value;
if (!username)         return mmsg('createAccMsg', 'Enter a username.', 'err');
if (!displayName)      return mmsg('createAccMsg', 'Enter a display name.', 'err');
if (password.length < 6) return mmsg('createAccMsg', 'Password must be at least 6 characters.', 'err');
mmsg('createAccMsg', 'Creating account…', 'inf');
try {
    const ex = await db.collection('usernames').doc(username).get();
    if (ex.exists) return mmsg('createAccMsg', `@${username} is already taken.`, 'err');

    const fakeEmail = username + '@normsg.local';
    const cred = await auth.createUserWithEmailAndPassword(fakeEmail, password);
    const newUid = cred.user.uid;
    await cred.user.updateProfile({ displayName });

    const batch = db.batch();
    batch.set(db.collection('users').doc(newUid), {
        displayName, email: fakeEmail, photoURL: null, username,
        createdByAdmin: me.uid, createdAt: SV()
    });
    batch.set(db.collection('usernames').doc(username), { uid: newUid });
    await batch.commit();

    mmsg('createAccMsg', `✓ Account @${username} created! Make sure to note the password before closing.`, 'ok');
    document.getElementById('createAccUsernameIn').value = '';
    document.getElementById('createAccDisplayIn').value  = '';
    document.getElementById('createAccPasswordIn').value = '';

    // Creating an account signs you in as that user — sign the admin back out
    // so they can re-sign in with Google
    showToast('⚠️ Account created! Signing you back out — please sign in again.');
    setTimeout(() => auth.signOut(), 3000);
} catch(e) { mmsg('createAccMsg', 'Error: ' + e.message, 'err'); }
}

function logout() {
setPresence(false);
clearInterval(presenceTimer);
[msgUnsub, unsubF, unsubR, unsubG].forEach(u => u && u());    Object.values(presenceUnsubs).forEach(u => u && u());
Object.values(dmUnsubLastAt).forEach(u => u && u());
presenceUnsubs = {};
dmUnsubLastAt  = {};
dmLastAt       = {};
auth.signOut();
}

auth.onAuthStateChanged(async user => {
if (user) {
    me = user;
    const isInternalAccount = user.email?.endsWith('@normsg.local');
    // Upsert user profile (skip for internal accounts — already set up by admin)
    if (!isInternalAccount) {
        await db.collection('users').doc(user.uid).set({
            displayName: user.displayName,
            email:       user.email,
            photoURL:    user.photoURL || null
        }, { merge: true });
    }

    const snap  = await db.collection('users').doc(user.uid).get();
    myUsername  = snap.data()?.username || null;
    await loadUserPlan();
    resetSessionTimer();

    if (!myUsername) {
        document.getElementById('landingScreen').classList.add('hidden');
        document.getElementById('usernameModal').classList.remove('hidden');
    } else {
        finishLogin();
    }
} else {
    me = null; myUsername = null;
    document.getElementById('landingScreen').classList.remove('hidden');
    document.getElementById('mainApp').classList.add('hidden');
    document.getElementById('usernameModal').classList.add('hidden');
}
});

function finishLogin() {
document.getElementById('usernameModal').classList.add('hidden');
document.getElementById('landingScreen').classList.add('hidden');
document.getElementById('mainApp').classList.remove('hidden');
setProfile();
subscribeAll();
scheduleStatusesRefresh({ force: true });
initAdminSystem();
initAIChats();
}

function getFriendUidsKey() {
return friends.map(f => f.uid).sort().join('|');
}

function scheduleStatusesRefresh({ force = false } = {}) {
if (force) statusRefreshQueued = true;
if (statusRefreshTimer) clearTimeout(statusRefreshTimer);
// Coalesce rapid snapshot bursts into a single status read pass.
statusRefreshTimer = setTimeout(async () => {
    statusRefreshTimer = null;
    try {
        await loadStatuses({ force });
    } finally {
        statusRefreshQueued = false;
    }
}, force ? 50 : 300);
}

// ── USERNAME SETUP ─────────────────────────────────────────
async function saveUsername() {
const v = document.getElementById('unameInput').value.trim().toLowerCase();
if (v.length < 3) return mmsg('unameMsg', 'Minimum 3 characters.', 'err');
if (!/^[a-z0-9_.]+$/.test(v)) return mmsg('unameMsg', 'Letters, numbers, _ and . only.', 'err');

mmsg('unameMsg', 'Checking…', 'inf');

const ex = await db.collection('usernames').doc(v).get();
if (ex.exists) return mmsg('unameMsg', 'Username taken — try another!', 'err');

const batch = db.batch();
batch.set(db.collection('usernames').doc(v), { uid: me.uid });
batch.update(db.collection('users').doc(me.uid), { username: v });
await batch.commit();

myUsername = v;
finishLogin();
}

// ── PROFILE ────────────────────────────────────────────────
function setProfile() {
const name = me.displayName || me.email;
document.getElementById('myName').textContent   = name;
document.getElementById('myHandle').textContent = '@' + myUsername;
const av = document.getElementById('myAv');
av.innerHTML = me.photoURL ? `<img src="${me.photoURL}" alt="">` : initials(name);
}

