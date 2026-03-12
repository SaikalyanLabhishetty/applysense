// Replace this with your actual Vercel deployment URL
const VERCEL_PROXY_URL = "https://applysure.vercel.app/api/proxy";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.type === "ANALYZE") {

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url?.includes("linkedin.com") && !tab?.url?.includes("naukri.com")) {
      chrome.runtime.sendMessage({ type: "RESULT", text: "Match: 0%\nDecision: Invalid Page\n\nPlease Go to LinkedIn or Naukri:\n- This extension works on LinkedIn and Naukri Job pages\n- Navigate to a job page to use" });
      return;
    }

    const trySendMessage = (tabId, retries = 4) => {
      chrome.tabs.sendMessage(tabId, { type: "GET_JD" }, async res => {
        if (chrome.runtime.lastError) {
          if (retries > 0) {
            // Content script may not be injected yet — retry with back-off
            console.log(`Content script not ready, retrying... (${retries} attempts left)`);
            setTimeout(() => trySendMessage(tabId, retries - 1), 1500);
            return;
          }
          // All retries exhausted — always send a RESULT so the sidepanel never stays stuck
          chrome.runtime.sendMessage({ type: "RESULT", text: "Match: 0%\nDecision: Invalid Page\n\nPlease Refresh:\n- The extension needs to reload on this page\n- Please refresh the page and try again" });
          return;
        }

        if (res?.error === "SEARCH_PAGE") {
          chrome.runtime.sendMessage({ type: "RESULT", text: "Match: 0%\nDecision: Invalid Page\n\nPlease Select a Job:\n- You are currently on a search results page\n- Please click on a specific job title to open the details view\n- Then click 'Analyze Match' again" });
          return;
        }

        const jd = (res?.jd || "").slice(0, 6000);

        chrome.storage.local.get("resumeText", async data => {
          const resume = (data.resumeText || "").slice(0, 6000);

          if (!resume.trim()) {
            chrome.runtime.sendMessage({ type: "RESULT", text: "Match: 0%\nDecision: Invalid Domain\nMissing Skills:\n- Upload resume first" });
            return;
          }

          if (!jd.trim() || jd.length < 100) {
            chrome.runtime.sendMessage({ type: "RESULT", text: "Match: 0%\nDecision: Invalid Domain\n\nJob Description Not Found:\n- Please make sure you're on a job listing page\n- Try refreshing the page and clicking 'Analyze Match' again\n- Job description might not be loaded yet" });
            return;
          }

          const result = await analyze(jd, resume);
          chrome.runtime.sendMessage({ type: "RESULT", text: result, isEasyApply: res?.isEasyApply });
        });
      });
    };

    trySendMessage(tab.id);
  }
});

