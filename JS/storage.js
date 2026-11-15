(function () {
  'use strict';

  var TOPICS_KEY = 'nursenote.topics.v1';
  var SETTINGS_KEY = 'nursenote.settings.v1';

  var DEFAULT_SETTINGS = {
    provider: 'gemini',
    apiKey: '',
    model: '',
    baseUrl: ''
  };

  function safeParse(raw) {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  function normalizeTopic(t) {
    if (!t || typeof t.id !== 'string' || typeof t.title !== 'string') return null;
    return {
      id: t.id,
      title: t.title.slice(0, 200),
      course: typeof t.course === 'string' ? t.course.slice(0, 80) : '',
      sourceText: typeof t.sourceText === 'string' ? t.sourceText : '',
      summary: typeof t.summary === 'string' ? t.summary : '',
      keyPoints: Array.isArray(t.keyPoints) ? t.keyPoints.filter(function (k) { return typeof k === 'string'; }) : [],
      createdAt: typeof t.createdAt === 'number' ? t.createdAt : Date.now(),
      updatedAt: typeof t.updatedAt === 'number' ? t.updatedAt : Date.now()
    };
  }

  var Store = {
    loadTopics: function () {
      var data = safeParse(localStorage.getItem(TOPICS_KEY));
      if (!Array.isArray(data)) return [];
      return data.map(normalizeTopic).filter(Boolean);
    },

    saveTopics: function (topics) {
      localStorage.setItem(TOPICS_KEY, JSON.stringify(topics));
    },

    loadSettings: function () {
      var data = safeParse(localStorage.getItem(SETTINGS_KEY));
      var merged = Object.assign({}, DEFAULT_SETTINGS, data && typeof data === 'object' ? data : {});
      if (merged.provider !== 'gemini' && merged.provider !== 'openai') merged.provider = 'gemini';
      return merged;
    },

    saveSettings: function (settings) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    },

    clearAll: function () {
      localStorage.removeItem(TOPICS_KEY);
      localStorage.removeItem(SETTINGS_KEY);
    },

    bytesUsed: function () {
      var total = 0;
      [TOPICS_KEY, SETTINGS_KEY].forEach(function (key) {
        var value = localStorage.getItem(key);
        if (value) total += key.length + value.length;
      });
      return total;
    },

    exportTopics: function (topics) {
      var payload = {
        app: 'NurseNote',
        version: 1,
        exportedAt: new Date().toISOString(),
        topics: topics
      };
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      var stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = 'nursenote-backup-' + stamp + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    },

    uid: uid
  };

  window.Store = Store;
})();
