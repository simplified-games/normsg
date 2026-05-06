// netlify/functions/normai-pro.js
// Pro-tier NorMAI proxy
// Set GROQ_API_KEY_PRO in Netlify → Site settings → Environment variables

const GROQ_API_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL_PRO = 'llama-3.3-70b-versatile';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  try {
    const { prompt, context } = JSON.parse(event.body || '{}');
    if (!prompt) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing prompt' }) };
    }

    const messages = [];
    if (context) {
      messages.push({ role: 'user', content: prompt });
      messages.push({ role: 'user', content: context });
    } else {
      messages.push({ role: 'user', content: prompt });
    }

    const groqRes = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY_PRO}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL_PRO,
        messages,
        max_tokens: 1024,
        temperature: 0.75,
      }),
    });

    if (!groqRes.ok) {
      const err = await groqRes.json().catch(() => ({}));
      return { statusCode: groqRes.status, headers, body: JSON.stringify({ error: err }) };
    }

    const data  = await groqRes.json();
    const reply = data.choices?.[0]?.message?.content ?? '';

    return { statusCode: 200, headers, body: JSON.stringify({ reply }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
