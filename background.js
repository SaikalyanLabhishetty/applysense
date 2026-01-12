const MISTRAL_API_KEY = "";
const OPEN_AI_KEY = "";
const GROQ_API_KEY = "";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.type === "ANALYZE") {

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    chrome.tabs.sendMessage(tab.id, { type: "GET_JD" }, async res => {

      const jd = (res?.jd || "").slice(0, 6000);

      chrome.storage.local.get("resumeText", async data => {
        const resume = (data.resumeText || "").slice(0, 6000);

        if (!resume.trim()) {
          chrome.runtime.sendMessage({ type: "RESULT", text: "Match: 0%\nDecision: Invalid Domain\nMissing Skills:\n- Upload resume first" });
          return;
        }

        const result = await analyze(jd, resume);
        chrome.runtime.sendMessage({ type: "RESULT", text: result });
      });
    });
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

CRITICAL RULE:
You MUST determine Job Domain strictly from the Job Title provided in Job Description section.
If Job Title is missing, state Job Domain as "Unknown".

Do NOT infer Job Domain from resume.

Scoring Rules:
- Domain mismatch → Match must be below 35%
- Senior role without leadership/system design → penalize heavily
- Missing core job skills → reduce score significantly

Return output ONLY in the following format.

Match: <exact number>%

Decision: Apply / Improve / Invalid Domain

Domain Identity Score:
Resume Domain: <detected role>
Job Domain: <job role from job title>
Alignment: <exact number>%

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
