/**
 * STARTUP WARS — Lógica do Cliente (Single Page Application)
 * Comunicação Socket.IO, Atualização em Tempo Real, Roleta Canvas e Áudio Sintetizado
 */

// -------------------------------------------------------------
// ESTADO GLOBAL DO CLIENTE
// -------------------------------------------------------------
const state = {
    socket: null,
    currentRoomCode: null,
    mySid: null,
    isHost: false,
    myPlayerData: null,
    selectedBetAmount: 100,
    isSpinning: false,
    soundEnabled: true
};

// Configuração da Roleta Canvas
const ROULETTE_SLICES = [
    { label: '0x', mult: 0.0, color: '#ef4444', text: '0x' },
    { label: '0.5x', mult: 0.5, color: '#f97316', text: '0.5x' },
    { label: '1x', mult: 1.0, color: '#3b82f6', text: '1x' },
    { label: '1.5x', mult: 1.5, color: '#8b5cf6', text: '1.5x' },
    { label: '2x', mult: 2.0, color: '#10b981', text: '2x' },
    { label: '5x', mult: 5.0, color: '#f59e0b', text: '5x' }
];

let rouletteAngle = 0;
let rouletteAnimationId = null;

// -------------------------------------------------------------
// SINTETIZADOR DE ÁUDIO (WEB AUDIO API - SEM ARQUIVOS EXTERNOS)
// -------------------------------------------------------------
let audioCtx = null;

function getAudioContext() {
    if (!audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

const SoundFX = {
    playClick() {
        if (!state.soundEnabled) return;
        try {
            const ctx = getAudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(800, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.04);
            gain.gain.setValueAtTime(0.12, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.04);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.04);
        } catch (e) {}
    },

    playTick() {
        if (!state.soundEnabled) return;
        try {
            const ctx = getAudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(1200, ctx.currentTime);
            gain.gain.setValueAtTime(0.08, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.02);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.02);
        } catch (e) {}
    },

    playWin() {
        if (!state.soundEnabled) return;
        try {
            const ctx = getAudioContext();
            const notes = [523.25, 659.25, 783.99, 1046.50]; // Acorde C Maior
            notes.forEach((freq, idx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.08);
                gain.gain.setValueAtTime(0.15, ctx.currentTime + idx * 0.08);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.08 + 0.3);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(ctx.currentTime + idx * 0.08);
                osc.stop(ctx.currentTime + idx * 0.08 + 0.3);
            });
        } catch (e) {}
    },

    playLose() {
        if (!state.soundEnabled) return;
        try {
            const ctx = getAudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(220, ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(110, ctx.currentTime + 0.25);
            gain.gain.setValueAtTime(0.1, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.25);
        } catch (e) {}
    },

    playAlert() {
        if (!state.soundEnabled) return;
        try {
            const ctx = getAudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(587.33, ctx.currentTime);
            osc.frequency.setValueAtTime(880.00, ctx.currentTime + 0.1);
            gain.gain.setValueAtTime(0.12, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.35);
        } catch (e) {}
    }
};

// -------------------------------------------------------------
// FORMATAÇÃO E UTILITÁRIOS
// -------------------------------------------------------------
function formatMoney(amount) {
    if (amount === undefined || amount === null) amount = 0;
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(amount);
}

