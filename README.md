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
