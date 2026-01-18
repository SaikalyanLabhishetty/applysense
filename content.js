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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === "GET_JD") {
    // Check if user is on a search results page
    const url = window.location.href;
    const isSearchPage = (url.includes("search-results") || (url.includes("/jobs/search/") && !url.includes("/view/"))) && !url.includes("currentJobId=");

    if (isSearchPage) {
      sendResponse({ jd: "", error: "SEARCH_PAGE" });
      return true;
    }

    try {
      const jd = getJD();
      sendResponse({ jd: jd });
    } catch (error) {
      sendResponse({ jd: "" });
    }
  }

  if (msg.type === "SHOW_RESUME") {
    showResumeModal(msg.data);
    sendResponse({ success: true });
  }

  return true; // Keep the message channel open for async response
});

function showResumeModal(data) {
  // Remove existing modal if any
  const existing = document.getElementById("ca-resume-modal-root");
  if (existing) existing.remove();

  const root = document.createElement("div");
  root.id = "ca-resume-modal-root";
  document.body.appendChild(root);

  const shadow = root.attachShadow({ mode: "open" });

  const resumeStyles = `
    body { font-family: 'Inter', -apple-system, sans-serif; background: white; margin: 0; padding: 0.5in 0.75in; }
    .header-content { text-align: center; margin-bottom: 1.5rem; border-bottom: 1px solid #e5e7eb; padding-bottom: 1.5rem; }
    .header-content h1 { font-size: 24pt; margin: 0; color: #0f172a; }
    .contact-line { display: flex; justify-content: center; gap: 0.75rem; font-size: 10pt; color: #4b5563; margin-top: 0.5rem; }
    h2 { font-size: 13pt; text-transform: uppercase; color: #1e40af; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.25rem; margin: 1.5rem 0 0.75rem 0; }
    p { margin-bottom: 0.5rem; text-align: justify; font-size: 10.5pt; line-height: 1.5; }
    ul { list-style: disc; padding-left: 1.2rem; }
    li { margin-bottom: 0.25rem; font-size: 10.5pt; }
    .entry { margin-bottom: 1rem; }
    .entry-header { display: flex; justify-content: space-between; align-items: baseline; }
    .entry-title { font-weight: 700; font-size: 11pt; }
    .entry-subtitle { font-style: italic; color: #4b5563; }
    .skills-section { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .skill-pill { background: #f3f4f6; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 9pt; border: 1px solid #e5e7eb; }
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
      <h3>Job Ready Resume</h3>
      <div style="display: flex; gap: 0.75rem;">
        <button class="btn btn-primary" id="ca-download-btn">Download PDF</button>
        <button class="btn btn-secondary" id="ca-close-btn">Close</button>
      </div>
    </div>
    <div class="modal-body">
      <div class="page" id="ca-resume-page">
        ${getResumeHTML(data)}
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

  shadow.getElementById("ca-download-btn").onclick = () => {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "100%";
    iframe.style.bottom = "100%";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "none";
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Resume</title>
          <style>${resumeStyles}</style>
        </head>
        <body>
          ${getResumeHTML(data)}
        </body>
      </html>
    `);
    doc.close();

    iframe.onload = () => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(() => {
        iframe.remove();
      }, 500);
    };
  };

  // Prevent background scroll
  document.body.style.overflow = "hidden";
}

function getResumeHTML(data) {
  const escape = (s) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

  return `
    <header class="header-content">
      <h1>${escape(data.header.name)}</h1>
      <div class="contact-line">
        ${data.header.email ? `<span class="contact-item">${escape(data.header.email)}</span>` : ''}
        ${data.header.phone ? `<span>|</span><span class="contact-item">${escape(data.header.phone)}</span>` : ''}
        ${data.header.location ? `<span>|</span><span class="contact-item">${escape(data.header.location)}</span>` : ''}
      </div>
    </header>
    
    ${data.summary ? `
    <section>
      <h2>Professional Summary</h2>
      <p>${escape(data.summary)}</p>
    </section>
    ` : ''}

    ${data.skills && data.skills.length ? `
    <section>
      <h2>Core Competencies</h2>
      <div class="skills-section">
        ${data.skills.map(skill => `<span class="skill-pill">${escape(skill)}</span>`).join('')}
      </div>
    </section>
    ` : ''}

    ${data.experience && data.experience.length ? `
    <section>
      <h2>Professional Experience</h2>
      ${data.experience.map(exp => `
        <div class="entry">
          <div class="entry-header">
            <div class="entry-title">${escape(exp.role)}</div>
            <div class="entry-meta">${escape(exp.date || '')}</div>
          </div>
          <div class="entry-subtitle">${escape(exp.company)}</div>
          <ul>
            ${exp.points.map(point => `<li>${escape(point)}</li>`).join('')}
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
            <div class="entry-title">${escape(proj.name)}</div>
          </div>
          <p style="margin-bottom: 0.5rem; font-style: italic;">${escape(proj.description)}</p>
          <ul>
            ${proj.points.map(point => `<li>${escape(point)}</li>`).join('')}
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