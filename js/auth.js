// ── READ CACHE ─────────────────────────────────────────────
const USER_DOC_TTL     = 5 * 60 * 1000;
const USER_PROFILE_TTL = 2 * 60 * 1000;
const userDocCache     = {};
const usernameCache    = {};
const userProfileCache = {};

async function getCachedUserDoc(uid) {
    const cached = userDocCache[uid];
    if (cached && (Date.now() - cached.ts < USER_DOC_TTL)) {
        return cached.snap;
    }
    
    try {
        const doc = await awGet('users', uid);
        const decoded = awDecodeUser(doc);
        
        // Cache the decoded document and return it
        userDocCache[uid] = { snap: decoded, ts: Date.now() };
        return decoded;
    } catch (error) {
        console.error("User doc not found or error fetching:", error);
        return null;
    }
}

function invalidateUserCache(uid) {
    delete userDocCache[uid];
    delete userProfileCache[uid];
}

async function getCachedUid(uname) {
    if (usernameCache[uname]) return usernameCache[uname];
    try {
        const doc = await awGet('usernames', uname);
        usernameCache[uname] = doc.uid;
    } catch { /* not found */ }
    return usernameCache[uname] || null;
}

async function getCachedProfile(uid) {
    const cached = userProfileCache[uid];
    if (cached && (Date.now() - cached.ts < USER_PROFILE_TTL)) return cached.data;
    try {
        const doc  = await awGet('users', uid);
        const data = awDecodeUser(doc);
        userProfileCache[uid] = { data, ts: Date.now() };
        return data;
    } catch { return null; }
}

// ── SECURITY ───────────────────────────────────────────────
const MAX_MSG_LENGTH = 2000;
const MAX_MSG_LINES  = 75;

const AI_RATE_WINDOW = 60000;
const AI_RATE_MAX    = 10;
let aiCallTs = [];
function checkAIRateLimit() {
    const now = Date.now();
    aiCallTs  = aiCallTs.filter(t => now - t < AI_RATE_WINDOW);
    if (aiCallTs.length >= AI_RATE_MAX) return false;
    aiCallTs.push(now);
    return true;
}

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

function sanitizeUrl(url) {
    try {
        const u = new URL(url);
        return ['https:','http:','mailto:'].includes(u.protocol) ? url : '#';
    } catch { return '#'; }
}

function validateMsg(text) {
    if (!text || !text.trim()) return 'Message is empty.';
    if (text.length > MAX_MSG_LENGTH)
        return `Message too long (${text.length}/${MAX_MSG_LENGTH} chars).`;
    if ((text.match(/\n/g)||[]).length > MAX_MSG_LINES)
        return `Too many lines (max ${MAX_MSG_LINES}).`;
    return null;
}

// ── STATE ──────────────────────────────────────────────────
let me           = null;
let myUsername   = null;
let friends      = [];
let pendingReqs  = [];
let myGroups     = [];
let chatId       = null;
let chatType     = null;
let msgUnsub     = null;
let toInterval   = null;

let spamTs       = [];
let localTOUntil = null;

let unsubF = null, unsubR = null, unsubG = null;
let statusRefreshTimer  = null;
let statusRefreshQueued = false;
let statusLastLoadedAt  = 0;
let statusLastFriendKey = '';
let statusLoadInFlight  = null;
let currentSidebarTab   = 'dms';

let dmLastAt      = {};
let dmUnsubLastAt = {};

function getLastRead(id)      { try { return parseInt(localStorage.getItem('normsg_read_'+id)||'0',10); } catch { return 0; } }
function markRead(id)         { try { localStorage.setItem('normsg_read_'+id, Date.now()); } catch {} }
function isUnread(id, lastAt) { if (!lastAt) return false; return lastAt.getTime() > getLastRead(id); }

// ── AUTH ───────────────────────────────────────────────────
let _googleSignInPending = false;
function login() {
    if (_googleSignInPending) return;
    _googleSignInPending = true;
    const btn = document.querySelector('.btn-primary');
    if (btn) { btn.disabled = true; btn.innerHTML = '🔒 &nbsp; Opening…'; }
    auth.signInWithPopup(gProv)
        .catch(e => { showToast('Sign-in failed: ' + (e.message || e.code)); console.error(e); })
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
    setTimeout(() => { if (!isLockedOut()) document.getElementById('loginUsernameIn').focus(); }, 80);
}

// ── Login security ─────────────────────────────────────────
const LOGIN_MAX_ATTEMPTS  = 5;
const LOGIN_LOCKOUT_BASE  = 30;
const LOGIN_LOCKOUT_MULT  = 2;
const LOGIN_CAPTCHA_AFTER = 3;
const LS_KEY_ATTEMPTS     = 'nor_login_attempts';
const LS_KEY_LOCKOUT_UNTIL= 'nor_login_lockout_until';
const LS_KEY_LOCKOUT_COUNT= 'nor_login_lockout_count';

let _captchaAnswer   = null;
let _lockoutInterval = null;

