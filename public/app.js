// ===== State =====
let belege = [];
let filterTimeout = null;
let deleteFileFlag = false;

const filterSuche = document.getElementById('filterSuche');
const filterKategorie = document.getElementById('filterKategorie');
const filterVon = document.getElementById('filterVon');
const filterBis = document.getElementById('filterBis');

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  ladeBelege();
  ladeStatistiken();
  setupEventListeners();
});

// ===== Event Listeners =====
function setupEventListeners() {
  document.getElementById('btnNeuBeleg').addEventListener('click', () => oeffneModal());
  document.getElementById('modalClose').addEventListener('click', schliesseModal);
  document.getElementById('btnAbbrechen').addEventListener('click', schliesseModal);
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modalOverlay')) schliesseModal();
  });
  document.getElementById('previewClose').addEventListener('click', schliessePreview);
  document.getElementById('previewOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('previewOverlay')) schliessePreview();
  });

  document.getElementById('formBeleg').addEventListener('submit', speichereBeleg);

  // Filter
  filterSuche.addEventListener('input', () => {
    clearTimeout(filterTimeout);
    filterTimeout = setTimeout(ladeBelege, 300);
  });
  filterKategorie.addEventListener('change', ladeBelege);
  filterVon.addEventListener('change', ladeBelege);
  filterBis.addEventListener('change', ladeBelege);
  document.getElementById('btnFilterReset').addEventListener('click', resetFilter);

  // File Upload
  const uploadArea = document.getElementById('uploadArea');
  const feldDatei = document.getElementById('feldDatei');

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      feldDatei.files = e.dataTransfer.files;
      zeigeVorschau(e.dataTransfer.files[0]);
    }
  });

  feldDatei.addEventListener('change', (e) => {
    if (e.target.files.length > 0) zeigeVorschau(e.target.files[0]);
  });

  document.getElementById('btnRemoveFile').addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    loescheDateiVorschau();
  });

  document.getElementById('btnDeleteFile').addEventListener('click', () => {
    deleteFileFlag = true;
    document.getElementById('existingFile').classList.add('hidden');
  });

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      schliesseModal();
      schliessePreview();
    }
  });
}

// ===== API Calls =====
async function ladeBelege() {
  const params = new URLSearchParams();
  const suche = filterSuche.value.trim();
  const kat = filterKategorie.value;
  const von = filterVon.value;
  const bis = filterBis.value;

  if (suche) params.append('suche', suche);
  if (kat && kat !== 'alle') params.append('kategorie', kat);
  if (von) params.append('von', von);
  if (bis) params.append('bis', bis);

  try {
    const res = await fetch('/api/belege?' + params.toString());
    belege = await res.json();
    rendereGrid();
  } catch (err) {
    zeigeToast('Fehler beim Laden der Belege', 'error');
  }
}

async function ladeStatistiken() {
  try {
    const res = await fetch('/api/statistiken');
    const stats = await res.json();
    document.getElementById('statAnzahl').textContent = stats.gesamt.anzahl;
    document.getElementById('statGesamt').textContent = formatBetrag(stats.gesamt.gesamt || 0);
    document.getElementById('statMonat').textContent = stats.dieserMonat.anzahl;
    document.getElementById('statMonatBetrag').textContent = formatBetrag(stats.dieserMonat.gesamt || 0);
  } catch (err) {
    console.error('Statistiken konnten nicht geladen werden');
  }
}

async function speichereBeleg(e) {
  e.preventDefault();
  const id = document.getElementById('belegId').value;
  const formData = new FormData();

  formData.append('datum', document.getElementById('feldDatum').value);
  formData.append('geschaeft', document.getElementById('feldGeschaeft').value);
  formData.append('betrag', document.getElementById('feldBetrag').value);
  formData.append('kategorie', document.getElementById('feldKategorie').value);
  formData.append('notiz', document.getElementById('feldNotiz').value);

  const dateiFile = document.getElementById('feldDatei').files[0];
  if (dateiFile) formData.append('datei', dateiFile);
  if (deleteFileFlag) formData.append('deleteFile', 'true');

  const btn = document.getElementById('btnSpeichern');
  btn.disabled = true;
  btn.textContent = 'Speichern...';

  try {
    const url = id ? `/api/belege/${id}` : '/api/belege';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, { method, body: formData });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Fehler beim Speichern');
    }

    schliesseModal();
    await ladeBelege();
    await ladeStatistiken();
    zeigeToast(id ? 'Beleg aktualisiert' : 'Beleg gespeichert', 'success');
  } catch (err) {
    zeigeToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Speichern';
  }
}

