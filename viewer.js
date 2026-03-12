// ── Edit mode ────────────────────────────────────────────────────────────────
let editModeActive = false;
let resumeHasEdits = false;

const resumePage   = document.getElementById('resume-page');
const editToolbar  = document.getElementById('edit-toolbar');
const btnEdit      = document.getElementById('btn-edit');
const btnEditDone  = document.getElementById('btn-edit-done');
const btnPageBreak = document.getElementById('btn-page-break');

function enterEditMode() {
    editModeActive = true;
    resumePage.contentEditable = 'true';
    resumePage.classList.add('edit-mode');
    editToolbar.style.display  = 'flex';
    btnEdit.style.display      = 'none';
    resumePage.focus();
}

function exitEditMode() {
    editModeActive = false;
    resumeHasEdits = true;          // treat any exit as "edits may exist"
    resumePage.contentEditable = 'false';
    resumePage.classList.remove('edit-mode');
    editToolbar.style.display  = 'none';
    btnEdit.style.display      = 'flex';
    // Update button label to reflect edits
    btnEdit.innerHTML = `
        <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        Edit`;
}

btnEdit.addEventListener('click', () => {
    if (editModeActive) exitEditMode(); else enterEditMode();
});

btnEditDone.addEventListener('click', exitEditMode);

// Insert page break at the current cursor position inside the resume
btnPageBreak.addEventListener('click', () => {
    resumePage.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    // Find the block-level element the cursor is in (direct child of resumePage)
    let node = sel.getRangeAt(0).startContainer;
    while (node && node.parentNode !== resumePage) node = node.parentNode;

    const marker = document.createElement('div');
    marker.className = 'page-break-marker';
    marker.contentEditable = 'false';       // not editable itself
    marker.setAttribute('data-label', '── Page Break ──');

    if (node) {
        // Insert the break BEFORE the current block so that block starts on the new page
        resumePage.insertBefore(marker, node);
    } else {
        resumePage.appendChild(marker);
    }
});

// Print button
document.getElementById('btn-print').addEventListener('click', () => {
    window.print();
});

// Download PDF button — generates a real text-based PDF via jsPDF
// so any ATS or PDF parser can extract text from it.
// If the user has made manual edits (or added page breaks), fall back to
// Print → Save as PDF which fully honours the live HTML & CSS.
document.getElementById('btn-download').addEventListener('click', () => {
    if (resumeHasEdits || document.querySelector('.page-break-marker')) {
        // Notify the user and trigger the browser print dialog
        const banner = document.createElement('div');
        banner.id = 'edit-save-banner';
        banner.textContent = 'Your resume has been edited. The print dialog is opening — choose "Save as PDF" to download.';
        document.body.appendChild(banner);
        setTimeout(() => { banner.remove(); window.print(); }, 1800);
        return;
    }
    chrome.storage.local.get('generatedResumeData', result => {
        const data = result.generatedResumeData;
        if (!data) { alert('No resume data found.'); return; }
        generateTextBasedPDF(data);
    });
});

/**
 * Builds a real text-based PDF from scratch using raw PDF operators.
 * No libraries required. Every glyph is stored as actual text, so any
 * ATS parser, pdfjs, or PDF viewer can extract / search / copy it.
 */
