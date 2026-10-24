// ===== MAIN APP MODULE =====

// Game State
let gameState = {
    mode: 'free',
    passEnabled: true,
    currentPass: null,
    currentTarget: null,
    score: 0,
    streak: 0,
    maxStreak: 0,
    
    // Session tracking
    lastSessionHits: 0,
    lastSessionTotal: 0,
    lastSegmentStats: null,
    
    // Current Session
    currentSession: {
        startTime: Date.now(),
        mode: 'free',
        hits: 0,
        misses: 0,
        total: 0,
        segmentStats: {
            1: { hits: 0, attempts: 0 },
            2: { hits: 0, attempts: 0 },
            3: { hits: 0, attempts: 0 },
            4: { hits: 0, attempts: 0 },
            5: { hits: 0, attempts: 0 }
        },
        streakBest: 0,
        perfectionProgress: {
            1: { current: 0, completed: false },
            2: { current: 0, completed: false },
            3: { current: 0, completed: false },
            4: { current: 0, completed: false },
            5: { current: 0, completed: false }
        },
        perfectionTarget: 3,
        targetGoal: 0,
    },
    
    // Adaptive difficulty
    adaptiveWeights: [1, 1, 1, 1, 1]
};

// Auto-save interval
let autoSaveInterval = null;

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
    // Initialize modules
    StatsManager.init();
    
    // Load saved weights
    const savedWeights = localStorage.getItem('kickerAdaptiveWeights');
    if (savedWeights) {
        gameState.adaptiveWeights = JSON.parse(savedWeights);
    }
    
    // Load auto-saved session
    loadAutoSavedSession();
    
    // Initialize game modes
    initializeGameModes();
    
    // Start auto-save
    startAutoSave();
    
    // Set up audio goal detection callback
    AudioSystem.onGoalDetected = handleAudioGoalDetection;
    
    // Generate first target
    generateNext();
    updateDisplay();
});

// Auto-save before unload
window.addEventListener('beforeunload', () => {
    if (gameState.currentSession.total > 0) {
        localStorage.setItem('kickerCurrentSession', JSON.stringify(gameState.currentSession));
        localStorage.setItem('kickerGameState', JSON.stringify({
            mode: gameState.mode,
            score: gameState.score,
            streak: gameState.streak,
            maxStreak: gameState.maxStreak,
            adaptiveWeights: gameState.adaptiveWeights
        }));
    }
});

// ===== AUTO-SAVE SYSTEM =====
function startAutoSave() {
    if (autoSaveInterval) clearInterval(autoSaveInterval);
    
    autoSaveInterval = setInterval(() => {
        if (gameState.currentSession.total > 0) {
            localStorage.setItem('kickerCurrentSession', JSON.stringify(gameState.currentSession));
            localStorage.setItem('kickerGameState', JSON.stringify({
                mode: gameState.mode,
                score: gameState.score,
                streak: gameState.streak,
                maxStreak: gameState.maxStreak,
                adaptiveWeights: gameState.adaptiveWeights
            }));
        }
    }, 30000); // Every 30 seconds
}

function loadAutoSavedSession() {
    const saved = localStorage.getItem('kickerCurrentSession');
    const savedState = localStorage.getItem('kickerGameState');
    
    if (saved && savedState) {
        const shouldRestore = confirm(
            'Nicht gespeicherte Session gefunden!\n' +
            'Möchtest du die letzte Session wiederherstellen?'
        );
        
        if (shouldRestore) {
            gameState.currentSession = JSON.parse(saved);
            const state = JSON.parse(savedState);
            gameState.mode = state.mode;
            gameState.score = state.score;
            gameState.streak = state.streak;
            gameState.maxStreak = state.maxStreak;
            gameState.adaptiveWeights = state.adaptiveWeights;
            
            console.log('Session wiederhergestellt');
        } else {
            localStorage.removeItem('kickerCurrentSession');
            localStorage.removeItem('kickerGameState');
        }
    }
}

// ===== GAME MODE MANAGEMENT =====
function initializeGameModes() {
    document.querySelectorAll('.game-mode').forEach(mode => {
        mode.addEventListener('click', () => {
            document.querySelectorAll('.game-mode').forEach(m => m.classList.remove('selected'));
            mode.classList.add('selected');
        });
    });
}

function showGameModal() {
    document.getElementById('gameModal').classList.add('active');
}

