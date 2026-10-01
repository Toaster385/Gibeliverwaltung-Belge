// ===== State =====
let belege = [];
let filterTimeout = null;
let deleteFileFlag = false;
let wechselkurs = { EUR_to_CHF: 0.95, CHF_to_EUR: 1.053 };
let statsData = null;
let kasseGeschlossen = false;
let statsWaehrung = 'EUR';
let currentUser = null;
// Beleg-Scan: Foto wurde komprimiert, auf dem Server gelesen und wartet dort (scanToken)
let scanState = { token: null, datum: null, belegnummer: null, betrag: null, waehrung: null, geschaeft: null, file: null, laufend: false };
// Weitere Fotos (z.B. 2. Seite eines langen Belegs)
let zusatzNeu = [];        // neu aufgenommene (bereits komprimierte) Dateien
let zusatzEntfernen = [];  // IDs bestehender Zusatzfotos, die beim Speichern entfernt werden
let zusatzBestehend = [];  // bestehende Zusatzfotos beim Bearbeiten
const MAX_ZUSATZ = 5;

const filterSuche = document.getElementById('filterSuche');
const filterVon = document.getElementById('filterVon');
const filterBis = document.getElementById('filterBis');

// ===== Init =====
var offlineStart = false;
document.addEventListener('DOMContentLoaded', function() {
  function starten(user, offline) {
    currentUser = user;
    document.getElementById('headerUser').textContent = user.benutzername;
    document.getElementById('sidebarUser').textContent = user.benutzername;
    offlineStart = !!offline;
    if (!offline) { ladeEinstellungen(); ladeWechselkurs(); ladeBelege(); ladeStatistiken(); }
    setupEventListeners();
    richteMenueEin();
    initQueue();
    if (offline) zeigeOfflineHinweis();
  }
  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/api/ich', true);
  xhr.timeout = 10000;
  xhr.onload = function() {
    if (xhr.status !== 200) { try { localStorage.removeItem('gibeli_user'); } catch (e) {} window.location.href = '/login.html'; return; }
    var user;
    try { user = JSON.parse(xhr.responseText); } catch (e) { window.location.href = '/login.html'; return; }
    if (user.mussAendern) { window.location.href = '/admin.html'; return; }
    try { localStorage.setItem('gibeli_user', JSON.stringify({ benutzername: user.benutzername, rolle: user.rolle })); } catch (e) {}
    starten(user, false);
  };
  // Kein Internet beim Öffnen: App trotzdem starten (zuletzt angemeldeter Benutzer), neue Belege können erfasst werden
  function ohneVerbindung() {
    var u = null;
    try { u = JSON.parse(localStorage.getItem('gibeli_user')); } catch (e) {}
    if (u && u.benutzername) starten(u, true); else window.location.href = '/login.html';
  }
  xhr.onerror = ohneVerbindung;
  xhr.ontimeout = ohneVerbindung;
  xhr.send();
});

function zeigeOfflineHinweis() {
  var el = document.getElementById('emptyState'); if (el) el.classList.add('hidden');
  var b = document.getElementById('queueBanner');
  var hinweis = document.createElement('div');
  hinweis.id = 'offlineHinweis';
  hinweis.className = 'queue-banner';
  hinweis.textContent = 'Kein Internet – bestehende Belege sind erst wieder sichtbar, wenn die Verbindung da ist. Neue Belege kannst du trotzdem erfassen; sie werden automatisch gesendet.';
  b.parentNode.insertBefore(hinweis, b);
  window.addEventListener('online', function() { window.location.reload(); });
}

function ladeEinstellungen() {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/api/einstellungen', true);
  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4) return;
    try {
      var data = JSON.parse(xhr.responseText);
      kasseGeschlossen = data.kasse_geschlossen;
      aktualisiereKasseBanner();
    } catch(e) {}
  };
  xhr.send();
}

function ladeWechselkurs() {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/api/wechselkurs', true);
  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4) return;
    try {
      var data = JSON.parse(xhr.responseText);
      wechselkurs = data;
      if (statsData) aktualisiereStatistikAnzeige();
    } catch(e) {}
  };
  xhr.send();
}

function aktualisiereKasseBanner() {
  var banner = document.getElementById('kasseBanner');
  var btnNeu = document.getElementById('btnNeuBeleg');
  if (kasseGeschlossen) {
    banner.classList.remove('hidden');
    btnNeu.disabled = true;
    btnNeu.style.opacity = '0.5';
    btnNeu.style.cursor = 'not-allowed';
  } else {
    banner.classList.add('hidden');
    btnNeu.disabled = false;
    btnNeu.style.opacity = '';
    btnNeu.style.cursor = '';
  }
}

