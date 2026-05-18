// ─ localStorage helpers ───────────────────────────────────
function aiChatsKey()      { return `normsg_aichats_${me?.uid}`; }
function aiMsgsKey(id)     { return `normsg_aichat_${me?.uid}_${id}`; }

function getAIChats() {
    try { return JSON.parse(localStorage.getItem(aiChatsKey()) || '[]'); } catch { return []; }
}
function saveAIChats(arr) {
    try { localStorage.setItem(aiChatsKey(), JSON.stringify(arr)); } catch {}
}
function getAIMsgs(id) {
    try { return JSON.parse(localStorage.getItem(aiMsgsKey(id)) || '[]'); } catch { return []; }
}
function saveAIMsgs(id, msgs) {
    try { localStorage.setItem(aiMsgsKey(id), JSON.stringify(msgs)); } catch {}
}

// ── Rate limit check ───────────────────────────────────────
function aiRpmForPlan() { return userPlan==='ultra' ? AI_ULTRA_RPM : userPlan==='pro' ? AI_PRO_RPM : AI_FREE_RPM; }

function checkAIChatRate(chatId) {
    const now = Date.now();
    if (!aiReqTs[chatId]) aiReqTs[chatId] = [];
    aiReqTs[chatId] = aiReqTs[chatId].filter(t => now - t < AI_RATE_WIN);
    const limit = aiRpmForPlan();
    if (aiReqTs[chatId].length >= limit) return false;
    aiReqTs[chatId].push(now);
    return true;
}
function aiReqsLeft(chatId) {
    const now = Date.now();
    const ts  = (aiReqTs[chatId] || []).filter(t => now - t < AI_RATE_WIN);
    const lim = aiRpmForPlan();
    return Math.max(0, lim - ts.length);
}

// ── Render chat list in sidebar ────────────────────────────
function renderAIChats() {
    if (!me) return;
    const el    = document.getElementById('aiChatList');
    const chats = getAIChats();
    const btn   = document.getElementById('aiNewBtn');
    if (btn) btn.disabled = chats.length >= AI_MAX_CHATS;

    if (!chats.length) {
        el.innerHTML = `<div class="ai-empty-state" style="padding-top:24px;">
            <div class="ai-empty-ico">✦</div>
            <div class="ai-empty-title">No AI chats yet</div>
            <div class="ai-empty-sub">Create one to start chatting<br>with NorMAI</div>
        </div>`;
        return;
    }
    el.innerHTML = '';
    chats.forEach(c => {
        const msgs    = getAIMsgs(c.id);
        const used    = msgs.filter(m => m.role === 'user' || m.role === 'image').length;
        const d = document.createElement('div');
        d.className = 'ai-chat-item' + (activeAIChatId === c.id ? ' on' : '');
        d.innerHTML = `
            <div class="ai-chat-icon">✦</div>
            <div class="ai-chat-info">
                <div class="ai-chat-title">${esc(c.title)}</div>
                <div class="ai-chat-meta">${used} message${used === 1 ? '' : 's'}</div>
            </div>
            <button class="ai-chat-del" title="Delete chat">🗑</button>`;
        d.querySelector('.ai-chat-del').onclick = e => deleteAIChat(c.id, e);
        d.onclick = () => openAIChat(c.id);
        el.appendChild(d);
    });
}

// ── Rate bar under New Chat button ─────────────────────────
function updateAIRateBar() {
    const bar = document.getElementById('aiRateBar');
    if (!bar || !activeAIChatId) { if (bar) bar.textContent = ''; return; }
    const rpm  = aiRpmForPlan();
    const left = aiReqsLeft(activeAIChatId);
    const msgs = getAIMsgs(activeAIChatId).filter(m => m.role === 'user' || m.role === 'image').length;
    // Show time until oldest request expires when rate limited
    let resetHint = '';
    if (left === 0) {
        const ts = (aiReqTs[activeAIChatId] || []).filter(t => Date.now() - t < AI_RATE_WIN);
        if (ts.length) {
            const secsLeft = Math.ceil((ts[0] + AI_RATE_WIN - Date.now()) / 1000);
            if (secsLeft > 0) resetHint = ` · resets in ${secsLeft}s`;
        }
    }
    bar.innerHTML = `<span>⚡ ${left}/${rpm} req/min${resetHint}</span><span>💬 ${msgs} sent in chat</span>`;
}

// Tick the rate bar every second so the "resets in Xs" countdown is live
setInterval(() => { if (activeAIChatId) updateAIRateBar(); }, 1000);

// ── Create a new AI chat ───────────────────────────────────
function createAIChat() {
    const chats = getAIChats();
    if (chats.length >= AI_MAX_CHATS) {
        showToast(`Max ${AI_MAX_CHATS} AI chats — delete one first! 🗑`);
        return;
    }
    const id    = 'ai_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
    const chat  = { id, title: 'New Chat', createdAt: Date.now() };
    chats.push(chat);
    saveAIChats(chats);
    renderAIChats();
    openAIChat(id);
}

