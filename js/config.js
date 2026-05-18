// ── FIREBASE CONFIG ────────────────────────────────────────
const config = {
    apiKey:            "AIzaSyCcanLWJKqCWkPlBvBdCJjERkIimH0Xo-c",
    authDomain:        "messages-by-alex.firebaseapp.com",
    projectId:         "messages-by-alex",
    storageBucket:     "messages-by-alex.firebasestorage.app",
    messagingSenderId: "859501460037",
    appId:             "1:859501460037:web:7f7a12f7d88f7d6dbc412c"
};

firebase.initializeApp(config);

// ── APP CHECK (reCAPTCHA v3) ────────────────────────────────
const appCheck = firebase.appCheck();
appCheck.activate(
    new firebase.appCheck.ReCaptchaV3Provider('6Lfbrt4sAAAAAKoP8fQYNmXO_K1BcrUUiWY5-msG'),
    true
);

// ── FIREBASE SERVICES (Auth + Storage only — DB moved to Appwrite) ──
const auth    = firebase.auth();
const storage = firebase.storage();   // still used for nothing (Cloudinary handles media now)
const gProv   = new firebase.auth.GoogleAuthProvider();

// NOTE: db, SV, TS have been removed — all database calls now use Appwrite (appwrite.js)

// ── NORMAI API ─────────────────────────────────────────────
const NORMAI_PRO_API   = 'https://normsg-pro.simplifiedtest10.deno.net';
const NORMAI_FREE_API  = 'https://normsg-free.simplifiedtest10.deno.net';
const NORMAI_ULTRA_API = 'https://normsg-ultra.simplifiedtest10.deno.net';

let userPlan        = 'free';   // 'free' | 'pro' | 'ultra'
let selectedAIModel = 'fast';   // 'fast' | 'thinking' | 'pro'

function getNormAIUrl() {
    if (userPlan === 'ultra' && selectedAIModel === 'pro') return NORMAI_ULTRA_API;
    if ((userPlan === 'pro' || userPlan === 'ultra') && selectedAIModel === 'thinking') return NORMAI_PRO_API;
    if (userPlan === 'ultra') return NORMAI_ULTRA_API;
    return userPlan === 'pro' ? NORMAI_PRO_API : NORMAI_FREE_API;
}

function populateAIModelDropdown() {
    const sel = document.getElementById('aiModelSelect');
    sel.innerHTML = '';
    const opts = [{ value: 'fast', label: '⚡ Fast' }];
    if (userPlan === 'pro' || userPlan === 'ultra') opts.push({ value: 'thinking', label: '🧠 Thinking' });
    if (userPlan === 'ultra') opts.push({ value: 'pro', label: '✦ Pro' });
    opts.forEach(o => {
        const el = document.createElement('option');
        el.value = o.value; el.textContent = o.label;
        if (o.value === selectedAIModel) el.selected = true;
        sel.appendChild(el);
    });
}

function onAIModelChange(val) {
    selectedAIModel = val;
    try { localStorage.setItem('normsg_ai_model', val); } catch {}
}

function saveUltraAiModel(val) {
    try { localStorage.setItem('normsg_ultra_ai_model', val); } catch {}
}

function loadUltraAiModelPref() {
    try {
        const saved = localStorage.getItem('normsg_ultra_ai_model') || 'pro';
        document.getElementById('aiModelPro').checked      = saved === 'pro';
        document.getElementById('aiModelThinking').checked = saved === 'thinking';
    } catch {}
}

function extractNormAIReply(data) {
    if (!data || typeof data !== 'object') return '';
    const candidate = (
        data.reply ?? data.result ?? data.text ?? data.output ?? data.response ??
        data.message?.content ?? data.message ??
        data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ??
        data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    );
    return typeof candidate === 'string' ? candidate.trim() : '';
}

async function loadUserPlan() {
    if (!me) return;
    try {
        const snap = await getCachedUserDoc(me.uid);
        const data = snap.data() || {};
        const storedPlan = data.plan;
        // normsgUltra is decoded by awDecodeUser → { until: { toDate: () => Date }, ... }
        const ultraUntil = data.normsgUltra?.until?.toDate?.();
        const hasUltraSub = !!(ultraUntil && ultraUntil > new Date());
        if (storedPlan === 'ultra' || hasUltraSub) { userPlan = 'ultra'; }
        else if (storedPlan === 'pro')              { userPlan = 'pro';   }
        else                                         { userPlan = 'free';  }
    } catch { userPlan = 'free'; }
    updateNormAIBadge();
}