// ===== Event Listeners =====
function setupEventListeners() {
  document.getElementById('btnNeuBeleg').addEventListener('click', function() {
    if (kasseGeschlossen) return;
    oeffneModal();
  });

  // Sidebar (three-dot menu)
  document.getElementById('btnMenu').addEventListener('click', oeffneSidebar);
  document.getElementById('sidebarClose').addEventListener('click', schliesseSidebar);
  document.getElementById('sidebarOverlay').addEventListener('click', schliesseSidebar);
  document.getElementById('sidebarLogout').addEventListener('click', function() {
    try { localStorage.removeItem('gibeli_user'); } catch (e) {}
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/logout', true);
    xhr.onreadystatechange = function() {
      if (xhr.readyState !== 4) return;
      window.location.href = '/login.html';
    };
    xhr.send();
  });
  document.getElementById('modalClose').addEventListener('click', schliesseModal);
  document.getElementById('btnAbbrechen').addEventListener('click', schliesseModal);
  document.getElementById('modalOverlay').addEventListener('click', function(e) {
    if (e.target === document.getElementById('modalOverlay')) schliesseModal();
  });
  document.getElementById('previewClose').addEventListener('click', schliessePreview);
  document.getElementById('previewOverlay').addEventListener('click', function(e) {
    if (e.target === document.getElementById('previewOverlay')) schliessePreview();
  });

  document.getElementById('btnSpeichern').addEventListener('click', speichereBeleg);

  // Excel-Bereiche (Aktuelle Belegung, Gerichte)
  initExcelBereiche();
  initZusatzfotos();
  initPinPapierkorbExport();

  // Form currency toggle (only inside form)
  document.querySelectorAll('#formBeleg .waehrung-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('#formBeleg .waehrung-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById('feldWaehrung').value = btn.dataset.waehrung;
    });
  });

  // Stats currency toggle
  var statsToggle = document.getElementById('statsWaehrungToggle');
  if (statsToggle) {
    statsToggle.querySelectorAll('.waehrung-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        statsToggle.querySelectorAll('.waehrung-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        statsWaehrung = btn.dataset.waehrung;
        aktualisiereStatistikAnzeige();
      });
    });
  }

  // Filter
  filterSuche.addEventListener('input', function() {
    clearTimeout(filterTimeout);
    filterTimeout = setTimeout(ladeBelege, 300);
  });
  filterVon.addEventListener('change', ladeBelege);
  filterBis.addEventListener('change', ladeBelege);
  document.getElementById('btnFilterReset').addEventListener('click', resetFilter);

  // File Upload
  var uploadArea = document.getElementById('uploadArea');
  var feldDatei = document.getElementById('feldDatei');

  uploadArea.addEventListener('dragover', function(e) {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });
  uploadArea.addEventListener('dragleave', function() { uploadArea.classList.remove('dragover'); });
  uploadArea.addEventListener('drop', function(e) {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      verarbeiteDatei(e.dataTransfer.files[0]);
    }
  });

  feldDatei.addEventListener('change', function(e) {
    if (e.target.files.length > 0) verarbeiteDatei(e.target.files[0]);
  });
  document.getElementById('feldFoto').addEventListener('change', function(e) {
    if (e.target.files.length > 0) verarbeiteDatei(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('feldDatum').addEventListener('input', aktualisiereScanHinweise);
  document.getElementById('feldBelegnummer').addEventListener('input', aktualisiereScanHinweise);
  document.getElementById('feldBetrag').addEventListener('input', aktualisiereScanHinweise);
  document.getElementById('feldGeschaeft').addEventListener('input', aktualisiereScanHinweise);
  document.querySelectorAll('#formBeleg .waehrung-btn').forEach(function(b) { b.addEventListener('click', function() { setTimeout(aktualisiereScanHinweise, 0); }); });

  document.getElementById('btnRemoveFile').addEventListener('click', function(e) {
    e.stopPropagation();
    e.preventDefault();
    loescheDateiVorschau();
  });

  document.getElementById('btnDeleteFile').addEventListener('click', function() {
    deleteFileFlag = true;
    document.getElementById('existingFile').classList.add('hidden');
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      schliesseModal();
      schliessePreview();
      schliesseSidebar();
      schliesseExcelModale();
      schliesseWeitereModale();
    }
  });
}

// ===== API Calls =====
function ladeBelege() {
  var params = new URLSearchParams();
  var suche = filterSuche.value.trim();
  var von = filterVon.value;
  var bis = filterBis.value;

  if (suche) params.append('suche', suche);
  if (von) params.append('von', von);
  if (bis) params.append('bis', bis);

  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/api/belege?' + params.toString(), true);
  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4) return;
    try {
      belege = JSON.parse(xhr.responseText);
      rendereGrid();
    } catch(e) {
      zeigeToast('Fehler beim Laden der Belege', 'error');
    }
  };
  xhr.send();
}

function ladeStatistiken() {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/api/statistiken', true);
  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4) return;
    try {
      statsData = JSON.parse(xhr.responseText);
      document.getElementById('statAnzahl').textContent = statsData.gesamt.anzahl || 0;
      document.getElementById('statMonat').textContent = statsData.periode ? (statsData.periode.anzahl || 0) : '–';
      aktualisiereStatistikAnzeige();
    } catch(e) {}
  };
  xhr.send();
}

function aktualisiereStatistikAnzeige() {
  if (!statsData) return;
  var eurCHF = wechselkurs.EUR_to_CHF || 0.95;
  var chfEUR = wechselkurs.CHF_to_EUR || 1.053;

  var gEur = statsData.gesamt.gesamt_eur || 0;
  var gChf = statsData.gesamt.gesamt_chf || 0;
  // Betrag nicht mehr pro Monat, sondern pro aktiver Periode
  var periode = statsData.periode;
  var mEur = periode ? (periode.gesamt_eur || 0) : 0;
  var mChf = periode ? (periode.gesamt_chf || 0) : 0;

  var gesamtAnzeige, monatAnzeige, kursText;
  if (statsWaehrung === 'CHF') {
    gesamtAnzeige = gChf + gEur * eurCHF;
    monatAnzeige = mChf + mEur * eurCHF;
    kursText = '1 EUR = ' + eurCHF.toFixed(4) + ' CHF';
    document.getElementById('statGesamt').textContent = formatBetrag(gesamtAnzeige, 'CHF');
    document.getElementById('statMonatBetrag').textContent = periode ? formatBetrag(monatAnzeige, 'CHF') : '–';
  } else {
    gesamtAnzeige = gEur + gChf * chfEUR;
    monatAnzeige = mEur + mChf * chfEUR;
    kursText = '1 CHF = ' + chfEUR.toFixed(4) + ' EUR';
    document.getElementById('statGesamt').textContent = formatBetrag(gesamtAnzeige, 'EUR');
    document.getElementById('statMonatBetrag').textContent = periode ? formatBetrag(monatAnzeige, 'EUR') : '–';
  }

  var pInfo = document.getElementById('statPeriodeInfo');
  if (pInfo) pInfo.textContent = periode ? periode.name + ' (' + formatDatum(periode.von) + ' – ' + formatDatum(periode.bis) + ')' : 'Keine aktive Periode';

  var kursEl = document.getElementById('statKurs');
  if (kursEl) kursEl.textContent = (gChf > 0 && gEur > 0) ? kursText : '';
}

// ===== Image Compression =====
function komprimieresBild(file, callback, opts) {
  opts = opts || {};
  var maxDim = opts.maxDim || 1600;
  var qualitaet = opts.qualitaet || 0.82;
  if (!file.type.startsWith('image/') || (!opts.immer && file.size < 400 * 1024)) {
    callback(file, false);
    return;
  }
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      var w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
        else { w = Math.round(w * maxDim / h); h = maxDim; }
      }
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(function(blob) {
        if (!blob || blob.size >= file.size) { callback(file, false); return; }
        var nameBase = file.name.replace(/\.[^.]+$/, '');
        var compressed = new File([blob], nameBase + '.jpg', { type: 'image/jpeg' });
        callback(compressed, true);
      }, 'image/jpeg', qualitaet);
    };
    img.onerror = function() { callback(file, false); };
    img.src = e.target.result;
  };
  reader.onerror = function() { callback(file, false); };
  reader.readAsDataURL(file);
}

function neueId() {
  return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}
var aktuelleClientId = null;

