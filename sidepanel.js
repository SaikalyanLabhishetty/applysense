pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.min.js");

const resumeBox = document.getElementById("resumeBox");
const resultDiv = document.getElementById("result");
const analyzeBtn = document.getElementById("analyze");
const uploadSection = document.getElementById("uploadSection");
const previewSection = document.getElementById("previewSection");

// Helper to switch sections
function showUploadSection() {
  if (uploadSection) uploadSection.style.display = "block";
  if (previewSection) previewSection.style.display = "none";
}

function showPreviewSection() {
  if (uploadSection) uploadSection.style.display = "none";
  if (previewSection) previewSection.style.display = "block";
}

let lastAnalyzedResume = "";
let isAnalyzing = false;

// Restore previously saved resume and last analyzed snapshot
chrome.storage.local.get(["resumeText", "lastAnalyzedResume"], d => {
  if (d.resumeText && d.resumeText.trim()) {
    resumeBox.value = d.resumeText;
    analyzeBtn.disabled = false; // Enable button when resume is restored
    showPreviewSection();
  } else {
    resumeBox.value = "";
    showUploadSection();
  }
  if (d.lastAnalyzedResume) {
    lastAnalyzedResume = d.lastAnalyzedResume;
  }
});

// File input handler
document.getElementById("fileInput").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    content.items.forEach(i => text += i.str + " ");
  }

  resumeBox.value = text.trim();
  lastAnalyzedResume = "";
  chrome.storage.local.set({
    resumeText: resumeBox.value,
    lastAnalyzedResume: ""
  });

  resetResultUI();
  analyzeBtn.disabled = false;
  isAnalyzing = false;
  showPreviewSection();
});

// Reset button handler
document.getElementById("reset").onclick = () => {
  resumeBox.value = "";
  resetResultUI();
  analyzeBtn.disabled = false;
  isAnalyzing = false;
  lastAnalyzedResume = "";
  chrome.storage.local.remove(["resumeText", "lastAnalyzedResume"]);
  showUploadSection();
};