// ── Delete an AI chat ──────────────────────────────────────
function deleteAIChat(chatId, e) {
    e.stopPropagation();
    const chats = getAIChats().filter(c => c.id !== chatId);
    saveAIChats(chats);
    try { localStorage.removeItem(aiMsgsKey(chatId)); } catch {}
    delete aiReqTs[chatId];
    if (activeAIChatId === chatId) {
        activeAIChatId = null;
        chatType = null;
        document.getElementById('emptyState').style.display = '';
        document.getElementById('activeChat').style.display = 'none';
    }
    renderAIChats();
    updateAIRateBar();
}

// ── Open an AI chat ────────────────────────────────────────
function openAIChat(chatId) {
    activeAIChatId = chatId;
    chatType   = 'ai';
    // Unsubscribe any active DM/group listener
    if (msgUnsub) { msgUnsub(); msgUnsub = null; }

    // Switch to chat panel
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('emptyState').classList.add('hidden');
    const ac = document.getElementById('activeChat');
    ac.classList.remove('hidden');
    ac.style.display = 'flex';

    const chats = getAIChats();
    const chat  = chats.find(c => c.id === chatId);

    // Patch header for AI mode
    document.getElementById('chatName').textContent = chat?.title || 'AI Chat';
    document.getElementById('chatSub').textContent  = userPlan === 'ultra'
        ? `NorMAI Ultra · ${AI_ULTRA_RPM} req/min`
        : userPlan === 'pro'
        ? `NorMAI Pro · ${AI_PRO_RPM} req/min`
        : `NorMAI · ${AI_FREE_RPM} req/min`;
    document.getElementById('renameChatBtn').classList.add('hidden');
    document.getElementById('leaveBtn').style.display = 'none';
    document.getElementById('timeoutBanner').classList.add('hidden');
    document.getElementById('pollBtn').style.display = 'none'; // no polls in AI chats
    document.getElementById('aiImgBtn').style.display = 'inline-flex'; // show AI image analysis button
    document.getElementById('regularImgBtn').style.display = 'none'; // hide regular image btn in AI
    document.getElementById('stickerBtn').style.display = 'none';
    document.getElementById('scheduleBtn').style.display = 'none';
    document.getElementById('normAIBtn').style.display = 'none';
    // Show model dropdown and populate it for current plan
    populateAIModelDropdown();
    document.getElementById('aiModelDropdownWrap').classList.add('visible');
    // Hide pinned banner in AI chats
    if (pinnedUnsub) { pinnedUnsub(); pinnedUnsub = null; }
    document.getElementById('pinnedBanner').classList.remove('on');

    // Render messages
    renderAIChatMessages(chatId);

    // Update sidebar highlight
    renderAIChats();
    updateAIRateBar();

    // Mobile: close sidebar
    document.getElementById('sidebar').classList.remove('open');

    // Focus input
    setTimeout(() => document.getElementById('msgInput')?.focus(), 80);
}

