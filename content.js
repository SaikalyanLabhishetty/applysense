function getJD() {

  // LinkedIn job title selectors (updated for current LinkedIn structure)
  const titleSelectors = [
    ".job-details-jobs-unified-top-card__job-title h1",
    ".jobs-unified-top-card__job-title",
    ".job-details-jobs-unified-top-card__job-title",
    ".jobs-details-top-card__job-title h1",
    "h1.t-24",
    "h1",
    ".job-title",
    "[data-job-title]"
  ];

  let title = "";
  for (const s of titleSelectors) {
    const el = document.querySelector(s);
    if (el && el.innerText && el.innerText.trim()) {
      title = el.innerText.trim();
      break;
    }
  }
  // LinkedIn job description selectors (updated for current LinkedIn structure)
  const bodySelectors = [
    ".jobs-description-content__text",
    ".jobs-description__content",
    ".show-more-less-html__markup",
    ".jobs-box__html-content",
    ".description__text",
    "article.jobs-description",
    "article"
  ];

  let description = "";
  for (const s of bodySelectors) {
    const el = document.querySelector(s);
    if (el && el.innerText && el.innerText.length > 200) {
      description = el.innerText.trim();
      break;
    }
  }

  // Extended LinkedIn selectors — tried before giving up, no body fallback
  if (!description || description.length < 200) {
    const extendedSelectors = [
      ".jobs-description",
      ".jobs-description-content",
      "[class*='jobs-description']",
      ".scaffold-layout__detail",
      "[class*='job-view-layout']",
      ".job-view-layout"
    ];
    for (const s of extendedSelectors) {
      try {
        const el = document.querySelector(s);
        if (el && el.innerText && el.innerText.length > 200) {
          description = el.innerText.trim();
          break;
        }
      } catch (_) {}
    }
  }

  // If still no JD, return empty — do NOT fall back to document.body
  // (body fallback can capture extension-injected content like the resume modal)
  if (!description || description.length < 200) {
    return "";
  }

  const result = `Job Title: ${title}\n\nJob Description:\n${description}`;

  return result;
}