function speichereBeleg(e) {
  if (e) e.preventDefault();
  var id = document.getElementById('belegId').value;
  var formError = document.getElementById('formError');
  formError.classList.add('hidden');
  function fehler(text) { formError.textContent = text; formError.classList.remove('hidden'); }

  var datum = document.getElementById('feldDatum').value;
  var betrag = document.getElementById('feldBetrag').value;
  var belegnummer = document.getElementById('feldBelegnummer').value.trim();
  var gewaehlt = document.getElementById('feldDatei').files[0] || null;
  var hatExistingFile = !document.getElementById('existingFile').classList.contains('hidden');

  if (!datum) return fehler('Bitte das Datum angeben.');
  if (!betrag || parseFloat(betrag) <= 0) return fehler('Bitte einen gültigen Betrag angeben.');
  if (!belegnummer || !/^\d{3}$/.test(belegnummer)) return fehler('Bitte genau 3 Ziffern der Belegnummer angeben (z.B. 123).');
  if (scanState.laufend) return fehler('Der Beleg wird noch gelesen – bitte einen Moment warten.');
  if (!gewaehlt && !scanState.file && !hatExistingFile && !scanState.token) return fehler('Bitte einen Beleg (Bild oder PDF) hochladen.');

  var felder = {
    datum: datum, belegnummer: belegnummer, betrag: betrag,
    geschaeft: document.getElementById('feldGeschaeft').value,
    notiz: document.getElementById('feldNotiz').value,
    waehrung: document.getElementById('feldWaehrung').value
  };
  var hauptFile = gewaehlt || scanState.file || null;       // bereits verkleinert
  var scanToken = scanState.token;                            // Foto liegt schon auf dem Server (spart Upload)
  var scanZeit = Date.now();
  var zusatz = zusatzNeu.slice();
  var entfernen = zusatzEntfernen.slice();
  var clientId = id ? null : (aktuelleClientId = aktuelleClientId || neueId());

  var btn = document.getElementById('btnSpeichern');
  btn.disabled = true;

  function formDataBauen(opt) {
    var fd = new FormData();
    Object.keys(felder).forEach(function(k) { fd.append(k, felder[k]); });
    if (clientId) fd.append('clientId', clientId);
    if (opt.duplikatOk) fd.append('duplikatOk', '1');
    if (scanToken && !opt.ohneToken) fd.append('scanToken', scanToken);
    else if (hauptFile) fd.append('datei', hauptFile);
    zusatz.forEach(function(f) { fd.append('zusatz', f); });
    if (id && entfernen.length) fd.append('entferneFotos', JSON.stringify(entfernen));
    return fd;
  }

  function fertig() { btn.disabled = false; btn.textContent = 'Speichern'; }

  function netzwerkfehler() {
    fertig();
    if (id) { zeigeToast('Keine Verbindung – Änderung nicht gespeichert. Bitte später erneut versuchen.', 'error'); return; }
    // Neuer Beleg: in die Warteschlange legen, wird automatisch gesendet sobald das Internet wieder da ist
    queueHinzufuegen({ clientId: clientId, felder: felder, haupt: hauptFile, zusatz: zusatz, scanToken: scanToken, scanZeit: scanZeit, ts: Date.now() })
      .then(function() {
        aktuelleClientId = null;
        schliesseModal();
        zeigeToast('Kein Internet – der Beleg wird automatisch gesendet, sobald wieder Verbindung besteht.', '');
      })
      .catch(function() { zeigeToast('Keine Verbindung und der Beleg konnte nicht zwischengespeichert werden.', 'error'); });
  }

  function senden(opt) {
    opt = opt || {};
    btn.textContent = 'Wird hochgeladen...';
    var xhr = new XMLHttpRequest();
    xhr.open(id ? 'PUT' : 'POST', id ? '/api/belege/' + id : '/api/belege', true);
    xhr.timeout = 180000;
    xhr.onload = function() {
      var data = {};
      try { data = JSON.parse(xhr.responseText); } catch (err) {}
      if (xhr.status === 200 || xhr.status === 201) {
        fertig();
        aktuelleClientId = null;
        schliesseModal();
        ladeBelege();
        ladeStatistiken();
        zeigeToast(id ? 'Beleg aktualisiert' : 'Beleg gespeichert', 'success');
      } else if (xhr.status === 409 && data.duplikat) {
        fertig();
        if (confirm(data.error + '\n\nTrotzdem speichern?')) { btn.disabled = true; senden({ duplikatOk: true, ohneToken: opt.ohneToken }); }
      } else if (xhr.status === 400 && scanToken && !opt.ohneToken && hauptFile && /Datei/.test(data.error || '')) {
        senden({ duplikatOk: opt.duplikatOk, ohneToken: true }); // Scan abgelaufen -> Foto direkt senden
      } else if (xhr.status === 0 || xhr.status >= 502) {
        netzwerkfehler();
      } else {
        fertig();
        zeigeToast(data.error || 'Fehler beim Speichern', 'error');
      }
    };
    xhr.onerror = netzwerkfehler;
    xhr.ontimeout = netzwerkfehler;
    xhr.send(formDataBauen(opt));
  }
  senden({});
}

function loescheBeleg(id) {
  if (!confirm('Beleg in den Papierkorb verschieben?\n(Verwaltung/Admin können ihn dort 30 Tage lang wiederherstellen.)')) return;
  var xhr = new XMLHttpRequest();
  xhr.open('DELETE', '/api/belege/' + id, true);
  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4) return;
    if (xhr.status !== 200) {
      try { var d = JSON.parse(xhr.responseText); zeigeToast(d.error || 'Löschen fehlgeschlagen', 'error'); } catch(e) {}
      return;
    }
    ladeBelege();
    ladeStatistiken();
    zeigeToast('Beleg in den Papierkorb verschoben', 'success');
  };
  xhr.send();
}