// ── Render messages in the chat panel ─────────────────────
function renderAIChatMessages(chatId) {
    const area  = document.getElementById('messagesArea');
    const msgs  = getAIMsgs(chatId);
    if (!msgs.length) {
        const planLabel = userPlan === 'ultra'
            ? `Ultra · ${AI_ULTRA_RPM} req/min`
            : userPlan === 'pro'
            ? `Pro · ${AI_PRO_RPM} req/min`
            : `Free · ${AI_FREE_RPM} req/min`;
        area.innerHTML = `<div class="ai-empty-state">
            <div class="ai-empty-ico">✦</div>
            <div class="ai-empty-title">Ask NorMAI anything</div>
            <div class="ai-empty-sub" style="max-width:240px;">${planLabel}<br><span style="opacity:0.7;font-size:11px;">📷 You can also send an image for analysis</span></div>
        </div>`;
        return;
    }
    area.innerHTML = msgs.map(m => {
        if (m.role === 'thinking') return `
            <div class="ai-msg-wrap ai-msg">
                <div class="ai-bubble" style="color:var(--muted);">
                    <span class="ai-thinking-dot">●</span>
                    <span class="ai-thinking-dot">●</span>
                    <span class="ai-thinking-dot">●</span>
                </div>
            </div>`;
        const isUser  = m.role === 'user' || m.role === 'image';
        const timeStr = m.ts ? new Date(m.ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
        let content;
        if (m.role === 'image') {
            content = `<div style="font-size:11px;color:var(--muted);margin-bottom:4px;">📷 Image sent for analysis</div>
                <img src="${esc(m.dataUrl)}" alt="uploaded" style="max-width:200px;max-height:160px;border-radius:10px;display:block;">
                ${m.caption ? `<div style="margin-top:4px;font-size:13px;">${esc(m.caption)}</div>` : ''}`;
        } else {
            content = isUser ? esc(m.text) : renderAIText(m.text);
        }
        return `<div class="ai-msg-wrap ${isUser ? 'user-msg' : 'ai-msg'}">
            <div class="ai-bubble">${content}</div>
            <div class="ai-msg-meta">${isUser ? 'You' : '✦ NorMAI'} · ${timeStr}</div>
        </div>`;
    }).join('');
    requestAnimationFrame(() => {
        typesetAIMathIn(area);
        area.scrollTop = area.scrollHeight;
    });
}

// ── Send a message in AI chat ──────────────────────────────
async function sendAIChatMsg() {
    if (!activeAIChatId) return;
    const inp  = document.getElementById('msgInput');
    const text = inp.value.trim();
    if (!text) return;

    // Check per-minute rate limit
    if (!checkAIChatRate(activeAIChatId)) {
        const rpm = aiRpmForPlan();
        const planName = userPlan === 'ultra' ? 'Ultra' : userPlan === 'pro' ? 'Pro' : 'Free';
        const ts  = (aiReqTs[activeAIChatId] || []).filter(t => Date.now() - t < AI_RATE_WIN);
        const secsLeft = ts.length ? Math.ceil((ts[0] + AI_RATE_WIN - Date.now()) / 1000) : 60;
        showToast(`Rate limit: ${rpm}/min for ${planName}. Try again in ${secsLeft}s ⏱`);
        return;
    }

    inp.value = '';
    autoGrow(inp);

    // Save user message
    const msgs = getAIMsgs(activeAIChatId);
    msgs.push({ role: 'user', text, ts: Date.now() });

    // Auto-title from first message
    const chats = getAIChats();
    const chat  = chats.find(c => c.id === activeAIChatId);
    if (chat && chat.title === 'New Chat') {
        chat.title = text.slice(0, 36) + (text.length > 36 ? '…' : '');
        saveAIChats(chats);
    }

    // Add thinking placeholder
    msgs.push({ role: 'thinking', ts: Date.now() });
    saveAIMsgs(activeAIChatId, msgs);
    renderAIChatMessages(activeAIChatId);
    updateAIRateBar();
    renderAIChats();

    // Build context from last 8 exchanges
    const history = msgs
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(-16)
        .map(m => `${m.role === 'user' ? 'User' : 'NorMAI'}: ${m.text}`)
        .join('\n');

    try {
        const isPro   = userPlan === 'pro' || userPlan === 'ultra';
        const isUltra = userPlan === 'ultra';
        const sysPrompt = `You are NorMAI, a smart and friendly AI assistant inside NorMSG. Be helpful, concise and clear. CRITICAL: always wrap ALL code in markdown fenced code blocks using triple backticks and a language tag (e.g. \`\`\`python). Never output code as plain text or with \\n escape sequences outside of a code block. Use real line breaks inside code fences, not JSON-style \\n sequences.${isUltra ? ' NorMULTRA mode — give the most detailed, thorough, expert-level answers.' : isPro ? ' Give thorough, detailed answers.' : ''}`;
        const fullPrompt = sysPrompt + (history ? `\n\nConversation so far:\n${history}\n\nUser: ${text}` : `\n\nUser: ${text}`);
        const answer = await callNormAI(fullPrompt, isPro ? history : '');

        // Replace thinking with assistant reply
        const updatedMsgs = getAIMsgs(activeAIChatId).filter(m => m.role !== 'thinking');
        updatedMsgs.push({ role: 'assistant', text: answer || '(No response — try again)', ts: Date.now() });
        saveAIMsgs(activeAIChatId, updatedMsgs);
    } catch(e) {
        const updatedMsgs = getAIMsgs(activeAIChatId).filter(m => m.role !== 'thinking');
        updatedMsgs.push({ role: 'assistant', text: `⚠ Error: ${e.message}`, ts: Date.now() });
        saveAIMsgs(activeAIChatId, updatedMsgs);
    }

    renderAIChatMessages(activeAIChatId);
    updateAIRateBar();
    renderAIChats();
}

// ── AI Chat Image Upload (Groq Vision) ──────────────────────
function triggerAIImageUpload() {
    if (!activeAIChatId) return showToast('Open an AI chat first.');
    document.getElementById('aiImgFileIn').click();
}

async function handleAIImageUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !file.type.startsWith('image/')) return showToast('Please select an image.');
    await handleAIImageFile(file);
}

