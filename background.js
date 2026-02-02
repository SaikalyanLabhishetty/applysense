const MISTRAL_API_KEY = "";
const OPEN_AI_KEY = "";
const GROQ_API_KEY = "";

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
          if (tab.url.includes("/jobs/view/") || tab.url.includes("job-listings")) {
            console.log("Suppressed lastError because user is on a valid /jobs/view/ URL");
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
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",   // best quality
      // or: llama3-8b-8192 (faster)
      messages: [
        { role: "system", content: "You are an ATS resume evaluator." },
        {
          role: "user",
          content: `
You are a STRICT ATS + Recruiter Intelligence Engine.

CRITICAL RULES FOR DOMAIN EXTRACTION:

1. RESUME DOMAIN:
   - Analyze the resume and identify the candidate's PRIMARY domain/specialization
   - Examples: "Frontend Developer", "Backend Engineer", "Full Stack Developer", "DevOps Engineer", "Data Scientist"

2. JOB DOMAIN:
   - Read the ENTIRE job description carefully
   - Identify what type of role this actually is based on:
     * Required skills and technologies
     * Responsibilities mentioned
     * Experience level expectations
   - Extract the CORE DOMAIN (e.g., "Software Engineer", "Full Stack Developer", "Backend Developer")
   
3. JOB TITLE:
   - Keep the job title as-is for reference (e.g., "Remote Software Developer (Go)")

4. DOMAIN ALIGNMENT CALCULATION:
   - Compare Resume Domain vs Job Domain
   - Consider:
     * Is the candidate's specialization (Frontend/Backend/Full Stack/etc.) aligned with job requirements?
     * Does the candidate have experience in the PRIMARY technologies required?
     * Does their tech stack overlap with job requirements?
   
   ALIGNMENT SCORING GUIDE:
   - 80-100%: Perfect domain match + has required tech stack
   - 50-79%: Same general domain but missing some key technologies
   - 30-49%: Partial overlap (e.g., Frontend dev applying for Full Stack role)
   - 0-29%: Significant mismatch (e.g., Frontend-only dev for Backend/Go role)

EXAMPLES:

Example 1:
Job Title: "Remote Software Developer (Go)"
Job Description: Requires Go, Docker, backend systems, full-stack work
Job Domain: "Full Stack Developer (Go/Backend focused)"
Resume Domain: "Frontend Developer (React/JavaScript)"
Alignment: 25% - Wrong specialization, no backend/Go experience

Example 2:
Job Title: "Senior Backend Engineer"
Job Description: Requires Python, microservices, AWS, system design
Job Domain: "Backend Engineer (Python)"
Resume Domain: "Backend Engineer (Python, AWS)"
Alignment: 90% - Perfect match

Example 3:
Job Title: "Full Stack Developer"
Job Description: Requires React, Node.js, MongoDB
Job Domain: "Full Stack Developer (MERN Stack)"
Resume Domain: "Full Stack Developer (React, Node.js)"
Alignment: 85% - Strong match, minor gaps

SCORING RULES:
- Domain Alignment is calculated FIRST based on role type and tech stack match
- Overall Match % considers: Domain Alignment + experience level + specific skills + seniority
- Low Domain Alignment (below 50%) → Overall Match MUST be below 40%
- High Domain Alignment but missing key skills → Overall Match reduced accordingly
- Senior role without leadership/system design → penalize overall Match score

Return output ONLY in the following format:

Match: <exact number>%
Decision: Apply / Improve / Invalid Domain

Domain Identity Score:
Resume Domain: <candidate's primary specialization with main tech stack>
Job Domain: <actual role type based on description analysis with key technologies>
Job Title: <exact title from job posting>
Alignment: <exact number>%
Alignment Reason: <1-2 line explanation of why this alignment score>

Recruiter Rejection Simulator:
- bullets

Resume Personality Analysis:
Tone: <Confident / Generic / Technical / Passive / Managerial>
Strengths:
- bullets
Weaknesses:
- bullets

ATS Keyword Density Map:
Skill - Coverage %

Missing Skills:
- bullets

Resume Improvements:
- bullets

Why Not 100%:
- exactly 2 bullets

What If I Apply? Simulator ⭐:
Shortlist Probability: <number>%
Interview Probability: <number>%
Offer Probability: <number>%
Reason:
- bullets

Resume Inflation Detector:
- bullets

Company Fit Analyzer:
Startup Fit: <Low/Medium/High>
Product Company Fit: <Low/Medium/High>
Enterprise MNC Fit: <Low/Medium/High>
FAANG Fit: <Low/Medium/High>

${jd}

Resume:
${resume}
`
        }


      ],
      temperature: 0.2
    })
  });

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GENERATE_RESUME") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return sendResponse({ error: "No active tab" });

        const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_JD" });
        const jd = (response?.jd || "").slice(0, 6000);
        const data = await chrome.storage.local.get("resumeText");
        const resume = (data.resumeText || "").slice(0, 6000);

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
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: "You are an elite career strategist and expert ATS resume optimizer." },
        {
          role: "user",
          content: `
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
      "points": ["Actionable bullet 1", "Actionable bullet 2"]
    }
  ],
  "projects": [
    {
      "name": "Project Name",
      "description": "Short desc",
      "points": ["Bullet 1"]
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
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3
    })
  });

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

async function suggestAnswer(question, resume) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: "You are an expert career assistant. Based on the user's resume, provide a concise and truthful answer to the job application question. If the question is a Yes/No question, answer with 'Yes' or 'No'. If it asks for numerical values (like years of experience), provide the number. Keep answers very short."
        },
        {
          role: "user",
          content: `Question: ${question}\n\nResume Context:\n${resume}`
        }
      ],
      temperature: 0.1
    })
  });

  const data = await response.json();
  return data.choices[0].message.content.trim();
}
