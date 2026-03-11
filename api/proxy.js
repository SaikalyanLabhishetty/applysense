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
    const jsonRequested = response_format?.type === 'json_object' || generationConfig?.responseMimeType === 'application/json';

    const getTextFromParts = (parts = []) => {
        return parts
            .map((part) => (typeof part?.text === 'string' ? part.text : ''))
            .filter(Boolean)
            .join('\n')
            .trim();
    };

    const toOpenAIMessages = () => {
        if (Array.isArray(messages) && messages.length) {
            return messages;
        }

        const mapped = [];
        const systemText = getTextFromParts(systemInstruction?.parts || []);
        if (systemText) {
            mapped.push({ role: 'system', content: systemText });
        }

        if (Array.isArray(contents)) {
            for (const content of contents) {
                const role = content?.role === 'model' ? 'assistant' : 'user';
                const text = getTextFromParts(content?.parts || []);
                if (text) {
                    mapped.push({ role, content: text });
                }
            }
        }

        return mapped;
    };

    const callMistral = async () => {
        const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
        if (!MISTRAL_API_KEY) {
            return { status: 500, data: { error: 'MISTRAL_API_KEY not configured on server' } };
        }

        const mistralMessages = toOpenAIMessages();
        if (!mistralMessages.length) {
            return { status: 400, data: { error: 'No valid messages to send to Mistral' } };
        }

        const mistralModel = model && model.includes('mistral') ? model : 'open-mistral-nemo';
        const mistralBody = {
            model: mistralModel,
            messages: mistralMessages,
            temperature: generationConfig?.temperature,
        };

        if (jsonRequested) {
            mistralBody.response_format = { type: 'json_object' };
        }

        const mistralResponse = await fetch('https://api.mistral.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${MISTRAL_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(mistralBody),
        });

        const mistralData = await mistralResponse.json();
        return { status: mistralResponse.status, data: mistralData, model: mistralModel };
    };

    // Handle Gemini Models
    if (model && (model.startsWith('gemini') || model.includes('gemini'))) {
        const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
        if (!GEMINI_API_KEY) {
            const mistralResult = await callMistral();
            const text = mistralResult.data?.choices?.[0]?.message?.content || '';
            const mistralSucceeded = mistralResult.status >= 200 && mistralResult.status < 300;
            if (contents) {
                if (mistralSucceeded && text) {
                    return res.status(mistralResult.status).json({
                        candidates: [{ content: { parts: [{ text }] } }],
                        fallbackProvider: 'mistral',
                        fallbackModel: mistralResult.model,
                    });
                }
                return res.status(mistralResult.status).json(mistralResult.data);
            }
            return res.status(mistralResult.status).json(mistralResult.data);
        }

        const geminiModel = model.includes(':') ? model : `models/${model}:generateContent`;
        const url = `https://generativelanguage.googleapis.com/v1beta/${geminiModel}?key=${GEMINI_API_KEY}`;

        let geminiBody = {};

        // If the request is already in Gemini format
        if (contents) {
            geminiBody = { systemInstruction, contents };
            geminiBody.generationConfig = { ...(generationConfig || {}) };
            if (jsonRequested) {
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

            if (jsonRequested) {
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

            const quotaExceeded =
                response.status === 429 ||
                data?.error?.status === 'RESOURCE_EXHAUSTED' ||
                /quota|rate\s*limit|resource_exhausted/i.test(data?.error?.message || '');

            if (!response.ok && quotaExceeded) {
                const mistralResult = await callMistral();
                const text = mistralResult.data?.choices?.[0]?.message?.content || '';
                const mistralSucceeded = mistralResult.status >= 200 && mistralResult.status < 300;

                if (contents) {
                    if (mistralSucceeded && text) {
                        return res.status(mistralResult.status).json({
                            candidates: [{ content: { parts: [{ text }] } }],
                            fallbackProvider: 'mistral',
                            fallbackModel: mistralResult.model,
                        });
                    }
                    return res.status(mistralResult.status).json(mistralResult.data);
                }

                return res.status(mistralResult.status).json(mistralResult.data);
            }

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

    try {
        const mistralResult = await callMistral();
        return res.status(mistralResult.status).json(mistralResult.data);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

