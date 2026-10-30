// Wires data, shell/screens and player together and owns the single key listener.
(function () {
  var KEY_ALIASES = { 8: 10009, 27: 10009, 32: 10252 }; // desktop: Backspace/Escape → Back, Space → Play/Pause
  var ready = false;
  var liveAttempt = 0;
  PStream.startTorrentService();

  function episodeLabel(video) {
    var parts = [];
    if (video.season) parts.push('S' + video.season);
    if (video.episode) parts.push('E' + video.episode);
    parts.push(video.title);
    return parts.join(' · ');
  }

  // Torrent or web stream, asked when a film or episode is started; the answer (options.mode) carries
  // over to retries, quality changes and the next episode, and the last one is focused next time.
  function askSource(item, video, options) {
    var settings = Data.settings();
    Shell.choose({ title: item.title, body: 'How do you want to watch?', index: settings.lastSource === 'web' ? 1 : 0,
      choices: ['Torrent · downloads on this TV', 'Web stream · from your stream server'] }).then(function (index) {
      if (index === false) return;
      var mode = index === 1 ? 'web' : 'torrent';
      if (settings.lastSource !== mode) Data.setSetting('lastSource', mode);
      Data.play(item, video, Object.assign({}, options, { mode: mode }));
    });
  }

  Data.play = function (item, video, options) {
    var settings = Data.settings();
    var mode = options && options.mode;
    if (!mode && item.source === 'pstream' && settings.askSource !== false) return askSource(item, video, options);
    liveAttempt++;
    var next = Data.nextVideo(item, video);
    var quality = settings.quality || 'best';
    var tried = (options && options.tried) || [];
    var torrentStatus = '';
    var stream = item.source === 'pstream' ? PStream.scrape(item, video, quality, tried, function (text) { torrentStatus = text; }, mode) : null;
    var resolved = null;
    if (stream) stream.then(function (s) { resolved = s; }, function () {});
    Player.open({
      url: video.url,
      stream: stream,
      status: function () {
        if (!resolved || !resolved.stats) return resolved ? '' : torrentStatus;
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, 3000);
        return fetch(resolved.stats, { signal: controller.signal }).then(function (response) {
          if (!response.ok) throw new Error('Torrent stats unavailable');
          return response.json();
        }).then(function (stats) {
          var text = 'Torrent';
          if (typeof stats.peers === 'number') text += ' · ' + stats.peers + ' peers';
          if (stats.downloadSpeed > 0) text += ' · ' + (stats.downloadSpeed / 1048576).toFixed(1) + ' MB/s';
          if (typeof stats.streamProgress === 'number') text += ' · ' + Math.floor(stats.streamProgress * 100) + ' %';
          return text;
        }).catch(function () { return 'Torrent'; }).then(function (text) {
          clearTimeout(timer);
          return text;
        });
      },
      quality: quality,
      loadQualities: stream && function () { return stream.then(function (s) { return s.qualities; }); },
      // The relay serves only the chosen rendition, so a change reopens the stream where it was.
      // Playback failed: try the next untried source from the same point. Deferred so the failing
      // player has closed before the new one opens.
      onFailure: function (atSec) {
        if (!resolved || !resolved.remaining) return false;
        var next = tried.concat(resolved.source);
        setTimeout(function () { Data.play(item, video, { startSec: atSec, tried: next, mode: mode }); }, 0);
        return true;
      },
      onQuality: function (choice, atSec) {
        Data.setSetting('quality', choice);
        Data.play(item, video, { startSec: atSec, mode: mode });
      },
      title: item.title,
      subtitle: item.isSeries ? episodeLabel(video) : [item.year, item.runtime].filter(Boolean).join(' · '),
      startSec: options && options.startOver ? 0 : options && options.startSec >= 0 ? options.startSec : Data.resumeFrom(video.url),
      formatTime: Data.formatTime,
      onProgress: function (pos, dur) { Data.setProgress(item, video, pos, dur); },
      onClose: function () {},
      subtitles: video.subtitles || [],
      subtitlesOn: settings.subtitles,
      subtitleSize: settings.subtitleSize,
      audioLang: settings.audioLang,
      onAudio: function (lang) { if (lang) Data.setSetting('audioLang', lang); },
      loadSubtitles: Data.loadSubtitles,
      next: next ? { title: item.title, subtitle: episodeLabel(next) } : null,
      autoplayNext: settings.autoplayNext,
      onNext: function () { Data.play(item, next, { startOver: true, mode: mode }); },
      description: item.description || '',
      rating: item.rating || 0,
      year: item.year || '',
      episodes: item.isSeries ? (item.videos || []).filter(function (v) {
        return v.season === video.season;
      }).map(function (v) {
        return { label: episodeLabel({ season: v.season, episode: v.episode, title: '' }).replace(/ · $/, ''),
          title: v.title || v.name || '', current: v.url === video.url };
      }) : null,
      onEpisode: function (index) {
        var season = (item.videos || []).filter(function (v) { return v.season === video.season; });
        if (season[index]) Data.play(item, season[index], { startOver: false, mode: mode });
      }
    });
  };

  // A channel with several streams (other sources, qualities, feeds) asks which one to play;
  // options.direct (the Play key) skips the question and starts the first, preferred stream.
  Data.playLive = function (channel, options) {
    var streams = channel.streams || [{ url: channel.url, label: '' }];
    if (!streams.length) return Shell.toast('No watch options are listed for this event.');
    if (channel.kind === 'event' && channel.startsAt - Date.now() > 15 * 60000)
      return Shell.toast('Starts ' + Live.startLabel(channel, Date.now()) + '. Try closer to the start.');
    var attempt = ++liveAttempt, tried = [];
    function open(index) {
      if (attempt !== liveAttempt) return;
      var stream = streams[index], switching = false;
      tried.push(index);
      Player.open({ url: stream.url, live: true, title: channel.title, subtitle: stream.label || channel.group,
        formatTime: Data.formatTime,
        onFailure: function () {
          var next = streams.map(function (s, i) { return i; }).filter(function (i) { return tried.indexOf(i) < 0; })[0];
          if (tried.length >= 3 || next === undefined) {
            // Every feed failed: say so when it's the TV's resolver, not the feeds, that is broken.
            if (channel.kind === 'event' || channel.scheduled) Data.sportsHealth(false).then(function (health) {
              if (attempt === liveAttempt && Live.health(health, Date.now()).value === 'Failing')
                Shell.toast('Sports streams aren’t resolving on this TV. Settings › Sports streams says why.');
            });
            return false;
          }
          switching = true;
          Shell.toast('That feed is unavailable. Trying another watch option…');
          setTimeout(function () { open(next); }, 0);
          return true;
        },
        onClose: function () { if (!switching && attempt === liveAttempt) liveAttempt++; }
      });
    }
    // options.index: the watch option chosen on the Sports screen; otherwise the first, preferred one.
    open(options && options.index > 0 && options.index < streams.length ? options.index : 0);
  };

  window.addEventListener('error', function (e) {
    Data.recordError((e.message || 'Error') + (e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    Data.recordError('Unhandled: ' + (e.reason && e.reason.message || e.reason));
  });

  // Play on the remote also starts titles from Home, Browse and Details (the player registers the rest).
  if (window.tizen && tizen.tvinputdevice) {
    ['MediaPlayPause', 'MediaPlay'].forEach(function (key) {
      try { tizen.tvinputdevice.registerKey(key); } catch (error) { /* already registered */ }
    });
  }

  function applyMotion() { document.documentElement.classList.toggle('no-motion', !!Data.settings().noMotion); }
  applyMotion();
  Data.onChange(applyMotion);

  // The launch screen (index.html) fades out over the first screen instead of vanishing when the shell
  // replaces #app's contents.
  var splash = document.querySelector('.app-splash');
  if (splash) document.body.appendChild(splash);
  Shell.init(document.getElementById('app'), Data);
  if (splash) setTimeout(function () {
    splash.classList.add('app-splash-out');
    setTimeout(function () { if (splash.parentNode) splash.parentNode.removeChild(splash); }, 450);
  }, 600);
  ready = true;

  // The Home launcher (~/tv-shinnagans/launcher) shows a "Continue in Couch TV" row from the snapshot we
  // publish to its service on this TV, and launches us with resume / details / section requests.
  // Snapshot v2: up to 5 titles, newest first; backdrops at w780 (two are decoded at once on a 1 GB TV).
  var HOME_CONTINUE = 'http://127.0.0.1:8737/continue', published = null, publishTimer = null;
  function publishContinue() {
    publishTimer = null;
    var body = JSON.stringify({ version: 2, continue: Data.continueWatching().slice(0, 5).map(function (e) {
      return { id: e.item.id, title: e.item.title, year: e.item.year || '', description: (e.item.description || '').slice(0, 160),
        thumb: e.item.thumb || '', backdrop: (e.item.backdrop || '').replace('/w1280/', '/w780/'),
        logo: e.item.logoLarge || e.item.logo || '', episode: e.item.isSeries ? episodeLabel(e.video) : '',
        positionSec: e.positionSec, durationSec: e.durationSec };
    }), sports: Data.sportsBookmarks().map(function (s) {
      return { id: s.id, title: s.title, kind: s.kind, sport: s.sport, startsAt: s.startsAt, thumb: s.thumb };
    }) });
    if (body !== published && navigator.sendBeacon(HOME_CONTINUE, body)) published = body;
  }
  publishContinue();
  Data.onChange(function () { if (!publishTimer) publishTimer = setTimeout(publishContinue, 15000); });
  // In the background we cost ~76 MB on this TV (measured), so stay only to resume an open film paused.
  // Otherwise exit; the Continue tile and saved progress bring the viewer back. The delay lets the
  // Continue beacon go out first.
  document.addEventListener('visibilitychange', function () {
    var shell = document.getElementById('app');
    // Back on screen: the TV may have stopped the service while we waited in the background or in standby.
    if (!document.hidden) { if (shell) shell.style.display = ''; PStream.startTorrentService(); return; }
    publishContinue();
    if (Player.isOpen()) { if (shell) shell.style.display = 'none'; return; }
    setTimeout(function () {
      if (!document.hidden || Player.isOpen()) return;
      try { tizen.application.getCurrentApplication().exit(); } catch (e) { /* not on a TV */ }
    }, 1000);
  });

  // At launch, and via the appcontrol event when Home asks while we're already running in the background.
  // resume: play that title from where it was; details: open its page; section: 'mylist'; sport: a saved
  // channel or match from the launcher's My Sports row, played straight away.
  function resumeFromHome() {
    var ask = {};
    try {
      tizen.application.getCurrentApplication().getRequestedAppControl().appControl.data.forEach(function (d) {
        ask[d.key] = d.value[0];
      });
    } catch (e) { return; }
    if (ask.sport) return playSaved(ask.sport);
    var id = ask.resume || ask.details;
    if (!id && ask.section !== 'mylist') return;
    if (Player.isOpen()) Player.close();
    if (!id) return Shell.go('mylist');
    // A resume for a title that has left Continue Watching opens its page rather than playing something else.
    var entry = Data.continueWatching().filter(function (c) { return c.item.id === id; })[0];
    Shell.go('details', entry ? { id: id, item: entry.item, autoplay: !!ask.resume } : { id: id });
  }
  function playSaved(id) {
    if (Player.isOpen()) Player.close();
    Shell.go('live');
    Data.sports().then(function (result) {
      var item = result.items.filter(function (i) { return i.id === id; })[0];
      if (!item || !item.streams.length) return Shell.toast('That isn’t listed right now. Here’s what’s on.');
      Data.playLive(Object.assign({}, item, { streams: Live.preferredStreams(item.streams, 'all') }), { direct: true });
    }, function () { Shell.toast('Couldn’t load sports. Check your connection.'); });
  }
  resumeFromHome();
  window.addEventListener('appcontrol', resumeFromHome);

  // A saved match about to start gets one toast, wherever the viewer is in Couch TV.
  var announced = {};
  setInterval(function () {
    var now = Date.now();
    Data.sportsBookmarks().forEach(function (s) {
      if (s.kind !== 'event' || announced[s.id] || s.startsAt - now > 5 * 60000 || now - s.startsAt > 10 * 60000) return;
      announced[s.id] = true;
      Shell.toast(s.title + (s.startsAt > now ? ' starts in ' + Math.ceil((s.startsAt - now) / 60000) + ' min' : ' has started') + '. It’s in Sports.');
    });
  }, 30000);

  // A held arrow key repeats faster than a slow TV can paint. Handle at most one arrow per frame
  // so focus never runs ahead of the screen and keeps scrolling after the key is released.
  var arrowPending = false;
  function arrowDone() { arrowPending = false; }

  document.addEventListener('keyup', function (e) {
    if (ready && (KEY_ALIASES[e.keyCode] || e.keyCode) === 13) Shell.release();
  });
  document.addEventListener('keydown', function (e) {
    if (!ready) return;
    var code = KEY_ALIASES[e.keyCode] || e.keyCode;
    if (code >= 37 && code <= 40) {
      e.preventDefault();
      if (arrowPending) return;
      arrowPending = true;
      requestAnimationFrame(arrowDone);
    }
    // A failing handler must not leave the remote dead: record it and carry on.
    try {
      var handled = Player.isOpen() ? Player.handleKey(code) : Shell.handleKey(code);
      if (handled) e.preventDefault();
    } catch (error) {
      Data.recordError('key ' + code + ': ' + (error && error.message || error));
    }
  });
})();