async function loescheBeleg(id) {
  if (!confirm('Beleg wirklich löschen?')) return;

  try {
    const res = await fetch(`/api/belege/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Löschen fehlgeschlagen');

    await ladeBelege();
    await ladeStatistiken();
    zeigeToast('Beleg gelöscht', 'success');
  } catch (err) {
    zeigeToast(err.message, 'error');
  }
}

// ===== Render =====
function rendereGrid() {
  const grid = document.getElementById('belegeGrid');
  const empty = document.getElementById('emptyState');

  if (belege.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  grid.innerHTML = belege.map(b => kartHTML(b)).join('');

  grid.querySelectorAll('[data-action="edit"]').forEach(btn =>
    btn.addEventListener('click', () => oeffneModal(parseInt(btn.dataset.id)))
  );
  grid.querySelectorAll('[data-action="delete"]').forEach(btn =>
    btn.addEventListener('click', () => loescheBeleg(parseInt(btn.dataset.id)))
  );
  grid.querySelectorAll('[data-action="preview"]').forEach(el =>
    el.addEventListener('click', () => oeffnePreview(parseInt(el.dataset.id)))
  );
}

function kartHTML(b) {
  const hatDatei = !!b.dateipfad;
  const istBild = hatDatei && /\.(jpg|jpeg|png|gif|webp)$/i.test(b.dateiname || '');
  const istPdf = hatDatei && /\.pdf$/i.test(b.dateiname || '');

  let thumbHTML = '';
  if (istBild) {
    thumbHTML = `
      <div class="card-thumb" data-action="preview" data-id="${b.id}">
        <img src="/uploads/${b.dateipfad}" alt="Beleg" loading="lazy">
        <div class="thumb-overlay">Vergrössern</div>
      </div>`;
  } else if (istPdf) {
    thumbHTML = `
      <div class="card-thumb" data-action="preview" data-id="${b.id}">
        <div class="thumb-placeholder">📄</div>
        <div class="thumb-overlay">PDF anzeigen</div>
      </div>`;
  } else if (hatDatei) {
    thumbHTML = `
      <div class="card-thumb" data-action="preview" data-id="${b.id}">
        <div class="thumb-placeholder">📎</div>
        <div class="thumb-overlay">Datei anzeigen</div>
      </div>`;
  } else {
    thumbHTML = `
      <div class="card-thumb" style="cursor:default;">
        <div class="thumb-placeholder">🧾</div>
      </div>`;
  }

  return `
    <div class="beleg-card">
      ${thumbHTML}
      <div class="card-body">
        <div class="card-top">
          <span class="card-shop">${escapeHtml(b.geschaeft)}</span>
          <span class="card-amount">${formatBetrag(b.betrag)}</span>
        </div>
        <div class="card-meta">
          <span class="card-date">${formatDatum(b.datum)}</span>
          <span class="badge cat-${b.kategorie}">${b.kategorie}</span>
        </div>
        ${b.notiz ? `<div class="card-note">${escapeHtml(b.notiz)}</div>` : ''}
      </div>
      <div class="card-actions">
        <button class="btn-icon" data-action="edit" data-id="${b.id}">&#9998; Bearbeiten</button>
        ${hatDatei ? `<button class="btn-icon" data-action="preview" data-id="${b.id}">&#128065; Ansehen</button>` : ''}
        <button class="btn-icon danger" data-action="delete" data-id="${b.id}">&#128465; Löschen</button>
      </div>
    </div>`;
}

// ===== Modal =====
function oeffneModal(id = null) {
  deleteFileFlag = false;
  const overlay = document.getElementById('modalOverlay');
  const form = document.getElementById('formBeleg');
  form.reset();
  loescheDateiVorschau();
  document.getElementById('existingFile').classList.add('hidden');
  document.getElementById('belegId').value = '';

  if (id !== null) {
    const b = belege.find(x => x.id === id);
    if (!b) return;
    document.getElementById('modalTitel').textContent = 'Beleg bearbeiten';
    document.getElementById('belegId').value = b.id;
    document.getElementById('feldDatum').value = b.datum;
    document.getElementById('feldGeschaeft').value = b.geschaeft;
    document.getElementById('feldBetrag').value = b.betrag;
    document.getElementById('feldKategorie').value = b.kategorie;
    document.getElementById('feldNotiz').value = b.notiz || '';

    if (b.dateiname) {
      document.getElementById('existingFileName').textContent = b.dateiname;
      document.getElementById('existingFile').classList.remove('hidden');
    }
  } else {
    document.getElementById('modalTitel').textContent = 'Neuer Beleg';
    document.getElementById('feldDatum').value = new Date().toISOString().slice(0, 10);
  }

  overlay.classList.add('active');
}

function schliesseModal() {
  document.getElementById('modalOverlay').classList.remove('active');
}

// ===== Preview =====
function oeffnePreview(id) {
  const b = belege.find(x => x.id === id);
  if (!b || !b.dateipfad) return;

  const overlay = document.getElementById('previewOverlay');
  const content = document.getElementById('previewContent');
  const istBild = /\.(jpg|jpeg|png|gif|webp)$/i.test(b.dateiname || '');
  const istPdf = /\.pdf$/i.test(b.dateiname || '');

  document.getElementById('previewTitel').textContent = b.geschaeft;

  let mediaHTML = '';
  if (istBild) {
    mediaHTML = `<img src="/uploads/${b.dateipfad}" alt="Beleg ${escapeHtml(b.geschaeft)}">`;
  } else if (istPdf) {
    mediaHTML = `<iframe src="/uploads/${b.dateipfad}" title="PDF Beleg"></iframe>`;
  } else {
    mediaHTML = `<a href="/uploads/${b.dateipfad}" download="${escapeHtml(b.dateiname)}" class="btn btn-primary">Datei herunterladen</a>`;
  }

  content.innerHTML = `
    <div class="preview-info">
      <div class="preview-info-item">
        <div class="preview-info-label">Geschäft</div>
        <div class="preview-info-value">${escapeHtml(b.geschaeft)}</div>
      </div>
      <div class="preview-info-item">
        <div class="preview-info-label">Betrag</div>
        <div class="preview-info-value">${formatBetrag(b.betrag)}</div>
      </div>
      <div class="preview-info-item">
        <div class="preview-info-label">Datum</div>
        <div class="preview-info-value">${formatDatum(b.datum)}</div>
      </div>
      <div class="preview-info-item">
        <div class="preview-info-label">Kategorie</div>
        <div class="preview-info-value">${b.kategorie}</div>
      </div>
      ${b.notiz ? `<div class="preview-info-item" style="grid-column:1/-1">
        <div class="preview-info-label">Notiz</div>
        <div class="preview-info-value">${escapeHtml(b.notiz)}</div>
      </div>` : ''}
    </div>
    ${mediaHTML}
  `;

  overlay.classList.add('active');
}

function schliessePreview() {
  document.getElementById('previewOverlay').classList.remove('active');
}

// ===== File Preview =====
function zeigeVorschau(file) {
  const placeholder = document.getElementById('uploadPlaceholder');
  const preview = document.getElementById('uploadPreview');
  const previewImg = document.getElementById('previewImg');
  const previewPdf = document.getElementById('previewPdf');
  const previewName = document.getElementById('previewName');

  placeholder.classList.add('hidden');
  preview.classList.remove('hidden');
  previewName.textContent = file.name;

  if (file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = (e) => {
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
  filterKategorie.value = 'alle';
  filterVon.value = '';
  filterBis.value = '';
  ladeBelege();
}

// ===== Toast =====
function zeigeToast(msg, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'toast show ' + type;
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// ===== Helpers =====
function formatBetrag(betrag) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(betrag);
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
