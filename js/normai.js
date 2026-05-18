// ── GROQ AI INTEGRATION ───────────────────────────────────
// Key is stored securely in the Deno Deploy environment — never exposed here
const GROQ_MODEL     = 'llama-3.1-8b-instant';        // standard
const GROQ_MODEL_SUPER = 'llama-3.3-70b-versatile';  // NorMSG Super

async function triggerAIResponse(userText) {
if (!chatId || chatType !== 'group') return;

const msgPath = `groups/${chatId}/messages`;

// Strip @AI from the prompt
const prompt = userText.replace(/@AI\b/gi, '').trim();
if (!prompt) return;

// Rate limit AI calls
if (!checkAIRateLimit()) {
showToast('⚠ AI rate limit reached — please wait a moment.');
return;
}

// Check if the sender has NorMSG Super/Ultra or Pro (all get the smarter model)
const isSuper = userPlan === 'pro' || userPlan === 'ultra' || await hasSuper(me.uid) || await hasUltra(me.uid);
const isUltraUser = userPlan === 'ultra';
let model = GROQ_MODEL;
if (isUltraUser) {
    // Ultra users can pick Pro or Thinking for @AI
    const ultraPref = (() => { try { return localStorage.getItem('normsg_ultra_ai_model') || 'pro'; } catch { return 'pro'; } })();
    model = ultraPref === 'thinking' ? GROQ_MODEL_SUPER : GROQ_MODEL_SUPER; // both use super model via GROQ; pro routes to NVIDIA
} else if (isSuper) {
    model = GROQ_MODEL_SUPER;
}

// Post a "thinking" placeholder so everyone sees AI is working
const thinkRef = await db.collection(msgPath).add({
type:          'ai-thinking',
text:          '',
senderUid:     'AI',
senderName:    'AI Assistant',
senderUsername:'AI',
senderPhoto:   null,
timestamp:     SV(),
deleteAt:      TS.fromDate(new Date(Date.now() + 7*24*3600000))
});

// Fetch last 10 messages for context
const ctxSnap = await db.collection(msgPath)
.orderBy('timestamp','desc').limit(10).get();
const history = ctxSnap.docs
.reverse()
.filter(d => d.id !== thinkRef.id && d.data().type === 'text')
.map(d => ({
role:    d.data().senderUid === 'AI' ? 'assistant' : 'user',
content: `${d.data().senderUsername || d.data().senderName || 'User'}: ${d.data().text}`
}));

try {
// Build context string from history for the worker
const contextStr = history.map(m => `${m.role === 'assistant' ? 'AI' : m.content.split(':')[0]}: ${m.content.split(':').slice(1).join(':').trim()}`).join('\n');
const systemNote = `You are a helpful AI assistant inside NorMSG, a group messaging app. Be friendly, concise and smart. When writing code, use markdown fenced blocks with the language tag and real line breaks (never JSON \\n escapes). The user who mentioned you is ${me.displayName || myUsername || 'someone'}.${isSuper ? ' NorMSG Super mode — give more detailed, thorough answers.' : ''}`;
const fullPrompt = systemNote + (contextStr ? `\n\nChat history:\n${contextStr}` : '');

// Always use Free API format for @AI — the Pro endpoint doesn't support this call shape
// Ultra users with Pro preference get the Ultra API
const ultraPref2 = (() => { try { return localStorage.getItem('normsg_ultra_ai_model') || 'pro'; } catch { return 'pro'; } })();
const atAiApiUrl = (isUltraUser && ultraPref2 === 'pro') ? NORMAI_ULTRA_API : NORMAI_FREE_API;
const res = await fetch(atAiApiUrl, {
method:  'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ prompt: fullPrompt + `\n\nUser: ${prompt}`, max_tokens: NORMAI_MAX_TOKENS })
});

if (!res.ok) {
const err = await res.json().catch(() => ({}));
throw new Error(err?.error?.message || `HTTP ${res.status}`);
}

const data   = await res.json();
const answer = extractNormAIReply(data) || 'Sorry, I couldn\'t generate a response.';

await thinkRef.update({ type:'ai', text:answer, usedSuper: isSuper === true, timestamp: SV() });

} catch(e) {
await thinkRef.update({ type:'ai', text:`⚠ AI error: ${e.message}`, timestamp: SV() });
console.error('Groq error:', e);
}
}

// Render AI response text — fenced code, markdown (headers, tables), LaTeX via KaTeX
const _AI_MATH_PH = '\uE000';
const _AI_MATH_SL = '\uE001';

function normalizeCodeFenceContent(code) {
    if (code == null || code === '') return code;
    let s = String(code);
    // Always unescape literal \n/\t inside code fences.
    // Models should never write \n as literal text inside a code block.
    const litNl = (s.match(/\\n/g) || []).length;
    if (litNl === 0) return s;
    return s
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'");
}

function extractMathForAI(text) {
    const vault = [];
    let t = text;
    t = t.replace(/\\\[([\s\S]*?)\\\]/g, (_, body) => {
        vault.push('\\[' + body + '\\]');
        return _AI_MATH_PH + (vault.length - 1) + _AI_MATH_SL;
    });
    t = t.replace(/\\\(([\s\S]*?)\\\)/g, (_, body) => {
        vault.push('\\(' + body + '\\)');
        return _AI_MATH_PH + (vault.length - 1) + _AI_MATH_SL;
    });
    t = t.replace(/\$\$([\s\S]*?)\$\$/g, (_, body) => {
        vault.push('$$' + body + '$$');
        return _AI_MATH_PH + (vault.length - 1) + _AI_MATH_SL;
    });
    return { t, vault };
}

