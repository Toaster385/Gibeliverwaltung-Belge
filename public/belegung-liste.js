// Belegungsliste: Auswertung der Excel-Belegung (Zimmer-Raster oder einfache Liste), Anzeige als Liste / "Pro Tag",
// Pflege direkt in der App und die Karte "Im Gibeli". Gemeinsam genutzt von der App und vom Admin-Bereich.
(function () {
  'use strict';

  // =====================================================================
  // 1) Excel auswerten
  // =====================================================================
  // Unterstützt:
  //  a) Zimmer-Raster: links eine Datumsspalte (ein Tag pro Zeile), rechts je Zimmer eine Spalte; über den Zimmern
  //     steht die Kapazität ("4 Personen"), unter den Zimmern die Gäste. Steht ein Name an mehreren Tagen hintereinander,
  //     ist das ein Aufenthalt. "Name 4" = 4 Personen, "Name" = 1 Person, "Anna & Ben" = 2 Personen.
  //     "X Ab / Y An" und "X / Y" an einem Tag = Wechsel (X reist ab, Y reist an).
  //  b) Einfache Liste mit Spalten wie Anreise/Abreise (oder Von/Bis), Name, Personen.
  var INITIALEN = /^[A-ZÄÖÜ](\s*[+&]\s*[A-ZÄÖÜ])*$/;

  function z2(n) { return ('0' + n).slice(-2); }
  function iso(y, m, d) { return y + '-' + z2(m) + '-' + z2(d); }

  function zelle(ws, R, C) { return ws[window.XLSX.utils.encode_cell({ r: R, c: C })]; }
  function zellText(c) {
    if (!c || c.v == null) return '';
    var t = c.w != null ? c.w : c.v;
    return String(t).replace(/\s+/g, ' ').trim();
  }
  // Excel-Datum -> ISO (nur wenn die Zelle wirklich ein Datum ist)
  function zellDatum(c) {
    if (!c) return null;
    var X = window.XLSX;
    if (c.t === 'n' && c.z && X.SSF.is_date(c.z) && c.v >= 1) {
      var p = X.SSF.parse_date_code(c.v);
      return p ? iso(p.y, p.m, p.d) : null;
    }
    if (c.t === 'd' && c.v instanceof Date) return iso(c.v.getFullYear(), c.v.getMonth() + 1, c.v.getDate());
    if (c.t === 's') {
      var m = String(c.v).match(/^\s*(?:[A-Za-zäöü]{2,10}\.?,?\s+)?(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})\s*$/);
      if (m) return iso(+m[3], +m[2], +m[1]);
    }
    return null;
  }
  function tageZwischen(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000); }

  // Name + Personenzahl + Markierung aus einem Zellteil
  function teilAuswerten(t) {
    t = t.replace(/\s+/g, ' ').trim();
    if (!t) return null;
    var marker = null;
    var m = t.match(/^(.*?)\s+(ab|an|abreise|anreise)\.?$/i);
    if (m && m[1]) { marker = /^ab/i.test(m[2]) ? 'ab' : 'an'; t = m[1].trim(); }
    var personen = null;
    m = t.match(/^(.*?)\s*[x×]?\s*(\d{1,3})$/i);
    if (m && m[1] && /\D/.test(m[1])) { personen = parseInt(m[2], 10); t = m[1].trim(); }
    t = t.replace(/\s*[&+]\s*$/, '').trim();
    if (!t) return null;
    var teile = t.split(/\s*(?:&|\+|\bund\b|,)\s*/i).filter(Boolean);
    var initialen = INITIALEN.test(t);
    var anzahlNamen = Math.max(1, teile.length);
    // Anzeige: "Anna&Ben" -> "Anna & Ben"; Initialen "D + M" -> "D+M"
    var anzeige = initialen ? teile.join('+') : teile.join(' & ');
    var key = teile.length > 1 || initialen
      ? teile.map(function(x) { return x.charAt(0).toLowerCase(); }).join('')
      : t.toLowerCase();
    return { name: anzeige, personen: personen, namen: anzahlNamen, key: key, initialen: initialen, marker: marker };
  }
  function zellInhalt(text) {
    return text.split('/').map(teilAuswerten).filter(Boolean);
  }

  function spaltenLabel(roh) {
    var t = String(roh || '').replace(/\s+/g, ' ').trim();
    if (/^mass(e|enlager)?\b\s*\d*$/i.test(t)) return 'Massenlager';
    return t;
  }

  // Zimmer-Raster auswerten -> { eintraege, hinweise }
  function rasterAuswerten(ws) {
    var X = window.XLSX, out = { eintraege: [], hinweise: [] };
    if (!ws || !ws['!ref']) return out;
    var r = X.utils.decode_range(ws['!ref']);
    var maxR = Math.min(r.e.r, r.s.r + 3000);
    // Datumsspalte: die Spalte mit den meisten Datumszellen
    var zaehler = {};
    for (var R = r.s.r; R <= maxR; R++) for (var C = r.s.c; C <= Math.min(r.e.c, r.s.c + 6); C++) if (zellDatum(zelle(ws, R, C))) zaehler[C] = (zaehler[C] || 0) + 1;
    var datumsSpalte = -1, meiste = 0;
    Object.keys(zaehler).forEach(function(k) { if (zaehler[k] > meiste) { meiste = zaehler[k]; datumsSpalte = +k; } });
    if (datumsSpalte < 0 || meiste < 3) return out;

    // Blöcke: zusammenhängende Zeilen mit Datum
    var bloecke = [], aktuell = null;
    for (var R2 = r.s.r; R2 <= maxR; R2++) {
      var d = zellDatum(zelle(ws, R2, datumsSpalte));
      if (d) { if (!aktuell) { aktuell = { von: R2, bis: R2 }; bloecke.push(aktuell); } else aktuell.bis = R2; }
      else aktuell = null;
    }
    var maxC = r.e.c;
    bloecke.forEach(function(b) {
      if (b.bis - b.von < 2) return;
      // Kopfzeile / Kapazitäten / Titel oberhalb des Blocks
      var kopf = {}, kap = {}, blockLabel = '';
      var oben = b.von - 1;
      if (oben >= r.s.r) {
        var texte = [];
        for (var C3 = datumsSpalte + 1; C3 <= maxC; C3++) { var t = zellText(zelle(ws, oben, C3)); if (t) texte.push([C3, t]); }
        if (texte.length >= 2) {
          texte.forEach(function(x) { kopf[x[0]] = x[1]; });
          var oben2 = oben - 1;
          if (oben2 >= r.s.r) for (var C4 = datumsSpalte + 1; C4 <= maxC; C4++) {
            var tk = zellText(zelle(ws, oben2, C4)), mk = tk.match(/(\d+)\s*(pers|pl[aä]tz|bett)/i);
            if (mk) kap[C4] = parseInt(mk[1], 10);
          }
        } else if (texte.length === 1) {
          blockLabel = texte[0][1].replace(/\s*\d+\s*$/, '').trim();   // z.B. "Massenlager groß 12" -> "Massenlager groß"
        }
      }
      // Läufe je Spalte
      var laeufe = [];
      for (var C5 = datumsSpalte + 1; C5 <= maxC; C5++) {
        var label = kopf[C5] ? spaltenLabel(kopf[C5]) : blockLabel;
        var offen = {};
        for (var R3 = b.von; R3 <= b.bis; R3++) {
          var tag = zellDatum(zelle(ws, R3, datumsSpalte));
          var teile = zellInhalt(zellText(zelle(ws, R3, C5)));
          var vorhanden = {};
          teile.forEach(function(tl) {
            vorhanden[tl.key] = true;
            var lauf = offen[tl.key];
            if (lauf && tageZwischen(lauf.bis, tag) <= 1) {
              lauf.bis = tag;
              if (tl.personen != null) lauf.personen = Math.max(lauf.personen || 0, tl.personen);
              if (!tl.initialen && lauf.initialen) { lauf.name = tl.name; lauf.initialen = false; }
            } else {
              if (lauf) laeufe.push(lauf);
              offen[tl.key] = { key: tl.key, name: tl.name, initialen: tl.initialen, personen: tl.personen, namen: tl.namen, von: tag, bis: tag, spalte: C5, zimmer: label, kapazitaet: kap[C5] || null };
            }
          });
          Object.keys(offen).forEach(function(k) { if (!vorhanden[k]) { laeufe.push(offen[k]); delete offen[k]; } });
        }
        Object.keys(offen).forEach(function(k) { laeufe.push(offen[k]); });
      }
      // gleiche Gäste in mehreren Spalten (z.B. "Bansi 4" in 4 Massenlager-Plätzen) zu einem Aufenthalt zusammenfassen
      var gruppen = {};
      laeufe.forEach(function(l) { var k = l.key + '|' + l.von + '|' + l.bis; (gruppen[k] = gruppen[k] || []).push(l); });
      Object.keys(gruppen).forEach(function(k) {
        var g = gruppen[k], explizit = null, summe = 0, zimmer = [], name = g[0].name;
        g.forEach(function(l) {
          if (l.personen != null) explizit = Math.max(explizit || 0, l.personen);
          summe += l.namen;
          if (l.zimmer && zimmer.indexOf(l.zimmer) < 0) zimmer.push(l.zimmer);
          if (!l.initialen && g[0].initialen) name = l.name;
        });
        out.eintraege.push({ name: name, personen: explizit != null ? explizit : summe, von: g[0].von, bis: g[0].bis, zimmer: zimmer.join(', ') });
      });
    });
    out.eintraege.sort(function(a, b) { return a.von < b.von ? -1 : a.von > b.von ? 1 : a.name < b.name ? -1 : 1; });
    return out;
  }

  // Einfache Liste (Anreise/Abreise-Spalten)
  var SYN = { von: ['anreise', 'ankunft', 'checkin', 'von', 'beginn', 'start'], bis: ['abreise', 'abfahrt', 'checkout', 'bis', 'ende'],
              personen: ['personen', 'pers', 'anzahl', 'teilnehmer', 'tn', 'koepfe'], name: ['name', 'gast', 'gaeste', 'gruppe', 'verein', 'mieter', 'belegung', 'familie', 'anlass'],
              zimmer: ['zimmer', 'raum', 'schlafplatz', 'unterkunft'] };
  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, ''); }
  function rolle(t) {
    var n = norm(t); if (!n) return null;
    for (var k in SYN) for (var i = 0; i < SYN[k].length; i++) { var s = SYN[k][i]; if (n === s || (s.length >= 5 && n.indexOf(s) >= 0)) return k; }
    return null;
  }
  function listeAuswerten(ws) {
    var X = window.XLSX, out = { eintraege: [], hinweise: [] };
    if (!ws || !ws['!ref']) return out;
    var r = X.utils.decode_range(ws['!ref']), maxR = Math.min(r.e.r, r.s.r + 3000), kopfZeile = -1, rollen = {};
    for (var R = r.s.r; R <= Math.min(maxR, r.s.r + 25); R++) {
      var sp = {};
      for (var C = r.s.c; C <= r.e.c; C++) { var c = zelle(ws, R, C); var ro = c && c.t === 's' ? rolle(zellText(c)) : null; if (ro && sp[ro] === undefined) sp[ro] = C; }
      if (sp.von !== undefined && sp.bis !== undefined) { kopfZeile = R; rollen = sp; break; }
    }
    if (kopfZeile < 0) return out;
    for (var R2 = kopfZeile + 1; R2 <= maxR; R2++) {
      var von = zellDatum(zelle(ws, R2, rollen.von)), bis = zellDatum(zelle(ws, R2, rollen.bis));
      if (!von || !bis || bis < von) continue;
      var name = rollen.name !== undefined ? zellText(zelle(ws, R2, rollen.name)) : '';
      var pc = rollen.personen !== undefined ? zelle(ws, R2, rollen.personen) : null;
      out.eintraege.push({ name: name || 'Gruppe', personen: pc && pc.t === 'n' ? Math.round(pc.v) : (pc ? parseInt(zellText(pc), 10) || null : null),
        von: von, bis: bis, zimmer: rollen.zimmer !== undefined ? zellText(zelle(ws, R2, rollen.zimmer)) : '' });
    }
    return out;
  }

  // Ganze Arbeitsmappe: erst Zimmer-Raster, sonst einfache Liste
  function arbeitsmappeAuswerten(wb) {
    var alle = [], hinweise = [], art = null;
    wb.SheetNames.forEach(function(n) {
      var ws = wb.Sheets[n], r = rasterAuswerten(ws);
      if (r.eintraege.length) { alle = alle.concat(r.eintraege); art = art || 'raster'; return; }
      var l = listeAuswerten(ws);
      if (l.eintraege.length) { alle = alle.concat(l.eintraege); art = art || 'liste'; }
    });
    alle.sort(function(a, b) { return a.von < b.von ? -1 : a.von > b.von ? 1 : a.name < b.name ? -1 : 1; });
    return { eintraege: alle, art: art, hinweise: hinweise };
  }

  // =====================================================================
  // 2) Berechnungen (Übersicht, Pro Tag)
  // =====================================================================
  function heuteIso(d) { d = d || new Date(); return iso(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
  function uebersicht(eintraege, heute) {
    var h = heute || heuteIso();
    var anwesend = eintraege.filter(function(e) { return e.von <= h && e.bis >= h; });
    var kommend = eintraege.filter(function(e) { return e.von > h; }).sort(function(a, b) { return a.von < b.von ? -1 : 1; });
    var abreisen = anwesend.slice().sort(function(a, b) { return a.bis < b.bis ? -1 : a.bis > b.bis ? 1 : 0; });
    function ersterTag(liste, feld) { return liste.length ? liste.filter(function(e) { return e[feld] === liste[0][feld]; }) : []; }
    return {
      heute: h, anwesend: anwesend,
      personen: anwesend.reduce(function(s, e) { return s + (e.personen == null ? 1 : e.personen); }, 0),
      naechsteAbreise: ersterTag(abreisen, 'bis'),
      naechsteAnreise: ersterTag(kommend, 'von')
    };
  }
  function proTag(eintraege) {
    if (!eintraege.length) return [];
    var von = eintraege.reduce(function(m, e) { return e.von < m ? e.von : m; }, eintraege[0].von);
    var bis = eintraege.reduce(function(m, e) { return e.bis > m ? e.bis : m; }, eintraege[0].bis);
    var tage = [], d = new Date(von + 'T00:00:00Z'), ende = new Date(bis + 'T00:00:00Z'), schutz = 0;
    while (d <= ende && schutz++ < 800) {
      var s = d.toISOString().slice(0, 10);
      var da = eintraege.filter(function(e) { return e.von <= s && e.bis >= s; });
      tage.push({ tag: s, personen: da.reduce(function(a, e) { return a + (e.personen == null ? 1 : e.personen); }, 0), eintraege: da });
      d = new Date(d.getTime() + 86400000);
    }
    return tage;
  }

  // =====================================================================
  // 3) Oberfläche: Liste, Pro Tag, Karte "Im Gibeli"
  // =====================================================================
  var WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  var BERG = '<svg viewBox="0 0 120 72" width="96" height="58" aria-hidden="true"><path d="M0 72L30 24l14 18 16-30 22 36 10-12 28 36z" fill="#6FA3BF"/><path d="M60 12L50 30l6-3 4 5 5-4 6 3z" fill="#fff"/><path d="M0 72L22 44l12 14 14-20 18 34z" fill="#2F4A3A"/></svg>';
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function wochentag(d) { return WT[new Date(d + 'T00:00:00Z').getUTCDay()]; }
  function datumKurz(d, h) {
    var p = d.split('-');
    return wochentag(d) + ' ' + p[2] + '.' + p[1] + '.' + (p[0] !== (h || heuteIso()).slice(0, 4) ? p[0] : '');
  }
  function tageBis(d, h) { return Math.round((new Date(d + 'T00:00:00Z') - new Date(h + 'T00:00:00Z')) / 86400000); }
  function relativ(d, h) { var n = tageBis(d, h); return n === 0 ? 'heute' : n === 1 ? 'morgen' : n === -1 ? 'gestern' : n > 0 ? 'in ' + n + ' Tagen' : 'vor ' + (-n) + ' Tagen'; }
  function pTxt(e) { return e.personen == null ? '–' : String(e.personen); }

  function api(methode, url, body, cb) {
    var x = new XMLHttpRequest();
    x.open(methode, url, true);
    if (body && !(body instanceof FormData)) x.setRequestHeader('Content-Type', 'application/json');
    x.onload = function() { var d = null; try { d = JSON.parse(x.responseText); } catch (e) {} cb(x.status, d); };
    x.onerror = function() { cb(0, null); };
    x.send(body ? (body instanceof FormData ? body : JSON.stringify(body)) : null);
  }
  function ladeDaten(cb) {
    api('GET', '/api/belegung/liste', null, function(st, d) { cb(st === 200 && d ? d : null); });
  }
  function geaendert() { if (window.BelegungListe && window.BelegungListe._nachAenderung) window.BelegungListe._nachAenderung(); }
  function ladeXLSX() { return window.ExcelAnsicht && ExcelAnsicht.ladeXLSX ? ExcelAnsicht.ladeXLSX() : Promise.reject(new Error('Excel-Bibliothek fehlt')); }

  // ---------- Liste ----------
  function renderListe(host, ctx) {
    var zustand = { jahr: null, suche: '' };
    host.innerHTML = '<p class="bl-hinweis" style="text-align:center;padding:30px 0;">Wird geladen …</p>';
    ladeDaten(function(daten) {
      if (!daten) { host.innerHTML = '<p class="bl-hinweis" style="text-align:center;padding:30px 0;">Konnte nicht geladen werden.</p>'; return; }
      zeichne(daten);
    });

    function zeichne(daten) {
      var h = heuteIso(), schreiben = daten.kannSchreiben;
      var alle = daten.eintraege;
      // Jahre, in denen es Aufenthalte gibt (ein Aufenthalt über den Jahreswechsel zählt in beiden Jahren)
      var jahre = {};
      alle.forEach(function(e) { for (var y = +e.von.slice(0, 4); y <= +e.bis.slice(0, 4); y++) jahre[y] = true; });
      var jahrListe = Object.keys(jahre).map(Number).sort(function(x, y) { return y - x; });
      if (zustand.jahr === null || jahrListe.indexOf(zustand.jahr) < 0) {
        var dieses = +h.slice(0, 4);
        zustand.jahr = jahrListe.indexOf(dieses) >= 0 ? dieses
          : (jahrListe.filter(function(y) { return y <= dieses; })[0] || jahrListe[jahrListe.length - 1] || dieses);
      }
      var jahr = zustand.jahr;
      var sichtbar = alle.filter(function(e) {
        if (e.von.slice(0, 4) > String(jahr) || e.bis.slice(0, 4) < String(jahr)) return false;
        if (zustand.suche) {
          var t = (e.name + ' ' + (e.zimmer || '') + ' ' + (e.notiz || '')).toLowerCase();
          if (t.indexOf(zustand.suche.toLowerCase()) < 0) return false;
        }
        return true;
      });
      var html = '<div class="bl-kopf">' +
        (jahrListe.length ? '<label class="bl-jahr-wrap"><span class="sr-file">Jahr wählen</span><select class="bl-jahr" aria-label="Jahr wählen">' +
          jahrListe.map(function(y) { return '<option value="' + y + '"' + (y === jahr ? ' selected' : '') + '>' + y + '</option>'; }).join('') + '</select></label>' : '') +
        '<input type="search" class="input-field bl-suche" placeholder="Name oder Zimmer suchen …" aria-label="Suchen" value="' + esc(zustand.suche) + '">' +
        (schreiben ? '<div class="bl-aktionen"><button type="button" class="xl-btn xl-btn-primary" data-a="neu">+ Eintrag</button>' +
          '<label class="xl-btn bl-datei" title="Excel-Belegung einlesen">Excel einlesen<input type="file" class="sr-file" accept=".xlsx,.xls,.ods"></label></div>' : '') +
      '</div>';
      if (!sichtbar.length) {
        html += '<div class="bl-leer">' + BERG + '<p>' + (alle.length ? 'Keine Einträge in diesem Jahr.' : 'Noch keine Belegung eingetragen.') + '</p>' +
          (!alle.length && schreiben ? '<p class="bl-hinweis">Lies deine Excel-Belegung ein („Excel einlesen“) oder lege einen Eintrag an.</p>' : '') + '</div>';
      } else {
        html += '<div class="bl-scroll"><table class="bl-tabelle"><thead><tr><th>Name</th><th class="zahl">Personen</th><th>Von</th><th>Bis</th><th>Zimmer</th>' + (schreiben ? '<th></th>' : '') + '</tr></thead><tbody>' +
          sichtbar.map(function(e) {
            var status = e.von <= h && e.bis >= h ? '<span class="bl-badge im-haus">im Haus</span>'
              : e.von > h ? '<span class="bl-badge kommt">kommt ' + relativ(e.von, h) + '</span>' : '<span class="bl-badge vorbei">vorbei</span>';
            return '<tr class="' + (e.von <= h && e.bis >= h ? 'jetzt' : '') + '">' +
              '<td data-l="Name"><strong>' + esc(e.name) + '</strong> ' + status + (e.notiz ? '<div class="bl-notiz">' + esc(e.notiz) + '</div>' : '') + '</td>' +
              '<td data-l="Personen" class="zahl">' + pTxt(e) + '</td>' +
              '<td data-l="Von">' + esc(datumKurz(e.von, h)) + '</td>' +
              '<td data-l="Bis">' + esc(datumKurz(e.bis, h)) + '</td>' +
              '<td data-l="Zimmer">' + esc(e.zimmer || '–') + '</td>' +
              (schreiben ? '<td class="bl-akt"><button type="button" class="xl-btn" data-a="edit" data-id="' + e.id + '" aria-label="Eintrag bearbeiten">Bearbeiten</button></td>' : '') + '</tr>';
          }).join('') + '</tbody></table></div>';
      }
      if (schreiben && daten.staende && daten.staende.length) {
        html += '<details class="bl-staende"><summary>Frühere Stände der Liste (' + daten.staende.length + ')</summary><ul>' + daten.staende.map(function(st) {
          return '<li><span>' + esc(new Date(st.zeit.replace(' ', 'T') + 'Z').toLocaleString('de-CH')) + ' · ' + st.anzahl + ' Einträge · ' + esc(st.grund || '') + (st.von_benutzer ? ' · ' + esc(st.von_benutzer) : '') + '</span>' +
            '<button type="button" class="xl-btn" data-a="stand" data-id="' + st.id + '">Wiederherstellen</button></li>'; }).join('') + '</ul></details>';
      }
      host.innerHTML = html;
      var jahrWahl = host.querySelector('.bl-jahr');
      if (jahrWahl) jahrWahl.addEventListener('change', function() { zustand.jahr = parseInt(jahrWahl.value, 10); zeichne(daten); });
      var such = host.querySelector('.bl-suche');
      such.addEventListener('input', function() {
        zustand.suche = such.value; var pos = such.selectionStart; zeichne(daten);
        var neu = host.querySelector('.bl-suche'); neu.focus(); try { neu.setSelectionRange(pos, pos); } catch (e) {}
      });
      var neu = host.querySelector('[data-a=neu]');
      if (neu) neu.addEventListener('click', function() { formular(host, ctx, daten, null, function() { renderListe(host, ctx); }); });
      host.querySelectorAll('[data-a=edit]').forEach(function(b) {
        b.addEventListener('click', function() {
          var e = alle.filter(function(x) { return String(x.id) === b.dataset.id; })[0];
          formular(host, ctx, daten, e, function() { renderListe(host, ctx); });
        });
      });
      host.querySelectorAll('[data-a=stand]').forEach(function(b) {
        b.addEventListener('click', function() {
          if (!confirm('Diesen früheren Stand der Liste wiederherstellen? Die aktuelle Liste wird vorher gesichert.')) return;
          api('POST', '/api/belegung/liste/staende/' + b.dataset.id + '/wiederherstellen', null, function(st, d) {
            if (st === 200) { ctx.toast('Liste wiederhergestellt', 'success'); geaendert(); renderListe(host, ctx); } else ctx.toast((d && d.error) || 'Fehler', 'error');
          });
        });
      });
      var datei = host.querySelector('.bl-datei input');
      if (datei) datei.addEventListener('change', function() { if (datei.files[0]) importVorschau(host, ctx, daten, datei.files[0]); });
    }
  }

  // ---------- Eintrag anlegen / bearbeiten ----------
  function formular(host, ctx, daten, e, zurueck) {
    var zimmer = {};
    daten.eintraege.forEach(function(x) { if (x.zimmer) x.zimmer.split(', ').forEach(function(z) { zimmer[z] = true; }); });
    host.innerHTML = '<form class="bl-form" novalidate><h3>' + (e ? 'Eintrag bearbeiten' : 'Neuer Eintrag') + '</h3>' +
      '<div class="form-group"><label for="bl-name">Name / Gruppe *</label><input id="bl-name" class="input-field" maxlength="120" value="' + esc(e ? e.name : '') + '"></div>' +
      '<div class="bl-zeile"><div class="form-group"><label for="bl-pers">Personen</label><input id="bl-pers" class="input-field" type="number" inputmode="numeric" min="0" max="999" value="' + (e && e.personen != null ? e.personen : '') + '"></div>' +
      '<div class="form-group"><label for="bl-zimmer">Zimmer</label><input id="bl-zimmer" class="input-field" list="bl-zimmerliste" maxlength="200" value="' + esc(e ? (e.zimmer || '') : '') + '"><datalist id="bl-zimmerliste">' +
        Object.keys(zimmer).map(function(z) { return '<option value="' + esc(z) + '">'; }).join('') + '</datalist></div></div>' +
      '<div class="bl-zeile"><div class="form-group"><label for="bl-von">Von (Anreise) *</label><input id="bl-von" class="input-field" type="date" value="' + (e ? e.von : '') + '"></div>' +
      '<div class="form-group"><label for="bl-bis">Bis (Abreise) *</label><input id="bl-bis" class="input-field" type="date" value="' + (e ? e.bis : '') + '"></div></div>' +
      '<div class="form-group"><label for="bl-notiz">Notiz</label><input id="bl-notiz" class="input-field" maxlength="500" value="' + esc(e ? (e.notiz || '') : '') + '"></div>' +
      '<div class="error-msg hidden" role="alert"></div>' +
      '<div class="bl-formaktionen"><button type="button" class="xl-btn xl-btn-primary" data-a="speichern">Speichern</button>' +
      '<button type="button" class="xl-btn" data-a="abbrechen">Abbrechen</button>' +
      (e ? '<button type="button" class="xl-btn xl-btn-danger" data-a="loeschen">Löschen</button>' : '') + '</div></form>';
    var fehler = host.querySelector('.error-msg');
    function wert(id) { return host.querySelector('#' + id).value.trim(); }
    host.querySelector('[data-a=abbrechen]').addEventListener('click', zurueck);
    host.querySelector('[data-a=speichern]').addEventListener('click', function() {
      var body = { name: wert('bl-name'), personen: wert('bl-pers') === '' ? null : parseInt(wert('bl-pers'), 10), von: wert('bl-von'), bis: wert('bl-bis'), zimmer: wert('bl-zimmer'), notiz: wert('bl-notiz') };
      if (!body.name) { fehler.textContent = 'Bitte einen Namen angeben.'; fehler.classList.remove('hidden'); return; }
      if (!body.von || !body.bis) { fehler.textContent = 'Bitte Anreise und Abreise angeben.'; fehler.classList.remove('hidden'); return; }
      if (body.bis < body.von) { fehler.textContent = 'Die Abreise darf nicht vor der Anreise liegen.'; fehler.classList.remove('hidden'); return; }
      api(e ? 'PUT' : 'POST', '/api/belegung/liste' + (e ? '/' + e.id : ''), body, function(st, d) {
        if (st === 200 || st === 201) { ctx.toast('Gespeichert', 'success'); geaendert(); zurueck(); }
        else { fehler.textContent = (d && d.error) || 'Fehler beim Speichern'; fehler.classList.remove('hidden'); }
      });
    });
    var l = host.querySelector('[data-a=loeschen]');
    if (l) l.addEventListener('click', function() {
      if (!confirm('„' + e.name + '“ aus der Belegung löschen?')) return;
      api('DELETE', '/api/belegung/liste/' + e.id, null, function(st) { if (st === 200) { ctx.toast('Gelöscht', 'success'); geaendert(); zurueck(); } else ctx.toast('Fehler beim Löschen', 'error'); });
    });
    host.querySelector('#bl-name').focus();
  }

  // ---------- Excel einlesen: Vorschau, dann ersetzen ----------
  function importVorschau(host, ctx, daten, file) {
    host.innerHTML = '<p class="bl-hinweis" style="text-align:center;padding:30px 0;">Datei „' + esc(file.name) + '“ wird gelesen …</p>';
    function zurueck() { renderListe(host, ctx); }
    var lesen = new FileReader();
    lesen.onerror = function() { ctx.toast('Datei konnte nicht gelesen werden', 'error'); zurueck(); };
    lesen.onload = function() {
      ladeXLSX().then(function() {
        var wb;
        try { wb = window.XLSX.read(new Uint8Array(lesen.result), { type: 'array', cellNF: true }); }
        catch (e) { ctx.toast('Die Datei konnte nicht gelesen werden', 'error'); return zurueck(); }
        var r = arbeitsmappeAuswerten(wb);
        if (!r.eintraege.length) {
          host.innerHTML = '<div class="bl-leer">' + BERG + '<p>In der Datei wurde keine Belegung gefunden.</p><p class="bl-hinweis">Erwartet wird eine Tabelle mit einer Datumsspalte und Zimmer-Spalten (Namen darunter) oder eine Liste mit den Spalten Anreise, Abreise und Name.</p>' +
            '<button type="button" class="xl-btn" data-a="zurueck">Zurück</button></div>';
          host.querySelector('[data-a=zurueck]').addEventListener('click', zurueck);
          return;
        }
        var tage = proTag(r.eintraege), spitze = tage.reduce(function(m, t) { return t.personen > m.personen ? t : m; }, tage[0]);
        host.innerHTML = '<div class="bl-vorschau"><h3>' + r.eintraege.length + ' Aufenthalte gefunden</h3>' +
          '<p class="bl-hinweis">Zeitraum ' + esc(datumKurz(r.eintraege[0].von)) + ' bis ' + esc(datumKurz(tage[tage.length - 1].tag)) + ' · Höchste Belegung ' + spitze.personen + ' Personen (' + esc(datumKurz(spitze.tag)) + ').' +
          (daten.eintraege.length ? ' <strong>Die bisherige Liste (' + daten.eintraege.length + ' Einträge) wird ersetzt</strong> – sie wird vorher gesichert und lässt sich zurückholen.' : '') + '</p>' +
          '<div class="bl-scroll"><table class="bl-tabelle"><thead><tr><th>Name</th><th class="zahl">Personen</th><th>Von</th><th>Bis</th><th>Zimmer</th></tr></thead><tbody>' +
          r.eintraege.map(function(e) { return '<tr><td data-l="Name"><strong>' + esc(e.name) + '</strong></td><td data-l="Personen" class="zahl">' + pTxt(e) + '</td><td data-l="Von">' + esc(datumKurz(e.von)) + '</td><td data-l="Bis">' + esc(datumKurz(e.bis)) + '</td><td data-l="Zimmer">' + esc(e.zimmer || '–') + '</td></tr>'; }).join('') +
          '</tbody></table></div><p class="bl-hinweis">Bitte prüfen: Stimmen Namen, Personenzahlen und Zeiträume?</p>' +
          '<div class="bl-formaktionen"><button type="button" class="xl-btn xl-btn-primary" data-a="ok">Liste ersetzen</button><button type="button" class="xl-btn" data-a="nein">Abbrechen</button></div></div>';
        host.querySelector('[data-a=nein]').addEventListener('click', zurueck);
        host.querySelector('[data-a=ok]').addEventListener('click', function() {
          var btn = this; btn.disabled = true; btn.textContent = 'Wird gespeichert …';
          // Originaldatei als Version ablegen (best effort), dann Liste ersetzen
          var fd = new FormData(); fd.append('datei', file);
          api('POST', '/api/belegung', fd, function() {
            api('POST', '/api/belegung/liste/import', { eintraege: r.eintraege, datei: file.name }, function(st, d) {
              if (st === 200) { ctx.toast(d.anzahl + ' Einträge eingelesen', 'success'); geaendert(); zurueck(); }
              else { ctx.toast((d && d.error) || 'Fehler beim Einlesen', 'error'); btn.disabled = false; btn.textContent = 'Liste ersetzen'; }
            });
          });
        });
      }).catch(function(e) { ctx.toast(e.message, 'error'); zurueck(); });
    };
    lesen.readAsArrayBuffer(file);
  }

  // ---------- Pro Tag ----------
  function renderTag(host, ctx) {
    host.innerHTML = '<p class="bl-hinweis" style="text-align:center;padding:30px 0;">Wird geladen …</p>';
    ladeDaten(function(daten) {
      if (!daten) { host.innerHTML = '<p class="bl-hinweis">Konnte nicht geladen werden.</p>'; return; }
      var tage = proTag(daten.eintraege), h = heuteIso();
      if (!tage.length) { host.innerHTML = '<div class="bl-leer">' + BERG + '<p>Noch keine Belegung eingetragen.</p></div>'; return; }
      var max = tage.reduce(function(m, t) { return Math.max(m, t.personen); }, 1);
      var spitze = tage.filter(function(t) { return t.personen === max; })[0];
      host.innerHTML = '<p class="bl-hinweis" style="margin:0 0 10px;">Wie viele Personen sind an welchem Tag im Haus (z. B. für die Essensplanung)? Höchste Belegung: <strong>' + max + ' Personen</strong> (' + esc(datumKurz(spitze.tag)) + ').</p>' +
        '<div class="bl-scroll"><table class="bl-tabelle bl-tag"><thead><tr><th>Tag</th><th class="zahl">Personen</th><th>Wer</th></tr></thead><tbody>' +
        tage.map(function(t) {
          var we = ['So', 'Sa'].indexOf(wochentag(t.tag)) >= 0;
          return '<tr class="' + (t.tag === h ? 'jetzt' : '') + (we ? ' we' : '') + '"><td data-l="Tag"><strong>' + esc(datumKurz(t.tag, h)) + '</strong>' + (t.tag === h ? ' <span class="bl-badge im-haus">heute</span>' : '') + '</td>' +
            '<td data-l="Personen" class="zahl"><span class="bl-balken" style="--w:' + Math.round(100 * t.personen / max) + '%"></span><strong>' + t.personen + '</strong></td>' +
            '<td data-l="Wer" class="bl-wer">' + (t.eintraege.length ? t.eintraege.map(function(e) { return esc(e.name) + (e.personen != null && e.personen !== 1 ? ' <span class="bl-z">(' + e.personen + ')</span>' : ''); }).join(', ') : '<span class="bl-z">niemand</span>') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    });
  }

  // ---------- Karte "Im Gibeli" ----------
  function tagText(d, h) { return datumKurz(d, h) + ' (' + relativ(d, h) + ')'; }
  function gruppenText(liste) {
    return liste.map(function(e) { return esc(e.name) + (e.personen != null && e.personen !== 1 ? ' <span class="gb-zahl">(' + e.personen + ')</span>' : ''); }).join(', ');
  }
  function zeigeKarte(host, opt) {
    ladeDaten(function(daten) {
      if (!daten) { host.hidden = true; return; }
      var liste = daten.eintraege;
      if (!liste.length && !daten.kannSchreiben) { host.hidden = true; return; }
      host.hidden = false;
      var u = uebersicht(liste, heuteIso()), h = u.heute;
      var inhalt;
      if (!liste.length) {
        inhalt = '<p class="gb-hinweis">Noch keine Belegung eingetragen. Öffne „Aktuelle Belegung“ und lies deine Excel-Datei ein – dann erscheint hier, wer im Gibeli ist.</p>';
      } else {
        var anwesend = u.anwesend.length
          ? '<span class="gb-gross">' + u.personen + '</span> Person' + (u.personen === 1 ? '' : 'en') + '<span class="gb-klein">' + u.anwesend.length + ' Gruppe' + (u.anwesend.length === 1 ? '' : 'n') + ': ' + gruppenText(u.anwesend) + '</span>'
          : '<span class="gb-gross">0</span> Personen<span class="gb-klein">zurzeit niemand im Haus</span>';
        var ab = u.naechsteAbreise.length ? '<strong>' + esc(tagText(u.naechsteAbreise[0].bis, h)) + '</strong><span class="gb-klein">' + gruppenText(u.naechsteAbreise) + '</span>' : '<span class="gb-klein">–</span>';
        var an = u.naechsteAnreise.length ? '<strong>' + esc(tagText(u.naechsteAnreise[0].von, h)) + '</strong><span class="gb-klein">' + gruppenText(u.naechsteAnreise) + '</span>' : '<span class="gb-klein">keine weitere Anreise eingetragen</span>';
        inhalt = '<div class="gb-raster"><div class="gb-box"><div class="gb-label">Aktuell im Haus</div>' + anwesend + '</div>' +
          '<div class="gb-box"><div class="gb-label">Nächste Abreise</div>' + ab + '</div><div class="gb-box"><div class="gb-label">Nächste Anreise</div>' + an + '</div></div>';
      }
      host.innerHTML = '<div class="gb-kopf"><h2>Im Gibeli</h2><button type="button" class="gb-klapp" aria-expanded="true" aria-label="Übersicht ein-/ausklappen">▾</button></div>' +
        '<div class="gb-inhalt">' + inhalt + '</div><div class="gb-fuss"><button type="button" class="gb-link">Ganze Belegung ansehen →</button></div>';
      var klapp = host.querySelector('.gb-klapp'), box = host.querySelector('.gb-inhalt'), fuss = host.querySelector('.gb-fuss');
      var zu = false; try { zu = localStorage.getItem('gb-zu') === '1'; } catch (e) {}
      function setze(z) { box.hidden = z; fuss.hidden = z; klapp.setAttribute('aria-expanded', String(!z)); klapp.textContent = z ? '▸' : '▾'; try { localStorage.setItem('gb-zu', z ? '1' : '0'); } catch (e) {} }
      setze(zu);
      klapp.addEventListener('click', function() { setze(!box.hidden); });
      host.querySelector('.gb-link').addEventListener('click', function() { if (opt && opt.oeffnen) opt.oeffnen(); });
    });
  }

  function ansichten() {
    return [{ id: 'liste', titel: 'Liste', render: renderListe }, { id: 'tag', titel: 'Pro Tag', render: renderTag }];
  }

  window.BelegungListe = {
    arbeitsmappeAuswerten: arbeitsmappeAuswerten, rasterAuswerten: rasterAuswerten, listeAuswerten: listeAuswerten,
    uebersicht: uebersicht, proTag: proTag, heuteIso: heuteIso,
    ansichten: ansichten, zeigeKarte: zeigeKarte, _nachAenderung: null
  };
})();
