pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.min.js");

const resumeBox = document.getElementById("resumeBox");
const resultDiv = document.getElementById("result");
const analyzeBtn = document.getElementById("analyze");
const uploadSection = document.getElementById("uploadSection");
const previewSection = document.getElementById("previewSection");

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
    showPreviewSection();
  } else {
    resumeBox.value = "";
    showUploadSection();
  }
  if (d.lastAnalyzedResume) {
    lastAnalyzedResume = d.lastAnalyzedResume;
  }
});

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

  resultDiv.className = "result-placeholder";
  resultDiv.textContent = 'Upload your resume and click "Analyze Match" to see your compatibility score and detailed insights.';
  analyzeBtn.disabled = false;
  isAnalyzing = false;
  showPreviewSection();
});

document.getElementById("reset").onclick = () => {
  resumeBox.value = "";
  resultDiv.className = "result-placeholder";
  resultDiv.textContent = 'Upload your resume and click "Analyze Match" to see your compatibility score and detailed insights.';
  analyzeBtn.disabled = false;
  isAnalyzing = false;
  lastAnalyzedResume = "";
  chrome.storage.local.remove(["resumeText", "lastAnalyzedResume"]);
  showUploadSection();
};

analyzeBtn.onclick = () => {
  const current = resumeBox.value.trim();
  if (!current) return alert("Please upload your resume first");

  if (lastAnalyzedResume && current === lastAnalyzedResume.trim()) {
    if (!resultDiv.innerHTML.trim()) {
      resultDiv.className = "";
      resultDiv.textContent = "Analysis is already up to date for this version of your resume.";
    }
    return;
  }

  if (isAnalyzing) return;

  isAnalyzing = true;
  analyzeBtn.disabled = true;
  resultDiv.className = "";
  resultDiv.innerHTML = `
    <div style="text-align: center; padding: 40px 20px;">
      <div style="width: 40px; height: 40px; border: 3px solid #e5e7eb; border-top-color: #4f46e5; border-radius: 50%; margin: 0 auto 16px; animation: spin 1s linear infinite;"></div>
      <p style="color: #6b7280; font-size: 14px;">Analyzing your match...</p>
    </div>
    <style>
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    </style>
  `;
  chrome.runtime.sendMessage({ type: "ANALYZE" });
};

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === "RESULT") {
    isAnalyzing = false;
    analyzeBtn.disabled = false;

    lastAnalyzedResume = (resumeBox.value || "").trim();
    chrome.storage.local.set({ lastAnalyzedResume });

    const html = renderHTML(msg.text || "");
    if (html) {
      resultDiv.className = "";
      resultDiv.innerHTML = html;
      initAccordions();
    } else {
      resultDiv.className = "";
      resultDiv.innerText = msg.text;
    }
  }
});

function renderHTML(text) {
  if (!text.includes("Job Domain:")) {
    return `
      <div class="result-card">
        <div style="padding: 24px; text-align: center;">
          <svg width="48" height="48" style="color: #dc2626; margin: 0 auto 12px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
          <p style="color: #dc2626; font-weight: 600; margin-bottom: 6px;">Job Description Not Detected</p>
          <p style="color: #6b7280; font-size: 13px;">Please open a job listing page and try again.</p>
        </div>
      </div>
    `;
  }

  const clean = (s) => {
    if (!s) return "";
    return s.replace(/\*\*/g, "").trim();
  };

  text = text.replace(/\r\n/g, "\n").replace(/[^\x00-\x7F]+/g, "");

  const matchNum = parseInt(text.match(/Match:\s*(\d+)%/i)?.[1] || 0);

  let color = "green";
  if (matchNum < 35) color = "red";
  else if (matchNum < 60) color = "orange";

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

  for (let raw of lines) {
    let line = clean(raw);
    if (!line) continue;

    if (/^Match:/i.test(line)) continue;

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

    if (/^[-*•]/.test(line) || /^\d+\./.test(line)) {
      item.type = "bullet";
      item.text = line.replace(/^[-*•\d\.]+/, "").trim();
    }

    if (line.includes("Probability")) {
      const num = parseInt(line.match(/(\d+)%/)?.[1] || 0);
      item.type = "prob";
      if (num < 20) item.probClass = "result-line-prob-red";
      else if (num < 50) item.probClass = "result-line-prob-orange";
      else item.probClass = "result-line-prob-green";
    }

    if (currentSection && sections[currentSection]) {
      sections[currentSection].push(item);
    } else {
      introLines.push(item);
    }
  }

  let html = '<div class="result-card">';

  html += '<div class="result-header">';
  html += '<div class="result-match">';
  html += '<div class="match-score">';
  html += '<div class="result-match-label">Match Score</div>';
  html += `<div class="result-match-value result-title-${color}">${matchNum}%</div>`;
  html += '</div>';

  if (decisionLine) {
    html += `<div class="result-decision">${decisionLine}</div>`;
  }

  html += '</div>';
  html += '</div>';

  if (introLines.length) {
    html += '<div class="result-overview">';
    for (const item of introLines) {
      if (item.type === "bullet") {
        html += `<div class="result-line result-line-bullet">${item.text}</div>`;
      } else if (item.type === "prob") {
        html += `<div class="result-line result-line-prob ${item.probClass}">${item.text}</div>`;
      } else {
        html += `<div class="result-line">${item.text}</div>`;
      }
    }
    html += '</div>';
  }

  html += '<div class="accordion">';
  let firstOpenSet = false;

  for (const key of sectionOrder) {
    const items = sections[key];
    if (!items || !items.length) continue;

    const isOpenClass = !firstOpenSet ? " is-open" : "";
    if (!firstOpenSet) firstOpenSet = true;

    html += `<div class="accordion-item${isOpenClass}">`;
    html += '<button type="button" class="accordion-header">';
    html += '<div class="accordion-title">';
    html += `<span>${sectionMap[key]}</span>`;
    html += '</div>';
    html += '<span class="accordion-badge">Details</span>';
    html += '<div class="accordion-chevron">';
    html += '<svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M19 9l-7 7-7-7"/></svg>';
    html += '</div>';
    html += '</button>';

    html += '<div class="accordion-panel">';
    for (const item of items) {
      if (item.type === "bullet") {
        html += `<div class="result-line result-line-bullet">${item.text}</div>`;
      } else if (item.type === "prob") {
        html += `<div class="result-line result-line-prob ${item.probClass}">${item.text}</div>`;
      } else {
        html += `<div class="result-line">${item.text}</div>`;
      }
    }
    html += '</div>';
    html += '</div>';
  }

  html += '</div>';
  html += '</div>';

  return html;
}

function initAccordions() {
  const items = resultDiv.querySelectorAll(".accordion-item");
  if (!items.length) return;

  items.forEach(item => {
    const header = item.querySelector(".accordion-header");
    const panel = item.querySelector(".accordion-panel");
    if (!header || !panel) return;

    if (item.classList.contains("is-open")) {
      panel.style.maxHeight = panel.scrollHeight + "px";
    } else {
      panel.style.maxHeight = "0px";
    }

    header.addEventListener("click", () => {
      const isOpen = item.classList.contains("is-open");

      items.forEach(other => {
        const otherPanel = other.querySelector(".accordion-panel");
        if (!otherPanel) return;

        if (other === item && !isOpen) {
          other.classList.add("is-open");
          otherPanel.style.maxHeight = otherPanel.scrollHeight + "px";
        } else {
          other.classList.remove("is-open");
          otherPanel.style.maxHeight = "0px";
        }
      });
    });
  });
}
