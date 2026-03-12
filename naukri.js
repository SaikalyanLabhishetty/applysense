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

    // Extended selectors for current Naukri DOM — tried in order, no body fallback
    if (!description || description.length < 200) {
        const extendedSelectors = [
            "[class*='job-desc']",
            "[class*='jobDescription']",
            "[class*='jd-desc']",
            "[class*='description']",
            ".styles_job-desc-container__txpYf",
            ".styles_jhc__jd-desc__R2lpb",
            "[class*='jhc__jd']",
            ".jd-container",
            ".jd-inner",
            "section[class*='detail']"
        ];
        for (const s of extendedSelectors) {
            try {
                const el = document.querySelector(s);
                if (el && el.innerText && el.innerText.length > 200) {
                    description = el.innerText.trim();
                    break;
                }
            } catch (_) {}
        }
    }

    // If still no JD found, return empty — do NOT fall back to document.body
    // (body fallback can capture extension-injected content like the resume modal)
    if (!description || description.length < 200) {
        return "";
    }

    const result = `Job Title: ${title}\n\nJob Description:\n${description}`;
    return result;
}


