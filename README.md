# KickerTrainer
# ⚽ Tischkicker Trainer Pro

Eine Progressive Web App (PWA) für systematisches Tischfußball-Training mit Fokus auf Präzision, Reaktionszeit und statistischer Auswertung.

![Version](https://img.shields.io/badge/version-3.0.0-green)
![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-iPad%20%7C%20Web-orange)

---

## 📋 Inhaltsverzeichnis

- [Projekt-Übersicht](#projekt-übersicht)
- [Features](#features)
- [Technologie-Stack](#technologie-stack)
- [Installation](#installation)
- [Dateistruktur](#dateistruktur)
- [Architektur](#architektur)
- [Entwicklung](#entwicklung)
- [Deployment](#deployment)
- [API-Dokumentation](#api-dokumentation)
- [Bekannte Probleme](#bekannte-probleme)
- [Roadmap](#roadmap)
- [Contributing](#contributing)

---

## 🎯 Projekt-Übersicht

**Zweck**: Training der Treffsicherheit beim Tischfußball durch gezieltes Üben von Pässen und Torschüssen mit Gamification-Elementen.

**Zielgruppe**: Hobby- und Amateur-Tischfußballer, die ihre Präzision systematisch verbessern wollen.

**Plattformen**: 
- Primär: iPad (Querformat, Touch-optimiert)
- Sekundär: Desktop-Browser, Android-Tablets

---

## ✨ Features

### Core Gameplay
- ✅ **5-Segment-Tor-System**: Nummerierte Zielbereiche (1-5, links nach rechts)
- ✅ **Pass-Training**: Optionales Training von Passrichtungen (oben/unten)
- ✅ **Audio-Detection**: Automatische Torerkennung via Mikrofon mit Korrekturmöglichkeit
- ✅ **Adaptive Schwierigkeit**: Schwache Segmente werden häufiger als Ziel gewählt

### Spielmodi
1. **🆓 Freies Training**: Endloses Training ohne Limit
2. **🎯 Zielmodus**: Erreiche X Treffer (10/25/50 wählbar)
3. **⭐ Perfektion**: Treffe jedes Segment X-mal konsekutiv (2/3/5 wählbar)
4. **⏱️ Reaktions-Training**: Schieße auf akustisches Signal, Reaktionszeit wird gemessen

### Statistik-Features
- 📊 **Live-Stats**: Trefferquote, aktuelle Serie, Session-Score
- 📈 **Segment-Details**: Individual-Performance pro Tor-Bereich
- 🕒 **Session-History**: Vergangene Trainings-Sessions (bis zu 100)
- 📉 **Trend-Analyse**: Performance-Entwicklung über Zeit
- ⚡ **Reaktionszeit-Statistik**: Perzentile, Best/Worst Times, Pro-Segment-Analyse

### UI/UX
- ✅ **Touch-optimiert**: 44px+ Touch-Targets für mobile Devices
- ✅ **Responsive Design**: Funktioniert auf allen Screen-Größen
- ✅ **Haptic Feedback**: Vibrationen bei Treffern/Fehlern (falls unterstützt)
- ✅ **Gesture Support**: Swipe-Down für "Verfehlt"
- ✅ **Moderne Optik**: Glassmorphism mit Animationen
- ✅ **Offline-Ready**: LocalStorage-Persistierung

---

## 🛠 Technologie-Stack

### Frontend
- **HTML5**: Semantic markup
- **CSS3**: Custom Properties, Flexbox, Grid, Animations
- **Vanilla JavaScript (ES6+)**: Modularer Aufbau ohne Frameworks

### Audio
- **Web Audio API**: Beep-Generation für Timer-Mode
- **MediaDevices API**: Mikrofon-Zugriff für Tor-Erkennung

### Storage
- **LocalStorage**: Session-Persistierung, Statistiken, Kalibrierung
- **Geplant**: Supabase (PostgreSQL + Auth) für Cloud-Sync

### Deployment
- **GitHub Pages**: Static Hosting
- **GitHub Actions**: Automatisches Deployment

---

## 📥 Installation

### Voraussetzungen
- Moderner Browser (Chrome 90+, Safari 14+, Firefox 88+)
- Für Audio-Erkennung: Mikrofon-Zugriff

### Lokale Entwicklung
```bash
# Repository klonen
git clone https://github.com/DEIN-USERNAME/kickertrainer.git
cd kickertrainer

# Mit lokalem Server starten (empfohlen)
python -m http.server 8000
# ODER
npx serve

# Im Browser öffnen
open http://localhost:8000




🏗 Architektur
Modulare Struktur
Das Projekt ist in 6 unabhängige Module aufgeteilt:
1. index.html - DOM-Struktur

Header mit Live-Stats
Status-Display (zentral über Tor-Segmenten)
5 Tor-Segmente mit Click-Handling
Control-Panel mit Buttons
Modals (Game-Mode, Kalibrierung, Stats)

2. styles.css - Styling

CSS Custom Properties für Theming
Responsive Design (Breakpoints: 380px, 600px, 768px)
Animations (pulse, shake, slide, rotate)
Status-Display States (ready, waiting, shoot, reaction, error, correction)

3. app.js - Hauptlogik
javascript// Verantwortlich für:
- Game State Management
- Target Generation (inkl. adaptive Weights)
- Segment Click Handling
- Hit/Miss Processing
- Display Updates
- Keyboard/Gesture Events
- Auto-Save System
4. audio-system.js - Audio-Modul
javascriptconst AudioSystem = {
    // Funktionen:
    start()                  // Mikrofon-Zugriff anfordern
    stop()                   // Audio-Detection stoppen
    startCalibration()       // 3-Schuss-Kalibrierung starten
    confirmShot()            // Kalibrierungs-Schuss bestätigen
    finishCalibration()      // Threshold berechnen & speichern
    startMonitoring()        // Goal-Detection-Loop
    playReadyBeep()          // Beep: Bereit machen
    playShootBeep()          // Beep: Jetzt schießen
    playErrorBeep()          // Beep: Fehler/Zu früh
}
Audio-Kalibrierung:

User schießt 3 Tore
App misst Peak-Level jedes Schusses
Berechnet Median der 3 Peaks
Setzt Threshold auf 65% des Medians
Speichert in LocalStorage: audioCalibration

Goal-Detection-Algorithmus:
javascript// Multi-Tier Threshold System
dynamicThreshold = Math.max(
    calibratedThreshold,           // 65% vom Kalibrierungs-Median
    shortTermAverage * 2.5,        // Letzten 5 Sekunden
    longTermBaseline * 3 + 20      // Letzten 30 Sekunden
)

// Detection-Kriterien (alle müssen erfüllt sein):
isPeak = level > dynamicThreshold
isSharpPeak = level > shortTermAvg * 3
isSignificantPeak = level > baseline * 1.5
timeSinceLastPeak > 500ms
!cooldown
5. timer-mode.js - Reaktions-Training
javascriptconst TimerMode = {
    // Phasen:
    'idle' → 'ready' → 'waiting' → 'shoot'
    
    // Flow pro Runde:
    startRound()
      → showStatus('ready') + Beep (440Hz)
      → Wait 1s
      → showStatus('waiting')
      → Wait 2-13s (random)
      → shootPhase() + Beep (880Hz)
      → User schießt
      → handleShot(segment, isCorrect)
      → showReactionTime()
      → startCorrectionTimer() (5s)
      → Next Round
}
Korrektur-System:

Reaktionszeit: Bleibt beim ersten Schuss (Zeit zwischen Beep und Schuss)
Korrektur: 5-Sekunden-Fenster nach Schuss
Hit/Miss: Wird bei Korrektur angepasst
Segment-Stats: Werden korrekt aktualisiert

Timer-Statistiken:
javascriptstats: {
    reactionTimes: [],           // Array aller Reaktionszeiten
    avgReactionTime: 0,          // Durchschnitt aller Hits
    bestReactionTime: null,      // Schnellste Zeit
    worstReactionTime: null,     // Langsamste Zeit
    tooEarlyShots: 0,            // Anzahl zu früher Schüsse
    timeouts: 0,                 // Anzahl Timeouts (zu langsam)
    segmentReactions: {          // Reaktionszeiten pro Segment
        1: [], 2: [], 3: [], 4: [], 5: []
    }
}
6. stats.js - Statistik-Verwaltung
javascriptconst StatsManager = {
    allTime: {},        // All-Time-Statistiken
    history: [],        // Session-History (max 100)
    
    // Funktionen:
    init()              // Lade Statistiken aus LocalStorage
    update()            // Aktualisiere All-Time-Stats
    saveSession()       // Speichere abgeschlossene Session
    reset()             // Lösche alle Statistiken
    
    // Display-Funktionen:
    updateCurrentStats()   // Aktuelle Session
    updateHistoryStats()   // Session-Verlauf
    updateTrendsStats()    // Trend-Analyse
    updateTimerStats()     // Timer-Mode-Statistiken
}
LocalStorage-Keys:
javascript'kickerAllTimeStats'      // All-Time-Statistiken
'kickerSessionHistory'    // Session-Array (max 100)
'kickerAdaptiveWeights'   // Adaptive Segment-Weights [1,1,1,1,1]
'audioCalibration'        // Audio-Kalibrierungsdaten
'kickerCurrentSession'    // Auto-Save: Aktuelle Session
'kickerGameState'         // Auto-Save: Game State

🔧 Entwicklung
Code-Konventionen
JavaScript:
javascript// Naming
const CONSTANTS = 'UPPERCASE_SNAKE_CASE';
let variables = 'camelCase';
function functionNames() {}
class ClassNames {}

// Module Pattern
const ModuleName = {
    property: value,
    method() {}
};
window.ModuleName = ModuleName;  // Export

// Comments
// Single-line für kurze Erklärungen
/** 
 * Multi-line JSDoc für Funktionen
 * @param {number} param - Beschreibung
 * @returns {boolean} Beschreibung
 */
CSS:
css/* BEM-ähnliche Naming Convention */
.block {}
.block__element {}
.block--modifier {}

/* CSS Custom Properties */
:root {
    --primary: #00c851;
    --spacing-sm: 8px;
}

/* Responsive mit clamp() */
font-size: clamp(0.8rem, 2vw, 1.2rem);
Debugging
Chrome DevTools:
javascript// Im Browser-Console:
gameState           // Aktueller Game State
AudioSystem         // Audio-Modul
TimerMode           // Timer-Modul
StatsManager        // Statistik-Modul

// LocalStorage inspizieren:
localStorage.getItem('kickerAllTimeStats')
Audio-Debugging:
javascript// In audio-system.js - startMonitoring():
console.log('🎯 Tor erkannt!', {
    level: average.toFixed(1),
    shortTerm: shortTermAvg.toFixed(1),
    baseline: longTermBaseline.toFixed(1),
    threshold: dynamicThreshold.toFixed(1)
});