function getLoginState() {
    return {
        attempts:     parseInt(localStorage.getItem(LS_KEY_ATTEMPTS)     || '0'),
        lockoutUntil: parseInt(localStorage.getItem(LS_KEY_LOCKOUT_UNTIL)|| '0'),
        lockoutCount: parseInt(localStorage.getItem(LS_KEY_LOCKOUT_COUNT)|| '0'),
    };
}
function setLoginAttempts(n)  { localStorage.setItem(LS_KEY_ATTEMPTS,       n); }
function setLockoutUntil(ts)  { localStorage.setItem(LS_KEY_LOCKOUT_UNTIL,  ts); }
function setLockoutCount(n)   { localStorage.setItem(LS_KEY_LOCKOUT_COUNT,   n); }
function clearLoginState()    {
    localStorage.removeItem(LS_KEY_ATTEMPTS);
    localStorage.removeItem(LS_KEY_LOCKOUT_UNTIL);
    localStorage.removeItem(LS_KEY_LOCKOUT_COUNT);
}
function isLockedOut() { return Date.now() < getLoginState().lockoutUntil; }

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
    const { attempts, lockoutUntil } = getLoginState();
    const locked = Date.now() < lockoutUntil;
    const btn    = document.getElementById('loginSubmitBtn');
    const hint   = document.getElementById('loginAttemptsHint');
    const captcha= document.getElementById('captchaBox');
    const lockBnr= document.getElementById('lockoutTimer');

    if (locked) {
        lockBnr.classList.add('visible');
        btn.disabled = true;
        if (_lockoutInterval) clearInterval(_lockoutInterval);
        _lockoutInterval = setInterval(() => {
            const rem = Math.ceil((lockoutUntil - Date.now()) / 1000);
            if (rem <= 0) { clearInterval(_lockoutInterval); updateLoginUI(); }
            else document.getElementById('lockoutCountdown').textContent = rem;
        }, 500);
        document.getElementById('lockoutCountdown').textContent = Math.ceil((lockoutUntil - Date.now()) / 1000);
        hint.textContent = ''; captcha.classList.remove('visible'); return;
    }

    lockBnr.classList.remove('visible');
    btn.disabled = false;
    if (_lockoutInterval) { clearInterval(_lockoutInterval); _lockoutInterval = null; }

    if (attempts >= LOGIN_CAPTCHA_AFTER) {
        captcha.classList.add('visible');
        if (_captchaAnswer === null) generateCaptcha();
    } else {
        captcha.classList.remove('visible'); _captchaAnswer = null;
    }

    const remaining = LOGIN_MAX_ATTEMPTS - attempts;
    if (attempts === 0)       { hint.textContent = ''; hint.className = 'login-attempts'; }
    else if (remaining > 1)   { hint.textContent = `⚠ ${remaining} attempts remaining before lockout.`; hint.className = 'login-attempts warn'; }
    else if (remaining === 1) { hint.textContent = `🚨 1 attempt remaining — next failure locks you out.`; hint.className = 'login-attempts danger'; }
}

async function doLoginWithCredentials() {
    if (isLockedOut()) return;
    const username = document.getElementById('loginUsernameIn').value.trim().toLowerCase();
    const password = document.getElementById('loginPasswordIn').value;
    if (!username) return mmsg('loginMsg', 'Enter your username.', 'err');
    if (!password) return mmsg('loginMsg', 'Enter your password.', 'err');

    const { attempts } = getLoginState();
    if (attempts >= LOGIN_CAPTCHA_AFTER) {
        const given = parseInt(document.getElementById('captchaIn').value);
        if (isNaN(given) || given !== _captchaAnswer) {
            generateCaptcha();
            return mmsg('loginMsg', '🤖 Incorrect answer — try the new captcha.', 'err');
        }
    }

    const delayMs = Math.min(500 + attempts * 400, 3000);
    const btn = document.getElementById('loginSubmitBtn');
    btn.disabled = true;
    mmsg('loginMsg', 'Signing in…', 'inf');
    await new Promise(r => setTimeout(r, delayMs));

    try {
        await auth.signInWithEmailAndPassword(username + '@normsg.local', password);
        clearLoginState(); _captchaAnswer = null;
        document.getElementById('loginModal').classList.add('hidden');
    } catch(e) {
        const isWrongCred = ['auth/user-not-found','auth/wrong-password','auth/invalid-credential','auth/invalid-email'].includes(e.code);
        mmsg('loginMsg', isWrongCred ? 'Incorrect username or password.' : 'Sign-in failed: ' + e.message, 'err');
        document.getElementById('loginPasswordIn').value = '';

        if (isWrongCred) {
            const newAttempts = attempts + 1;
            setLoginAttempts(newAttempts);
            if (newAttempts >= LOGIN_CAPTCHA_AFTER) { _captchaAnswer = null; generateCaptcha(); }

            // Log failed attempt to Appwrite
            awAdd('securityLogs', {
                event:    'failed_login',
                username,
                attempts: newAttempts,
                ua:       navigator.userAgent.slice(0, 200),
                ts:       awNow(),
            }).catch(() => {});

            if (newAttempts >= LOGIN_MAX_ATTEMPTS) {
                const { lockoutCount } = getLoginState();
                const newCount  = lockoutCount + 1;
                const lockSecs  = LOGIN_LOCKOUT_BASE * Math.pow(LOGIN_LOCKOUT_MULT, newCount - 1);
                const lockUntil = Date.now() + lockSecs * 1000;
                setLockoutUntil(lockUntil); setLockoutCount(newCount); setLoginAttempts(0);
                mmsg('loginMsg', `🔒 Account locked for ${lockSecs}s due to too many failures.`, 'err');
            }
        }
        btn.disabled = false;
        updateLoginUI();
    }
}