// ===== Render =====
function rendereGrid() {
  var grid = document.getElementById('belegeGrid');
  var empty = document.getElementById('emptyState');

  if (belege.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  grid.innerHTML = belege.map(function(b) { return kartHTML(b); }).join('');

  grid.querySelectorAll('[data-action="edit"]').forEach(function(btn) {
    btn.addEventListener('click', function() { oeffneModal(parseInt(btn.dataset.id)); });
  });
  grid.querySelectorAll('[data-action="delete"]').forEach(function(btn) {
    btn.addEventListener('click', function() { loescheBeleg(parseInt(btn.dataset.id)); });
  });
  grid.querySelectorAll('[data-action="preview"]').forEach(function(el) {
    el.addEventListener('click', function() { oeffnePreview(parseInt(el.dataset.id)); });
  });
}

// Nur für Admin/Verwaltung: welche Werte wurden automatisch aus dem Foto gelesen?
function autoInfoHTML(b) {
  var rollen = ((currentUser && currentUser.rolle) || '').split(',').map(function(r) { return r.trim(); });
  if (rollen.indexOf('admin') < 0 && rollen.indexOf('verwaltung') < 0) return '';
  var felder = [];
  if (b.auto_datum) felder.push('Datum');
  if (b.auto_belegnummer) felder.push('Nr.');
  if (b.auto_betrag) felder.push('Betrag');
  if (b.auto_waehrung) felder.push('Währung');
  if (b.auto_geschaeft) felder.push('Geschäft');
  if (!felder.length) return '<div class="card-auto card-auto-manuell">Alles von Hand eingetragen</div>';
  return '<div class="card-auto">Automatisch gelesen: ' + felder.join(', ') + '</div>';
}

function kartHTML(b) {
  var hatDatei = !!b.dateipfad;
  var istBild = hatDatei && /\.(jpg|jpeg|png|gif|webp)$/i.test(b.dateiname || '');
  var istPdf = hatDatei && /\.pdf$/i.test(b.dateiname || '');

  // Vorschaubild nur, wenn tatsächlich ein Foto hochgeladen wurde
  var thumbHTML = '';
  if (istBild) {
    thumbHTML = '<button type="button" class="card-thumb" data-action="preview" data-id="' + b.id + '" aria-label="Beleg vergrössern">' +
      '<img src="/uploads/' + b.dateipfad + '" alt="Beleg-Foto" loading="lazy">' +
      '<div class="thumb-overlay">Vergrössern</div></button>';
  }

  var istEingetragen = b.status === 'eingetragen';
  var waehrung = b.waehrung || 'EUR';

  var ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16z"/><path d="M14 6l4 4"/></svg>';
  var ICON_VIEW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var ICON_DEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';

  return '<div class="beleg-card is-' + (b.status || 'ausstehend') + '">' +
    thumbHTML +
    '<div class="card-body">' +
      '<div class="card-top">' +
        '<span class="card-shop">' + escapeHtml(b.geschaeft) + '</span>' +
        '<span class="card-amount">' + formatBetrag(b.betrag, waehrung) + '</span>' +
      '</div>' +
      '<div class="card-meta">' +
        '<span class="card-date">' + formatDatum(b.datum) + '</span>' +
        (b.belegnummer ? '<span class="card-nr">Nr. …' + escapeHtml(b.belegnummer) + '</span>' : '') +
        '<span class="badge status-' + (b.status || 'ausstehend') + '">' +
          (istEingetragen ? '✓ Eingetragen' : 'Ausstehend') + '</span>' +
        ((b.zusatzFotos && b.zusatzFotos.length) ? '<span class="badge verif-nein" title="Weitere Fotos zu diesem Beleg">+' + b.zusatzFotos.length + ' Foto' + (b.zusatzFotos.length > 1 ? 's' : '') + '</span>' : '') +
        (b.verifiziert ? '<span class="badge verif-ja" title="Datum und Belegnummer wurden aus dem Foto gelesen">✓ Verifiziert</span>'
                       : '<span class="badge verif-nein" title="Von Hand eingetragen">Manuell</span>') +
      '</div>' +
      autoInfoHTML(b) +
      (b.notiz ? '<div class="card-note">' + escapeHtml(b.notiz) + '</div>' : '') +
    '</div>' +
    '<div class="card-actions">' +
      (!istEingetragen ? '<button class="btn-icon" data-action="edit" data-id="' + b.id + '">' + ICON_EDIT + ' Bearbeiten</button>' : '') +
      (hatDatei ? '<button class="btn-icon" data-action="preview" data-id="' + b.id + '">' + ICON_VIEW + ' Ansehen</button>' : '') +
      (!istEingetragen ? '<button class="btn-icon danger" data-action="delete" data-id="' + b.id + '">' + ICON_DEL + ' Löschen</button>' : '') +
    '</div>' +
  '</div>';
}

// ===== Modal =====
function oeffneModal(id) {
  deleteFileFlag = false;
  zusatzNeu = []; zusatzEntfernen = []; zusatzBestehend = [];
  aktuelleClientId = null;
  var overlay = document.getElementById('modalOverlay');
  var form = document.getElementById('formBeleg');
  form.reset();
  loescheDateiVorschau();
  document.getElementById('existingFile').classList.add('hidden');
  document.getElementById('belegId').value = '';

  if (id !== undefined && id !== null) {
    var b = belege.find(function(x) { return x.id === id; });
    if (!b) return;
    document.getElementById('modalTitel').textContent = 'Beleg bearbeiten';
    document.getElementById('belegId').value = b.id;
    document.getElementById('feldDatum').value = b.datum;
    document.getElementById('feldGeschaeft').value = b.geschaeft;
    document.getElementById('feldBetrag').value = b.betrag;
    document.getElementById('feldBelegnummer').value = b.belegnummer || '';
    document.getElementById('feldNotiz').value = b.notiz || '';
    setWaehrung(b.waehrung || 'EUR');

    if (b.dateiname) {
      document.getElementById('existingFileName').textContent = b.dateiname;
      document.getElementById('existingFile').classList.remove('hidden');
    }
    zusatzBestehend = (b.zusatzFotos || []).slice();
  } else {
    document.getElementById('modalTitel').textContent = 'Neuer Beleg';
    document.getElementById('feldDatum').value = new Date().toISOString().slice(0, 10);
    setWaehrung('EUR');
  }

  document.getElementById('formError').classList.add('hidden');
  zeigeZusatzListe();
  overlay.classList.add('active');
}

function schliesseModal() {
  document.getElementById('modalOverlay').classList.remove('active');
}

// ===== Preview =====
function oeffnePreview(id) {
  var b = belege.find(function(x) { return x.id === id; });
  if (!b || !b.dateipfad) return;

  var overlay = document.getElementById('previewOverlay');
  var content = document.getElementById('previewContent');
  var istBild = /\.(jpg|jpeg|png|gif|webp)$/i.test(b.dateiname || '');
  var istPdf = /\.pdf$/i.test(b.dateiname || '');

  document.getElementById('previewTitel').textContent = b.geschaeft || 'Beleg-Vorschau';

  var mediaHTML = '';
  if (istBild) {
    mediaHTML = '<img src="/uploads/' + b.dateipfad + '" alt="Beleg">' +
      (b.zusatzFotos || []).map(function(f, i) { return '<img src="/uploads/' + f.dateipfad + '" alt="Beleg, Foto ' + (i + 2) + '" style="margin-top:12px;">'; }).join('');
  } else if (istPdf) {
    mediaHTML = '<iframe src="/uploads/' + b.dateipfad + '" title="PDF Beleg"></iframe>';
  } else {
    mediaHTML = '<a href="/uploads/' + b.dateipfad + '" download="' + escapeHtml(b.dateiname) + '" class="btn btn-primary">Datei herunterladen</a>';
  }

  content.innerHTML =
    '<div class="preview-info">' +
      '<div class="preview-info-item">' +
        '<div class="preview-info-label">Geschäft</div>' +
        '<div class="preview-info-value">' + escapeHtml(b.geschaeft) + '</div>' +
      '</div>' +
      '<div class="preview-info-item">' +
        '<div class="preview-info-label">Betrag</div>' +
        '<div class="preview-info-value">' + formatBetrag(b.betrag, b.waehrung) + '</div>' +
      '</div>' +
      '<div class="preview-info-item">' +
        '<div class="preview-info-label">Datum</div>' +
        '<div class="preview-info-value">' + formatDatum(b.datum) + '</div>' +
      '</div>' +
      (b.notiz ? '<div class="preview-info-item" style="grid-column:1/-1">' +
        '<div class="preview-info-label">Notiz</div>' +
        '<div class="preview-info-value">' + escapeHtml(b.notiz) + '</div>' +
      '</div>' : '') +
    '</div>' + mediaHTML +
    (istBild ? '' : (b.zusatzFotos || []).map(function(f) { return '<img src="/uploads/' + f.dateipfad + '" alt="Weiteres Foto" style="margin-top:12px;">'; }).join(''));

  overlay.classList.add('active');
}

function schliessePreview() {
  document.getElementById('previewOverlay').classList.remove('active');
}

// ===== File Preview =====
function zeigeVorschau(file) {
  var placeholder = document.getElementById('uploadPlaceholder');
  var preview = document.getElementById('uploadPreview');
  var previewImg = document.getElementById('previewImg');
  var previewPdf = document.getElementById('previewPdf');
  var previewName = document.getElementById('previewName');

  placeholder.classList.add('hidden');
  preview.classList.remove('hidden');
  previewName.textContent = file.name;

  if (file.type.startsWith('image/')) {
    var reader = new FileReader();
    reader.onload = function(e) {
      previewImg.src = e.target.result;
      previewImg.classList.remove('hidden');
      previewPdf.classList.add('hidden');
    };
    reader.readAsDataURL(file);
  } else {
    previewImg.classList.add('hidden');
    previewPdf.classList.remove('hidden');
  }
}

function loescheDateiVorschau() {
  setzeScanZurueck();
  document.getElementById('feldDatei').value = '';
  document.getElementById('uploadPlaceholder').classList.remove('hidden');
  document.getElementById('uploadPreview').classList.add('hidden');
  document.getElementById('previewImg').src = '';
}


// ===== Beleg-Scan =====
function setzeScanZurueck() {
  scanState = { token: null, datum: null, belegnummer: null, betrag: null, waehrung: null, geschaeft: null, file: null, laufend: false };
  var st = document.getElementById('scanStatus');
  if (st) { st.className = 'scan-status hidden'; st.textContent = ''; }
  zeigeScanDetails('');
  ['hintDatum', 'hintBelegnummer', 'hintBetrag', 'hintGeschaeft'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  var btn = document.getElementById('btnSpeichern');
  if (btn) btn.disabled = false;
}

// Technische Details (erkannter Text / Fehler) zum Nachvollziehen, falls das Lesen nicht klappt
function zeigeScanDetails(text) {
  var st = document.getElementById('scanStatus');
  var alt = document.getElementById('scanDetails');
  if (alt) alt.remove();
  if (!text) return;
  var d = document.createElement('details');
  d.id = 'scanDetails';
  var sum = document.createElement('summary');
  sum.textContent = 'Was wurde erkannt?';
  var pre = document.createElement('pre');
  pre.textContent = text;
  d.appendChild(sum);
  d.appendChild(pre);
  st.insertAdjacentElement('afterend', d);
}

function zeigeScanStatus(art, text) {
  var st = document.getElementById('scanStatus');
  st.className = 'scan-status scan-' + art;
  st.textContent = '';
  if (art === 'busy') {
    var sp = document.createElement('span');
    sp.className = 'spinner';
    sp.setAttribute('aria-hidden', 'true');
    st.appendChild(sp);
  }
  st.appendChild(document.createTextNode(text));
}

// Zeigt an, ob die Felder noch den automatisch gelesenen Werten entsprechen (= wird "verifiziert")
function aktualisiereScanHinweise() {
  if (!scanState.token) return;
  var datum = document.getElementById('feldDatum').value;
  var nr = document.getElementById('feldBelegnummer').value.trim();
  var betragOk = scanState.betrag != null && Math.abs(parseFloat(document.getElementById('feldBetrag').value) - scanState.betrag) < 0.005 &&
    (!scanState.waehrung || document.getElementById('feldWaehrung').value === scanState.waehrung);
  document.getElementById('hintBetrag').classList.toggle('hidden', !betragOk);
  document.getElementById('hintGeschaeft').classList.toggle('hidden', !(scanState.geschaeft && document.getElementById('feldGeschaeft').value.trim() === scanState.geschaeft.trim()));
  var datumOk = !!scanState.datum && datum === scanState.datum;
  var nrOk = !!scanState.belegnummer && nr === scanState.belegnummer;
  document.getElementById('hintDatum').classList.toggle('hidden', !datumOk);
  document.getElementById('hintBelegnummer').classList.toggle('hidden', !nrOk);
  if (datumOk && nrOk) {
    zeigeScanStatus('ok', 'Datum und Belegnummer aus dem Foto gelesen – der Beleg wird als verifiziert gespeichert.');
  } else if (scanState.datum || scanState.belegnummer || scanState.betrag != null) {
    zeigeScanStatus('warn', 'Nicht alles automatisch erkannt oder geändert – bitte prüfen. Der Beleg wird als manuell (nicht verifiziert) gespeichert.');
  } else {
    zeigeScanStatus('warn', 'Auf dem Foto konnten Datum und Belegnummer nicht gelesen werden. Bitte von Hand eintragen – der Beleg ist dann nicht verifiziert.');
  }
}

// Einstieg für jede neu gewählte/aufgenommene Datei
function verarbeiteDatei(file) {
  setzeScanZurueck();
  if (!file.type.startsWith('image/')) {
    // PDF o. Ä.: kein Scan möglich -> manuell
    zeigeVorschau(file);
    zeigeScanStatus('warn', 'Dieser Dateityp wird nicht gelesen. Bitte Datum und Belegnummer von Hand eintragen (nicht verifiziert).');
    return;
  }
  zeigeVorschau(file);
  var btn = document.getElementById('btnSpeichern');
  scanState.laufend = true;
  btn.disabled = true;
  zeigeScanStatus('busy', 'Foto wird verkleinert …');
  komprimieresBild(file, function(klein) {
    // komprimiertes Bild in das Dateifeld übernehmen (Fallback ohne DataTransfer: Scan-Token genügt)
    try {
      var dt = new DataTransfer();
      dt.items.add(klein);
      document.getElementById('feldDatei').files = dt.files;
    } catch (e) {}
    scanState.file = klein;
    zeigeVorschau(klein);
    zeigeToast('Foto verkleinert: ' + Math.round(klein.size / 1024) + ' KB', '');
    scanneBild(klein);
  }, { immer: true, maxDim: 2400, qualitaet: 0.7 });
}

function scanneBild(file) {
  var btn = document.getElementById('btnSpeichern');
  zeigeScanStatus('busy', 'Beleg wird hochgeladen und gelesen – bei langsamem Internet kann das einen Moment dauern …');
  var fd = new FormData();
  fd.append('datei', file);
  var xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/belege/scan', true);
  xhr.timeout = 120000;
  function fertig() { scanState.laufend = false; btn.disabled = false; }
  function manuell(grund) {
    fertig();
    zeigeScanStatus('warn', 'Das Foto konnte nicht automatisch gelesen werden. Bitte Datum und Belegnummer von Hand eintragen (nicht verifiziert).');
    zeigeScanDetails('Technischer Grund: ' + grund);
  }
  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4) return;
    if (xhr.status !== 200) { manuell('Server-Antwort ' + xhr.status + ' ' + (xhr.responseText || '').slice(0, 200)); return; }
    try {
      var data = JSON.parse(xhr.responseText);
      scanState.token = data.scanToken;
      scanState.datum = data.datum;
      scanState.belegnummer = data.belegnummer;
      scanState.betrag = data.betrag != null ? data.betrag : null;
      scanState.waehrung = data.waehrung || null;
      scanState.geschaeft = data.geschaeft || null;
      if (data.geschaeft && !document.getElementById('feldGeschaeft').value.trim()) document.getElementById('feldGeschaeft').value = data.geschaeft;
      if (data.betrag != null) document.getElementById('feldBetrag').value = data.betrag.toFixed(2);
      if (data.waehrung) setWaehrung(data.waehrung);
      if (data.datum) document.getElementById('feldDatum').value = data.datum;
      if (data.belegnummer) document.getElementById('feldBelegnummer').value = data.belegnummer;
      fertig();
      if (data.lesefehler) {
        zeigeScanStatus('warn', 'Das Foto wurde gespeichert, aber nicht gelesen (' + data.lesefehler + '). Bitte Datum und Belegnummer von Hand eintragen (nicht verifiziert).');
      } else {
        aktualisiereScanHinweise();
      }
      if (!data.datum || !data.belegnummer || data.betrag == null) zeigeScanDetails(data.text || '(kein Text erkannt)');
    } catch (e) { manuell('Antwort nicht lesbar: ' + e.message); }
  };
  xhr.ontimeout = function() { manuell('Zeitüberschreitung (120 s)'); };
  xhr.onerror = function() { manuell('Netzwerkfehler / Server nicht erreichbar'); };
  xhr.send(fd);
}

