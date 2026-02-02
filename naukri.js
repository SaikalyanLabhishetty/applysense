function getNaukriJD() {
    // Naukri Job Title Selectors
    const titleSelectors = [
        ".jd-header-title",
        ".job-title",
        "h1.jd-header-title",
        "h1"
    ];

    let title = "";
    for (const s of titleSelectors) {
        const el = document.querySelector(s);
        if (el && el.innerText && el.innerText.trim()) {
            title = el.innerText.trim();
            break;
        }
    }

    // Naukri Job Description Selectors
    const bodySelectors = [
        ".dang-inner-html",
        ".job-desc",
        ".job-description",
        ".description"
    ];

    let description = "";
    for (const s of bodySelectors) {
        const el = document.querySelector(s);
        if (el && el.innerText && el.innerText.length > 200) {
            description = el.innerText.trim();
            break;
        }
    }

    // Fallback
    if (!description || description.length < 200) {
        // Try getting text from the main container if specific class fails
        const mainContainer = document.querySelector('.left-section') || document.body;
        description = mainContainer.innerText.slice(0, 8000);
    }

    const result = `Job Title: ${title}\n\nJob Description:\n${description}`;
    return result;
}


