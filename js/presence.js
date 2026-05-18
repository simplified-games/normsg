// ── PRESENCE ───────────────────────────────────────────────
let presenceUnsubs = {};
let friendPresence = {}; // uid -> { online, lastSeen }
let presenceTimer  = null;

function setPresence(online) {
    if (!me) return;
    awUpdate('users', me.uid, {
        online:   online,
        lastSeen: awNow(),
    }).catch(() => {});
}

function subscribePresence() {
    if (document.hidden) return;

    // Initial load of all friends' presence
    const friendUids = friends.map(f => f.uid);
    if (friendUids.length) {
        awList('users', [Query.equal('$id', friendUids), Query.limit(200)])
            .then(docs => {
                docs.forEach(d => {
                    const ls      = d.lastSeen ? new Date(d.lastSeen) : new Date(0);
                    const isOnline = d.online === true && (Date.now() - ls) < 3 * 60000;
                    friendPresence[d.$id] = { online: isOnline, lastSeen: ls };
                });
                renderFriends();
            }).catch(() => {});
    }

    // Unsub from removed friends
    Object.keys(presenceUnsubs).forEach(uid => {
        if (!friends.find(f => f.uid === uid)) {
            if (presenceUnsubs[uid]) presenceUnsubs[uid]();
            delete presenceUnsubs[uid];
            delete friendPresence[uid];
        }
    });

    // Subscribe per friend to user doc changes
    friends.forEach(f => {
        if (presenceUnsubs[f.uid]) return;
        presenceUnsubs[f.uid] = awSubscribe(['users'], response => {
            const d = response.payload;
            if (!d || d.$id !== f.uid) return;
            const ls      = d.lastSeen ? new Date(d.lastSeen) : new Date(0);
            const isOnline = d.online === true && (Date.now() - ls) < 3 * 60000;
            friendPresence[f.uid] = { online: isOnline, lastSeen: ls };
            renderFriends();
            if (chatType === 'dm' && chatId === dmId(me.uid, f.uid)) {
                updateChatSubStatus(isOnline, ls);
            }
        });
    });
}

function pausePresenceSubscriptions() {
    Object.values(presenceUnsubs).forEach(u => u && u());
    presenceUnsubs = {};
}

function updateChatSubStatus(isOnline, lastSeen) {
    const el = document.getElementById('chatSub');
    if (!el || chatType !== 'dm') return;
    const friend = friends.find(f => dmId(me.uid, f.uid) === chatId);
    if (!friend) return;
    if (isOnline) {
        el.innerHTML = `<span class="ch-online">● Online</span>`;
    } else {
        const ago = timeAgo(lastSeen);
        el.textContent = ago ? `Last seen ${ago}` : `@${friend.username||''}`;
    }
}

function timeAgo(date) {
    if (!date || !(date instanceof Date) || isNaN(date) || date < new Date('2020-01-01')) return '';
    const s = Math.floor((Date.now() - date) / 1000);
    if (s < 60)    return 'just now';
    if (s < 3600)  return `${Math.floor(s/60)}m ago`;
    if (s < 86400) return `${Math.floor(s/3600)}h ago`;
    return date.toLocaleDateString();
}

// ── UNFRIEND ───────────────────────────────────────────────
async function unfriend(friendUid) {
    if (!confirm('Remove this friend? This will hide your DM conversation too.')) return;
    try {
        const [q1, q2] = await Promise.all([
            awList('friendrequests', [
                Query.equal('fromUid', me.uid),
                Query.equal('toUid', friendUid),
                Query.limit(1),
            ]),
            awList('friendrequests', [
                Query.equal('fromUid', friendUid),
                Query.equal('toUid', me.uid),
                Query.limit(1),
            ]),
        ]);
        await Promise.all([...q1, ...q2].map(d => awDelete('friendrequests', d.$id)));

        const cid    = dmId(me.uid, friendUid);
        const hidden = getHiddenDMs();
        hidden.add(cid);
        saveHiddenDMs(hidden);
        if (chatId === cid) closeChat();
        showToast('Friend removed.');
    } catch(e) {
        showToast('Could not remove friend: ' + e.message);
    }
}

