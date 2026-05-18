// ── NORMTOKENS ─────────────────────────────────────────────
// Tokens stored in Appwrite: users/{uid}.normTokens (JSON string)
// Structure: { balance, lifetime, dailyMsgCount, dailyMsgDate }
// Earnings:  +2 per message (max 500/day) | +10 play game | +25 win | +40 Wordle
// Shop:      pro_1d=100  pro_7d=500  ultra_1d=250  ultra_7d=1250  ultra_30d=4000

const NT_MSG_DAILY_CAP  = 500;
const NT_EARN_MSG        = 2;
const NT_EARN_PLAY       = 10;
const NT_EARN_WIN        = 25;
const NT_EARN_WORDLE_WIN = 40;

// ── Load & display balance ──────────────────────────────────
async function ntLoad() {
    if (!me) return;
    try {
        const doc = await awGet('users', me.uid);
        const d   = awDecode(doc.normTokens) || {};
        ntRefreshDisplay(d.balance || 0, d.lifetime || 0);
    } catch { /* silent */ }
}

function ntRefreshDisplay(balance, lifetime) {
    const b = document.getElementById('ntBalanceDisplay');
    const l = document.getElementById('ntLifetimeDisplay');
    if (b) b.textContent = balance.toLocaleString() + ' 🪙';
    if (l) l.textContent = lifetime.toLocaleString() + ' earned';
}

// ── Award tokens ────────────────────────────────────────────
// Appwrite client SDK has no transactions, so we use optimistic fetch → update.
// For a chat app this is fine — token counts don't need bank-level consistency.
async function ntAward(amount, reason) {
    if (!me || amount <= 0) return;
    try {
        const doc      = await awGet('users', me.uid);
        const d        = awDecode(doc.normTokens) || {};
        const balance  = (d.balance  || 0) + amount;
        const lifetime = (d.lifetime || 0) + amount;
        const updated  = { ...d, balance, lifetime };

        await awUpdate('users', me.uid, { normTokens: awEncode(updated) });
        ntRefreshDisplay(balance, lifetime);

        // Visual pulse
        const b = document.getElementById('ntBalanceDisplay');
        if (b) { b.classList.remove('nt-pop'); void b.offsetWidth; b.classList.add('nt-pop'); }

        if (amount >= NT_EARN_PLAY) showToast(`+${amount} 🪙 ${reason}`);
    } catch { /* silent — never block the user action */ }
}

// ── Message token (with daily cap check) ───────────────────
async function ntOnMessage() {
    if (!me) return;
    try {
        const today    = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const doc      = await awGet('users', me.uid);
        const d        = awDecode(doc.normTokens) || {};
        const prevDate  = d.dailyMsgDate  || '';
        const prevCount = prevDate === today ? (d.dailyMsgCount || 0) : 0;

        if (prevCount >= NT_MSG_DAILY_CAP) return; // cap hit — silent skip

        const balance  = (d.balance  || 0) + NT_EARN_MSG;
        const lifetime = (d.lifetime || 0) + NT_EARN_MSG;
        const updated  = {
            ...d,
            balance,
            lifetime,
            dailyMsgCount: prevCount + 1,
            dailyMsgDate:  today,
        };

        await awUpdate('users', me.uid, { normTokens: awEncode(updated) });
        ntRefreshDisplay(balance, lifetime);
    } catch { /* silent */ }
}

// ── Shop / redeem ───────────────────────────────────────────
const NT_SHOP = {
    pro_1d:    { label: 'NorMAI Pro 1 day',   cost: 100,  plan: 'pro',   days: 1  },
    pro_7d:    { label: 'NorMAI Pro 7 days',  cost: 500,  plan: 'pro',   days: 7  },
    ultra_1d:  { label: 'NorMULTRA 1 day',    cost: 250,  plan: 'ultra', days: 1  },
    ultra_7d:  { label: 'NorMULTRA 7 days',   cost: 1250, plan: 'ultra', days: 7  },
    ultra_30d: { label: 'NorMULTRA 30 days',  cost: 4000, plan: 'ultra', days: 30 },
};

async function ntRedeem(itemId, cost) {
    if (!me) return;
    const item = NT_SHOP[itemId];
    if (!item) return;

    if (!confirm(`Redeem ${item.label} for ${cost.toLocaleString()} 🪙?\n\nThis will extend your ${item.plan === 'ultra' ? 'NorMULTRA' : 'NorMAI Pro'} access by ${item.days} day${item.days > 1 ? 's' : ''}.`)) return;

    try {
        const doc    = await awGet('users', me.uid);
        const tokens = awDecode(doc.normTokens) || {};
        const balance = tokens.balance || 0;

        if (balance < cost) {
            showToast(`Not enough tokens — you need ${cost.toLocaleString()} 🪙`);
            return;
        }

        // Work out new plan expiry — extend from now or existing expiry, whichever is later
        const planField = item.plan === 'ultra' ? 'normsgUltra' : 'normsgSuper';
        const existing  = awDecode(doc[planField]);
        const existingUntil = existing?.until ? new Date(existing.until) : null;
        const base  = (existingUntil && existingUntil > new Date()) ? existingUntil : new Date();
        const until = new Date(base.getTime() + item.days * 86400000);

        const newTokens = { ...tokens, balance: balance - cost };
        const planData  = awEncode({ until: until.toISOString(), days: item.days, grantedAt: awNow() });

        const updatePayload = {
            normTokens: awEncode(newTokens),
            [planField]: planData,
            ...(item.plan === 'ultra' ? { plan: 'ultra' } : {}),
        };

        await awUpdate('users', me.uid, updatePayload);

        // Refresh UI
        ntRefreshDisplay(newTokens.balance, tokens.lifetime || 0);
        ntLoad(); // reload both values fresh from Appwrite
        invalidateUserCache(me.uid);
        loadUserPlan();
        showToast(`✅ ${item.label} activated!`);
    } catch(e) {
        showToast('Redeem failed: ' + e.message);
    }
}

// ── Init (called from finishLogin in auth.js) ──────────────
function initNormTokens() {
    ntLoad();
}