async function handleAIImageFile(file) {
    if (file.size > 10 * 1024 * 1024) return showToast('Image too large — max 10 MB for AI analysis.');
    if (!activeAIChatId) return;

    if (!checkAIChatRate(activeAIChatId)) {
        showToast(`Rate limit reached. Please wait a moment ⏱`);
        return;
    }

    // Convert to base64
    const dataUrl = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload  = () => res(reader.result);
        reader.onerror = () => rej(new Error('Read failed'));
        reader.readAsDataURL(file);
    });
    const base64Data = dataUrl.split(',')[1];
    const mimeType   = file.type;

    // Get optional caption from current input
    const inp = document.getElementById('msgInput');
    const caption = inp.value.trim();
    inp.value = '';
    autoGrow(inp);

    // Save image message
    const msgs = getAIMsgs(activeAIChatId);
    msgs.push({ role: 'image', dataUrl, caption, ts: Date.now() });

    // Auto-title from first message
    const chats = getAIChats();
    const chat  = chats.find(c => c.id === activeAIChatId);
    if (chat && chat.title === 'New Chat') {
        chat.title = caption ? caption.slice(0, 36) + (caption.length > 36 ? '…' : '') : '📷 Image analysis';
        saveAIChats(chats);
    }

    // Add thinking placeholder
    msgs.push({ role: 'thinking', ts: Date.now() });
    saveAIMsgs(activeAIChatId, msgs);
    renderAIChatMessages(activeAIChatId);
    updateAIRateBar();
    renderAIChats();

    try {
        // Call Groq vision via the free API endpoint with vision flag
        // The backend should support: { vision: true, image: base64, mimeType, prompt }
        const userPrompt = caption || 'Describe this image in detail. What do you see?';
        const sysPrompt  = 'You are NorMAI, a smart and helpful AI inside NorMSG. Analyse the image and respond clearly and helpfully.';
        let answer;
        try {
            const res = await fetch(NORMAI_FREE_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    vision: true,
                    image:    base64Data,
                    mimeType: mimeType,
                    prompt:   sysPrompt + '\n\nUser: ' + userPrompt,
                    model:    'meta-llama/llama-4-scout-17b-16e-instruct'
                })
            });
            if (!res.ok) throw new Error(`API ${res.status}`);
            const data = await res.json();
            answer = extractNormAIReply(data);
        } catch (fetchErr) {
            // Fallback: if the free endpoint doesn't support vision yet, use a friendly message
            answer = `⚠ Vision analysis requires the backend to support vision requests. To enable this, update your Netlify/Deno function to forward \`vision:true\` requests to Groq using the \`meta-llama/llama-4-scout-17b-16e-instruct\` model with an image_url content block.`;
        }

        const updatedMsgs = getAIMsgs(activeAIChatId).filter(m => m.role !== 'thinking');
        updatedMsgs.push({ role: 'assistant', text: answer || '(No response — try again)', ts: Date.now() });
        saveAIMsgs(activeAIChatId, updatedMsgs);
    } catch(e) {
        const updatedMsgs = getAIMsgs(activeAIChatId).filter(m => m.role !== 'thinking');
        updatedMsgs.push({ role: 'assistant', text: `⚠ Vision error: ${e.message}`, ts: Date.now() });
        saveAIMsgs(activeAIChatId, updatedMsgs);
    }

    renderAIChatMessages(activeAIChatId);
    updateAIRateBar();
    renderAIChats();
}