function formatSeconds(sec) {
    if (sec < 0) sec = 0;
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `⏱ ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'fa-circle-info';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'error') icon = 'fa-triangle-exclamation';

    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// -------------------------------------------------------------
// GERENCIAMENTO DE VISUALIZAÇÕES E MODAIS
// -------------------------------------------------------------
function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => {
        v.classList.remove('active-view');
        v.classList.add('hidden-view');
    });
    const target = document.getElementById(viewId);
    if (target) {
        target.classList.remove('hidden-view');
        target.classList.add('active-view');
    }
}

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('hidden');
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('hidden');
}

// -------------------------------------------------------------
// INICIALIZAÇÃO DO SOCKET.IO & EVENTOS
// -------------------------------------------------------------
function initSocket() {
    state.socket = io();

    state.socket.on('connect', () => {
        state.mySid = state.socket.id;
        state.socket.emit('get_public_rooms');
    });

    state.socket.on('public_rooms_list', (roomsList) => {
        renderPublicRooms(roomsList);
    });

    state.socket.on('room_created', (data) => {
        state.currentRoomCode = data.room_code;
        state.isHost = true;
        updateLobbyUI(data.room_data);
        showView('view-lobby');
        closeModal('modal-create-room');
        showToast(`Sala ${data.room_code} criada com sucesso!`, 'success');
    });

    state.socket.on('room_joined', (data) => {
        state.currentRoomCode = data.room_code;
        state.isHost = data.is_host;
        updateLobbyUI(data.room_data);
        showView('view-lobby');
        closeModal('modal-search-room');
        showToast(`Você entrou na sala ${data.room_code}!`, 'success');
    });

    state.socket.on('join_error', (data) => {
        showToast(data.message, 'error');
    });

    state.socket.on('action_error', (data) => {
        showToast(data.message, 'error');
    });

    state.socket.on('action_feedback', (data) => {
        showToast(data.message, data.success ? 'success' : 'error');
        if (data.success) SoundFX.playClick();
    });

    state.socket.on('player_joined', (data) => {
        updateLobbyPlayers(data.players);
        showToast(data.message, 'info');
        SoundFX.playAlert();
    });

    state.socket.on('player_left', (data) => {
        updateLobbyPlayers(data.players);
        showToast(data.message, 'info');
    });

    state.socket.on('host_changed', (data) => {
        state.isHost = (data.new_host_sid === state.mySid);
        updateLobbyPlayers(data.players);
        showToast(`Novo anfitrião: ${data.new_host_name}`, 'info');
    });

    state.socket.on('game_started', (data) => {
        showView('view-game');
        document.getElementById('game-room-code-tag').innerText = data.room_code;
        showToast('🚀 A partida começou! Boas vendas!', 'success');
        SoundFX.playAlert();
        initRouletteCanvas();
    });

    state.socket.on('game_tick', (data) => {
        updateGameDashboard(data);
    });

    state.socket.on('global_event_started', (data) => {
        SoundFX.playAlert();
        showToast(data.message, 'info');
        const ticker = document.getElementById('news-ticker-text');
        if (ticker) {
            ticker.innerText = data.message;
            ticker.style.color = '#f59e0b';
        }
    });

    state.socket.on('event_ended', (data) => {
        const ticker = document.getElementById('news-ticker-text');
        if (ticker) {
            ticker.innerText = 'Mercado normalizado. Cotações estabilizadas.';
            ticker.style.color = 'var(--text-muted)';
        }
    });

    state.socket.on('bet_result', (result) => {
        animateRouletteSpin(result);
    });

    state.socket.on('bet_error', (data) => {
        state.isSpinning = false;
        document.getElementById('btn-spin-bet').disabled = false;
        showToast(data.message, 'error');
        SoundFX.playLose();
    });

    state.socket.on('game_over', (data) => {
        handleGameOver(data);
    });

    state.socket.on('room_restarted', (data) => {
        closeModal('modal-gameover');
        updateLobbyUI({
            code: data.room_code,
            mode: 'fast',
            players: data.players
        });
        showView('view-lobby');
        showToast('A sala foi reiniciada para uma nova rodada!', 'success');
    });
}

// -------------------------------------------------------------
// RENDERIZAÇÃO DO LOBBY E SALAS PÚBLICAS
// -------------------------------------------------------------
function renderPublicRooms(roomsList) {
    const tbody = document.getElementById('public-rooms-tbody');
    if (!tbody) return;

    if (!roomsList || roomsList.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-table-msg">
                    <i class="fa-solid fa-store-slash"></i> Nenhuma sala pública aberta no momento. Crie a sua!
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = roomsList.map(r => `
        <tr>
            <td><strong class="text-cyan">${r.code}</strong></td>
            <td>${r.host_name}</td>
            <td><span class="badge badge-players">${r.players_count}/${r.max_players}</span></td>
            <td><span class="badge badge-mode">${r.mode}</span></td>
            <td>
                <button class="btn btn-xs btn-primary" onclick="quickJoinRoom('${r.code}')">
                    <i class="fa-solid fa-right-to-bracket"></i> Entrar
                </button>
            </td>
        </tr>
    `).join('');
}

function quickJoinRoom(code) {
    const playerName = document.getElementById('join-player-name').value.trim() || 'Investidor';
    const companyName = document.getElementById('join-company-name').value.trim() || 'VentureX';
    
    state.socket.emit('join_room', {
        roomCode: code,
        playerName: playerName,
        companyName: companyName
    });
}

function updateLobbyUI(roomData) {
    document.getElementById('lobby-room-code-display').innerText = roomData.code;
    document.getElementById('lobby-mode-badge').innerText = roomData.mode === 'fast' ? '⚡ 5 min' : '🕐 10 min';
    updateLobbyPlayers(roomData.players);
}

function updateLobbyPlayers(players) {
    const list = document.getElementById('lobby-players-list');
    const countBadge = document.getElementById('lobby-players-count-badge');
    const startBtn = document.getElementById('btn-start-game');
    const helperTxt = document.getElementById('start-game-helper');

    countBadge.innerText = `Jogadores: ${players.length}/5`;

    let html = '';
    for (let i = 0; i < 5; i++) {
        if (i < players.length) {
            const p = players[i];
            const isMe = p.sid === state.mySid;
            html += `
                <div class="player-slot-card occupied ${isMe ? 'is-you' : ''}">
                    <div class="player-status-dot active"></div>
                    <div class="player-slot-info">
                        <div class="player-slot-name">
                            ${p.is_host ? '<i class="fa-solid fa-crown host-crown"></i> ' : ''}
                            ${p.name} ${isMe ? '<small>(Você)</small>' : ''}
                        </div>
                        <div class="player-slot-company">${p.company_name}</div>
                    </div>
                </div>
            `;
        } else {
            html += `
                <div class="player-slot-card">
                    <div class="player-status-dot"></div>
                    <div class="player-slot-info">
                        <div class="player-slot-name text-muted">⚪ Aguardando jogador...</div>
                        <div class="player-slot-company">Vaga livre</div>
                    </div>
                </div>
            `;
        }
    }
    list.innerHTML = html;

    // Atualizar controle do Anfitrião
    if (state.isHost) {
        startBtn.style.display = 'inline-flex';
        helperTxt.style.display = 'block';
        if (players.length >= 2) {
            startBtn.disabled = false;
            helperTxt.innerText = 'Pronto para iniciar a batalha das startups!';
            helperTxt.style.color = 'var(--color-green)';
        } else {
            startBtn.disabled = true;
            helperTxt.innerText = 'Aguardando pelo menos 2 jogadores para iniciar.';
            helperTxt.style.color = 'var(--text-muted)';
        }
    } else {
        startBtn.style.display = 'none';
        helperTxt.innerText = 'Aguardando o anfitrião iniciar a partida...';
        helperTxt.style.color = 'var(--text-muted)';
    }
}

// -------------------------------------------------------------
// ATUALIZAÇÃO DO DASHBOARD DO JOGO EM TEMPO REAL
// -------------------------------------------------------------
function updateGameDashboard(data) {
    const p = data.player_data;
    const m = data.market;
    const r = data.ranking;
    state.myPlayerData = p;

    // 1. Cronômetro Top Bar
    const timerElem = document.getElementById('game-timer');
    timerElem.innerText = formatSeconds(data.time_remaining);
    if (data.time_remaining <= 60) {
        timerElem.classList.add('timer-warning');
    } else {
        timerElem.classList.remove('timer-warning');
    }

    // 2. 4 KPIs Financeiros
    document.getElementById('kpi-money').innerText = formatMoney(p.money);
    document.getElementById('kpi-networth').innerText = formatMoney(p.net_worth);
    document.getElementById('kpi-revenue').innerText = formatMoney(p.revenue);
    
    const profitElem = document.getElementById('kpi-profit');
    profitElem.innerText = formatMoney(p.profit);
    profitElem.className = `kpi-value ${p.profit >= 0 ? 'text-green' : 'text-red'}`;

    // 3. Mercado de Insumos
    const rawPriceElem = document.getElementById('market-raw-price');
    rawPriceElem.innerText = `${formatMoney(m.raw_material_price)} / un`;
    
    // Custo dos pacotes no mercado
    document.getElementById('cost-pack-10').innerText = `Custo: ${formatMoney(m.raw_material_price * 10)}`;
    document.getElementById('cost-pack-50').innerText = `Custo: ${formatMoney(m.raw_material_price * 50)}`;
    document.getElementById('cost-pack-100').innerText = `Custo: ${formatMoney(m.raw_material_price * 100)}`;

    // Tendência de Mercado
    const trendElem = document.getElementById('market-trend');
    if (m.active_event) {
        trendElem.innerHTML = `<span class="text-gold"><i class="fa-solid fa-fire"></i> ${m.active_event.title}</span>`;
    } else if (m.raw_material_price > 55) {
        trendElem.innerHTML = `<span class="text-red"><i class="fa-solid fa-arrow-trend-up"></i> Em Alta (Caro)</span>`;
    } else if (m.raw_material_price < 45) {
        trendElem.innerHTML = `<span class="text-green"><i class="fa-solid fa-arrow-trend-down"></i> Em Baixa (Oportunidade)</span>`;
    } else {
        trendElem.innerHTML = `<span class="text-muted"><i class="fa-solid fa-minus"></i> Cotação Estável</span>`;
    }

    // 4. Estoque & Capacidade
    const totalStored = p.raw_materials + p.finished_products;
    const storageCap = p.storage_capacity;
    const usedPct = Math.min(100, Math.round((totalStored / storageCap) * 100));

    document.getElementById('storage-used-txt').innerText = totalStored;
    document.getElementById('storage-max-txt').innerText = storageCap;
    document.getElementById('storage-percentage-txt').innerText = `${usedPct}% Ocupado`;
    
    const progBar = document.getElementById('storage-progress-bar');
    progBar.style.width = `${usedPct}%`;
    progBar.style.background = usedPct > 90 ? 'var(--color-red)' : (usedPct > 70 ? 'var(--color-gold)' : 'linear-gradient(90deg, #3b82f6, #06b6d4)');

    document.getElementById('inv-raw-count').innerText = `${p.raw_materials} un`;
    document.getElementById('inv-finished-count').innerText = `${p.finished_products} un`;

    // 5. Funcionários & Folha Salarial
    document.getElementById('count-worker').innerText = p.employees.worker;
    document.getElementById('count-sales').innerText = p.employees.sales;
    document.getElementById('count-marketing').innerText = p.employees.marketing;
    document.getElementById('count-dev').innerText = p.employees.dev;

    const totalSalary = (p.employees.worker * 120) + (p.employees.sales * 150) + (p.employees.marketing * 180) + (p.employees.dev * 220);
    document.getElementById('payroll-total-txt').innerText = formatMoney(totalSalary);

    // 6. Marketing & Reputação
    document.getElementById('reputation-score-txt').innerText = `${p.reputation} / 100`;
    const campBox = document.getElementById('active-campaign-box');
    if (p.active_campaign) {
        campBox.style.display = 'flex';
        document.getElementById('active-campaign-name').innerText = p.active_campaign;
        document.getElementById('active-campaign-timer').innerText = `${p.campaign_timer}s`;
    } else {
        campBox.style.display = 'none';
    }

    // 7. Saldo Líquido BET
    const netBet = p.bet_stats.won_amount - p.bet_stats.lost_amount;
    const betScoreElem = document.getElementById('bet-net-score');
    betScoreElem.innerText = formatMoney(netBet);
    betScoreElem.className = netBet >= 0 ? 'text-green' : 'text-red';

    // 8. Relatórios DRE & Upgrade de Empresa
    document.getElementById('dre-revenue').innerText = formatMoney(p.revenue);
    document.getElementById('dre-expenses').innerText = formatMoney(p.expenses);
    const dreProfit = document.getElementById('dre-profit');
    dreProfit.innerText = formatMoney(p.profit);
    dreProfit.className = p.profit >= 0 ? 'text-green' : 'text-red';
    document.getElementById('dre-sold-count').innerText = `${p.total_products_sold} unidades`;
    document.getElementById('dre-bet-result').innerText = formatMoney(netBet);

    updateCompanyUpgradeUI(p.company_level);

    // 9. Ranking Lateral ao Vivo
    renderLiveRanking(r);
}

function updateCompanyUpgradeUI(level) {
    const tierNames = {
        1: 'Nível 1: Garagem',
        2: 'Nível 2: Escritório Compartilhado',
        3: 'Nível 3: Sede Própria',
        4: 'Nível 4: Centro de Distribuição',
        5: 'Nível 5: Multinacional Tech'
    };
    const nextCosts = { 2: 3000, 3: 7500, 4: 16000, 5: 35000 };

    document.getElementById('company-tier-name').innerText = tierNames[level] || 'Nível Máximo';
    const nextBox = document.getElementById('next-tier-box');

    if (level >= 5) {
        nextBox.innerHTML = '<div class="text-gold font-bold text-center">🏆 Sua empresa atingiu a expansão máxima!</div>';
    } else {
        const nextLvl = level + 1;
        document.getElementById('next-tier-name').innerText = tierNames[nextLvl];
        document.getElementById('next-tier-cost').innerText = formatMoney(nextCosts[nextLvl]);
    }
}

function renderLiveRanking(ranking) {
    const container = document.getElementById('ranking-list-container');
    if (!container || !ranking) return;

    const medals = ['🥇', '🥈', '🥉', '4º', '5º'];

    container.innerHTML = ranking.map((item, index) => {
        const isMe = item.sid === state.mySid;
        return `
            <div class="ranking-item ${isMe ? 'is-current-user' : ''}">
                <div class="rank-medal">${medals[index] || `${index + 1}º`}</div>
                <div class="rank-info">
                    <div class="rank-company">${item.company_name}</div>
                    <div class="rank-player">${item.name} ${isMe ? '(Você)' : ''}</div>
                </div>
                <div class="rank-wealth">${formatMoney(item.net_worth)}</div>
            </div>
        `;
    }).join('');
}

// -------------------------------------------------------------
// ROLETA BET — CANVAS E FÍSICA DE GIRO
// -------------------------------------------------------------
function initRouletteCanvas() {
    const canvas = document.getElementById('roulette-canvas');
    if (!canvas) return;
    drawRouletteWheel(canvas, rouletteAngle);
}

function drawRouletteWheel(canvas, angle) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const center = width / 2;
    const radius = center - 8;
    const sliceAngle = (2 * Math.PI) / ROULETTE_SLICES.length;

    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.translate(center, center);
    ctx.rotate(angle);

    for (let i = 0; i < ROULETTE_SLICES.length; i++) {
        const item = ROULETTE_SLICES[i];
        const startA = i * sliceAngle;
        const endA = startA + sliceAngle;

        // Fatias coloridas
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, radius, startA, endA);
        ctx.closePath();
        ctx.fillStyle = item.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.stroke();

        // Texto da Fatia
        ctx.save();
        ctx.rotate(startA + sliceAngle / 2);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 20px Outfit, sans-serif';
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 4;
        ctx.fillText(item.text, radius - 20, 7);
        ctx.restore();
    }

    // Borda Externa Dourada
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, 2 * Math.PI);
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#f59e0b';
    ctx.stroke();

    ctx.restore();
}

function animateRouletteSpin(result) {
    const canvas = document.getElementById('roulette-canvas');
    const btnSpin = document.getElementById('btn-spin-bet');
    const statusBox = document.getElementById('bet-status-display');

    statusBox.innerHTML = `
        <div class="bet-status-main text-gold"><i class="fa-solid fa-spinner fa-spin"></i> GIRANDO...</div>
        <div class="bet-status-sub">Aposta: ${formatMoney(result.bet_amount)}</div>
    `;

    // Encontrar o índice da fatia sorteada pelo servidor
    const targetSliceIndex = ROULETTE_SLICES.findIndex(s => s.mult === result.multiplier);
    const sliceCount = ROULETTE_SLICES.length;
    const sliceAngle = (2 * Math.PI) / sliceCount;

    // O ponteiro está no topo (ângulo = -PI/2 ou 3PI/2)
    // Ângulo final centralizado na fatia sorteada
    const targetSliceCenter = targetSliceIndex * sliceAngle + (sliceAngle / 2);
    const desiredFinalAngle = (3 * Math.PI / 2) - targetSliceCenter;

    // Adicionar 5 a 7 voltas completas para o efeito de giro rápido
    const totalSpins = 6 * (2 * Math.PI);
    const startAngle = rouletteAngle % (2 * Math.PI);
    const totalDistance = totalSpins + (desiredFinalAngle - startAngle);

    const duration = 3200; // 3.2 segundos
    const startTime = performance.now();
    let lastTickAngle = rouletteAngle;

    function step(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1.0);

        // Easing cúbico desacelerando suavemente (ease-out cubic)
        const easeOut = 1 - Math.pow(1 - progress, 3);
        rouletteAngle = startAngle + (totalDistance * easeOut);

        // Emitir efeito sonoro de tick ao passar por fatias
        if (Math.abs(rouletteAngle - lastTickAngle) > (sliceAngle / 2)) {
            SoundFX.playTick();
            lastTickAngle = rouletteAngle;
        }

        drawRouletteWheel(canvas, rouletteAngle);

        if (progress < 1.0) {
            requestAnimationFrame(step);
        } else {
            // Fim do giro! Revelar resultado
            state.isSpinning = false;
            btnSpin.disabled = false;

            if (result.multiplier > 1.0) {
                SoundFX.playWin();
                statusBox.innerHTML = `
                    <div class="bet-status-main text-green">🎉 ${result.multiplier}X! (+${formatMoney(result.net_gain)})</div>
                    <div class="bet-status-sub">${result.multiplier_label}</div>
                `;
                showToast(`🏆 Ganhou ${formatMoney(result.win_amount)} na Roleta BET!`, 'success');
            } else if (result.multiplier === 1.0) {
                SoundFX.playClick();
                statusBox.innerHTML = `
                    <div class="bet-status-main text-cyan">⚖️ 1X! (Empatou)</div>
                    <div class="bet-status-sub">Recuperou o valor apostado.</div>
                `;
            } else {
                SoundFX.playLose();
                statusBox.innerHTML = `
                    <div class="bet-status-main text-red">❌ ${result.multiplier}X! (${formatMoney(result.win_amount)})</div>
                    <div class="bet-status-sub">${result.multiplier_label}</div>
                `;
                showToast(`Perdeu ${formatMoney(result.bet_amount - result.win_amount)} na Roleta BET!`, 'error');
            }
        }
    }

    requestAnimationFrame(step);
}

// -------------------------------------------------------------
// ENCERRAMENTO DA PARTIDA & PÓDIO
// -------------------------------------------------------------
function handleGameOver(data) {
    SoundFX.playAlert();
    openModal('modal-gameover');

    const ranking = data.ranking || [];
    const awards = data.awards || {};

    // 1. Renderizar Pódio dos 3 Primeiros
    const podiumContainer = document.getElementById('podium-display');
    let podiumHtml = '';

    // 2º Lugar
    if (ranking[1]) {
        podiumHtml += `
            <div class="podium-step podium-2">
                <div class="podium-avatar">🥈</div>
                <div class="podium-name">${ranking[1].company_name}</div>
                <div class="podium-val">${formatMoney(ranking[1].net_worth)}</div>
                <div class="podium-block">2º</div>
            </div>
        `;
    }

    // 1º Lugar (Campeão)
    if (ranking[0]) {
        podiumHtml += `
            <div class="podium-step podium-1">
                <div class="podium-avatar">👑</div>
                <div class="podium-name">${ranking[0].company_name}</div>
                <div class="podium-val">${formatMoney(ranking[0].net_worth)}</div>
                <div class="podium-block">1º</div>
            </div>
        `;
    }

    // 3º Lugar
    if (ranking[2]) {
        podiumHtml += `
            <div class="podium-step podium-3">
                <div class="podium-avatar">🥉</div>
                <div class="podium-name">${ranking[2].company_name}</div>
                <div class="podium-val">${formatMoney(ranking[2].net_worth)}</div>
                <div class="podium-block">3º</div>
            </div>
        `;
    }
    podiumContainer.innerHTML = podiumHtml;

    // 2. Tabela Geral de Resultados
    const tbody = document.getElementById('gameover-table-tbody');
    tbody.innerHTML = ranking.map((item, idx) => `
        <tr>
            <td><strong>${idx + 1}º</strong></td>
            <td><strong>${item.company_name}</strong> <small class="text-muted">(${item.name})</small></td>
            <td class="text-cyan font-bold">${formatMoney(item.net_worth)}</td>
            <td>${formatMoney(item.revenue)}</td>
            <td class="${item.profit >= 0 ? 'text-green' : 'text-red'}">${formatMoney(item.profit)}</td>
            <td>${item.products_sold} un</td>
            <td>${item.is_host ? '<span class="badge badge-players">Host</span>' : '-'}</td>
        </tr>
    `).join('');

    // 3. Badges e Destaques
    const awardsContainer = document.getElementById('special-awards-grid');
    awardsContainer.innerHTML = `
        <div class="award-badge">
            <div class="award-icon text-gold"><i class="fa-solid fa-crown"></i></div>
            <div class="award-title">Campeão Supremo</div>
            <div class="award-winner">${awards.champion ? awards.champion.company_name : '-'}</div>
        </div>
        <div class="award-badge">
            <div class="award-icon text-green"><i class="fa-solid fa-chart-line"></i></div>
            <div class="award-title">Maior Faturamento</div>
            <div class="award-winner">${awards.best_revenue ? awards.best_revenue.company_name : '-'}</div>
        </div>
        <div class="award-badge">
            <div class="award-icon text-cyan"><i class="fa-solid fa-boxes-packing"></i></div>
            <div class="award-title">Maior Produtor</div>
            <div class="award-winner">${awards.most_sold ? awards.most_sold.company_name : '-'}</div>
        </div>
        <div class="award-badge">
            <div class="award-icon text-purple"><i class="fa-solid fa-dice"></i></div>
            <div class="award-title">Rei da BET</div>
            <div class="award-winner">${awards.bet_king ? awards.bet_king.name : '-'}</div>
        </div>
    `;

    // Configurar botão de reiniciar
    const btnRestart = document.getElementById('btn-restart-game');
    if (state.isHost) {
        btnRestart.style.display = 'inline-flex';
        btnRestart.onclick = () => state.socket.emit('restart_room');
    } else {
        btnRestart.style.display = 'none';
    }
}

// -------------------------------------------------------------
// AÇÕES DO JOGADOR DISPARADAS PELA INTERFACE
// -------------------------------------------------------------
function buyRaw(amount) {
    SoundFX.playClick();
    state.socket.emit('buy_raw_materials', { amount: amount });
}

function manualProduce() {
    SoundFX.playClick();
    state.socket.emit('produce_manual');
}

function saveProductPrice() {
    SoundFX.playClick();
    const price = parseFloat(document.getElementById('price-number-input').value) || 100;
    state.socket.emit('set_product_price', { price: price });
}

function hireEmp(role) {
    SoundFX.playClick();
    state.socket.emit('hire_employee', { role: role });
}

function fireEmp(role) {
    SoundFX.playClick();
    state.socket.emit('fire_employee', { role: role });
}

function launchMarketing(campaignId) {
    SoundFX.playClick();
    state.socket.emit('launch_marketing', { campaignId: campaignId });
}

function upgradeCompany() {
    SoundFX.playClick();
    state.socket.emit('upgrade_company');
}

// -------------------------------------------------------------
// LISTENERS DO DOM E NAVEGAÇÃO
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    initSocket();

    // Modais da Home
    document.getElementById('btn-open-create').addEventListener('click', () => {
        SoundFX.playClick();
        openModal('modal-create-room');
    });

    document.getElementById('btn-open-search').addEventListener('click', () => {
        SoundFX.playClick();
        openModal('modal-search-room');
        state.socket.emit('get_public_rooms');
    });

    document.getElementById('btn-open-tutorial').addEventListener('click', () => {
        SoundFX.playClick();
        openModal('modal-tutorial');
    });

    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modalId = e.target.getAttribute('data-close');
            closeModal(modalId);
        });
    });

    // Seletor de Modo na Criação
    document.querySelectorAll('.mode-option').forEach(opt => {
        opt.addEventListener('click', () => {
            document.querySelectorAll('.mode-option').forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
        });
    });

    // Criar Sala
    document.getElementById('btn-confirm-create').addEventListener('click', () => {
        SoundFX.playClick();
        const companyName = document.getElementById('create-company-name').value.trim() || 'Minha Startup';
        const playerName = document.getElementById('create-player-name').value.trim() || 'CEO';
        const mode = document.querySelector('input[name="game-mode"]:checked').value;

        state.socket.emit('create_room', {
            companyName: companyName,
            playerName: playerName,
            mode: mode
        });
    });

    // Entrar por Código Direto
    document.getElementById('btn-confirm-join-code').addEventListener('click', () => {
        SoundFX.playClick();
        const code = document.getElementById('join-code').value.trim().toUpperCase();
        const playerName = document.getElementById('join-player-name').value.trim() || 'Investidor';
        const companyName = document.getElementById('join-company-name').value.trim() || 'VentureX';

        if (!code || code.length < 4) {
            showToast('Digite um código de sala válido.', 'error');
            return;
        }

        state.socket.emit('join_room', {
            roomCode: code,
            playerName: playerName,
            companyName: companyName
        });
    });

    // Atualizar Lista Pública
    document.getElementById('btn-refresh-rooms').addEventListener('click', () => {
        SoundFX.playClick();
        state.socket.emit('get_public_rooms');
    });

    // Copiar Código da Sala
    document.getElementById('btn-copy-code').addEventListener('click', () => {
        SoundFX.playClick();
        if (state.currentRoomCode) {
            navigator.clipboard.writeText(state.currentRoomCode).then(() => {
                showToast(`Código ${state.currentRoomCode} copiado para a área de transferência!`, 'success');
            });
        }
    });

    // Iniciar Partida (Host)
    document.getElementById('btn-start-game').addEventListener('click', () => {
        SoundFX.playClick();
        state.socket.emit('start_game');
    });

    // Sair da Sala (Lobby)
    document.getElementById('btn-leave-room').addEventListener('click', () => {
        location.reload();
    });

    // Menu Principal (Game Over)
    document.getElementById('btn-exit-to-menu').addEventListener('click', () => {
        location.reload();
    });

    // Navegação de Abas de Operações
    document.querySelectorAll('.op-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            SoundFX.playClick();
            document.querySelectorAll('.op-tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.op-pane').forEach(p => p.classList.remove('active'));

            btn.classList.add('active');
            const targetPane = document.getElementById(btn.getAttribute('data-target'));
            if (targetPane) targetPane.classList.add('active');

            if (btn.getAttribute('data-target') === 'tab-bet') {
                initRouletteCanvas();
            }
        });
    });

    // Sincronização do Slider e Input de Preço
    const priceSlider = document.getElementById('price-slider');
    const priceInput = document.getElementById('price-number-input');

    if (priceSlider && priceInput) {
        priceSlider.addEventListener('input', (e) => {
            priceInput.value = e.target.value;
        });
        priceInput.addEventListener('input', (e) => {
            priceSlider.value = e.target.value;
        });
    }

    // Seletores de Fichas da BET
    document.querySelectorAll('.chip-btn').forEach(chip => {
        chip.addEventListener('click', () => {
            SoundFX.playClick();
            document.querySelectorAll('.chip-btn').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            state.selectedBetAmount = parseFloat(chip.getAttribute('data-bet'));
        });
    });

    // Botão de Girar a Roleta BET
    document.getElementById('btn-spin-bet').addEventListener('click', () => {
        if (state.isSpinning) return;

        if (state.myPlayerData && state.myPlayerData.money < state.selectedBetAmount) {
            showToast('Saldo insuficiente para realizar esta aposta!', 'error');
            SoundFX.playLose();
            return;
        }

        state.isSpinning = true;
        document.getElementById('btn-spin-bet').disabled = true;
        SoundFX.playClick();

        state.socket.emit('spin_bet', {
            betAmount: state.selectedBetAmount
        });
    });
});