// ===== Filter =====
function resetFilter() {
  filterSuche.value = '';
  filterVon.value = '';
  filterBis.value = '';
  ladeBelege();
}

// ===== Toast =====
function zeigeToast(msg, type) {
  var toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'toast show ' + (type || '');
  setTimeout(function() { toast.classList.remove('show'); }, 3000);
}

// ===== Helpers =====
function formatBetrag(betrag, waehrung) {
  var currency = waehrung === 'CHF' ? 'CHF' : 'EUR';
  return new Intl.NumberFormat('de-CH', { style: 'currency', currency: currency }).format(betrag);
}

function setWaehrung(w) {
  document.getElementById('feldWaehrung').value = w;
  document.querySelectorAll('#formBeleg .waehrung-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.waehrung === w);
  });
}

function formatDatum(datum) {
  return new Date(datum + 'T00:00:00').toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ===== Sidebar =====
function oeffneSidebar() {
  document.getElementById('sidebar').classList.add('active');
  document.getElementById('sidebarOverlay').classList.add('active');
}

function schliesseSidebar() {
  document.getElementById('sidebar').classList.remove('active');
  document.getElementById('sidebarOverlay').classList.remove('active');
}

// ===== Excel-Bereiche: Aktuelle Belegung & Gerichte (siehe excel-ansicht.js) =====
function initExcelBereiche() {
  ExcelAnsicht.init({
    mount: document.body,
    toast: zeigeToast,
    bereiche: [
      { key: 'belegung', titel: 'Aktuelle Belegung', api: '/api/belegung', leer: 'Noch keine Belegung hochgeladen.', spalten: true, nachSpalten: ladeGibeliKarte },
      { key: 'gerichte', titel: 'Gerichte', api: '/api/gerichte', leer: 'Noch keine Gerichte hochgeladen.' }
    ]
  });
  document.getElementById('sidebarBelegung').addEventListener('click', function() { schliesseSidebar(); ExcelAnsicht.oeffne('belegung'); });
  document.getElementById('sidebarGerichte').addEventListener('click', function() { schliesseSidebar(); ExcelAnsicht.oeffne('gerichte'); });
  ladeGibeliKarte();
}
function schliesseExcelModale() { ExcelAnsicht.schliesseAlle(); }

// Kleine Karte "Im Gibeli": wer ist da, nächste Abreise/Anreise (aus der Belegungs-Tabelle)
function ladeGibeliKarte() {
  var host = document.getElementById('gibeliKarte');
  if (!host || offlineStart) return;
  ExcelAnsicht.zeigeUebersicht(host, { api: '/api/belegung', oeffnen: function() { ExcelAnsicht.oeffne('belegung'); } });
}

// ===== Weitere Fotos zu einem Beleg =====
function initZusatzfotos() {
  document.getElementById('feldZusatz').addEventListener('change', function(e) {
    var f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (zusatzNeu.length + zusatzBestehend.length >= MAX_ZUSATZ) { zeigeToast('Maximal ' + MAX_ZUSATZ + ' weitere Fotos pro Beleg', 'error'); return; }
    komprimieresBild(f, function(klein) {
      zusatzNeu.push(klein);
      zeigeZusatzListe();
    }, { immer: true, maxDim: 2400, qualitaet: 0.7 });
  });
}

function zeigeZusatzListe() {
  var ul = document.getElementById('zusatzListe');
  if (!ul) return;
  ul.innerHTML = '';
  function eintrag(text, onRemove) {
    var li = document.createElement('li');
    var span = document.createElement('span');
    span.textContent = text;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn-remove-file'; b.setAttribute('aria-label', 'Foto entfernen'); b.innerHTML = '&times;';
    b.addEventListener('click', onRemove);
    li.appendChild(span); li.appendChild(b); ul.appendChild(li);
  }
  zusatzBestehend.forEach(function(f, i) {
    eintrag((f.dateiname || 'Foto') + ' (gespeichert)', function() { zusatzEntfernen.push(f.id); zusatzBestehend.splice(i, 1); zeigeZusatzListe(); });
  });
  zusatzNeu.forEach(function(f, i) {
    eintrag(f.name + ' (' + Math.round(f.size / 1024) + ' KB)', function() { zusatzNeu.splice(i, 1); zeigeZusatzListe(); });
  });
}

// ===== Menü je nach Rolle =====
function istPrivilegiert() {
  var r = ((currentUser && currentUser.rolle) || '').split(',').map(function(x) { return x.trim(); });
  return r.indexOf('admin') >= 0 || r.indexOf('verwaltung') >= 0;
}
function istAdminRolle() {
  return ((currentUser && currentUser.rolle) || '').split(',').map(function(x) { return x.trim(); }).indexOf('admin') >= 0;
}
function richteMenueEin() {
  if (istPrivilegiert()) {
    document.getElementById('sidebarExport').classList.remove('hidden');
    document.getElementById('sidebarPapierkorb').classList.remove('hidden');
  }
  if (!istAdminRolle()) document.getElementById('sidebarPin').classList.remove('hidden');
}

// ===== PIN ändern, Papierkorb, Export =====
function zeigeModal(id) { document.getElementById(id).classList.add('active'); }
function schliesseWeitereModale() {
  ['pinOverlay', 'papierkorbOverlay', 'exportOverlay'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.classList.remove('active');
  });
}