function resetResultUI() {
  resultDiv.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">
          <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="margin: 0 auto;">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
      </div>
      <p>Upload your resume to start the analysis</p>
    </div>
  `;
}

// Analyze button handler
analyzeBtn.onclick = () => {
  const current = resumeBox.value.trim();
  if (!current) return alert("Please upload your resume first");

  if (lastAnalyzedResume && current === lastAnalyzedResume.trim()) {
    // If we are already showing results for this resume, and they are still there, no need to re-analyze.
    // But if resultDiv is empty or showing placeholder, proceed (though that shouldn't happen with correct logic).
    if (!resultDiv.querySelector(".result-card")) {
      // Just in case
    } else {
      return; // Already showing results
    }
  }

  if (isAnalyzing) return;

  isAnalyzing = true;
  analyzeBtn.disabled = true;

  // Modern Loading State
  resultDiv.innerHTML = `
    <div style="text-align: center; padding: 40px 20px;">
      <div style="width: 40px; height: 40px; border: 3px solid #e5e7eb; border-top-color: #3b82f6; border-radius: 50%; margin: 0 auto 16px; animation: spin 1s linear infinite;"></div>
      <p style="color: #6b7280; font-size: 0.875rem; font-weight: 500;">Analyzing resume against job description...</p>
    </div>
    <style>
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    </style>
  `;

  chrome.runtime.sendMessage({ type: "ANALYZE" });
};

// Listen for results
chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === "RESULT") {
    isAnalyzing = false;
    analyzeBtn.disabled = false;

    lastAnalyzedResume = (resumeBox.value || "").trim();
    chrome.storage.local.set({ lastAnalyzedResume });

    const html = renderHTML(msg.text || "", msg.isEasyApply);
    if (html) {
      resultDiv.innerHTML = html;
      initAccordions();
      setTimeout(() => {
        initGenerateButton();
        initAssistedApplyButton();
      }, 0);
    } else {
      resultDiv.innerText = msg.text;
    }
  }
});

function renderHTML(text, isEasyApply) {
  if (!text.includes("Job Domain:") && !text.includes("Decision:") && !text.includes("Match:") && !text.includes("Alignment:")) {
    // Error / No Job Description State
    return `
      <div class="result-card">
        <div style="padding: 2rem; text-align: center;">
          <div style="width: 48px; height: 48px; background: #fef2f2; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem; color: #dc2626;">
            <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
            </svg>
          </div>
          <p style="color: #111827; font-weight: 600; margin-bottom: 0.5rem;">Job Description Not Found</p>
          <p style="color: #6b7280; font-size: 0.8125rem;">Please navigate to a job listing page and try analyzing again.</p>
        </div>
      </div>
    `;
  }

  const clean = (s) => {
    if (!s) return "";
    return s.replace(/\*\*/g, "").trim();
  };

  text = text.replace(/\r\n/g, "\n").replace(/[^\x00-\x7F]+/g, "");

  const matchNum = parseInt(text.match(/(Match|Alignment):\s*(\d+)%/i)?.[2] || 0);

  let colorClass = "score-green";
  if (matchNum < 35) colorClass = "score-red";
  else if (matchNum < 60) colorClass = "score-orange";

  const lines = text.split("\n");

  const sectionOrder = [
    "Domain Identity Score",
    "Recruiter Rejection Simulator",
    "Resume Personality Analysis",
    "ATS Keyword Density Map",
    "Missing Skills",
    "Resume Improvements",
    "Why Not 100%",
    "What If I Apply?",
    "Resume Inflation Detector",
    "Company Fit Analyzer"
  ];

  const sectionMap = {
    "Domain Identity Score": "Domain Identity Score",
    "Recruiter Rejection Simulator": "Recruiter Rejection Simulator",
    "Resume Personality Analysis": "Resume Personality Analysis",
    "ATS Keyword Density Map": "ATS Keyword Density Map",
    "Missing Skills": "Missing Skills",
    "Resume Improvements": "Resume Improvements",
    "Why Not 100%": "Why the Match is Not 100%",
    "What If I Apply?": "What If I Apply?",
    "Resume Inflation Detector": "Resume Inflation Detector",
    "Company Fit Analyzer": "Company Fit Analyzer"
  };

  const sections = {};
  sectionOrder.forEach(k => (sections[k] = []));
  const introLines = [];
  let currentSection = "";
  let decisionLine = "";

  // New fields extraction
  let resumeDomain = clean(text.match(/Resume Domain:\s*(.*)/i)?.[1]);
  let jobDomain = clean(text.match(/Job Domain:\s*(.*)/i)?.[1]);
  let jobTitle = clean(text.match(/Job Title:\s*(.*)/i)?.[1]);
  let alignmentReason = clean(text.match(/Alignment Reason:\s*(.*)/i)?.[1]);

  for (let raw of lines) {
    let line = clean(raw);
    if (!line) continue;

    if (/^(Match|Alignment):/i.test(line)) continue;
    if (/^Resume Domain:/i.test(line)) continue;
    if (/^Job Domain:/i.test(line)) continue;
    if (/^Job Title:/i.test(line)) continue;
    if (/^Alignment Reason:/i.test(line)) continue;
    if (/^Domain Identity Score:/i.test(line)) continue; // Handled as section but also key

    if (/^Decision:/i.test(line)) {
      decisionLine = line.replace(/^Decision:\s*/i, "").trim();
      continue;
    }

    let foundSection = false;
    for (let key of sectionOrder) {
      if (line.startsWith(key)) {
        currentSection = key;
        foundSection = true;
        break;
      }
    }
    if (foundSection) continue;

    let item = { type: "text", text: line, probClass: "" };

    // Format detection
    if (/^[-*•]/.test(line) || /^\d+\./.test(line)) {
      item.type = "bullet";
      item.text = line.replace(/^[-*•\d\.]+/, "").trim();
    }

    if (line.includes("Probability")) {
      const num = parseInt(line.match(/(\d+)%/)?.[1] || 0);
      item.type = "prob";
      if (num < 20) item.probClass = "prob-red";
      else if (num < 50) item.probClass = "prob-orange";
      else item.probClass = "prob-green";
    }

    if (currentSection && sections[currentSection]) {
      sections[currentSection].push(item);
    } else {
      introLines.push(item);
    }
  }

  // --- HTML Construction ---
  let html = '<div class="result-card">';

  // Header part
  html += '<div class="result-header">';
  html += '<div class="match-score-lockup">';
  html += '<div>';
  html += '<div class="score-label">Match Score</div>';
  html += `<div class="score-value ${colorClass}">${matchNum}%</div>`;
  html += '</div>';

  if (decisionLine) {
    html += `<div class="decision-badge">${decisionLine}</div>`;
  }

  html += '</div>'; // end lockup

  if (matchNum >= 40) {
    html += `
        <div style="margin-top: 1rem;">
            <button id="btn-generate-resume" class="btn btn-primary" style="width: 100%; background: linear-gradient(135deg, #2563eb, #1d4ed8);">
                <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                </svg>
                Get Job Ready Resume
            </button>
        </div>
      `;
  }

  if (isEasyApply) {
    html += `
        <div style="margin-top: 0.75rem;">
            <button id="btn-assisted-apply" class="btn btn-assisted" style="display: flex; align-items: center; justify-content: center; gap: 0.5rem;">
                <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Smart Apply Assistant
            </button>
        </div>
      `;
  }

  html += '</div>'; // end header

  // Comparison Summary Section
  if (jobTitle || resumeDomain || jobDomain || alignmentReason) {
    html += `
      <div style="padding: 1.25rem; background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
        ${jobTitle ? `<div style="margin-bottom: 0.75rem;"><div style="font-size: 0.7rem; color: #64748b; text-transform: uppercase; font-weight: 700; margin-bottom: 0.15rem;">Job Role</div><div style="font-size: 0.95rem; font-weight: 600; color: #1e293b;">${jobTitle}</div></div>` : ''}
        <div style="display: flex; gap: 1rem; margin-bottom: 0.75rem;">
          ${resumeDomain ? `<div style="flex: 1;"><div style="font-size: 0.7rem; color: #64748b; text-transform: uppercase; font-weight: 700; margin-bottom: 0.15rem;">Resume Domain</div><div style="font-size: 0.8125rem; font-weight: 500; color: #475569; background: #fff; padding: 0.4rem 0.6rem; border: 1px solid #cbd5e1; border-radius: 4px;">${resumeDomain}</div></div>` : ''}
          ${jobDomain ? `<div style="flex: 1;"><div style="font-size: 0.7rem; color: #64748b; text-transform: uppercase; font-weight: 700; margin-bottom: 0.15rem;">Job Domain</div><div style="font-size: 0.8125rem; font-weight: 500; color: #475569; background: #fff; padding: 0.4rem 0.6rem; border: 1px solid #cbd5e1; border-radius: 4px;">${jobDomain}</div></div>` : ''}
        </div>
        ${alignmentReason ? `<div style="font-size: 0.8125rem; line-height: 1.5; color: #475569; font-style: italic; border-left: 3px solid #3b82f6; padding-left: 0.75rem; margin-top: 0.5rem;">${alignmentReason}</div>` : ''}
      </div>
    `;
  }

  // Intro/Overview part
  if (introLines.length) {
    html += '<div class="overview-section">';
    for (const item of introLines) {
      if (item.type === "bullet") {
        html += `<div class="list-item"><span class="list-item-bullet">•</span><span>${item.text}</span></div>`;
      } else if (item.type === "prob") {
        html += `<div class="list-item"><span class="prob-tag ${item.probClass}">${item.text}</span></div>`;
      } else {
        html += `<p style="margin-bottom: 0.5rem; color: #374151;">${item.text}</p>`;
      }
    }
    html += '</div>';
  }

  // Accordion part
  html += '<div>'; // Container for accordions
  let firstOpenSet = false;

  for (const key of sectionOrder) {
    const items = sections[key];
    if (!items || !items.length) continue;

    const isOpenClass = !firstOpenSet ? " open" : "";
    if (!firstOpenSet) firstOpenSet = true;

    html += `<div class="accordion-item${isOpenClass}">`;
    html += '<button type="button" class="accordion-btn">';
    html += `<span class="accordion-title">${sectionMap[key]}</span>`;
    html += '<svg class="accordion-icon" width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>';
    html += '</button>';

    html += '<div class="accordion-content" style="' + (isOpenClass ? 'max-height: 1000px;' : '') + '">';
    html += '<div class="accordion-body">';
    for (const item of items) {
      if (item.type === "bullet") {
        html += `<div class="list-item"><span class="list-item-bullet">•</span><span>${item.text}</span></div>`;
      } else if (item.type === "prob") {
        html += `<div class="list-item"><span class="prob-tag ${item.probClass}">${item.text}</span></div>`;
      } else {
        html += `<p style="margin-bottom: 0.5rem;">${item.text}</p>`;
      }
    }
    html += '</div>'; // end body
    html += '</div>'; // end content
    html += '</div>'; // end item
  }

  html += '</div>'; // end accordion container
  html += '</div>'; // end result card

  return html;
}

function initAccordions() {
  const items = resultDiv.querySelectorAll(".accordion-item");
  if (!items.length) return;

  items.forEach(item => {
    const btn = item.querySelector(".accordion-btn");
    const content = item.querySelector(".accordion-content");
    if (!btn || !content) return;

    // Set initial height for open items
    if (item.classList.contains("open")) {
      content.style.maxHeight = content.scrollHeight + "px";
    }

    btn.addEventListener("click", () => {
      const isOpen = item.classList.contains("open");

      // Close all others (optional - standard accordion behavior)
      items.forEach(other => {
        if (other !== item) {
          other.classList.remove("open");
          const otherContent = other.querySelector(".accordion-content");
          if (otherContent) otherContent.style.maxHeight = "0px";
        }
      });

      // Toggle current
      if (isOpen) {
        item.classList.remove("open");
        content.style.maxHeight = "0px";
      } else {
        item.classList.add("open");
        content.style.maxHeight = content.scrollHeight + "px";
      }
    });
  });
}

function initGenerateButton() {
  const btn = document.getElementById("btn-generate-resume");
  if (!btn) return;

  btn.onclick = async () => {
    // 1. Loading State
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `
      <svg class="animate-spin" style="animation: spin 1s linear infinite; margin-right: 0.5rem;" width="18" height="18" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      Generating Resume...
    `;

    try {
      // 2. Send Message
      const response = await chrome.runtime.sendMessage({ type: "GENERATE_RESUME" });

      if (response && response.success) {
        // 3. Send Message to Content Script to show modal on main screen
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
          await chrome.tabs.sendMessage(tab.id, {
            type: "SHOW_RESUME",
            data: response.data
          });
        }
      } else {
        alert("Failed to generate resume: " + (response?.error || "Unknown error"));
      }
    } catch (e) {
      console.error(e);
      alert("Error generating resume: " + e.message);
    } finally {
      // 5. Reset
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  };
}

function initAssistedApplyButton() {
  const btn = document.getElementById("btn-assisted-apply");
  if (!btn) return;

  btn.onclick = async () => {
    // Check if user has seen walkthrough
    const { hasSeenEasyApplyWalkthrough } = await chrome.storage.local.get("hasSeenEasyApplyWalkthrough");

    if (!hasSeenEasyApplyWalkthrough) {
      // First time - show walkthrough
      showWalkthrough(() => startAssistedApply(btn));
    } else {
      // Subsequent times - apply directly
      startAssistedApply(btn);
    }
  };
}

function showWalkthrough(onComplete) {
  // Create overlay
  const overlay = document.createElement("div");
  overlay.className = "walkthrough-overlay";
  overlay.innerHTML = `
    <div class="walkthrough-modal">
      <div class="walkthrough-header">
        <div class="walkthrough-icon">
          <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <h2>Smart Apply Assistant</h2>
        <p>Let's walk you through how this works!</p>
      </div>
      <div class="walkthrough-body">
        <div class="walkthrough-steps">
          <div class="walkthrough-step">
            <div class="walkthrough-step-icon">
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
              </svg>
            </div>
            <div class="walkthrough-step-content">
              <h4>Auto-Fill Forms</h4>
              <p>We'll automatically fill in your contact info and answer common questions.</p>
            </div>
          </div>
          <div class="walkthrough-step">
            <div class="walkthrough-step-icon">
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div class="walkthrough-step-content">
              <h4>Resume Selection</h4>
              <p>Your resume will be automatically selected if available.</p>
            </div>
          </div>
          <div class="walkthrough-step">
            <div class="walkthrough-step-icon">
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div class="walkthrough-step-content">
              <h4>Review Before Submit</h4>
              <p>You'll always have a chance to review everything before submitting.</p>
            </div>
          </div>
        </div>
      </div>
      <div class="walkthrough-footer">
        <button class="btn btn-skip" id="walkthrough-skip">Skip</button>
        <button class="btn btn-start" id="walkthrough-start">Start Applying</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeWalkthrough = (proceed) => {
    overlay.remove();
    // Mark walkthrough as seen
    chrome.storage.local.set({ hasSeenEasyApplyWalkthrough: true });
    if (proceed && onComplete) {
      onComplete();
    }
  };

  document.getElementById("walkthrough-skip").onclick = () => closeWalkthrough(false);
  document.getElementById("walkthrough-start").onclick = () => closeWalkthrough(true);

  // Close on overlay click (outside modal)
  overlay.onclick = (e) => {
    if (e.target === overlay) closeWalkthrough(false);
  };
}

async function startAssistedApply(btn) {
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `
    <svg class="animate-spin" style="animation: spin 1s linear infinite; margin-right: 0.5rem;" width="18" height="18" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
    Starting Assist...
  `;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      const response = await chrome.tabs.sendMessage(tab.id, { type: "START_ASSISTED_APPLY" });
      if (response && response.success) {
        // Maybe close the sidepanel or show a message?
        // For now just keep it.
      } else {
        alert("Failed to start assistant: " + (response?.error || "Unknown error"));
      }
    }
  } catch (e) {
    console.error(e);
    alert("Error: " + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