// ── EMOJI SEARCH (: trigger) ───────────────────────────────
const ALL_EMOJI = [
    ['😀','grinning face'],['😁','grin beaming'],['😂','joy tears laugh'],['🤣','rofl rolling'],
    ['😊','smile blushing'],['😍','heart eyes love'],['🥰','hearts smiling'],['😎','cool sunglasses'],
    ['🤔','thinking'],['😅','sweat smile'],['😆','laughing'],['😭','crying sob'],['😢','cry sad'],
    ['😡','angry rage'],['🤯','mind blown exploding'],['😴','sleeping tired'],['🥲','smile tear'],
    ['🥳','party face celebrating'],['🤝','handshake'],['👋','wave hello'],['👍','thumbs up like'],
    ['👎','thumbs down dislike'],['❤️','heart love red'],['🧡','orange heart'],['💛','yellow heart'],
    ['💚','green heart'],['💙','blue heart'],['💜','purple heart'],['🖤','black heart'],
    ['💔','broken heart'],['🔥','fire hot'],['✨','sparkles stars'],['🎉','party celebration tada'],
    ['🎊','confetti celebration'],['🎶','music notes'],['🎵','musical note'],['🚀','rocket launch'],
    ['⭐','star'],['🌟','glowing star'],['💫','dizzy star'],['💯','100 percent perfect'],
    ['✅','check green yes'],['❌','cross no wrong'],['⚡','lightning bolt fast'],['💥','explosion boom'],
    ['💧','droplet water'],['🌊','wave ocean'],['🌈','rainbow'],['🌙','moon night'],['☀️','sun sunny'],
    ['⛅','partly cloudy'],['❄️','snowflake cold'],['🌸','cherry blossom'],['🍀','four leaf clover'],
    ['👀','eyes watching'],['👁️','eye'],['💀','skull dead'],['💪','muscle strong flex'],
    ['🙏','pray hands please thank'],['🫡','salute'],['🤞','fingers crossed luck'],
    ['👏','clapping hands applause'],['🤦','facepalm'],['🤷','shrug whatever'],['😤','triumph snort'],
    ['😏','smirk'],['🙄','eye roll'],['😬','grimacing'],['🤗','hugging'],['😇','angel halo'],
    ['🤩','star struck'],['🥺','pleading eyes'],['😳','flushed embarrassed'],['😱','scream shocked'],
    ['🍕','pizza'],['🍔','burger'],['🍣','sushi'],['🧁','cupcake'],['🎂','birthday cake'],
    ['☕','coffee'],['🧋','bubble tea boba'],['🍵','tea'],['🍺','beer'],['🥤','drink cup'],
    ['🐶','dog puppy'],['🐱','cat kitten'],['🐸','frog'],['🦆','duck'],['🐧','penguin'],
    ['🦊','fox'],['🐻','bear'],['🦁','lion'],['🐼','panda'],['🐨','koala'],
    ['🥀','withered rose dead flower'],['🌹','rose flower'],['🌺','hibiscus flower'],['🌻','sunflower'],['🌷','tulip flower'],
];

let colonStart    = -1;
let esearchActive = false;

function checkColonTrigger(inp) {
    const val    = inp.value;
    const pos    = inp.selectionStart;
    const before = val.slice(0, pos);
    const cIdx   = before.lastIndexOf(':');
    const box    = document.getElementById('emojiSearchBox');

    if (cIdx !== -1) {
        const afterColon = before.slice(cIdx + 1);
        if (!afterColon.includes(' ') && afterColon.length > 0) {
            colonStart    = cIdx;
            esearchActive = true;
            const q = afterColon.toLowerCase();
            document.getElementById('esearchIn').value = q;
            searchEmoji(q);
            box.style.display = 'block';
            return;
        }
    }
    colonStart    = -1;
    esearchActive = false;
    box.style.display = 'none';
}

function searchEmoji(q) {
    const res     = document.getElementById('esearchResults');
    const matches = q
        ? ALL_EMOJI.filter(([, name]) => name.includes(q.toLowerCase())).slice(0, 36)
        : ALL_EMOJI.slice(0, 36);

    res.innerHTML = '';
    if (!matches.length) {
        res.innerHTML = `<span style="font-size:11px;color:var(--muted);padding:4px;">No match</span>`;
        return;
    }
    matches.forEach(([em]) => {
        const sp = ce('span');
        sp.className   = 'esearch-item';
        sp.textContent = em;
        sp.title       = em;
        sp.onmousedown = (e) => { e.preventDefault(); insertEmoji(em); };
        res.appendChild(sp);
    });
}

function insertEmoji(em) {
    const inp = document.getElementById('msgInput');
    const val = inp.value;
    const pos = inp.selectionStart;
    inp.value = val.slice(0, colonStart) + em + val.slice(pos);
    const np  = colonStart + [...em].length + 1;
    inp.setSelectionRange(np, np);
    document.getElementById('emojiSearchBox').style.display = 'none';
    colonStart = -1; esearchActive = false;
    inp.focus();
    autoGrow(inp);
}

function onEsearchKey(e) {
    if (e.key === 'Escape') {
        document.getElementById('emojiSearchBox').style.display = 'none';
        esearchActive = false;
        document.getElementById('msgInput').focus();
    }
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('#emojiSearchBox') && !e.target.closest('#msgInput')) {
        const box = document.getElementById('emojiSearchBox');
        if (box) { box.style.display = 'none'; esearchActive = false; colonStart = -1; }
    }
});
