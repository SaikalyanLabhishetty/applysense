function getJD() {
  const titleSelectors = [
    ".jobs-unified-top-card__job-title",
    "h1",
    ".job-title",
    "[data-job-title]"
  ];

  let title = "";
  for (const s of titleSelectors) {
    const el = document.querySelector(s);
    if (el && el.innerText.trim()) {
      title = el.innerText.trim();
      break;
    }
  }

  const bodySelectors = [
    ".jobs-description__content",
    ".show-more-less-html__markup",
    "article"
  ];

  let description = "";
  for (const s of bodySelectors) {
    const el = document.querySelector(s);
    if (el && el.innerText.length > 200) {
      description = el.innerText.trim();
      break;
    }
  }

  if (!description) {
    description = document.body.innerText.slice(0, 8000);
  }

  return `Job Title: ${title}\n\nJob Description:\n${description}`;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_JD") {
    sendResponse({ jd: getJD() });
  }
});
