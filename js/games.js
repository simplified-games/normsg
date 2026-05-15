// ── Send / receive tones ──────────────────────────────────
function playMsgSound(type = 'receive') {
  const msgsounds = localStorage.getItem('normsg_msgsounds');
  if (msgsounds === '0') return;
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    if (type === 'send') {
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1100, ctx.currentTime + 0.06);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.start(); osc.stop(ctx.currentTime + 0.12);
    } else {
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
      osc.start(); osc.stop(ctx.currentTime + 0.14);
    }
  } catch {}
}


// ══════════════════════════════════════════════════════════════
// ── NORMGAMES ─────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

let activeGame = null;

function openGame(game) {
    activeGame = game;
    const overlay = document.getElementById('gameOverlay');
    overlay.style.display = 'flex';
    const titles = { ttt:'Tic-Tac-Toe', chess:'Chess', wordle:'Wordle' };
    document.getElementById('gameTitle').textContent = titles[game] || game;
    if (game === 'ttt')    renderTTTModeSelect();
    if (game === 'chess')  renderChessModeSelect();
    if (game === 'wordle') initWordle();
}

function closeGame() {
    document.getElementById('gameOverlay').style.display = 'none';
    document.getElementById('gameContent').innerHTML = '';
    activeGame = null;
    if (chessAITimer) { clearTimeout(chessAITimer); chessAITimer = null; }
}

// ── Shared helpers ────────────────────────────────────────────
function gc() { return document.getElementById('gameContent'); }

// ══════════════════════════════════════════════════════════════
// TIC-TAC-TOE
// ══════════════════════════════════════════════════════════════
let tttBoard, tttTurn, tttMode, tttDone, tttSize;

function renderTTTModeSelect() {
    gc().innerHTML = `
        <div style="margin-bottom:10px;color:var(--muted);font-size:12px;text-align:center;">Choose board size</div>
        <div style="display:flex;gap:8px;margin-bottom:14px;">
            <button id="tttSz3" class="game-mode-btn${(!tttSize||tttSize===3)?' sel':''}" style="flex:1;padding:9px 4px;font-size:13px;margin:0;" onclick="tttSetSize(3)">3×3</button>
            <button id="tttSz4" class="game-mode-btn${tttSize===4?' sel':''}" style="flex:1;padding:9px 4px;font-size:13px;margin:0;" onclick="tttSetSize(4)">4×4</button>
            <button id="tttSz5" class="game-mode-btn${tttSize===5?' sel':''}" style="flex:1;padding:9px 4px;font-size:13px;margin:0;" onclick="tttSetSize(5)">5×5</button>
        </div>
        <div style="margin-bottom:6px;color:var(--muted);font-size:12px;text-align:center;">Choose mode</div>
        <button class="game-mode-btn" onclick="startTTT('pvp')">👤 vs Player (local)</button>
        <button class="game-mode-btn" onclick="startTTT('ai')">🤖 vs AI</button>
        <button class="game-mode-btn" onclick="startTTTOnline()">🌐 Online — Host game</button>
        <button class="game-mode-btn" onclick="joinTTTOnline()">🔗 Online — Join with code</button>`;
    if (!tttSize) tttSize = 3;
}

function tttSetSize(n) {
    tttSize = n;
    renderTTTModeSelect();
}

function startTTT(mode) {
    const sz = tttSize || 3;
    tttBoard = Array(sz*sz).fill('');
    tttTurn  = 'X';
    tttMode  = mode;
    tttDone  = false;
    ntAward(NT_EARN_PLAY, 'game started'); // NormTokens
    renderTTT();
}

function tttGetWins(sz) {
    const wins = [];
    // Rows
    for (let r=0; r<sz; r++) { const row=[]; for(let c=0;c<sz;c++) row.push(r*sz+c); wins.push(row); }
    // Cols
    for (let c=0; c<sz; c++) { const col=[]; for(let r=0;r<sz;r++) col.push(r*sz+c); wins.push(col); }
    // Diags
    const d1=[], d2=[];
    for (let i=0;i<sz;i++) { d1.push(i*sz+i); d2.push(i*sz+(sz-1-i)); }
    wins.push(d1); wins.push(d2);
    return wins;
}

function renderTTT() {
    const sz   = tttSize || 3;
    const wins = tttGetWins(sz);
    const winLine = wins.find(l => tttBoard[l[0]] && l.every(i => tttBoard[i]===tttBoard[l[0]]));
    const winner  = winLine ? tttBoard[winLine[0]] : null;
    const draw    = !winner && tttBoard.every(c => c);
    const aiTurn  = tttMode === 'ai' && tttTurn === 'O' && !winner && !draw;
    let status = '';
    if (winner)      status = `${winner==='X'?'❌':'⭕'} ${winner} wins!`;
    else if (draw)   status = '🤝 Draw!';
    else if (aiTurn) status = '🤖 AI is thinking…';
    else             status = `${tttTurn==='X'?'❌':'⭕'} ${tttTurn}'s turn`;

    // Shrink emoji for bigger grids
    const emojiSize = sz===3 ? '36px' : sz===4 ? '26px' : '20px';

    gc().innerHTML = `
        <div style="text-align:center;margin-bottom:6px;">
            <button class="game-mode-btn" style="display:inline-flex;width:auto;padding:7px 18px;font-size:12px;margin:0;" onclick="renderTTTModeSelect()">← Change mode</button>
        </div>
        <div class="game-status">${status}</div>
        <div class="ttt-board" id="tttBoard" style="grid-template-columns:repeat(${sz},1fr);"></div>
        ${(winner||draw) ? `<button class="game-mode-btn" style="max-width:200px;margin:10px auto;" onclick="startTTT('${tttMode}')">▶ Play again</button>` : ''}`;

    const board = document.getElementById('tttBoard');
    tttBoard.forEach((cell, i) => {
        const sq = document.createElement('div');
        sq.className = 'ttt-cell' + (cell?' taken':'') + (winLine&&winLine.includes(i)?' win':'');
        sq.style.fontSize = emojiSize;
        sq.textContent = cell==='X' ? '❌' : cell==='O' ? '⭕' : '';
        sq.onclick = () => tttClick(i);
        board.appendChild(sq);
    });

    if (aiTurn) setTimeout(tttAIMove, 400);
}

function tttClick(i) {
    if (tttDone || tttBoard[i]) return;
    if (tttMode === 'ai' && tttTurn === 'O') return;
    tttBoard[i] = tttTurn;
    const sz  = tttSize || 3;
    const wins = tttGetWins(sz);
    const won  = wins.some(l => tttBoard[l[0]] && l.every(i => tttBoard[i]===tttBoard[l[0]]));
    const draw = !won && tttBoard.every(c => c);
    if (won) ntAward(NT_EARN_WIN, 'TTT win! 🏆'); // NormTokens
    if (won || draw) tttDone = true;
    else tttTurn = tttTurn==='X' ? 'O' : 'X';
    renderTTT();
}

function tttAIMove() {
    const sz = tttSize || 3;
    if (sz === 3) {
        const best = tttMinimax3(tttBoard, 'O');
        tttBoard[best.idx] = 'O';
    } else {
        // For 4×4 / 5×5 use heuristic (minimax too slow)
        tttBoard[tttHeuristic(tttBoard, sz)] = 'O';
    }
    const wins = tttGetWins(sz);
    const won  = wins.some(l => tttBoard[l[0]] && l.every(i => tttBoard[i]===tttBoard[l[0]]));
    const draw = !won && tttBoard.every(c => c);
    if (won || draw) tttDone = true;
    else tttTurn = 'X';
    renderTTT();
}

function tttMinimax3(board, player) {
    const wins = tttGetWins(3);
    const check = p => wins.some(l => l.every(i => board[i]===p));
    if (check('O')) return { score: 10 };
    if (check('X')) return { score: -10 };
    const empty = board.map((v,i)=>v?-1:i).filter(i=>i>=0);
    if (!empty.length) return { score: 0 };
    const moves = empty.map(i => {
        const b = [...board]; b[i] = player;
        const s = tttMinimax3(b, player==='O'?'X':'O').score;
        return { idx: i, score: s };
    });
    return moves.reduce((a,b) => player==='O' ? (b.score>a.score?b:a) : (b.score<a.score?b:a));
}