function closeModal() {
    document.getElementById('gameModal').classList.remove('active');
}

function startGame() {
    const selectedMode = document.querySelector('.game-mode.selected').dataset.mode;
    
    // Save previous session if it had data
    if (gameState.currentSession.total > 0) {
        saveSession();
    }
    
    // Reset session tracking
    gameState.lastSessionHits = 0;
    gameState.lastSessionTotal = 0;
    gameState.lastSegmentStats = null;
    
    // Reset current session
    gameState.currentSession = {
        startTime: Date.now(),
        mode: selectedMode,
        hits: 0,
        misses: 0,
        total: 0,
        segmentStats: {
            1: { hits: 0, attempts: 0 },
            2: { hits: 0, attempts: 0 },
            3: { hits: 0, attempts: 0 },
            4: { hits: 0, attempts: 0 },
            5: { hits: 0, attempts: 0 }
        },
        streakBest: 0,
        perfectionProgress: {
            1: { current: 0, completed: false },
            2: { current: 0, completed: false },
            3: { current: 0, completed: false },
            4: { current: 0, completed: false },
            5: { current: 0, completed: false }
        },
        perfectionTarget: 3,
        targetGoal: 0
    };
    
    gameState.mode = selectedMode;
    gameState.score = 0;
    gameState.streak = 0;
    gameState.currentTarget = null;
    
    // Mode-specific setup
    if (selectedMode === 'target') {
        gameState.currentSession.targetGoal = parseInt(document.getElementById('targetCount').value);
    } else if (selectedMode === 'perfection') {
        gameState.currentSession.perfectionTarget = parseInt(document.getElementById('perfectionCount').value);
    } else if (selectedMode === 'timer') {
        const rounds = parseInt(document.getElementById('timerRounds').value);
        closeModal();
        TimerMode.start(rounds);
        return;
    }
    
    closeModal();
    generateNext();
    updateDisplay();
}

// ===== PASS MANAGEMENT =====
function togglePass() {
    gameState.passEnabled = !gameState.passEnabled;
    const passSection = document.getElementById('passSection');
    const toggle = document.getElementById('passToggle');
    
    if (gameState.passEnabled) {
        passSection.classList.remove('hidden');
        toggle.classList.add('active');
    } else {
        passSection.classList.add('hidden');
        toggle.classList.remove('active');
        gameState.currentPass = null;
    }
}

function updatePassDisplay() {
    const passUp = document.getElementById('passUp');
    const passDown = document.getElementById('passDown');
    
    passUp.classList.toggle('active', gameState.currentPass === 'up');
    passDown.classList.toggle('active', gameState.currentPass === 'down');
}

// ===== TARGET GENERATION =====
function generateNext() {
    // Clear previous highlights
    document.querySelectorAll('.goal-segment').forEach(seg => {
        seg.classList.remove('active', 'hit-correct', 'hit-wrong');
    });
    
    // Generate pass direction
    if (gameState.passEnabled) {
        gameState.currentPass = Math.random() > 0.5 ? 'up' : 'down';
        updatePassDisplay();
    }
    
    // Generate target segment
    if (gameState.mode === 'perfection') {
        const incompleteSegments = [];
        for (let i = 1; i <= 5; i++) {
            if (!gameState.currentSession.perfectionProgress[i].completed) {
                incompleteSegments.push(i);
            }
        }
        
        if (incompleteSegments.length > 0) {
            if (!gameState.currentTarget || gameState.currentSession.perfectionProgress[gameState.currentTarget].completed) {
                gameState.currentTarget = incompleteSegments[Math.floor(Math.random() * incompleteSegments.length)];
            }
        } else {
            showGameComplete();
            return;
        }
    } else {
        gameState.currentTarget = getWeightedRandomSegment();
    }
    
    // Highlight target
    setTimeout(() => {
        const segment = document.querySelector(`[data-segment="${gameState.currentTarget}"]`);
        if (segment) segment.classList.add('active');
    }, 100);
}

function getWeightedRandomSegment() {
    const weights = [...gameState.adaptiveWeights];
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let random = Math.random() * totalWeight;
    
    for (let i = 0; i < weights.length; i++) {
        random -= weights[i];
        if (random <= 0) {
            return i + 1;
        }
    }
    return 5;
}

