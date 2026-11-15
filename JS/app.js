(function () {
  'use strict';

  var Store = window.Store;
  var AI = window.AI;

  var ICONS = {
    copy: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    trash: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>',
    list: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>'
  };

  var state = {
    topics: Store.loadTopics(),
    settings: Store.loadSettings(),
    query: '',
    course: null,
    editingId: null,
    generating: false,
    genToken: 0,
    bannerDismissed: false,
    deleteArmedId: null,
    deleteArmTimer: null,
    replaceArmedUntil: 0,
    lastEditorFocus: null,
    lastSettingsFocus: null,
    editorSnapshot: null
  };

  var els = {};
  var settingsProvider = 'gemini';
  var genStatusTimer = null;
  var replaceLabelTimer = null;
  var editorDeleteArmed = false;
  var editorDeleteTimer = null;
  var clearArmedTimer = null;
  var clearArmed = false;

  init();

  function init() {
    cacheEls();
    bindEvents();
    updateBanner();
    updateKeyHints();
    renderAll();
  }

  function cacheEls() {
    var ids = [
      'sidebar', 'scrim', 'search-input', 'btn-new', 'btn-menu', 'btn-settings', 'btn-export',
      'course-nav', 'count-all', 'storage-note', 'nav-all', 'page-title', 'page-sub',
      'topics-grid', 'empty-state', 'empty-title', 'empty-text', 'empty-new', 'empty-clear-search',
      'setup-banner', 'banner-settings', 'banner-dismiss',
      'editor-overlay', 'editor-eyebrow', 'editor-title', 'editor-course', 'course-options',
      'editor-source', 'char-count', 'char-hint', 'btn-generate', 'generate-label', 'gen-status',
      'key-hint', 'editor-open-settings', 'editor-summary', 'editor-keypoints', 'editor-close',
      'editor-cancel', 'editor-save', 'btn-delete-topic', 'btn-copy-draft',
      'settings-overlay', 'settings-close', 'settings-cancel', 'settings-save', 'settings-key',
      'settings-model', 'settings-base-url', 'base-url-field', 'model-help', 'toggle-key',
      'settings-export', 'settings-clear', 'toasts'
    ];
    ids.forEach(function (id) {
      var key = id.replace(/-([a-z])/g, function (m, c) { return c.toUpperCase(); });
      els[key] = document.getElementById(id);
    });
    els.emptySteps = document.querySelector('.empty-steps');
    els.segBtns = Array.prototype.slice.call(document.querySelectorAll('.seg-btn'));
  }

  function bindEvents() {
    els.searchInput.addEventListener('input', function () {
      state.query = els.searchInput.value;
      renderGrid();
    });

    els.btnNew.addEventListener('click', function () { openEditor(null); });
    els.emptyNew.addEventListener('click', function () { openEditor(null); });
    els.emptyClearSearch.addEventListener('click', function () {
      if (state.query.trim()) {
        state.query = '';
        els.searchInput.value = '';
      } else {
        state.course = null;
      }
      renderAll();
      els.searchInput.focus();
    });

    els.btnMenu.addEventListener('click', openSidebar);
    els.scrim.addEventListener('click', closeSidebar);
    els.navAll.addEventListener('click', function () {
      state.course = null;
      renderAll();
      maybeCloseSidebar();
    });

    els.courseNav.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-course]');
      if (!btn) return;
      state.course = btn.getAttribute('data-course');
      renderAll();
      maybeCloseSidebar();
    });

    els.topicsGrid.addEventListener('click', function (e) {
      var card = e.target.closest('.card[data-id]');
      if (!card) return;
      var actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        handleCardAction(actionBtn.getAttribute('data-action'), card.getAttribute('data-id'));
        return;
      }
      openEditor(card.getAttribute('data-id'));
    });

    els.topicsGrid.addEventListener('keydown', function (e) {
      var card = e.target.closest && e.target.closest('.card[data-id]');
      if (!card) return;
      if (e.key === 'Enter' || e.key === ' ') {
        if (e.target.closest('[data-action]')) return;
        e.preventDefault();
        openEditor(card.getAttribute('data-id'));
      }
    });

    els.btnSettings.addEventListener('click', openSettings);
    els.bannerSettings.addEventListener('click', openSettings);
    els.editorOpenSettings.addEventListener('click', openSettings);
    els.btnExport.addEventListener('click', exportBackup);
    els.settingsExport.addEventListener('click', exportBackup);
    els.bannerDismiss.addEventListener('click', function () {
      state.bannerDismissed = true;
      updateBanner();
    });

    bindEditor();
    bindSettings();

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!els.settingsOverlay.hidden) { closeSettings(); return; }
        if (!els.editorOverlay.hidden) { requestCloseEditor(); return; }
        closeSidebar();
        return;
      }
      if (e.key === '/' && !isTypingTarget(e.target) && !anyOverlayOpen()) {
        e.preventDefault();
        els.searchInput.focus();
      }
    });
  }

  function bindEditor() {
    els.editorOverlay.addEventListener('click', function (e) {
      if (e.target === els.editorOverlay) requestCloseEditor();
    });
    els.editorOverlay.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        generate();
      }
    });

    els.editorClose.addEventListener('click', requestCloseEditor);
    els.editorCancel.addEventListener('click', requestCloseEditor);
    els.editorSave.addEventListener('click', saveTopic);
    els.btnGenerate.addEventListener('click', generate);
    els.btnCopyDraft.addEventListener('click', copyDraft);
    els.editorSource.addEventListener('input', updateCharCount);
    els.btnDeleteTopic.addEventListener('click', handleEditorDelete);
  }

  function bindSettings() {
    els.settingsOverlay.addEventListener('click', function (e) {
      if (e.target === els.settingsOverlay) closeSettings();
    });
    els.settingsClose.addEventListener('click', closeSettings);
    els.settingsCancel.addEventListener('click', closeSettings);
    els.settingsSave.addEventListener('click', saveSettings);

    els.segBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        setSettingsProvider(btn.getAttribute('data-provider'));
      });
    });

    els.toggleKey.addEventListener('click', function () {
      var isPassword = els.settingsKey.type === 'password';
      els.settingsKey.type = isPassword ? 'text' : 'password';
      els.toggleKey.setAttribute('aria-label', isPassword ? 'Hide API key' : 'Show API key');
      els.settingsKey.focus();
    });

    els.settingsClear.addEventListener('click', handleClearAll);
  }

  /* ---------- Rendering ---------- */

  function renderAll() {
    renderSidebar();
    renderGrid();
    updateStorageNote();
  }

  function renderSidebar() {
    els.countAll.textContent = String(state.topics.length);
    els.navAll.classList.toggle('active', !state.course);
    els.pageTitle.textContent = state.course || 'All topics';

    var counts = {};
    state.topics.forEach(function (t) {
      var course = (t.course || '').trim();
      if (!course) return;
      counts[course] = (counts[course] || 0) + 1;
    });

    var courses = Object.keys(counts).sort(function (a, b) { return a.localeCompare(b); });
    if (state.course && courses.indexOf(state.course) === -1) state.course = null;

    if (!courses.length) {
      els.courseNav.innerHTML = '<div class="side-empty">Courses appear here as you tag topics.</div>';
      return;
    }

    els.courseNav.innerHTML = courses.map(function (course) {
      var active = state.course === course ? ' active' : '';
      return '<button class="side-item' + active + '" type="button" data-course="' + esc(course) + '">' +
        '<span class="course-dot"></span>' +
        '<span>' + esc(course) + '</span>' +
        '<span class="side-count">' + counts[course] + '</span>' +
        '</button>';
    }).join('');
  }

  function renderGrid() {
    var list = visibleTopics();
    var searching = Boolean(state.query.trim());

    els.pageTitle.textContent = state.course || 'All topics';
    els.pageSub.textContent = list.length + (list.length === 1 ? ' summary' : ' summaries') +
      (searching ? ' matching your search' : '');

    if (list.length) {
      els.topicsGrid.innerHTML = list.map(cardHtml).join('');
      els.topicsGrid.hidden = false;
      els.emptyState.hidden = true;
      return;
    }

    els.topicsGrid.innerHTML = '';
    els.topicsGrid.hidden = true;
    els.emptyState.hidden = false;
    els.emptySteps.hidden = true;
    els.emptyClearSearch.hidden = true;
    els.emptyNew.hidden = false;

    if (!state.topics.length) {
      els.emptyTitle.textContent = 'No topics yet';
      els.emptyText.textContent = 'Paste your lecture notes, generate a summary, and keep the key points ready for exam day.';
      els.emptySteps.hidden = false;
    } else if (searching) {
      els.emptyTitle.textContent = 'No matches';
      els.emptyText.textContent = 'Nothing matches \u201c' + state.query.trim() + '\u201d. Try different words, or clear the search.';
      els.emptyClearSearch.hidden = false;
      els.emptyClearSearch.textContent = 'Clear search';
    } else {
      els.emptyTitle.textContent = 'Nothing in this course yet';
      els.emptyText.textContent = 'No summaries tagged \u201c' + state.course + '\u201d yet. Create one, or switch back to all topics.';
      els.emptyClearSearch.hidden = false;
      els.emptyClearSearch.textContent = 'Show all topics';
    }
  }

  function visibleTopics() {
    var q = state.query.trim().toLowerCase();
    return state.topics.filter(function (t) {
      if (state.course && (t.course || '').trim() !== state.course) return false;
      if (!q) return true;
      var haystack = [t.title, t.course, t.summary, t.keyPoints.join(' '), t.sourceText].join('\n').toLowerCase();
      return haystack.indexOf(q) !== -1;
    }).sort(function (a, b) { return b.updatedAt - a.updatedAt; });
  }

  function cardHtml(t) {
    var course = (t.course || '').trim();
    var preview = t.summary
      ? t.summary
      : t.keyPoints.slice(0, 2).map(function (k) { return '\u2022 ' + k; }).join(' ');
    if (!preview) preview = 'No summary yet \u2014 open to add one.';

    var armed = state.deleteArmedId === t.id;
    var kpLabel = t.keyPoints.length + (t.keyPoints.length === 1 ? ' key point' : ' key points');

    return '<article class="card" data-id="' + esc(t.id) + '" tabindex="0" role="button" aria-label="Open ' + esc(t.title) + '">' +
      '<div class="card-top">' +
        (course ? '<span class="chip" title="' + esc(course) + '">' + esc(course) + '</span>' : '<span></span>') +
        '<span class="card-time" title="' + esc(fullDate(t.updatedAt)) + '">' + esc(relTime(t.updatedAt)) + '</span>' +
      '</div>' +
      '<h3 class="card-title' + (course ? '' : ' no-course') + '">' + esc(t.title) + '</h3>' +
      '<p class="card-summary">' + esc(preview) + '</p>' +
      '<div class="card-foot">' +
        '<span class="kp-count">' + ICONS.list + esc(kpLabel) + '</span>' +
        '<div class="card-actions">' +
          '<button class="icon-btn" type="button" data-action="copy" title="Copy study notes" aria-label="Copy study notes">' + ICONS.copy + '</button>' +
          '<button class="icon-btn danger' + (armed ? ' armed' : '') + '" type="button" data-action="delete" title="Delete topic" aria-label="Delete topic">' +
            (armed ? 'Sure?' : ICONS.trash) +
          '</button>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function updateStorageNote() {
    els.storageNote.textContent = 'Local data \u00b7 ' + formatBytes(Store.bytesUsed());
  }

  function updateBanner() {
    var hasKey = Boolean(String(state.settings.apiKey || '').trim());
    els.setupBanner.hidden = hasKey || state.bannerDismissed;
  }

  function updateKeyHints() {
    var hasKey = Boolean(String(state.settings.apiKey || '').trim());
    els.keyHint.hidden = hasKey;
  }

  /* ---------- Card actions ---------- */

  function handleCardAction(action, id) {
    var topic = state.topics.find(function (t) { return t.id === id; });
    if (!topic) return;

    if (action === 'copy') {
      copyText(formatTopic(topic));
      return;
    }

    if (action === 'delete') {
      if (state.deleteArmedId === id) {
        deleteTopic(id);
        return;
      }
      state.deleteArmedId = id;
      clearTimeout(state.deleteArmTimer);
      state.deleteArmTimer = setTimeout(function () {
        state.deleteArmedId = null;
        renderGrid();
      }, 3000);
      renderGrid();
    }
  }

  function deleteTopic(id) {
    var next = state.topics.filter(function (t) { return t.id !== id; });
    try {
      Store.saveTopics(next);
    } catch (e) {
      toast('Could not save changes \u2014 browser storage is full.', 'error');
      return;
    }
    state.topics = next;
    state.deleteArmedId = null;
    clearTimeout(state.deleteArmTimer);
    renderAll();
    toast('Topic deleted.');
  }

  /* ---------- Editor ---------- */

  function openEditor(id) {
    var topic = id ? state.topics.find(function (t) { return t.id === id; }) : null;
    state.editingId = topic ? topic.id : null;
    state.lastEditorFocus = document.activeElement;
    state.replaceArmedUntil = 0;
    resetEditorDelete();
    resetGenerateButton();

    els.editorEyebrow.textContent = topic ? 'Edit topic' : 'New topic';
    els.editorTitle.value = topic ? topic.title : '';
    els.editorCourse.value = topic ? (topic.course || '') : (state.course || '');
    els.editorSource.value = topic ? topic.sourceText : '';
    els.editorSummary.value = topic ? topic.summary : '';
    els.editorKeypoints.value = topic ? topic.keyPoints.join('\n') : '';
    els.btnDeleteTopic.hidden = !topic;

    refreshCourseOptions();
    updateCharCount();
    updateKeyHints();
    setGenStatus('');

    state.editorSnapshot = {
      title: els.editorTitle.value,
      course: els.editorCourse.value,
      source: els.editorSource.value,
      summary: els.editorSummary.value,
      keypoints: els.editorKeypoints.value
    };

    els.editorOverlay.hidden = false;
    syncModalClass();
    closeSidebar();
    els.editorTitle.focus();
  }

  function isEditorDirty() {
    var snap = state.editorSnapshot;
    if (!snap || els.editorOverlay.hidden) return false;
    return els.editorTitle.value !== snap.title ||
      els.editorCourse.value !== snap.course ||
      els.editorSource.value !== snap.source ||
      els.editorSummary.value !== snap.summary ||
      els.editorKeypoints.value !== snap.keypoints;
  }

  function requestCloseEditor() {
    if (isEditorDirty() && !window.confirm('Discard unsaved changes?')) return;
    closeEditor();
  }

  function closeEditor() {
    state.genToken++;
    state.generating = false;
    setGenerateBusy(false);
    state.replaceArmedUntil = 0;
    resetEditorDelete();
    els.editorOverlay.hidden = true;
    syncModalClass();
    if (state.lastEditorFocus && document.contains(state.lastEditorFocus)) {
      state.lastEditorFocus.focus();
    }
    state.lastEditorFocus = null;
    state.editingId = null;
  }

  function refreshCourseOptions() {
    var seen = {};
    var courses = [];
    state.topics.forEach(function (t) {
      var course = (t.course || '').trim();
      if (course && !seen[course]) {
        seen[course] = true;
        courses.push(course);
      }
    });
    courses.sort(function (a, b) { return a.localeCompare(b); });
    els.courseOptions.innerHTML = courses.map(function (course) {
      return '<option value="' + esc(course) + '"></option>';
    }).join('');
  }

  function updateCharCount() {
    var chars = els.editorSource.value.length;
    els.charCount.textContent = chars.toLocaleString() + (chars === 1 ? ' character' : ' characters');
    var tooLong = chars > AI.MAX_SOURCE_CHARS;
    els.charHint.hidden = !tooLong;
    els.charHint.textContent = tooLong
      ? 'Long notes are trimmed to the first ' + AI.MAX_SOURCE_CHARS.toLocaleString() + ' characters.'
      : '';
  }

  async function generate() {
    if (state.generating) return;

    var source = els.editorSource.value.trim();
    if (!source) {
      toast('Paste your notes first.', 'warn');
      els.editorSource.focus();
      return;
    }

    if (!String(state.settings.apiKey || '').trim()) {
      toast('Add your API key in Settings to generate summaries.', 'warn');
      openSettings();
      return;
    }

    var hasDraft = Boolean(els.editorSummary.value.trim() || els.editorKeypoints.value.trim());
    if (hasDraft && Date.now() > state.replaceArmedUntil) {
      state.replaceArmedUntil = Date.now() + 4000;
      els.generateLabel.textContent = 'Replace existing draft?';
      clearTimeout(replaceLabelTimer);
      replaceLabelTimer = setTimeout(function () {
        if (!state.generating) els.generateLabel.textContent = 'Generate summary';
      }, 4000);
      return;
    }

    state.replaceArmedUntil = 0;
    state.generating = true;
    var token = ++state.genToken;

    setGenerateBusy(true);
    try {
      var result = await AI.summarize({
        settings: state.settings,
        title: els.editorTitle.value,
        text: source
      });
      if (token !== state.genToken) return;
      els.editorSummary.value = result.summary;
      els.editorKeypoints.value = result.keyPoints.join('\n');
      toast('Draft ready \u2014 review and save.', 'success');
    } catch (err) {
      if (token !== state.genToken) return;
      toast(err && err.message ? err.message : 'Generation failed. Try again.', 'error');
    } finally {
      if (token === state.genToken) {
        state.generating = false;
        setGenerateBusy(false);
      }
    }
  }

  function setGenerateBusy(busy) {
    els.btnGenerate.disabled = busy;
    els.generateLabel.textContent = busy ? 'Summarizing\u2026' : 'Generate summary';
    if (busy) {
      setGenStatus('Contacting ' + (state.settings.provider === 'gemini' ? 'Gemini' : 'the AI service') + '\u2026');
      clearTimeout(genStatusTimer);
      genStatusTimer = setTimeout(function () {
        if (state.generating) setGenStatus('Writing your draft\u2026');
      }, 1800);
    } else {
      clearTimeout(genStatusTimer);
      setGenStatus('');
    }
  }

  function setGenStatus(text) {
    if (!text) {
      els.genStatus.innerHTML = '';
      return;
    }
    els.genStatus.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>' + esc(text) + '</span>';
  }

  function resetGenerateButton() {
    els.generateLabel.textContent = 'Generate summary';
    setGenerateBusy(false);
  }

  function saveTopic() {
    var title = els.editorTitle.value.trim() || deriveTitle();
    var summary = els.editorSummary.value.trim();
    var keyPoints = parseKeyPoints(els.editorKeypoints.value);
    var course = els.editorCourse.value.trim();

    if (!title) {
      toast('Add a topic title before saving.', 'warn');
      els.editorTitle.focus();
      return;
    }
    if (!summary && !keyPoints.length) {
      toast('Add a summary or key points before saving.', 'warn');
      els.editorSummary.focus();
      return;
    }

    var now = Date.now();
    var next = state.topics.slice();
    var editing = state.editingId;

    if (editing) {
      var index = next.findIndex(function (t) { return t.id === editing; });
      if (index === -1) {
        toast('That topic no longer exists.', 'error');
        closeEditor();
        renderAll();
        return;
      }
      next[index] = Object.assign({}, next[index], {
        title: title.slice(0, 200),
        course: course.slice(0, 80),
        sourceText: els.editorSource.value,
        summary: summary,
        keyPoints: keyPoints,
        updatedAt: now
      });
    } else {
      next.push({
        id: Store.uid(),
        title: title.slice(0, 200),
        course: course.slice(0, 80),
        sourceText: els.editorSource.value,
        summary: summary,
        keyPoints: keyPoints,
        createdAt: now,
        updatedAt: now
      });
    }

    try {
      Store.saveTopics(next);
    } catch (e) {
      toast('Could not save \u2014 browser storage is full. Export a backup and remove old topics.', 'error');
      return;
    }

    state.topics = next;
    closeEditor();
    renderAll();
    toast(editing ? 'Topic updated.' : 'Topic saved.');
  }

  function parseKeyPoints(raw) {
    return String(raw || '').split('\n')
      .map(function (line) {
        return line.replace(/^\s*(?:[-*\u2022\u2013]|\d+[.)])\s*/, '').trim();
      })
      .filter(Boolean)
      .slice(0, 20);
  }

  function deriveTitle() {
    var source = els.editorSource.value.trim();
    if (!source) return '';
    var firstLine = source.split('\n').map(function (l) { return l.trim(); }).find(Boolean) || '';
    return firstLine.slice(0, 60);
  }

  function copyDraft() {
    var title = els.editorTitle.value.trim() || 'Untitled topic';
    var draft = {
      title: title,
      course: els.editorCourse.value.trim(),
      summary: els.editorSummary.value.trim(),
      keyPoints: parseKeyPoints(els.editorKeypoints.value)
    };
    copyText(formatTopic(draft));
  }

  function handleEditorDelete() {
    if (!state.editingId) return;
    if (!editorDeleteArmed) {
      editorDeleteArmed = true;
      els.btnDeleteTopic.textContent = 'Click again to delete';
      clearTimeout(editorDeleteTimer);
      editorDeleteTimer = setTimeout(resetEditorDelete, 4000);
      return;
    }
    var id = state.editingId;
    var next = state.topics.filter(function (t) { return t.id !== id; });
    try {
      Store.saveTopics(next);
    } catch (e) {
      toast('Could not save changes \u2014 browser storage is full.', 'error');
      return;
    }
    state.topics = next;
    closeEditor();
    renderAll();
    toast('Topic deleted.');
  }

  function resetEditorDelete() {
    editorDeleteArmed = false;
    clearTimeout(editorDeleteTimer);
    els.btnDeleteTopic.innerHTML = ICONS.trash + 'Delete topic';
  }

  /* ---------- Settings ---------- */

  function openSettings() {
    state.lastSettingsFocus = document.activeElement;
    els.settingsKey.value = state.settings.apiKey || '';
    els.settingsModel.value = state.settings.model || '';
    els.settingsBaseUrl.value = state.settings.baseUrl || '';
    els.settingsKey.type = 'password';
    els.toggleKey.setAttribute('aria-label', 'Show API key');
    setSettingsProvider(state.settings.provider);
    resetClearButton();

    els.settingsOverlay.hidden = false;
    syncModalClass();
    els.settingsOverlay.querySelector('.modal-body').scrollTop = 0;
    els.settingsKey.focus({ preventScroll: true });
  }

  function closeSettings() {
    resetClearButton();
    els.settingsOverlay.hidden = true;
    syncModalClass();
    if (state.lastSettingsFocus && document.contains(state.lastSettingsFocus)) {
      state.lastSettingsFocus.focus();
    }
    state.lastSettingsFocus = null;
  }

  function setSettingsProvider(provider) {
    settingsProvider = provider === 'openai' ? 'openai' : 'gemini';
    els.segBtns.forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-provider') === settingsProvider);
    });
    var isOpenAI = settingsProvider === 'openai';
    els.baseUrlField.hidden = !isOpenAI;
    els.settingsModel.placeholder = AI.defaultModel(settingsProvider);
    els.modelHelp.textContent = 'Leave empty to use the default model (' + AI.defaultModel(settingsProvider) + ').';
    if (isOpenAI) {
      els.settingsBaseUrl.placeholder = 'https://api.openai.com/v1';
    }
  }

  function saveSettings() {
    var provider = settingsProvider;
    var key = els.settingsKey.value.trim();
    var model = els.settingsModel.value.trim();
    var baseUrl = els.settingsBaseUrl.value.trim();

    if (provider === 'openai' && baseUrl && !/^https?:\/\//i.test(baseUrl)) {
      toast('Base URL must start with http:// or https://.', 'error');
      els.settingsBaseUrl.focus();
      return;
    }

    state.settings = {
      provider: provider,
      apiKey: key,
      model: model,
      baseUrl: baseUrl
    };

    try {
      Store.saveSettings(state.settings);
    } catch (e) {
      toast('Could not save settings \u2014 browser storage is full.', 'error');
      return;
    }

    updateBanner();
    updateKeyHints();
    closeSettings();
    updateStorageNote();
    toast('Settings saved.');
  }

  function resetClearButton() {
    clearArmed = false;
    clearTimeout(clearArmedTimer);
    els.settingsClear.textContent = 'Clear all data';
  }

  function handleClearAll() {
    if (!clearArmed) {
      clearArmed = true;
      els.settingsClear.textContent = 'Click again to erase everything';
      clearTimeout(clearArmedTimer);
      clearArmedTimer = setTimeout(resetClearButton, 4000);
      return;
    }
    Store.clearAll();
    state.topics = [];
    state.settings = Store.loadSettings();
    state.query = '';
    state.course = null;
    els.searchInput.value = '';
    resetClearButton();
    closeSettings();
    updateBanner();
    updateKeyHints();
    renderAll();
    toast('All local data cleared.');
  }

  /* ---------- Utility ---------- */

  function exportBackup() {
    if (!state.topics.length) {
      toast('No topics to export yet.', 'warn');
      return;
    }
    Store.exportTopics(state.topics);
    toast('Backup downloaded.');
  }

  function formatTopic(t) {
    var parts = [t.title];
    if (t.course) parts.push('Course: ' + t.course);
    if (t.summary) parts.push('', t.summary);
    if (t.keyPoints && t.keyPoints.length) {
      parts.push('', 'Key points');
      t.keyPoints.forEach(function (k) { parts.push('- ' + k); });
    }
    return parts.join('\n').trim();
  }

  async function copyText(text) {
    if (!text || !text.trim()) {
      toast('Nothing to copy yet.', 'warn');
      return;
    }
    var copied = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch (e) {
      copied = false;
    }
    if (!copied) {
      try {
        var area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        copied = document.execCommand('copy');
        area.remove();
      } catch (e) {
        copied = false;
      }
    }
    if (copied) toast('Copied to clipboard.');
    else toast('Could not copy \u2014 your browser blocked clipboard access.', 'error');
  }

  function toast(message, type) {
    var el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = message;
    els.toasts.appendChild(el);
    setTimeout(function () {
      el.classList.add('leaving');
      setTimeout(function () { el.remove(); }, 260);
    }, 3600);
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function relTime(ts) {
    var diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    var minutes = Math.floor(diff / 60000);
    if (minutes < 60) return minutes + 'm ago';
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    var days = Math.floor(hours / 24);
    if (days < 7) return days + 'd ago';
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fullDate(ts) {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function syncModalClass() {
    var open = !els.editorOverlay.hidden || !els.settingsOverlay.hidden;
    document.body.classList.toggle('modal-open', open);
  }

  function anyOverlayOpen() {
    return !els.editorOverlay.hidden || !els.settingsOverlay.hidden;
  }

  function isTypingTarget(target) {
    if (!target) return false;
    var tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function openSidebar() {
    document.body.classList.add('sidebar-open');
  }

  function closeSidebar() {
    document.body.classList.remove('sidebar-open');
  }

  function maybeCloseSidebar() {
    if (window.matchMedia('(max-width: 940px)').matches) closeSidebar();
  }
})();
