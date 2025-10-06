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
    const allTimeStats = StatsManager.allTime.segmentStats
