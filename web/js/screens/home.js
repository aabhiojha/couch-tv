(function () {
  'use strict';
  // Home shows the focused card's cover above its row, without a separately focused featured title.
  Shell.register('home', function (ctx) {
    var data = ctx.data,
      kit = ctx.kit,
      shell = ctx.shell;
    var ROW_LINE = 560; // y of the focused row's heading
    // The cover changes only once navigation has settled: swapping a full-screen backdrop while rows and cards
    // are still moving dropped Home to ~25 fps on the TV (measured; the launcher waits the same way).
    var COVER_DELAY = 1000; // ms of stillness before the cover follows a card

    var el = kit.el('main', 'home-screen');
    var cover = kit.el('section', 'home-cover');
    var art = kit.el('div', 'cover-art');
    var layers = [kit.el('img', 'cover-image'), kit.el('img', 'cover-image')];
    layers.forEach(function (img) {
      img.alt = '';
      art.appendChild(img);
    });
    var copy = kit.el('div', 'cover-copy');
    var logo = kit.el('img', 'cover-logo');
    logo.alt = '';
    var title = kit.el('h1', 'cover-title');
    var meta = kit.el('div', 'cover-meta');
    var description = kit.el('p', 'cover-description');
    [logo, title, meta, description].forEach(function (node) { copy.appendChild(node); });
    cover.appendChild(art);
    cover.appendChild(kit.el('div', 'cover-shade'));
    cover.appendChild(copy);
    var viewport = kit.el('div', 'home-rows'),
      track = kit.el('div', 'home-track');
    viewport.appendChild(track);
    el.appendChild(cover);
    el.appendChild(viewport);

    var active = 0,
      focused = false,
      loaded = false,
      shown = null,
      layerIndex = 0,
      coverTimer = null,
      swapTimer = null,
      movedAt = 0,
      tops = null, // row offsetTop by group, read once per layout change instead of on every key
      preloadTimer = null,
      continueEntries = {};
    var groups = [];

    logo.onload = function () {
      var show = function () { copy.classList.add('has-logo'); };
      if (logo.decode) logo.decode().then(show, show);
      else show();
    };
    logo.onerror = function () { copy.classList.remove('has-logo'); };

    function showBackdrop(url) {
      var current = layers[layerIndex], next = layers[1 - layerIndex];
      if (!url) {
        current.classList.remove('visible');
        return;
      }
      if (current.getAttribute('src') === url && current.classList.contains('visible')) return;
      // An instant swap, once decoded and only while the remote is idle: a crossfade of two backdrop layers
      // cost more than the TV's GPU has to spare. The outgoing image is released to free its decoded pixels.
      var swap = function () {
        if (next.getAttribute('src') !== url) return;
        var wait = COVER_DELAY - (Date.now() - movedAt);
        if (wait > 0) {
          clearTimeout(swapTimer);
          swapTimer = setTimeout(swap, wait);
          return;
        }
        next.classList.add('visible');
        current.classList.remove('visible');
        current.removeAttribute('src');
        layerIndex = 1 - layerIndex;
      };
      next.onerror = function () { next.removeAttribute('src'); };
      next.src = url;
      if (next.decode) next.decode().then(swap, function () { /* keep the current image */ });
      else next.onload = swap;
    }

    function paintCover(item) {
      if (!item) return;
      shown = item;
      title.textContent = item.title || 'Untitled';
      copy.classList.remove('has-logo');
      if (item.logoLarge) logo.src = item.logoLarge;
      else logo.removeAttribute('src');
      var bits = [];
      if (item.year) bits.push(item.year);
      if (Number(item.rating) > 0) bits.push('TMDB ' + Number(item.rating).toFixed(1));
      bits.push(item.isSeries || item.kind === 'series' ? 'Series' : 'Film');
      meta.textContent = bits.join('   ·   ');
      description.textContent = item.description || '';
      // w780, as the launcher uses: a third of the pixels of w1280 to decode and upload on this TV.
      showBackdrop((item.backdrop || item.thumb || '').replace('/w1280/', '/w780/'));
    }

    function followCard(item, group) {
      movedAt = Date.now();
      clearTimeout(coverTimer);
      coverTimer = setTimeout(function () {
        if (item !== shown) paintCover(item);
      }, COVER_DELAY);
    }

    function addRow(title, key, options) {
      var state = { key: key, title: title, page: 1, total: Infinity, loading: false, failed: false, items: [], visible: true, dynamic: !!options };
      state.row = kit.Row({
        title: title,
        nearby: false,
        wide: !!options && !!options.wide,
        cardOptions: options
          ? function (item) {
              return { wide: !!options.wide, progress: options.progress ? options.progress(item) : 0 };
            }
          : null,
        onSelect: function (item, index) {
          if (options && options.select) options.select(item, index);
          else shell.go('details', { id: item.id, item: item });
        },
        onPlay: options && options.select,
        onFocus: function (item) { followCard(item, state); },
        onNeedMore: function () {
          if (!state.dynamic) loadRow(state);
        }
      });
      track.appendChild(state.row.el);
      groups.push(state);
      return state;
    }
    var continueRow = addRow('Continue Watching', 'continue', {
      wide: true,
      progress: function (item) {
        var entry = continueEntries[item.id];
        return entry && entry.durationSec ? entry.positionSec / entry.durationSec : 0;
      },
      select: function (item) {
        var entry = continueEntries[item.id];
        if (entry) data.play(entry.item, entry.video, { startOver: false });
      }
    });
    var newRow = addRow('New Episodes', 'new', {});
    var newKey = '';
    var listRow = addRow('My List', 'mylist', {});
    var becauseRow = addRow('Because You Watched', 'because', {});
    var becauseResult = null;
    for (var i = 0; i < data.rows.length; i++) addRow(data.rows[i].title, data.rows[i].key, null);
    continueRow.row.el.hidden = true;
    listRow.row.el.hidden = true;
    newRow.visible = false;
    newRow.row.el.hidden = true;
    becauseRow.visible = false;
    becauseRow.row.el.hidden = true;

    function visibleGroups() {
      return groups.filter(function (g) { return g.visible; });
    }
    function selectedGroup() {
      return active >= 0 ? visibleGroups()[active] : null;
    }

    function loadRow(state) {
      if (state.loading || state.items.length >= state.total) return;
      state.loading = true;
      state.failed = false;
      state.row.setLoading(true);
      tops = null;
      var page = state.page;
      Promise.resolve().then(function () { return data.loadRow(state.key, page); }).then(function (result) {
        state.loading = false;
        state.total = result.total;
        state.page++;
        var incoming = result.items || [];
        state.items = state.items.concat(incoming);
        state.row.setLoading(false);
        state.row.appendItems(incoming);
        markNearby();
        if (!incoming.length && !state.items.length) state.row.el.appendChild(kit.el('div', 'row-empty-message', 'Nothing here yet.'));
        if (!incoming.length) state.total = state.items.length;
        tops = null;
      }, function () {
        state.loading = false;
        state.failed = true;
        state.row.setError(function () { state.failed = false; loadRow(state); });
        tops = null;
      });
    }

    // A Continue Watching card says where you are ("S2, E4 · 23 min left", "Next · S2, E5") and, for a series,
    // shows that episode's still rather than the show's artwork.
    function continueCard(entry) {
      var video = entry.video || {}, item = entry.item;
      var left = Math.max(1, Math.round((entry.durationSec - entry.positionSec) / 60));
      var time = entry.positionSec && entry.durationSec ? (left >= 60 ? Math.floor(left / 60) + ' h ' + (left % 60 ? left % 60 + ' min ' : '') : left + ' min ') + 'left' : '';
      var episode = item.isSeries && video.episode ? 'S' + (video.season || 1) + ', E' + video.episode : '';
      return Object.assign({}, item, { thumb: (item.isSeries && video.still) || item.thumb,
        meta: entry.positionSec ? [episode, time].filter(Boolean).join(' · ') : ['Next', episode].filter(Boolean).join(' · ') });
    }
    function refreshDynamic() {
      var watching = data.continueWatching(), inList = data.myList();
      continueEntries = {};
      watching.forEach(function (entry) { continueEntries[entry.item.id] = entry; });
      var current = selectedGroup(), currentIndex = current ? current.row.index : 0;
      continueRow.visible = watching.length > 0;
      continueRow.row.el.hidden = !continueRow.visible;
      listRow.visible = inList.length > 0;
      listRow.row.el.hidden = !listRow.visible;
      continueRow.row.setItems(watching.map(continueCard));
      listRow.row.setItems(inList);
      tops = null;
      if (current && !current.visible) active = 0;
      else if (current) {
        active = visibleGroups().indexOf(current);
        if (current === continueRow || current === listRow) current.row.focus(currentIndex);
      }
      if (focused) updateFocus();
      loadBecause();
      loadNew();
    }

    // Preload only the next row once remote input settles to limit simultaneous artwork decodes.
    function markNearby() {
      if (el.hidden) return;
      var around = Math.max(0, active);
      visibleGroups().forEach(function (g, index) {
        var nearby = index === around;
        g.row.setNearby(nearby);
        if (nearby && !g.dynamic && !g.loading && !g.failed && !g.items.length && g.total) loadRow(g);
      });
      clearTimeout(preloadTimer);
      preloadTimer = setTimeout(function () {
        if (el.hidden) return;
        visibleGroups().forEach(function (g, index) {
          if (index <= around || index > around + 1) return;
          g.row.setNearby(true);
          if (!g.dynamic && !g.loading && !g.failed && !g.items.length && g.total) loadRow(g);
        });
      }, 500);
    }

    // Rows only move when one appears, disappears or loads, so their positions are read once per change: reading
    // layout here after the class writes below made the first Down on the TV a 333 ms task (measured).
    function rowTop(group) {
      if (!tops) tops = groups.map(function (g) { return g.row.el.offsetTop; });
      return tops[groups.indexOf(group)];
    }

    function updateFocus() {
      var group = selectedGroup();
      var visible = visibleGroups();
      var y = group ? rowTop(group) - ROW_LINE : 0;
      for (var i = 0; i < groups.length; i++) {
        if (focused && groups[i] === group) groups[i].row.focus();
        else groups[i].row.blur();
        groups[i].row.el.classList.toggle('is-above', visible.indexOf(groups[i]) >= 0 && visible.indexOf(groups[i]) < active);
      }
      markNearby();
      if (focused) shell.tuck(active > 0);
      track.style.transform = 'translate3d(0,' + -y + 'px,0)';
    }

    function moveVertical(direction) {
      var next = active + direction;
      if (next < 0 || next >= visibleGroups().length) return next >= 0; // Up from the first row: the tab bar
      active = next;
      updateFocus();
      return true;
    }

    function loadNew() {
      data.newEpisodes().then(function (items) {
        var key = items.map(function (i) { return i.id + i.badge; }).join();
        if (key === newKey) return;
        newKey = key;
        var current = selectedGroup();
        newRow.visible = items.length > 0;
        newRow.row.el.hidden = !newRow.visible;
        newRow.row.setItems(items);
        tops = null;
        markNearby();
        if (current) active = Math.max(0, visibleGroups().indexOf(current));
        if (focused) updateFocus();
      });
    }

    function loadBecause() {
      if (!data.becauseYouWatched) return;
      data.becauseYouWatched().then(function (result) {
        if (result === becauseResult) return;
        becauseResult = result;
        var current = selectedGroup();
        becauseRow.visible = !!result && result.items.length > 0;
        becauseRow.row.el.hidden = !becauseRow.visible;
        becauseRow.row.el.querySelector('.row-heading').textContent = result ? result.title : '';
        becauseRow.row.setItems(result ? result.items : []);
        tops = null;
        markNearby();
        if (current) active = Math.max(0, visibleGroups().indexOf(current));
        if (focused) updateFocus();
      }, function () { /* offline: the row stays hidden and is retried on the next refresh */ });
    }

    function show(params, returning) {
      if (!loaded) {
        loaded = true;
        loadRow(groups.filter(function (g) { return !g.dynamic; })[0]);
      }
      refreshDynamic();
      if (!returning) active = 0;
    }
    function hide() {
      clearTimeout(coverTimer);
      clearTimeout(preloadTimer);
      focused = false;
      groups.forEach(function (g) { g.row.setNearby(false); });
      if (selectedGroup()) selectedGroup().row.blur();
      el.hidden = true;
    }
    function focus() {
      focused = true;
      updateFocus();
    }
    function hideFocus() {
      focused = false;
      updateFocus();
    }
    function handleKey(code) {
      if (code === 10009) return false;
      if (code === 38 || code === 40) return moveVertical(code === 40 ? 1 : -1);
      var group = selectedGroup();
      return group ? group.row.handleKey(code) : false;
    }
    return { el: el, show: show, hide: hide, focus: focus, hideFocus: hideFocus, refresh: refreshDynamic, handleKey: handleKey };
  });
})();
