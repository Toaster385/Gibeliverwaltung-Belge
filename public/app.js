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
let scanState = { token: null, datum: null, belegnummer: null, betrag: null, waehrung: null, laufend: false };

const filterSuche = document.getElementById('filterSuche');
const filterVon = document.getElementById('filterVon');
const filterBis = document.getElementById('filterBis');

// ===== Init =====
document.addEventListener('DOMContentLoaded', function() {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/api/ich', true);
  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4) return;
    if (xhr.status !== 200) { window.location.href = '/login.html'; return; }
    try {
      var user = JSON.parse(xhr.responseText);
      currentUser = user;
      document.getElementById('headerUser').textContent = user.benutzername;
      document.getElementById('sidebarUser').textContent = user.benutzername;
    } catch(e) { window.location.href = '/login.html'; return; }
    ladeEinstellungen();
    ladeWechselkurs();
    ladeBelege();
    ladeStatistiken();
    setupEventListeners();
  };
  xhr.send();
});

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

function speichereBeleg(e) {
  if (e) e.preventDefault();
  var id = document.getElementById('belegId').value;
  var formError = document.getElementById('formError');
  formError.classList.add('hidden');

  var datum = document.getElementById('feldDatum').value;
  var betrag = document.getElementById('feldBetrag').value;
  var belegnummer = document.getElementById('feldBelegnummer').value.trim();
  var dateiFile = document.getElementById('feldDatei').files[0];
  var hatExistingFile = !document.getElementById('existingFile').classList.contains('hidden');

  if (!datum) {
    formError.textContent = 'Bitte das Datum angeben.';
    formError.classList.remove('hidden');
    return;
  }
  if (!betrag || parseFloat(betrag) <= 0) {
    formError.textContent = 'Bitte einen gültigen Betrag angeben.';
    formError.classList.remove('hidden');
    return;
  }
  if (!belegnummer || !/^\d{3}$/.test(belegnummer)) {
    formError.textContent = 'Bitte genau 3 Ziffern der Belegnummer angeben (z.B. 123).';
    formError.classList.remove('hidden');
    return;
  }
  if (scanState.laufend) {
    formError.textContent = 'Der Beleg wird noch gelesen – bitte einen Moment warten.';
    formError.classList.remove('hidden');
    return;
  }
  if (!dateiFile && !hatExistingFile && !scanState.token) {
    formError.textContent = 'Bitte einen Beleg (Bild oder PDF) hochladen.';
    formError.classList.remove('hidden');
    return;
  }

  var btn = document.getElementById('btnSpeichern');
  btn.disabled = true;

  var formData = new FormData();
  formData.append('datum', datum);
  formData.append('belegnummer', belegnummer);
  formData.append('geschaeft', document.getElementById('feldGeschaeft').value);
  formData.append('betrag', betrag);
  formData.append('notiz', document.getElementById('feldNotiz').value);
  formData.append('waehrung', document.getElementById('feldWaehrung').value);
  if (deleteFileFlag) formData.append('deleteFile', 'true');
  // Foto wurde bereits beim Scan hochgeladen – nur noch das Kürzel mitschicken (spart Upload bei langsamem Internet)
  var nutzeScan = !!scanState.token;
  if (nutzeScan) formData.append('scanToken', scanState.token);

  function senden(fileToSend) {
    if (fileToSend) formData.append('datei', fileToSend);
    btn.textContent = 'Wird hochgeladen...';
    var xhr = new XMLHttpRequest();
    var url = id ? '/api/belege/' + id : '/api/belege';
    xhr.open(id ? 'PUT' : 'POST', url, true);
    xhr.onreadystatechange = function() {
      if (xhr.readyState !== 4) return;
      btn.disabled = false;
      btn.textContent = 'Speichern';
      try {
        var data = JSON.parse(xhr.responseText);
        if (xhr.status !== 200 && xhr.status !== 201) {
          zeigeToast(data.error || 'Fehler beim Speichern', 'error');
          return;
        }
        schliesseModal();
        ladeBelege();
        ladeStatistiken();
        zeigeToast(id ? 'Beleg aktualisiert' : 'Beleg gespeichert', 'success');
      } catch(e) {
        zeigeToast('Fehler beim Speichern', 'error');
      }
    };
    xhr.send(formData);
  }

  if (nutzeScan) {
    senden(null);
  } else if (dateiFile && dateiFile.type.startsWith('image/') && dateiFile.size > 400 * 1024) {
    btn.textContent = 'Bild wird komprimiert...';
    komprimieresBild(dateiFile, function(compressed, wurdeKomprimiert) {
      if (wurdeKomprimiert) {
        zeigeToast('Bild komprimiert: ' + Math.round(compressed.size / 1024) + ' KB', '');
      }
      senden(compressed);
    });
  } else {
    senden(dateiFile || null);
  }
}

