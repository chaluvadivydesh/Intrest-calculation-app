// ===== GLOBAL STATE =====
let history = [];
// Per-section state: keyed by calcId (integer 1..10)
const sections = {};   // sections[id] = { rate, freqDays, result }

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
    bindGlobalEvents();
    setCalcCount(1);   // start with 1 section
    registerSW();
});

// ===== MOBILE DETECTION =====
function isMobile() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
           (navigator.maxTouchPoints > 1 && window.innerWidth <= 900);
}

// ===== PARSE DD/MM/YYYY → YYYY-MM-DD (mobile manual entry) =====
function parseDDMMYYYY(str) {
    if (!str) return '';
    // Accept DD/MM/YYYY or DD-MM-YYYY
    const parts = str.split(/[\/\-]/).map(s => s.trim());
    if (parts.length !== 3) return '';
    const [dd, mm, yyyy] = parts;
    if (!dd || !mm || !yyyy || yyyy.length !== 4) return '';
    if (isNaN(dd) || isNaN(mm) || isNaN(yyyy)) return '';
    const d = parseInt(dd), m = parseInt(mm), y = parseInt(yyyy);
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2099) return '';
    return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

// ===== FORMAT YYYY-MM-DD → DD/MM/YYYY for mobile display =====
function toDisplayDate(isoStr) {
    if (!isoStr) return '';
    const [y, m, d] = isoStr.split('-');
    return `${d}/${m}/${y}`;
}
function getTodayString() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ===== CUSTOM DATE MATH (30-day month, 360-day year) — UNCHANGED =====
function dateToDays(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return y * 360 + (m - 1) * 30 + d;
}
function totalDaysBetween(d1, d2) { return dateToDays(d2) - dateToDays(d1); }
function daysToYMD(totalDays) {
    const years  = Math.floor(totalDays / 360);
    const rem    = totalDays % 360;
    const months = Math.floor(rem / 30);
    const days   = rem % 30;
    return { years, months, days };
}
function formatINR(n) { return '₹' + Math.floor(n).toLocaleString('en-IN'); }

// ===== CORE CALCULATION — UNCHANGED LOGIC, now accepts id =====
function runCalc(id) {
    const s = sections[id];
    if (!validateSection(id)) return;

    const g         = v(id, 'givenDate');
    const c         = v(id, 'calcDate');
    const principal = Math.floor(parseFloat(v(id, 'principal')));
    const rate      = s.rate;
    const freqDays  = s.freqDays;

    const totalDays = totalDaysBetween(g, c);
    const { years, months, days } = daysToYMD(totalDays);

    const freqMonths     = freqDays / 30;
    const totalMonths    = years * 12 + months;
    const leftoverDays   = days;
    const completePeriods  = Math.floor(totalMonths / freqMonths);
    const remainderMonths  = totalMonths % freqMonths;
    const remainingDays    = remainderMonths * 30 + leftoverDays;

    let cur = principal;
    const breakdown = [];
    breakdown.push({ type: 'principal', value: cur });

    for (let i = 0; i < completePeriods; i++) {
        const interest = Math.floor(cur * rate * freqDays / 3000);
        cur += interest;
        breakdown.push({ type: 'interest',       value: interest });
        breakdown.push({ type: 'new-principal',  value: cur });
    }
    if (remainingDays > 0) {
        const remInt = Math.floor(cur * rate * remainingDays / 3000);
        cur += remInt;
        breakdown.push({ type: 'interest',      value: remInt });
        breakdown.push({ type: 'new-principal', value: cur });
    }

    const finalAmount   = cur;
    const totalInterest = finalAmount - principal;
    const cycles        = completePeriods + (remainingDays > 0 ? 1 : 0);

    const result = { principal, totalInterest, finalAmount, totalDays,
                     years, months, days, cycles, rate, freqDays,
                     breakdown, givenDate: g, calcDate: c };

    s.result = result;
    renderSectionResults(id, result);
    addToHistory({ principal, totalInterest, finalAmount, totalDays, rate, freqDays,
                   timestamp: new Date().toLocaleString() });
    updateGrandSummary();
}