// ── POLLS ───────────────────────────────────────────────────
function openPollModal() {
    if (chatType !== 'group') return;
    document.getElementById('pollQuestion').value = '';
    mmsg('pollMsg','','');
    // Reset to 2 blank options
    const el = document.getElementById('pollOptions');
    el.innerHTML = `
        <div class="poll-opt-row"><input class="m-input" placeholder="Option 1" maxlength="60"><button class="poll-rm-btn" onclick="removePollOpt(this)">✕</button></div>
        <div class="poll-opt-row"><input class="m-input" placeholder="Option 2" maxlength="60"><button class="poll-rm-btn" onclick="removePollOpt(this)">✕</button></div>`;
    document.getElementById('pollModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('pollQuestion').focus(), 80);
}

function addPollOption() {
    const el   = document.getElementById('pollOptions');
    const rows  = el.querySelectorAll('.poll-opt-row');
    if (rows.length >= 6) { mmsg('pollMsg','Max 6 options.','err'); return; }
    const idx  = rows.length + 1;
    const row  = document.createElement('div');
    row.className = 'poll-opt-row';
    row.innerHTML = `<input class="m-input" placeholder="Option ${idx}" maxlength="60"><button class="poll-rm-btn" onclick="removePollOpt(this)">✕</button>`;
    el.appendChild(row);
    row.querySelector('input').focus();
}

function removePollOpt(btn) {
    const el   = document.getElementById('pollOptions');
    const rows  = el.querySelectorAll('.poll-opt-row');
    if (rows.length <= 2) { mmsg('pollMsg','Need at least 2 options.','err'); return; }
    btn.closest('.poll-opt-row').remove();
}

async function createPoll() {
    const q = document.getElementById('pollQuestion').value.trim();
    if (!q) return mmsg('pollMsg','Enter a question.','err');

    const inputs  = [...document.querySelectorAll('#pollOptions .m-input')];
    const options = inputs.map(i => i.value.trim()).filter(Boolean);
    if (options.length < 2) return mmsg('pollMsg','Add at least 2 options.','err');

    const postBtn = document.querySelector('#pollModal .btn-add');
    if (postBtn) { postBtn.disabled = true; postBtn.textContent = 'Posting…'; }

    try {
        await awAdd('messages', {
            type:           'poll',
            question:       q,
            options:        awEncode(options),
            votes:          awEncode({}),
            senderUid:      me.uid,
            senderName:     me.displayName || me.email,
            senderUsername: myUsername,
            senderPhoto:    me.photoURL || null,
            timestamp:      awNow(),
            chatId,
            chatType:       'group',
        });

        await awUpdate('groups', chatId, {
            lastMsg:            '📊 Poll: ' + q.slice(0, 40),
            lastAt:             awNow(),
            lastSenderUid:      me.uid,
            lastSenderUsername: myUsername,
        }).catch(() => {});

        closeModal('pollModal');
    } catch(e) {
        mmsg('pollMsg', 'Failed to post poll: ' + (e.message || e), 'err');
        if (postBtn) { postBtn.disabled = false; postBtn.textContent = 'Post Poll ➤'; }
    }
}

async function votePoll(msgId, msgPath, optionIdx) {
    if (!msgId) return;
    try {
        const doc    = await awGet('messages', msgId);
        const votes  = awDecode(doc.votes) || {};
        if (votes[me.uid] === optionIdx) delete votes[me.uid];
        else votes[me.uid] = optionIdx;
        await awUpdate('messages', msgId, { votes: awEncode(votes) });
    } catch(e) { console.error('votePoll error:', e); }
}

// ── Init AI chats when user logs in ───────────────────────
function initAIChats() {
    if (currentSidebarTab === 'ai') renderAIChats();
}

// ═══════════════════════════════════════════════════════════
// ✦ NORMSTICKERS — photo upload
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// ✦ NORMSTICKERS — upload + save + reuse
// ═══════════════════════════════════════════════════════════
const STICKER_STORE_KEY = 'normsg_stickers_v1';

function getSavedStickers() {
  try { return JSON.parse(localStorage.getItem(STICKER_STORE_KEY) || '[]'); } catch { return []; }
}
function saveSticker(url) {
  const list = getSavedStickers();
  if (!list.includes(url)) {
    list.unshift(url); // newest first
    if (list.length > 40) list.length = 40; // cap at 40
    localStorage.setItem(STICKER_STORE_KEY, JSON.stringify(list));
  }
}

let stickerPickerOpen = false;

function toggleStickerPicker() {
  const el = document.getElementById('stickerPicker');
  stickerPickerOpen = !stickerPickerOpen;
  el.style.display = stickerPickerOpen ? 'block' : 'none';
  if (stickerPickerOpen) renderSavedStickers();
}

function renderSavedStickers() {
  const grid = document.getElementById('savedStickerGrid');
  const list = getSavedStickers();
  if (!list.length) {
    grid.innerHTML = '<div style="font-size:11px;color:var(--muted);grid-column:1/-1;padding:8px 0;text-align:center;">No stickers yet — upload one!</div>';
    return;
  }
  grid.innerHTML = list.map(url => `
    <div style="position:relative;cursor:pointer;border-radius:10px;overflow:hidden;aspect-ratio:1;background:var(--card);" onclick="sendSavedSticker('${url.replace(/'/g,"\\'")}')">
      <img src="${url}" style="width:100%;height:100%;object-fit:cover;" loading="lazy">
    </div>`).join('');
}

async function sendSavedSticker(url) {
  document.getElementById('stickerPicker').style.display = 'none';
  stickerPickerOpen = false;
  if (!chatId) return;
  if (!await checkSend('image','')) return;
  await pushMsg({ type: 'sticker', imageUrl: url, text: '' });
}

async function handleStickerUpload(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file || !chatId) return;
  if (!file.type.startsWith('image/')) return showToast('Please pick an image file.');
  if (file.size > 5*1024*1024) return showToast('Sticker must be under 5 MB.');
  if (!await checkSend('image','')) return;

  document.getElementById('upInd').classList.add('on');
  try {
    const { url } = await uploadToCloudinary(file);
    saveSticker(url); // save for reuse
    await pushMsg({ type: 'sticker', imageUrl: url, text: '' });
    showToast('🎭 Sticker saved to your collection!');
  } catch(e) {
    if (e?.name === 'AbortError') showToast('Upload cancelled.');
    else showToast('Sticker upload failed: ' + e.message);
  } finally {
    document.getElementById('upInd').classList.remove('on');
  }
}