function loescheBeleg(id) {
  if (!confirm('Beleg wirklich löschen?')) return;
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
    zeigeToast('Beleg gelöscht', 'success');
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
  } else {
    document.getElementById('modalTitel').textContent = 'Neuer Beleg';
    document.getElementById('feldDatum').value = new Date().toISOString().slice(0, 10);
    setWaehrung('EUR');
  }

  document.getElementById('formError').classList.add('hidden');
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
    mediaHTML = '<img src="/uploads/' + b.dateipfad + '" alt="Beleg">';
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
    '</div>' + mediaHTML;

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
  scanState = { token: null, datum: null, belegnummer: null, betrag: null, waehrung: null, laufend: false };
  var st = document.getElementById('scanStatus');
  if (st) { st.className = 'scan-status hidden'; st.textContent = ''; }
  zeigeScanDetails('');
  ['hintDatum', 'hintBelegnummer', 'hintBetrag'].forEach(function(id) {
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

// ===== Excel-Bereiche: Aktuelle Belegung & Gerichte =====
// Beide Bereiche verhalten sich gleich: alle sehen die Tabelle, Hochladen/Löschen nur mit passender Rolle.
var EXCEL_BEREICHE = [
  { key: 'belegung', id: 'Belegung', titel: 'Aktuelle Belegung', api: '/api/belegung', leer: 'Noch keine Belegung hochgeladen.', schreibRollen: ['admin', 'verwaltung'] },
  { key: 'gerichte', id: 'Gerichte', titel: 'Gerichte', api: '/api/gerichte', leer: 'Noch keine Gerichte hochgeladen.', schreibRollen: ['admin', 'gerichte'] }
];

function excelBereich(key) {
  return EXCEL_BEREICHE.filter(function(b) { return b.key === key; })[0];
}

function initExcelBereiche() {
  EXCEL_BEREICHE.forEach(function(b) {
    var wrap = document.createElement('div');
    wrap.className = 'modal-overlay';
    wrap.id = b.key + 'Overlay';
    wrap.innerHTML =
      '<div class="modal modal-belegung" role="dialog" aria-modal="true" aria-labelledby="' + b.key + 'Titel">' +
        '<div class="modal-header">' +
          '<h2 id="' + b.key + 'Titel">' + b.titel + '</h2>' +
          '<button class="modal-close" id="' + b.key + 'Close" aria-label="Schliessen">&times;</button>' +
        '</div>' +
        '<div id="' + b.key + 'ModalContent" style="padding:20px;overflow:auto;max-height:60vh;"></div>' +
        '<div id="' + b.key + 'UploadArea" class="hidden" style="padding:14px 20px 20px;border-top:1px solid var(--border);background:var(--bg);">' +
          '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">' +
            '<label for="' + b.key + 'DateiInput" style="font-size:13px;font-weight:600;white-space:nowrap;">Hochladen / ersetzen:</label>' +
            '<input type="file" id="' + b.key + 'DateiInput" accept=".xlsx,.xls,.ods" style="font-size:13px;flex:1 1 100%;min-width:0;">' +
            '<button class="btn btn-primary" id="btn' + b.id + 'Hochladen" style="white-space:nowrap;">Hochladen</button>' +
            '<button class="btn btn-danger" id="btn' + b.id + 'Loeschen" style="white-space:nowrap;">Löschen</button>' +
          '</div>' +
          '<div id="' + b.key + 'UploadMsg" style="font-size:13px;margin-top:8px;display:none;"></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    document.getElementById(b.key + 'Close').addEventListener('click', function() { schliesseExcelModal(b); });
    wrap.addEventListener('click', function(e) { if (e.target === wrap) schliesseExcelModal(b); });
    document.getElementById('btn' + b.id + 'Hochladen').addEventListener('click', function() { hochladenExcel(b); });
    document.getElementById('btn' + b.id + 'Loeschen').addEventListener('click', function() { loeschenExcel(b); });
    var side = document.getElementById('sidebar' + b.id);
    if (side) side.addEventListener('click', function() { schliesseSidebar(); oeffneExcelModal(b); });
  });
}

function hatSchreibRecht(b) {
  var rollen = ((currentUser && currentUser.rolle) || '').split(',').map(function(r) { return r.trim(); });
  return rollen.some(function(r) { return b.schreibRollen.indexOf(r) >= 0; });
}

function oeffneExcelModal(b) {
  document.getElementById(b.key + 'Overlay').classList.add('active');
  ladeExcelInfo(b);
}

function schliesseExcelModal(b) {
  document.getElementById(b.key + 'Overlay').classList.remove('active');
}

function schliesseExcelModale() {
  EXCEL_BEREICHE.forEach(function(b) {
    var el = document.getElementById(b.key + 'Overlay');
    if (el) el.classList.remove('active');
  });
}

function ladeExcelInfo(b) {
  var content = document.getElementById(b.key + 'ModalContent');
  content.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:40px 0;">Wird geladen...</p>';

  var hatRechte = hatSchreibRecht(b);
  var uploadArea = document.getElementById(b.key + 'UploadArea');
  var uploadMsg = document.getElementById(b.key + 'UploadMsg');
  if (uploadMsg) uploadMsg.style.display = 'none';
  if (hatRechte) { uploadArea.classList.remove('hidden'); } else { uploadArea.classList.add('hidden'); }

  var xhr = new XMLHttpRequest();
  xhr.open('GET', b.api, true);
  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4) return;
    try {
      zeigeExcelTabelle(b, JSON.parse(xhr.responseText), hatRechte);
    } catch(e) {
      content.innerHTML = '<p style="color:var(--danger);text-align:center;">Fehler beim Laden</p>';
    }
  };
  xhr.send();
}

