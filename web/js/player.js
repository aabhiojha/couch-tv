(function () {
  'use strict';

  var active = null;
  var mediaKeysRegistered = false;

  var TRACK_WIDTH = 1400; // px, fixed in player.css so the scrub head moves with a transform only
  var SEEK_COMMIT_MS = 650;
  var HIDE_MS = 4000;
  var STILL_MS = 5000;
  var REPEAT_MS = 120;    // a held key repeats faster than this; extra repeats would overshoot
  var ROW_PITCH = 104;    // panel row height + margin (player.css)
  var BUTTON_PITCH = 108; // control button width + margin (player.css)
  var HEADER_PITCH = 80;
  var PANEL_VIEW = 716;   // visible height of the panel list (player.css)
  var KEYS = [13, 10252, 415, 19, 37, 38, 39, 40, 412, 417, 10009, 413];
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var ICONS = {
    play: 'M8 5v14l11-7z',
    pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
    back: 'M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z',
    forward: 'M18 13c0 3.31-2.69 6-6 6s-6-2.69-6-6 2.69-6 6-6v4l5-5-5-5v4c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8h-2z',
    subtitles: 'M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z',
    next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
    episodes: 'M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z',
    restart: 'M6 6h2v12H6zm3.5 6l8.5 6V6z',
    quality: 'M19.14 12.94a7.14 7.14 0 0 0 .06-.94c0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.47.47 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z',
    info: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
    check: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z'
  };

  function element(tag, className, parent) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (parent) parent.appendChild(node);
    return node;
  }

  function icon(name, className, parent, label) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'player-icon' + (className ? ' ' + className : ''));
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', ICONS[name]);
    svg.appendChild(path);
    if (label) {
      var text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', '12');
      text.setAttribute('y', '15.6');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('class', 'player-icon-text');
      text.textContent = label;
      svg.appendChild(text);
    }
    parent.appendChild(svg);
    return svg;
  }

  // Cached writes: render() runs on every time tick, so only touch the DOM when a value changes.
  function setText(node, value) {
    if (node._text !== value) { node._text = value; node.textContent = value; }
  }
  function setClass(node, value) {
    if (node._class !== value) { node._class = value; node.className = value; }
  }
  function setTransform(node, value) {
    if (node._transform !== value) { node._transform = value; node.style.transform = value; }
  }

  function clockText(date) {
    var hours = date.getHours();
    var minutes = date.getMinutes();
    return (hours % 12 || 12) + ':' + (minutes < 10 ? '0' : '') + minutes + (hours < 12 ? ' AM' : ' PM');
  }

  function qualityLabel(height) {
    if (height >= 2000) return '4K';
    if (height >= 1000) return 'HD 1080p';
    if (height >= 700) return 'HD 720p';
    return height > 0 ? 'SD ' + height + 'p' : '';
  }

  function finiteSeconds(value) {
    return typeof value === 'number' && isFinite(value) && value > 0 ? value : 0;
  }

  function formatTime(seconds) {
    var value = Math.floor(finiteSeconds(seconds));
    var hours = Math.floor(value / 3600);
    var minutes = Math.floor(value % 3600 / 60);
    var tail = String(value % 60);
    if (tail.length < 2) tail = '0' + tail;
    if (!hours) return minutes + ':' + tail;
    return hours + ':' + (minutes < 10 ? '0' : '') + minutes + ':' + tail;
  }

  function cueAt(cues, seconds) {
    var low = 0;
    var high = cues.length - 1;
    var found = -1;
    while (low <= high) {
      var middle = (low + high) >> 1;
      if (cues[middle].start <= seconds) {
        found = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return found >= 0 && seconds < cues[found].end ? cues[found] : null;
  }

  function registerMediaKeys() {
    if (mediaKeysRegistered) return;
    mediaKeysRegistered = true;
    if (!window.tizen || !tizen.tvinputdevice || !tizen.tvinputdevice.registerKey) return;
    ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaRewind', 'MediaFastForward'].forEach(function (key) {
      try { tizen.tvinputdevice.registerKey(key); } catch (error) { /* Key may already be registered. */ }
    });
  }

  function AvPlayBackend(root, callbacks) {
    var api = window.webapis.avplay;
    var object = document.createElement('object');
    object.id = 'av-player';
    object.type = 'application/avplayer';
    object.className = 'player-media player-av';
    root.appendChild(object);
    var closed = false;
    var ready = false;
    var faulted = false;
    // seekTo is asynchronous and AVPlay rejects other calls until it calls back; meanwhile report
    // the seek target instead of polling the player.
    var seekingTo = -1;
    var afterSeek = null;

    function fail(error) {
      if (closed || faulted) return;
      faulted = true;
      callbacks.error(error);
    }

    // AVPlay reports some errors (a rendition switch, a slow segment after a seek) and then plays on,
    // so an error only counts if playback hasn't advanced at all for 8 seconds.
    function confirmError(error) {
      var before = ready && seekingTo < 0 ? call('getCurrentTime') : -1;
      var checks = 0;
      (function check() {
        setTimeout(function () {
          if (closed || faulted) return;
          var now = -1;
          try { now = seekingTo < 0 && api.getState() === 'PLAYING' ? api.getCurrentTime() : -1; }
          catch (ignored) { /* Counts as not advancing. */ }
          if (before >= 0 && now > before) return;
          if (before < 0 && now >= 0) before = now;
          if (++checks < 8) check(); else fail(error);
        }, 1000);
      })();
    }

    function call(method, args) {
      if (closed || faulted) return null;
      try { return api[method].apply(api, args || []); }
      catch (error) { fail(error); return null; }
    }

    function start(startSec) {
      if (closed || faulted) return;
      ready = true;
      var duration = call('getDuration');
      if (closed || faulted) return;
      callbacks.ready(finiteSeconds(duration / 1000));
      if (startSec > 0) seek(startSec, begin);
      else begin();
    }

    function begin() {
      if (closed || faulted) return;
      if (document.hidden) { callbacks.buffering(false); return; }
      call('play');
      if (!closed && !faulted) callbacks.playing();
    }

    function seek(seconds, then) {
      if (closed || faulted) return;
      if (seekingTo >= 0) {
        seekingTo = seconds;
        afterSeek = function () { seek(seconds, then); };
        return;
      }
      seekingTo = seconds;
      function done() {
        seekingTo = -1;
        if (then) then();
        var queued = afterSeek;
        afterSeek = null;
        if (queued) queued();
      }
      call('seekTo', [seconds * 1000, done, done]);
    }

    this.open = function (url, startSec, headers) {
      // Tizen requires a visible AVPlay object before open().
      call('open', [url]);
      if (closed || faulted) return;
      Object.keys(headers || {}).forEach(function (name) {
        call('setStreamingProperty', [name.toLowerCase() === 'cookie' ? 'COOKIE' : 'USER_AGENT', headers[name]]);
      });
      if (closed || faulted) return;
      // Start after the documented minimum of buffered media rather than the player default.
      try { api.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', 4); }
      catch (error) { /* Optional tuning; the default still plays. */ }
      call('setDisplayRect', [0, 0, 1920, 1080]);
      // Without a display method AVPlay stretched every video to 16:9; keep the source aspect ratio
      // (black bars for scope films and 4:3), honouring anamorphic flags where the stream has them.
      try { api.setDisplayMethod('PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO'); }
      catch (error) {
        try { api.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); } catch (ignored) { /* Stretched, but plays. */ }
      }
      if (closed || faulted) return;
      call('setListener', [{
        onbufferingstart: function () { if (!closed) callbacks.buffering(true); },
        onbufferingcomplete: function () { if (!closed) callbacks.buffering(false); },
        oncurrentplaytime: function (ms) {
          if (!closed) callbacks.time(finiteSeconds(ms / 1000));
        },
        onstreamcompleted: function () { if (!closed) callbacks.ended(); },
        onsubtitlechange: function (duration, text) { if (!closed) callbacks.caption(String(text || ''), Number(duration) || 0); },
        onerror: confirmError
      }]);
      if (closed || faulted) return;
      call('prepareAsync', [function () { start(startSec); }, function (error) {
        fail(error);
      }]);
    };
    function play() {
      if (seekingTo >= 0) { afterSeek = play; return; }
      call('play');
      if (!closed && !faulted) callbacks.playing();
    }
    function pause() {
      if (seekingTo >= 0) { afterSeek = pause; return; }
      call('pause');
      if (!closed && !faulted) callbacks.buffering(false);
    }
    this.play = play;
    this.pause = pause;
    this.seek = function (seconds) { seek(seconds, null); };
    this.currentTime = function () {
      if (seekingTo >= 0) return seekingTo;
      return ready ? finiteSeconds(call('getCurrentTime') / 1000) : 0;
    };
    // Read-only and only between seeks; any failure just leaves the quality badge out.
    this.videoHeight = function () {
      if (closed || faulted || !ready || seekingTo >= 0) return 0;
      try {
        var info = api.getCurrentStreamInfo() || [];
        for (var i = 0; i < info.length; i++) {
          if (info[i].type === 'VIDEO') return Number(JSON.parse(info[i].extra_info || '{}').Height) || 0;
        }
      } catch (error) { /* Unknown quality. */ }
      return 0;
    };
    var knownDuration = 0;
    this.duration = function () {
      if (seekingTo < 0 && ready) knownDuration = finiteSeconds(call('getDuration') / 1000) || knownDuration;
      return knownDuration;
    };
    // The stream's own subtitle tracks (HLS renditions, MKV tracks). Called directly rather than through
    // call(): a subtitle failure must not fault playback.
    this.textTracks = function () {
      if (closed || faulted || !ready) return [];
      try {
        return api.getTotalTrackInfo().filter(function (t) { return t.type === 'TEXT'; }).map(function (t) {
          var info = {};
          try { info = JSON.parse(t.extra_info); } catch (error) { /* Unlabelled track. */ }
          return { index: t.index, lang: String(info.track_lang || '') };
        });
      } catch (error) { return []; }
    };
    // Audio tracks of files (MKV dual audio); the relay keeps one per web stream, as switching there broke seeking.
    this.audioTracks = function () {
      if (closed || faulted || !ready) return [];
      try {
        var current = -1;
        (api.getCurrentStreamInfo() || []).forEach(function (t) { if (t.type === 'AUDIO') current = t.index; });
        return api.getTotalTrackInfo().filter(function (t) { return t.type === 'AUDIO'; }).map(function (t) {
          var info = {};
          try { info = JSON.parse(t.extra_info); } catch (error) { /* Unlabelled track. */ }
          return { index: t.index, lang: String(info.language || info.track_lang || ''),
            channels: Number(info.channels) || 0, current: t.index === current };
        });
      } catch (error) { return []; }
    };
    this.selectAudio = function (index) {
      if (closed || faulted) return false;
      try { api.setSelectTrack('AUDIO', index); return true; } catch (error) { return false; }
    };
    this.selectText = function (index) {
      if (closed || faulted) return;
      try {
        if (index >= 0) api.setSelectTrack('TEXT', index);
        api.setSilentSubtitle(index < 0);
      } catch (error) { /* Subtitles stay as they were. */ }
    };
    this.close = function () {
      if (closed) return;
      closed = true;
      try { api.stop(); } catch (error) { /* Continue releasing the player. */ }
      try { api.close(); } catch (error) { /* Continue removing the object. */ }
      if (object.parentNode) object.parentNode.removeChild(object);
    };
  }

  function Html5Backend(root, callbacks) {
    var video = element('video', 'player-media player-video', root);
    var closed = false;

    function fail(error) { if (!closed) callbacks.error(error); }
    function play() {
      if (closed) return;
      try {
        var result = video.play();
        // A seek or pause during loading aborts the pending play(); that's not a playback failure.
        if (result && typeof result.catch === 'function') {
          result.catch(function (error) { if (!error || error.name !== 'AbortError') fail(error); });
        }
      } catch (error) { fail(error); }
    }

    video.addEventListener('loadedmetadata', function () {
      if (closed) return;
      callbacks.ready(finiteSeconds(video.duration));
      try {
        if (video._playerStart > 0) video.currentTime = video._playerStart;
      } catch (error) { fail(error); return; }
      if (document.hidden) { callbacks.buffering(false); return; }
      play();
    });
    video.addEventListener('waiting', function () {
      if (!closed && !video.paused) callbacks.buffering(true);
    });
    video.addEventListener('canplay', function () { if (!closed) callbacks.buffering(false); });
    video.addEventListener('seeked', function () { if (!closed) callbacks.buffering(false); });
    video.addEventListener('pause', function () { if (!closed) callbacks.buffering(false); });
    video.addEventListener('playing', function () {
      if (!closed) { callbacks.buffering(false); callbacks.playing(); }
    });
    video.addEventListener('timeupdate', function () {
      if (!closed) callbacks.time(finiteSeconds(video.currentTime));
    });
    video.addEventListener('ended', function () { if (!closed) callbacks.ended(); });
    video.addEventListener('error', function () { fail(video.error); });

    this.open = function (url, startSec) {
      try {
        video._playerStart = startSec;
        video.src = url;
        video.load();
      } catch (error) { fail(error); }
    };
    this.play = play;
    this.pause = function () {
      if (!closed) { video.pause(); callbacks.buffering(false); }
    };
    this.seek = function (seconds) {
      if (closed) return;
      try { video.currentTime = seconds; } catch (error) { fail(error); }
    };
    this.currentTime = function () { return finiteSeconds(video.currentTime); };
    this.duration = function () { return finiteSeconds(video.duration); };
    this.videoHeight = function () { return video.videoHeight || 0; };
    this.textTracks = function () { return []; };
    this.selectText = function () {};
    this.audioTracks = function () { return []; };
    this.selectAudio = function () { return false; };
    this.close = function () {
      if (closed) return;
      closed = true;
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (video.parentNode) video.parentNode.removeChild(video);
    };
  }

  // Track languages arrive as ISO 639 codes; Intl.DisplayNames is Chrome 81+, so a short table.
  var LANGUAGES = { en: 'English', eng: 'English', hi: 'Hindi', hin: 'Hindi', ne: 'Nepali', nep: 'Nepali',
    es: 'Spanish', spa: 'Spanish', fr: 'French', fre: 'French', fra: 'French', de: 'German', ger: 'German',
    deu: 'German', it: 'Italian', ita: 'Italian', pt: 'Portuguese', por: 'Portuguese', ru: 'Russian', rus: 'Russian',
    ja: 'Japanese', jpn: 'Japanese', ko: 'Korean', kor: 'Korean', zh: 'Chinese', chi: 'Chinese', zho: 'Chinese',
    ar: 'Arabic', ara: 'Arabic' };
  function languageName(code, n) {
    var key = code.toLowerCase().split(/[-_]/)[0];
    return LANGUAGES[key] || (key && key !== 'und' ? code.toUpperCase() : 'Track ' + n);
  }

  function buildPanel(root, heading, entries) {
    var panel = { el: element('div', 'player-panel', root), entries: entries, focusable: [], offsets: [], height: 0 };
    var inner = element('div', 'player-panel-inner', panel.el);
    panel.heading = element('div', 'player-panel-heading', inner);
    panel.heading.textContent = heading;
    panel.sub = element('div', 'player-panel-sub', inner);
    var view = element('div', 'player-panel-view', inner);
    panel.list = element('div', 'player-panel-list', view);
    var hint = element('div', 'player-panel-hint', inner);
    hint.textContent = 'Up/Down to move  ·  OK to select  ·  Back to close';
    entries.forEach(function (entry) {
      if (entry.header) {
        element('div', 'player-row-header', panel.list).textContent = entry.label;
        panel.height += HEADER_PITCH;
        return;
      }
      entry.node = element('div', 'player-row', panel.list);
      if (entry.episode !== undefined) {
        var line = element('div', 'player-row-label', entry.node);
        element('span', '', line).textContent = entry.label;
        if (entry.current) element('span', 'player-row-tag', line).textContent = 'Now Playing';
        element('div', 'player-row-title', entry.node).textContent = entry.title;
      } else {
        element('div', 'player-row-text', entry.node).textContent = entry.label;
        icon('check', 'player-row-check', entry.node);
      }
      panel.focusable.push(entry);
      panel.offsets.push(panel.height);
      panel.height += ROW_PITCH;
    });
    // The same glass as on the app's cards, sliding between rows; it scrolls with the list, so placing it
    // needs only the row offsets already known here.
    panel.glass = element('div', 'player-glass player-glass-row', panel.list);
    return panel;
  }

  function open(opts) {
    if (active) close();
    opts = opts || {};
    registerMediaKeys();
    var root = document.getElementById('player');
    if (!root) { root = element('div', '', document.body); root.id = 'player'; }
    root.className = 'player-root';
    root.textContent = '';
    var state = {
      root: root, opts: opts, backend: null, closed: false, failed: false,
      playing: false, buffering: true, pausedByUser: false, time: 0, length: 0, pending: null,
      seekTimer: null, hideTimer: null, progressTimer: null, tickTimer: null, messageTimer: null, stillTimer: null,
      tracks: Array.isArray(opts.subtitles) ? opts.subtitles : [], embedded: [], captionTimer: null,
      episodes: Array.isArray(opts.episodes) ? opts.episodes : [],
      audio: [], audioIndex: -1, subtitleIndex: -1, subtitleRequest: 0, size: opts.subtitleSize === 'small' || opts.subtitleSize === 'large' ? opts.subtitleSize : 'medium',
      cues: [], cueText: '', nextMode: 'hidden', nextStart: 0, nextSeconds: 10,
      visible: true, focus: 'bar', buttonIndex: 0, panel: null, panelIndex: 0, still: false,
      scrubDir: 0, scrubLast: 0, scrubStarted: 0, scrubFrom: 0, quality: ''
    };
    active = state;
    var displayTime = typeof opts.formatTime === 'function' ? opts.formatTime : formatTime;
    var rating = typeof opts.rating === 'number' && opts.rating > 0 ? 'TMDB ' + opts.rating.toFixed(1) : '';

    var overlay = element('div', 'player-overlay', root);
    var top = element('div', 'player-top', overlay);
    var heading = element('div', 'player-heading', top);
    element('h1', 'player-title', heading).textContent = opts.title || '';
    element('div', 'player-subtitle', heading).textContent = opts.subtitle || '';
    var badges = element('div', 'player-badges', heading);
    if (rating) element('span', 'player-rating', badges).textContent = rating;
    if (opts.live) element('span', 'player-badge player-badge-live', badges).textContent = 'LIVE';
    state.qualityBadge = element('span', 'player-badge player-badge-hidden', badges);
    if (state.tracks.length) element('span', 'player-badge', badges).textContent = 'CC';
    var clockBox = element('div', 'player-clock-box', top);
    state.clock = element('div', 'player-clock', clockBox);
    state.endsAt = element('div', 'player-ends', clockBox);

    var bottom = element('div', 'player-bottom', overlay);
    var timeline = element('div', 'player-timeline', bottom);
    state.elapsed = element('span', 'player-time', timeline);
    var bar = element('div', 'player-bar', timeline);
    var track = element('div', 'player-track', bar);
    state.fill = element('div', 'player-fill', track);
    state.target = element('div', 'player-target', track);
    state.head = element('div', 'player-head-pos', bar);
    element('div', 'player-head', state.head);
    state.bubblePos = element('div', 'player-bubble-pos', bar);
    state.bubble = element('div', 'player-bubble', state.bubblePos);
    state.bubbleTime = element('div', 'player-bubble-time', state.bubble);
    state.bubbleDelta = element('div', 'player-bubble-delta', state.bubble);
    state.total = element('span', 'player-time player-time-total', timeline);

    var controls = element('div', 'player-controls', bottom);
    state.buttons = [];
    function addButton(name, label, action, iconText) {
      var node = element('div', 'player-btn', controls);
      icon(name, 'player-icon-main', node, iconText);
      if (name === 'play') icon('pause', 'player-icon-alt', node);
      var text = element('div', 'player-btn-label', node);
      text.textContent = label;
      state.buttons.push({ name: name, node: node, label: text, action: action });
    }
    addButton('play', 'Pause', function () { togglePlay(); });
    if (!opts.live) {
      addButton('back', 'Back 10 seconds', function () { preview(baseTime() - 10); }, '10');
      addButton('forward', 'Forward 10 seconds', function () { preview(baseTime() + 10); }, '10');
    }
    addButton('subtitles', 'Subtitles', function () { openPanel('subtitles'); });
    if (opts.next) addButton('next', 'Next episode', function () { advanceNext(); });
    if (state.episodes.length) addButton('episodes', 'Episodes', function () { openPanel('episodes'); });
    // Quality: switching renditions inside AVPlay breaks seeking on this TV, so a choice reopens the
    // stream at the current position (opts.onQuality) instead of switching in place.
    if (typeof opts.loadQualities === 'function') addButton('quality', 'Quality', function () {
      if (state.panels.quality) openPanel('quality');
      else message('Checking available qualities…');
    });
    if (!opts.live) addButton('restart', 'Start from beginning', function () { restart(); });
    addButton('info', 'Info', function () { showStill('info'); });
    // Glass over the focused button, placed from the fixed button pitch so render() never reads layout.
    state.buttonGlass = element('div', 'player-glass player-glass-btn', controls);

    state.center = element('div', 'player-center', root);
    var loader = element('div', 'loader', state.center); // css/loader.css, same as between screens
    element('div', 'loader-bar', element('div', 'loader-track', loader));
    state.centerText = element('div', 'player-center-text', state.center);
    element('div', 'player-center-title', state.center).textContent = opts.title || '';
    element('div', 'player-spinner player-buffer', root);

    state.stillLayer = element('div', 'player-still', root);
    var stillBody = element('div', 'player-still-body', state.stillLayer);
    state.stillEyebrow = element('div', 'player-still-eyebrow', stillBody);
    element('div', 'player-still-title', stillBody).textContent = opts.title || '';
    var stillMeta = [opts.subtitle || ''];
    if (opts.year && String(opts.subtitle || '').indexOf(String(opts.year)) === -1) stillMeta.push(String(opts.year));
    if (rating) stillMeta.push(rating);
    element('div', 'player-still-meta', stillBody).textContent = stillMeta.filter(Boolean).join('  ·  ');
    if (opts.description) element('div', 'player-still-description', stillBody).textContent = opts.description;
    var stillProgress = element('div', 'player-still-progress', stillBody);
    var stillTrack = element('div', 'player-still-track', stillProgress);
    state.stillFill = element('div', 'player-still-fill', stillTrack);
    state.stillTime = element('span', 'player-still-time', stillProgress);
    var stillHint = element('div', 'player-still-hint', stillBody);
    element('span', 'player-key', stillHint).textContent = 'OK';
    state.stillHintText = element('span', '', stillHint);

    state.captionWrap = element('div', 'player-caption-wrap', root);
    state.caption = element('div', 'player-caption player-caption-' + state.size, state.captionWrap);
    state.message = element('div', 'player-message', root);

    state.nextCard = element('div', 'player-next', root);
    element('div', 'player-next-eyebrow', state.nextCard).textContent = 'Up Next';
    state.nextTitle = element('div', 'player-next-title', state.nextCard);
    state.nextSubtitle = element('div', 'player-next-subtitle', state.nextCard);
    var nextAction = element('div', 'player-next-action', state.nextCard);
    var nextButton = element('span', 'player-next-play', nextAction);
    icon('play', '', nextButton);
    element('span', '', nextButton).textContent = 'Play now';
    state.nextCount = element('span', 'player-next-count', nextAction);
    state.nextBar = element('div', 'player-next-bar', state.nextCard);
    state.nextBarFill = element('div', 'player-next-bar-fill', state.nextBar);
    element('div', 'player-next-hint', state.nextCard).textContent = 'Back to keep watching';
    if (opts.next) {
      state.nextTitle.textContent = opts.next.title || '';
      state.nextSubtitle.textContent = opts.next.subtitle || '';
    }

    // Rebuilt once the stream is ready and its own tracks are known. Embedded tracks are 'e' + AVPlay index.
    // With more than one audio track the panel leads with them, as Apple TV's Languages.
    function buildSubtitles() {
      var entries = [];
      if (state.audio.length > 1) {
        entries.push({ header: true, label: 'Languages' });
        state.audio.forEach(function (track, n) {
          var label = languageName(track.lang, n + 1) + (track.channels >= 6 ? ' 5.1' : '');
          if (entries.some(function (e) { return e.label === label; })) label += ' · Track ' + (n + 1);
          entries.push({ audio: track.index, label: label });
        });
        entries.push({ header: true, label: 'Subtitles' });
      }
      entries.push({ track: -1, label: 'Off' });
      state.tracks.forEach(function (track, index) {
        entries.push({ track: index, label: track && track.label ? track.label : 'Subtitles' });
      });
      state.embedded.forEach(function (track, n) {
        entries.push({ track: 'e' + track.index, label: languageName(track.lang, n + 1) });
      });
      entries.push({ header: true, label: 'Size' },
        { size: 'small', label: 'Small' }, { size: 'medium', label: 'Medium' }, { size: 'large', label: 'Large' });
      if (state.panels.subtitles) root.removeChild(state.panels.subtitles.el);
      var both = state.audio.length > 1;
      state.panels.subtitles = buildPanel(root, both ? 'Audio and subtitles' : 'Subtitles', entries);
      state.panels.subtitles.sub.textContent = both ? 'Spoken language, subtitles and caption size' :
        state.tracks.length || state.embedded.length ? 'Language and caption size' : 'No subtitles in this stream';
      state.buttons.forEach(function (button) {
        if (button.name === 'subtitles') setText(button.label, both ? 'Audio and subtitles' : 'Subtitles');
      });
    }
    state.panels = {};
    buildSubtitles();
    if (state.episodes.length) {
      state.panels.episodes = buildPanel(root, 'Episodes', state.episodes.map(function (episode, index) {
        return { episode: index, label: episode.label || 'Episode ' + (index + 1),
          title: episode.title || '', current: !!episode.current };
      }));
      state.panels.episodes.sub.textContent = state.episodes.length + ' episodes';
    }

    if (typeof opts.loadQualities === 'function') {
      Promise.resolve(opts.loadQualities()).then(function (heights) {
        if (state.closed || !Array.isArray(heights)) return;
        var current = opts.quality || 'best';
        state.panels.quality = buildPanel(root, 'Quality', [{ quality: 'best', label: 'Best available', current: current === 'best' }]
          .concat(heights.map(function (height) {
            return { quality: height, label: height + 'p' + (height >= 2160 ? ' 4K' : height >= 720 ? ' HD' : ''), current: current === height };
          })));
        state.panels.quality.sub.textContent = 'Changing quality reloads the video from here';
      }, function () { /* No list: the button keeps saying it is checking. */ });
    }

    state.errorBox = element('div', 'player-error', root);
    element('div', 'player-error-title', state.errorBox).textContent = "Couldn't play this video";
    state.errorHint = element('div', 'player-error-hint', state.errorBox);
    state.errorHint.textContent = 'Press Back to return';

    function render() {
      if (state.closed) return;
      var shown = state.pending === null ? state.time : state.pending;
      var loading = !state.failed && (!state.started || (state.buffering && !!state.statusText));
      setClass(root, 'player-root' + (opts.live ? ' player-live' : '') +
        (state.visible && !state.still ? ' player-shown' : '') +
        (loading ? ' player-loading' : '') +
        (state.failed ? ' player-failed' : '') +
        (state.still ? ' player-still-on' : '') +
        (state.panel ? ' player-panel-on' : '') +
        (state.focus === 'bar' ? ' player-focus-bar' : '') +
        (state.pending !== null ? ' player-scrubbing' : '') +
        (state.buffering && state.started && !state.pausedByUser && !state.failed ? ' player-buffering' : ''));
      setText(state.centerText, state.statusText || (state.resolving ? 'Finding a stream' : 'Loading'));
      setText(state.elapsed, displayTime(shown));
      setText(state.total, displayTime(state.length));
      var played = state.length ? Math.min(1, state.time / state.length) : 0;
      var head = state.length ? Math.min(1, shown / state.length) : 0;
      setTransform(state.fill, 'scaleX(' + played.toFixed(4) + ')');
      setTransform(state.target, 'scaleX(' + (state.pending === null ? 0 : head).toFixed(4) + ')');
      setTransform(state.head, 'translateX(' + Math.round(head * TRACK_WIDTH) + 'px)');
      if (state.pending !== null) {
        setTransform(state.bubblePos, 'translateX(' + Math.round(head * TRACK_WIDTH) + 'px)');
        setText(state.bubbleTime, displayTime(state.pending));
        var delta = Math.round(state.pending - state.scrubFrom);
        setText(state.bubbleDelta, (delta < 0 ? '−' : '+') + displayTime(Math.abs(delta)));
      }
      state.buttons.forEach(function (button, index) {
        var focused = state.focus === 'buttons' && index === state.buttonIndex;
        setClass(button.node, 'player-btn' + (focused ? ' player-btn-focus' : '') +
          (button.name === 'play' && state.playing ? ' player-btn-playing' : ''));
        if (button.name === 'play') setText(button.label, state.playing ? 'Pause' : 'Play');
      });
      setTransform(state.buttonGlass, 'translateX(' + state.buttonIndex * BUTTON_PITCH + 'px) scale(1.1)');
      setClass(state.buttonGlass, 'player-glass player-glass-btn' + (state.focus === 'buttons' ? ' player-glass-on' : ''));
      var now = new Date();
      setText(state.clock, clockText(now));
      setText(state.endsAt, state.length && state.started && !opts.live ?
        'Ends at ' + clockText(new Date(now.getTime() + Math.max(0, state.length - state.time) * 1000)) : '');
      if (state.still) {
        setTransform(state.stillFill, 'scaleX(' + played.toFixed(4) + ')');
        setText(state.stillTime, state.length ?
          displayTime(state.time) + ' of ' + displayTime(state.length) : displayTime(state.time));
      }
      renderNext();
    }
    function renderNext() {
      setClass(state.nextCard, 'player-next' +
        (state.nextMode === 'showing' && !state.panel && !state.still ? ' player-next-visible' : ''));
    }
    function renderPanel() {
      Object.keys(state.panels).forEach(function (name) {
        var panel = state.panels[name];
        var open = state.panel === name;
        setClass(panel.el, 'player-panel' + (open ? ' player-panel-open' : ''));
        if (!open) return;
        panel.focusable.forEach(function (entry, index) {
          var selected = entry.size ? entry.size === state.size : entry.audio !== undefined ? entry.audio === state.audioIndex :
            entry.episode !== undefined || entry.quality !== undefined ? entry.current : entry.track === state.subtitleIndex;
          setClass(entry.node, 'player-row' + (index === state.panelIndex ? ' player-row-focus' : '') +
            (selected ? ' player-row-selected' : ''));
        });
        setTransform(panel.glass, 'translateY(' + panel.offsets[state.panelIndex] + 'px) scale(1.02)');
        // Snap to whole rows so the top row is never cut in half; the last row has no margin below.
        var middle = panel.offsets[state.panelIndex] + ROW_PITCH / 2 - PANEL_VIEW / 2;
        var scroll = Math.max(0, Math.min(panel.height - 12 - PANEL_VIEW, Math.round(middle / ROW_PITCH) * ROW_PITCH));
        setTransform(panel.list, 'translateY(' + -Math.round(scroll) + 'px)');
      });
      setClass(state.caption, 'player-caption player-caption-' + state.size);
    }
    function hide() {
      state.hideTimer = null;
      if (state.closed || !state.playing || state.buffering || state.failed || state.panel || state.pending !== null) return;
      state.visible = false;
      state.focus = 'bar';
      render();
    }
    function show() {
      state.visible = true;
      if (state.hideTimer) clearTimeout(state.hideTimer);
      state.hideTimer = null;
      if (state.playing && !state.buffering && !state.failed && !state.panel) state.hideTimer = setTimeout(hide, HIDE_MS);
      if (state.stillTimer) clearTimeout(state.stillTimer);
      state.stillTimer = null;
      if (state.pausedByUser && !state.failed && !state.panel && !state.still) {
        state.stillTimer = setTimeout(function () {
          state.stillTimer = null;
          if (!state.closed && state.pausedByUser && !state.failed && !state.panel) showStill('pause');
        }, STILL_MS);
      }
      render();
    }
    function showStill(mode) {
      state.still = mode;
      setText(state.stillEyebrow, mode === 'pause' ? 'PAUSED' : 'NOW PLAYING');
      setText(state.stillHintText, state.pausedByUser ? 'Resume' : 'Back to video');
      if (state.hideTimer) clearTimeout(state.hideTimer);
      state.hideTimer = null;
      render();
    }
    function fail() {
      if (state.closed || state.failed) return;
      // Another source may work: the app can reopen from here instead of the error showing.
      if (typeof opts.onFailure === 'function' &&
          opts.onFailure(state.started ? state.time : finiteSeconds(opts.startSec))) {
        close();
        return;
      }
      state.failed = true;
      state.playing = false;
      state.buffering = false;
      state.still = false;
      state.panel = null;
      if (state.seekTimer) clearTimeout(state.seekTimer);
      state.pending = null;
      try { state.backend.pause(); } catch (error) { /* Keep the error overlay visible. */ }
      renderPanel();
      show();
    }
    function report(position, duration) {
      if (typeof opts.onProgress !== 'function') return;
      try { opts.onProgress(position, duration); } catch (error) { /* Playback remains usable. */ }
    }
    function message(text) {
      if (state.closed) return;
      state.message.textContent = text;
      state.message.className = 'player-message player-message-visible';
      if (state.messageTimer) clearTimeout(state.messageTimer);
      state.messageTimer = setTimeout(function () {
        if (!state.closed) state.message.className = 'player-message';
      }, 3000);
    }
    function updateQuality() {
      if (state.quality || state.closed || state.failed) return;
      state.quality = qualityLabel(state.backend.videoHeight());
      if (!state.quality) return;
      state.qualityBadge.textContent = state.quality;
      state.qualityBadge.className = 'player-badge';
    }
    function updateCaption() {
      if (state.closed || typeof state.subtitleIndex === 'string') return; // embedded text arrives via callbacks.caption
      var cue = state.subtitleIndex < 0 ? null : cueAt(state.cues, state.time);
      var content = cue ? cue.text : '';
      if (content !== state.cueText) {
        state.cueText = content;
        state.caption.textContent = content;
        state.captionWrap.style.display = content ? 'flex' : 'none';
      }
    }
    function selectSubtitle(index) {
      state.subtitleIndex = index;
      state.subtitleRequest += 1;
      state.cues = [];
      state.cueText = '';
      state.caption.textContent = '';
      state.captionWrap.style.display = 'none';
      clearTimeout(state.captionTimer);
      var embedded = typeof index === 'string';
      state.backend.selectText(embedded ? Number(index.slice(1)) : -1);
      if (embedded || index < 0) return;
      var track = state.tracks[index];
      if (!track || !track.url || typeof opts.loadSubtitles !== 'function') {
        message('Subtitles unavailable');
        return;
      }
      var request = state.subtitleRequest;
      try {
        Promise.resolve(opts.loadSubtitles(track.url)).then(function (cues) {
          if (state.closed || request !== state.subtitleRequest) return;
          if (!Array.isArray(cues)) throw new Error('Invalid subtitles');
          state.cues = cues.filter(function (cue) {
            return cue && typeof cue.start === 'number' && isFinite(cue.start) &&
              typeof cue.end === 'number' && cue.end > cue.start && typeof cue.text === 'string';
          }).sort(function (a, b) { return a.start - b.start; });
          updateCaption();
        }).catch(function () {
          if (!state.closed && request === state.subtitleRequest) message('Subtitles unavailable');
        });
      } catch (error) { message('Subtitles unavailable'); }
    }
    // remember: false for the automatic pick at start, which must not overwrite the household's choice.
    function selectAudio(index, remember) {
      if (index === state.audioIndex) return;
      if (!state.backend.selectAudio(index)) { if (remember) message('Couldn’t switch the audio'); return; }
      state.audioIndex = index;
      var track = state.audio.filter(function (t) { return t.index === index; })[0];
      if (remember && track && typeof opts.onAudio === 'function') opts.onAudio(track.lang);
    }
    function advanceNext() {
      if (state.closed || !opts.next) return;
      state.nextMode = 'advancing';
      close(true);
      if (typeof opts.onNext === 'function') opts.onNext();
    }
    function updateNext() {
      if (state.closed || !opts.next || state.nextMode === 'dismissed' || state.nextMode === 'advancing') return;
      var remaining = state.length - state.time;
      if (!state.length || remaining > 20 || (state.length <= 20 && remaining > 0)) {
        if (state.nextMode === 'showing') state.nextMode = 'hidden';
        renderNext();
        return;
      }
      if (state.nextMode === 'hidden') {
        state.nextMode = 'showing';
        state.nextStart = state.time;
      }
      if (opts.autoplayNext) {
        state.nextSeconds = Math.max(0, Math.ceil(10 - Math.max(0, state.time - state.nextStart)));
        setText(state.nextCount, 'Starting in ' + state.nextSeconds + 's');
        setTransform(state.nextBarFill, 'scaleX(' + (state.nextSeconds / 10) + ')');
        if (state.nextSeconds === 0) { advanceNext(); return; }
      } else {
        state.nextCount.style.display = 'none';
        state.nextBar.style.display = 'none';
      }
      renderNext();
    }
    function pause() {
      state.pausedByUser = true;
      state.backend.pause();
      state.playing = false;
      state.buffering = false;
    }
    function play() {
      state.pausedByUser = false;
      state.still = false;
      state.backend.play();
      if (!state.failed) state.playing = true;
    }
    function togglePlay() {
      if (state.playing) pause(); else play();
    }
    function baseTime() {
      return state.pending === null ? state.backend.currentTime() : state.pending;
    }
    function preview(seconds) {
      if (!state.length || state.failed || opts.live) return;
      if (state.pending === null) state.scrubFrom = state.backend.currentTime();
      if (state.failed) return;
      state.pending = Math.max(0, Math.min(state.length, seconds));
      if (state.seekTimer) clearTimeout(state.seekTimer);
      state.seekTimer = setTimeout(commitSeek, SEEK_COMMIT_MS);
    }
    function commitSeek() {
      if (state.seekTimer) clearTimeout(state.seekTimer);
      state.seekTimer = null;
      if (state.closed || state.failed || state.pending === null) return;
      lastProgress = Date.now(); // a torrent needs time to fetch pieces at the new position
      var target = state.pending;
      state.pending = null;
      state.scrubDir = 0;
      state.backend.seek(target);
      if (state.failed) return;
      state.time = target;
      if (state.nextMode === 'dismissed' && state.length - target > 20) state.nextMode = 'hidden';
      updateCaption();
      updateNext();
      show();
    }
    // Steps grow the longer a scrub goes on (10s → 30s → 60s → 2%); held keys are rate limited so
    // the head moves at a steady, readable speed instead of the remote's repeat rate.
    function scrub(direction, big) {
      var now = Date.now();
      if (direction === state.scrubDir && now - state.scrubLast < REPEAT_MS) return;
      if (direction !== state.scrubDir || now - state.scrubLast > 800) state.scrubStarted = now;
      state.scrubDir = direction;
      state.scrubLast = now;
      var held = now - state.scrubStarted;
      var level = (held < 1200 ? 0 : held < 2800 ? 1 : held < 4800 ? 2 : 3) + (big ? 1 : 0);
      var step = [10, 30, 60][level] || Math.max(60, state.length * (big && level > 3 ? 0.04 : 0.02));
      preview(baseTime() + direction * step);
    }
    function restart() {
      state.pending = null;
      if (state.seekTimer) clearTimeout(state.seekTimer);
      state.seekTimer = null;
      state.backend.seek(0);
      if (state.failed) return;
      state.time = 0;
      if (state.nextMode !== 'advancing') state.nextMode = 'hidden';
      updateCaption();
      updateNext();
      message('Playing from the beginning');
    }
    function openPanel(name) {
      if (!state.panels[name]) return;
      var panel = state.panels[name];
      state.panel = name;
      state.panelIndex = 0;
      panel.focusable.forEach(function (entry, index) {
        if (entry.current || (name === 'subtitles' && entry.track === state.subtitleIndex)) state.panelIndex = index;
      });
      renderPanel();
      show();
    }
    function closePanel() {
      state.panel = null;
      renderPanel();
      show();
    }
    function panelKey(code) {
      var panel = state.panels[state.panel];
      if (code === 10009 || code === 37) {
        closePanel();
      } else if (code === 38 || code === 40) {
        state.panelIndex = Math.max(0, Math.min(panel.focusable.length - 1, state.panelIndex + (code === 38 ? -1 : 1)));
        renderPanel();
      } else if (code === 13) {
        var entry = panel.focusable[state.panelIndex];
        if (entry.size) {
          state.size = entry.size;
          renderPanel();
        } else if (entry.episode !== undefined) {
          if (entry.current) { closePanel(); return true; }
          close();
          if (typeof opts.onEpisode === 'function') opts.onEpisode(entry.episode);
          return true;
        } else if (entry.quality !== undefined) {
          if (entry.current) { closePanel(); return true; }
          var at = state.time;
          close();
          if (typeof opts.onQuality === 'function') opts.onQuality(entry.quality, at);
          return true;
        } else if (entry.audio !== undefined) {
          selectAudio(entry.audio, true);
          closePanel();
        } else {
          selectSubtitle(entry.track);
          closePanel();
        }
      } else if (code === 10252 || code === 415 || code === 19) {
        if (code === 415 || (code === 10252 && !state.playing)) play(); else pause();
        render();
      }
      return true;
    }
    function onVisibility() {
      if (state.closed || !document.hidden) { if (!state.closed) show(); return; }
      if (!state.failed && state.playing) {
        pause();
        render();
      }
      show();
    }
    // Returns true when the key was consumed.
    function key(code) {
      if (code === 413) { close(); return true; }
      if (state.resolving && code !== 10009) { show(); return true; }
      if (state.still) {
        state.still = false;
        if (code === 13 && state.pausedByUser) play();
        if (code !== 10252 && code !== 415 && code !== 19 && code !== 412 && code !== 417) { show(); return true; }
      }
      if (state.panel) { panelKey(code); return true; }
      if (code === 10009) {
        if (state.nextMode === 'showing') {
          state.nextMode = 'dismissed';
          if (!state.playing && state.length && state.time >= state.length) close(true);
          else renderNext();
        } else if (state.visible && state.playing && !state.failed && state.pending === null) {
          if (state.hideTimer) clearTimeout(state.hideTimer);
          hide();
        } else {
          close();
        }
        return true;
      }
      if (state.failed) { show(); return true; }
      var wasHidden = !state.visible;
      if (wasHidden) state.focus = 'bar';
      if (code === 10252) togglePlay();
      else if (code === 415) play();
      else if (code === 19) pause();
      else if (code === 412 || code === 417) { state.focus = 'bar'; scrub(code === 412 ? -1 : 1, true); }
      else if (code >= 48 && code <= 57) { state.focus = 'bar'; preview(state.length * (code - 48) / 10); }
      else if (wasHidden && (code === 38 || code === 40)) { /* The first press only reveals the controls. */ }
      else if (state.focus === 'bar') {
        if (code === 37 || code === 39) scrub(code === 37 ? -1 : 1, false);
        else if (code === 40) state.focus = 'buttons';
        else if (code === 13) {
          if (state.pending !== null) commitSeek();
          else if (state.nextMode === 'showing') { advanceNext(); return true; }
          else togglePlay();
        }
      } else {
        if (code === 37 || code === 39) {
          state.buttonIndex = Math.max(0, Math.min(state.buttons.length - 1, state.buttonIndex + (code === 37 ? -1 : 1)));
        } else if (code === 38) {
          state.focus = 'bar';
        } else if (code === 13) {
          state.buttons[state.buttonIndex].action();
          if (state.closed) return true;
          if (state.still || state.panel) return true;
        }
      }
      if (!state.closed) show();
      return true;
    }
    state.render = render;
    state.report = report;
    state.visibility = onVisibility;
    state.key = key;

    var callbacks = {
      ready: function (duration) {
        if (state.closed) return;
        state.length = duration; render(); updateNext();
        state.embedded = state.backend.textTracks();
        state.audio = state.backend.audioTracks();
        state.audio.forEach(function (t) { if (t.current) state.audioIndex = t.index; });
        if (state.audio.length > 1 && opts.audioLang) {
          // The language last chosen in the player, when this file has it.
          var want = languageName(opts.audioLang, 0);
          var match = state.audio.filter(function (t) { return languageName(t.lang, 0) === want; })[0];
          if (match) selectAudio(match.index, false);
        }
        if (!state.embedded.length && state.audio.length < 2) return;
        buildSubtitles(); renderPanel();
        if (!state.embedded.length) return;
        // "Subtitles on" in Settings covers the stream's own tracks too, English first.
        if (opts.subtitlesOn && state.subtitleIndex === -1) {
          var pick = state.embedded.filter(function (t) { return /^en/i.test(t.lang); })[0] || state.embedded[0];
          selectSubtitle('e' + pick.index);
        }
      },
      // AVPlay hands over each embedded line with its duration; it passes SRT/ASS markup through, and on
      // this TV ends each line with a NUL.
      caption: function (text, ms) {
        if (state.closed || typeof state.subtitleIndex !== 'string') return;
        clearTimeout(state.captionTimer);
        var content = text.replace(/<[^>]*>|\{[^}]*\}|[\u0000-\u0008]/g, '').replace(/\\N/g, '\n').trim();
        state.caption.textContent = content;
        state.captionWrap.style.display = content ? 'flex' : 'none';
        if (content && ms > 0) state.captionTimer = setTimeout(function () {
          state.caption.textContent = '';
          state.captionWrap.style.display = 'none';
        }, ms);
      },
      time: function (seconds) {
        if (!state.closed) {
          state.time = seconds;
          render(); updateCaption(); updateNext();
        }
      },
      buffering: function (yes) {
        if (!state.closed) { state.buffering = yes && !state.pausedByUser; show(); }
      },
      playing: function () {
        if (!state.closed && !state.failed && !state.pausedByUser) {
          state.playing = true; state.started = true; state.buffering = false;
          updateQuality();
          show();
        }
      },
      ended: function () {
        if (state.closed) return;
        state.length = state.backend.duration() || state.length || state.time;
        state.time = state.length;
        if (opts.next && opts.autoplayNext) { advanceNext(); return; }
        if (opts.next && state.nextMode !== 'dismissed') {
          state.playing = false;
          state.buffering = false;
          state.nextMode = 'showing';
          updateNext();
          show();
          return;
        }
        close(true);
      },
      error: fail
    };
    state.backend = window.webapis && window.webapis.avplay ?
      new AvPlayBackend(root, callbacks) : new Html5Backend(root, callbacks);
    // Keep the video or AVPlay object below the controls in the stacking order.
    root.insertBefore(root.lastChild, overlay);
    document.addEventListener('visibilitychange', onVisibility);
    state.progressTimer = setInterval(function () {
      if (!state.closed && state.playing && !state.failed) {
        state.time = state.backend.currentTime();
        if (state.failed) return;
        state.length = state.backend.duration() || state.length;
        if (state.failed) return;
        report(state.time, state.length);
        updateQuality();
        render();
      }
    }, 5000);
    state.tickTimer = setInterval(function () {
      if (state.closed || !state.playing || state.buffering || state.failed) return;
      state.time = state.backend.currentTime();
      if (state.closed || state.failed) return;
      state.length = state.backend.duration() || state.length;
      if (state.closed || state.failed) return;
      updateCaption();
      updateNext();
    }, 250);
    var lastProgress = Date.now(), lastPosition = 0, statusPending = false;
    state.statusTimer = setInterval(function () {
      if (state.closed || state.failed) return;
      var now = Date.now();
      // A torrent fails over only when neither playback nor the download moves for 45 s; a finished
      // episode waiting on "Play next" isn't stalled.
      var ended = state.length > 0 && state.time >= state.length;
      if (!state.torrent || state.pausedByUser || ended || document.hidden || state.time !== lastPosition) lastProgress = now;
      lastPosition = state.time;
      if (state.torrent && now - lastProgress >= 45000) { fail(); return; }
      if (!state.resolving && !state.buffering) { state.statusText = ''; return; }
      if (statusPending || typeof opts.status !== 'function') return;
      statusPending = true;
      Promise.resolve().then(function () { return opts.status(); }).then(function (text) {
        if (!state.closed && !state.failed && (state.resolving || state.buffering)) {
          if (text !== state.statusText) lastProgress = Date.now(); // peers, speed or % moved
          state.statusText = typeof text === 'string' ? text : '';
          render();
        }
      }).catch(function () { /* Status is optional; playback can continue without it. */ }).then(function () {
        statusPending = false;
      });
    }, 1000);
    // opts.stream: optional Promise<{url, headers}> for sources that must be resolved first; the
    // player shows right away so the wait is visible and Back cancels it.
    state.resolving = !!opts.stream;
    render();
    renderPanel();
    if (opts.subtitlesOn && state.tracks.length) selectSubtitle(0);
    Promise.resolve(opts.stream || { url: opts.url, headers: opts.headers }).then(function (stream) {
      if (state.closed) return;
      state.resolving = false;
      state.torrent = stream.kind === 'torrent';
      lastProgress = Date.now();
      state.backend.open(stream.url, finiteSeconds(opts.startSec), stream.headers);
      render();
    }, function (error) {
      if (state.closed) return;
      state.resolving = false;
      state.errorHint.textContent = (error && error.message ? error.message + '. ' : '') + 'Press Back to return';
      fail();
    });
  }

  function close(completed) {
    var state = active;
    if (!state || state.closed) return;
    state.closed = true;
    active = null;
    if (state.seekTimer) clearTimeout(state.seekTimer);
    if (state.hideTimer) clearTimeout(state.hideTimer);
    if (state.stillTimer) clearTimeout(state.stillTimer);
    if (state.progressTimer) clearInterval(state.progressTimer);
    if (state.tickTimer) clearInterval(state.tickTimer);
    if (state.statusTimer) clearInterval(state.statusTimer);
    if (state.messageTimer) clearTimeout(state.messageTimer);
    state.subtitleRequest += 1;
    clearTimeout(state.captionTimer);
    document.removeEventListener('visibilitychange', state.visibility);
    var position = state.time;
    var duration = state.length;
    if (state.backend) {
      if (!completed && !state.failed) {
        position = state.backend.currentTime();
        duration = state.backend.duration() || duration;
      }
      state.backend.close();
    }
    if (completed) position = duration;
    state.report(position, duration);
    state.root.textContent = '';
    state.root.className = '';
    if (typeof state.opts.onClose === 'function') state.opts.onClose();
  }

  function handleKey(code) {
    var state = active;
    if (!state || state.closed) return false;
    if (KEYS.indexOf(code) === -1 && !(code >= 48 && code <= 57)) return false;
    return state.key(code);
  }

  window.Player = { open: open, isOpen: function () { return !!active; }, handleKey: handleKey, close: close };
}());