function generateTextBasedPDF(data) {
    // ── Page constants (Letter, points) ──────────────────────────────
    const PW = 612, PH = 792, ML = 50, MR = 50, MT = 50, MB = 50;
    const CW = PW - ML - MR;

    // ── Sanitise: map common Unicode to WinAnsi-safe ASCII ───────────
    const UNICODE_MAP = {
        '\u2022':'*', '\u2013':'-', '\u2014':'-', '\u2019':"'", '\u2018':"'",
        '\u201C':'"', '\u201D':'"', '\u2026':'...', '\u00A0':' ',
        '\u2010':'-', '\u2011':'-', '\u2012':'-', '\u00B7':'*',
    };
    const san = s => (s || '').replace(/[^\x20-\x7E]/g, c => UNICODE_MAP[c] || '');

    // ── Estimate text width (Helvetica proportional approximation) ───
    const tw = (s, sz, bold) => s.length * sz * (bold ? 0.57 : 0.52);

    // ── Word-wrap to fit within maxW ─────────────────────────────────
    const wrap = (text, maxW, sz, bold) => {
        const words = san(text).split(' ');
        const lines = [];
        let cur = '';
        for (const w of words) {
            const t = cur ? cur + ' ' + w : w;
            if (tw(t, sz, bold) > maxW && cur) { lines.push(cur); cur = w; }
            else cur = t;
        }
        if (cur) lines.push(cur);
        return lines.length ? lines : [''];
    };

    // ── Layout phase: collect draw commands per page ─────────────────
    const pages = [[]];
    let y = PH - MT;

    const newPage = () => { pages.push([]); y = PH - MT; };
    const chk = h => { if (y - h < MB) newPage(); };

    const addText = (x, yy, str, sz, bold, r=0, g=0, b=0) =>
        pages[pages.length - 1].push({ x, y: yy, text: san(str), sz, bold, r, g, b });

    const addRule = (x1, yy, x2, r=30, g=64, b=175) =>
        pages[pages.length - 1].push({ type: 'line', x1, y: yy, x2, r, g, b });

    const secTitle = title => {
        chk(28); y -= 8;
        addText(ML, y, title.toUpperCase(), 10, true, 30, 64, 175);
        addRule(ML, y - 3, ML + CW);
        y -= 16;
    };

    const para = (str, sz, bold, r=0, g=0, b=0, indent=0) => {
        if (!str) return;
        const lines = wrap(str, CW - indent, sz, bold);
        for (const l of lines) { chk(sz + 4); addText(ML + indent, y, l, sz, bold, r, g, b); y -= (sz + 3); }
    };

    // ── Name ─────────────────────────────────────────────────────────
    chk(30);
    const nameStr = san(data.header.name || '');
    addText(ML + (CW - tw(nameStr, 20, true)) / 2, y, nameStr, 20, true);
    y -= 24;

    // ── Contact line ─────────────────────────────────────────────────
    const contact = [data.header.email, data.header.phone, data.header.location,
        data.header.linkedin, data.header.portfolio].filter(Boolean).map(san).join('  |  ');
    if (contact) {
        const cLines = wrap(contact, CW, 9, false);
        for (const cl of cLines) {
            addText(ML + (CW - tw(cl, 9, false)) / 2, y, cl, 9, false, 55, 65, 81);
            y -= 12;
        }
    }

    // ── Summary ──────────────────────────────────────────────────────
    if (data.summary) { secTitle('Professional Summary'); para(data.summary, 10, false); }

    // ── Skills ───────────────────────────────────────────────────────
    if (data.skills && data.skills.length) {
        secTitle('Core Competencies');
        para(data.skills.join('  *  '), 10, false);
    }

    // ── Experience ───────────────────────────────────────────────────
    if (data.experience && data.experience.length) {
        secTitle('Professional Experience');
        for (const exp of data.experience) {
            chk(32);
            addText(ML, y, san(exp.role || ''), 10.5, true);
            if (exp.date) {
                const d = san(exp.date);
                addText(ML + CW - tw(d, 9.5, false), y, d, 9.5, false, 107, 114, 128);
            }
            y -= 13; chk(13);
            addText(ML, y, san(exp.company || ''), 9.5, false, 80, 80, 80);
            y -= 13;
            for (const pt of (exp.points || [])) para('*  ' + pt, 9.5, false, 0, 0, 0, 8);
            y -= 5;
        }
    }

    // ── Projects ─────────────────────────────────────────────────────
    if (data.projects && data.projects.length) {
        secTitle('Key Projects');
        for (const proj of data.projects) {
            chk(26);
            addText(ML, y, san(proj.name || ''), 10.5, true);
            y -= 13;
            if (proj.link) { chk(11); addText(ML, y, san(proj.link), 9, false, 37, 99, 235); y -= 11; }
            if (proj.description) para(proj.description, 9.5, false, 80, 80, 80);
            for (const pt of (proj.points || [])) para('*  ' + pt, 9.5, false, 0, 0, 0, 8);
            y -= 5;
        }
    }

    // ── Education ────────────────────────────────────────────────────
    if (data.education && data.education.length) {
        secTitle('Education');
        for (const edu of data.education) {
            chk(26);
            addText(ML, y, san(edu.school || ''), 10.5, true);
            if (edu.date) {
                const d = san(edu.date);
                addText(ML + CW - tw(d, 9.5, false), y, d, 9.5, false, 107, 114, 128);
            }
            y -= 13; chk(13);
            addText(ML, y, san(edu.degree || ''), 10, false);
            y -= 14;
        }
    }

    // ── PDF generation phase ─────────────────────────────────────────
    const NP = pages.length;
    // Object ID layout:
    //   1 .. NP          → content streams (one per page)
    //   NP+1             → /Helvetica font
    //   NP+2             → /Helvetica-Bold font
    //   NP+3 .. 2*NP+2   → page dictionaries
    //   2*NP+3           → pages tree
    //   2*NP+4           → catalog
    const F1 = NP + 1, F2 = NP + 2, PAGES = 2 * NP + 3, CAT = 2 * NP + 4, TOTAL = CAT;

    const fp2 = n => n.toFixed(2);
    const fp3 = n => n.toFixed(3);
    const esc = s => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

    // Build object body strings
    const objBody = {};

    // Content streams
    for (let i = 0; i < NP; i++) {
        let s = '';
        for (const item of pages[i]) {
            if (item.type === 'line') {
                s += `${fp3(item.r/255)} ${fp3(item.g/255)} ${fp3(item.b/255)} RG 0.75 w `;
                s += `${fp2(item.x1)} ${fp2(item.y)} m ${fp2(item.x2)} ${fp2(item.y)} l S\n`;
            } else {
                s += `BT /${item.bold ? 'F2' : 'F1'} ${item.sz} Tf `;
                s += `${fp3(item.r/255)} ${fp3(item.g/255)} ${fp3(item.b/255)} rg `;
                s += `${fp2(item.x)} ${fp2(item.y)} Td (${esc(item.text)}) Tj ET\n`;
            }
        }
        objBody[i + 1] = `<< /Length ${s.length} >>\nstream\n${s}endstream`;
    }

    // Fonts (built-in Type1 — no embedding required, text always parseable)
    objBody[F1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objBody[F2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

    // Page objects
    for (let i = 0; i < NP; i++) {
        const pid = NP + 3 + i;
        objBody[pid] = `<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 ${PW} ${PH}] `
            + `/Contents ${i + 1} 0 R /Resources << /Font << /F1 ${F1} 0 R /F2 ${F2} 0 R >> >> >>`;
    }

    // Pages tree
    const kids = Array.from({ length: NP }, (_, i) => `${NP + 3 + i} 0 R`).join(' ');
    objBody[PAGES] = `<< /Type /Pages /Kids [${kids}] /Count ${NP} >>`;

    // Catalog
    objBody[CAT] = `<< /Type /Catalog /Pages ${PAGES} 0 R >>`;

    // Assemble PDF byte string
    let out = '%PDF-1.4\n';
    const offsets = [];
    for (let id = 1; id <= TOTAL; id++) {
        offsets.push(out.length);
        out += `${id} 0 obj\n${objBody[id]}\nendobj\n`;
    }
    const xrefPos = out.length;
    out += `xref\n0 ${TOTAL + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) out += off.toString().padStart(10, '0') + ' 00000 n \n';
    out += `trailer\n<< /Size ${TOTAL + 1} /Root ${CAT} 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

    // Convert the PDF string to bytes via Latin-1 mapping (safe because
    // all content has been sanitised to ASCII by san() above).
    // Using a data: URI instead of blob: URL avoids Chrome extension
    // restrictions on blob:chrome-extension:// downloads.
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;

    // btoa needs a binary string (Latin-1); convert Uint8Array back to one
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);

    const dataUri = 'data:application/pdf;base64,' + btoa(binary);
    const a = document.createElement('a');
    a.href = dataUri;
    a.download = `${(data.header.name || 'Resume').replace(/\s+/g, '_')}_Resume.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// Load data
chrome.storage.local.get("generatedResumeData", (result) => {
    const data = result.generatedResumeData;
    if (!data) {
        document.getElementById('resume-page').innerHTML = '<p style="color: red; text-align: center;">No resume data found. Please try generating again.</p>';
        return;
    }
    renderResume(data);
});

function extractResumeText(data) {
    const parts = [];

    if (data.header) {
        if (data.header.name)     parts.push(data.header.name);
        if (data.header.email)    parts.push(data.header.email);
        if (data.header.phone)    parts.push(data.header.phone);
        if (data.header.location) parts.push(data.header.location);
        if (data.header.linkedin) parts.push(data.header.linkedin);
        if (data.header.portfolio) parts.push(data.header.portfolio);
    }
    if (data.summary) parts.push(data.summary);
    if (data.skills && data.skills.length) parts.push(data.skills.join(', '));
    if (data.experience && data.experience.length) {
        data.experience.forEach(exp => {
            parts.push([exp.role, exp.company, exp.date].filter(Boolean).join(' | '));
            if (exp.points) exp.points.forEach(p => parts.push(p));
        });
    }
    if (data.projects && data.projects.length) {
        data.projects.forEach(proj => {
            parts.push(proj.name);
            if (proj.description) parts.push(proj.description);
            if (proj.points) proj.points.forEach(p => parts.push(p));
        });
    }
    if (data.education && data.education.length) {
        data.education.forEach(edu => {
            parts.push([edu.school, edu.degree, edu.date].filter(Boolean).join(' | '));
        });
    }
    return parts.join('\n');
}

function renderResume(data) {
    const container = document.getElementById('resume-page');

    // Persist plain text of the generated resume so the extension can
    // read it back even if the downloaded PDF is image-based.
    const generatedText = extractResumeText(data);
    chrome.storage.local.set({ resumeText: generatedText, lastAnalyzedResume: '' });

    container.innerHTML = `
      <header class="header-content">
        <h1>${escapeHtml(data.header.name)}</h1>
        <div class="contact-line">
          ${data.header.email ? `<span class="contact-item">${escapeHtml(data.header.email)}</span>` : ''}
          ${data.header.phone ? `<span class="separator">|</span><span class="contact-item">${escapeHtml(data.header.phone)}</span>` : ''}
          ${data.header.location ? `<span class="separator">|</span><span class="contact-item">${escapeHtml(data.header.location)}</span>` : ''}
          ${data.header.linkedin ? `<span class="separator">|</span><span class="contact-item"><a href="${escapeHtml(data.header.linkedin)}" target="_blank">LinkedIn</a></span>` : ''}
          ${data.header.portfolio ? `<span class="separator">|</span><span class="contact-item"><a href="${escapeHtml(data.header.portfolio)}" target="_blank">Portfolio</a></span>` : ''}
        </div>
      </header>
      
      ${data.summary ? `
      <section>
        <h2>Professional Summary</h2>
        <p>${escapeHtml(data.summary)}</p>
      </section>
      ` : ''}

      ${data.skills && data.skills.length ? `
      <section>
        <h2>Core Competencies</h2>
        <div class="skills-section">
          ${data.skills.map(skill => `<span class="skill-pill">${escapeHtml(skill)}</span>`).join('')}
        </div>
      </section>
      ` : ''}

      ${data.experience && data.experience.length ? `
      <section>
        <h2>Professional Experience</h2>
        ${data.experience.map(exp => `
          <div class="entry">
            <div class="entry-header">
              <div class="entry-title">${escapeHtml(exp.role)}</div>
              <div class="entry-meta">${escapeHtml(exp.date || '')}</div>
            </div>
            <div class="entry-subtitle">${escapeHtml(exp.company)}</div>
            <ul>
              ${exp.points.map(point => `<li>${escapeHtml(point)}</li>`).join('')}
            </ul>
          </div>
        `).join('')}
      </section>
      ` : ''}

      ${data.projects && data.projects.length ? `
      <section>
        <h2>Key Projects</h2>
        ${data.projects.map(proj => `
          <div class="entry">
            <div class="entry-header">
              <div class="entry-title">${escapeHtml(proj.name)}</div>
            </div>
             ${proj.link ? `<div style="font-size:9pt; margin-bottom:0.25rem;"><a href="${escapeHtml(proj.link)}" target="_blank">${escapeHtml(proj.link)}</a></div>` : ''}
            <p style="margin-bottom: 0.5rem; font-style: italic;">${escapeHtml(proj.description)}</p>
            <ul>
              ${proj.points.map(point => `<li>${escapeHtml(point)}</li>`).join('')}
            </ul>
          </div>
        `).join('')}
      </section>
      ` : ''}
      
      ${data.education && data.education.length ? `
      <section>
        <h2>Education</h2>
        ${data.education.map(edu => `
          <div class="entry">
            <div class="entry-header">
              <div class="entry-title">${escapeHtml(edu.school)}</div>
              <div class="entry-meta">${escapeHtml(edu.date || '')}</div>
            </div>
            <div class="entry-subtitle">${escapeHtml(edu.degree)}</div>
          </div>
        `).join('')}
      </section>
      ` : ''}
    `;
}

function escapeHtml(unsafe) {
    if (!unsafe) return "";
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