function tttHeuristic(board, sz) {
    const wins = tttGetWins(sz);
    const score = (player, b) => {
        let s = 0;
        wins.forEach(line => {
            const mine = line.filter(i=>b[i]===player).length;
            const opp  = line.filter(i=>b[i]===(player==='O'?'X':'O')).length;
            if (opp===0) s += Math.pow(10, mine);
            if (mine===0) s -= Math.pow(10, opp);
        });
        return s;
    };
    const empty = board.map((v,i)=>v?-1:i).filter(i=>i>=0);
    // Block winning move first
    for (const i of empty) {
        const b=[...board]; b[i]='X';
        if (tttGetWins(sz).some(l=>l.every(j=>b[j]==='X'))) return i;
    }
    // Pick best heuristic
    return empty.reduce((best, i) => {
        const b=[...board]; b[i]='O';
        return score('O',b) > score('O',[...board].map((v,j)=>j===best?'O':v)) ? i : best;
    }, empty[0]);
}

// ── TTT Online ──────────────────────────────────────────────
let tttOnlineUnsub = null, tttOnlineGameId = null, tttOnlineMySymbol = null;

async function startTTTOnline() {
    if (!me) { showToast('Sign in to play online!'); return; }
    const sz   = tttSize || 3;
    const code = Math.random().toString(36).slice(2,8).toUpperCase();
    gc().innerHTML = `<div class="game-status">Creating game…</div>`;
    try {
        const gameRef = await db.collection('normgames').add({
            type: 'ttt', size: sz, code,
            board: Array(sz*sz).fill(''),
            turn: 'X', status: 'waiting',
            players: { X: me.uid },
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        tttOnlineGameId   = gameRef.id;
        tttOnlineMySymbol = 'X';
        gc().innerHTML = `
            <div class="game-status">Waiting for opponent…</div>
            <div style="background:var(--panel);border:1px solid var(--border2);border-radius:12px;padding:18px;text-align:center;margin-top:10px;">
                <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">Share this code with a friend:</div>
                <div style="font-size:32px;font-weight:800;color:var(--a2);letter-spacing:7px;font-family:monospace;">${code}</div>
                <button class="game-mode-btn" style="margin:12px auto 0;max-width:180px;display:block;" onclick="navigator.clipboard.writeText('${code}');showToast('✅ Code copied!')">📋 Copy code</button>
            </div>
            <button class="game-mode-btn" style="margin-top:10px;" onclick="cancelTTTOnline()">✕ Cancel</button>`;
        subscribeTTTOnline(gameRef.id);
    } catch(e) {
        showToast('Could not create game: ' + (e.message || e.code));
        renderTTTModeSelect();
    }
}

async function joinTTTOnline() {
    if (!me) { showToast('Sign in to play online!'); return; }
    const code = prompt('Enter 6-letter invite code:');
    if (!code) return;
    gc().innerHTML = `<div class="game-status">Finding game…</div>`;
    try {
        const snap = await db.collection('normgames')
            .where('code', '==', code.trim().toUpperCase())
            .where('type', '==', 'ttt')
            .limit(1).get();
        if (snap.empty) { showToast('Game not found! Check the code.'); renderTTTModeSelect(); return; }
        const doc = snap.docs[0];
        if (doc.data().status !== 'waiting') { showToast('Game already started!'); renderTTTModeSelect(); return; }
        await doc.ref.update({ 'players.O': me.uid, status: 'playing' });
        tttOnlineGameId   = doc.id;
        tttOnlineMySymbol = 'O';
        tttSize = doc.data().size || 3;
        subscribeTTTOnline(doc.id);
    } catch(e) {
        showToast('Could not join game: ' + (e.message || e.code));
        renderTTTModeSelect();
    }
}

function subscribeTTTOnline(gameId) {
    if (tttOnlineUnsub) tttOnlineUnsub();
    tttOnlineUnsub = db.collection('normgames').doc(gameId).onSnapshot(snap => {
        const data = snap.data(); if (!data) return;
        tttSize  = data.size || 3;
        tttBoard = data.board;
        tttTurn  = data.turn;
        tttMode  = 'online';
        tttDone  = data.status === 'done';
        // Override render for online
        renderTTTOnline(data);
    });
}

function renderTTTOnline(data) {
    const sz   = data.size || 3;
    const wins = tttGetWins(sz);
    const winLine = wins.find(l => data.board[l[0]] && l.every(i=>data.board[i]===data.board[l[0]]));
    const winner  = winLine ? data.board[winLine[0]] : null;
    const draw    = !winner && data.board.every(c=>c);
    const myTurn  = data.turn === tttOnlineMySymbol && !winner && !draw;
    const emojiSize = sz===3?'36px':sz===4?'26px':'20px';
    let status = '';
    if (data.status==='waiting') status = 'Waiting for opponent…';
    else if (winner) status = winner===tttOnlineMySymbol ? '🎉 You win!' : '😢 You lose!';
    else if (draw)   status = '🤝 Draw!';
    else             status = myTurn ? '✅ Your turn!' : "⏳ Opponent's turn…";

    const waitingCodeHTML = (data.status==='waiting' && tttOnlineMySymbol==='X' && data.code) ? `
        <div style="background:var(--panel);border:1px solid var(--border2);border-radius:12px;padding:18px;text-align:center;margin-top:10px;">
            <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">Share this code with a friend:</div>
            <div style="font-size:32px;font-weight:800;color:var(--a2);letter-spacing:7px;font-family:monospace;">${data.code}</div>
            <button class="game-mode-btn" style="margin:12px auto 0;max-width:180px;display:block;" onclick="navigator.clipboard.writeText('${data.code}');showToast('✅ Code copied!')">📋 Copy code</button>
        </div>
        <button class="game-mode-btn" style="margin-top:10px;" onclick="cancelTTTOnline()">✕ Cancel</button>` : '';

    gc().innerHTML = `
        <div style="text-align:center;margin-bottom:4px;font-size:11px;color:var(--muted);">You are <b>${tttOnlineMySymbol==='X'?'❌':'⭕'} ${tttOnlineMySymbol}</b></div>
        <div class="game-status">${status}</div>
        ${waitingCodeHTML}
        <div class="ttt-board" id="tttBoard" style="grid-template-columns:repeat(${sz},1fr);${data.status==='waiting'?'display:none;':''}"></div>
        ${(winner||draw) ? `<button class="game-mode-btn" style="max-width:200px;margin:10px auto;" onclick="cancelTTTOnline()">← Back</button>` : ''}` ;

    const board = document.getElementById('tttBoard');
    data.board.forEach((cell, i) => {
        const sq = document.createElement('div');
        sq.className = 'ttt-cell'+(cell?' taken':'')+(winLine&&winLine.includes(i)?' win':'');
        sq.style.fontSize = emojiSize;
        sq.textContent = cell==='X'?'❌':cell==='O'?'⭕':'';
        sq.onclick = () => { if (myTurn && !cell) tttClickOnline(i, sz, data); };
        board.appendChild(sq);
    });
}

async function tttClickOnline(i, sz, data) {
    const newBoard = [...data.board]; newBoard[i] = tttOnlineMySymbol;
    const wins = tttGetWins(sz);
    const won  = wins.some(l=>newBoard[l[0]]&&l.every(j=>newBoard[j]===newBoard[l[0]]));
    const draw = !won && newBoard.every(c=>c);
    await db.collection('normgames').doc(tttOnlineGameId).update({
        board: newBoard, turn: tttOnlineMySymbol==='X'?'O':'X',
        status: (won||draw)?'done':'playing'
    });
}

function cancelTTTOnline() {
    if (tttOnlineUnsub) { tttOnlineUnsub(); tttOnlineUnsub=null; }
    if (tttOnlineGameId) { db.collection('normgames').doc(tttOnlineGameId).delete().catch(()=>{}); tttOnlineGameId=null; }
    renderTTTModeSelect();
}


// ══════════════════════════════════════════════════════════════
// CHESS
// ══════════════════════════════════════════════════════════════
let chessBoard, chessMode, chessTurn, chessSelected, chessValidMoves, chessLastMove, chessAITimer, chessGameOver;
let chessSkillLevel = 5, sfWorker = null;

const CHESS_PIECES = {
    'wK':'♔','wQ':'♕','wR':'♖','wB':'♗','wN':'♘','wP':'♙',
    'bK':'♚','bQ':'♛','bR':'♜','bB':'♝','bN':'♞','bP':'♟'
};

function initChessBoard() {
    const back = ['R','N','B','Q','K','B','N','R'];
    const b = [];
    for (let r=0; r<8; r++) {
        b.push([]);
        for (let c=0; c<8; c++) {
            if (r===0) b[r].push('b'+back[c]);
            else if (r===1) b[r].push('bP');
            else if (r===6) b[r].push('wP');
            else if (r===7) b[r].push('w'+back[c]);
            else b[r].push(null);
        }
    }
    return b;
}

function renderChessModeSelect() {
    gc().innerHTML = `
        <div style="margin-bottom:6px;color:var(--muted);font-size:12px;text-align:center;">Choose mode</div>
        <button class="game-mode-btn" onclick="startChess('pvp')">👤 vs Player (local)</button>
        <button class="game-mode-btn" onclick="startChessAISelect()">🤖 vs AI (you play White)</button>
        <button class="game-mode-btn" onclick="startChessOnline('host')">🌐 Online — Host game</button>
        <button class="game-mode-btn" onclick="startChessOnline('join')">🔗 Online — Join with code</button>`;
}

function startChess(mode) {
    ntAward(NT_EARN_PLAY, 'game started'); // NormTokens
    chessBoard     = initChessBoard();
    chessMode      = mode;
    chessTurn      = 'w';
    chessSelected  = null;
    chessValidMoves= [];
    chessLastMove  = null;
    chessGameOver  = false;
    if (chessAITimer) clearTimeout(chessAITimer);
    renderChess();
}

function renderChess() {
    const isAIThinking = chessMode === 'ai' && chessTurn === 'b' && !chessGameOver;
    const turnLabel = chessGameOver ? '' : (chessTurn === 'w' ? '⬜ White' : '⬛ Black') + (chessMode==='ai' && chessTurn==='b' ? ' (AI)' : '') + "'s turn";

    // Captured pieces display
    const allPieces = ['wQ','wR','wR','wB','wB','wN','wN','wP','wP','wP','wP','wP','wP','wP','wP',
                       'bQ','bR','bR','bB','bB','bN','bN','bP','bP','bP','bP','bP','bP','bP','bP'];
    const onBoard = chessBoard.flat().filter(Boolean);
    const captured = [...allPieces];
    onBoard.forEach(p => { const idx = captured.indexOf(p); if (idx !== -1) captured.splice(idx,1); });
    const wCap = captured.filter(p=>p[0]==='w').map(p=>CHESS_PIECES[p]).join('');
    const bCap = captured.filter(p=>p[0]==='b').map(p=>CHESS_PIECES[p]).join('');

    gc().innerHTML = `
        <div style="text-align:center;margin-bottom:6px;">
            <button class="game-mode-btn" style="display:inline-flex;width:auto;padding:7px 18px;font-size:12px;margin:0;" onclick="renderChessModeSelect()">← Change mode</button>
        </div>
        <div class="chess-wrap">
            <div class="chess-taken">${bCap || '&nbsp;'}</div>
            <div class="game-status" id="chessStatus">${turnLabel}</div>
            <div class="chess-board" id="chessBoard"></div>
            <div class="chess-labels"><span class="chess-label">a</span><span class="chess-label">b</span><span class="chess-label">c</span><span class="chess-label">d</span><span class="chess-label">e</span><span class="chess-label">f</span><span class="chess-label">g</span><span class="chess-label">h</span></div>
            <div class="chess-taken">${wCap || '&nbsp;'}</div>
            ${chessGameOver ? `<button class="game-mode-btn" style="max-width:200px;margin:4px auto;" onclick="startChess('${chessMode}')">▶ Play again</button>` : ''}
        </div>`;

    const boardEl = document.getElementById('chessBoard');
    const inCheck = chessKingInCheck(chessBoard, chessTurn);
    const kingPos = findKing(chessBoard, chessTurn);

    for (let r=0; r<8; r++) {
        for (let c=0; c<8; c++) {
            const sq = document.createElement('div');
            const isLight = (r+c)%2===0;
            let cls = 'chess-sq ' + (isLight ? 'light' : 'dark');
            if (chessSelected && chessSelected[0]===r && chessSelected[1]===c) cls += ' sel';
            else if (chessValidMoves.some(m=>m[0]===r&&m[1]===c)) cls += ' hint';
            else if (chessLastMove && ((chessLastMove[0]===r&&chessLastMove[1]===c)||(chessLastMove[2]===r&&chessLastMove[3]===c))) cls += ' last';
            if (inCheck && kingPos && kingPos[0]===r && kingPos[1]===c) cls += ' check';
            sq.className = cls;
            const piece = chessBoard[r][c];
            sq.textContent = piece ? CHESS_PIECES[piece] : '';
            sq.onclick = () => chessClick(r, c);
            boardEl.appendChild(sq);
        }
    }

    if (isAIThinking && !chessGameOver) {
        chessAITimer = setTimeout(chessDoAI, 300);
    }
}

function chessClick(r, c) {
    if (chessGameOver) return;
    if (chessMode === 'ai' && chessTurn === 'b') return;
    const piece = chessBoard[r][c];

    if (chessSelected) {
        const isMove = chessValidMoves.some(m=>m[0]===r&&m[1]===c);
        if (isMove) {
            chessApplyMove(chessSelected[0], chessSelected[1], r, c);
            return;
        }
    }

    if (piece && piece[0] === chessTurn) {
        chessSelected   = [r, c];
        chessValidMoves = chessGetValidMoves(chessBoard, r, c, chessTurn);
    } else {
        chessSelected   = null;
        chessValidMoves = [];
    }
    renderChess();
}

function chessApplyMove(fr, fc, tr, tc, board) {
    const b = board || chessBoard;
    const piece = b[fr][fc];
    const newBoard = b.map(row=>[...row]);
    // Pawn promotion
    if (piece === 'wP' && tr === 0) newBoard[tr][tc] = 'wQ';
    else if (piece === 'bP' && tr === 7) newBoard[tr][tc] = 'bQ';
    else newBoard[tr][tc] = piece;
    newBoard[fr][fc] = null;
    if (board) return newBoard;
    chessBoard    = newBoard;
    chessLastMove = [fr, fc, tr, tc];
    chessSelected  = null;
    chessValidMoves = [];
    // Check for checkmate/stalemate
    const nextTurn = chessTurn === 'w' ? 'b' : 'w';
    chessTurn = nextTurn;
    const allMoves = chessAllMoves(chessBoard, nextTurn);
    if (!allMoves.length) {
        const inCheck = chessKingInCheck(chessBoard, nextTurn);
        const statusEl = document.getElementById('chessStatus');
        chessGameOver = true;
        if (inCheck) {
            const winner = nextTurn === 'w' ? 'Black' : 'White';
            if (statusEl) statusEl.textContent = `♟ Checkmate! ${winner} wins!`;
            // NormTokens: award win only if human won (in AI mode white wins = player wins)
            if (chessMode !== 'online' && nextTurn === 'b') ntAward(NT_EARN_WIN, 'Chess win! 🏆');
            else if (chessMode === 'local') ntAward(NT_EARN_WIN, 'Chess win! 🏆');
        } else {
            if (statusEl) statusEl.textContent = '🤝 Stalemate! Draw.';
        }
    }
    renderChess();
}

function chessGetValidMoves(board, r, c, color) {
    const piece = board[r][c];
    if (!piece || piece[0] !== color) return [];
    const raw = chessRawMoves(board, r, c);
    // Filter moves that leave own king in check
    return raw.filter(([tr, tc]) => {
        const nb = chessApplyMove(r, c, tr, tc, board);
        return !chessKingInCheck(nb, color);
    });
}

function chessRawMoves(board, r, c) {
    const piece = board[r][c]; if (!piece) return [];
    const color = piece[0], type = piece[1];
    const moves = [];
    const inBounds = (r,c) => r>=0&&r<8&&c>=0&&c<8;
    const enemy    = (r,c) => inBounds(r,c) && board[r][c] && board[r][c][0]!==color;
    const empty    = (r,c) => inBounds(r,c) && !board[r][c];
    const free     = (r,c) => empty(r,c) || enemy(r,c);

    const slide = (dirs) => dirs.forEach(([dr,dc]) => {
        let nr=r+dr, nc=c+dc;
        while(inBounds(nr,nc)) {
            if (board[nr][nc]) { if (board[nr][nc][0]!==color) moves.push([nr,nc]); break; }
            moves.push([nr,nc]); nr+=dr; nc+=dc;
        }
    });

    if (type==='P') {
        const dir = color==='w' ? -1 : 1;
        const start = color==='w' ? 6 : 1;
        if (empty(r+dir,c))   { moves.push([r+dir,c]); if (r===start && empty(r+2*dir,c)) moves.push([r+2*dir,c]); }
        if (enemy(r+dir,c-1)) moves.push([r+dir,c-1]);
        if (enemy(r+dir,c+1)) moves.push([r+dir,c+1]);
    } else if (type==='N') {
        [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]].forEach(([dr,dc]) => { if (free(r+dr,c+dc)) moves.push([r+dr,c+dc]); });
    } else if (type==='B') {
        slide([[-1,-1],[-1,1],[1,-1],[1,1]]);
    } else if (type==='R') {
        slide([[-1,0],[1,0],[0,-1],[0,1]]);
    } else if (type==='Q') {
        slide([[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]);
    } else if (type==='K') {
        [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]].forEach(([dr,dc]) => { if (free(r+dr,c+dc)) moves.push([r+dr,c+dc]); });
    }
    return moves;
}

function findKing(board, color) {
    for (let r=0; r<8; r++) for (let c=0; c<8; c++) if (board[r][c]===color+'K') return [r,c];
    return null;
}

function chessKingInCheck(board, color) {
    const king = findKing(board, color);
    if (!king) return false;
    const opp = color==='w' ? 'b' : 'w';
    for (let r=0; r<8; r++) for (let c=0; c<8; c++) {
        if (board[r][c]?.[0]===opp) {
            if (chessRawMoves(board,r,c).some(([tr,tc])=>tr===king[0]&&tc===king[1])) return true;
        }
    }
    return false;
}

function chessAllMoves(board, color) {
    const moves = [];
    for (let r=0; r<8; r++) for (let c=0; c<8; c++) {
        if (board[r][c]?.[0]===color) {
            chessGetValidMoves(board,r,c,color).forEach(([tr,tc]) => moves.push([r,c,tr,tc]));
        }
    }
    return moves;
}

// ── Chess AI — full PSTs, move ordering, quiescence, depth 4 ──
const CHESS_VALUES = { P:100, N:320, B:330, R:500, Q:900, K:20000 };
const CHESS_PST = {
    P: [ 0,  0,  0,  0,  0,  0,  0,  0,
        78, 83, 86, 73,102, 82, 85, 90,
         7, 29, 21, 44, 40, 31, 44,  7,
       -17, 16, -2, 15, 14,  0, 15,-13,
       -26,  3, 10,  9,  6,  1,  0,-23,
       -22,  9,  5,-11,-10, -2,  3,-19,
       -31,  8, -7,-37,-36,-14,  3,-31,
         0,  0,  0,  0,  0,  0,  0,  0],
    N: [-66,-53,-75,-75,-10,-55,-58,-70,
        -3, -6,100,-36,  4, 62, -4,-14,
        10, 67,  1, 74, 73, 27, 62, -2,
        24, 24, 45, 37, 33, 41, 25, 17,
        -1,  5, 31, 21, 22, 35,  2,  0,
       -18, 10, 13, 22, 18, 15, 11,-14,
       -23,-15,  2,  0,  2,  0,-23,-20,
       -74,-23,-26,-24,-19,-35,-22,-69],
    B: [-59,-78,-82,-76,-23,-107,-37,-50,
       -11, 20, 35,-42,-39, 31,  2,-22,
        -9, 39,-32, 41, 52,-10, 28,-14,
        25, 17, 20, 34, 26, 25, 15, 10,
        13, 10, 17, 23, 17, 16,  0,  7,
        14, 25, 24, 15,  8, 25, 20, 15,
        19, 20, 11,  6,  7,  6, 20, 16,
        -7,  2,-15,-12,-14,-15,-10,-10],
    R: [ 35, 29, 33,  4, 37, 33, 56, 50,
        55, 29, 56, 67, 55, 62, 34, 60,
        19, 35, 28, 33, 45, 27, 25, 15,
         0,  5, 16, 13, 18, -4, -9, -6,
       -28,-35,-16,-21,-13,-29,-46,-30,
       -42,-28,-42,-25,-25,-35,-26,-46,
       -53,-38,-31,-26,-29,-43,-44,-53,
       -30,-24,-18,  5, -2,-18,-31,-32],
    Q: [  6,  1, -8,-104, 69, 24, 88, 26,
        14, 32, 60,-10, 20, 76, 57, 24,
        -2, 43, 32, 60, 72, 63, 43,  2,
         1,-16, 22, 17, 25, 20,-13, -6,
       -14,-15, -2, -5, -1,-10,-20,-22,
       -30, -6,-13,-11,-16,-11,-16,-27,
       -36,-18,  0,-19,-15,-15,-21,-38,
       -39,-30,-31,-13,-31,-36,-34,-42],
    K: [  4, 54, 47,-99,-99, 60, 83,-62,
       -32, 10, 55, 56, 56, 55, 10,  3,
       -62, 12,-57, 44,-67, 28, 37,-31,
       -55, 50, 11, -4,-19, 13,  0,-49,
       -55,-43,-52,-28,-51,-47, -8,-50,
       -47,-42,-43,-79,-64,-32,-29,-32,
        -4,  3,-14,-50,-57,-18, 13,  4,
        17, 30, -3,-14,  6, -1, 40, 18],
};

function chessEval(board) {
    let score = 0, wMob = 0, bMob = 0, wBish = 0, bBish = 0;
    for (let r=0; r<8; r++) for (let c=0; c<8; c++) {
        const p = board[r][c]; if (!p) continue;
        const color=p[0], type=p[1];
        const val = CHESS_VALUES[type]||0;
        const pst = CHESS_PST[type];
        const idx = color==='w' ? r*8+c : (7-r)*8+c;
        const pos = pst ? (pst[idx]||0) : 0;
        const mob = chessRawMoves(board,r,c).length;
        if (color==='w') { wMob+=mob; if(type==='B') wBish++; }
        else             { bMob+=mob; if(type==='B') bBish++; }
        score += (color==='w'?1:-1) * (val+pos);
    }
    if (wBish>=2) score+=30;
    if (bBish>=2) score-=30;
    score += (wMob-bMob)*2;
    return score;
}

function chessOrderMoves(board, moves) {
    return moves.slice().sort((a,b)=>{
        const capA = board[a[2]][a[3]] ? (CHESS_VALUES[board[a[2]][a[3]][1]]||0)-(CHESS_VALUES[board[a[0]][a[1]][1]]||0)/10 : -999;
        const capB = board[b[2]][b[3]] ? (CHESS_VALUES[board[b[2]][b[3]][1]]||0)-(CHESS_VALUES[board[b[0]][b[1]][1]]||0)/10 : -999;
        return capB-capA;
    });
}

function chessQuiesce(board, alpha, beta, maximizing) {
    const stand = chessEval(board);
    if (maximizing) { if (stand>=beta) return beta; if (stand>alpha) alpha=stand; }
    else            { if (stand<=alpha) return alpha; if (stand<beta) beta=stand; }
    const color = maximizing?'b':'w';
    const caps  = chessAllMoves(board,color).filter(([fr,fc,tr,tc])=>board[tr][tc]);
    for (const [fr,fc,tr,tc] of chessOrderMoves(board,caps)) {
        const nb = chessApplyMove(fr,fc,tr,tc,board);
        const s  = chessQuiesce(nb,alpha,beta,!maximizing);
        if (maximizing) { if(s>alpha) alpha=s; if(alpha>=beta) return beta; }
        else            { if(s<beta)  beta=s;  if(beta<=alpha) return alpha; }
    }
    return maximizing?alpha:beta;
}

function chessMinimax(board, depth, alpha, beta, maximizing) {
    const color = maximizing?'b':'w';
    const moves = chessAllMoves(board,color);
    if (!moves.length) return chessEval(board);
    if (depth===0) return chessQuiesce(board,alpha,beta,maximizing);
    for (const [fr,fc,tr,tc] of chessOrderMoves(board,moves)) {
        const nb = chessApplyMove(fr,fc,tr,tc,board);
        const s  = chessMinimax(nb,depth-1,alpha,beta,!maximizing);
        if (maximizing) { if(s>alpha) alpha=s; if(alpha>=beta) return beta; }
        else            { if(s<beta)  beta=s;  if(beta<=alpha) return alpha; }
    }
    return maximizing?alpha:beta;
}

// -- Difficulty picker --
function startChessAISelect() {
    const levels = [
        { label: 'Beginner 150', elo: '~150',  val: 'elo150' },
        { label: 'Beginner 300', elo: '~300',  val: 'elo300' },
        { label: 'Beginner',     elo: '~600',  val: 0  },
        { label: 'Easy',         elo: '~1000', val: 5  },
        { label: 'Medium',       elo: '~1500', val: 10 },
        { label: 'Hard',         elo: '~2000', val: 15 },
        { label: 'Master',       elo: '~2400', val: 20 },
    ];
    gc().innerHTML = `
        <div style="margin-bottom:8px;color:var(--muted);font-size:12px;text-align:center;">Choose difficulty</div>
        ${levels.map(l => `
            <button class="game-mode-btn" onclick="chessStartAI('${l.val}')" style="display:flex;justify-content:space-between;align-items:center;padding:10px 18px;">
                <span>${l.label}</span>
                <span style="font-size:11px;color:var(--muted);">ELO ${l.elo}</span>
            </button>`).join('')}
        <button class="game-mode-btn" style="margin-top:4px;background:none;border-color:var(--border);" onclick="renderChessModeSelect()">Back</button>`;
}

function chessStartAI(skillLevel) {
    chessSkillLevel = skillLevel;
    if (sfWorker) { try { sfWorker.terminate(); } catch(e){} }
    sfWorker = new Worker('stockfish.js');
    sfWorker.postMessage('uci');
    if (skillLevel === 'elo150') {
        sfWorker.postMessage('setoption name UCI_LimitStrength value true');
        sfWorker.postMessage('setoption name UCI_Elo value 150');
    } else if (skillLevel === 'elo300') {
        sfWorker.postMessage('setoption name UCI_LimitStrength value true');
        sfWorker.postMessage('setoption name UCI_Elo value 300');
    } else {
        sfWorker.postMessage('setoption name UCI_LimitStrength value false');
        sfWorker.postMessage('setoption name Skill Level value ' + chessSkillLevel);
    }
    sfWorker.postMessage('isready');
    startChess('ai');
}

// -- Board to FEN --
function boardToFEN() {
    const pieceMap = {
        wK:'K',wQ:'Q',wR:'R',wB:'B',wN:'N',wP:'P',
        bK:'k',bQ:'q',bR:'r',bB:'b',bN:'n',bP:'p'
    };
    let fen = '';
    for (let r = 0; r < 8; r++) {
        let empty = 0;
        for (let c = 0; c < 8; c++) {
            const p = chessBoard[r][c];
            if (p) { if (empty) { fen += empty; empty = 0; } fen += pieceMap[p]; }
            else empty++;
        }
        if (empty) fen += empty;
        if (r < 7) fen += '/';
    }
    fen += ' b - - 0 1';
    return fen;
}

// -- UCI move to board coords --
function uciToCoords(uci) {
    const col = c => c.charCodeAt(0) - 97;
    const row = r => 8 - parseInt(r);
    return [row(uci[1]), col(uci[0]), row(uci[3]), col(uci[2])];
}

// -- Stockfish AI move --
function chessDoAI() {
    if (chessGameOver || chessTurn !== 'b') return;
    if (!sfWorker) {
        showToast('Start game from the difficulty picker to use Stockfish');
        return;
    }
    const statusEl = document.getElementById('chessStatus');
    if (statusEl) statusEl.textContent = 'AI thinking...';

    sfWorker.onmessage = function(e) {
        const line = e.data;
        if (!line.startsWith('bestmove')) return;
        const moveStr = line.split(' ')[1];
        if (!moveStr || moveStr === '(none)') { renderChess(); return; }
        const [fr, fc, tr, tc] = uciToCoords(moveStr);
        chessApplyMove(fr, fc, tr, tc);
    };
    sfWorker.postMessage('position fen ' + boardToFEN());
    sfWorker.postMessage('go movetime 600');
}

// ── Chess Online ──────────────────────────────────────────────
let chessOnlineUnsub = null, chessOnlineGameId = null, chessOnlineMyColor = null;

async function startChessOnline(role) {
    if (!me) { showToast('Sign in to play online!'); return; }
    if (role === 'host') {
        const code = Math.random().toString(36).slice(2,8).toUpperCase();
        gc().innerHTML = `<div class="game-status">Creating game…</div>`;
        try {
            const ref = await db.collection('normgames').add({
                type: 'chess', code,
                board: initChessBoard().flat(),
                turn: 'w', status: 'waiting',
                players: { w: me.uid },
                lastMove: null,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            chessOnlineGameId  = ref.id;
            chessOnlineMyColor = 'w';
            gc().innerHTML = `
                <div class="game-status">Waiting for opponent…</div>
                <div style="background:var(--panel);border:1px solid var(--border2);border-radius:12px;padding:18px;text-align:center;margin-top:10px;">
                    <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">Share this code with a friend:</div>
                    <div style="font-size:32px;font-weight:800;color:var(--a2);letter-spacing:7px;font-family:monospace;">${code}</div>
                    <button class="game-mode-btn" style="margin:12px auto 0;max-width:180px;display:block;" onclick="navigator.clipboard.writeText('${code}');showToast('✅ Code copied!')">📋 Copy code</button>
                </div>
                <button class="game-mode-btn" style="margin-top:10px;" onclick="cancelChessOnline()">✕ Cancel</button>`;
            subscribeChessOnline(ref.id);
        } catch(e) {
            showToast('Could not create game: ' + (e.message || e.code));
            renderChessModeSelect();
        }
    } else {
        const code = prompt('Enter 6-letter invite code:');
        if (!code) return;
        gc().innerHTML = `<div class="game-status">Finding game…</div>`;
        try {
            const snap = await db.collection('normgames')
                .where('code', '==', code.trim().toUpperCase())
                .where('type', '==', 'chess')
                .limit(1).get();
            if (snap.empty) { showToast('Game not found! Check the code.'); renderChessModeSelect(); return; }
            const doc = snap.docs[0];
            if (doc.data().status !== 'waiting') { showToast('Game already started!'); renderChessModeSelect(); return; }
            await doc.ref.update({ 'players.b': me.uid, status: 'playing' });
            chessOnlineGameId  = doc.id;
            chessOnlineMyColor = 'b';
            subscribeChessOnline(doc.id);
        } catch(e) {
            showToast('Could not join game: ' + (e.message || e.code));
            renderChessModeSelect();
        }
    }
}

function unflatBoard(f){const b=[];for(let i=0;i<8;i++)b.push(f.slice(i*8,i*8+8));return b;}

function subscribeChessOnline(gameId) {
    if (chessOnlineUnsub) chessOnlineUnsub();
    chessOnlineUnsub = db.collection('normgames').doc(gameId).onSnapshot(snap => {
        const data = snap.data(); if (!data) return;
        const board2d = Array.isArray(data.board[0]) ? data.board : unflatBoard(data.board);
        data.board = board2d;
        chessBoard      = board2d;
        chessTurn       = data.turn;
        chessLastMove   = data.lastMove;
        chessMode       = 'online';
        chessSelected   = null;
        chessValidMoves = [];
        chessGameOver   = data.status === 'done';
        renderChessOnline(data);
    });
}

function renderChessOnline(data) {
    const myTurn = data.turn === chessOnlineMyColor && data.status === 'playing';
    const allMoves = chessAllMoves(data.board, data.turn);
    const inCheck  = chessKingInCheck(data.board, data.turn);
    let statusMsg = '';
    const waitingChessCodeHTML = (data.status === 'waiting' && chessOnlineMyColor === 'w' && data.code) ? `
        <div style="background:var(--panel);border:1px solid var(--border2);border-radius:12px;padding:18px;text-align:center;margin-top:10px;">
            <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">Share this code with a friend:</div>
            <div style="font-size:32px;font-weight:800;color:var(--a2);letter-spacing:7px;font-family:monospace;">${data.code}</div>
            <div style="text-align:center;">
                <button class="game-mode-btn" style="margin:12px auto 0;max-width:180px;display:block;" onclick="navigator.clipboard.writeText('${data.code}');showToast('✅ Code copied!')">&#128203; Copy code</button>
            </div>
        </div>
        <button class="game-mode-btn" style="margin-top:10px;" onclick="cancelChessOnline()">✕ Cancel</button>` : '';
    if (data.status === 'waiting') statusMsg = 'Waiting for opponent…';
    else if (data.status === 'done') {
        const winner = data.turn === 'w' ? 'Black' : 'White';
        statusMsg = inCheck ? `♟ Checkmate! ${winner} wins!` : '🤝 Stalemate!';
    }
    else statusMsg = myTurn ? '✅ Your turn!' : "⏳ Opponent's turn…";

    const captured = [];
    const allPieces=['wQ','wR','wR','wB','wB','wN','wN','wP','wP','wP','wP','wP','wP','wP','wP','bQ','bR','bR','bB','bB','bN','bN','bP','bP','bP','bP','bP','bP','bP','bP'];
    const onBoard = data.board.flat().filter(Boolean);
    const remaining=[...allPieces];
    onBoard.forEach(p=>{const i=remaining.indexOf(p);if(i!==-1)remaining.splice(i,1);});
    const wCap=remaining.filter(p=>p[0]==='w').map(p=>CHESS_PIECES[p]).join('');
    const bCap=remaining.filter(p=>p[0]==='b').map(p=>CHESS_PIECES[p]).join('');

    gc().innerHTML = `
        <div style="text-align:center;margin-bottom:4px;font-size:11px;color:var(--muted);">You are <b>${chessOnlineMyColor==='w'?'⬜ White':'⬛ Black'}</b></div>
        ${waitingChessCodeHTML}
        <div class="chess-wrap" style="${data.status==='waiting'?'display:none;':''}">
            <div class="chess-taken">${bCap||'&nbsp;'}</div>
            <div class="game-status">${statusMsg}</div>
            <div class="chess-board" id="chessBoard"></div>
            <div class="chess-labels"><span class="chess-label">a</span><span class="chess-label">b</span><span class="chess-label">c</span><span class="chess-label">d</span><span class="chess-label">e</span><span class="chess-label">f</span><span class="chess-label">g</span><span class="chess-label">h</span></div>
            <div class="chess-taken">${wCap||'&nbsp;'}</div>
            ${data.status==='done' ? `<button class="game-mode-btn" style="max-width:200px;margin:4px auto;" onclick="cancelChessOnline()">← Back</button>` : ''}
        </div>`;

    const boardEl = document.getElementById('chessBoard');
    const kingPos = findKing(data.board, data.turn);
    for (let r=0;r<8;r++) for (let c=0;c<8;c++) {
        const sq = document.createElement('div');
        const isLight = (r+c)%2===0;
        let cls = 'chess-sq '+(isLight?'light':'dark');
        if (chessSelected&&chessSelected[0]===r&&chessSelected[1]===c) cls+=' sel';
        else if (chessValidMoves.some(m=>m[0]===r&&m[1]===c)) cls+=' hint';
        else if (chessLastMove&&((chessLastMove[0]===r&&chessLastMove[1]===c)||(chessLastMove[2]===r&&chessLastMove[3]===c))) cls+=' last';
        if (inCheck&&kingPos&&kingPos[0]===r&&kingPos[1]===c) cls+=' check';
        sq.className=cls;
        sq.textContent=data.board[r][c]?CHESS_PIECES[data.board[r][c]]:'';
        sq.onclick=()=>{ if(!myTurn||data.status!=='playing') return; chessClickOnline(r,c,data); };
        boardEl.appendChild(sq);
    }
}

function chessClickOnline(r, c, data) {
    const piece = data.board[r][c];
    if (chessSelected) {
        const isMove = chessValidMoves.some(m=>m[0]===r&&m[1]===c);
        if (isMove) {
            const newBoard = chessApplyMove(chessSelected[0],chessSelected[1],r,c,data.board);
            const nextTurn = chessOnlineMyColor==='w'?'b':'w';
            const allNext  = chessAllMoves(newBoard, nextTurn);
            db.collection('normgames').doc(chessOnlineGameId).update({
                board: newBoard.flat(), turn: nextTurn,
                lastMove: [chessSelected[0],chessSelected[1],r,c],
                status: allNext.length===0 ? 'done' : 'playing'
            });
            chessSelected=null; chessValidMoves=[];
            return;
        }
    }
    if (piece && piece[0]===chessOnlineMyColor) {
        chessSelected   = [r,c];
        chessValidMoves = chessGetValidMoves(data.board,r,c,chessOnlineMyColor);
    } else {
        chessSelected=null; chessValidMoves=[];
    }
    renderChessOnline(data);
}

function cancelChessOnline() {
    if (chessOnlineUnsub) { chessOnlineUnsub(); chessOnlineUnsub=null; }
    chessOnlineGameId=null; chessOnlineMyColor=null;
    renderChessModeSelect();
}

// ══════════════════════════════════════════════════════════════
// WORDLE
// ══════════════════════════════════════════════════════════════
const WORDLE_WORDS = ['aahed','aalii','abaca','abaci','aback','abaft','abase','abash','abate','abaya','abbey','abbot','abhor','abide','abler','abode','aboon','abort','about','above','abuse','abuzz','abyss','acids','acing','acmes','acned','acorn','acred','acrid','acted','acute','adage','addax','added','adept','adman','admen','admit','adobe','adult','adzes','aegis','aeons','affix','afoot','after','again','agave','agaze','agile','aging','agism','aglow','agmas','agons','agony','agree','agued','agues','ahead','ahing','ahold','aided','ailed','aimed','aimer','ainee','aired','airts','aisle','aitch','aiver','akees','alane','alang','alans','alary','alate','albas','alcid','alecs','aleye','alfas','algae','algas','algid','algin','algor','algum','alien','alifs','align','alike','aliya','alkie','alkyd','alkyl','allay','allot','allow','alloy','almah','almas','almeh','almes','almud','almug','alods','aloes','aloft','aloha','aloin','along','aloof','aloud','altho','alula','alums','alway','amaze','amber','ambit','amble','amend','amice','amici','amiga','amigo','amino','amins','amirs','amiss','amole','among','amort','ample','ampul','amuse','amyls','ancon','anear','anele','angas','angel','anger','angle','angst','anils','anime','anion','anise','ankhs','annex','annoy','anoas','antic','antis','antra','antre','anura','anuro','anvil','aorta','apace','apers','aphid','apian','apish','apode','aport','appel','apple','apply','appro','apres','apron','aptly','araby','arbor','ardor','areic','arena','argon','argot','argue','arhat','ariel','arise','arles','armed','armet','armil','aroma','arose','arpen','arras','array','arrow','arses','arsis','arson','artsy','arums','arval','ashed','ashen','aside','asked','askew','assay','asset','aster','astir','atilt','atman','atmas','atoll','atoms','atomy','atone','atria','attic','audio','audit','augur','aunes','aural','aurar','aures','auric','auroc','avail','avert','avgas','avian','avid','avion','avise','aviso','avoid','avows','awash','awful','awing','awoke','axels','axial','axing','axled','axman','axmen','ayahs','aytes','azide','azine','azlon','azoic','azole','azote','azoth','azuki','azure','bacon','badge','badly','bagel','baggy','bahts','bails','bains','baits','bajra','bakes','bakra','balds','baled','baler','balky','balls','balmy','banal','banda','bands','baned','banes','bangs','banjo','bants','bares','barfs','barge','barks','barns','barny','baron','barre','barry','barye','based','baser','bases','basic','basis','baste','basts','batch','bates','bathe','baths','baton','batts','batty','bauds','baulk','bawds','bawdy','bawls','bayed','bayou','bazar','beach','beady','beaks','beams','beany','beaus','beaux','bedew','began','beige','belah','belga','belie','belle','bemas','bench','bents','berme','berms','berry','berth','beryl','beset','betas','betel','bible','bicep','bidet','bight','bigly','bigot','bijou','biked','bilge','bilgy','bimah','bimbo','binal','binds','biner','biome','biota','bipod','birch','bison','biter','bitty','blabs','blade','blain','bland','blank','blare','blast','blate','blaue','blawn','blays','blaze','bleak','bleat','blebs','bleed','blend','bless','blimp','blind','blink','bliss','bloat','blobs','block','blocs','blogs','bloke','blond','blood','blot','blown','blowy','blubs','blued','bluer','blues','bluet','bluey','blunt','blurs','blurt','blush','board','boast','bogus','boils','boldo','bolts','bonds','boner','boney','bongs','bonze','booby','books','boomy','booty','booze','borax','boron','botch','bothy','bower','bowie','bowls','bowse','boyar','brace','braid','brash','brawl','braze','bream','brede','breed','breve','briar','bride','brigs','brims','brine','bring','brink','brins','brios','brisk','broil','broke','brome','brood','brook','broom','broth','brown','brows','brunt','brush','brusk','brute','bubal','buber','bucko','budge','buggy','bugle','buick','bulge','bulgy','bulls','bully','bumph','bumps','bumpy','bunch','bunco','buoys','burka','burly','burps','burro','burrs','bushy','butch','butts','bylaw','bytes','byway','cabal','cache','cadet','calyx','camel','cameo','camps','canid','canny','canoe','canto','capon','capot','caput','cargo','carob','carol','carve','caste','cauld','caulk','caved','cavil','cedar','cells','chafe','chant','chars','chary','chase','chasm','cheat','check','cheek','cheer','chela','chess','chide','chiel','child','chile','chili','chime','chins','chips','choir','choke','chomp','chord','chose','civic','civil','clame','clamp','clang','clank','claps','clash','clasp','clast','cleat','cleft','clerk','click','cliff','clime','cling','clink','cloak','clods','clone','clons','clop','clops','clout','clown','clubs','clues','clump','coach','cobra','comet','comic','comma','conch','condo','conic','cooee','copse','coral','corgi','corky','corms','cornu','couch','coude','cough','could','covet','cower','cozen','cozy','crack','cramp','crane','crazy','creak','crepe','crest','cried','crier','crimp','cripe','crisp','croak','crone','crook','croup','crowd','crumb','cruse','crust','crypt','cubic','culpa','cupid','curly','curry','cyber','cycle','cynic','daddy','daily','dairy','daisy','dance','dealt','decay','decoy','defer','deign','delta','depot','derby','devil','dirty','disco','ditty','divvy','dodge','dogma','doing','dome','dopey','doubt','dough','dowdy','dowel','dowry','drain','drape','drawl','drawn','dregs','dress','drier','drink','droop','drove','drumming','dryer','duvet','dwelt','early','easel','eater','ebony','edged','eight','eject','elbow','elder','elite','ember','emote','empower','empty','endow','enjoy','enter','envoy','epoch','epoxy','equal','error','essay','evade','every','exact','exert','exist','expel','extol','fable','facet','faint','fairy','faith','fancy','farce','fatal','fauna','feast','fetch','fetid','feudal','fever','fewer','filch','filet','finch','fishy','fjord','flame','flank','flask','flawy','flesh','flick','fling','flirt','float','flood','floss','flour','flout','flown','fluff','fluke','flunk','focal','folio','foray','forge','forte','forum','foyer','frail','franc','freak','fresh','friar','frisk','fritz','frizz','front','frost','froze','frugal','fudge','fugue','fungi','furor','fusty','fuzzy','gaudy','gauze','gavel','genre','ghoul','giddy','given','gizmo','gland','glare','glaze','gleam','glean','glide','glint','gloat','globe','gloom','gloss','glove','gnash','gnome','godly','gofer','going','golly','goose','gouge','gourd','graft','grain','grasp','grate','graze','greed','greet','grief','grill','gripe','groan','groom','grope','grout','gruff','grunt','guile','guise','gulch','gushy','gusto','gypsy','habit','haiku','haste','haunt','haven','hedge','heist','hence','heron','highs','hippo','hoist','homer','honey','honor','horny','hound','husky','hutch','hyena','hyper','icier','igloo','image','imbue','impel','inane','incur','indie','inept','inert','infer','infix','ingot','inlay','inner','input','inter','intro','inure','irate','irony','ivory','jaunt','jazzy','jenny','jiffy','jingo','joust','jumpy','karma','kazoo','kiosk','knack','knave','kneel','knelt','knife','knock','known','koala','krill','kudos','label','labor','lance','lanky','lapel','largo','larva','latch','latte','lauds','layup','leapt','ledge','legal','lethal','libel','limbo','liner','lingo','liver','llama','lodge','logic','login','loopy','lusty','lyric','magic','magma','malice','manly','manor','mantle','marsh','matte','maven','maxim','meager','meant','melee','mercy','merit','messy','metal','micro','midway','mirth','model','moldy','monks','moose','mourn','mulch','murky','musty','myrrh','naive','nanny','nasty','naval','navel','needy','nervy','niche','night','ninja','noire','nonce','noodle','novice','nymph','oafish','occur','octet','offal','onset','opaque','other','otter','ought','overt','owner','oxide','ozone','paddy','papal','papyrus','parka','parry','patsy','pause','peace','pearl','penny','perky','petty','phase','phone','phony','photo','piano','picky','pixel','pixie','plaid','plank','plasm','plaza','pleat','pluck','plumb','plump','plunk','plush','poach','podgy','polar','poppy','porch','preen','press','pricy','prism','privy','probe','prone','prowl','proxy','prude','prune','psalm','pubic','pudgy','pulpy','punchy','quirk','quota','rabid','rainy','rally','ramen','range','rapid','raspy','ratty','raven','reach','rebel','recur','reign','relax','remix','repay','repel','rerun','rhyme','ridge','right','ripen','risky','ritzy','river','rocky','roman','rowdy','ruffe','rugby','ruled','rumor','rupee','rural','rusty','saggy','sandy','sauce','saucy','sauna','savvy','scald','scalp','scam','scant','scare','scarf','scary','scone','scope','sedan','seedy','seize','servo','sewer','shade','shaft','shaky','shard','sharp','sheen','shiny','shirt','shoal','showy','shrug','sight','siren','skimp','skirt','skulk','slain','slang','slant','sleet','slept','slick','slope','slosh','sloth','slump','slung','slunk','slurp','snarl','sneak','sneer','snide','sniff','snort','soggy','solar','solve','sorry','spark','spawn','speak','spend','spicy','spike','spill','spire','spite','split','splotch','spoke','spoof','spook','spool','spoon','spore','spout','sprig','spunk','squad','squat','squid','stack','staff','staid','stair','stale','stall','stamp','stand','stark','stead','steam','steed','steep','steer','stern','stiff','still','sting','stint','stoic','stoke','stomp','stood','stork','storm','story','stout','stove','strap','stray','strip','strut','stump','stunt','stupe','suave','sugar','suite','sulky','summon','sunny','super','surge','surly','swamp','swear','sweat','swept','swill','swipe','swoon','swoop','sword','syrup','tabby','tacit','taffy','talon','tango','taunt','tawny','tepid','terse','testy','thane','thank','their','theme','thick','thief','thing','think','those','three','threw','throw','thrum','thugs','thumb','thump','tithe','token','totem','touch','tough','toxic','track','trawl','tread','trend','trial','tribe','trill','trite','tromp','trope','troth','trout','truce','trump','trunk','truss','trust','tryst','tulip','tulle','tumor','tuner','twang','tweak','twirl','ulcer','ultra','unify','union','untie','unzip','upper','usher','usurp','utter','vague','valor','vapid','vault','vaunt','verge','vigor','viper','viral','visor','vivid','vocab','vodka','vomit','vying','wacky','waltz','warty','waste','weary','wedge','weedy','weigh','weird','whale','whiff','whirl','whisk','white','whole','widen','windy','wispy','witch','witty','woeful','wormy','wrath','wreak','wring','wrist','wrong','wrote','yacht','yearn','yodel','young','yummy','zappy','zebra','zilch','zippy','zombi','zonal'];
const WORDLE_ANSWERS = ['aback','abbot','abide','abled','abode','abort','about','above','abuse','acorn','acute','adage','admit','adobe','adopt','adult','affix','after','agave','agile','aglow','agony','agree','ahead','aired','aisle','alarm','album','alert','algae','alias','align','allay','allow','aloft','aloof','altar','amaze','amber','amble','amend','amuse','angel','angle','anime','annex','annoy','antic','anvil','apple','apply','apron','arbor','ardor','argue','arise','armor','aroma','arose','array','arrow','arson','artsy','ashes','aside','askew','asset','atone','attic','audio','audit','augur','avail','avert','avoid','awash','awful','axial','azure','bacon','badge','badly','bagel','balls','balmy','banal','baron','basic','batch','bathe','beach','beets','began','begot','beige','belle','bench','berry','berth','beset','bevel','bidet','birch','bison','bland','blank','blare','blast','blaze','bleak','blend','blimp','blind','bliss','bloat','block','bloke','blown','blunt','blurt','blush','bogus','bolts','bonds','boner','booze','botch','bower','bowls','brace','braid','brand','brash','brave','brawl','braze','bream','breed','bride','brine','brisk','broke','brook','broom','broth','brown','brunt','brush','brute','bunch','cabal','camel','cameo','candy','canny','canoe','cargo','carol','carve','cedar','chafe','chant','chasm','cheat','check','cheek','cheer','chess','chide','chime','choir','choke','chord','chose','civic','civil','clamp','clash','clasp','clean','cleft','click','cliff','cling','cloak','clone','clops','clout','clown','coach','cobra','comet','comic','comma','conch','condo','conic','coral','couch','covet','cower','crack','cramp','crane','crazy','creak','crest','crimp','crisp','croak','crowd','crumb','crust','crypt','cubic','curly','curry','cyber','dadly','daily','dairy','daisy','dance','deign','delta','depot','derby','devil','dirty','ditty','divvy','dodge','dogma','doubt','dough','dowdy','dowel','dowry','drain','drape','drawl','drawn','dregs','drier','drink','drone','drove','duvet','early','easel','eater','ebony','eight','elbow','elder','elite','emote','empty','endow','enjoy','enter','envoy','epoch','error','essay','evade','every','exact','exert','exist','expel','fable','facet','fairy','faith','fancy','farce','fatal','fauna','feast','felon','fever','filch','filet','finch','fishy','flame','flank','flash','flesh','flick','fling','float','floss','flour','flown','fluff','fluke','flunk','focal','folio','foray','forge','forte','forum','foyer','frail','franc','freak','fresh','friar','frisk','fritz','frizz','frost','froze','fungi','furor','fuzzy','gaudy','gauze','gavel','genre','ghoul','giddy','given','gizmo','gland','glare','glaze','gleam','glide','glint','gloat','globe','gloom','gloss','glove','gnash','gnome','godly','going','goose','gouge','gourd','graft','grain','grasp','grate','graze','greed','greet','grief','grill','groan','grope','grout','gruff','grunt','guile','gulch','gusto','habit','haiku','haste','haven','hedge','heist','hence','heron','hippo','hoist','homer','honey','honor','hound','husky','hyena','hyper','icier','igloo','image','imbue','impel','indie','inert','infer','ingot','inner','input','inure','irate','irony','ivory','jaunt','jazzy','jiffy','joust','jumpy','karma','kazoo','kiosk','knack','knave','kneel','knife','knock','koala','krill','kudos','label','labor','lance','lanky','lapel','largo','larva','latch','latent','latte','lauds','layup','ledge','legal','libel','limbo','liner','lingo','liver','llama','lodge','logic','login','lusty','lyric','magic','magma','manly','manor','marsh','matte','maven','maxim','mercy','merit','messy','metal','micro','mirth','model','moldy','moose','mourn','mulch','murky','myrrh','naive','nanny','nasty','naval','navel','nervy','niche','night','ninja','novice','oafish','occur','octet','onset','otter','overt','paddy','papal','parka','parry','patsy','pause','peace','pearl','penny','perky','petty','phase','phone','phony','photo','piano','picky','pixel','pixie','plaid','plank','plaza','pleat','pluck','plumb','plump','plunk','plush','poach','polar','poppy','porch','preen','prism','probe','prone','prowl','prude','prune','psalm','pudgy','quirk','rabid','rainy','rally','range','rapid','raspy','ratty','raven','rebel','recur','reign','relax','remix','repay','repel','rhyme','ridge','ripen','risky','rocky','roman','rowdy','rugby','rural','rusty','sandy','sauce','saucy','sauna','savvy','scald','scalp','scant','scare','scary','scone','scope','sedan','seize','servo','shade','shaft','shaky','shard','sharp','sheen','shiny','shirt','shoal','showy','shrug','sight','siren','skimp','skirt','slain','slang','slant','sleet','slick','slope','slosh','sloth','slump','snarl','sneak','sneer','snide','sniff','snort','solar','solve','spark','spawn','speak','spend','spice','spike','spill','spire','spite','split','spoke','spoof','spook','spool','squad','squat','squid','stack','staff','staid','stair','stale','stall','stamp','stand','stark','stead','steam','steed','steep','steer','stern','stiff','still','sting','stint','stoic','stoke','stomp','stork','storm','stout','stove','strap','stray','strip','strut','stump','stunt','suave','sugar','suite','sulky','surge','surly','swamp','swear','sweat','swept','swill','swipe','swoon','swoop','sword','syrup','tabby','tacit','taffy','talon','tango','taunt','tepid','terse','testy','thane','thank','theme','thick','thief','thing','think','threw','throw','thrum','thumb','thump','token','totem','touch','tough','toxic','track','trawl','tread','trend','trial','tribe','trill','trite','trope','trout','truce','trump','trunk','trust','tryst','tulip','tumor','tuner','twang','tweak','twirl','ulcer','ultra','unify','union','untie','unzip','upper','usher','usurp','utter','vague','valor','vapid','vault','vaunt','verge','vigor','viper','viral','visor','vivid','vodka','vomit','wacky','waltz','warty','waste','weary','wedge','weedy','weigh','weird','whale','whiff','whirl','whisk','white','whole','widen','windy','wispy','witch','witty','wrath','wreak','wring','wrist','wrong','yacht','yearn','yodel','young','zippy','zonal'];

let wordleAnswer, wordleGuesses, wordleCurrent, wordleDone;

function initWordle() {
    wordleAnswer  = WORDLE_ANSWERS[Math.floor(Math.random() * WORDLE_ANSWERS.length)];
    wordleGuesses = [];
    wordleCurrent = '';
    wordleDone    = false;
    renderWordle();
}

function renderWordle() {
    const maxGuesses = 6;
    let status = '';
    const lastGuess = wordleGuesses[wordleGuesses.length-1];
    if (lastGuess === wordleAnswer) { status = '🎉 Genius! You got it!'; }
    else if (wordleGuesses.length >= maxGuesses) { status = `💀 The word was: ${wordleAnswer.toUpperCase()}`; }
    else { status = `Guess ${wordleGuesses.length+1}/6`; }

    let gridHTML = '<div class="wordle-grid">';
    for (let g=0; g<maxGuesses; g++) {
        gridHTML += '<div class="wordle-row">';
        for (let l=0; l<5; l++) {
            let cls = 'wordle-tile', ch = '';
            if (g < wordleGuesses.length) {
                const guess = wordleGuesses[g];
                ch = guess[l] || '';
                // Coloring logic
                const ansArr = wordleAnswer.split('');
                const result = Array(5).fill('absent');
                const used   = Array(5).fill(false);
                // First pass: correct
                for (let i=0; i<5; i++) { if (guess[i]===ansArr[i]) { result[i]='correct'; used[i]=true; } }
                // Second pass: present
                for (let i=0; i<5; i++) {
                    if (result[i]==='correct') continue;
                    for (let j=0; j<5; j++) { if (!used[j] && guess[i]===ansArr[j]) { result[i]='present'; used[j]=true; break; } }
                }
                cls += ' ' + result[l];
            } else if (g === wordleGuesses.length && !wordleDone) {
                ch = wordleCurrent[l] || '';
                if (ch) cls += ' filled';
            }
            gridHTML += `<div class="${cls}">${ch.toUpperCase()}</div>`;
        }
        gridHTML += '</div>';
    }
    gridHTML += '</div>';

    // Keyboard state
    const keyState = {};
    wordleGuesses.forEach(guess => {
        const ansArr = wordleAnswer.split('');
        const result = Array(5).fill('absent');
        const used   = Array(5).fill(false);
        for (let i=0; i<5; i++) { if (guess[i]===ansArr[i]) { result[i]='correct'; used[i]=true; } }
        for (let i=0; i<5; i++) {
            if (result[i]==='correct') continue;
            for (let j=0; j<5; j++) { if (!used[j] && guess[i]===ansArr[j]) { result[i]='present'; used[j]=true; break; } }
        }
        guess.split('').forEach((ch,i) => {
            const prev = keyState[ch];
            if (!prev || (prev==='absent') || (prev==='present'&&result[i]==='correct')) keyState[ch]=result[i];
        });
    });

    const rows = [['q','w','e','r','t','y','u','i','o','p'],['a','s','d','f','g','h','j','k','l'],['↵','z','x','c','v','b','n','m','⌫']];
    let kbdHTML = '<div class="wordle-kbd">';
    rows.forEach(row => {
        kbdHTML += '<div class="wordle-kbd-row">';
        row.forEach(k => {
            const state = keyState[k] || '';
            const wide  = k==='↵'||k==='⌫' ? ' wide' : '';
            kbdHTML += `<button class="wordle-key${wide}${state?' '+state:''}" onclick="wordleKey('${k}')">${k.toUpperCase()}</button>`;
        });
        kbdHTML += '</div>';
    });
    kbdHTML += '</div>';

    gc().innerHTML = `
        <div class="game-status">${status}</div>
        ${gridHTML}
        ${wordleDone
            ? `<button class="game-mode-btn" style="max-width:220px;margin:14px auto;" onclick="initWordle()">▶ Play again (new word)</button>`
            : kbdHTML}`;

    if (lastGuess === wordleAnswer || wordleGuesses.length >= maxGuesses) wordleDone = true;
}

function wordleKey(k) {
    if (wordleDone) return;
    if (k === '⌫') { wordleCurrent = wordleCurrent.slice(0,-1); }
    else if (k === '↵') {
        if (wordleCurrent.length < 5) { showToast('Not enough letters!'); return; }
        const valid = (WORDLE_WORDS.includes(wordleCurrent) || WORDLE_ANSWERS.includes(wordleCurrent)) && wordleCurrent.length === 5;
        if (!valid) { showToast('Not in word list!'); return; }
        wordleGuesses.push(wordleCurrent);
        if (wordleCurrent === wordleAnswer) ntAward(NT_EARN_WORDLE_WIN, 'Wordle solved! 🟩'); // NormTokens
        wordleCurrent = '';
    } else {
        if (wordleCurrent.length < 5) wordleCurrent += k.toLowerCase();
    }
    renderWordle();
}

// Also allow physical keyboard for Wordle
document.addEventListener('keydown', e => {
    if (activeGame !== 'wordle' || wordleDone) return;
    if (e.key === 'Backspace') wordleKey('⌫');
    else if (e.key === 'Enter') wordleKey('↵');
    else if (/^[a-zA-Z]$/.test(e.key)) wordleKey(e.key.toLowerCase());
});


document.addEventListener('DOMContentLoaded', () => {
  loadAppearance();
  buildAccentSwatches();
  // Set min datetime for schedule picker
  const dti = document.getElementById('schDateTime');
  if (dti) {
    const now = new Date(Date.now() - new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
    dti.min = now;
  }
});