async function analyze(jd, resume) {
  const response = await fetch(VERCEL_PROXY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gemini-2.0-flash",
      systemInstruction: {
        parts: [{ text: "You are an expert ATS evaluator. Be strict about domain matching. Different domains (Frontend vs Backend, Web vs Data Science) = maximum 49% match score." }]
      },
      contents: [{
        parts: [{
          text: `You are an expert ATS evaluator and career domain analyst. Your task is to objectively compare a candidate's resume against a job description and determine if their PRIMARY DOMAIN aligns with the job's requirements.

## DOMAIN DEFINITION RULES

**Resume Domain Detection:**
- Analyze the candidate's PRIMARY specialization based on:
  * Current/most recent job title and role
  * Primary technologies used (the ones they have most experience with)
  * Years of experience breakdown by technology
  * Self-identified specialization in summary/objective
- Return format: "[Role] ([Primary Tech Stack])"
  Examples: "Backend Engineer (Python/Django/PostgreSQL)", "Frontend Developer (React/TypeScript)", "DevOps Engineer (AWS/Terraform/Docker)"

**Job Domain Detection:**
- Identify the ACTUAL role type needed, not just the title:
  * Analyze required skills section - what technologies are MANDATORY vs preferred?
  * Read responsibilities - what will they spend 70%+ of time doing?
  * Check experience requirements - what background is REQUIRED?
- Return format: "[Actual Role] ([Required Core Tech])"
  Examples: "Full Stack Developer (Node.js/React/MongoDB)", "Machine Learning Engineer (Python/TensorFlow/AWS)", "Platform Engineer (Go/Kubernetes/GCP)"

## STRICT SCORING MATRIX (NO EXCEPTIONS)

**Domain Match Score (0-100):**
- 90-100%: IDENTICAL domains. Resume domain matches job domain exactly. Same role type, same core technologies.
- 70-89%: STRONG alignment. Same role family (e.g., both backend), candidate has 70%+ of required core tech, minor gaps only.
- 50-69%: MODERATE alignment. Adjacent role type (e.g., Full Stack → Backend), candidate has 50-69% of core tech, significant gaps in mandatory skills.
- 30-49%: WEAK alignment. Different role family but some overlap (e.g., Frontend → Full Stack), OR same role but missing critical mandatory technologies (>50% gap).
- 10-29%: POOR alignment. Tangential relation only (e.g., Data Analyst → Software Engineer), major domain mismatch with minimal transferable skills.
- 0-9%: NO alignment. Completely different fields (e.g., Marketing → Backend Engineering, Graphic Design → DevOps).

**CRITICAL CONSTRAINTS:**
- If resume domain and job domain are different role types (Frontend vs Backend, Data Science vs Web Dev, Mobile vs Cloud), MAXIMUM score is 49%.
- If mandatory core technologies are missing (listed as "required" or "must-have" in JD), reduce score by 15-25% per missing critical skill.
- Years of experience in wrong domain does NOT compensate for domain mismatch. A Senior Frontend Dev with 8 years applying to Backend role is still a domain mismatch.

## OUTPUT FORMAT (STRICT)

Match: [0-100]%
Decision: [Apply / Weak Match / Poor Match / Invalid Domain]

Domain Analysis:
Resume Domain: [Detected domain with primary tech stack]
Job Domain: [Detected actual required domain with core tech]
Domain Match: [Identical / Strong / Moderate / Weak / Poor / None]
Domain Match Score: [0-100]%

Mandatory Skills Check:
Required: [List mandatory skills from JD]
Candidate Has: [List matching skills]
Missing Critical: [List missing mandatory skills]
Skills Coverage: [X%]

Experience Relevance:
Relevant Years: [X years in matching domain]
Total Years: [Y total years]
Relevance Ratio: [Z%]

Recruiter Rejection Simulator:
- [Specific reason a recruiter would reject based on domain mismatch]
- [Specific reason based on missing mandatory skills]

Resume Personality Analysis:
Tone: [Confident/Technical/Generic/Passive/Managerial]
Strengths:
- [Bullet]
Weaknesses:
- [Bullet]

ATS Keyword Density Map:
[Skill] - [Coverage %]

Missing Skills:
- [Specific missing skill with impact]

Resume Improvements:
- [Specific actionable improvement]

Why Not 100%:
- [Exactly 2 specific reasons]

What If I Apply? Simulator:
Shortlist Probability: [0-100]%
Interview Probability: [0-100]%
Offer Probability: [0-100]%
Reason:
- [Specific reason based on domain alignment]

Resume Inflation Detector:
- [Any detected exaggerations or buzzword stuffing]

Company Fit Analyzer:
Startup Fit: [Low/Medium/High]
Product Company Fit: [Low/Medium/High]
Enterprise MNC Fit: [Low/Medium/High]
FAANG Fit: [Low/Medium/High]

Job Description:
${jd}

Resume:
${resume}`
        }]
      }],
      generationConfig: {
        temperature: 0.2
      }
    })
  });

  const data = await response.json();

  // Debug: log the response if there's an issue
  if (!data.candidates || !data.candidates[0]) {
    console.error("API Response Error:", data);
    return `Match: 0%\nDecision: API Error\n\nAPI Error:\n- ${data.error?.message || JSON.stringify(data)}`;
  }

  return data.candidates[0].content.parts[0].text.trim();
}


chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GENERATE_RESUME") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return sendResponse({ error: "No active tab" });

        const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_JD" });
        const jd = (response?.jd || "").slice(0, 12000);
        const data = await chrome.storage.local.get("resumeText");
        const resume = (data.resumeText || "").slice(0, 15000);

        if (!jd || !resume) return sendResponse({ error: "Missing JD or Resume" });

        const generatedData = await generateResumeJSON(jd, resume);
        sendResponse({ success: true, data: generatedData });
      } catch (error) {
        sendResponse({ error: error.message });
      }
    })();
    return true;
  }

  if (msg.type === "SUGGEST_ANSWER") {
    (async () => {
      try {
        const data = await chrome.storage.local.get("resumeText");
        const resume = (data.resumeText || "").slice(0, 6000);
        const answer = await suggestAnswer(msg.question, resume);
        sendResponse({ success: true, answer: answer });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
});

async function generateResumeJSON(jd, resume) {
  const response = await fetch(VERCEL_PROXY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gemini-2.0-flash",
      systemInstruction: {
        parts: [{ text: "You are a world-class ATS resume transformation engine and career strategist. Your sole purpose is to rewrite resumes so they score 90%+ on applicant tracking systems for a specific job description. You are surgical, aggressive, and precise. You never leave a single bullet point or project description generic — every sentence must earn its place by matching the JD's language, keywords, and priorities." }]
      },
      contents: [{
        parts: [{
          text: `
## YOUR MISSION
Transform the candidate's resume into a 90%+ ATS match for the job description below. You will do this by deeply analyzing the JD, extracting its core language, and injecting that language into every section of the resume.

---

## STEP 1 — DEEP JD ANALYSIS (do this mentally before writing)
Extract and internalize:
- **Top 10 must-have keywords/skills** (the exact words that an ATS will scan for)
- **Top 5 action verbs** used in the JD responsibilities section
- **Core technical stack** the role requires (tools, frameworks, platforms, languages)
- **3 primary responsibilities** the candidate will spend 70%+ of their time on
- **Soft skills / methodologies** mentioned (Agile, cross-functional, stakeholder, etc.)

---

## STEP 2 — REWRITE RULES (apply to every section)

### SUMMARY
- Write a 3-sentence elevator pitch that opens with the candidate's title matching the JD's job title, then hits the top 3 JD requirements with exact keyword phrases, then closes with a value statement.
- Must include at least 5 keywords directly from the JD.

### SKILLS
- List every hard skill, tool, framework, platform, and methodology from the JD that the candidate plausibly has.
- Include skills that appear in their existing experience even if not explicitly listed.
- Do NOT include technologies completely absent from both the JD and the resume.

### EXPERIENCE — THIS IS THE MOST IMPORTANT SECTION
For EVERY job role, preserve the **role title, company name, and date range exactly as in the source resume — do not alter them under any circumstances**. Only rewrite the bullet points following these rules:
- **RULE 1 — JD Keyword Injection**: Every single bullet MUST contain at least one exact keyword, tool name, or technology from the JD. No generic bullets allowed.
- **RULE 2 — STAR Format**: Write each bullet as an implied STAR (what you did + what tool/method + measurable result). Example: "Engineered real-time data pipelines using Apache Kafka and Python, reducing processing latency by 40% and supporting 2M+ daily events."
- **RULE 3 — JD Verb Mirror**: Use the same action verbs the JD uses (if JD says "architect", use "Architected"; if JD says "collaborate", use "Collaborated with cross-functional teams").
- **RULE 4 — Quantify Everything**: Add realistic metrics to every bullet where plausible (%, ms, users, team size, revenue, uptime). If no metric exists, add scope (e.g., "across 3 microservices", "for an 8-member team").
- **RULE 5 — Specifize Generic Claims**: Never leave vague statements. "Worked on backend APIs" → "Designed and deployed RESTful APIs in [JD language stack] handling [X] requests/day with 99.9% uptime."
- Produce exactly 5 bullets per role.

### PROJECTS — SECOND MOST IMPORTANT SECTION
For EVERY project, do ALL of the following:
- **Rewrite the project name** if needed to sound more relevant to the JD (keep it honest but position it better).
- **Rewrite the description** (the short 1-line summary) to explicitly mention the JD's core domain, e.g. if JD is about fintech APIs, say "Built a [fintech/payment/relevant] system using [JD tech stack]…".
- **Rewrite ALL bullet points** using the same STAR + JD keyword rules as experience bullets.
- **Add the JD's core tech stack** to the project's description if the project plausibly used those technologies.
- Produce exactly 3 bullets per project.

### EDUCATION
- Keep as-is. Preserve all entries, degrees, schools, and dates exactly.

---

## HARD CONSTRAINTS
- Do NOT invent fake companies, fake jobs, or fake projects.
- **NEVER change company names** — copy them exactly as they appear in the source resume, character for character.
- **NEVER change job title names** — copy them exactly as they appear in the source resume.
- **NEVER change date ranges / years of experience** — copy them exactly as they appear in the source resume.
- Only the bullet points and descriptions are rewritten. The role, company, and date fields are sacred and must be preserved verbatim.
- DO aggressively rephrase, expand, reframe, quantify, and inject JD language into REAL experience and projects.
- Every section output must read as if it was written specifically for this exact job posting.
- The finished resume must contain the JD's top 10 keywords at least 2x each across all sections combined.

---

Job Description:
${jd}

Original Resume:
${resume}

---

COMPLETENESS RULES:
- Include ALL experience roles from the source resume (never drop any).
- Include ALL projects from the source resume (never drop any).
- Include ALL education entries from the source resume.
- Strict JSON output only — no markdown, no code fences, no commentary.

Return content in this JSON structure:
{
  "header": {
    "name": "Name",
    "email": "Email",
    "phone": "Phone",
    "linkedin": "LinkedIn URL",
    "location": "Location"
  },
  "summary": "Tailored summary...",
  "skills": ["Skill 1", "Skill 2", ...],
  "experience": [
    {
      "role": "Job Title",
      "company": "Company",
      "date": "Date Range",
      "points": ["Actionable bullet 1", "Actionable bullet 2", "Actionable bullet 3", "Actionable bullet 4"]
    }
  ],
  "projects": [
    {
      "name": "Project Name",
      "description": "Short desc",
      "points": ["Bullet 1", "Bullet 2"]
    }
  ],
  "education": [
    {
      "degree": "Degree",
      "school": "School",
      "date": "Year"
    }
  ]
}
`
        }]
      }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2
      }
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.error || `API request failed (${response.status})`);
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || data?.choices?.[0]?.message?.content || "";
  if (!text) {
    throw new Error("Model returned empty response for resume generation");
  }

  try {
    return JSON.parse(text);
  } catch (_) {
    const codeFenceMatch = text.match(/```json\s*([\s\S]*?)\s*```/i);
    const fenced = codeFenceMatch?.[1]?.trim();
    if (fenced) {
      return JSON.parse(fenced);
    }

    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const sliced = text.slice(firstBrace, lastBrace + 1);
      return JSON.parse(sliced);
    }

    throw new Error("Model did not return valid JSON for resume generation");
  }
}


async function suggestAnswer(question, resume) {
  const response = await fetch(VERCEL_PROXY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gemini-2.0-flash",
      systemInstruction: {
        parts: [{ text: "You are an expert career assistant. Based on the user's resume, provide a concise and truthful answer to the job application question. If the question is a Yes/No question, answer with 'Yes' or 'No'. If it asks for numerical values (like years of experience), provide the number. Keep answers very short." }]
      },
      contents: [{
        parts: [{ text: `Question: ${question}\n\nResume Context:\n${resume}` }]
      }],
      generationConfig: {
        temperature: 0.1
      }
    })
  });

  const data = await response.json();
  return data.candidates[0].content.parts[0].text.trim();
}
