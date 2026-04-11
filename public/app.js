// ===== State =====
let belege = [];
let filterTimeout = null;
let deleteFileFlag = false;
let wechselkurs = { EUR_to_CHF: 0.95, CHF_to_EUR: 1.053 };
let statsData = null;
let kasseGeschlossen = false;
let statsWaehrung = 'EUR';
let currentUser = null;

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
      document.getElementById('headerUser').textContent = '👤 ' + user.benutzername;
      document.getElementById('sidebarUser').textContent = '👤 ' + user.benutzername;
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
  document.getElementById('sidebarBelegung').addEventListener('click', function() {
    schliesseSidebar();
    oeffneBelegungModal();
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

  // Aktuelle Belegung modal
  document.getElementById('belegungClose').addEventListener('click', schliesseBelegungModal);
  document.getElementById('belegungOverlay').addEventListener('click', function(e) {
    if (e.target === document.getElementById('belegungOverlay')) schliesseBelegungModal();
  });
  document.getElementById('btnBelegungHochladen').addEventListener('click', hochladenBelegung);
  document.getElementById('btnBelegungLoeschen').addEventListener('click', loeschenBelegung);

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
      feldDatei.files = e.dataTransfer.files;
      zeigeVorschau(e.dataTransfer.files[0]);
    }
  });

  feldDatei.addEventListener('change', function(e) {
    if (e.target.files.length > 0) zeigeVorschau(e.target.files[0]);
  });

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
      schliesseBelegungModal();
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
      document.getElementById('statMonat').textContent = statsData.dieserMonat.anzahl || 0;
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
  var mEur = statsData.dieserMonat.gesamt_eur || 0;
  var mChf = statsData.dieserMonat.gesamt_chf || 0;

  var gesamtAnzeige, monatAnzeige, kursText;
  if (statsWaehrung === 'CHF') {
    gesamtAnzeige = gChf + gEur * eurCHF;
    monatAnzeige = mChf + mEur * eurCHF;
    kursText = '1 EUR = ' + eurCHF.toFixed(4) + ' CHF';
    document.getElementById('statGesamt').textContent = formatBetrag(gesamtAnzeige, 'CHF');
    document.getElementById('statMonatBetrag').textContent = formatBetrag(monatAnzeige, 'CHF');
  } else {
    gesamtAnzeige = gEur + gChf * chfEUR;
    monatAnzeige = mEur + mChf * chfEUR;
    kursText = '1 CHF = ' + chfEUR.toFixed(4) + ' EUR';
    document.getElementById('statGesamt').textContent = formatBetrag(gesamtAnzeige, 'EUR');
    document.getElementById('statMonatBetrag').textContent = formatBetrag(monatAnzeige, 'EUR');
  }

  var kursEl = document.getElementById('statKurs');
  if (kursEl) kursEl.textContent = (gChf > 0 && gEur > 0) ? kursText : '';
}