// Close sticker picker when clicking outside
document.addEventListener('click', e => {
  if (stickerPickerOpen && !e.target.closest('#stickerPickerWrap')) {
    document.getElementById('stickerPicker').style.display = 'none';
    stickerPickerOpen = false;
  }
});

// ═══════════════════════════════════════════════════════════
// ✦ MESSAGE SCHEDULING
// ═══════════════════════════════════════════════════════════
const SCHED_KEY = 'normsg_sched_v2';
let schedPickerOpen = false;

function getScheduled() {
  try { return JSON.parse(localStorage.getItem(SCHED_KEY) || '[]'); } catch { return []; }
}
function saveScheduled(arr) {
  try { localStorage.setItem(SCHED_KEY, JSON.stringify(arr)); } catch {}
}

function toggleSchedulePicker() {
  schedPickerOpen = !schedPickerOpen;
  const el = document.getElementById('schedulePicker');
  el.classList.toggle('on', schedPickerOpen);
  if (schedPickerOpen) {
    // Default to 10 minutes from now
    const d = new Date(Date.now() + 10*60000);
    const local = new Date(d - d.getTimezoneOffset()*60000).toISOString().slice(0,16);
    document.getElementById('schDateTime').value = local;
    renderSchPending();
  }
}

function renderSchPending() {
  const list = document.getElementById('schPendingList');
  const all  = getScheduled().filter(s => s.chatId === chatId);
  if (!all.length) { list.innerHTML = '<span style="color:var(--muted);font-size:11px;">None</span>'; return; }
  list.innerHTML = all.map((s,i) => {
    const t = new Date(s.sendAt).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    return `<div class="sch-item">
      <span class="sch-item-text">${esc((s.text||'').slice(0,30)||'[message]')}</span>
      <span style="color:var(--muted);font-size:10px;white-space:nowrap;">${t}</span>
      <button class="sch-item-del" onclick="deleteScheduled(${s.id})">✕</button>
    </div>`;
  }).join('');
}

function deleteScheduled(id) {
  saveScheduled(getScheduled().filter(s => s.id !== id));
  renderSchPending();
}

function scheduleCurrentMsg() {
  const inp  = document.getElementById('msgInput');
  const text = inp.value.trim();
  if (!text) { showToast('Type a message first!'); return; }
  const dtVal = document.getElementById('schDateTime').value;
  if (!dtVal) { showToast('Pick a date & time.'); return; }
  const sendAt = new Date(dtVal).getTime();
  if (sendAt <= Date.now()) { showToast('Pick a time in the future.'); return; }

  const all = getScheduled();
  all.push({ id: Date.now(), chatId, chatType, text, sendAt,
    replyTo: replyTo ? {...replyTo} : null });
  saveScheduled(all);
  inp.value = ''; inp.style.height = '';
  clearReply();
  document.getElementById('schedulePicker').classList.remove('on');
  schedPickerOpen = false;
  showToast('⏱ Message scheduled!');
}

// Check scheduled messages every 15 seconds
setInterval(async () => {
  if (!me) return;
  const now  = Date.now();
  const all  = getScheduled();
  const due  = all.filter(s => s.sendAt <= now);
  const rest = all.filter(s => s.sendAt > now);
  if (!due.length) return;
  saveScheduled(rest);
  for (const s of due) {
    const savedChat = chatId, savedType = chatType;
    chatId = s.chatId; chatType = s.chatType;
    if (s.replyTo) replyTo = s.replyTo;
    await pushMsg({ type:'text', text: s.text, ...(s.replyTo ? { replyTo: s.replyTo } : {}) });
    chatId = savedChat; chatType = savedType; replyTo = null;
  }
  showToast(`⏱ ${due.length} scheduled message${due.length>1?'s':''} sent!`);
}, 15000);

// Close schedule picker on outside click
document.addEventListener('click', e => {
  if (schedPickerOpen && !e.target.closest('#schedulePickerWrap')) {
    document.getElementById('schedulePicker').classList.remove('on');
    schedPickerOpen = false;
  }
});

// ═══════════════════════════════════════════════════════════
// ✦ MESSAGE PINNING
// ═══════════════════════════════════════════════════════════
async function pinMessage(mid, pid, text) {
  if (!chatId) return;
  const col = chatType === 'dm' ? 'conversations' : 'groups';
  const doc = await awGet(col, chatId).catch(() => null);
  const cur = doc?.pinnedMsgId;
  if (cur === mid) { await unpinMessage(); return; }
  await awUpsert(col, chatId, {
    pinnedMsgId: mid, pinnedText: (text||'').slice(0,100),
  });
  showToast('📌 Message pinned!');
}