function initPinPapierkorbExport() {
  ['pin', 'papierkorb', 'export'].forEach(function(k) {
    document.getElementById(k + 'Close').addEventListener('click', schliesseWeitereModale);
    document.getElementById(k + 'Overlay').addEventListener('click', function(e) { if (e.target === this) schliesseWeitereModale(); });
  });

  // --- PIN ---
  document.getElementById('sidebarPin').addEventListener('click', function() {
    schliesseSidebar();
    ['pinAlt', 'pinNeu', 'pinNeu2'].forEach(function(i) { document.getElementById(i).value = ''; });
    document.getElementById('pinError').classList.add('hidden');
    zeigeModal('pinOverlay');
    document.getElementById('pinAlt').focus();
  });
  document.getElementById('pinAbbrechen').addEventListener('click', schliesseWeitereModale);
  document.getElementById('pinSpeichern').addEventListener('click', function() {
    var err = document.getElementById('pinError');
    function f(t) { err.textContent = t; err.classList.remove('hidden'); }
    var alt = document.getElementById('pinAlt').value, neu = document.getElementById('pinNeu').value, neu2 = document.getElementById('pinNeu2').value;
    if (!/^\d{4}$/.test(neu)) return f('Der neue PIN muss genau 4 Ziffern haben.');
    if (neu !== neu2) return f('Die beiden neuen PINs stimmen nicht überein.');
    var xhr = new XMLHttpRequest();
    xhr.open('PUT', '/api/ich/pin', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function() {
      var d = {}; try { d = JSON.parse(xhr.responseText); } catch (e) {}
      if (xhr.status === 200) { schliesseWeitereModale(); zeigeToast('PIN geändert', 'success'); }
      else f(d.error || 'PIN konnte nicht geändert werden.');
    };
    xhr.onerror = function() { f('Keine Verbindung.'); };
    xhr.send(JSON.stringify({ pinAlt: alt, pinNeu: neu }));
  });

  // --- Papierkorb ---
  document.getElementById('sidebarPapierkorb').addEventListener('click', function() { schliesseSidebar(); ladePapierkorb(); zeigeModal('papierkorbOverlay'); });

  // --- Export ---
  document.getElementById('sidebarExport').addEventListener('click', function() {
    schliesseSidebar();
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/einstellungen', true);
    xhr.onload = function() {
      try {
        var d = JSON.parse(xhr.responseText);
        if (d.aktive_periode) { exportPeriode = d.aktive_periode; document.getElementById('exportVon').value = d.aktive_periode.von; document.getElementById('exportBis').value = d.aktive_periode.bis; }
        else { exportPeriode = null; }
        document.getElementById('exportPeriode').disabled = !exportPeriode;
      } catch (e) {}
    };
    xhr.send();
    zeigeModal('exportOverlay');
  });
  document.getElementById('exportAbbrechen').addEventListener('click', schliesseWeitereModale);
  document.getElementById('exportPeriode').addEventListener('click', function() {
    if (!exportPeriode) return;
    document.getElementById('exportVon').value = exportPeriode.von; document.getElementById('exportBis').value = exportPeriode.bis;
  });
  document.getElementById('exportAlles').addEventListener('click', function() { document.getElementById('exportVon').value = ''; document.getElementById('exportBis').value = ''; });
  document.getElementById('exportLos').addEventListener('click', function() {
    var p = new URLSearchParams();
    var v = document.getElementById('exportVon').value, b = document.getElementById('exportBis').value;
    if (v) p.append('von', v); if (b) p.append('bis', b);
    p.append('dezimal', document.getElementById('exportDezimal').value);
    window.location.href = '/api/export/belege.csv?' + p.toString();
    zeigeToast('Export wird heruntergeladen …', 'success');
  });
}
var exportPeriode = null;

function ladePapierkorb() {
  var box = document.getElementById('papierkorbInhalt');
  box.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:30px 0;">Wird geladen...</p>';
  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/api/papierkorb', true);
  xhr.onload = function() {
    var liste = [];
    try { liste = JSON.parse(xhr.responseText); } catch (e) {}
    if (xhr.status !== 200) { box.innerHTML = '<p style="color:var(--danger);text-align:center;">Papierkorb konnte nicht geladen werden.</p>'; return; }
    if (!liste.length) {
      box.innerHTML = '<div style="text-align:center;padding:30px 20px;"><svg viewBox="0 0 120 72" width="96" height="58" aria-hidden="true" style="margin-bottom:12px;"><path d="M0 72L30 24l14 18 16-30 22 36 10-12 28 36z" fill="#6FA3BF"/><path d="M60 12L50 30l6-3 4 5 5-4 6 3z" fill="#fff"/><path d="M0 72L22 44l12 14 14-20 18 34z" fill="#2F4A3A"/></svg><p style="color:var(--text-muted);">Der Papierkorb ist leer.</p></div>';
      return;
    }
    box.innerHTML = '<p style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">Gelöschte Belege bleiben 30 Tage hier und werden dann endgültig entfernt.</p>' +
      liste.map(function(b) {
        return '<div class="papierkorb-eintrag">' +
          '<div><strong>' + escapeHtml(b.geschaeft || 'Beleg') + '</strong> · ' + formatBetrag(b.betrag, b.waehrung) +
          '<div class="papierkorb-meta">' + formatDatum(b.datum) + ' · Nr. …' + escapeHtml(b.belegnummer || '–') + ' · ' + escapeHtml(b.benutzername) +
          '<br>Gelöscht von ' + escapeHtml(b.geloescht_von || '?') + ' · noch ' + b.verbleibendeTage + ' Tage' +
          (b.dateipfad ? ' · <a href="/uploads/' + encodeURIComponent(b.dateipfad) + '" target="_blank" rel="noopener">Foto ansehen</a>' : '') + '</div></div>' +
          '<div class="papierkorb-aktionen">' +
            '<button class="btn btn-secondary" data-pk="rest" data-id="' + b.id + '">Wiederherstellen</button>' +
            (istAdminRolle() ? '<button class="btn btn-danger" data-pk="del" data-id="' + b.id + '">Endgültig löschen</button>' : '') +
          '</div></div>';
      }).join('');
    box.querySelectorAll('[data-pk]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var del = btn.dataset.pk === 'del';
        if (del && !confirm('Diesen Beleg ENDGÜLTIG löschen? Das kann nicht rückgängig gemacht werden.')) return;
        var x = new XMLHttpRequest();
        x.open(del ? 'DELETE' : 'POST', '/api/papierkorb/' + btn.dataset.id + (del ? '' : '/wiederherstellen'), true);
        x.onload = function() {
          if (x.status === 200) { zeigeToast(del ? 'Endgültig gelöscht' : 'Beleg wiederhergestellt', 'success'); ladePapierkorb(); ladeBelege(); ladeStatistiken(); }
          else { var d = {}; try { d = JSON.parse(x.responseText); } catch (e) {} zeigeToast(d.error || 'Fehler', 'error'); }
        };
        x.send();
      });
    });
  };
  xhr.send();
}