// ===== SEGMENT CLICK HANDLING =====
function handleSegmentClick(segment) {
    // Timer mode - check for correction first
    if (TimerMode.active) {
        if (TimerMode.isCorrectionActive()) {
            if (TimerMode.handleCorrection(segment)) {
                // Correction was processed - revert previous hit and process new one
                const prevSegment = TimerMode.correction.segment;
                
                // Revert previous
                gameState.currentSession.hits--;
                gameState.currentSession.segmentStats[prevSegment].hits--;
                gameState.score--;
                
                // Process corrected shot
                const isCorrect = segment === gameState.currentTarget;
                const segmentEl = document.querySelector(`[data-segment="${segment}"]`);
                processHit(segment, segmentEl, isCorrect);
                
                // Update timer stats
                const lastReaction = TimerMode.stats.reactionTimes[TimerMode.stats.reactionTimes.length - 1];
                if (lastReaction) {
                    lastReaction.segment = segment;
                    lastReaction.hit = isCorrect;
                    
                    // Update segment reactions
                    if (isCorrect) {
                        TimerMode.stats.segmentReactions[prevSegment] = TimerMode.stats.segmentReactions[prevSegment].filter(
                            (_, i) => i !== TimerMode.stats.segmentReactions[prevSegment].length - 1
                        );
                        TimerMode.stats.segmentReactions[segment].push(lastReaction.time);
                    }
                }
                
                return;
            }
        }
        
        // Normal timer shot
        TimerMode.handleShot(segment, segment === gameState.currentTarget);
    }
    
    if (gameState.currentTarget === null) return;
    
    const segmentEl = document.querySelector(`[data-segment="${segment}"]`);
    gameState.currentSession.total++;
    gameState.currentSession.segmentStats[gameState.currentTarget].attempts++;
    
    if (segment === gameState.currentTarget) {
        processHit(segment, segmentEl, true);
    } else {
        processHit(segment, segmentEl, false);
    }
}

function processHit(segment, segmentEl, isCorrect) {
    if (isCorrect) {
        segmentEl.classList.add('hit-correct');
        gameState.currentSession.hits++;
        gameState.currentSession.segmentStats[segment].hits++;
        gameState.score++;
        gameState.streak++;
        
        updateAdaptiveWeights(segment, true);
        
        // Perfection mode
        if (gameState.mode === 'perfection') {
            gameState.currentSession.perfectionProgress[segment].current++;
            
            if (gameState.currentSession.perfectionProgress[segment].current >= gameState.currentSession.perfectionTarget) {
                gameState.currentSession.perfectionProgress[segment].completed = true;
                gameState.currentSession.perfectionProgress[segment].current = 0;
            }
        }
        
        // Target mode
        if (gameState.mode === 'target' && gameState.currentSession.hits >= gameState.currentSession.targetGoal) {
            showGameComplete();
        }
        
        // Haptic feedback
        if (window.navigator.vibrate) {
            window.navigator.vibrate(50);
        }
    } else {
        segmentEl.classList.add('hit-wrong');
        gameState.currentSession.misses++;
        gameState.streak = 0;
        
        // Reset perfection progress
        if (gameState.mode === 'perfection') {
            gameState.currentSession.perfectionProgress[gameState.currentTarget].current = 0;
        }
        
        updateAdaptiveWeights(gameState.currentTarget, false);
        
        // Haptic feedback
        if (window.navigator.vibrate) {
            window.navigator.vibrate([50, 50, 50]);
        }
    }
    
    // Update max streak
    if (gameState.streak > gameState.currentSession.streakBest) {
        gameState.currentSession.streakBest = gameState.streak;
    }
    
    updateDisplay();
    StatsManager.update(gameState.currentSession, gameState.lastSessionHits, gameState.lastSessionTotal, gameState.lastSegmentStats);
    
    gameState.lastSessionHits = gameState.currentSession.hits;
    gameState.lastSessionTotal = gameState.currentSession.total;
    gameState.lastSegmentStats = JSON.parse(JSON.stringify(gameState.currentSession.segmentStats));
    
    localStorage.setItem('kickerAdaptiveWeights', JSON.stringify(gameState.adaptiveWeights));
    
    // Generate next after animation (only if not timer mode)
    if (!TimerMode.active) {
        setTimeout(() => {
            generateNext();
        }, 600);
    }
}