async function unpinMessage() {
  if (!chatId) return;
  const col = chatType === 'dm' ? 'conversations' : 'groups';
  await awUpdate(col, chatId, { pinnedMsgId: null, pinnedText: null });
  document.getElementById('pinnedBanner').classList.remove('on');
  showToast('📌 Unpinned.');
}

function showPinnedBanner(text, mid) {
  const b = document.getElementById('pinnedBanner');
  if (!text) { b.classList.remove('on'); return; }
  document.getElementById('pinnedText').textContent = '📌 ' + text;
  document.getElementById('pinUnpinBtn').onclick = unpinMessage;
  b.onclick = (e) => {
    if (e.target === document.getElementById('pinUnpinBtn')) return;
    const el = document.querySelector(`[data-mid="${mid}"]`);
    if (el) { el.scrollIntoView({ behavior:'smooth', block:'center' });
      el.style.transition = 'background 0.3s';
      el.style.background = 'rgba(124,92,252,0.18)';
      setTimeout(() => el.style.background = '', 1200); }
  };
  b.classList.add('on');
}

// Subscribe to pinned message for current chat
let pinnedUnsub = null;
function subscribePinned() {
  if (pinnedUnsub) { pinnedUnsub(); pinnedUnsub = null; }
  if (!chatId) return;
  const col = chatType === 'dm' ? 'conversations' : 'groups';
  // Load initial pinned state
  awGet(col, chatId).then(doc => {
    showPinnedBanner(doc?.pinnedText || '', doc?.pinnedMsgId || '');
  }).catch(() => showPinnedBanner('', ''));
  // Subscribe to live changes
  pinnedUnsub = awSubscribe([col], event => {
    const doc = event.payload;
    if (doc?.$id !== chatId) return;
    showPinnedBanner(doc.pinnedText || '', doc.pinnedMsgId || '');
  });
}

// ═══════════════════════════════════════════════════════════
// ✦ GROUP ROLES
// ═══════════════════════════════════════════════════════════
async function loadGroupRoles(groupId) {
  try {
    const doc = await awGet('groups', groupId);
    return awDecode(doc.customRoles) || [];
  } catch { return []; }
}

async function getMemberRole(groupId, uid) {
  try {
    const doc    = await awGet('groups', groupId);
    const roles  = awDecode(doc.customRoles) || [];
    const roleMap= awDecode(doc.memberRoles) || {};
    const rid    = roleMap[uid];
    return rid ? roles.find(r => r.id === rid) : null;
  } catch { return null; }
}

