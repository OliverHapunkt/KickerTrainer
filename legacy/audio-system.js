// ===== AUDIO SYSTEM MODULE =====
// Handles audio detection, calibration, and beep generation

const AudioSystem = {
    enabled: false,
    context: null,
    analyser: null,
    microphone: null,
    
    calibration: {
        isActive: false,
        currentShot: 0,
        peaks: [],
        threshold: 50,
        recording: null
    },
    
    monitoring: {
        peakHistory: [],
        baselineHistory: [],
        cooldown: false,
        lastPeakTime: 0
    },
    
    // Initialize audio context for beeps
    initBeepContext() {
        if (!this.beepContext) {
            this.beepContext = new (window.AudioContext || window.webkitAudioContext)();
        }
    },
    
    // Play different beep sounds
    playReadyBeep() {
        this.initBeepContext();
        const osc = this.beepContext.createOscillator();
        const gain = this.beepContext.createGain();
        
        osc.connect(gain);
        gain.connect(this.beepContext.destination);
        
        osc.frequency.value = 440; // A4
        osc.type = 'sine';
        
        gain.gain.setValueAtTime(0.3, this.beepContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.beepContext.currentTime + 0.3);
        
        osc.start(this.beepContext.currentTime);
        osc.stop(this.beepContext.currentTime + 0.3);
    },
    
    playShootBeep() {
        this.initBeepContext();
        const osc = this.beepContext.createOscillator();
        const gain = this.beepContext.createGain();
        
        osc.connect(gain);
        gain.connect(this.beepContext.destination);
        
        osc.frequency.value = 880; // A5
        osc.type = 'square';
        
        gain.gain.setValueAtTime(0.5, this.beepContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.beepContext.currentTime + 0.15);
        
        osc.start(this.beepContext.currentTime);
        osc.stop(this.beepContext.currentTime + 0.15);
    },
    
    playErrorBeep() {
        this.initBeepContext();
        const osc = this.beepContext.createOscillator();
        const gain = this.beepContext.createGain();
        
        osc.connect(gain);
        gain.connect(this.beepContext.destination);
        
        osc.frequency.value = 220; // A3
        osc.type = 'sawtooth';
        
        gain.gain.setValueAtTime(0.4, this.beepContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.beepContext.currentTime + 0.5);
        
        osc.start(this.beepContext.currentTime);
        osc.stop(this.beepContext.currentTime + 0.5);
    },
    
    // Start audio detection
    async start() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });
            
            this.context = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.context.createAnalyser();
            this.analyser.fftSize = 2048;
            
            this.microphone = this.context.createMediaStreamSource(stream);
            this.microphone.connect(this.analyser);
            
            // Check if calibration exists
            const saved = localStorage.getItem('audioCalibration');
            if (saved) {
                const cal = JSON.parse(saved);
                this.calibration.threshold = cal.threshold;
                this.calibration.peaks = cal.peaks;
                this.enabled = true;
                this.startMonitoring();
                return true;
            } else {
                // Start calibration
                this.startCalibration();
                return 'calibration';
            }
        } catch (error) {
            console.error('Mikrofon-Zugriff verweigert:', error);
            alert('Bitte Mikrofon-Zugriff erlauben für Audio-Erkennung');
            return false;
        }
    },
    
    // Stop audio detection
    stop() {
        this.enabled = false;
        
        if (this.microphone) {
            this.microphone.disconnect();
            this.microphone = null;
        }
        
        if (this.context) {
            this.context.close();
            this.context = null;
        }
    },
    
    // Start calibration process
    startCalibration() {
        this.calibration.isActive = true;
        this.calibration.currentShot = 0;
        this.calibration.peaks = [];
        
        document.getElementById('calibrationModal').classList.add('active');
        this.updateCalibrationUI();
        this.startCalibrationRecording();
    },
    
    // Record audio levels during calibration
    startCalibrationRecording() {
        if (!this.analyser) return;
        
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        let recordingActive = true;
        let maxLevel = 0;
        
        const record = () => {
            if (!recordingActive || !this.calibration.isActive) return;
            
            this.analyser.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b) / bufferLength;
            maxLevel = Math.max(maxLevel, average);
            
            // Update visual feedback
            const levelBar = document.getElementById('calAudioLevel');
            if (levelBar) {
                const percentage = Math.min(100, (average / 128) * 100);
                levelBar.style.width = percentage + '%';
            }
            
            requestAnimationFrame(record);
        };
        
        record();
        
        this.calibration.recording = {
            getMaxLevel: () => maxLevel,
            stop: () => { recordingActive = false; }
        };
    },
    
    // Confirm calibration shot
    confirmShot() {
        if (!this.calibration.isActive) return;
        
        if (this.calibration.recording) {
            const peak = this.calibration.recording.getMaxLevel();
            this.calibration.peaks.push(peak);
            this.calibration.recording.stop();
            
            console.log(`Kalibrierung Schuss ${this.calibration.currentShot + 1}: Peak = ${peak.toFixed(1)}`);
        }
        
        this.calibration.currentShot++;
        
        if (this.calibration.currentShot >= 3) {
            this.finishCalibration();
        } else {
            this.updateCalibrationUI();
            this.startCalibrationRecording();
        }
    },
    
    // Finish calibration
    finishCalibration() {
        if (this.calibration.peaks.length >= 3) {
            // Calculate median instead of average for better robustness
            const sorted = [...this.calibration.peaks].sort((a, b) => a - b);
            const median = sorted[1]; // Middle value of 3
            
            // Set threshold to 65% of median peak
            this.calibration.threshold = median * 0.65;
            
            // Calculate variance for adaptive tolerance
            const variance = this.calibration.peaks.reduce((sum, peak) => {
                return sum + Math.abs(peak - median);
            }, 0) / this.calibration.peaks.length;
            
            // Save calibration
            localStorage.setItem('audioCalibration', JSON.stringify({
                threshold: this.calibration.threshold,
                peaks: this.calibration.peaks,
                median: median,
                variance: variance,
                calibratedAt: Date.now()
            }));
            
            console.log('Kalibrierung abgeschlossen:', {
                peaks: this.calibration.peaks.map(p => p.toFixed(1)),
                median: median.toFixed(1),
                threshold: this.calibration.threshold.toFixed(1),
                variance: variance.toFixed(1)
            });
        }
        
        document.getElementById('calibrationModal').classList.remove('active');
        this.calibration.isActive = false;
        this.enabled = true;
        this.startMonitoring();
    },
    
    // Cancel calibration
    cancelCalibration() {
        this.calibration.isActive = false;
        document.getElementById('calibrationModal').classList.remove('active');
        this.stop();
    },
    
    // Update calibration UI
    updateCalibrationUI() {
        const dots = ['cal1', 'cal2', 'cal3'];
        dots.forEach((id, index) => {
            const dot = document.getElementById(id);
            dot.className = 'calibration-dot';
            
            if (index < this.calibration.currentShot) {
                dot.classList.add('completed');
            } else if (index === this.calibration.currentShot) {
                dot.classList.add('active');
            }
        });
        
        document.getElementById('calCurrentShot').textContent = this.calibration.currentShot + 1;
    },
    
    // Start monitoring for goal detection
    startMonitoring() {
        if (!this.enabled || !this.analyser) return;
        
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        const monitor = () => {
            if (!this.enabled) return;
            
            this.analyser.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b) / bufferLength;
            
            const now = Date.now();
            
            // Update peak history (last 5 seconds)
            this.monitoring.peakHistory.push({ time: now, level: average });
            this.monitoring.peakHistory = this.monitoring.peakHistory.filter(p => now - p.time < 5000);
            
            // Update baseline history (last 30 seconds, only quiet periods)
            if (average < 100) {
                this.monitoring.baselineHistory.push({ time: now, level: average });
                this.monitoring.baselineHistory = this.monitoring.baselineHistory.filter(b => now - b.time < 30000);
            }
            
            // Calculate dynamic thresholds
            const shortTermAvg = this.monitoring.peakHistory.length > 10 ? 
                this.monitoring.peakHistory.reduce((sum, p) => sum + p.level, 0) / this.monitoring.peakHistory.length : 0;
            
            const longTermBaseline = this.monitoring.baselineHistory.length > 10 ?
                this.monitoring.baselineHistory.reduce((sum, b) => sum + b.level, 0) / this.monitoring.baselineHistory.length : 0;
            
            // Multi-tier threshold system
            const dynamicThreshold = Math.max(
                this.calibration.threshold,
                shortTermAvg * 2.5,
                longTermBaseline * 3 + 20
            );
            
            // Detection logic
            const isPeak = average > dynamicThreshold;
            const isSharpPeak = average > Math.max(shortTermAvg * 3, longTermBaseline * 4);
            const timeSinceLastPeak = now - this.monitoring.lastPeakTime;
            const isSignificantPeak = average > longTermBaseline * 1.5 && isPeak;
            
            // Trigger goal detection
            if (isSignificantPeak && isSharpPeak && !this.monitoring.cooldown && 
                timeSinceLastPeak > 500 && window.gameState && window.gameState.currentTarget) {
                
                console.log('🎯 Tor erkannt!', {
                    level: average.toFixed(1),
                    shortTerm: shortTermAvg.toFixed(1),
                    baseline: longTermBaseline.toFixed(1),
                    threshold: dynamicThreshold.toFixed(1)
                });
                
                this.onGoalDetected();
                this.monitoring.lastPeakTime = now;
                
                // Cooldown period
                this.monitoring.cooldown = true;
                setTimeout(() => { this.monitoring.cooldown = false; }, 2000);
            }
            
            requestAnimationFrame(monitor);
        };
        
        monitor();
    },
    
    // Goal detected callback (will be set by app.js)
    onGoalDetected() {
        // This will be overwritten by app.js
        console.log('Goal detected - no handler set');
    }
};

// Export for use in other modules
window.AudioSystem = AudioSystem;