function restoreMathForAI(html, vault) {
    const re = new RegExp(_AI_MATH_PH + '(\\d+)' + _AI_MATH_SL, 'g');
    return html.replace(re, (_, i) => {
        const src = vault[parseInt(i, 10)];
        return src ? src.replace(/</g, '').replace(/>/g, '') : '';
    });
}

function isGFMTableSeparator(line) {
    const s = (line || '').trim();
    if (!s.includes('|')) return false;
    return /^[|\s:\-]+$/.test(s);
}

function splitTableCells(line) {
    let r = (line || '').trim();
    if (r.startsWith('|')) r = r.slice(1);
    if (r.endsWith('|')) r = r.slice(0, -1);
    return r.split('|').map(c => c.trim());
}

function applyInlineAIMarkdown(escLine) {
    let s = escLine;
    s = s.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/`([^`]+)`/g, '<span class="ai-inline-code">$1</span>');
    s = s.replace(/\*(.*?)\*/g, '<em>$1</em>');
    return s;
}

function renderGFMTable(rows) {
    if (rows.length < 2) return esc(rows.join('\n'));
    const headers = splitTableCells(rows[0]);
    const bodyLines = rows.slice(2);
    function cellMd(c) {
        let x = esc(c);
        x = x.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        x = x.replace(/`([^`]+)`/g, '<span class="ai-inline-code">$1</span>');
        x = x.replace(/\*(.*?)\*/g, '<em>$1</em>');
        return x;
    }
    let h = '<table class="ai-md-table"><thead><tr>';
    h += headers.map(c => `<th>${cellMd(c)}</th>`).join('');
    h += '</tr></thead><tbody>';
    for (const line of bodyLines) {
        if (!line.trim()) continue;
        const cells = splitTableCells(line);
        h += '<tr>' + cells.map(c => `<td>${cellMd(c)}</td>`).join('') + '</tr>';
    }
    h += '</tbody></table>';
    return h;
}

function renderPlainAISegment(raw) {
    if (raw === '' || raw == null) return '';
    const { t, vault } = extractMathForAI(raw);
    const lines = t.split('\n');
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (line === '') {
            blocks.push('<br>');
            i++;
            continue;
        }
        const hm = line.match(/^(#{1,3})\s+(.*)$/);
        if (hm) {
            const lev = hm[1].length;
            const tag = lev === 1 ? 'h2' : lev === 2 ? 'h3' : 'h4';
            blocks.push(`<${tag} class="ai-md-h">${esc(hm[2])}</${tag}>`);
            i++;
            continue;
        }
        const next = lines[i + 1];
        if (next !== undefined && line.includes('|') && isGFMTableSeparator(next)) {
            const tbl = [line, next];
            i += 2;
            while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
                tbl.push(lines[i]);
                i++;
            }
            blocks.push(renderGFMTable(tbl));
            continue;
        }
        blocks.push(applyInlineAIMarkdown(esc(line)));
        i++;
    }
    return restoreMathForAI(blocks.join('<br>'), vault);
}

const aiCodeMap = {};

function renderAIText(raw) {
    if (!raw) return '';
    let html = '';
    let codeId = 0;

    // Pre-normalize: if the response is heavily escaped (model emitted literal \n instead of
    // real newlines -- common with smaller models), fix the whole string upfront.
    // Fires when literal \n count > 10 and outnumbers real newlines 2:1.
    const totalLitNl  = (raw.match(/\\n/g)  || []).length;
    const totalRealNl = (raw.match(/\n/g)    || []).length;
    if (totalLitNl > 10 && totalLitNl > totalRealNl * 2) {
        raw = raw
            .replace(/\\r\\n/g, '\n')
            .replace(/\\n/g,      '\n')
            .replace(/\\r/g,      '\n')
            .replace(/\\t/g,      '\t');
    }

    const parts = raw.split(/```(\w*)\n?([\s\S]*?)```/g);
    for (let i = 0; i < parts.length; i++) {
        if (i % 3 === 0) {
            html += renderPlainAISegment(parts[i]);
        } else if (i % 3 === 1) {
            /* language label — consumed with code part */
        } else {
            const lang = parts[i - 1] || 'code';
            const code = normalizeCodeFenceContent(parts[i]);
            const id = `aicopy_${codeId++}`;
            aiCodeMap[id] = code;
            html += `<div class="ai-code-wrap">
    <div class="ai-code-bar">
        <span>${esc(lang)}</span>
        <button type="button" class="ai-copy-btn" id="${id}" onclick="copyAICode(this)">Copy</button>
    </div>
    <pre>${esc(code)}</pre>
</div>`;
        }
    }
    return `<div class="ai-md-root">${html}</div>`;
}

function typesetAIMathIn(root) {
    if (!root || typeof renderMathInElement !== 'function') return;
    try {
        renderMathInElement(root, {
            delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '\\[', right: '\\]', display: true },
                { left: '\\(', right: '\\)', display: false },
            ],
            ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option'],
            throwOnError: false,
            strict: 'ignore',
        });
    } catch (e) {
        console.warn('KaTeX render:', e);
    }
}

function copyAICode(btn) {
const code = aiCodeMap[btn.id] ?? '';
navigator.clipboard.writeText(code).then(() => {
btn.textContent = '✓ Copied!';
btn.classList.add('copied');
setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
}).catch(() => {
// Fallback for browsers without clipboard API
const ta = document.createElement('textarea');
ta.value = code; ta.style.position = 'fixed'; ta.style.opacity = '0';
document.body.appendChild(ta); ta.select();
document.execCommand('copy');
document.body.removeChild(ta);
btn.textContent = '✓ Copied!';
setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
});
}

