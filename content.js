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

  // Fallback: try to get any visible text from the page
  if (!description || description.length < 200) {
    description = document.body.innerText.slice(0, 8000);
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

function showResumeModal(data) {
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
      padding: 2rem;
      background: #f3f4f6;
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
      background: white;
      width: 100%;
      min-height: 10in;
      padding: 0.5in 0.75in;
      box-shadow: 0 4px 6px rgba(0,0,0,0.05);
      margin: 0 auto;
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
      <div style="display: flex; gap: 0.75rem;">
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

  shadow.getElementById("ca-download-btn").onclick = () => {
    // 1. Create a temporary container in the main document
    // This is needed because html2canvas has trouble rendering content inside Shadow DOM
    const tempContainer = document.createElement("div");
    tempContainer.style.position = "absolute";
    tempContainer.style.left = "-9999px";
    tempContainer.style.top = "0";
    tempContainer.style.width = "8.5in";
    tempContainer.style.background = "white";
    tempContainer.style.zIndex = "-1";

    const templateClass = `template-${selectedTemplate}`;
    tempContainer.innerHTML = `
      <style>${resumeStyles}</style>
      <div class="page ${templateClass}">${getResumeHTML(data, selectedTemplate)}</div>
    `;
    document.body.appendChild(tempContainer);

    // Target the .page element specifically for better accuracy
    const element = tempContainer.querySelector('.page');

    const opt = {
      margin: [0, 0, 0, 0],
      filename: `Resume_${(data?.header?.name || "Candidate").replace(/\s+/g, '_')}_${selectedTemplate}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        letterRendering: true,
        logging: false,
        backgroundColor: '#ffffff'
      },
      jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
    };

    // Add a small delay to ensure the browser has calculated styles and layout
    setTimeout(() => {
      html2pdf().set(opt).from(element).save().then(() => {
        // Clean up the temporary container
        document.body.removeChild(tempContainer);
      }).catch(err => {
        console.error("PDF Export Error:", err);
        document.body.removeChild(tempContainer);
      });
    }, 150);
  };

  // Prevent background scroll
  document.body.style.overflow = "hidden";
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