// ===== Warteschlange für neue Belege (schlechtes/kein Internet) =====
// Belege werden zuerst lokal im Browser (IndexedDB) gespeichert, falls das Senden scheitert, und später automatisch gesendet.
var queueDbPromise = null;
function queueDb() {
  if (!queueDbPromise) {
    queueDbPromise = new Promise(function(resolve, reject) {
      if (!window.indexedDB) return reject(new Error('kein IndexedDB'));
      var r = indexedDB.open('gibeli-queue', 1);
      r.onupgradeneeded = function() { r.result.createObjectStore('belege', { keyPath: 'clientId' }); };
      r.onsuccess = function() { resolve(r.result); };
      r.onerror = function() { reject(r.error); };
    });
  }
  return queueDbPromise;
}
function queueOp(modus, fn) {
  return queueDb().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction('belege', modus);
      var res = fn(tx.objectStore('belege'));
      tx.oncomplete = function() { resolve(res && res.result); };
      tx.onerror = function() { reject(tx.error); };
    });
  });
}
function queueHinzufuegen(e) { return queueOp('readwrite', function(st) { return st.put(e); }).then(function() { queueBannerAktualisieren(); setzeQueueTimer(); }); }
function queueAlle() { return queueOp('readonly', function(st) { return st.getAll(); }).then(function(r) { return r || []; }).catch(function() { return []; }); }
function queueEntfernen(id) { return queueOp('readwrite', function(st) { return st.delete(id); }); }