// ===== Image Compression =====
function komprimieresBild(file, callback) {
  if (!file.type.startsWith('image/') || file.size < 400 * 1024) {
    callback(file, false);
    return;
  }
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      var maxDim = 1600;
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
      }, 'image/jpeg', 0.82);
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
  if (!dateiFile && !hatExistingFile) {
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

  if (dateiFile && dateiFile.type.startsWith('image/') && dateiFile.size > 400 * 1024) {
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

function kartHTML(b) {
  var hatDatei = !!b.dateipfad;
  var istBild = hatDatei && /\.(jpg|jpeg|png|gif|webp)$/i.test(b.dateiname || '');
  var istPdf = hatDatei && /\.pdf$/i.test(b.dateiname || '');

  var thumbHTML = '';
  if (istBild) {
    thumbHTML = '<div class="card-thumb" data-action="preview" data-id="' + b.id + '">' +
      '<img src="/uploads/' + b.dateipfad + '" alt="Beleg" loading="lazy">' +
      '<div class="thumb-overlay">Vergrössern</div></div>';
  } else if (istPdf) {
    thumbHTML = '<div class="card-thumb" data-action="preview" data-id="' + b.id + '">' +
      '<div class="thumb-placeholder">📄</div><div class="thumb-overlay">PDF anzeigen</div></div>';
  } else if (hatDatei) {
    thumbHTML = '<div class="card-thumb" data-action="preview" data-id="' + b.id + '">' +
      '<div class="thumb-placeholder">📎</div><div class="thumb-overlay">Datei anzeigen</div></div>';
  } else {
    thumbHTML = '<div class="card-thumb" style="cursor:default;">' +
      '<div class="thumb-placeholder">🧾</div></div>';
  }

  var istEingetragen = b.status === 'eingetragen';
  var waehrung = b.waehrung || 'EUR';

  return '<div class="beleg-card">' +
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
          (istEingetragen ? '✓ Eingetragen' : '⏳ Ausstehend') + '</span>' +
      '</div>' +
      (b.notiz ? '<div class="card-note">' + escapeHtml(b.notiz) + '</div>' : '') +
    '</div>' +
    '<div class="card-actions">' +
      (!istEingetragen ? '<button class="btn-icon" data-action="edit" data-id="' + b.id + '">&#9998; Bearbeiten</button>' : '') +
      (hatDatei ? '<button class="btn-icon" data-action="preview" data-id="' + b.id + '">&#128065; Ansehen</button>' : '') +
      (!istEingetragen ? '<button class="btn-icon danger" data-action="delete" data-id="' + b.id + '">&#128465; Löschen</button>' : '') +
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
  document.getElementById('feldDatei').value = '';
  document.getElementById('uploadPlaceholder').classList.remove('hidden');
  document.getElementById('uploadPreview').classList.add('hidden');
  document.getElementById('previewImg').src = '';
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

// ===== Aktuelle Belegung =====
function oeffneBelegungModal() {
  document.getElementById('belegungOverlay').classList.add('active');
  ladeBelegungInfo();
}

function schliesseBelegungModal() {
  document.getElementById('belegungOverlay').classList.remove('active');
}

function ladeBelegungInfo() {
  var content = document.getElementById('belegungModalContent');
  content.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:40px 0;">Wird geladen...</p>';

  var hatRechte = currentUser && (currentUser.rolle || '').split(',').map(function(r) {
    return r.trim();
  }).some(function(r) { return r === 'admin' || r === 'verwaltung'; });

  var uploadArea = document.getElementById('belegungUploadArea');
  var uploadMsg = document.getElementById('belegungUploadMsg');
  if (uploadMsg) uploadMsg.style.display = 'none';
  if (hatRechte) { uploadArea.classList.remove('hidden'); } else { uploadArea.classList.add('hidden'); }

  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/api/belegung', true);
  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4) return;
    try {
      zeigeBelegungTabelle(JSON.parse(xhr.responseText), hatRechte);
    } catch(e) {
      content.innerHTML = '<p style="color:var(--danger);text-align:center;">Fehler beim Laden</p>';
    }
  };
  xhr.send();
}

function zeigeBelegungTabelle(data, hatRechte) {
  var content = document.getElementById('belegungModalContent');
  var btnDel = document.getElementById('btnBelegungLoeschen');

  if (!data.vorhanden) {
    content.innerHTML =
      '<div style="text-align:center;padding:40px 20px;">' +
        '<div style="font-size:48px;opacity:.4;margin-bottom:12px;">📋</div>' +
        '<p style="color:var(--text-muted);">Noch keine Belegung hochgeladen.</p>' +
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
      '<strong>📄 ' + escapeHtml(data.dateiname) + '</strong>' +
      (hochgeladenAm ? '<span style="color:var(--text-muted);font-size:12px;">Hochgeladen: ' + hochgeladenAm + '</span>' : '') +
    '</div>' +
    '<div id="belegungTabelle">' +
      '<p style="color:var(--text-muted);font-size:13px;">Tabelle wird geladen...</p>' +
    '</div>';

  ladeXLSXUndRendere();
}

function ladeXLSXUndRendere() {
  if (typeof XLSX !== 'undefined') { fetchUndRendereExcel(); return; }
  var script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  script.onload = fetchUndRendereExcel;
  script.onerror = function() {
    var t = document.getElementById('belegungTabelle');
    if (t) t.innerHTML = '<p style="color:var(--danger);">Excel-Bibliothek konnte nicht geladen werden.</p>';
  };
  document.head.appendChild(script);
}

function fetchUndRendereExcel() {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/api/belegung/datei', true);
  xhr.responseType = 'arraybuffer';
  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4) return;
    var t = document.getElementById('belegungTabelle');
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

function hochladenBelegung() {
  var input = document.getElementById('belegungDateiInput');
  var msg = document.getElementById('belegungUploadMsg');
  msg.style.display = 'none';
  if (!input.files || !input.files[0]) {
    msg.textContent = 'Bitte eine Excel-Datei auswählen.';
    msg.style.color = '#991b1b';
    msg.style.display = 'block';
    return;
  }
  var btn = document.getElementById('btnBelegungHochladen');
  btn.disabled = true;
  btn.textContent = 'Wird hochgeladen...';
  var formData = new FormData();
  formData.append('datei', input.files[0]);
  var xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/belegung', true);
  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4) return;
    btn.disabled = false;
    btn.textContent = 'Hochladen';
    try {
      var data = JSON.parse(xhr.responseText);
      if (xhr.status !== 200) {
        msg.textContent = data.error || 'Fehler beim Hochladen.';
        msg.style.color = '#991b1b';
        msg.style.display = 'block';
        return;
      }
      input.value = '';
      msg.textContent = '✓ Datei erfolgreich hochgeladen!';
      msg.style.color = '#065f46';
      msg.style.display = 'block';
      setTimeout(function() { msg.style.display = 'none'; }, 3000);
      ladeBelegungInfo();
    } catch(e) {
      msg.textContent = 'Unerwarteter Fehler.';
      msg.style.color = '#991b1b';
      msg.style.display = 'block';
    }
  };
  xhr.send(formData);
}

function loeschenBelegung() {
  if (!confirm('Belegung-Datei wirklich löschen?')) return;
  var xhr = new XMLHttpRequest();
  xhr.open('DELETE', '/api/belegung', true);
  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4) return;
    if (xhr.status === 200) { ladeBelegungInfo(); }
    else { zeigeToast('Fehler beim Löschen', 'error'); }
  };
  xhr.send();
}
