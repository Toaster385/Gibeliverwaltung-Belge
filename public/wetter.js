// Wetter-Ansicht (Achseten): wird in der App und im Admin-Bereich über Wetter.oeffne() geöffnet.
var Wetter = (function() {
  var overlay = null, inhalt = null;

  // WMO-Wettercodes -> Text + Symbol
  function wetterText(code, tag) {
    var n = tag === false;
    var t = {
      0: [n ? 'Klar' : 'Sonnig', n ? '🌙' : '☀️'], 1: ['Überwiegend klar', n ? '🌙' : '🌤️'], 2: ['Teils bewölkt', '⛅'], 3: ['Bedeckt', '☁️'],
      45: ['Nebel', '🌫️'], 48: ['Reifnebel', '🌫️'],
      51: ['Leichter Nieselregen', '🌦️'], 53: ['Nieselregen', '🌦️'], 55: ['Starker Nieselregen', '🌧️'], 56: ['Gefrierender Niesel', '🌧️'], 57: ['Gefrierender Niesel', '🌧️'],
      61: ['Leichter Regen', '🌦️'], 63: ['Regen', '🌧️'], 65: ['Starker Regen', '🌧️'], 66: ['Gefrierender Regen', '🌧️'], 67: ['Gefrierender Regen', '🌧️'],
      71: ['Leichter Schneefall', '🌨️'], 73: ['Schneefall', '❄️'], 75: ['Starker Schneefall', '❄️'], 77: ['Schneegriesel', '🌨️'],
      80: ['Leichte Schauer', '🌦️'], 81: ['Schauer', '🌧️'], 82: ['Heftige Schauer', '🌧️'],
      85: ['Schneeschauer', '🌨️'], 86: ['Starke Schneeschauer', '❄️'],
      95: ['Gewitter', '⛈️'], 96: ['Gewitter mit Hagel', '⛈️'], 99: ['Gewitter mit Hagel', '⛈️']
    };
    return t[code] || ['–', '·'];
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  var TAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  function tagName(iso, index) {
    if (index === 0) return 'Heute';
    if (index === 1) return 'Morgen';
    var d = new Date(iso + 'T12:00:00');
    return TAGE[d.getDay()] + ' ' + d.getDate() + '.' + (d.getMonth() + 1) + '.';
  }
  function grad(n) { return n == null ? '–' : n + '°'; }

  function bauen() {
    overlay = el('div', 'wetter-overlay');
    var box = el('div', 'wetter-modal');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Wetter');
    var kopf = el('div', 'wetter-kopf');
    kopf.appendChild(el('h2', null, 'Wetter'));
    var zu = el('button', 'wetter-zu', '×'); zu.type = 'button'; zu.setAttribute('aria-label', 'Schliessen');
    zu.addEventListener('click', schliesse);
    kopf.appendChild(zu);
    inhalt = el('div', 'wetter-inhalt');
    box.appendChild(kopf); box.appendChild(inhalt);
    overlay.appendChild(box);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) schliesse(); });
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape') schliesse(); });
    document.body.appendChild(overlay);
  }

  function zeige(d) {
    inhalt.textContent = '';
    var j = d.jetzt, w = wetterText(j.code, j.tag);
    var haupt = el('section', 'wetter-jetzt');
    haupt.appendChild(el('div', 'wetter-ort', d.ort + ' · ' + d.hoehe + ' m ü. M.'));
    var zeile = el('div', 'wetter-jetzt-zeile');
    zeile.appendChild(el('span', 'wetter-icon-gross', w[1]));
    zeile.appendChild(el('span', 'wetter-temp', grad(j.temp)));
    haupt.appendChild(zeile);
    haupt.appendChild(el('div', 'wetter-text', w[0] + (j.gefuehlt != null ? ' · gefühlt ' + grad(j.gefuehlt) : '')));
    var fakten = el('div', 'wetter-fakten');
    function fakt(titel, wert) { var f = el('div', 'wetter-fakt'); f.appendChild(el('small', null, titel)); f.appendChild(el('strong', null, wert)); fakten.appendChild(f); }
    fakt('Wind', j.wind != null ? j.wind + ' km/h' : '–');
    fakt('Böen', j.boeen != null ? j.boeen + ' km/h' : '–');
    fakt('Schneehöhe', j.schneehoeheCm != null ? j.schneehoeheCm + ' cm' : '–');
    var heute = d.tage[0];
    if (heute) { fakt('Sonne', heute.sonnenaufgang + ' – ' + heute.sonnenuntergang); }
    haupt.appendChild(fakten);
    inhalt.appendChild(haupt);

    inhalt.appendChild(el('h3', 'wetter-titel', 'Nächste 24 Stunden'));
    var leiste = el('div', 'wetter-stunden');
    d.stunden.forEach(function(s) {
      var k = el('div', 'wetter-stunde');
      k.appendChild(el('small', null, s.zeit));
      k.appendChild(el('span', 'wetter-icon', wetterText(s.code, true)[1]));
      k.appendChild(el('strong', null, grad(s.temp)));
      k.appendChild(el('small', 'wetter-regen', s.regenWahrsch != null && s.regenWahrsch > 0 ? s.regenWahrsch + '%' : ''));
      leiste.appendChild(k);
    });
    inhalt.appendChild(leiste);

    inhalt.appendChild(el('h3', 'wetter-titel', 'Nächste 7 Tage'));
    var liste = el('div', 'wetter-tage');
    d.tage.forEach(function(t, i) {
      var z = el('div', 'wetter-tag');
      z.appendChild(el('span', 'wetter-tag-name', tagName(t.datum, i)));
      z.appendChild(el('span', 'wetter-icon', wetterText(t.code, true)[1]));
      var mitte = el('span', 'wetter-tag-text', wetterText(t.code, true)[0]);
      var nied = [];
      if (t.schnee > 0) nied.push('❄ ' + t.schnee + ' cm'); else if (t.regen > 0) nied.push('💧 ' + t.regen + ' mm');
      if (nied.length) mitte.appendChild(el('small', null, nied.join(' ')));
      z.appendChild(mitte);
      z.appendChild(el('span', 'wetter-tag-temp', grad(t.max) + ' / ' + grad(t.min)));
      liste.appendChild(z);
    });
    inhalt.appendChild(liste);

    var stand = new Date(d.stand);
    inhalt.appendChild(el('p', 'wetter-quelle', 'Quelle: ' + (d.quelle || 'Open-Meteo') + ' · Stand ' + stand.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }) +
      (d.veraltet ? ' · ⚠ ältere Daten (der Wetterdienst antwortet gerade nicht)' : '')));
  }

  function oeffne() {
    if (!overlay) bauen();
    overlay.classList.add('offen'); document.body.style.overflow = 'hidden';
    inhalt.textContent = '';
    inhalt.appendChild(el('p', 'wetter-laden', 'Wetter wird geladen …'));
    fetch('/api/wetter', { credentials: 'same-origin' })
      .then(function(r) { return r.json().then(function(d) { if (!r.ok) throw new Error(d.error || 'Fehler'); return d; }); })
      .then(zeige)
      .catch(function(e) {
        inhalt.textContent = '';
        inhalt.appendChild(el('p', 'wetter-fehler', (navigator.onLine === false ? 'Keine Internetverbindung – das Wetter kann offline nicht angezeigt werden.' : (e.message || 'Das Wetter kann gerade nicht geladen werden.'))));
      });
  }
  function schliesse() { if (overlay) overlay.classList.remove('offen'); document.body.style.overflow = ''; }

  return { oeffne: oeffne, schliesse: schliesse, _wetterText: wetterText };
})();