var queueLaeuft = false, queueTimer = null;
function setzeQueueTimer() { if (!queueTimer) queueTimer = setInterval(verarbeiteQueue, 30000); }

function initQueue() {
  window.addEventListener('online', verarbeiteQueue);
  document.addEventListener('visibilitychange', function() { if (!document.hidden) verarbeiteQueue(); });
  queueAlle().then(function(l) { if (l.length) { setzeQueueTimer(); verarbeiteQueue(); } queueBannerAktualisieren(); });
}

function queueBannerAktualisieren() {
  queueAlle().then(function(liste) {
    var banner = document.getElementById('queueBanner');
    if (!liste.length) { banner.classList.add('hidden'); banner.innerHTML = ''; return; }
    var fehlerhaft = liste.filter(function(e) { return e.fehler; });
    var wartend = liste.length - fehlerhaft.length;
    var html = '';
    if (wartend) html += '<div>⏳ ' + wartend + ' Beleg' + (wartend > 1 ? 'e warten' : ' wartet') + ' auf Versand (kein Internet). Wird automatisch gesendet.</div>';
    fehlerhaft.forEach(function(e) {
      html += '<div class="queue-fehler">⚠ Beleg ' + escapeHtml(e.felder.datum) + ' (' + escapeHtml(e.felder.betrag) + '): ' + escapeHtml(e.fehler) +
        ' <button type="button" class="btn btn-secondary" data-q="nochmal" data-id="' + escapeHtml(e.clientId) + '">' + (e.duplikat ? 'Trotzdem senden' : 'Nochmal versuchen') + '</button>' +
        ' <button type="button" class="btn btn-danger" data-q="weg" data-id="' + escapeHtml(e.clientId) + '">Verwerfen</button></div>';
    });
    banner.innerHTML = html;
    banner.classList.remove('hidden');
    banner.querySelectorAll('[data-q]').forEach(function(b) {
      b.addEventListener('click', function() {
        var id = b.dataset.id;
        if (b.dataset.q === 'weg') { if (confirm('Diesen Beleg verwerfen? Er wird nicht gesendet.')) queueEntfernen(id).then(queueBannerAktualisieren); return; }
        queueOp('readwrite', function(st) { return st.get(id); }).then(function(e) {
          if (!e) return;
          e.fehler = null; if (e.duplikat) e.duplikatOk = true;
          return queueHinzufuegen(e).then(verarbeiteQueue);
        });
      });
    });
  });
}

function verarbeiteQueue() {
  if (queueLaeuft || navigator.onLine === false) return;
  queueLaeuft = true;
  queueAlle().then(function(liste) {
    var offen = liste.filter(function(e) { return !e.fehler; });
    var erfolg = false;
    function naechster(i) {
      if (i >= offen.length) { queueLaeuft = false; if (erfolg) { ladeBelege(); ladeStatistiken(); zeigeToast('Wartende Belege wurden gesendet', 'success'); } queueBannerAktualisieren(); return; }
      sendeQueueEintrag(offen[i], function(ergebnis) {
        if (ergebnis === 'netz') { queueLaeuft = false; queueBannerAktualisieren(); return; } // später erneut versuchen
        if (ergebnis === 'ok') erfolg = true;
        naechster(i + 1);
      });
    }
    naechster(0);
  }).catch(function() { queueLaeuft = false; });
}

function sendeQueueEintrag(e, cb) {
  var tokenGueltig = e.scanToken && !e.ohneToken && (Date.now() - (e.scanZeit || 0)) < 25 * 60 * 1000;
  var fd = new FormData();
  Object.keys(e.felder).forEach(function(k) { fd.append(k, e.felder[k]); });
  fd.append('clientId', e.clientId);
  if (e.duplikatOk) fd.append('duplikatOk', '1');
  if (tokenGueltig) fd.append('scanToken', e.scanToken); else if (e.haupt) fd.append('datei', e.haupt, e.haupt.name || 'beleg.jpg');
  (e.zusatz || []).forEach(function(f) { fd.append('zusatz', f, f.name || 'zusatz.jpg'); });
  var xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/belege', true);
  xhr.timeout = 180000;
  xhr.onload = function() {
    var d = {}; try { d = JSON.parse(xhr.responseText); } catch (x) {}
    if (xhr.status === 200 || xhr.status === 201) { queueEntfernen(e.clientId).then(function() { cb('ok'); }); return; }
    if (xhr.status === 401) { window.location.href = '/login.html'; return; }
    if (xhr.status === 0 || xhr.status >= 502) return cb('netz');
    if (xhr.status === 400 && tokenGueltig && e.haupt) { e.ohneToken = true; queueOp('readwrite', function(st) { return st.put(e); }).then(function() { sendeQueueEintrag(e, cb); }); return; }
    e.fehler = d.error || ('Fehler ' + xhr.status);
    e.duplikat = !!d.duplikat;
    queueOp('readwrite', function(st) { return st.put(e); }).then(function() { cb('fehler'); });
  };
  xhr.onerror = function() { cb('netz'); };
  xhr.ontimeout = function() { cb('netz'); };
  xhr.send(fd);
}

// ===== App-Installation / Offline-Hülle =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/sw.js').then(function() { return navigator.serviceWorker.ready; }).then(function(reg) {
      // Oberfläche für den Offline-Start zwischenspeichern (nur die App-Dateien, keine Daten)
      if (reg.active) reg.active.postMessage({ typ: 'huelle', urls: ['/', '/app.js', '/style.css', '/login.css', '/excel-ansicht.css', '/excel-ansicht.js', '/vendor/xlsx.full.min.js',
        '/fonts/inter-latin-500-normal.woff2', '/fonts/inter-latin-700-normal.woff2', '/fonts/fraunces-latin-700-normal.woff2'] });
    }).catch(function() {});
  });
}