function updateAdaptiveWeights(segment, hit) {
    const currentWeight = gameState.adaptiveWeights[segment - 1];
    const allTimeStats = StatsManager.allTime.segmentStats[segment];
    const hitRate = allTimeStats.attempts > 0 ? 
        allTimeStats.hits / allTimeStats.attempts : 0.5;
    
    if (hit) {
        const reduction = hitRate > 0.7 ? 0.90 : 0.95;
        gameState.adaptiveWeights[segment - 1] = Math.max(0.3, currentWeight * reduction);
    } else {
        const increase = hitRate < 0.5 ? 1.2 : 1.1;
        gameState.adaptiveWeights[segment - 1] = Math.min(3, currentWeight * increase);
    }
    
    // Normalize weights
    const sum = gameState.adaptiveWeights.reduce((a, b) => a + b);
    gameState.adaptiveWeights = gameState.adaptiveWeights.map(w => (w / sum) * 5);
}

function registerMiss() {
    if (gameState.currentTarget === null) return;
    
    gameState.currentSession.total++;
    gameState.currentSession.misses++;
    gameState.currentSession.segmentStats[gameState.currentTarget].attempts++;
    gameState.streak = 0;
    
    // Reset perfection progress
    if (gameState.mode === 'perfection') {
        gameState.currentSession.perfectionProgress[gameState.currentTarget].current = 0;
    }
    
    updateAdaptiveWeights(gameState.currentTarget, false);
    
    // Visual feedback
    const missBtn = document.querySelector('.btn-miss');
    missBtn.style.transform = 'scale(0.95)';
    setTimeout(() => {
        missBtn.style.transform = '';
    }, 150);
    
    // Haptic feedback
    if (window.navigator.vibrate) {
        window.navigator.vibrate(100);
    }
    
    updateDisplay();
    StatsManager.update(gameState.currentSession, gameState.lastSessionHits, gameState.lastSessionTotal, gameState.lastSegmentStats);
    
    gameState.lastSessionHits = gameState.currentSession.hits;
    gameState.lastSessionTotal = gameState.currentSession.total;
    gameState.lastSegmentStats = JSON.parse(JSON.stringify(gameState.currentSession.segmentStats));
    
    localStorage.setItem('kickerAdaptiveWeights', JSON.stringify(gameState.adaptiveWeights));
    
    // Generate next (only if not timer mode)
    if (!TimerMode.active) {
        generateNext();
    }
}

// ===== AUDIO DETECTION =====
async function toggleAudioDetection() {
    if (!AudioSystem.enabled) {
        const result = await AudioSystem.start();
        
        if (result === true) {
            // Successfully started
            document.getElementById('audioBtn').classList.add('active');
        } else if (result === 'calibration') {
            // Calibration modal is now open
            // Button will be activated after calibration
        }
    } else {
        AudioSystem.stop();
        document.getElementById('audioBtn').classList.remove('active');
    }
}

function confirmCalibrationShot() {
    AudioSystem.confirmShot();
}

function cancelCalibration() {
    AudioSystem.cancelCalibration();
    document.getElementById('audioBtn').classList.remove('active');
}

function handleAudioGoalDetection() {
    if (!gameState.currentTarget) return;
    
    // Timer mode handling
    if (TimerMode.active) {
        TimerMode.handleShot(gameState.currentTarget, true);
    }
    
    // Normal mode
    const segmentEl = document.querySelector(`[data-segment="${gameState.currentTarget}"]`);
    handleSegmentClick(gameState.currentTarget);
}

// ===== DISPLAY UPDATE =====
function updateDisplay() {
    const hitRate = gameState.currentSession.total > 0 ? 
        Math.round((gameState.currentSession.hits / gameState.currentSession.total) * 100) : 0;
    document.getElementById('hitRate').textContent = hitRate + '%';
    document.getElementById('streak').textContent = gameState.streak;
    document.getElementById('score').textContent = gameState.currentSession.hits;
    
    // Update segment stats
    for (let i = 1; i <= 5; i++) {
        const stats = gameState.currentSession.segmentStats[i];
        const rate = stats.attempts > 0 ? 
            Math.round((stats.hits / stats.attempts) * 100) : 0;
        const segmentEl = document.querySelector(`[data-segment="${i}"] .segment-stats`);
        segmentEl.textContent = `${stats.hits}/${stats.attempts} (${rate}%)`;
    }
    
    // Update stats overlay if open
    if (document.getElementById('statsOverlay').classList.contains('active')) {
        StatsManager.updateCurrentStats(gameState.currentSession);
    }
}

