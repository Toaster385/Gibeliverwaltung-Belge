// Excel-Ansicht für "Aktuelle Belegung" und "Gerichte" – gemeinsam genutzt von der App und vom Admin-Bereich.
// Zeigt hochgeladene Excel-Dateien als Tabelle im Design der Website: Blätter als Reiter, Suche, Download,
// korrekte Datumsanzeige, verbundene Zellen, feste Kopfzeile/erste Spalte, frühere Versionen.
(function () {
  var bereiche = {};   // key -> { cfg, el, wb, blatt }
  var toast = function () {};
  var XLSX_SRC = '/vendor/xlsx.full.min.js';
  var MAX_ZEILEN = 2000;
  var BERG = '<svg viewBox="0 0 120 72" width="96" height="58" aria-hidden="true"><path d="M0 72L30 24l14 18 16-30 22 36 10-12 28 36z" fill="#6FA3BF"/><path d="M60 12L50 30l6-3 4 5 5-4 6 3z" fill="#fff"/><path d="M0 72L22 44l12 14 14-20 18 34z" fill="#2F4A3A"/></svg>';

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, '');
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function zeit(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }
  function xhrJson(methode, url, body, cb, header) {
    var x = new XMLHttpRequest();
    x.open(methode, url, true);
    if (header) for (var h in header) x.setRequestHeader(h, header[h]);
    x.onload = function() { var d = null; try { d = JSON.parse(x.responseText); } catch (e) {} cb(x.status, d); };
    x.onerror = function() { cb(0, null); };
    x.send(body || null);
  }

  // ---------- Excel-Bibliothek (lokal ausgeliefert) ----------
  var xlsxLaden = null;
  function ladeXLSX() {
    if (window.XLSX) return Promise.resolve();
    if (!xlsxLaden) xlsxLaden = new Promise(function(res, rej) {
      var s = document.createElement('script');
      s.src = XLSX_SRC; s.onload = res; s.onerror = function() { xlsxLaden = null; rej(new Error('Excel-Bibliothek konnte nicht geladen werden')); };
      document.head.appendChild(s);
    });
    return xlsxLaden;
  }

  // ---------- Tabelle aufbauen ----------
  function z2(n) { return ('0' + n).slice(-2); }
  // Excel-Datumszahl -> "TT.MM.JJJJ" (mit Uhrzeit, falls vorhanden)
  function datumText(serial) {
    var p = window.XLSX.SSF.parse_date_code(serial);
    if (!p) return String(serial);
    var d = z2(p.d) + '.' + z2(p.m) + '.' + p.y;
    var zeit = z2(p.H) + ':' + z2(p.M);
    if (serial < 1) return zeit;
    return (serial % 1 && (p.H || p.M)) ? d + ' ' + zeit : d;
  }
  function zellText(c) {
    if (!c) return { t: '', zahl: false };
    // Datum/Zeit immer als TT.MM.JJJJ (Excel/SheetJS würden sonst Zahlen oder US-Format zeigen)
    if (c.t === 'n' && c.z && window.XLSX.SSF && window.XLSX.SSF.is_date(c.z)) {
      try { return { t: datumText(c.v), zahl: false }; } catch (e) {}
    }
    if (c.t === 'd' && c.v instanceof Date) return { t: c.v.toLocaleDateString('de-CH'), zahl: false };
    if (c.t === 'b') return { t: c.v ? 'Ja' : 'Nein', zahl: false };
    var text = c.w != null ? c.w : (c.v == null ? '' : String(c.v));
    return { t: String(text), zahl: c.t === 'n' };
  }

  function blattZuGrid(ws) {
    var out = { zeilen: [], spalten: 0, abgeschnitten: false };
    if (!ws || !ws['!ref']) return out;
    var X = window.XLSX, r = X.utils.decode_range(ws['!ref']);
    var merges = {}, bedeckt = {};
    (ws['!merges'] || []).forEach(function(m) {
      merges[m.s.r + ',' + m.s.c] = { cs: m.e.c - m.s.c + 1, rs: m.e.r - m.s.r + 1 };
      for (var rr = m.s.r; rr <= m.e.r; rr++) for (var cc = m.s.c; cc <= m.e.c; cc++) if (rr !== m.s.r || cc !== m.s.c) bedeckt[rr + ',' + cc] = true;
    });
    var rowInfo = ws['!rows'] || [], colInfo = ws['!cols'] || [];
    var raw = [], letzteSpalte = -1, letzteZeile = -1;
    for (var R = r.s.r; R <= r.e.r; R++) {
      if (rowInfo[R] && rowInfo[R].hidden) continue;
      var zeile = [], leer = true;
      for (var C = r.s.c; C <= r.e.c; C++) {
        if (colInfo[C] && colInfo[C].hidden) continue;
        var key = R + ',' + C;
        if (bedeckt[key]) { zeile.push({ skip: true }); continue; }
        var z = zellText(ws[X.utils.encode_cell({ r: R, c: C })]);
        var m = merges[key];
        var rohZelle = ws[X.utils.encode_cell({ r: R, c: C })];
        var cell = { t: z.t.replace(/\s+$/g, ''), zahl: z.zahl, cs: m ? m.cs : 1, rs: m ? m.rs : 1, v: rohZelle && rohZelle.t === 'n' ? rohZelle.v : null };
        if (cell.t !== '') { leer = false; if (C - r.s.c > letzteSpalte) letzteSpalte = C - r.s.c; }
        zeile.push(cell);
      }
      if (!leer) letzteZeile = raw.length;
      raw.push(zeile);
    }
    out.spalten = letzteSpalte + 1;
    out.zeilen = raw.slice(0, letzteZeile + 1).map(function(z) { return z.slice(0, out.spalten); });
    // führende leere Spalten entfernen
    var erste = 0;
    while (erste < out.spalten && out.zeilen.every(function(z) { return !z[erste] || z[erste].skip || z[erste].t === ''; })) erste++;
    if (erste) { out.zeilen = out.zeilen.map(function(z) { return z.slice(erste); }); out.spalten -= erste; }
    if (out.zeilen.length > MAX_ZEILEN + 1) { out.abgeschnitten = out.zeilen.length; out.zeilen = out.zeilen.slice(0, MAX_ZEILEN + 1); }
    return out;
  }

  function tabelleHTML(grid) {
    if (!grid.zeilen.length) return '<div class="xl-leer">Dieses Blatt ist leer.</div>';
    var n = grid.spalten;
    var gefuellt = function(z) { return z.filter(function(c) { return c && !c.skip && c.t !== ''; }).length; };
    // Kopfzeile = erste Zeile mit mindestens 2 gefüllten Zellen (Zeilen davor sind Titel)
    var kopf = -1;
    for (var i = 0; i < Math.min(grid.zeilen.length, 12); i++) if (gefuellt(grid.zeilen[i]) >= 2) { kopf = i; break; }
    if (kopf < 0 && n === 1) kopf = 0;
    // Spalten, deren Überschrift nach Datum klingt: nackte Excel-Datumszahlen (z.B. 46017) als Datum anzeigen,
    // auch wenn die Datei kein Datumsformat mitliefert
    if (kopf >= 0) {
      var datumsSpalte = {}, spaltenIndex = 0;
      grid.zeilen[kopf].forEach(function(c, ci) {
        if (c && !c.skip && /datum|anreise|abreise|ankunft|abfahrt|^von$|^bis$|checkin|checkout|geburtstag|faellig|termin|date/.test(norm(c.t))) datumsSpalte[ci] = true;
      });
      grid.zeilen.forEach(function(z, ri) {
        if (ri <= kopf) return;
        z.forEach(function(c, ci) {
          if (datumsSpalte[ci] && c && !c.skip && c.v != null && c.v > 30000 && c.v < 80000 && Math.floor(c.v) === c.v && /^\d+$/.test(c.t)) {
            try { c.t = datumText(c.v); c.zahl = false; } catch (e) {}
          }
        });
      });
    }
    var html = '<div class="xl-scroll"><table class="xl-tabelle">';
    var tbody = [], titelTexte = [];
    grid.zeilen.forEach(function(z, ri) {
      if (ri === kopf) {
        html += '<thead><tr>' + z.map(function(c, ci) {
          if (!c || c.skip) return '';
          var zahl = false;
          return '<th scope="col"' + (c.cs > 1 ? ' colspan="' + c.cs + '"' : '') + (zahl ? ' class="zahl"' : '') + '>' + esc(c.t) + '</th>';
        }).join('') + '</tr></thead>';
        return;
      }
      if (gefuellt(z) === 0) return;
      var nurTitel = ri < kopf || (kopf < 0 && gefuellt(z) === 1 && ri < 3);
      if (nurTitel) {
        var text = z.filter(function(c) { return c && !c.skip && c.t !== ''; }).map(function(c) { return c.t; }).join(' · ');
        if (ri < kopf) titelTexte.push(text);   // Titel über der Kopfzeile stehen oberhalb der Tabelle
        else tbody.push('<tr class="xl-titelzeile" data-t=""><td class="xl-titel" colspan="' + n + '">' + esc(text) + '</td></tr>');
        return;
      }
      var such = '';
      tbody.push('<tr data-t="' + '%S%' + '">' + z.map(function(c) {
        if (!c || c.skip) return '';
        such += ' ' + c.t;
        var kl = (c.zahl ? 'zahl ' : '') + (c.t.length > 40 ? 'lang ' : '') + (c.t.indexOf('\n') >= 0 ? 'zeilen ' : '');
        return '<td' + (kl ? ' class="' + kl.trim() + '"' : '') + (c.cs > 1 ? ' colspan="' + c.cs + '"' : '') + (c.rs > 1 ? ' rowspan="' + c.rs + '"' : '') + '>' + esc(c.t) + '</td>';
      }).join('').replace(/^/, '') + '</tr>');
      tbody[tbody.length - 1] = tbody[tbody.length - 1].replace('%S%', esc(such.toLowerCase().trim()));
    });
    html += '<tbody>' + tbody.join('') + '</tbody></table></div>';
    if (titelTexte.length) html = '<div class="xl-titelblock">' + titelTexte.map(function(t) { return '<h3>' + esc(t) + '</h3>'; }).join('') + '</div>' + html;
    if (grid.abgeschnitten) html += '<p class="xl-hinweis">Es werden die ersten ' + MAX_ZEILEN + ' von ' + grid.abgeschnitten + ' Zeilen angezeigt. Die ganze Datei gibt es über „Herunterladen“.</p>';
    return html;
  }

  // ---------- Modal ----------
  function baue(cfg) {
    var el = document.createElement('div');
    el.className = 'xl-overlay';
    el.id = 'xl-' + cfg.key;
    el.innerHTML =
      '<div class="xl-modal" role="dialog" aria-modal="true" aria-labelledby="xl-' + cfg.key + '-titel">' +
        '<div class="xl-kopf"><h2 id="xl-' + cfg.key + '-titel">' + esc(cfg.titel) + '</h2>' +
          '<button type="button" class="xl-schliessen" aria-label="Schliessen">&times;</button></div>' +
        (cfg.ansichten ? '<div class="xl-ansichten" role="tablist"></div><div class="xl-extra"></div>' : '') +
        '<div class="xl-excel">' +
        '<div class="xl-leiste" hidden>' +
          '<div class="xl-info"></div>' +
          '<div class="xl-werkzeuge">' +
            '<input type="search" class="input-field xl-suche" placeholder="In der Tabelle suchen …" aria-label="In der Tabelle suchen" autocomplete="off">' +
            '<span class="xl-treffer" aria-live="polite"></span>' +
            '<a class="xl-btn xl-download" href="#" download>Herunterladen</a>' +
          '</div></div>' +
        '<div class="xl-tabs" role="tablist" hidden></div>' +
        '<div class="xl-inhalt"></div>' +
        '<div class="xl-schreiben hidden">' +
          '<div class="xl-upload">' +
            '<label for="xl-' + cfg.key + '-datei">Hochladen / ersetzen:</label>' +
            '<input type="file" id="xl-' + cfg.key + '-datei" accept=".xlsx,.xls,.ods">' +
            '<button type="button" class="xl-btn xl-btn-primary xl-hochladen">Hochladen</button>' +
            '<button type="button" class="xl-btn xl-btn-danger xl-entfernen">Aus Anzeige entfernen</button>' +
          '</div>' +
          '<div class="xl-meldung" role="status" style="display:none"></div>' +
          '<div class="xl-versionen"></div>' +
        '</div>' +
        '</div>' +
      '</div>';
    cfg.mount.appendChild(el);
    var b = { cfg: cfg, el: el, wb: null, blatt: 0, info: null };
    var q = function(s) { return el.querySelector(s); };
    q('.xl-schliessen').addEventListener('click', function() { schliesse(cfg.key); });
    el.addEventListener('click', function(e) { if (e.target === el) schliesse(cfg.key); });
    q('.xl-hochladen').addEventListener('click', function() { hochladen(b); });
    q('.xl-entfernen').addEventListener('click', function() {
      if (!confirm('„' + cfg.titel + '“ aus der Anzeige entfernen?\n(Die Datei bleibt als frühere Version erhalten und kann wiederhergestellt werden.)')) return;
      xhrJson('DELETE', cfg.api, null, function(st) { if (st === 200) lade(b); else toast('Fehler beim Entfernen', 'error'); });
    });
    q('.xl-suche').addEventListener('input', function() { filtere(b); });
    bereiche[cfg.key] = b;
    if (cfg.ansichten) {
      b.ansichten = cfg.ansichten.concat([{ id: 'excel', titel: 'Excel-Datei' }]);
      var leiste = q('.xl-ansichten');
      leiste.innerHTML = b.ansichten.map(function(a) { return '<button type="button" role="tab" class="xl-tab" data-a="' + a.id + '">' + esc(a.titel) + '</button>'; }).join('');
      leiste.querySelectorAll('.xl-tab').forEach(function(t) { t.addEventListener('click', function() { zeigeAnsicht(b, t.dataset.a); }); });
    }
  }

  function zeigeAnsicht(b, id) {
    var el = b.el, q = function(s) { return el.querySelector(s); };
    b.ansicht = id;
    el.querySelectorAll('.xl-ansichten .xl-tab').forEach(function(t) { t.setAttribute('aria-selected', String(t.dataset.a === id)); });
    var excel = id === 'excel';
    q('.xl-excel').style.display = excel ? 'contents' : 'none';
    var extra = q('.xl-extra'); extra.style.display = excel ? 'none' : '';
    if (excel) { lade(b); return; }
    var a = b.ansichten.filter(function(x) { return x.id === id; })[0];
    extra.innerHTML = '';
    if (a && a.render) a.render(extra, { toast: toast, neuLaden: function() { zeigeAnsicht(b, id); } });
  }

  function oeffne(key) {
    var b = bereiche[key]; if (!b) return;
    b.el.classList.add('active');
    b.el.querySelector('.xl-suche').value = '';
    if (b.ansichten) zeigeAnsicht(b, b.ansicht && b.ansicht !== 'excel' ? b.ansicht : b.ansichten[0].id); else lade(b);
    setTimeout(function() { b.el.querySelector('.xl-schliessen').focus(); }, 50);
  }
  function schliesse(key) { var b = bereiche[key]; if (b) b.el.classList.remove('active'); }
  function schliesseAlle() { Object.keys(bereiche).forEach(schliesse); }

  function lade(b) {
    var q = function(s) { return b.el.querySelector(s); };
    q('.xl-inhalt').innerHTML = '<p class="xl-hinweis" style="text-align:center;padding:30px 0;">Wird geladen …</p>';
    q('.xl-leiste').hidden = true; q('.xl-tabs').hidden = true; q('.xl-treffer').textContent = '';
    xhrJson('GET', b.cfg.api, null, function(status, info) {
      if (status !== 200 || !info) { q('.xl-inhalt').innerHTML = '<div class="xl-leer">Konnte nicht geladen werden.</div>'; return; }
      b.info = info;
      zeigeSchreibbereich(b, info);
      if (!info.vorhanden) {
        q('.xl-inhalt').innerHTML = '<div class="xl-leer">' + BERG + '<p>' + esc(b.cfg.leer) + '</p>' +
          (info.kannSchreiben ? '<p class="xl-hinweis">Lade unten eine Excel-Datei hoch.</p>' : '') + '</div>';
        return;
      }
      q('.xl-leiste').hidden = false;
      q('.xl-info').innerHTML = '<strong>' + esc(info.dateiname) + '</strong><br>' +
        (info.hochgeladen_am ? 'Hochgeladen ' + esc(zeit(info.hochgeladen_am)) + (info.hochgeladen_von ? ' von ' + esc(info.hochgeladen_von) : '') : '');
      var dl = q('.xl-download'); dl.href = b.cfg.api + '/datei?download=1'; dl.setAttribute('download', info.dateiname || '');
      ladeDatei(b);
    });
  }

  function ladeDatei(b) {
    var q = function(s) { return b.el.querySelector(s); };
    var x = new XMLHttpRequest();
    x.open('GET', b.cfg.api + '/datei', true);
    x.responseType = 'arraybuffer';
    x.onload = function() {
      if (x.status !== 200) { q('.xl-inhalt').innerHTML = '<div class="xl-leer">Die Datei konnte nicht geladen werden.</div>'; return; }
      ladeXLSX().then(function() {
        try {
          b.wb = window.XLSX.read(new Uint8Array(x.response), { type: 'array', cellNF: true });
        } catch (e) { q('.xl-inhalt').innerHTML = '<div class="xl-leer">Die Datei konnte nicht gelesen werden (' + esc(e.message || 'unbekannter Fehler') + ').<br>Über „Herunterladen“ lässt sie sich in Excel öffnen.</div>'; return; }
        var gemerkt = 0;
        try { gemerkt = parseInt(sessionStorage.getItem('xl-blatt-' + b.cfg.key + '-' + (b.info.hochgeladen_am || ''))) || 0; } catch (e) {}
        zeigeBlatt(b, Math.min(gemerkt, b.wb.SheetNames.length - 1));
      }).catch(function(e) { q('.xl-inhalt').innerHTML = '<div class="xl-leer">' + esc(e.message) + '</div>'; });
    };
    x.onerror = function() { q('.xl-inhalt').innerHTML = '<div class="xl-leer">Keine Verbindung.</div>'; };
    x.send();
  }

  function zeigeBlatt(b, i) {
    var q = function(s) { return b.el.querySelector(s); };
    b.blatt = i;
    try { sessionStorage.setItem('xl-blatt-' + b.cfg.key + '-' + (b.info.hochgeladen_am || ''), String(i)); } catch (e) {}
    var namen = b.wb.SheetNames;
    var tabs = q('.xl-tabs');
    if (namen.length > 1) {
      tabs.hidden = false;
      tabs.innerHTML = namen.map(function(n, k) { return '<button type="button" role="tab" class="xl-tab" aria-selected="' + (k === i) + '" data-i="' + k + '">' + esc(n) + '</button>'; }).join('');
      tabs.querySelectorAll('.xl-tab').forEach(function(t) { t.addEventListener('click', function() { zeigeBlatt(b, parseInt(t.dataset.i)); }); });
    } else { tabs.hidden = true; }
    q('.xl-inhalt').innerHTML = tabelleHTML(blattZuGrid(b.wb.Sheets[namen[i]]));
    filtere(b);
  }

  function filtere(b) {
    var term = b.el.querySelector('.xl-suche').value.trim().toLowerCase();
    var zeilen = b.el.querySelectorAll('.xl-tabelle tbody tr');
    var treffer = 0, gesamt = 0;
    zeilen.forEach(function(tr) {
      var istTitel = tr.classList.contains('xl-titelzeile');
      if (!istTitel) gesamt++;
      var zeigen = !term || (!istTitel && (tr.getAttribute('data-t') || '').indexOf(term) >= 0);
      tr.classList.toggle('xl-aus', !zeigen);
      if (zeigen && !istTitel && term) treffer++;
    });
    b.el.querySelector('.xl-treffer').textContent = term ? (treffer + ' von ' + gesamt) : '';
  }

  // ---------- Hochladen, Versionen ----------
  function meldung(b, text, fehler) {
    var m = b.el.querySelector('.xl-meldung');
    m.textContent = text; m.style.color = fehler ? 'var(--rot-dunkel)' : 'var(--tanne)'; m.style.display = 'block';
    if (!fehler) setTimeout(function() { m.style.display = 'none'; }, 3500);
  }

  function hochladen(b) {
    var input = b.el.querySelector('input[type=file]');
    if (!input.files || !input.files[0]) return meldung(b, 'Bitte eine Excel-Datei auswählen.', true);
    var btn = b.el.querySelector('.xl-hochladen');
    btn.disabled = true; btn.textContent = 'Wird hochgeladen …';
    var fd = new FormData(); fd.append('datei', input.files[0]);
    xhrJson('POST', b.cfg.api, fd, function(st, d) {
      btn.disabled = false; btn.textContent = 'Hochladen';
      if (st !== 200) return meldung(b, (d && d.error) || 'Fehler beim Hochladen.', true);
      input.value = '';
      meldung(b, '✓ Hochgeladen – die bisherige Version bleibt als frühere Version erhalten.');
      lade(b);
    });
  }

  function zeigeSchreibbereich(b, info) {
    var box = b.el.querySelector('.xl-schreiben');
    if (!info.kannSchreiben) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    b.el.querySelector('.xl-entfernen').style.display = info.vorhanden ? '' : 'none';
    var v = b.el.querySelector('.xl-versionen');
    var liste = info.versionen || [];
    if (!liste.length) { v.innerHTML = ''; return; }
    v.innerHTML = '<details><summary>Versionen (' + liste.length + ')</summary><ul>' + liste.map(function(x) {
      return '<li><div><strong>' + esc(x.dateiname) + '</strong> ' + (x.aktiv ? '<span class="xl-badge">Wird angezeigt</span>' : '') +
        '<div class="xl-vmeta">' + esc(zeit(x.hochgeladen_am)) + (x.hochgeladen_von ? ' · ' + esc(x.hochgeladen_von) : '') + '</div></div><div class="xl-vaktionen" style="display:flex;gap:6px;flex-wrap:wrap;">' +
        (x.aktiv ? '' : '<button type="button" class="xl-btn" data-v="akt" data-id="' + x.id + '">Wiederherstellen</button>') +
        '<a class="xl-btn" href="' + b.cfg.api + '/datei?version=' + x.id + '&download=1">Herunterladen</a>' +
        (x.aktiv ? '' : '<button type="button" class="xl-btn xl-btn-danger" data-v="weg" data-id="' + x.id + '">Entfernen</button>') + '</div></li>';
    }).join('') + '</ul><p class="xl-hinweis">Es bleiben immer die letzten 5 Versionen erhalten.</p></details>';
    v.querySelectorAll('[data-v]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var id = btn.dataset.id;
        if (btn.dataset.v === 'akt') {
          xhrJson('POST', b.cfg.api + '/versionen/' + id + '/aktivieren', null, function(st) { if (st === 200) { toast('Version wiederhergestellt', 'success'); lade(b); } else toast('Fehler', 'error'); });
        } else if (confirm('Diese frühere Version endgültig entfernen?')) {
          xhrJson('DELETE', b.cfg.api + '/versionen/' + id, null, function(st) { if (st === 200) lade(b); else toast('Fehler', 'error'); });
        }
      });
    });
  }

  function init(opt) {
    toast = opt.toast || toast;
    (opt.bereiche || []).forEach(function(c) { baue({ key: c.key, titel: c.titel, api: c.api, leer: c.leer, ansichten: c.ansichten, mount: opt.mount || document.body }); });
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape') schliesseAlle(); });
  }

  window.ExcelAnsicht = { init: init, oeffne: oeffne, schliesse: schliesse, schliesseAlle: schliesseAlle, ladeXLSX: ladeXLSX };
})();
