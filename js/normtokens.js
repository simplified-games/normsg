// ── NORMTOKENS ─────────────────────────────────────────────
// Tokens stored in Firestore: users/{uid}.normTokens { balance, lifetime, dailyMsgCount, dailyMsgDate }
// Earnings:  +2 per message (max 500/day)  |  +10 play game  |  +25 win game  |  +40 solve Wordle
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
        const snap = await db.collection('users').doc(me.uid).get();
        const d    = snap.data()?.normTokens || {};
        ntRefreshDisplay(d.balance || 0, d.lifetime || 0);
    } catch { /* silent */ }
}

function ntRefreshDisplay(balance, lifetime) {
    const b = document.getElementById('ntBalanceDisplay');
    const l = document.getElementById('ntLifetimeDisplay');
    if (b) b.textContent = balance.toLocaleString() + ' 🪙';
    if (l) l.textContent = lifetime.toLocaleString() + ' earned';
}

// ── Award tokens (Firestore transaction) ───────────────────
async function ntAward(amount, reason) {
    if (!me || amount <= 0) return;
    try {
        const ref = db.collection('users').doc(me.uid);
        await db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            const d    = snap.data()?.normTokens || {};
            let balance  = (d.balance  || 0) + amount;
            let lifetime = (d.lifetime || 0) + amount;
            tx.set(ref, { normTokens: { balance, lifetime,
                dailyMsgCount: d.dailyMsgCount || 0,
                dailyMsgDate:  d.dailyMsgDate  || '' } }, { merge: true });
            return { balance, lifetime };
        }).then(result => {
            if (result) ntRefreshDisplay(result.balance, result.lifetime);
        });
        // Visual pulse on balance display
        const b = document.getElementById('ntBalanceDisplay');
        if (b) { b.classList.remove('nt-pop'); void b.offsetWidth; b.classList.add('nt-pop'); }
        // Tiny toast only for bigger awards
        if (amount >= NT_EARN_PLAY) showToast(`+${amount} 🪙 ${reason}`);
    } catch { /* silent — never block the user action */ }
}

// ── Message token (with daily cap check) ───────────────────
async function ntOnMessage() {
    if (!me) return;
    try {
        const ref  = db.collection('users').doc(me.uid);
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        await db.runTransaction(async tx => {
            const snap  = await tx.get(ref);
            const d     = snap.data()?.normTokens || {};
            const prevDate  = d.dailyMsgDate  || '';
            const prevCount = prevDate === today ? (d.dailyMsgCount || 0) : 0;
            if (prevCount >= NT_MSG_DAILY_CAP) return null; // cap hit
            const balance  = (d.balance  || 0) + NT_EARN_MSG;
            const lifetime = (d.lifetime || 0) + NT_EARN_MSG;
            tx.set(ref, { normTokens: {
                balance, lifetime,
                dailyMsgCount: prevCount + 1,
                dailyMsgDate:  today
            }}, { merge: true });
            return { balance, lifetime };
        }).then(result => {
            if (result) ntRefreshDisplay(result.balance, result.lifetime);
        });
    } catch { /* silent */ }
}

// ── Shop / redeem ───────────────────────────────────────────
const NT_SHOP = {
    pro_1d:    { label: 'NorMAI Pro 1 day',    cost: 100,  plan: 'pro',   days: 1  },
    pro_7d:    { label: 'NorMAI Pro 7 days',   cost: 500, plan: 'pro',   days: 7  },
    ultra_1d:  { label: 'NorMULTRA 1 day',     cost: 250,  plan: 'ultra', days: 1  },
    ultra_7d:  { label: 'NorMULTRA 7 days',    cost: 1250, plan: 'ultra', days: 7  },
    ultra_30d: { label: 'NorMULTRA 30 days',   cost: 4000, plan: 'ultra', days: 30 },
};

async function ntRedeem(itemId, cost) {
    if (!me) return;
    const item = NT_SHOP[itemId];
    if (!item) return;

    // Confirm
    if (!confirm(`Redeem ${item.label} for ${cost.toLocaleString()} 🪙?\n\nThis will extend your ${item.plan === 'ultra' ? 'NorMULTRA' : 'NorMAI Pro'} access by ${item.days} day${item.days > 1 ? 's' : ''}.`)) return;

    const ref = db.collection('users').doc(me.uid);
    let ok = false;

    try {
        await db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            const d    = snap.data() || {};
            const tokens = d.normTokens || {};
            const balance = tokens.balance || 0;

            if (balance < cost) throw new Error('not_enough');

            // Work out new plan expiry — extend from now or existing expiry, whichever is later
            const planField = item.plan === 'ultra' ? 'normsgUltra' : 'normsgSuper';
            const existing  = d[planField]?.until?.toDate?.();
            const base      = (existing && existing > new Date()) ? existing : new Date();
            const until     = new Date(base.getTime() + item.days * 86400000);

            tx.set(ref, {
                normTokens: { ...tokens, balance: balance - cost },
                [planField]: { until: TS.fromDate(until), days: item.days, grantedAt: SV() },
                ...(item.plan === 'ultra' ? { plan: 'ultra' } : {})
            }, { merge: true });

            ok = true;
            return balance - cost;
        }).then(newBal => {
            if (ok) {
                ntRefreshDisplay(newBal, 0); // lifetime unchanged by spend
                ntLoad(); // reload both values from Firestore
                loadUserPlan();
                showToast(`✅ ${item.label} activated!`);
            }
        });
    } catch (e) {
        if (e.message === 'not_enough') {
            showToast(`Not enough tokens — you need ${cost.toLocaleString()} 🪙`);
        } else {
            showToast('Redeem failed: ' + e.message);
        }
    }
}

// ── Hook into finishLogin ──────────────────────────────────
// Called from auth.js finishLogin() — loads the balance on startup
function initNormTokens() {
    ntLoad();
}