// ===== STATS DISPLAY =====
function toggleStats() {
    const overlay = document.getElementById('statsOverlay');
    overlay.classList.toggle('active');
    if (overlay.classList.contains('active')) {
        StatsManager.updateCurrentStats(gameState.currentSession);
    }
}

function showStatsTab(tab) {
    document.querySelectorAll('.stats-tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    
    document.querySelectorAll('.stats-content').forEach(content => {
        content.style.display = 'none';
    });
    
    if (tab === 'current') {
        StatsManager.updateCurrentStats(gameState.currentSession);
    } else if (tab === 'history') {
        StatsManager.updateHistoryStats();
    } else if (tab === 'trends') {
        StatsManager.updateTrendsStats();
    }
}

function resetStats() {
    if (StatsManager.reset()) {
        gameState.adaptiveWeights = [1, 1, 1, 1, 1];
        startGame();
        toggleStats();
    }
}

function updateTimerStatsDisplay(timerStats) {
    StatsManager.updateTimerStats(timerStats);
}

// ===== SESSION MANAGEMENT =====
function saveSession() {
    StatsManager.saveSession(gameState.currentSession);
    
    // Clear auto-save
    localStorage.removeItem('kickerCurrentSession');
    localStorage.removeItem('kickerGameState');
    
    // Reset tracking
    gameState.lastSessionHits = 0;
    gameState.lastSessionTotal = 0;
    gameState.lastSegmentStats = null;
}

// ===== GAME COMPLETION =====
function showGameComplete() {
    const duration = Math.round((Date.now() - gameState.currentSession.startTime) / 1000);
    const hitRate = Math.round((gameState.currentSession.hits / gameState.currentSession.total) * 100);
    
    let message = '🎉 Training abgeschlossen!\n\n';
    
    if (gameState.mode === 'target') {
        message += `${gameState.currentSession.targetGoal} Treffer erreicht!\n`;
    } else if (gameState.mode === 'perfection') {
        message += `Alle Segmente ${gameState.currentSession.perfectionTarget}x nacheinander getroffen!\n`;
    }
    
    message += `Zeit: ${duration}s\n`;
    message += `Trefferquote: ${hitRate}%\n`;
    message += `Beste Serie: ${gameState.currentSession.streakBest}`;
    
    saveSession();
    
    setTimeout(() => {
        alert(message);
        showGameModal();
    }, 1000);
}

// ===== KEYBOARD & GESTURE SUPPORT =====
document.addEventListener('keydown', (e) => {
    if (gameState.currentTarget === null) return;
    
    switch(e.key) {
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
            handleSegmentClick(parseInt(e.key));
            break;
        case ' ':
        case '0':
            e.preventDefault();
            registerMiss();
            break;
        case 'p':
            togglePass();
            break;
        case 's':
            toggleStats();
            break;
        case 'n':
            showGameModal();
            break;
        case 'a':
            toggleAudioDetection();
            break;
    }
});

// Touch gestures
let touchStartX = 0;
let touchStartY = 0;

document.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
});

document.addEventListener('touchend', (e) => {
    const touchEndX = e.changedTouches[0].screenX;
    const touchEndY = e.changedTouches[0].screenY;
    const diffX = touchEndX - touchStartX;
    const diffY = touchEndY - touchStartY;
    
    // Swipe down for miss
    if (Math.abs(diffY) > Math.abs(diffX) && diffY > 50) {
        registerMiss();
    }
});

// Prevent zoom
document.addEventListener('gesturestart', (e) => {
    e.preventDefault();
});

// Export functions for global access
window.gameState = gameState;
window.handleSegmentClick = handleSegmentClick;
window.registerMiss = registerMiss;
window.togglePass = togglePass;
window.toggleStats = toggleStats;
window.showStatsTab = showStatsTab;
window.resetStats = resetStats;
window.showGameModal = showGameModal;
window.closeModal = closeModal;
window.startGame = startGame;
window.toggleAudioDetection = toggleAudioDetection;
window.confirmCalibrationShot = confirmCalibrationShot;
window.cancelCalibration = cancelCalibration;
window.updateTimerStatsDisplay = updateTimerStatsDisplay;
window.generateNext = generateNext;
window.saveSession = saveSession;