function checkEasyApply() {
  const applyButtons = document.querySelectorAll('button.jobs-apply-button');
  for (const btn of applyButtons) {
    if (btn.innerText.toLowerCase().includes('easy apply')) {
      return true;
    }
  }
  // Secondary check for text-based detection
  const allButtons = document.querySelectorAll('button');
  for (const btn of allButtons) {
    if (btn.innerText.toLowerCase().includes('easy apply') && btn.offsetParent !== null) {
      return true;
    }
  }
  return false;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === "GET_JD") {
    // Check if user is on a search results page
    // Check if user is on a search results page
    const url = window.location.href;
    let isSearchPage = false;

    if (url.includes("linkedin.com")) {
      isSearchPage = (url.includes("/jobs/search/") || url.includes("search-results")) && !url.includes("/view/") && !url.includes("currentJobId=");
    }

    if (isSearchPage) {
      sendResponse({ jd: "", error: "SEARCH_PAGE" });
      return true;
    }

    try {
      let jd = "";
      let isEasyApply = false;

      if (url.includes("naukri.com")) {
        jd = getNaukriJD();
        isEasyApply = false;
      } else {
        // Default to LinkedIn
        jd = getJD();
        isEasyApply = checkEasyApply();
      }

      sendResponse({ jd: jd, isEasyApply: isEasyApply });
    } catch (error) {
      console.error("Error getting JD:", error);
      sendResponse({ jd: "", isEasyApply: false });
    }
  }

  if (msg.type === "START_ASSISTED_APPLY") {
    startAssistedApply().then(result => {
      sendResponse(result);
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  if (msg.type === "SHOW_RESUME") {
    showResumeModal(msg.data);
    sendResponse({ success: true });
  }

  return true; // Keep the message channel open for async response
});

async function startAssistedApply() {
  console.log("Starting Assisted Apply...");

  // 1. Find and click Easy Apply button
  const applyButton = Array.from(document.querySelectorAll('button'))
    .find(b => b.innerText.toLowerCase().includes('easy apply') && b.offsetParent !== null);

  if (!applyButton) {
    throw new Error("Easy Apply button not found");
  }

  applyButton.click();

  // 2. Start observation loop for modal
  let attempts = 0;
  const maxAttempts = 20;
  let modalFound = false;

  while (attempts < maxAttempts) {
    const modal = document.querySelector('.jobs-easy-apply-modal');
    if (modal) {
      modalFound = true;
      await automationLoop(modal);
      break;
    }
    await new Promise(r => setTimeout(r, 500));
    attempts++;
  }

  if (!modalFound) throw new Error("Application modal didn't open in time");

  return { success: true, message: "Assistant has filled the forms. Please review and click Submit." };
}

async function automationLoop(modal) {
  let finished = false;
  let lastPageHtml = "";

  while (!finished) {
    const currentPageHtml = modal.innerHTML;
    if (currentPageHtml === lastPageHtml) {
      // Small wait to see if things change
      await new Promise(r => setTimeout(r, 1000));
      if (modal.innerHTML === lastPageHtml) {
        console.log("Page didn't change, stopping.");
        break;
      }
    }
    lastPageHtml = modal.innerHTML;

    await fillForm(modal);
    await new Promise(r => setTimeout(r, 500));

    // Check for Next or Review buttons
    const nextButton = modal.querySelector('button[aria-label="Continue to next step"], button[aria-label="Review your application"]');
    const submitButton = modal.querySelector('button[aria-label="Submit application"]');

    if (submitButton) {
      console.log("Reached Submit page. Stopping for user review.");
      finished = true;
    } else if (nextButton) {
      console.log("Clicking Next...");
      nextButton.click();
      // Wait for next page to load
      await new Promise(r => setTimeout(r, 1500));
    } else {
      console.log("No Next/Submit button found. Stopping.");
      finished = true;
    }
  }
}

async function fillForm(modal) {
  // Check if we are on a Resume page
  if (modal.innerText.includes('Resume') || modal.querySelector('.jobs-document-upload__container')) {
    await handleResumePage(modal);
  }

  // Find all form field containers
  const containers = modal.querySelectorAll('.jobs-easy-apply-form-section__grouping, .fb-dash-form-element, .jobs-easy-apply-form-element, .jobs-easy-apply-form-section__list-item');

  for (const container of containers) {
    // Try to find label text more robustly
    let labelText = "";
    const labelEl = container.querySelector('label');
    if (labelEl) {
      labelText = labelEl.innerText.trim();
    } else {
      // Look for any text content that might be a label
      const possibleLabel = container.querySelector('.fb-dash-form-element__label, .jobs-easy-apply-form-element__label, span[aria-hidden="true"]');
      if (possibleLabel) {
        labelText = possibleLabel.innerText.trim();
      }
    }

    // Check for different input types
    const textInput = container.querySelector('input[type="text"], input[type="email"], input[type="tel"], textarea');
    const radios = container.querySelectorAll('input[type="radio"]');
    const select = container.querySelector('select');

    if (textInput && (!textInput.value || textInput.value.trim() === "")) {
      console.log(`Filling text field: ${labelText}`);
      await handleTextInput(textInput, labelText);
    } else if (radios.length > 0) {
      const checked = Array.from(radios).find(r => r.checked);
      if (!checked) {
        await handleRadioInput(radios, labelText);
      }
    } else if (select && (!select.value || select.value === "Select an option")) {
      await handleSelectInput(select, labelText);
    }
  }
}

async function handleResumePage(modal) {
  console.log("Handling Resume selection...");
  const resumes = modal.querySelectorAll('.jobs-document-upload__container input[type="radio"]');
  if (resumes.length > 0) {
    const checked = Array.from(resumes).find(r => r.checked);
    if (!checked) {
      resumes[0].click(); // Select the first one
    }
  }
}

async function handleTextInput(input, question) {
  if (!question) return;
  const q = question.toLowerCase();
  // Basic info and questions

  const isBasic = q.includes('name') || q.includes('email') || q.includes('phone') || q.includes('mobile');
  const isQuestion = q.includes('?') || q.includes('how many') || q.includes('years') || q.length > 15 || q.includes('website');

  if (isBasic || isQuestion) {
    const res = await chrome.runtime.sendMessage({ type: "SUGGEST_ANSWER", question: question });
    if (res && res.success && res.answer) {
      input.value = res.answer;
      ['input', 'change', 'blur'].forEach(ev => {
        input.dispatchEvent(new Event(ev, { bubbles: true }));
      });
    }
  }
}

async function handleRadioInput(radios, question) {
  const q = question.toLowerCase();
  let choice = "yes"; // Default

  if (q.includes('sponsorship') || q.includes('visa')) {
    choice = "no";
  } else if (q.includes('background check') || q.includes('authorized')) {
    choice = "yes";
  } else {
    // AI suggestion for radio
    const options = Array.from(radios).map(r => r.nextElementSibling?.innerText.trim() || "").join(", ");
    const res = await chrome.runtime.sendMessage({
      type: "SUGGEST_ANSWER",
      question: `Question: ${question}. Options: ${options}. Pick the single best option text.`
    });

    if (res && res.success) {
      const best = res.answer.toLowerCase();
      for (const r of radios) {
        if (r.nextElementSibling?.innerText.trim().toLowerCase().includes(best)) {
          r.click();
          return;
        }
      }
    }
  }

  // Default click if no AI match
  for (const r of radios) {
    if (r.nextElementSibling?.innerText.trim().toLowerCase().includes(choice)) {
      r.click();
      break;
    }
  }
}

async function handleSelectInput(select, question) {
  const options = Array.from(select.options).map(o => o.text).join(", ");
  const res = await chrome.runtime.sendMessage({
    type: "SUGGEST_ANSWER",
    question: `Question: ${question}. Options: ${options}. Pick the single best option text.`
  });

  if (res && res.success) {
    const best = res.answer.toLowerCase();
    for (let i = 0; i < select.options.length; i++) {
      if (select.options[i].text.toLowerCase().includes(best)) {
        select.selectedIndex = i;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
    }
  }
}

function extractTextFromResumeData(data) {
  const parts = [];
  if (data?.header) {
    ['name','email','phone','location','linkedin','portfolio']
      .forEach(k => { if (data.header[k]) parts.push(data.header[k]); });
  }
  if (data?.summary) parts.push(data.summary);
  if (data?.skills?.length) parts.push(data.skills.join(', '));
  (data?.experience || []).forEach(exp => {
    parts.push([exp.role, exp.company, exp.date].filter(Boolean).join(' | '));
    (exp.points || []).forEach(p => parts.push(p));
  });
  (data?.projects || []).forEach(proj => {
    parts.push(proj.name || '');
    if (proj.description) parts.push(proj.description);
    (proj.points || []).forEach(p => parts.push(p));
  });
  (data?.education || []).forEach(edu => {
    parts.push([edu.school, edu.degree, edu.date].filter(Boolean).join(' | '));
  });
  return parts.join('\n');
}

function showResumeModal(data) {
  // Save generated resume text to storage immediately so that
  // re-running Analyze uses the tailored resume, not the original.
  const generatedText = extractTextFromResumeData(data);
  chrome.storage.local.set({ resumeText: generatedText, lastAnalyzedResume: '' });

  // Remove existing modal if any
  const existing = document.getElementById("ca-resume-modal-root");
  if (existing) existing.remove();

  const root = document.createElement("div");
  root.id = "ca-resume-modal-root";
  document.body.appendChild(root);

  const shadow = root.attachShadow({ mode: "open" });

  let selectedTemplate = "modern";

  const resumeStyles = `
    .page { font-family: 'Inter', -apple-system, sans-serif; background: white; margin: 0; padding: 0.5in 0.75in; min-height: 10in; box-sizing: border-box; }
    .header-content { text-align: center; margin-bottom: 1.5rem; border-bottom: 1px solid #e5e7eb; padding-bottom: 1.5rem; }
    .header-content h1 { font-size: 24pt; margin: 0; color: #0f172a; line-height: 1.2; }
    .contact-line { display: flex; justify-content: center; gap: 0.75rem; font-size: 10pt; color: #4b5563; margin-top: 0.5rem; line-height: 1.5; }
    h2 { font-size: 13pt; text-transform: uppercase; color: #1e40af; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.25rem; margin: 1.5rem 0 0.75rem 0; letter-spacing: 0.05em; }
    p { margin-bottom: 0.5rem; text-align: justify; font-size: 10.5pt; line-height: 1.6; color: #374151; }
    ul { list-style: disc; padding-left: 1.2rem; margin-top: 0.5rem; }
    li { margin-bottom: 0.4rem; font-size: 10.5pt; line-height: 1.6; color: #374151; }
    .entry { margin-bottom: 1.25rem; }
    .entry-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.25rem; }
    .entry-title { font-weight: 700; font-size: 11pt; color: #111827; }
    .entry-meta { font-size: 10pt; color: #6b7280; font-weight: 500; }
    .entry-subtitle { font-style: italic; color: #4b5563; font-size: 10.5pt; margin-bottom: 0.5rem; }
    .skills-section { display: flex; flex-wrap: wrap; gap: 0.5rem; line-height: 1.5; }
    .skill-pill { background: #f3f4f6; padding: 0.25rem 0.6rem; border-radius: 4px; font-size: 9.5pt; border: 1px solid #e5e7eb; color: #374151; }

    .template-modern h2 { color: #1e40af; border-bottom: 2px solid #e5e7eb; }
    .template-modern .entry-title { color: #111827; }

    .template-minimal .header-content { text-align: left; border-bottom: 1px solid #d1d5db; padding-bottom: 1rem; margin-bottom: 1rem; }
    .template-minimal .contact-line { justify-content: flex-start; gap: 0.5rem; }
    .template-minimal h2 { color: #111827; border-bottom: 1px solid #d1d5db; letter-spacing: 0.02em; }
    .template-minimal .entry-subtitle { font-style: normal; }
    .template-minimal .skill-pill { background: #ffffff; border: 1px solid #d1d5db; }

    .template-classic .page, .page.template-classic { font-family: 'Georgia', 'Times New Roman', serif; }
    .template-classic .header-content { border-bottom: 2px solid #1f2937; }
    .template-classic .header-content h1 { letter-spacing: 0.04em; text-transform: uppercase; font-size: 22pt; }
    .template-classic .contact-line { font-size: 9pt; color: #374151; }
    .template-classic h2 { color: #1f2937; border-bottom: 1px solid #1f2937; }
    .template-classic .entry-title { font-size: 10.8pt; }
    .template-classic .entry-subtitle { color: #1f2937; }
    .template-classic .skill-pill { background: #f9fafb; border: 1px solid #d1d5db; }

    @page { margin: 0.5in; }

    /* ── Edit mode ── */
    .edit-mode {
      outline: 2.5px dashed #d97706 !important;
      outline-offset: 6px;
      cursor: text;
    }
    .edit-mode * { cursor: text; }
    .page-break-marker {
      width: 100%;
      height: 0;
      border: none;
      border-top: 2px dashed #7c3aed;
      page-break-before: always;
      break-before: page;
      position: relative;
      margin: 0.75rem 0;
      pointer-events: none;
    }
    .page-break-marker::before {
      content: attr(data-label);
      position: absolute;
      top: -0.65rem;
      left: 50%;
      transform: translateX(-50%);
      background: white;
      color: #7c3aed;
      font-size: 8pt;
      letter-spacing: 0.05em;
      padding: 0 0.5rem;
      pointer-events: auto;
      white-space: nowrap;
    }
  `;

  const style = document.createElement("style");
  style.textContent = `
    :host {
      --primary: #2563eb;
      --gray-50: #f9fafb;
      --gray-200: #e5e7eb;
      --gray-700: #374151;
      --radius-lg: 0.75rem;
      --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1);
    }
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Inter', -apple-system, sans-serif;
    }
    .modal-content {
      background: white;
      width: 850px;
      max-width: 95vw;
      height: 90vh;
      border-radius: var(--radius-lg);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: var(--shadow-lg);
    }
    .modal-header {
      padding: 1rem 1.5rem;
      border-bottom: 1px solid var(--gray-200);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: var(--gray-50);
    }
    .modal-header h3 {
      margin: 0;
      font-size: 1.125rem;
      font-weight: 600;
      color: #111827;
    }
    .header-controls {
      display: flex;
      align-items: center;
      gap: 0.9rem;
      min-width: 0;
    }
    .template-picker {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: #ffffff;
      border: 1px solid #dbe1ea;
      border-radius: 0.625rem;
      padding: 0.25rem 0.35rem 0.25rem 0.6rem;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }
    .template-picker:focus-within {
      border-color: #93c5fd;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
    }
    .template-label {
      font-size: 0.76rem;
      color: #64748b;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .template-select {
      border: none;
      border-radius: 0.45rem;
      background-color: #f8fafc;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364758b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 0.45rem center;
      background-size: 14px;
      padding: 0.42rem 1.8rem 0.42rem 0.6rem;
      font-size: 0.85rem;
      font-weight: 600;
      color: #0f172a;
      outline: none;
      appearance: none;
      -webkit-appearance: none;
      min-width: 138px;
      cursor: pointer;
      transition: background-color 0.2s ease;
    }
    .template-select:hover {
      background-color: #f1f5f9;
    }
    @media (max-width: 768px) {
      .modal-header {
        flex-direction: column;
        align-items: stretch;
        gap: 0.75rem;
      }
      .header-controls {
        justify-content: space-between;
      }
    }
    .modal-body {
      flex: 1;
      overflow-y: auto;
      overflow-x: auto;
      padding: 2rem 1rem;
      background: #f3f4f6;
      display: flex;
      justify-content: center;
      align-items: flex-start;
    }
    .btn {
      padding: 0.625rem 1.25rem;
      border-radius: 0.5rem;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.2s;
    }
    .btn-primary {
      background: var(--primary);
      color: white;
    }
    .btn-primary:hover {
      background: #1d4ed8;
    }
    .btn-secondary {
      background: white;
      border-color: var(--gray-200);
      color: var(--gray-700);
    }
    .btn-secondary:hover {
      background: var(--gray-50);
    }
    .page {
      /*
       * Width must equal the PRINTABLE area, not the full paper width.
       * @page { margin: 0.5in } → printable width = 8.5in − 1in = 7.5in = 720px @ 96dpi.
       * This makes every line wrap at the same point on-screen as in the PDF,
       * so the page-boundary rulers land exactly where the printer cuts pages.
       */
      background: white;
      width: 720px !important;
      padding: 0.5in 0.75in !important;
      box-shadow: 0 4px 6px rgba(0,0,0,0.05);
      flex-shrink: 0;
      position: relative;
    }
    ${resumeStyles}
  `;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const content = document.createElement("div");
  content.className = "modal-content";

  content.innerHTML = `
    <div class="modal-header">
      <div class="header-controls">
        <h3>Job Ready Resume</h3>
        <div class="template-picker">
          <label class="template-label" for="ca-template-select">Template</label>
          <select class="template-select" id="ca-template-select">
            <option value="modern" selected>Modern</option>
            <option value="minimal">Minimal</option>
            <option value="classic">Classic</option>
          </select>
        </div>
      </div>
      <div style="display: flex; gap: 0.5rem; align-items: center;">
        <!-- Edit toolbar: shown only in edit mode -->
        <div id="ca-edit-toolbar" style="display:none; align-items:center; gap:0.5rem;">
          <button class="btn" id="ca-page-break-btn" style="background:#7c3aed;color:white;font-size:0.8rem;padding:0.5rem 0.9rem;">+ Page Break</button>
          <button class="btn" id="ca-edit-done-btn" style="background:#059669;color:white;font-size:0.8rem;padding:0.5rem 0.9rem;">✓ Done</button>
        </div>
        <button class="btn" id="ca-edit-btn" style="background:#d97706;color:white;">✏ Edit</button>
        <button class="btn btn-primary" id="ca-download-btn">Download PDF</button>
        <button class="btn btn-secondary" id="ca-close-btn">Close</button>
      </div>
    </div>
    <div class="modal-body">
      <div class="page template-modern" id="ca-resume-page">
        ${getResumeHTML(data, selectedTemplate)}
      </div>
    </div>
  `;

  shadow.appendChild(style);
  shadow.appendChild(overlay);
  overlay.appendChild(content);

  const cleanup = () => {
    document.body.style.overflow = "";
    root.remove();
  };

  shadow.getElementById("ca-close-btn").onclick = cleanup;
  overlay.onclick = (e) => { if (e.target === overlay) cleanup(); };

  const templateSelect = shadow.getElementById("ca-template-select");
  const renderPreview = () => {
    const page = shadow.getElementById("ca-resume-page");
    if (!page) return;
    page.className = `page template-${selectedTemplate}`;
    page.innerHTML = getResumeHTML(data, selectedTemplate);
  };

  if (templateSelect) {
    templateSelect.addEventListener("change", (e) => {
      selectedTemplate = e.target.value;
      renderPreview();
    });
  }

  // ── Edit mode logic ──────────────────────────────────────────────────────
  let editModeActive = false;
  let resumeHasEdits = false;

  const resumePageEl  = shadow.getElementById("ca-resume-page");
  const editToolbarEl = shadow.getElementById("ca-edit-toolbar");
  const editBtn       = shadow.getElementById("ca-edit-btn");
  const editDoneBtn   = shadow.getElementById("ca-edit-done-btn");
  const pageBreakBtn  = shadow.getElementById("ca-page-break-btn");

  const enterEditMode = () => {
    editModeActive = true;
    resumePageEl.contentEditable = "true";
    resumePageEl.classList.add("edit-mode");
    editToolbarEl.style.display = "flex";
    editBtn.style.display = "none";
    resumePageEl.focus();
  };

  const exitEditMode = () => {
    editModeActive = false;
    resumeHasEdits = true;
    resumePageEl.contentEditable = "false";
    resumePageEl.classList.remove("edit-mode");
    editToolbarEl.style.display = "none";
    editBtn.style.display = "";
  };

  editBtn.onclick = () => { if (editModeActive) exitEditMode(); else enterEditMode(); };
  editDoneBtn.onclick = exitEditMode;

  pageBreakBtn.onclick = () => {
    resumePageEl.focus();
    const sel = resumePageEl.getRootNode().getSelection
      ? resumePageEl.getRootNode().getSelection()
      : shadow.getSelection ? shadow.getSelection() : null;
    // Fallback: use window selection (works in most shadow DOM contexts)
    const winSel = window.getSelection();

    const marker = document.createElement("div");
    marker.className = "page-break-marker";
    marker.contentEditable = "false";
    marker.setAttribute("data-label", "── Page Break ──");

    // Find the direct child of resumePageEl that contains the selection
    let anchor = winSel && winSel.rangeCount > 0 ? winSel.getRangeAt(0).startContainer : null;
    while (anchor && anchor.parentNode !== resumePageEl) anchor = anchor.parentNode;

    if (anchor) {
      resumePageEl.insertBefore(marker, anchor);
    } else {
      resumePageEl.appendChild(marker);
    }
  };

  // ── Download: if edited, open print window; otherwise fast text PDF ───────
  shadow.getElementById("ca-download-btn").onclick = () => {
    if (resumeHasEdits || shadow.querySelector(".page-break-marker")) {
      // Build a standalone HTML page from the live edited content and print it
      const editedHTML = resumePageEl.innerHTML;
      const printWin = window.open("", "_blank", "width=900,height=700");
      printWin.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
        <title>Resume</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { background: white; font-family: Arial, sans-serif; }
          .page-break-marker { page-break-before: always; break-before: page; border: none; }
          .page-break-marker::before { display: none; }
          @page { margin: 0.5in; size: letter; }
        </style>
        <style>${resumeStyles.replace(/@page[^}]*}/, '')}</style>
        </head><body>
        <div class="page template-${selectedTemplate}">${editedHTML}</div>
        </body></html>`);
      printWin.document.close();
      printWin.onload = () => { printWin.print(); };
    } else {
      generateTextPDF(data);
    }
  };

  // Prevent background scroll
  document.body.style.overflow = "hidden";
}

function generateTextPDF(data) {
  // Pure JS text-based PDF — no libraries, fully ATS-parseable.
  const PW = 612, PH = 792, ML = 50, MR = 50, MT = 50, MB = 50;
  const CW = PW - ML - MR;

  const UMAP = {
    '\u2022':'*','\u2013':'-','\u2014':'-','\u2019':"'",'\u2018':"'",
    '\u201C':'"','\u201D':'"','\u2026':'...','\u00A0':' ',
    '\u2010':'-','\u2011':'-','\u2012':'-','\u00B7':'*',
  };
  const san = s => (s || '').replace(/[^\x20-\x7E]/g, c => UMAP[c] || '');
  const tw  = (s, sz, bold) => s.length * sz * (bold ? 0.57 : 0.52);
  const wrap = (text, maxW, sz, bold) => {
    const words = san(text).split(' ');
    const lines = []; let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (tw(t, sz, bold) > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  };

  const pages = [[]]; let y = PH - MT;
  const newPage = () => { pages.push([]); y = PH - MT; };
  const chk = h => { if (y - h < MB) newPage(); };
  const addText = (x, yy, str, sz, bold, r=0, g=0, b=0) =>
    pages[pages.length-1].push({ x, y: yy, text: san(str), sz, bold, r, g, b });
  const addRule = (x1, yy, x2, r=30, g=64, b=175) =>
    pages[pages.length-1].push({ type:'line', x1, y: yy, x2, r, g, b });

  const secTitle = title => {
    chk(28); y -= 8;
    addText(ML, y, title.toUpperCase(), 10, true, 30, 64, 175);
    addRule(ML, y - 3, ML + CW);
    y -= 16;
  };
  const para = (str, sz, bold, r=0, g=0, b=0, indent=0) => {
    if (!str) return;
    for (const l of wrap(str, CW - indent, sz, bold)) {
      chk(sz + 4); addText(ML + indent, y, l, sz, bold, r, g, b); y -= (sz + 3);
    }
  };

  // Name
  chk(30);
  const nameStr = san(data?.header?.name || '');
  addText(ML + (CW - tw(nameStr, 20, true)) / 2, y, nameStr, 20, true);
  y -= 24;

  // Contact
  const contact = [data?.header?.email, data?.header?.phone, data?.header?.location,
    data?.header?.linkedin, data?.header?.portfolio].filter(Boolean).map(san).join('  |  ');
  if (contact) {
    for (const cl of wrap(contact, CW, 9, false)) {
      addText(ML + (CW - tw(cl, 9, false)) / 2, y, cl, 9, false, 55, 65, 81);
      y -= 12;
    }
  }

  // Summary
  if (data?.summary) { secTitle('Professional Summary'); para(data.summary, 10, false); }

  // Skills
  if (data?.skills?.length) { secTitle('Core Competencies'); para(data.skills.join('  *  '), 10, false); }

  // Experience
  if (data?.experience?.length) {
    secTitle('Professional Experience');
    for (const exp of data.experience) {
      chk(32);
      addText(ML, y, san(exp.role || ''), 10.5, true);
      if (exp.date) { const d=san(exp.date); addText(ML+CW-tw(d,9.5,false), y, d, 9.5, false, 107,114,128); }
      y -= 13; chk(13);
      addText(ML, y, san(exp.company || ''), 9.5, false, 80, 80, 80);
      y -= 13;
      for (const pt of (exp.points||[])) para('*  '+pt, 9.5, false, 0,0,0, 8);
      y -= 5;
    }
  }

  // Projects
  if (data?.projects?.length) {
    secTitle('Key Projects');
    for (const proj of data.projects) {
      chk(26);
      addText(ML, y, san(proj.name||''), 10.5, true); y -= 13;
      if (proj.link) { chk(11); addText(ML, y, san(proj.link), 9, false, 37,99,235); y -= 11; }
      if (proj.description) para(proj.description, 9.5, false, 80,80,80);
      for (const pt of (proj.points||[])) para('*  '+pt, 9.5, false, 0,0,0, 8);
      y -= 5;
    }
  }

  // Education
  if (data?.education?.length) {
    secTitle('Education');
    for (const edu of data.education) {
      chk(26);
      addText(ML, y, san(edu.school||''), 10.5, true);
      if (edu.date) { const d=san(edu.date); addText(ML+CW-tw(d,9.5,false), y, d, 9.5, false, 107,114,128); }
      y -= 13; chk(13);
      addText(ML, y, san(edu.degree||''), 10, false); y -= 14;
    }
  }

  // PDF assembly
  const NP = pages.length;
  const F1=NP+1, F2=NP+2, PAGES=2*NP+3, CAT=2*NP+4, TOTAL=CAT;
  const fp2 = n => n.toFixed(2);
  const fp3 = n => n.toFixed(3);
  const esc = s => s.replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');

  const objBody = {};
  for (let i = 0; i < NP; i++) {
    let s = '';
    for (const item of pages[i]) {
      if (item.type === 'line') {
        s += `${fp3(item.r/255)} ${fp3(item.g/255)} ${fp3(item.b/255)} RG 0.75 w `;
        s += `${fp2(item.x1)} ${fp2(item.y)} m ${fp2(item.x2)} ${fp2(item.y)} l S\n`;
      } else {
        s += `BT /${item.bold?'F2':'F1'} ${item.sz} Tf `;
        s += `${fp3(item.r/255)} ${fp3(item.g/255)} ${fp3(item.b/255)} rg `;
        s += `${fp2(item.x)} ${fp2(item.y)} Td (${esc(item.text)}) Tj ET\n`;
      }
    }
    objBody[i+1] = `<< /Length ${s.length} >>\nstream\n${s}endstream`;
  }
  objBody[F1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objBody[F2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  for (let i = 0; i < NP; i++) {
    objBody[NP+3+i] = `<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 ${PW} ${PH}] `
      + `/Contents ${i+1} 0 R /Resources << /Font << /F1 ${F1} 0 R /F2 ${F2} 0 R >> >> >>`;
  }
  const kids = Array.from({length:NP},(_,i)=>`${NP+3+i} 0 R`).join(' ');
  objBody[PAGES] = `<< /Type /Pages /Kids [${kids}] /Count ${NP} >>`;
  objBody[CAT]   = `<< /Type /Catalog /Pages ${PAGES} 0 R >>`;

  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let id = 1; id <= TOTAL; id++) { offsets.push(out.length); out += `${id} 0 obj\n${objBody[id]}\nendobj\n`; }
  const xrefPos = out.length;
  out += `xref\n0 ${TOTAL+1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += off.toString().padStart(10,'0') + ' 00000 n \n';
  out += `trailer\n<< /Size ${TOTAL+1} /Root ${CAT} 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

  // Encode as base64 data URI (avoids blob: URL restrictions in content scripts)
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const dataUri = 'data:application/pdf;base64,' + btoa(binary);
  const a = document.createElement('a');
  a.href = dataUri;
  a.download = `${(data?.header?.name || 'Resume').replace(/\s+/g,'_')}_Resume.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function getResumeHTML(data, template = "modern") {
  const escape = (s) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  const header = data?.header || {};
  const experiences = Array.isArray(data?.experience) ? data.experience : [];
  const projects = Array.isArray(data?.projects) ? data.projects : [];
  const education = Array.isArray(data?.education) ? data.education : [];

  const sectionTitle = {
    modern: {
      summary: "Professional Summary",
      skills: "Core Competencies",
      experience: "Professional Experience",
      projects: "Key Projects",
      education: "Education"
    },
    minimal: {
      summary: "Summary",
      skills: "Skills",
      experience: "Experience",
      projects: "Projects",
      education: "Education"
    },
    classic: {
      summary: "Career Profile",
      skills: "Technical Skills",
      experience: "Employment History",
      projects: "Projects",
      education: "Academic Background"
    }
  }[template] || {
    summary: "Professional Summary",
    skills: "Core Competencies",
    experience: "Professional Experience",
    projects: "Key Projects",
    education: "Education"
  };

  return `
    <header class="header-content">
      <h1>${escape(header.name)}</h1>
      <div class="contact-line">
        ${header.email ? `<span class="contact-item">${escape(header.email)}</span>` : ''}
        ${header.phone ? `<span>|</span><span class="contact-item">${escape(header.phone)}</span>` : ''}
        ${header.location ? `<span>|</span><span class="contact-item">${escape(header.location)}</span>` : ''}
      </div>
    </header>
    
    ${data.summary ? `
    <section>
      <h2>${sectionTitle.summary}</h2>
      <p>${escape(data.summary)}</p>
    </section>
    ` : ''}

    ${data.skills && data.skills.length ? `
    <section>
      <h2>${sectionTitle.skills}</h2>
      <div class="skills-section">
        ${data.skills.map(skill => `<span class="skill-pill">${escape(skill)}</span>`).join('')}
      </div>
    </section>
    ` : ''}

    ${experiences.length ? `
    <section>
      <h2>${sectionTitle.experience}</h2>
      ${experiences.map(exp => `
        <div class="entry">
          <div class="entry-header">
            <div class="entry-title">${escape(exp.role)}</div>
            <div class="entry-meta">${escape(exp.date || '')}</div>
          </div>
          <div class="entry-subtitle">${escape(exp.company)}</div>
          <ul>
            ${(Array.isArray(exp.points) ? exp.points : []).map(point => `<li>${escape(point)}</li>`).join('')}
          </ul>
        </div>
      `).join('')}
    </section>
    ` : ''}

    ${projects.length ? `
    <section>
      <h2>${sectionTitle.projects}</h2>
      ${projects.map(proj => `
        <div class="entry">
          <div class="entry-header">
            <div class="entry-title">${escape(proj.name)}</div>
          </div>
          <p style="margin-bottom: 0.5rem; font-style: italic;">${escape(proj.description)}</p>
          <ul>
            ${(Array.isArray(proj.points) ? proj.points : []).map(point => `<li>${escape(point)}</li>`).join('')}
          </ul>
        </div>
      `).join('')}
    </section>
    ` : ''}
    
    ${education.length ? `
    <section>
      <h2>${sectionTitle.education}</h2>
      ${education.map(edu => `
        <div class="entry">
          <div class="entry-header">
            <div class="entry-title">${escape(edu.school)}</div>
            <div class="entry-meta">${escape(edu.date || '')}</div>
          </div>
          <div class="entry-subtitle">${escape(edu.degree)}</div>
        </div>
      `).join('')}
    </section>
    ` : ''}
  `;
}