function zeigeExcelTabelle(b, data, hatRechte) {
  var content = document.getElementById(b.key + 'ModalContent');
  var btnDel = document.getElementById('btn' + b.id + 'Loeschen');

  if (!data.vorhanden) {
    content.innerHTML =
      '<div style="text-align:center;padding:40px 20px;">' +
        '<svg viewBox="0 0 120 72" width="96" height="58" aria-hidden="true" style="margin-bottom:12px;"><path d="M0 72L30 24l14 18 16-30 22 36 10-12 28 36z" fill="#6FA3BF"/><path d="M60 12L50 30l6-3 4 5 5-4 6 3z" fill="#fff"/><path d="M0 72L22 44l12 14 14-20 18 34z" fill="#2F4A3A"/></svg>' +
        '<p style="color:var(--text-muted);">' + b.leer + '</p>' +
        (hatRechte ? '<p style="color:var(--text-muted);font-size:13px;margin-top:6px;">Lade eine Excel-Datei unten hoch.</p>' : '') +
      '</div>';
    if (btnDel) btnDel.style.visibility = 'hidden';
    return;
  }

  if (btnDel) btnDel.style.visibility = '';

  var hochgeladenAm = '';
  if (data.hochgeladen_am) {
    try { hochgeladenAm = new Date(data.hochgeladen_am).toLocaleString('de-DE'); } catch(e) {}
  }

  content.innerHTML =
    '<div style="margin-bottom:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
      '<strong>' + escapeHtml(data.dateiname) + '</strong>' +
      (hochgeladenAm ? '<span style="color:var(--text-muted);font-size:12px;">Hochgeladen: ' + hochgeladenAm + '</span>' : '') +
    '</div>' +
    '<div id="' + b.key + 'Tabelle">' +
      '<p style="color:var(--text-muted);font-size:13px;">Tabelle wird geladen...</p>' +
    '</div>';

  ladeXLSXUndRendere(b);
}

