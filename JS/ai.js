(function () {
  'use strict';

  var MAX_SOURCE_CHARS = 30000;
  var REQUEST_TIMEOUT_MS = 90000;

  var DEFAULT_MODELS = {
    gemini: 'gemini-2.5-flash',
    openai: 'gpt-4o-mini'
  };

  var SYSTEM_PROMPT = [
    'You are a study assistant for nursing students. Turn the provided lecture material into exam-ready revision notes.',
    '',
    'Rules:',
    '- Summarize only facts present in the source. Never invent details, doses, or values.',
    '- Write for quick revision: specific, plain language, no filler or motivational talk.',
    '- Keep essential medical terminology as used in the source.',
    '- If the source contains normal ranges, red flags, contraindications, or nursing interventions, make sure they appear in the key points.',
    '- Summary: 120-220 words in one or two short paragraphs.',
    '- Key points: 5-8 items, each one complete sentence about a testable fact.',
    '',
    'Return JSON only, no markdown fences, in this exact shape:',
    '{"summary": "string", "keyPoints": ["string", "string"]}'
  ].join('\n');

  function defaultModel(provider) {
    return DEFAULT_MODELS[provider] || DEFAULT_MODELS.gemini;
  }

  function buildUserPrompt(title, text) {
    return 'Topic: ' + (title && title.trim() ? title.trim() : 'Untitled topic') + '\n\nSource material:\n' + text;
  }

  function cleanJsonText(raw) {
    var text = String(raw || '').trim();
    var fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) text = fence[1].trim();
    var start = text.indexOf('{');
    var end = text.lastIndexOf('}');
    if (start !== -1 && end > start) text = text.slice(start, end + 1);
    return text;
  }

  function parseResult(raw) {
    var text = cleanJsonText(raw);
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('The AI response was not valid JSON. Try generating again.');
    }

    var summary = typeof data.summary === 'string' ? data.summary.trim() : '';
    var keyPoints = Array.isArray(data.keyPoints)
      ? data.keyPoints
          .filter(function (k) { return typeof k === 'string'; })
          .map(function (k) { return k.trim(); })
          .filter(Boolean)
          .slice(0, 12)
      : [];

    if (!summary && !keyPoints.length) {
      throw new Error('The AI response was empty. Try generating again.');
    }
    return { summary: summary, keyPoints: keyPoints };
  }

  function friendlyHttpError(status, serverMessage) {
    var msg = String(serverMessage || '');
    if (status === 400 && /api key not valid|invalid api key|incorrect api key/i.test(msg)) {
      return new Error('That API key was rejected. Check it in Settings.');
    }
    if (status === 401 || status === 403) {
      return new Error('The API key was rejected or lacks access. Check it in Settings.');
    }
    if (status === 404) {
      return new Error('Model not found. Check the model name in Settings.');
    }
    if (status === 429) {
      return new Error('Rate limit or quota reached. Wait a moment, then try again.');
    }
    if (status >= 500) {
      return new Error('The AI service had a server error (HTTP ' + status + '). Try again shortly.');
    }
    var detail = msg ? ' — ' + msg.slice(0, 180) : '';
    return new Error('AI request failed (HTTP ' + status + ')' + detail);
  }

  async function readErrorDetail(response) {
    try {
      var body = await response.json();
      return body && body.error && body.error.message ? body.error.message : '';
    } catch (e) {
      return '';
    }
  }

  async function callGemini(settings, title, text, signal) {
    var model = (settings.model || '').trim() || defaultModel('gemini');
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(settings.apiKey);

    var generationConfig = {
      temperature: 0.3,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          summary: { type: 'STRING' },
          keyPoints: { type: 'ARRAY', items: { type: 'STRING' } }
        },
        required: ['summary', 'keyPoints']
      }
    };

    // 2.5 Flash enables thinking by default; disabling it keeps drafts fast.
    if (/gemini-2\.5-flash/.test(model)) {
      generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }

    var response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: buildUserPrompt(title, text) }] }],
        generationConfig: generationConfig
      })
    });

    if (!response.ok) {
      throw friendlyHttpError(response.status, await readErrorDetail(response));
    }

    var data = await response.json();
    var candidate = data.candidates && data.candidates[0];
    var parts = candidate && candidate.content && candidate.content.parts;
    var raw = parts
      ? parts.filter(function (p) { return !p.thought; }).map(function (p) { return p.text || ''; }).join('')
      : '';

    if (!raw.trim()) {
      var blockReason = data.promptFeedback && data.promptFeedback.blockReason;
      throw new Error(blockReason
        ? 'The AI declined to summarize this content (' + String(blockReason).toLowerCase().replace(/_/g, ' ') + ').'
        : 'The AI returned an empty response. Try again.');
    }

    return parseResult(raw);
  }

  function chatCompletionsUrl(baseUrl) {
    var base = String(baseUrl || '').trim().replace(/\/+$/, '') || 'https://api.openai.com/v1';
    if (/\/chat\/completions$/.test(base)) return base;
    return base + '/chat/completions';
  }

  function messageContentToText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map(function (part) { return typeof part.text === 'string' ? part.text : ''; }).join('');
    }
    return '';
  }

  async function callOpenAICompatible(settings, title, text, signal) {
    var model = (settings.model || '').trim() || defaultModel('openai');
    var url = chatCompletionsUrl(settings.baseUrl);

    var response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + settings.apiKey
      },
      signal: signal,
      body: JSON.stringify({
        model: model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(title, text) }
        ]
      })
    });

    if (!response.ok) {
      throw friendlyHttpError(response.status, await readErrorDetail(response));
    }

    var data = await response.json();
    var message = data.choices && data.choices[0] && data.choices[0].message;
    var raw = message ? messageContentToText(message.content) : '';
    if (!raw.trim()) {
      throw new Error('The AI returned an empty response. Try again.');
    }
    return parseResult(raw);
  }

  async function summarize(options) {
    var settings = options.settings || {};
    var text = String(options.text || '').trim();
    var title = String(options.title || '');

    if (!settings.apiKey || !String(settings.apiKey).trim()) {
      throw new Error('Add an API key in Settings first.');
    }
    if (!text) {
      throw new Error('Paste some notes first.');
    }

    text = text.slice(0, MAX_SOURCE_CHARS);

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);

    try {
      if (settings.provider === 'openai') {
        return await callOpenAICompatible(settings, title, text, controller.signal);
      }
      return await callGemini(settings, title, text, controller.signal);
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw new Error('The AI request timed out after 90 seconds. Try again.');
      }
      if (err instanceof TypeError) {
        throw new Error('Could not reach the AI service. Check your internet connection and the API settings.');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  window.AI = {
    summarize: summarize,
    defaultModel: defaultModel,
    MAX_SOURCE_CHARS: MAX_SOURCE_CHARS
  };
})();
