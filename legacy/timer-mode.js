// ===== TIMER MODE MODULE =====
// Handles reaction time training mode

const TimerMode = {
    active: false,
    phase: 'idle', // 'idle', 'ready', 'waiting', 'shoot'
    currentRound: 0,
    totalRounds: 10,
    
    timing: {
        readyBeepTime: null,
        shootBeepTime: null,
        shotTime: null,
        reactionTime: null,
        waitDuration: null
    },
    
    stats: {
        reactionTimes: [],
        avgReactionTime: 0,
        bestReactionTime: null,
        worstReactionTime: null,
        tooEarlyShots: 0,
        timeouts: 0,
        segmentReactions: { 1: [], 2: [], 3: [], 4: [], 5: [] }
    },
    
    timeouts: {
        wait: null,
        reaction: null
    },
    
    correction: {
        active: false,
        segment: null,
        timer: null
    },
    
    // Start timer mode
    start(rounds) {
        this.active = true;
        this.phase = 'idle';
        this.currentRound = 0;
        this.totalRounds = rounds;
        
        // Reset stats
        this.stats = {
            reactionTimes: [],
            avgReactionTime: 0,
            bestReactionTime: null,
            worstReactionTime: null,
            tooEarlyShots: 0,
            timeouts: 0,
            segmentReactions: { 1: [], 2: [], 3: [], 4: [], 5: [] }
        };
        
        // Check audio
        if (!window.AudioSystem.enabled) {
            alert('⚠️ Audio-Erkennung wird für Timer-Modus empfohlen!\nAktiviere Audio für automatische Torerkennung.');
        }
        
        setTimeout(() => {
            this.startRound();
        }, 500);
    },
    
    // Start a single round
    startRound() {
        // Generate new target
        if (window.generateNext) {
            window.generateNext();
        }
        
        this.currentRound++;
        this.showStatus('ready', '⚠️', 'BEREIT MACHEN', `Runde ${this.currentRound}/${this.totalRounds}`);
        
        setTimeout(() => {
            this.phase = 'ready';
            this.timing.readyBeepTime = Date.now();
            window.AudioSystem.playReadyBeep();
            
            if (window.navigator.vibrate) {
                window.navigator.vibrate(100);
            }
            
            this.showStatus('waiting', '⏳', 'WARTE AUF SIGNAL...', 'Nicht zu früh schießen!');
            
            // Random wait time between 2-13 seconds
            this.timing.waitDuration = 2000 + Math.random() * 11000;
            
            this.timeouts.wait = setTimeout(() => {
                this.shootPhase();
            }, this.timing.waitDuration);
            
        }, 1000);
    },
    
    // Shoot phase begins
    shootPhase() {
        this.phase = 'shoot';
        this.timing.shootBeepTime = Date.now();
        window.AudioSystem.playShootBeep();
        
        if (window.navigator.vibrate) {
            window.navigator.vibrate([100, 50, 100]);
        }
        
        this.showStatus('shoot', '🎯', 'SCHIESSEN!!!', '');
        
        // 2 second timeout
        this.timeouts.reaction = setTimeout(() => {
            this.handleTimeout();
        }, 2000);
    },
    
    // Handle shot (called from app.js)
    handleShot(segment, isCorrectSegment) {
        if (this.timeouts.reaction) {
            clearTimeout(this.timeouts.reaction);
            this.timeouts.reaction = null;
        }
        
        this.timing.shotTime = Date.now();
        
        // Too early?
        if (this.phase === 'ready' || this.phase === 'waiting') {
            this.handleTooEarly();
            return;
        }
        
        // Shot during shoot phase
        if (this.phase === 'shoot') {
            this.timing.reactionTime = this.timing.shotTime - this.timing.shootBeepTime;
            
            // Record reaction time
            this.stats.reactionTimes.push({
                segment: segment,
                time: this.timing.reactionTime,
                hit: isCorrectSegment,
                round: this.currentRound
            });
            
            // Only count for segment stats if hit
            if (isCorrectSegment) {
                this.stats.segmentReactions[segment].push(this.timing.reactionTime);
                
                // Update best/worst
                if (!this.stats.bestReactionTime || this.timing.reactionTime < this.stats.bestReactionTime) {
                    this.stats.bestReactionTime = this.timing.reactionTime;
                }
                if (!this.stats.worstReactionTime || this.timing.reactionTime > this.stats.worstReactionTime) {
                    this.stats.worstReactionTime = this.timing.reactionTime;
                }
            }
            
            // Show reaction time
            this.showReactionTime(this.timing.reactionTime, isCorrectSegment);
            
            // Start correction timer if hit (correct or not)
            if (isCorrectSegment) {
                this.startCorrectionTimer(segment);
            }
            
            // Next round after delay
            setTimeout(() => {
                this.hideStatus();
                if (this.currentRound < this.totalRounds) {
                    this.startRound();
                } else {
                    this.end();
                }
            }, 3000);
        }
    },
    
    // Handle too early shot
    handleTooEarly() {
        this.stats.tooEarlyShots++;
        
        if (this.timeouts.wait) {
            clearTimeout(this.timeouts.wait);
            this.timeouts.wait = null;
        }
        
        window.AudioSystem.playErrorBeep();
        
        if (window.navigator.vibrate) {
            window.navigator.vibrate([200, 100, 200, 100, 200]);
        }
        
        this.showStatus('error', '❌', 'ZU FRÜH!', 'Warte auf das Signal!');
        
        setTimeout(() => {
            this.hideStatus();
            this.startRound();
        }, 2000);
    },
    
    // Handle timeout (too slow)
    handleTimeout() {
        this.stats.timeouts++;
        
        this.showStatus('error', '⏱️', 'ZU LANGSAM!', 'Zeit abgelaufen');
        
        // Register as miss
        if (window.registerMiss) {
            window.registerMiss();
        }
        
        setTimeout(() => {
            this.hideStatus();
            if (this.currentRound < this.totalRounds) {
                this.startRound();
            } else {
                this.end();
            }
        }, 2000);
    },
    
    // Show reaction time result
    showReactionTime(reactionMs, isHit) {
        const color = this.getReactionColor(reactionMs);
        const rating = this.getReactionRating(reactionMs);
        
        let statusClass = 'reaction-fast';
        if (reactionMs >= 700) statusClass = 'reaction-slow';
        else if (reactionMs >= 500) statusClass = 'reaction-medium';
        
        if (!isHit) {
            this.showStatus('error', '❌', 'VERFEHLT!', `Reaktionszeit: ${Math.round(reactionMs)}ms`);
        } else {
            this.showStatus(statusClass, rating.icon, `${Math.round(reactionMs)}ms`, rating.text);
        }
    },
    
    // Get reaction color
    getReactionColor(ms) {
        if (ms < 300) return '#4CAF50';
        if (ms < 500) return '#8BC34A';
        if (ms < 700) return '#FFC107';
        if (ms < 1000) return '#FF9800';
        return '#F44336';
    },
    
    // Get reaction rating
    getReactionRating(ms) {
        if (ms < 300) return { text: 'BLITZSCHNELL!', icon: '⚡' };
        if (ms < 500) return { text: 'SCHNELL!', icon: '🚀' };
        if (ms < 700) return { text: 'GUT', icon: '👍' };
        if (ms < 1000) return { text: 'LANGSAM', icon: '🐢' };
        return { text: 'ZU LANGSAM', icon: '😴' };
    },
    
    // Start correction timer
    startCorrectionTimer(segment) {
        this.correction.active = true;
        this.correction.segment = segment;
        
        // Visual indicator in status display
        const statusDisplay = document.getElementById('statusDisplay');
        const originalClass = statusDisplay.className;
        
        statusDisplay.classList.add('correction');
        const subtext = statusDisplay.querySelector('.status-subtext');
        const originalSubtext = subtext.textContent;
        subtext.textContent = 'Korrektur möglich (5s) - tippe richtiges Segment';
        
        this.correction.timer = setTimeout(() => {
            this.correction.active = false;
            statusDisplay.className = originalClass;
            subtext.textContent = originalSubtext;
        }, 5000);
    },
    
    // Handle correction
    handleCorrection(actualSegment) {
        if (!this.correction.active) return false;
        
        // Clear correction timer
        if (this.correction.timer) {
            clearTimeout(this.correction.timer);
            this.correction.timer = null;
        }
        
        this.correction.active = false;
        
        // Remove correction class
        const statusDisplay = document.getElementById('statusDisplay');
        statusDisplay.classList.remove('correction');
        
        return true; // Correction was processed
    },
    
    // Check if correction is active
    isCorrectionActive() {
        return this.correction.active;
    },
    
    // End timer mode
    end() {
        // Calculate final stats
        const validShots = this.stats.reactionTimes.filter(r => r.hit);
        if (validShots.length > 0) {
            this.stats.avgReactionTime = validShots.reduce((sum, r) => sum + r.time, 0) / validShots.length;
        }
        
        // Save session
        if (window.saveSession) {
            window.saveSession();
        }
        
        // Show results
        this.showResults();
        
        // Reset
        this.active = false;
        this.phase = 'idle';
    },
    
    // Show final results
    showResults() {
        const validShots = this.stats.reactionTimes.filter(r => r.hit);
        const hitRate = Math.round((validShots.length / this.totalRounds) * 100);
        
        let message = '🏁 Timer-Modus abgeschlossen!\n\n';
        message += `Runden: ${this.totalRounds}\n`;
        message += `Trefferquote: ${hitRate}%\n`;
        message += `Ø Reaktionszeit: ${Math.round(this.stats.avgReactionTime)}ms\n`;
        message += `Beste Zeit: ${Math.round(this.stats.bestReactionTime)}ms\n`;
        message += `Schlechteste Zeit: ${Math.round(this.stats.worstReactionTime)}ms\n`;
        message += `Zu früh: ${this.stats.tooEarlyShots}\n`;
        message += `Timeouts: ${this.stats.timeouts}`;
        
        setTimeout(() => {
            alert(message);
            
            // Show detailed stats
            if (window.updateTimerStatsDisplay) {
                window.updateTimerStatsDisplay(this.stats);
            }
            if (window.toggleStats) {
                window.toggleStats();
            }
        }, 500);
    },
    
    // Show status display
    showStatus(state, icon, text, subtext) {
        const display = document.getElementById('statusDisplay');
        const iconEl = display.querySelector('.status-icon');
        const textEl = display.querySelector('.status-text');
        const subtextEl = display.querySelector('.status-subtext');
        
        display.className = 'status-display show ' + state;
        iconEl.textContent = icon;
        textEl.textContent = text;
        subtextEl.textContent = subtext;
    },
    
    // Hide status display
    hideStatus() {
        const display = document.getElementById('statusDisplay');
        display.classList.remove('show');
    }
};

// Export for use in other modules
window.TimerMode = TimerMode;
