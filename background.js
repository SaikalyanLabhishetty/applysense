// Replace this with your actual Vercel deployment URL
const VERCEL_PROXY_URL = "https://applysense-six.vercel.app/api/proxy";

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

    const trySendMessage = (tabId) => {
      chrome.tabs.sendMessage(tabId, { type: "GET_JD" }, async res => {
        if (chrome.runtime.lastError) {
          // If we are on a valid LinkedIn job view page, don't show the error as requested by the user.
          if (tab.url.includes("/jobs/view/") || tab.url.includes("job-listings") || tab.url.includes("currentJobId=")) {
            console.log("Suppressed lastError because user is on a valid job URL");
            return;
          }
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

        const generatedData = awaigenerateResumeJSON(jd, resume);
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
        parts: [{ text: "You are an elite career strategist and expert ATS resume optimizer. You rewrite resumes to be 'Job Ready' for specific job descriptions." }]
      },
      contents: [{
        parts: [{
          text: `
You are rewriting a user's resume to specifically target a Job Description.

Target: create a "Job Ready" resume that is fully optimized for the proprietary ATS of the target company.

Job Description:
${jd}

Original Resume:
${resume}

CRITICAL INSTRUCTIONS:
1. **Analyze Gaps**: Identify skills, keywords, and specific methodologies present in the JD but missing from the resume.
2. **Aggressive Integration**: You MUST add these missing skills and "minute details" (specific tools, versions, protocols mentioned in JD) into the resume. 
   - Add them to the "Skills" section.
   - Weave them into "Experience" bullets where they plausibly fit the user's history (e.g., if JD asks for "Jira", and user has generic "project management", verify it as "Agile Project Management using Jira").
3. **ATS Format**: Keep the structure clean. Use standard headings.
4. **Summary**: Rewrite the summary to be a powerful elevator pitch that hits the top 3 requirements of the JD.
5. **No Hallucinations**: Do not invent completely false jobs or companies. But DO rephrase, expand, and specificize existing experience to match the JD's language perfectly.
6. **Experience Completeness**:
  - Include ALL resume experience entries found in the source resume (do not keep only one).
  - For each role, provide 4-6 concise impact bullets where evidence exists.
7. **Projects Completeness**:
  - Include ALL real projects present in the source resume.
  - If at least 3 real projects are present in the source resume, return at least 3 projects.
  - Do not invent fake projects; when fewer than 3 exist in source resume, return only real ones.
8. **Education Completeness**:
  - Include ALL education entries present in the source resume (do not keep only one).
  - Preserve degree, school, and year/date for each entry when available.
9. **Strict JSON Output**:
  - Return ONLY valid JSON. No markdown, no commentary, no code fences.

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
        temperature: 0.3
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