async function renderRolesSection(groupId) {
  const doc     = await awGet('groups', groupId);
  const gdata   = doc || {};
  const roles   = awDecode(gdata.customRoles) || [];
  const roleMap = awDecode(gdata.memberRoles) || {};
  const isOwner = gdata.createdBy === me.uid;
  const isAdmin = (awDecode(gdata.admins)||gdata.admins||[]).includes(me.uid) || isOwner;

  const list = document.getElementById('rolesList');
  if (!roles.length) {
    list.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:4px 0;">No custom roles yet.</div>';
  } else {
    list.innerHTML = roles.map(r => `
      <div class="role-row">
        <span class="role-color-dot" style="background:${r.color};"></span>
        <span style="flex:1;font-size:12px;">${esc(r.name)}</span>
        ${isAdmin ? `<button class="btn-sec" style="font-size:10px;padding:2px 8px;" onclick="openAssignRole('${r.id}','${esc(r.name)}','${r.color}')">Assign</button>` : ''}
        ${isOwner ? `<button style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:13px;" onclick="deleteGroupRole('${r.id}')">✕</button>` : ''}
      </div>`).join('');
  }
  document.getElementById('rolesAdminControls').style.display = isOwner ? 'flex' : 'none';
}

async function addGroupRole() {
  const name  = document.getElementById('newRoleName').value.trim();
  const color = document.getElementById('newRoleColor').value;
  if (!name) { mmsg('rolesMsg','Enter a role name.','err'); return; }
  const doc   = await awGet('groups', manageGroupId);
  const roles = awDecode(doc.customRoles) || [];
  if (roles.length >= 8) { mmsg('rolesMsg','Max 8 custom roles.','err'); return; }
  roles.push({ id: Date.now().toString(), name, color });
  await awUpdate('groups', manageGroupId, { customRoles: awEncode(roles) });
  document.getElementById('newRoleName').value = '';
  mmsg('rolesMsg','✓ Role added!','ok');
  renderRolesSection(manageGroupId);
}

async function deleteGroupRole(roleId) {
  const doc     = await awGet('groups', manageGroupId);
  const roles   = (awDecode(doc.customRoles)||[]).filter(r => r.id !== roleId);
  const roleMap = awDecode(doc.memberRoles) || {};
  Object.keys(roleMap).forEach(uid => { if (roleMap[uid] === roleId) delete roleMap[uid]; });
  await awUpdate('groups', manageGroupId, {
    customRoles: awEncode(roles),
    memberRoles: awEncode(roleMap),
  });
  renderRolesSection(manageGroupId);
}

function openAssignRole(roleId, roleName, roleColor) {
  awGet('groups', manageGroupId).then(async doc => {
    const members = doc.members || [];
    const profiles = {};
    if (members.length) {
      for (let i = 0; i < members.length; i += 100) {
        const chunk = members.slice(i, i + 100);
        const docs  = await awList('users', [Query.equal('$id', chunk), Query.limit(100)]);
        docs.forEach(d => { profiles[d.$id] = d.displayName || d.username || d.$id; });
      }
    }
    if (!confirm(`Assign role "${roleName}" — pick a member in the next step. OK to continue?`)) return;
    const uid = prompt(`Assign "${roleName}" to user UID or username:\n${members.map(u => profiles[u]||u).join(', ')}`);
    if (!uid) return;
    const match = members.find(u => u === uid || profiles[u] === uid);
    if (!match) { showToast('Member not found.'); return; }
    const roleMap = awDecode(doc.memberRoles) || {};
    roleMap[match] = roleId;
    await awUpdate('groups', manageGroupId, { memberRoles: awEncode(roleMap) });
    showToast(`✓ Role "${roleName}" assigned!`);
    renderRolesSection(manageGroupId);
  }).catch(e => showToast('Error: ' + e.message));
}

// AI suggest bar removed

// ═══════════════════════════════════════════════════════════
// ✦ APPEARANCE — compact mode, font size, accent colour, sounds
// ═══════════════════════════════════════════════════════════
const ACCENT_PRESETS = [
  { color: '#7c5cfc', sent: '#4338ca', name: 'Purple' },
  { color: '#3b82f6', sent: '#1d4ed8', name: 'Blue'   },
  { color: '#10b981', sent: '#059669', name: 'Green'  },
  { color: '#f43f5e', sent: '#be123c', name: 'Red'    },
  { color: '#f59e0b', sent: '#b45309', name: 'Amber'  },
  { color: '#ec4899', sent: '#be185d', name: 'Pink'   },
  { color: '#06b6d4', sent: '#0e7490', name: 'Cyan'   },
  { color: '#8b5cf6', sent: '#6d28d9', name: 'Violet' },
];

function buildAccentSwatches() {
  const wrap = document.getElementById('accentSwatches');
  if (!wrap) return;
  const cur = localStorage.getItem('normsg_accent') || '#7c5cfc';
  wrap.innerHTML = ACCENT_PRESETS.map(p =>
    `<div class="accent-swatch${p.color===cur?' active':''}" style="background:${p.color};"
      title="${p.name}" onclick="setAccent('${p.color}','${p.sent}')"></div>`
  ).join('');
}

function setAccent(color, sent) {
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--a2', color + 'cc');
  document.documentElement.style.setProperty('--sent', sent);
  localStorage.setItem('normsg_accent', color);
  localStorage.setItem('normsg_sent', sent);
  buildAccentSwatches();
}

function setFontSize(size) {
  document.documentElement.style.setProperty('--fs', size);
  localStorage.setItem('normsg_fs', size);
  ['fsSmall','fsNormal','fsLarge'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.background = '';
  });
  const map = { '13px':'fsSmall','14px':'fsNormal','16px':'fsLarge' };
  const active = document.getElementById(map[size]);
  if (active) active.style.background = 'rgba(124,92,252,0.2)';
}

function applyAppearance() {
  // Compact mode
  const compact = document.getElementById('settingCompact')?.checked;
  document.body.classList.toggle('compact', !!compact);
  try { localStorage.setItem('normsg_compact', compact ? '1' : '0'); } catch {}

  // Message sounds
  const sounds = document.getElementById('settingMsgSounds')?.checked;
  try { localStorage.setItem('normsg_msgsounds', sounds ? '1' : '0'); } catch {}
}

function loadAppearance() {
  // Accent
  const accent = localStorage.getItem('normsg_accent');
  const sent   = localStorage.getItem('normsg_sent');
  if (accent) { document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--a2', accent + 'cc'); }
  if (sent) document.documentElement.style.setProperty('--sent', sent);

  // Font size
  const fs = localStorage.getItem('normsg_fs');
  if (fs) setFontSize(fs);

  // Compact
  const compact = localStorage.getItem('normsg_compact') === '1';
  document.body.classList.toggle('compact', compact);
  const cb = document.getElementById('settingCompact');
  if (cb) cb.checked = compact;

  // Message sounds
  const msgsounds = localStorage.getItem('normsg_msgsounds') !== '0';
  const msb = document.getElementById('settingMsgSounds');
  if (msb) msb.checked = msgsounds;
}

