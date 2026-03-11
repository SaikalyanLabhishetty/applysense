export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { model, messages, systemInstruction, contents, response_format, generationConfig } = req.body;

    // Handle Gemini Models
    if (model && (model.startsWith('gemini') || model.includes('gemini'))) {
        const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
        if (!GEMINI_API_KEY) {
            return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
        }

        const geminiModel = model.includes(':') ? model : `models/${model}:generateContent`;
        const url = `https://generativelanguage.googleapis.com/v1beta/${geminiModel}?key=${GEMINI_API_KEY}`;

        let geminiBody = {};

        // If the request is already in Gemini format
        if (contents) {
            geminiBody = { systemInstruction, contents };
            geminiBody.generationConfig = { ...(generationConfig || {}) };
            if (response_format?.type === 'json_object') {
                geminiBody.generationConfig.responseMimeType = 'application/json';
            }
        } else if (messages) {
            // Convert OpenAI/Groq format to Gemini format
            const systemMessage = messages.find(m => m.role === 'system');
            const userMessages = messages.filter(m => m.role !== 'system');

            if (systemMessage) {
                geminiBody.systemInstruction = { parts: [{ text: systemMessage.content }] };
            }

            geminiBody.contents = userMessages.map(m => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }]
            }));

            if (response_format?.type === 'json_object') {
                geminiBody.generationConfig = { responseMimeType: 'application/json' };
            }
        }

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(geminiBody),
            });

            const data = await response.json();

            // Transform Gemini response back to OpenAI-like format for legacy compatibility if needed
            // But for now, let's just return what Gemini gives if we are using Gemini call.
            // If we want compatibility with current background.js:
            if (!contents && messages && data.candidates?.[0]?.content?.parts?.[0]?.text) {
                const text = data.candidates[0].content.parts[0].text;
                return res.status(200).json({
                    choices: [{ message: { content: text } }]
                });
            }

            return res.status(response.status).json(data);
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    // Default to Groq
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    if (!GROQ_API_KEY) {
        return res.status(500).json({ error: 'GROQ_API_KEY not configured on server' });
    }

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(req.body),
        });

        const data = await response.json();
        return res.status(response.status).json(data);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