function ladeXLSXUndRendere(b) {
  if (typeof XLSX !== 'undefined') { fetchUndRendereExcel(b); return; }
  var script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  script.onload = function() { fetchUndRendereExcel(b); };
  script.onerror = function() {
    var t = document.getElementById(b.key + 'Tabelle');
    if (t) t.innerHTML = '<p style="color:var(--danger);">Excel-Bibliothek konnte nicht geladen werden.</p>';
  };
  document.head.appendChild(script);
}

function fetchUndRendereExcel(b) {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', b.api + '/datei', true);
  xhr.responseType = 'arraybuffer';
  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4) return;
    var t = document.getElementById(b.key + 'Tabelle');
    if (!t) return;
    if (xhr.status !== 200) {
      t.innerHTML = '<p style="color:var(--danger);">Datei konnte nicht geladen werden.</p>';
      return;
    }
    try {
      var wb = XLSX.read(new Uint8Array(xhr.response), { type: 'array' });
      var ws = wb.Sheets[wb.SheetNames[0]];
      var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (!rows.length) { t.innerHTML = '<p style="color:var(--text-muted);">Die Tabelle ist leer.</p>'; return; }
      var html = '<div style="overflow:auto;max-height:50vh;"><table class="belegung-table"><tbody>';
      rows.forEach(function(row, ri) {
        html += '<tr>';
        (row || []).forEach(function(cell) {
          var tag = ri === 0 ? 'th' : 'td';
          html += '<' + tag + '>' + escapeHtml(String(cell === null || cell === undefined ? '' : cell)) + '</' + tag + '>';
        });
        html += '</tr>';
      });
      html += '</tbody></table></div>';
      t.innerHTML = html;
    } catch(e) {
      t.innerHTML = '<p style="color:var(--danger);">Fehler beim Lesen der Datei: ' + escapeHtml(e.message || '') + '</p>';
    }
  };
  xhr.send();
}

function hochladenExcel(b) {
  var input = document.getElementById(b.key + 'DateiInput');
  var msg = document.getElementById(b.key + 'UploadMsg');
  msg.style.display = 'none';
  if (!input.files || !input.files[0]) {
    msg.textContent = 'Bitte eine Excel-Datei auswählen.';
    msg.style.color = 'var(--rot-dunkel)';
    msg.style.display = 'block';
    return;
  }
  var btn = document.getElementById('btn' + b.id + 'Hochladen');
  btn.disabled = true;
  btn.textContent = 'Wird hochgeladen...';
  var formData = new FormData();
  formData.append('datei', input.files[0]);
  var xhr = new XMLHttpRequest();
  xhr.open('POST', b.api, true);
  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4) return;
    btn.disabled = false;
    btn.textContent = 'Hochladen';
    try {
      var data = JSON.parse(xhr.responseText);
      if (xhr.status !== 200) {
        msg.textContent = data.error || 'Fehler beim Hochladen.';
        msg.style.color = 'var(--rot-dunkel)';
        msg.style.display = 'block';
        return;
      }
      input.value = '';
      msg.textContent = '✓ Datei erfolgreich hochgeladen!';
      msg.style.color = 'var(--tanne)';
      msg.style.display = 'block';
      setTimeout(function() { msg.style.display = 'none'; }, 3000);
      ladeExcelInfo(b);
    } catch(e) {
      msg.textContent = 'Unerwarteter Fehler.';
      msg.style.color = 'var(--rot-dunkel)';
      msg.style.display = 'block';
    }
  };
  xhr.send(formData);
}

function loeschenExcel(b) {
  if (!confirm(b.titel + '-Datei wirklich löschen?')) return;
  var xhr = new XMLHttpRequest();
  xhr.open('DELETE', b.api, true);
  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4) return;
    if (xhr.status === 200) { ladeExcelInfo(b); }
    else { zeigeToast('Fehler beim Löschen', 'error'); }
  };
  xhr.send();
}
