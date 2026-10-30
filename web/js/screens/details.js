(function () {
  'use strict';

  Shell.register('details', function (ctx) {
    var kit = ctx.kit;
    var data = ctx.data;
    var shell = ctx.shell;
    var el = kit.el('main', 'details-screen');
    var viewport = kit.el('div', 'details-viewport');
    var track = kit.el('div', 'details-track');
    var hero = kit.el('section', 'details-hero');
    var backdrop = kit.el('div', 'details-backdrop');
    var shade = kit.el('div', 'details-shade');
    var copy = kit.el('div', 'details-copy');
    var eyebrow = kit.el('div', 'eyebrow');
    var title = kit.el('h1', 'details-title');
    var meta = kit.el('div', 'details-meta');
    var chips = kit.el('div', 'details-chips');
    var creator = kit.el('div', 'details-creator');
    var description = kit.el('p', 'details-description');
    var actions = kit.el('div', 'details-actions');
    var loadState = kit.el('div', 'details-load-state');
    var play = kit.el('div', 'details-button details-play');
    var playLabel = kit.el('span', '', 'Play');
    var start = kit.el('div', 'details-button');
    var startLabel = kit.el('span', '', 'Start Over');
    var list = kit.el('div', 'details-button');
    var listLabel = kit.el('span', '', 'My List');
    var trailerButton = kit.el('div', 'details-button');
    trailerButton.appendChild(kit.icon('film'));
    trailerButton.appendChild(kit.el('span', '', 'Trailer'));
    var badges = kit.el('div', 'details-badges');

    play.appendChild(kit.icon('play'));
    play.appendChild(playLabel);
    start.appendChild(kit.icon('restart'));
    start.appendChild(startLabel);
    list.appendChild(kit.icon('plus'));
    list.appendChild(listLabel);
    actions.appendChild(play);
    actions.appendChild(start);
    actions.appendChild(trailerButton);
    actions.appendChild(list);
    var logo = kit.el('img', 'details-logo');
    logo.alt = '';
    logo.onload = function () {
      copy.classList.add('has-logo');
    };
    logo.onerror = function () {
      copy.classList.remove('has-logo');
    };
    copy.appendChild(eyebrow);
    copy.appendChild(logo);
    copy.appendChild(title);
    copy.appendChild(meta);
    copy.appendChild(badges);
    copy.appendChild(chips);
    copy.appendChild(creator);
    copy.appendChild(description);
    copy.appendChild(actions);
    copy.appendChild(loadState);

    hero.appendChild(backdrop);
    hero.appendChild(shade);
    hero.appendChild(copy);
    track.appendChild(hero);

    var episodeSection = kit.el('section', 'details-episodes');
    var episodeHeading = kit.el('h2', 'details-section-title', 'Episodes');
    var tabHolder = kit.el('div', 'details-season-tabs');
    // Episodes as picture cards (TMDB stills), the focused one's synopsis under the row.
    var episodeRow = kit.Row({
      title: '',
      cardOptions: function (card) { return { progress: progressFraction(card.video) }; },
      onSelect: function (card) { playVideo(card.video, false); },
      onPlay: function (card) { playVideo(card.video, false); },
      onFocus: function (card) { episodeInfo.textContent = card.video.description || ''; }
    });
    var episodeInfo = kit.el('p', 'details-episode-info');
    episodeSection.appendChild(episodeHeading);
    episodeSection.appendChild(tabHolder);
    episodeSection.appendChild(episodeRow.el);
    episodeSection.appendChild(episodeInfo);
    track.appendChild(episodeSection);

    // Cast as round portraits; OK opens the person's other films and shows.
    var castSection = kit.el('section', 'details-cast');
    var cast = kit.Row({
      title: 'Cast',
      onSelect: function (person) { shell.go('person', { id: person.personId, name: person.title }); },
      onPlay: function () {}
    });
    castSection.appendChild(cast.el);
    track.appendChild(castSection);

    var relatedSection = kit.el('section', 'details-related');
    var related = kit.Row({ title: 'More Like This', onSelect: openRelated });
    relatedSection.appendChild(related.el);
    track.appendChild(relatedSection);
    viewport.appendChild(track);
    el.appendChild(viewport);

    var item = null;
    var token = 0;
    var focusZone = 'buttons';
    var buttonIndex = 0;
    var focused = false;
    var detailError = false;
    var seasons = null;
    var seasonNumbers = [];
    var visibleEpisodes = [];
    var trailer = null; // { layer, frame, timer } while one plays
    var scrollY = 0;
    var autoplay = false;

    function openRelated(entry) {
      shell.go('details', { id: entry.id, item: entry });
    }

    function videos() {
      return item && item.videos ? item.videos : [];
    }

    function firstUnfinished() {
      var entries = videos();
      for (var i = 0; i < entries.length; i++) {
        var progress = data.getProgress(entries[i].url);
        if (!progress || !progress.durationSec || progress.positionSec < progress.durationSec * .95) {
          return entries[i];
        }
      }
      return entries[0] || null;
    }

    // Series: where Continue Watching would pick up (the latest episode, or the one after it when
    // finished), so skipping ahead isn't undone by Play going back to an unwatched early episode.
    function actionVideo() {
      if (!item || !item.isSeries) return videos()[0];
      var entry = data.continueWatching().filter(function (e) { return e.item.id === item.id; })[0];
      var match = entry && videos().filter(function (v) { return v.url === entry.video.url; })[0];
      return match || firstUnfinished();
    }

    function progressFor(video) {
      return video ? data.getProgress(video.url) : null;
    }

    function progressFraction(video) {
      var progress = progressFor(video);
      if (!progress || !progress.durationSec) return 0;
      return Math.min(1, Math.max(0, progress.positionSec / progress.durationSec));
    }

    function visibleButtons() {
      return [play, start, trailerButton, list].filter(function (button) { return !button.hidden; });
    }

    function updateProgress() {
      var video = actionVideo();
      var position = video ? data.resumeFrom(video.url) : 0;
      var progress = progressFor(video);
      var saved = data.inMyList(item.id);
      var episode = item.isSeries && video && video.episode ? ' S' + (video.season || 1) + ' E' + video.episode : '';
      playLabel.textContent = detailError ? 'Retry details'
        : (position ? 'Resume' : 'Play') + episode + (position && !episode ? ' ' + data.formatTime(position) : '');
      start.hidden = !progress || !progress.positionSec;
      listLabel.textContent = saved ? 'In My List' : 'My List';
      list.replaceChild(kit.icon(saved ? 'check' : 'plus'), list.firstChild);
      if (buttonIndex >= visibleButtons().length) buttonIndex = visibleButtons().length - 1;
      updateFocus();
    }

    function paintSummary() {
      if (!item) return;
      eyebrow.textContent = item.isSeries ? 'SERIES' : 'FILM';
      title.textContent = item.title || 'Untitled';
      if (item.logoLarge && logo.getAttribute('src') !== item.logoLarge) {
        copy.classList.remove('has-logo');
        logo.src = item.logoLarge;
      } else if (!item.logoLarge) {
        copy.classList.remove('has-logo');
        logo.removeAttribute('src');
      }
      var bits = [];
      if (item.year) bits.push(item.year);
      if (item.runtime) bits.push(item.runtime);
      if (Number(item.rating) > 0) bits.push('TMDB ' + Number(item.rating).toFixed(1));
      if (item.language) bits.push(item.language);
      meta.textContent = bits.join('   ·   ');
      description.textContent = item.description || '';
      chips.textContent = '';
      (item.subjects || []).forEach(function (subject) {
        chips.appendChild(kit.el('span', 'details-chip', subject));
      });
      creator.textContent = item.creator ? 'Created by ' + item.creator : item.director ? 'Directed by ' + item.director : '';
      creator.hidden = !creator.textContent;
      // The age rating, boxed as the Apple TV app shows it.
      badges.textContent = '';
      if (item.certification) badges.appendChild(kit.el('span', 'details-rating', item.certification));
      badges.hidden = !badges.firstChild;
      trailerButton.hidden = !item.trailer || !data.trailerUrl(item.trailer);
      var large = item.backdrop || item.thumb;
      backdrop.style.backgroundImage = large ? 'url("' + encodeURI(large).replace(/"/g, '%22') + '")' : '';
      // Without a backdrop only the small poster is left; it can't be shown sharp at this size, so it's blurred.
      hero.classList.toggle('soft', !item.backdrop);
    }

    function buildEpisodes() {
      var entries = videos();
      seasonNumbers = [];
      entries.forEach(function (video) {
        var season = Number(video.season) || 1;
        if (seasonNumbers.indexOf(season) < 0) seasonNumbers.push(season);
      });
      seasonNumbers.sort(function (a, b) { return a - b; });
      episodeSection.hidden = !item.isSeries || !entries.length;
      tabHolder.textContent = '';
      seasons = null;
      if (seasonNumbers.length > 1) {
        var tabs = seasonNumbers.map(function (number) {
          return { key: String(number), title: 'Season ' + number };
        });
        // Opens on the season of the episode Play would start, not always season 1.
        var current = actionVideo();
        var at = current ? seasonNumbers.indexOf(Number(current.season) || 1) : 0;
        seasons = kit.Tabs({ items: tabs, index: at, onChange: function () { buildEpisodeList(); } });
        tabHolder.appendChild(seasons.el);
        tabHolder.hidden = false;
      } else {
        tabHolder.hidden = true;
      }
      buildEpisodeList(actionVideo());
    }

    // focusVideo: the episode to put focus on (the one Play would start), else the first.
    function buildEpisodeList(focusVideo) {
      var selected = seasons ? Number(seasons.value) : seasonNumbers[0];
      visibleEpisodes = videos().filter(function (video) {
        return (Number(video.season) || 1) === selected;
      });
      var at = 0;
      episodeRow.setItems(visibleEpisodes.map(function (video, i) {
        if (focusVideo && video.url === focusVideo.url) at = i;
        var length = video.durationSec ? Math.round(video.durationSec / 60) + ' min' : '';
        return { id: video.url, video: video, thumb: video.still || '', fallback: 'E' + (video.episode || i + 1),
          title: 'E' + (video.episode || i + 1) + ' · ' + (video.title || 'Episode'),
          meta: [length, video.subtitles && video.subtitles.length ? 'CC' : ''].filter(Boolean).join(' · ') };
      }));
      episodeRow.focus(at);
      if (focusZone !== 'episodes') episodeRow.blur();
      episodeInfo.textContent = visibleEpisodes[at] ? visibleEpisodes[at].description || '' : '';
      updateProgress();
    }

    function focusTarget() {
      if (focusZone === 'tabs') return seasons ? seasons.el : null;
      if (focusZone === 'episodes') return episodeRow.el;
      if (focusZone === 'cast') return cast.el;
      if (focusZone === 'related') {
        return related.el.querySelector('.poster-card.focused, .skeleton-card.focused') || related.el;
      }
      return null;
    }

    function updateScroll() {
      var target = focusTarget();
      if (!target) {
        scrollY = 0;
      } else {
        var trackRect = track.getBoundingClientRect();
        var targetRect = target.getBoundingClientRect();
        var top = targetRect.top - trackRect.top;
        var bottom = targetRect.bottom - trackRect.top;
        if (top - scrollY < 160) scrollY = top - 160;
        else if (bottom - scrollY > 900) scrollY = bottom - 900;
        var maxScroll = Math.max(0, track.scrollHeight - viewport.clientHeight);
        scrollY = Math.min(maxScroll, Math.max(0, scrollY));
      }
      track.style.transform = 'translate3d(0,' + -scrollY + 'px,0)';
    }

    function updateFocus() {
      var buttons = visibleButtons();
      [play, start, trailerButton, list].forEach(function (node) {
        node.classList.remove('focused');
      });
      if (focused && focusZone === 'buttons' && buttons[buttonIndex]) {
        buttons[buttonIndex].classList.add('focused');
      }
      if (seasons) {
        if (focused && focusZone === 'tabs') seasons.focus();
        else seasons.blur();
      }
      if (focused && focusZone === 'episodes') episodeRow.focus();
      else episodeRow.blur();
      if (focused && focusZone === 'cast') cast.focus();
      else cast.blur();
      if (focused && focusZone === 'related') related.focus();
      else related.blur();
      updateScroll();
    }

    function playVideo(video, startOver) {
      if (video) data.play(item, video, { startOver: !!startOver });
      else shell.toast('Video unavailable');
    }

    function activateButton() {
      var selected = visibleButtons()[buttonIndex];
      if (selected === play) {
        if (detailError) loadDetail(item.id);
        else playVideo(actionVideo(), false);
      } else if (selected === start) {
        playVideo(actionVideo(), true);
      } else if (selected === trailerButton) {
        openTrailer();
      } else {
        var added = data.toggleMyList(item);
        shell.toast(added ? 'Added to My List' : 'Removed from My List');
        updateProgress();
      }
    }

    function retryRelated() {
      loadRelated(item.id);
    }

    function loadRelated(id) {
      var request = token;
      related.setLoading(true);
      data.related(item).then(function (entries) {
        if (request !== token || item.id !== id) return;
        related.setLoading(false);
        related.setItems(entries || []);
        relatedSection.hidden = !entries || !entries.length;
        if (relatedSection.hidden && focusZone === 'related') focusZone = 'buttons';
        updateFocus();
      }, function () {
        if (request !== token) return;
        related.setError(retryRelated);
        updateFocus();
      });
    }

    function detailFailed(request) {
      if (request !== token) return;
      shell.loading(false);
      detailError = true;
      autoplay = false;
      loadState.textContent = "Couldn't load details. Press Play to retry.";
      updateProgress();
    }

    // cover: hide the screen behind the loading overlay; only when there is nothing to show yet
    // (opened by id). A title opened from a row is already painted and shows "Loading details…".
    function loadDetail(id, cover) {
      var request = ++token;
      detailError = false;
      loadState.textContent = 'Loading details…';
      related.setLoading(true);
      updateProgress();
      if (cover) shell.loading(true, 'Loading details');
      data.loadItem(id).then(function (detail) {
        if (request !== token) return;
        shell.loading(false);
        if (!detail) {
          detailFailed(request);
          return;
        }
        if (!Number(detail.rating) && Number(item.rating)) detail.rating = item.rating;
        item = detail;
        loadState.textContent = '';
        paintSummary();
        buildEpisodes();
        cast.setItems(item.cast || []);
        castSection.hidden = !(item.cast && item.cast.length);
        updateProgress();
        loadRelated(id);
        if (autoplay) {
          autoplay = false;
          playVideo(actionVideo(), false);
        } else if (data.prefetch) data.prefetch(item, actionVideo());
      }, function () {
        detailFailed(request);
      });
    }

    function show(params, returning) {
      if (returning) {
        if (item && item.isSeries && item.videos) buildEpisodeList(actionVideo()); // progress may have moved
        updateProgress();
        return;
      }
      item = params.item || {
        id: params.id,
        title: 'Loading title',
        year: '',
        description: '',
        thumb: '',
        rating: 0
      };
      autoplay = !!params.autoplay;
      focusZone = 'buttons';
      buttonIndex = 0;
      castSection.hidden = true;
      cast.setItems([]);
      scrollY = 0;
      detailError = false;
      episodeSection.hidden = true;
      relatedSection.hidden = false;
      related.setItems([]);
      related.setLoading(true);
      paintSummary();
      updateProgress();
      loadDetail(params.id || item.id, !params.item);
    }

    function handleButtonsKey(code) {
      if (code === 37 && buttonIndex === 0) return false;
      if (code === 37 || code === 39) {
        var delta = code === 39 ? 1 : -1;
        buttonIndex = Math.max(0, Math.min(visibleButtons().length - 1, buttonIndex + delta));
        updateFocus();
        return true;
      }
      if (code === 13) {
        activateButton();
        return true;
      }
      return true;
    }

    // Up/Down walk the sections in page order, skipping hidden ones.
    function zones() {
      var all = ['buttons'];
      if (!episodeSection.hidden && seasons) all.push('tabs');
      if (!episodeSection.hidden && visibleEpisodes.length) all.push('episodes');
      if (!castSection.hidden) all.push('cast');
      if (!relatedSection.hidden) all.push('related');
      return all;
    }
    function moveZone(step) {
      var all = zones(), next = all[all.indexOf(focusZone) + step];
      if (!next) return step < 0 ? false : true;
      focusZone = next;
      updateFocus();
      return true;
    }

    // ---- Trailer: the TV service's trailer page (YouTube) over the whole screen; OK pauses, Back closes. ----
    function closeTrailer(message) {
      if (!trailer) return;
      clearTimeout(trailer.timer);
      window.removeEventListener('message', trailer.listen);
      trailer.layer.parentNode.removeChild(trailer.layer);
      trailer = null;
      if (message) shell.toast(message);
    }
    function openTrailer() {
      var url = data.trailerUrl(item.trailer);
      if (!url) return;
      var layer = kit.el('div', 'trailer-layer'), frame = kit.el('iframe', 'trailer-frame');
      layer.appendChild(kit.loader(''));
      frame.setAttribute('allow', 'autoplay');
      frame.setAttribute('tabindex', '-1'); // keys stay with the app, not the frame
      frame.src = url;
      layer.appendChild(frame);
      document.body.appendChild(layer);
      trailer = { layer: layer, frame: frame };
      trailer.listen = function (e) {
        if (!trailer || e.source !== frame.contentWindow) return;
        if (e.data === 'trailer:playing') { clearTimeout(trailer.timer); layer.classList.add('playing'); }
        else if (e.data === 'trailer:ended') closeTrailer();
        else if (e.data === 'trailer:error') closeTrailer('This trailer can’t play here');
      };
      window.addEventListener('message', trailer.listen);
      trailer.timer = setTimeout(function () { closeTrailer('The trailer didn’t start. Try again later.'); }, 25000);
    }
    function trailerKey(code) {
      if (code === 10009 || code === 413) closeTrailer();
      else if ((code === 13 || code === 10252 || code === 415 || code === 19) && trailer.frame.contentWindow)
        trailer.frame.contentWindow.postMessage('toggle', '*');
      return true;
    }

    function handleKey(code) {
      if (trailer) return trailerKey(code);
      if (code === 10009) return false;
      // Play on the remote: the focused episode, else what the Play button would start.
      if ((code === 10252 || code === 415) && (focusZone === 'buttons' || focusZone === 'tabs')) {
        if (detailError) loadDetail(item.id);
        else if (!item.videos) autoplay = true; // still loading: play as soon as it arrives
        else playVideo(actionVideo(), false);
        return true;
      }
      if (focusZone === 'buttons') {
        if (code === 38) return false;
        if (code === 40) return moveZone(1);
        return handleButtonsKey(code);
      }
      if (focusZone === 'tabs') {
        if (code === 38 || code === 40) return moveZone(code === 38 ? -1 : 1);
        if (seasons.handleKey(code)) { updateFocus(); return true; }
        return code !== 37;
      }
      var row = { episodes: episodeRow, cast: cast, related: related }[focusZone];
      if (code === 38 || code === 40) return moveZone(code === 38 ? -1 : 1);
      if (row.handleKey(code)) { updateFocus(); return true; }
      return code !== 37;
    }

    return {
      el: el,
      show: show,
      hide: function () {
        closeTrailer();
        focused = false;
        updateFocus();
        el.hidden = true;
      },
      focus: function () {
        focused = true;
        updateFocus();
      },
      hideFocus: function () {
        focused = false;
        updateFocus();
      },
      refresh: function () {
        if (item) updateProgress();
      },
      handleKey: handleKey
    };
  });
})();