function updateNormAIBadge() {
    const badge = document.getElementById('normAIBadge');
    if (!badge) return;
    if (userPlan === 'ultra') {
        badge.textContent = '⚡ Ultra';
        badge.style.color = '#c084fc';
        badge.style.borderColor = 'rgba(192,132,252,0.4)';
        badge.style.background  = 'rgba(192,132,252,0.1)';
        badge.title = 'NorMULTRA — highest-tier AI with advanced reasoning';
    } else if (userPlan === 'pro') {
        badge.textContent = '✦ Pro';
        badge.style.color = 'var(--a2)';
        badge.style.borderColor = '';
        badge.style.background  = '';
        badge.title = 'NorMAI Pro — enhanced AI with smarter replies';
    } else {
        badge.textContent = 'Free';
        badge.style.color = 'var(--muted)';
        badge.style.borderColor = '';
        badge.style.background  = '';
        badge.title = 'NorMAI Free — upgrade to Pro for smarter AI';
    }
    const avDot = document.getElementById('ultraAvDot');
    if (avDot) avDot.classList.toggle('on', userPlan === 'ultra');
    const ultraRow = document.getElementById('ultraAiModelRow');
    if (ultraRow) {
        ultraRow.style.display = userPlan === 'ultra' ? 'flex' : 'none';
        if (userPlan === 'ultra') loadUltraAiModelPref();
    }
    try {
        const saved = localStorage.getItem('normsg_ai_model');
        if (saved) selectedAIModel = saved;
    } catch {}
}

const NORMAI_MAX_TOKENS = 16384;

async function callNormAI(prompt, context = '') {
    const url     = getNormAIUrl();
    const isPro   = userPlan === 'pro' || userPlan === 'ultra';
    const isUltra = userPlan === 'ultra';
    const body    = Object.assign(
        { max_tokens: NORMAI_MAX_TOKENS },
        isPro ? { prompt, context, mode: isUltra ? 'ultra' : 'pro' } : { prompt }
    );
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`NorMAI ${res.status}`);
    const data = await res.json();
    return extractNormAIReply(data);
}

async function openSmartReply() {
    if (!chatId) return;
    const btn = document.getElementById('normAIBtn');
    btn.disabled = true; btn.textContent = '…';
    try {
        const msgs    = [...document.querySelectorAll('#messagesArea .bubble')]
            .slice(-8).map(b => b.textContent.trim()).join('\n');
        const isPro   = userPlan === 'pro' || userPlan === 'ultra';
        const context = isPro ? msgs : '';
        const prompt  = isPro
            ? 'Suggest 3 short, natural reply options for the last message in this chat. Output only the replies as a numbered list, no explanation.'
            : 'Suggest a short reply for this chat.';
        const reply = await callNormAI(prompt, context);
        showNormAIPanel(reply, isPro);
    } catch (e) {
        showToast('NorMAI error: ' + e.message);
    } finally {
        btn.disabled = false; btn.textContent = '✦';
    }
}

function showNormAIPanel(text, isPro) {
    document.getElementById('normAIPanel')?.remove();
    const panel = document.createElement('div');
    panel.id = 'normAIPanel';
    panel.style.cssText = `position:absolute;bottom:calc(100% + 8px);left:0;right:0;
        background:var(--panel);border:1px solid var(--border2);border-radius:16px;
        padding:12px 14px;z-index:50;box-shadow:0 8px 32px rgba(0,0,0,0.55);animation:fadeIn 0.18s ease;`;
    const lines = text.split('\n').map(l => l.replace(/^\d+[\.\)]\s*/,'').trim()).filter(Boolean);
    panel.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:9px;">
            <span style="font-family:'Syne',sans-serif;font-size:11px;font-weight:800;letter-spacing:0.05em;
                background:linear-gradient(135deg,var(--a2),var(--teal));
                -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
                ✦ NorMAI${isPro ? ' Pro' : ''}
            </span>
            <button onclick="document.getElementById('normAIPanel').remove()"
                style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;padding:0 2px;">✕</button>
        </div>
        ${lines.map(l=>`<div onclick="useNormAISuggestion(this)"
            style="padding:7px 10px;border-radius:10px;font-size:13px;cursor:pointer;
                border:1px solid var(--border);margin-bottom:5px;transition:background 0.12s;line-height:1.45;"
            onmouseenter="this.style.background='var(--card)'"
            onmouseleave="this.style.background=''">
            ${esc(l)}</div>`).join('')}
        ${!isPro?`<div style="font-size:10px;color:var(--muted);margin-top:6px;text-align:center;">
            Upgrade to <strong style="color:var(--a2);">Pro</strong> for context-aware multi-suggestions
        </div>`:''}`;
    document.querySelector('.in-row').style.position = 'relative';
    document.querySelector('.in-row').appendChild(panel);
}

function useNormAISuggestion(el) {
    const inp = document.getElementById('msgInput');
    inp.value = el.textContent.trim();
    inp.focus(); autoGrow(inp);
    document.getElementById('normAIPanel')?.remove();
}