// ===== RENDER RESULTS INTO A SECTION =====
function renderSectionResults(id, r) {
    el(id, 'rcInterest').textContent  = formatINR(r.totalInterest);
    el(id, 'rcFinal').textContent     = formatINR(r.finalAmount);

    const body = el(id, 'breakdownBody');
    body.innerHTML = '';
    r.breakdown.forEach((item, idx) => {
        const row = document.createElement('div');
        row.className = `bd-row ${item.type === 'new-principal' ? 'bd-new-principal' : 'bd-' + item.type}`;
        row.style.animationDelay = `${idx * 0.04}s`;
        row.innerHTML = `<span>${formatINR(item.value)}</span>`;
        body.appendChild(row);
    });
    const tot = document.createElement('div');
    tot.className = 'bd-row bd-total';
    tot.innerHTML  = `<span>Total</span><span>${formatINR(r.finalAmount)}</span>`;
    body.appendChild(tot);

    el(id, 'resultsSection').style.display = 'block';
    setTimeout(() => el(id, 'resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
}

// ===== DURATION DISPLAY =====
function updateDuration(id) {
    const g = v(id, 'givenDate');
    const c = v(id, 'calcDate');
    if (!g || !c) return;
    const total = totalDaysBetween(g, c);
    const box   = el(id, 'durationBox');
    if (total <= 0) { box.style.display = 'none'; return; }
    const { years, months, days } = daysToYMD(total);
    let parts = [];
    if (years  > 0) parts.push(`${years} Year${years   > 1 ? 's' : ''}`);
    if (months > 0) parts.push(`${months} Month${months > 1 ? 's' : ''}`);
    if (days   > 0) parts.push(`${days} Day${days   > 1 ? 's' : ''}`);
    if (!parts.length) parts.push('0 Days');
    el(id, 'durationMain').innerHTML   = parts.join('<br>');
    el(id, 'durationDays').textContent = `Total: ${total} Days`;
    box.style.display = 'block';
}

// ===== VALIDATION =====
function validateSection(id) {
    let valid = true;
    const s = sections[id];

    const wrap = document.getElementById(`calc-section-${id}`);
    wrap.querySelectorAll('.error-msg').forEach(e => e.remove());
    wrap.querySelectorAll('.input-field').forEach(e => e.classList.remove('error'));

    // On mobile, sync part fields → ISO before reading
    if (isMobile()) {
        ['givenDate', 'calcDate'].forEach(fn => {
            const ddEl   = document.getElementById(`${fn}DD-${id}`);
            const mmEl   = document.getElementById(`${fn}MM-${id}`);
            const yyyyEl = document.getElementById(`${fn}YYYY-${id}`);
            const isoEl  = document.getElementById(`${fn}-${id}`);
            if (!ddEl || !isoEl) return;
            const dd   = String(ddEl.value   || '').padStart(2, '0');
            const mm   = String(mmEl.value   || '').padStart(2, '0');
            const yyyy = yyyyEl.value || '';
            isoEl.value = (ddEl.value && mmEl.value && yyyy.length === 4)
                ? `${yyyy}-${mm}-${dd}` : '';
        });
    }

    const g = v(id, 'givenDate');
    const c = v(id, 'calcDate');
    const p = v(id, 'principal');

    if (!g) {
        if (isMobile()) {
            document.getElementById(`givenDateDD-${id}`)?.classList.add('error');
            showToast('⚠️ Enter complete Money Given Date (DD / MM / YYYY)');
        } else {
            showSectionError(id, 'givenDate', 'Please select Money Given Date');
        }
        valid = false;
    }
    if (!c) {
        if (isMobile()) {
            document.getElementById(`calcDateDD-${id}`)?.classList.add('error');
            showToast('⚠️ Enter complete Calculation Date (DD / MM / YYYY)');
        } else {
            showSectionError(id, 'calcDate', 'Please select Calculation Date');
        }
        valid = false;
    }
    if (g && c && totalDaysBetween(g, c) <= 0) {
        showToast('⚠️ Calculation Date must be after Money Given Date in Calc ' + id); valid = false;
    }
    if (!p || parseFloat(p) <= 0) { showSectionError(id, 'principal', 'Enter a valid principal amount'); valid = false; }
    if (!s.rate)     { showToast('⚠️ Select Interest Rate in Calculation '      + id); valid = false; }
    if (!s.freqDays) { showToast('⚠️ Select Compound Frequency in Calculation ' + id); valid = false; }
    return valid;
}

function showSectionError(id, fieldId, msg) {
    const el2 = document.getElementById(`${fieldId}-${id}`);
    if (!el2) return;
    el2.classList.add('error');
    const err = document.createElement('div');
    err.className = 'error-msg';
    err.textContent = msg;
    el2.parentNode.insertBefore(err, el2.nextSibling);
}

// ===== RESET A SECTION =====
function resetSection(id) {
    const todayISO = getTodayString();

    if (isMobile()) {
        // Clear mobile DD/MM/YYYY part fields
        ['givenDate', 'calcDate'].forEach(fn => {
            const ddEl   = document.getElementById(`${fn}DD-${id}`);
            const mmEl   = document.getElementById(`${fn}MM-${id}`);
            const yyyyEl = document.getElementById(`${fn}YYYY-${id}`);
            const isoEl  = document.getElementById(`${fn}-${id}`);
            if (ddEl)   ddEl.value   = '';
            if (mmEl)   mmEl.value   = '';
            if (yyyyEl) yyyyEl.value = '';
            if (isoEl)  isoEl.value  = '';
        });
        // Restore today in calcDate parts
        const [y, m, d] = todayISO.split('-');
        const cDD   = document.getElementById(`calcDateDD-${id}`);
        const cMM   = document.getElementById(`calcDateMM-${id}`);
        const cYYYY = document.getElementById(`calcDateYYYY-${id}`);
        const cIso  = document.getElementById(`calcDate-${id}`);
        if (cDD)   cDD.value   = d;
        if (cMM)   cMM.value   = m;
        if (cYYYY) cYYYY.value = y;
        if (cIso)  cIso.value  = todayISO;
    } else {
        document.getElementById(`givenDate-${id}`).value = '';
        document.getElementById(`calcDate-${id}`).value  = todayISO;
    }

    document.getElementById(`principal-${id}`).value  = '';
    document.getElementById(`rateSelect-${id}`).value  = '2';
    document.getElementById(`freqSelect-${id}`).value  = '360';
    sections[id].rate     = 2;
    sections[id].freqDays = 360;
    sections[id].result   = null;
    const wrap = document.getElementById(`calc-section-${id}`);
    wrap.querySelectorAll('.error-msg').forEach(e => e.remove());
    wrap.querySelectorAll('.input-field').forEach(e => e.classList.remove('error'));
    document.getElementById(`durationBox-${id}`).style.display    = 'none';
    document.getElementById(`resultsSection-${id}`).style.display = 'none';
    showToast(`✅ Calculation ${id} reset`);
    updateGrandSummary();
}

// ===== SECTION HTML BUILDER =====
// ===== SECTION HTML BUILDER =====
function buildSectionHTML(id) {
    const todayISO = getTodayString();
    const mobile   = isMobile();

    function dateFieldHTML(fieldName, defaultISO) {
        const fid = `${fieldName}-${id}`; // the value read by all calc logic (YYYY-MM-DD)

        if (!mobile) {
            // ── DESKTOP: native type="date" ──
            // Browser handles auto-padding (2→02) and DD/MM/YYYY display natively
            return `<input type="date" id="${fid}" class="input-field"
                      ${defaultISO ? `value="${defaultISO}"` : ''}>`;
        }

        // ── MOBILE: three separate number boxes DD | MM | YYYY ──
        // Auto-pad on blur, auto-focus next field on 2-digit entry
        const [defY='', defM='', defD=''] = defaultISO ? defaultISO.split('-') : [];
        const ddId   = `${fieldName}DD-${id}`;
        const mmId   = `${fieldName}MM-${id}`;
        const yyyyId = `${fieldName}YYYY-${id}`;
        return `
          <div class="mob-date-wrap">
            <input type="number" id="${ddId}"   class="mob-date-part" placeholder="DD"
              min="1" max="31" value="${defD}" inputmode="numeric">
            <span class="mob-date-sep">/</span>
            <input type="number" id="${mmId}"   class="mob-date-part" placeholder="MM"
              min="1" max="12" value="${defM}" inputmode="numeric">
            <span class="mob-date-sep">/</span>
            <input type="number" id="${yyyyId}" class="mob-date-part mob-date-year" placeholder="YYYY"
              min="2000" max="2099" value="${defY}" inputmode="numeric">
            <input type="hidden" id="${fid}" value="${defaultISO || ''}">
          </div>`;
    }

    return `
<div class="calc-section-wrapper" id="calc-section-${id}">
  <div class="calc-section-label">Calculation ${id}</div>
  <div class="top-input-row">

    <!-- Date Card -->
    <div class="card date-card">
      <div class="card-header"><span class="card-icon">📅</span><h2>Date Period</h2></div>
      <div class="field-group">
        <label>Money Given Date</label>
        ${dateFieldHTML('givenDate', '')}
      </div>
      <div class="field-group">
        <label>Calculation Date <span class="badge">Auto Today</span></label>
        ${dateFieldHTML('calcDate', todayISO)}
      </div>
      <div class="duration-box" id="durationBox-${id}" style="display:none">
        <div class="duration-main" id="durationMain-${id}"></div>
        <div class="duration-days" id="durationDays-${id}"></div>
      </div>
    </div>

    <!-- Details Card -->
    <div class="card details-card">
      <div class="card-header"><span class="card-icon">💰</span><h2>Loan Details</h2></div>
      <div class="field-group">
        <label>Principal Amount (₹)</label>
        <div class="input-prefix-wrap">
          <span class="prefix">₹</span>
          <input type="number" id="principal-${id}" class="input-field prefix-input" placeholder="e.g. 10000" min="1">
        </div>
      </div>
      <div class="field-group">
        <label>Interest Rate</label>
        <select id="rateSelect-${id}" class="input-field select-field">
          <option value="1">₹1 rps</option>
          <option value="1.5">₹1.5 rps</option>
          <option value="2" selected>₹2 rps</option>
          <option value="2.5">₹2.5 rps</option>
          <option value="3">₹3 rps</option>
          <option value="3.5">₹3.5 rps</option>
          <option value="4">₹4 rps</option>
          <option value="4.5">₹4.5 rps</option>
          <option value="5">₹5 rps</option>
        </select>
      </div>
      <div class="field-group">
        <label>Compound Frequency</label>
        <select id="freqSelect-${id}" class="input-field select-field">
          <option value="30">Every Month</option>
          <option value="90">Every 3 Months</option>
          <option value="180">Every 6 Months</option>
          <option value="360" selected>Every 1 Year</option>
        </select>
      </div>
      <div class="action-row">
        <button class="btn-calc" id="calcBtn-${id}">Calculate</button>
        <button class="btn-reset" id="resetBtn-${id}">↺ Reset</button>
      </div>
    </div>
  </div>

  <!-- Results -->
  <div id="resultsSection-${id}" style="display:none">
    <div class="card breakdown-card">
      <div class="card-header"><span class="card-icon">🧮</span><h2>Calculation Breakdown</h2></div>
      <div class="breakdown-body" id="breakdownBody-${id}"></div>
    </div>
    <div class="final-cards-row">
      <div class="final-card fc-interest">
        <div class="fc-icon">📈</div>
        <div class="fc-label">Interest Earned</div>
        <div class="fc-value" id="rcInterest-${id}">—</div>
      </div>
      <div class="final-card fc-final">
        <div class="fc-icon">💎</div>
        <div class="fc-label">Final Amount</div>
        <div class="fc-value" id="rcFinal-${id}">—</div>
      </div>
    </div>
  </div>
</div>`;
}

// ===== BIND EVENTS FOR A SECTION =====
function bindSectionEvents(id) {
    sections[id] = { rate: 2, freqDays: 360, result: null };

    if (isMobile()) {
        // ── MOBILE: bind each DD/MM/YYYY part separately ──
        ['givenDate', 'calcDate'].forEach(fieldName => {
            const ddEl   = document.getElementById(`${fieldName}DD-${id}`);
            const mmEl   = document.getElementById(`${fieldName}MM-${id}`);
            const yyyyEl = document.getElementById(`${fieldName}YYYY-${id}`);
            const isoEl  = document.getElementById(`${fieldName}-${id}`);
            if (!ddEl) return;

            function syncISO() {
                const dd   = String(ddEl.value   || '').padStart(2, '0');
                const mm   = String(mmEl.value   || '').padStart(2, '0');
                const yyyy = yyyyEl.value || '';
                if (ddEl.value && mmEl.value && yyyy.length === 4) {
                    isoEl.value = `${yyyy}-${mm}-${dd}`;
                    updateDuration(id);
                } else {
                    isoEl.value = '';
                }
            }

            // Auto-pad on blur: 5 → 05
            ddEl.addEventListener('blur', () => {
                if (ddEl.value) ddEl.value = String(parseInt(ddEl.value)).padStart(2, '0');
                syncISO();
            });
            mmEl.addEventListener('blur', () => {
                if (mmEl.value) mmEl.value = String(parseInt(mmEl.value)).padStart(2, '0');
                syncISO();
            });
            yyyyEl.addEventListener('blur', syncISO);

            // Auto-advance focus: after 2 digits in DD → jump to MM, MM → YYYY
            ddEl.addEventListener('input', () => {
                if (ddEl.value.length >= 2) mmEl.focus();
            });
            mmEl.addEventListener('input', () => {
                if (mmEl.value.length >= 2) yyyyEl.focus();
            });
            yyyyEl.addEventListener('input', syncISO);
        });

    } else {
        // ── DESKTOP: native type="date" with built-in auto-padding ──
        document.getElementById(`givenDate-${id}`).addEventListener('change', () => updateDuration(id));
        document.getElementById(`calcDate-${id}`).addEventListener('change',  () => updateDuration(id));
    }

    document.getElementById(`rateSelect-${id}`).addEventListener('change', (e) => {
        sections[id].rate = parseFloat(e.target.value);
    });
    document.getElementById(`freqSelect-${id}`).addEventListener('change', (e) => {
        sections[id].freqDays = parseInt(e.target.value);
    });
    document.getElementById(`calcBtn-${id}`).addEventListener('click',  () => runCalc(id));
    document.getElementById(`resetBtn-${id}`).addEventListener('click', () => resetSection(id));
}

// ===== MOBILE: sync text input → hidden ISO value → updateDuration =====
function syncMobileDateFromText(id, fieldName) {
    const txtEl = document.getElementById(`${fieldName}Text-${id}`);
    const isoEl = document.getElementById(`${fieldName}-${id}`);
    if (!txtEl || !isoEl) return;
    const iso = parseDDMMYYYY(txtEl.value);
    isoEl.value = iso;
    if (iso) updateDuration(id);
}

// ===== MOBILE: calendar icon opens hidden date picker =====
function openCalPicker(id, fieldName) {
    const hidEl = document.getElementById(`${fieldName}Hidden-${id}`);
    if (!hidEl) return;
    hidEl.showPicker ? hidEl.showPicker() : hidEl.click();
    hidEl.onchange = () => {
        const iso = hidEl.value; // YYYY-MM-DD
        if (!iso) return;
        // Write DD/MM/YYYY into text input
        const txtEl = document.getElementById(`${fieldName}Text-${id}`);
        const isoEl = document.getElementById(`${fieldName}-${id}`);
        if (txtEl) txtEl.value = toDisplayDate(iso);
        if (isoEl) isoEl.value = iso;
        updateDuration(id);
    };
}

// ===== MANAGE SECTION COUNT =====
function setCalcCount(n) {
    const container = document.getElementById('calcSectionsContainer');
    const current   = container.querySelectorAll('.calc-section-wrapper').length;

    if (n > current) {
        // Add new sections
        for (let id = current + 1; id <= n; id++) {
            const div = document.createElement('div');
            div.innerHTML = buildSectionHTML(id);
            container.appendChild(div.firstElementChild);
            bindSectionEvents(id);
        }
    } else if (n < current) {
        // Remove excess sections from the end
        for (let id = current; id > n; id--) {
            const sec = document.getElementById(`calc-section-${id}`);
            if (sec) sec.remove();
            delete sections[id];
        }
    }
    // Update section label visibility
    container.querySelectorAll('.calc-section-label').forEach(lbl => {
        lbl.style.display = n > 1 ? 'flex' : 'none';
    });
    updateGrandSummary();
}

// ===== GLOBAL EVENTS (header controls) =====
function bindGlobalEvents() {
    // Count selector
    document.getElementById('calcCountSelect').addEventListener('change', (e) => {
        setCalcCount(parseInt(e.target.value));
    });

    // Dark mode
    document.getElementById('darkToggle').addEventListener('click', () => {
        document.body.classList.toggle('dark');
        document.getElementById('darkToggle').textContent =
            document.body.classList.contains('dark') ? '☀️' : '🌙';
    });

    // History
    document.getElementById('historyBtn').addEventListener('click', () => {
        document.getElementById('historyOverlay').style.display = 'flex';
        renderHistory();
    });
    document.getElementById('closeHistory').addEventListener('click', () => {
        document.getElementById('historyOverlay').style.display = 'none';
    });
    document.getElementById('historyOverlay').addEventListener('click', (e) => {
        if (e.target === document.getElementById('historyOverlay'))
            document.getElementById('historyOverlay').style.display = 'none';
    });
    document.getElementById('clearHistory').addEventListener('click', () => {
        history = [];
        renderHistory();
        document.getElementById('historyCount').textContent = '0';
    });

    // PDF button — now at bottom of page
    document.getElementById('pdfBtn').addEventListener('click', downloadAllPDF);

    // FIX: pageshow fires when browser restores page from bfcache (back-forward cache)
    // This is the PRIMARY cause of the freeze — bfcache restores a stale JS state
    // Setting cache-control to no-store prevents bfcache from caching this page
    window.addEventListener('pageshow', (e) => {
        if (e.persisted) {
            // Page was restored from bfcache — force a clean reload
            window.location.reload();
        }
    });
}

// ===== HISTORY =====
function addToHistory(entry) {
    history.unshift(entry);
    document.getElementById('historyCount').textContent = history.length;
}
function renderHistory() {
    const list = document.getElementById('historyList');
    if (!history.length) { list.innerHTML = '<div class="history-empty">No calculations yet.</div>'; return; }
    list.innerHTML = '';
    history.forEach(h => {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerHTML = `
          <div class="hi-top">
            <span class="hi-amount">${formatINR(h.finalAmount)}</span>
            <span class="hi-date">${h.timestamp}</span>
          </div>
          <div class="hi-details">
            Principal: ${formatINR(h.principal)} &nbsp;|&nbsp;
            Interest: ${formatINR(h.totalInterest)} &nbsp;|&nbsp;
            Rate: ₹${h.rate} &nbsp;|&nbsp; ${h.totalDays} Days
          </div>`;
        list.appendChild(item);
    });
}

// ===== COMBINED PDF — 2 bills per page =====
function downloadAllPDF() {
    const results = [];
    Object.keys(sections).sort((a,b) => a-b).forEach(id => {
        if (sections[id].result) results.push({ id: parseInt(id), ...sections[id].result });
    });
    if (!results.length) { showToast('⚠️ No completed calculations to print'); return; }

    function fmtDate(d) {
        if (!d) return '—';
        const [y,m,day] = d.split('-');
        return `${day}/${m}/${y}`;
    }

    function buildBill(r, idx) {
        let durParts = [];
        if (r.days   > 0) durParts.push(`${r.days} Day${r.days > 1 ? 's' : ''}`);
        if (r.months > 0) durParts.push(`${r.months} Month${r.months > 1 ? 's' : ''}`);
        if (r.years  > 0) durParts.push(`${r.years} Year${r.years > 1 ? 's' : ''}`);
        const durStr = durParts.join('  ') || '0 Days';

        let bdRows = '';
        r.breakdown.forEach(item => { bdRows += `<div class="bd-line">${formatINR(item.value)}</div>`; });
        bdRows += `<div class="bd-total-line">Total: ${formatINR(r.finalAmount)}</div>`;

        // Page break before every odd-indexed bill (3rd, 5th, 7th…) = every 2 bills per page
        // idx 0,1 → page 1 | idx 2,3 → page 2 | idx 4,5 → page 3 …
        const breakClass = (idx > 0 && idx % 2 === 0) ? 'page-break-before' : '';
        // Divider only between the two bills on the same page (idx odd, not page boundary)
        const divider = (idx > 0 && idx % 2 !== 0) ? '<div class="bill-divider"></div>' : '';

        return `${divider}
<div class="bill ${breakClass}">
  <div class="bill-num">Calculation ${r.id}</div>
  <div class="report-body">
    <div class="left-col">
      <div class="info-block">
        <div class="info-label">Money Given Date</div>
        <div class="info-value">${fmtDate(r.givenDate)}</div>
      </div>
      <div class="info-block">
        <div class="info-label">Calculation Date</div>
        <div class="info-value">${fmtDate(r.calcDate)}</div>
      </div>
      <div class="info-block">
        <div class="info-label">Duration</div>
        <div class="info-value big">${durStr}</div>
      </div>
      <hr class="divider">
      <div class="info-block">
        <div class="info-label">Principal</div>
        <div class="info-value">${formatINR(r.principal)}</div>
      </div>
      <div class="info-block">
        <div class="info-label">Interest Rate</div>
        <div class="info-value">₹${r.rate}</div>
      </div>
      <div class="info-block">
        <div class="info-label">Total Interest</div>
        <div class="info-value green">${formatINR(r.totalInterest)}</div>
      </div>
      <div class="info-block">
        <div class="info-label">Final Amount</div>
        <div class="info-value green">${formatINR(r.finalAmount)}</div>
      </div>
    </div>
    <div class="right-col">
      <h2>Calculation Breakdown</h2>
      ${bdRows}
    </div>
  </div>
</div>`;
    }

    const allBills = results.map((r, i) => buildBill(r, i)).join('');

    // Grand Summary — only when 2+ results
    let grandSummaryHTML = '';
    if (results.length >= 2) {
        const grandInterest = results.reduce((s, r) => s + r.totalInterest, 0);
        const grandFinal    = results.reduce((s, r) => s + r.finalAmount,   0);
        // Grand summary starts on a new page
        const gsBreak = results.length % 2 === 0 ? 'page-break-before' : '';
        grandSummaryHTML = `
<div class="grand-block ${gsBreak}">
  <div class="grand-heading">Grand Total Summary</div>
  <div class="grand-pdf-row">
    <span class="grand-pdf-label">Grand Total Interest</span>
    <span class="grand-pdf-value">${formatINR(grandInterest)}</span>
  </div>
  <div class="grand-pdf-row">
    <span class="grand-pdf-label">Grand Final Amount</span>
    <span class="grand-pdf-value grand-pdf-final">${formatINR(grandFinal)}</span>
  </div>
</div>`;
    }

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Interest Report</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:Arial,sans-serif; padding:24px; color:#111; font-size:13px; }
  h1 { font-size:18px; font-weight:800; color:#1a1a2e; margin-bottom:2px; }
  .subtitle { color:#666; font-size:11px; margin-bottom:20px; }
  .bill { padding:20px 0; page-break-inside:avoid; }
  .bill-num { font-size:11px; font-weight:700; color:#6c63ff; text-transform:uppercase;
              letter-spacing:1px; margin-bottom:10px; }
  .bill-divider { border-top:2px dashed #ddd; margin:16px 0; }
  .page-break-before { page-break-before:always; padding-top:24px; }
  .report-body { display:flex; gap:28px; align-items:flex-start; }
  .left-col { flex:0 0 200px; }
  .info-block { margin-bottom:14px; }
  .info-label { font-size:9px; font-weight:700; text-transform:uppercase;
                letter-spacing:1px; color:#888; margin-bottom:3px; }
  .info-value { font-size:14px; font-weight:700; color:#1a1a2e; }
  .info-value.big { font-size:16px; color:#6c63ff; }
  .info-value.green { font-size:15px; color:#10b981; }
  .divider { border:none; border-top:1px solid #eee; margin:10px 0; }
  .right-col { flex:1; }
  .right-col h2 { font-size:11px; font-weight:700; color:#888; text-transform:uppercase;
                  letter-spacing:1px; margin-bottom:8px; }
  .bd-line { font-size:14px; font-weight:700; color:#1a1a2e;
             padding:4px 0; border-bottom:1px solid #f0f0f0; }
  .bd-total-line { font-size:15px; font-weight:800; color:#1a1a2e;
                   padding:6px 0; margin-top:4px; border-top:2px solid #1a1a2e; }
  .footer { margin-top:20px; font-size:9px; color:#aaa; text-align:center; }
  .grand-block { padding:16px; border:3px solid #111; page-break-inside:avoid; margin-top:16px; }
  .grand-block.page-break-before { page-break-before:always; padding-top:24px; }
  .grand-heading { font-size:14px; font-weight:800; text-transform:uppercase;
                   letter-spacing:1px; color:#111; margin-bottom:12px;
                   padding-bottom:8px; border-bottom:2px solid #ccc; }
  .grand-pdf-row { display:flex; justify-content:space-between; align-items:center;
                   padding:6px 0; border-bottom:1px solid #eee; }
  .grand-pdf-row:last-child { border-bottom:none; }
  .grand-pdf-label { font-size:13px; font-weight:700; color:#111; }
  .grand-pdf-value { font-size:16px; font-weight:800; color:#111; }
  .grand-pdf-final { font-size:20px; }
  @media print { body { padding:16px; } }
</style></head><body>
<h1>&#8377; Interest Calculation Report</h1>
<p class="subtitle">Generated on ${new Date().toLocaleString()} &nbsp;|&nbsp; Interest Pro &nbsp;|&nbsp; ${results.length} Calculation${results.length > 1 ? 's' : ''}</p>
${allBills}
${grandSummaryHTML}
<div class="footer">Interest Pro &#8212; Custom Lending Calculator</div>
</body></html>`;

    // ---- FIX: Use Blob URL instead of document.write to prevent freezing ----
    const blob = new Blob([html], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    const win  = window.open(url, '_blank');

    // Trigger print inside the new tab once it loads, then revoke the blob URL
    if (win) {
        win.addEventListener('load', () => {
            win.print();
            // Revoke after a short delay to allow print dialog to open
            setTimeout(() => URL.revokeObjectURL(url), 5000);
        });
    } else {
        // Popup blocked — offer direct download fallback
        const a = document.createElement('a');
        a.href = url;
        a.download = 'interest-report.html';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
}

// ===== GRAND SUMMARY =====
function updateGrandSummary() {
    const completed  = Object.values(sections).filter(s => s.result);
    const totalCount = Object.keys(sections).length;
    const box        = document.getElementById('grandSummary');
    const pdfWrap    = document.getElementById('pdfBtnWrap');

    // Only show grand summary when ALL sections are completed AND there are 2+
    // For single calculation: just show PDF button when it's done
    if (completed.length < totalCount) {
        box.style.display = 'none';
        if (pdfWrap) pdfWrap.style.display = 'none';
        return;
    }

    // All done — show PDF button regardless
    if (pdfWrap) pdfWrap.style.display = 'flex';

    // Grand summary only for 2+
    if (completed.length < 2) {
        box.style.display = 'none';
        return;
    }

    const totalInterest = completed.reduce((sum, s) => sum + s.result.totalInterest, 0);
    const totalFinal    = completed.reduce((sum, s) => sum + s.result.finalAmount,   0);

    document.getElementById('grandInterest').textContent = formatINR(totalInterest);
    document.getElementById('grandFinal').textContent    = formatINR(totalFinal);

    // Show without auto-scrolling — user stays where they are
    box.style.display = 'block';
    if (pdfWrap) pdfWrap.style.display = 'flex';
}

// ===== DOM HELPERS =====
// Get element by suffix pattern: e.g. el(2, 'breakdownBody') → #breakdownBody-2
function el(id, name) { return document.getElementById(`${name}-${id}`); }
function v(id, name)  { return (document.getElementById(`${name}-${id}`) || {}).value || ''; }

// ===== TOAST =====
function showToast(msg, duration = 2500) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), duration);
}

// ===== SERVICE WORKER =====
function registerSW() {
    if ('serviceWorker' in navigator)
        navigator.serviceWorker.register('sw.js').catch(() => {});
}