// ── ADMIN: create internal account ─────────────────────────
async function adminCreateAccount() {
    if (!isPlatformAdmin) return;
    const username    = document.getElementById('createAccUsernameIn').value.trim().toLowerCase();
    const displayName = document.getElementById('createAccDisplayIn').value.trim();
    const password    = document.getElementById('createAccPasswordIn').value;
    if (!username)           return mmsg('createAccMsg', 'Enter a username.', 'err');
    if (!displayName)        return mmsg('createAccMsg', 'Enter a display name.', 'err');
    if (password.length < 6) return mmsg('createAccMsg', 'Password must be at least 6 characters.', 'err');
    mmsg('createAccMsg', 'Creating account…', 'inf');
    try {
        // Check username not taken
        try {
            await awGet('usernames', username);
            return mmsg('createAccMsg', `@${username} is already taken.`, 'err');
        } catch { /* not found — good */ }

        const fakeEmail = username + '@normsg.local';
        const cred  = await auth.createUserWithEmailAndPassword(fakeEmail, password);
        const newUid = cred.user.uid;
        await cred.user.updateProfile({ displayName });

        await Promise.all([
            awDatabases.createDocument(AW_DB_ID, 'users', newUid, {
                displayName, email: fakeEmail, photoURL: null,
                username, createdByAdmin: me.uid, createdAt: awNow()
            }),
            awDatabases.createDocument(AW_DB_ID, 'usernames', username, { uid: newUid }),
        ]);

        mmsg('createAccMsg', `✓ Account @${username} created!`, 'ok');
        document.getElementById('createAccUsernameIn').value = '';
        document.getElementById('createAccDisplayIn').value  = '';
        document.getElementById('createAccPasswordIn').value = '';
        showToast('⚠️ Account created! Signing you back out — please sign in again.');
        setTimeout(() => auth.signOut(), 3000);
    } catch(e) { mmsg('createAccMsg', 'Error: ' + e.message, 'err'); }
}

// ── LOGOUT ─────────────────────────────────────────────────
function logout() {
    setPresence(false);
    clearInterval(presenceTimer);
    [msgUnsub, unsubF, unsubR, unsubG].forEach(u => u && u());
    Object.values(presenceUnsubs).forEach(u => u && u());
    presenceUnsubs = {}; dmUnsubLastAt = {}; dmLastAt = {};
    // Sign out of both Firebase and Appwrite
    awAccount.deleteSession('current').catch(() => {});
    auth.signOut();
}

// ── AUTH STATE CHANGE ──────────────────────────────────────
auth.onAuthStateChanged(async user => {
    if (user) {
        me = user;

        // Bridge Firebase session → Appwrite (creates Appwrite account if needed)
        await awEnsureSession(user.uid);

        const isInternalAccount = user.email?.endsWith('@normsg.local');
        if (!isInternalAccount) {
            // Upsert Google profile info
            await awUpsert('users', user.uid, {
                displayName: user.displayName,
                email:       user.email,
                photoURL:    user.photoURL || null,
            });
        }

        try {
            const doc  = await awGet('users', user.uid);
            myUsername = doc.username || null;
        } catch { myUsername = null; }

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
    initNormTokens();
}

function getFriendUidsKey() { return friends.map(f => f.uid).sort().join('|'); }

function scheduleStatusesRefresh({ force = false } = {}) {
    if (force) statusRefreshQueued = true;
    if (statusRefreshTimer) clearTimeout(statusRefreshTimer);
    statusRefreshTimer = setTimeout(async () => {
        statusRefreshTimer = null;
        try { await loadStatuses({ force }); }
        finally { statusRefreshQueued = false; }
    }, force ? 50 : 300);
}

// ── USERNAME SETUP ─────────────────────────────────────────
async function saveUsername() {
    const v = document.getElementById('unameInput').value.trim().toLowerCase();
    if (v.length < 3) return mmsg('unameMsg', 'Minimum 3 characters.', 'err');
    if (!/^[a-z0-9_.]+$/.test(v)) return mmsg('unameMsg', 'Letters, numbers, _ and . only.', 'err');
    mmsg('unameMsg', 'Checking…', 'inf');

    // Check availability
    try {
        await awGet('usernames', v);
        return mmsg('unameMsg', 'Username taken — try another!', 'err');
    } catch { /* not found — available */ }

    await Promise.all([
        awDatabases.createDocument(AW_DB_ID, 'usernames', v, { uid: me.uid }),
        awUpsert('users', me.uid, { username: v }),
    ]);
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
