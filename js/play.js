'use strict';
/* KickerTrainer · Spielen-Hälfte: Spiele gegen andere, Gruppen, Ranglisten
 *
 * Diese Hälfte ist von der Übungshälfte getrennt, weil ihre Daten anders
 * funktionieren: Trainingsdaten gehören dir allein und liegen zuerst lokal.
 * Spieldaten gehören mehreren Personen gemeinsam, brauchen also einen Server,
 * ein Konto und andere Regeln für Sichtbarkeit und Löschen.
 *
 * Stand: Das Datenmodell steht in der Datenbank (Migration 20261027120000).
 * Die Oberfläche entsteht schrittweise – siehe PLAN unten. Bis dahin zeigen die
 * drei Bildschirme, was kommt, statt leer zu sein.
 */

/* Was in welchem Schritt kommt. Beim Umsetzen hier den Haken setzen. */
const PLAN=[
  ['Datenmodell und Zugriffsregeln', true],
  ['Modus-Umschalter und Farbschema', true],
  ['Spiel erfassen: Code, Gäste, Sätze, Tore', false],
  ['Bestätigung und Korrektur', false],
  ['Elo-Wertungen', false],
  ['Gruppen und Ranglisten', false]
];

const PLAY_SCREENS={
  play:{
    t:'Spiel',
    lead:'Ein Spiel gegen andere: Du hostest, die Mitspieler treten mit einem 6-stelligen Code bei. Nur dein Gerät zählt die Tore.',
    points:[
      '<b>Einfach</b> oder <b>Erweitert</b> wählen: nur das Satzergebnis, oder jedes Tor mit Torschütze und Position',
      'Satz bis 3 / 5 / 7 / 10 Tore, Spiel bis 1 / 2 / 3 Gewinnsätze',
      'Gäste ohne Handy trägst du selbst ein – sie behalten ihre Wertung über Wochen',
      'Nach dem Spiel bestätigt je Team einer das Ergebnis, dann zählt es'
    ]
  },
  groups: {
    t:'Gruppen',
    lead:'Eine Gruppe ist ein Verein oder Stammtisch. Wer den Einladungscode hat, ist drin.',
    points:[
      'Gemeinsame Gästeliste: Hostet jemand anderes, findet er dieselben Gäste wieder',
      'Der Ersteller kann Stellvertreter ernennen und den Besitz übertragen',
      'Eine eigene Rangliste je Gruppe',
      'Beitreten heißt: dein Nickname ist für die Gruppe sichtbar'
    ]
  },
  rank: {
    t:'Rangliste',
    lead:'Wertungen aus echten Spielen: Einzel, Doppel über alle Partner, und feste Doppel-Paarungen.',
    points:[
      'Berechnet wird ausschließlich auf dem Server, aus dem gesamten Spielverlauf',
      'In der allgemeinen Rangliste stehst du nur, wenn du ausdrücklich zustimmst – jederzeit widerrufbar',
      'Trainingsdaten fließen nie ein und werden nie geteilt',
      'Sichtbar ist für andere immer nur dein Nickname'
    ]
  }
};

function planHtml(){
  const done=PLAN.filter(p=>p[1]).length;
  return '<div class="card"><h2>Stand: Schritt ' + done + ' von ' + PLAN.length + '</h2>'
    + '<div class="planrows">' + PLAN.map(([t, ok]) =>
        '<div class="planrow' + (ok ? ' done' : '') + '">'
        + (ok ? icon('check') : '<i></i>') + '<span>' + esc(t) + '</span></div>').join('')
    + '</div></div>';
}

function renderPlay(id){
  const x=PLAY_SCREENS[id];if(!x)return;
  $('#'+id+'Body').innerHTML=
     '<div class="card"><p class="lead">'+x.lead+'</p>'
    +'<ul class="bullets">'+x.points.map(p=>'<li>'+p+'</li>').join('')+'</ul></div>'
    +planHtml()
    +'<p class="hint">Noch nichts zu tun: Diese Hälfte ist im Aufbau. Zum Üben geht es über den Umschalter links unten.</p>';
}
