// ===== STATS MODULE =====
// Handles statistics management and display

const StatsManager = {
    allTime: null,
    history: [],
    
    // Initialize
    init() {
        this.load();
    },
    
    // Load all stats
    load() {
        const savedAllTime = localStorage.getItem('kickerAllTimeStats');
        if (savedAllTime) {
            this.allTime = JSON.parse(savedAllTime);
        } else {
            this.allTime = this.createEmpty();
        }
        
        const savedHistory = localStorage.getItem('kickerSessionHistory');
        if (savedHistory) {
            this.history = JSON.parse(savedHistory);
        }
    },
    
    // Create empty stats object
    createEmpty() {
        return {
            totalSessions: 0,
            totalHits: 0,
            totalMisses: 0,
            totalShots: 0,
            bestStreak: 0,
            segmentStats: {
                1: { hits: 0, attempts: 0 },
                2: { hits: 0, attempts: 0 },
                3: { hits: 0, attempts: 0 },
                4: { hits: 0, attempts: 0 },
                5: { hits: 0, attempts: 0 }
            },
            firstPlayed: Date.now(),
            lastPlayed: Date.now()
        };
    },
    
    // Save all stats
    save() {
        localStorage.setItem('kickerAllTimeStats', JSON.stringify(this.allTime));
        localStorage.setItem('kickerSessionHistory', JSON.stringify(this.history));
    },
    
    // Update all-time stats with current session
    update(session, lastSessionHits, lastSessionTotal, lastSegmentStats) {
        this.allTime.totalHits += (session.hits - (lastSessionHits || 0));
        this.allTime.totalShots += (session.total - (lastSessionTotal || 0));
        this.allTime.totalMisses = this.allTime.totalShots - this.allTime.totalHits;
        
        // Update segment stats
        for (let i = 1; i <= 5; i++) {
            const sessionSeg = session.segmentStats[i];
            const allTimeSeg = this.allTime.segmentStats[i];
            
            const hitsDiff = sessionSeg.hits - (lastSegmentStats?.[i]?.hits || 0);
            const attemptsDiff = sessionSeg.attempts - (lastSegmentStats?.[i]?.attempts || 0);
            
            allTimeSeg.hits += hitsDiff;
            allTimeSeg.attempts += attemptsDiff;
        }
        
        this.allTime.lastPlayed = Date.now();
        this.save();
    },
    
    // Save session to history
    saveSession(session) {
        const sessionCopy = { ...session };
        sessionCopy.endTime = Date.now();
        sessionCopy.duration = sessionCopy.endTime - sessionCopy.startTime;
        
        // Add timer stats if available
        if (window.TimerMode && window.TimerMode.active) {
            sessionCopy.timerStats = { ...window.TimerMode.stats };
        }
        
        this.history.push(sessionCopy);
        
        // Keep only last 100 sessions
        if (this.history.length > 100) {
            this.history = this.history.slice(-100);
        }
        
        this.allTime.totalSessions++;
        this.save();
    },
    
    // Reset all stats
    reset() {
        if (confirm('Wirklich ALLE Statistiken löschen? Dies kann nicht rückgängig gemacht werden!')) {
            localStorage.removeItem('kickerAllTimeStats');
            localStorage.removeItem('kickerSessionHistory');
            localStorage.removeItem('kickerAdaptiveWeights');
            localStorage.removeItem('audioCalibration');
            localStorage.removeItem('kickerCurrentSession');
            localStorage.removeItem('kickerGameState');
            
            this.allTime = this.createEmpty();
            this.history = [];
            this.save();
            
            return true;
        }
        return false;
    },
    
    // Display functions
    updateCurrentStats(session) {
        const container = document.getElementById('currentStats');
        container.style.display = 'block';
        
        let html = '<div class="session-item">';
        html += `<h3>Modus: ${session.mode}</h3>`;
        html += `<p>Treffer: ${session.hits} / ${session.total}</p>`;
        html += `<p>Trefferquote: ${session.total > 0 ? 
            Math.round((session.hits / session.total) * 100) : 0}%</p>`;
        html += `<p>Beste Serie: ${session.streakBest}</p>`;
        
        if (session.mode === 'perfection') {
            html += '<h4>Fortschritt:</h4>';
            for (let i = 1; i <= 5; i++) {
                const prog = session.perfectionProgress[i];
                html += `<p>Segment ${i}: ${prog.current}/${session.perfectionTarget} ${prog.completed ? '✓' : ''}</p>`;
            }
        }
        
        html += '</div>';
        
        // Segment details
        for (let i = 1; i <= 5; i++) {
            const stats = session.segmentStats[i];
            const rate = stats.attempts > 0 ? Math.round((stats.hits / stats.attempts) * 100) : 0;
            
            html += `
                <div class="segment-detail">
                    <h3>Segment ${i} <span>${rate}%</span></h3>
                    <div>Treffer: ${stats.hits} / ${stats.attempts}</div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${rate}%"></div>
                    </div>
                </div>
            `;
        }
        
        container.innerHTML = html;
    },
    
    updateHistoryStats() {
        const container = document.getElementById('historyStats');
        container.style.display = 'block';
        
        if (this.history.length === 0) {
            container.innerHTML = '<p>Noch keine abgeschlossenen Sessions</p>';
            return;
        }
        
        let html = '';
        this.history.slice(-10).reverse().forEach(session => {
            const date = new Date(session.startTime);
            const hitRate = session.total > 0 ? Math.round((session.hits / session.total) * 100) : 0;
            
            html += `
                <div class="session-item">
                    <div class="session-date">${date.toLocaleDateString('de-DE')} ${date.toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'})}</div>
                    <div>Modus: ${session.mode}</div>
                    <div>Treffer: ${session.hits}/${session.total} (${hitRate}%)</div>
                    <div>Beste Serie: ${session.streakBest}</div>
            `;
            
            if (session.timerStats && session.timerStats.avgReactionTime > 0) {
                html += `<div>Ø Reaktion: ${Math.round(session.timerStats.avgReactionTime)}ms</div>`;
                html += `<div>Beste: ${Math.round(session.timerStats.bestReactionTime)}ms</div>`;
            }
            
            html += '</div>';
        });
        
        container.innerHTML = html;
    },
    
    updateTrendsStats() {
        const container = document.getElementById('trendsStats');
        container.style.display = 'block';
        
        if (this.history.length < 2) {
            container.innerHTML = '<p>Mindestens 2 Sessions für Trends benötigt</p>';
            return;
        }
        
        const recentSessions = this.history.slice(-5);
        
        const hitRates = recentSessions.map(s => 
            s.total > 0 ? (s.hits / s.total) * 100 : 0
        );
        
        const avgHitRate = hitRates.reduce((a, b) => a + b) / hitRates.length;
        const trend = hitRates[hitRates.length - 1] - hitRates[0];
        
        let html = '<h3>Performance Trends</h3>';
        html += '<div class="segment-detail">';
        html += `<p>Durchschnittliche Trefferquote: <strong>${Math.round(avgHitRate)}%</strong></p>`;
        html += `<p>Trend: ${trend > 0 ? '📈' : '📉'} <strong>${Math.abs(Math.round(trend))}%</strong></p>`;
        html += '</div>';
        
        html += '<h3 style="margin-top: 20px;">Segment-Entwicklung</h3>';
        for (let i = 1; i <= 5; i++) {
            let segmentTrend = 0;
            if (recentSessions.length > 1) {
                const firstRate = recentSessions[0].segmentStats[i].attempts > 0 ?
                    (recentSessions[0].segmentStats[i].hits / recentSessions[0].segmentStats[i].attempts) * 100 : 0;
                const lastRate = recentSessions[recentSessions.length - 1].segmentStats[i].attempts > 0 ?
                    (recentSessions[recentSessions.length - 1].segmentStats[i].hits / recentSessions[recentSessions.length - 1].segmentStats[i].attempts) * 100 : 0;
                segmentTrend = lastRate - firstRate;
            }
            
            html += `<div class="segment-detail">
                <h3>Segment ${i}</h3>
                <p>${segmentTrend > 0 ? '↑' : '↓'} ${Math.abs(Math.round(segmentTrend))}% 
                <span style="color: ${segmentTrend > 0 ? '#4CAF50' : '#F44336'}">${segmentTrend > 0 ? 'Verbesserung' : 'Verschlechterung'}</span></p>
            </div>`;
        }
        
        container.innerHTML = html;
    },
    
    updateTimerStats(timerStats) {
        const container = document.getElementById('currentStats');
        container.style.display = 'block';
        
        let html = '<div style="margin-top: 20px;">';
        
        html += '<h3>Reaktionszeit-Statistik</h3>';
        html += `<div class="segment-detail">
            <div>Durchschnitt: <strong>${Math.round(timerStats.avgReactionTime)}ms</strong></div>
            <div>Beste Zeit: <strong style="color: #4CAF50">${Math.round(timerStats.bestReactionTime)}ms</strong></div>
            <div>Schlechteste Zeit: <strong style="color: #F44336">${Math.round(timerStats.worstReactionTime)}ms</strong></div>
            <div>Zu früh: <strong>${timerStats.tooEarlyShots}</strong></div>
            <div>Timeouts: <strong>${timerStats.timeouts}</strong></div>
        </div>`;
        
        // Percentiles
        const allTimes = timerStats.reactionTimes.filter(r => r.hit).map(r => r.time);
        if (allTimes.length > 0) {
            const sorted = [...allTimes].sort((a, b) => a - b);
            const percentiles = {
                p25: sorted[Math.floor(sorted.length * 0.25)],
                p50: sorted[Math.floor(sorted.length * 0.50)],
                p75: sorted[Math.floor(sorted.length * 0.75)],
                p95: sorted[Math.floor(sorted.length * 0.95)]
            };
            
            html += '<h4 style="margin-top: 20px">Perzentile</h4>';
            html += '<div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">';
            html += `<div class="segment-detail"><div>25%: <strong>${Math.round(percentiles.p25)}ms</strong></div></div>`;
            html += `<div class="segment-detail"><div>Median: <strong>${Math.round(percentiles.p50)}ms</strong></div></div>`;
            html += `<div class="segment-detail"><div>75%: <strong>${Math.round(percentiles.p75)}ms</strong></div></div>`;
            html += `<div class="segment-detail"><div>95%: <strong>${Math.round(percentiles.p95)}ms</strong></div></div>`;
            html += '</div>';
        }
        
        // Per segment
        html += '<h4 style="margin-top: 20px">Pro Segment</h4>';
        for (let i = 1; i <= 5; i++) {
            const segmentTimes = timerStats.segmentReactions[i];
            if (segmentTimes.length > 0) {
                const avg = segmentTimes.reduce((a, b) => a + b) / segmentTimes.length;
                const color = window.TimerMode.getReactionColor(avg);
                html += `<div class="segment-detail">
                    <h3>Segment ${i} 
                        <span style="color: ${color}">${Math.round(avg)}ms</span>
                    </h3>
                    <div>${segmentTimes.length} Treffer</div>
                </div>`;
            }
        }
        
        html += '</div>';
        
        container.innerHTML = html;
    }
};

// Export for use in other modules
window.StatsManager = StatsManager;
