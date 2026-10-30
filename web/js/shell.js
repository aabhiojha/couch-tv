(function () {
  'use strict';
  var Kit = window.Kit;
  var registry = {},
    cache = {},
    stack = [],
    root,
    data,
    stage,
    rail,
    railItems = [],
    railIndex = 1,
    railPill;
  var railFocused = false,
    dialog = null,
    toastNode,
    toastTimer,
    offlineNode,
    loadingNode,
    loadingLabel,
    loadingTimer = null,
    loadingOn = false;
  var nav = [
    { key: 'search', label: 'Search', icon: 'search' },
    { key: 'home', label: 'Home', icon: 'home' },
    { key: 'movies', label: 'Movies', icon: 'film' },
    { key: 'series', label: 'Series', icon: 'tv' },
    { key: 'live', label: 'Sports', icon: 'live' },
    { key: 'mylist', label: 'My List', icon: 'list' },
    { key: 'settings', label: 'Settings', icon: 'settings' }
  ];
  function current() {
    return stack[stack.length - 1];
  }
  function route(name, params) {
    if (name === 'movies' || name === 'series')
      return { screen: 'browse', params: { section: name } };
    if (name === 'mylist') return { screen: 'browse', params: { mylist: true } };
    return { screen: name, params: params || {} };
  }
  function activeNavKey() {
    var entry = current();
    if (!entry) return 'home';
    if (entry.name === 'browse') return entry.params.mylist ? 'mylist' : entry.params.section;
    if (entry.name === 'details' && stack.length > 1) {
      var below = stack[0];
      return below.name === 'browse'
        ? below.params.mylist
          ? 'mylist'
          : below.params.section
        : below.name;
    }
    return entry.name;
  }
  function paintRail() {
    rail.classList.toggle('expanded', railFocused);
    root.classList.toggle('shell-pushed', stack.length > 1);
    var active = activeNavKey();
    for (var i = 0; i < railItems.length; i++) {
      railItems[i].classList.toggle('focused', railFocused && i === railIndex);
      railItems[i].classList.toggle('current', nav[i].key === active);
    }
    railPill.move(railFocused ? railItems[railIndex] : null);
  }
  function focusRail() {
    if (current() && current().screen.hideFocus) current().screen.hideFocus();
    else if (current() && current().screen.el) {
      var focused = current().screen.el.querySelectorAll('.focused');
      for (var i = 0; i < focused.length; i++) focused[i].classList.remove('focused');
    }
    railFocused = true;
    for (var j = 0; j < nav.length; j++) if (nav[j].key === activeNavKey()) railIndex = j;
    paintRail();
  }
  function focusScreen() {
    railFocused = false;
    paintRail();
    if (current()) current().screen.focus();
  }
  function createEntry(name, params) {
    var factory = registry[name];
    if (!factory) return null;
    var key = name === 'browse' ? name + ':' + (params.mylist ? 'mylist' : params.section) : name;
    var screen = name === 'details' ? null : cache[key];
    if (!screen) {
      screen = factory({ data: data, shell: api, kit: Kit });
      if (name !== 'details') cache[key] = screen;
      stage.appendChild(screen.el);
      screen.el.hidden = true;
    }
    return { name: name, params: params, screen: screen };
  }
  // A screen arriving fades in (base.css .screen-enter).
  function activate(entry, returning) {
    tuck(false);
    var screenEl = entry.screen.el;
    screenEl.classList.remove('screen-enter');
    screenEl.hidden = false;
    void screenEl.offsetWidth;
    screenEl.classList.add('screen-enter');
    clearTimeout(screenEl._enterTimer);
    screenEl._enterTimer = setTimeout(function () { screenEl.classList.remove('screen-enter'); }, 400);
    entry.screen.show(entry.params, !!returning);
    railFocused = false;
    paintRail();
    entry.screen.focus();
  }
  function go(name, params) {
    loading(false);
    var destination = route(name, params),
      target = destination.screen;
    if (!registry[target]) {
      api.toast('Coming soon');
      return;
    }
    var entry = createEntry(target, destination.params);
    if (current()) {
      current().screen.hide();
      current().screen.el.hidden = true;
    }
    if (
      name === 'search' ||
      name === 'home' ||
      name === 'movies' ||
      name === 'series' ||
      name === 'live' ||
      name === 'mylist' ||
      name === 'settings'
    )
      stack = [];
    stack.push(entry);
    activate(entry, false);
  }
  function back() {
    loading(false);
    if (dialog) {
      closeDialog(false);
      return;
    }
    if (railFocused) {
      railFocused = false;
      paintRail();
      if (activeNavKey() === 'home' && stack.length === 1) showExit();
      else go('home');
      return;
    }
    if (stack.length > 1) {
      var top = stack.pop();
      top.screen.hide();
      top.screen.el.hidden = true;
      if (top.name === 'details') {
        top.screen.el.remove();
      }
      activate(current(), true);
      return;
    }
    // As on Apple TV: Back from a screen goes up to the tab bar; Back there goes Home, then offers to exit.
    focusRail();
  }
  // Screens tuck the tab bar away while they are scrolled down, as Apple TV does.
  function tuck(on) {
    if (root) root.classList.toggle('bar-tucked', !!on);
  }
  // Covers the stage while the next screen's data loads. Shown only if loading lasts past 250 ms so
  // fast (cached) loads don't flash; while it is up only Back is handled.
  function loading(on, label) {
    clearTimeout(loadingTimer);
    loadingOn = !!on;
    if (!loadingNode) return;
    if (on) {
      loadingLabel.textContent = label || 'Loading';
      loadingTimer = setTimeout(function () {
        loadingNode.classList.add('visible');
      }, 250);
    } else {
      loadingNode.classList.remove('visible');
    }
  }
  function toast(value) {
    if (!toastNode) return;
    toastNode.textContent = String(value);
    toastNode.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastNode.classList.remove('visible');
    }, 3000);
  }
  // The focused card's glass (base.css .focus-glass). Rows and screens scroll with a transition, so when
  // focus moves the card is still on its way: aim for where its artwork will settle, not where it is now.
  var FOCUS_SCALE = 1.08; // .poster-card.focused
  var glasses = {},
    glassList = [],
    glassAt = null,
    glassShown = null,
    glassFrame = 0;
  function translation(value) {
    var match = /translate(3d|X|Y)?\(([^)]*)\)/.exec(value);
    if (!match) return [0, 0];
    var parts = match[2].split(',');
    if (match[1] === 'Y') return [0, parseFloat(parts[0]) || 0];
    return [parseFloat(parts[0]) || 0, match[1] === 'X' ? 0 : parseFloat(parts[1]) || 0];
  }
  function matrixTranslation(value) {
    if (!value || value === 'none') return [0, 0];
    var parts = value.slice(value.indexOf('(') + 1, -1).split(',');
    return parts.length === 16 ? [+parts[12], +parts[13]] : [+parts[4], +parts[5]];
  }
  // The card scales about its own centre, which is below the artwork's when it has a title under it.
  function cardTarget(card, art) {
    var rect = card.getBoundingClientRect(),
      x = rect.left + rect.width / 2 + (art.offsetLeft + art.offsetWidth / 2 - card.offsetWidth / 2) * FOCUS_SCALE,
      y = rect.top + rect.height / 2 + (art.offsetTop + art.offsetHeight / 2 - card.offsetHeight / 2) * FOCUS_SCALE;
    for (var node = card.parentNode; node && node !== root; node = node.parentNode) {
      if (!node.style.transform) continue;
      var to = translation(node.style.transform),
        now = matrixTranslation(window.getComputedStyle(node).transform);
      x += to[0] - now[0];
      y += to[1] - now[1];
    }
    return { x: x, y: y, w: art.offsetWidth * FOCUS_SCALE };
  }
  function glassTransform(glass, at) {
    var s = at.w / glass.w;
    return 'translate(' + (at.x - (glass.w * s) / 2) + 'px,' + (at.y - (glass.h * s) / 2) + 'px) scale(' + s + ')';
  }
  // One glass per artwork size, made at that size with the artwork's corner radius, so none is ever resized
  // or repainted. Only the matching glass is displayed, so the others hold no compositor layers.
  function glassFor(art, from) {
    var key = art.offsetWidth + 'x' + art.offsetHeight;
    if (glasses[key]) return glasses[key];
    var node = Kit.el('div', 'focus-glass');
    var glass = { node: node, w: art.offsetWidth, h: art.offsetHeight };
    node.style.width = glass.w + 'px';
    node.style.height = glass.h + 'px';
    node.style.borderRadius = window.getComputedStyle(art).borderTopLeftRadius;
    node.style.transform = glassTransform(glass, from);
    root.appendChild(node);
    window.getComputedStyle(node).opacity; // start hidden at `from`, so its first move slides and fades in
    glasses[key] = glass;
    glassList.push(glass);
    return glass;
  }
  function placeGlass() {
    glassFrame = 0;
    var card = null,
      art = null,
      shown = null,
      i;
    if (!dialog && !(window.Player && window.Player.isOpen())) {
      // Cached screens are only hidden, so skip a card left focused on one of them.
      var found = stage.querySelectorAll('.poster-card.focused');
      for (i = 0; i < found.length && !card; i++) if (found[i].offsetWidth) card = found[i];
    }
    if (card) art = card.querySelector('.poster-art');
    if (art && art.offsetWidth) {
      var at = cardTarget(card, art);
      if (pressing) at.w *= PRESS; // the glass sinks with its card, about the same centre
      at.x += nudge[0];
      at.y += nudge[1];
      shown = glassFor(art, glassAt || at);
      glassAt = at;
      // Coming back from a button or another screen: appear on the card rather than slide from the last one.
      var jump = glassShown !== shown;
      shown.node.hidden = false;
      for (i = 0; i < glassList.length; i++) {
        if (jump) glassList[i].node.style.transition = 'none';
        glassList[i].node.style.transform = glassTransform(glassList[i], at);
      }
      if (jump) {
        window.getComputedStyle(shown.node).transform; // commit the jump before transitions come back
        for (i = 0; i < glassList.length; i++) glassList[i].node.style.transition = '';
      }
    }
    for (i = 0; i < glassList.length; i++) {
      glassList[i].node.style.opacity = glassList[i] === shown ? '1' : '0';
      glassList[i].node.hidden = glassList[i] !== shown;
    }
    glassShown = shown;
  }
  function scheduleGlass() {
    if (!glassFrame) glassFrame = requestAnimationFrame(placeGlass);
  }
  // Screens move focus from key presses, data loads and navigation alike, so watch for the class instead.
  function watchFocus() {
    var focusedClass = /(^|\s)focused(\s|$)/;
    var observer = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var record = records[i];
        if (
          record.attributeName === 'hidden' ||
          record.target.id === 'player' ||
          focusedClass.test(record.oldValue || '') !== record.target.classList.contains('focused')
        ) {
          scheduleGlass();
          return;
        }
      }
    });
    observer.observe(stage, { attributes: true, attributeOldValue: true, attributeFilter: ['class', 'hidden'], subtree: true });
    var player = document.getElementById('player');
    if (player) observer.observe(player, { attributes: true, attributeFilter: ['class'] });
    // Inter can finish loading after the glass is placed and nudge text and grids; place it again then.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleGlass);
  }
  // ---- Remote feedback, as on tvOS: OK sinks the focused item and its glass until it's released; a move that
  // changes nothing on screen (an edge) nudges it that way and springs back; moves click softly
  // (Settings › Navigation clicks). Only transform animates, so it costs the TV no repaint.
  var PRESS = 0.95, NUDGE = 14;
  var pressing = false, nudge = [0, 0], nudgeTimer = null, changes = null, audio = null, sounds = null;
  function focusedNodes() {
    var found = (dialog ? dialog.node : root).querySelectorAll('.focused'), nodes = [];
    for (var i = 0; i < found.length; i++) if (found[i].offsetWidth) nodes.push(found[i]);
    return nodes;
  }
  function glassSpeed(ms) {
    for (var i = 0; i < glassList.length; i++) glassList[i].node.style.transitionDuration = ms ? ms + 'ms' : '';
  }
  function press(on) {
    if (on === pressing) return;
    pressing = on;
    var nodes = on ? focusedNodes() : root.querySelectorAll('.pressed');
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.toggle('pressed', on);
    glassSpeed(on ? 110 : 0);
    placeGlass();
  }
  function bounce(code) {
    var dir = { 37: 'l', 38: 'u', 39: 'r', 40: 'd' }[code];
    focusedNodes().forEach(function (node) {
      node.classList.remove('bounce-l', 'bounce-u', 'bounce-r', 'bounce-d');
      void node.offsetWidth; // restart the animation on a repeated press
      node.classList.add('bounce-' + dir);
      setTimeout(function () { node.classList.remove('bounce-' + dir); }, 400); // or refocusing it would replay it
    });
    nudge = [dir === 'l' ? -NUDGE : dir === 'r' ? NUDGE : 0, dir === 'u' ? -NUDGE : dir === 'd' ? NUDGE : 0];
    glassSpeed(110);
    placeGlass();
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(function () {
      nudge = [0, 0];
      glassSpeed(0); // back on the glass's own springy curve
      placeGlass();
    }, 110);
  }
  // Focus arriving on a poster: its title logo drifts in against the move and settles, a layer floating over the
  // picture as on tvOS. Only the small logo moves: moving the picture inside its rounded corners, and reading
  // styles back to start the drift, cost the TV frames (tools/frames.js); the next frame starts it instead.
  function parallax(code) {
    var entry = current(),
      logo = entry && entry.screen.el.querySelector('.poster-card.focused .poster-logo');
    if (!logo) return;
    var dx = code === 39 ? -1 : code === 37 ? 1 : 0, dy = code === 40 ? -1 : code === 38 ? 1 : 0;
    logo.style.transition = 'none';
    logo.style.transform = 'translate(' + dx * 18 + 'px,' + dy * 18 + 'px)';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        logo.style.transition = '';
        logo.style.transform = '';
      });
    });
  }
  // A click is a short damped tone, made once; no sound files to bundle.
  function tone(ctx, hz, decayMs, gain) {
    var length = Math.round(ctx.sampleRate * decayMs * 5 / 1000), buffer = ctx.createBuffer(1, length, ctx.sampleRate), wave = buffer.getChannelData(0);
    for (var i = 0; i < length; i++) {
      var t = i / ctx.sampleRate;
      wave[i] = gain * Math.sin(2 * Math.PI * hz * t) * Math.exp(-t * 1000 / decayMs);
    }
    return buffer;
  }
  function click(kind) {
    var Context = window.AudioContext || window.webkitAudioContext;
    if (!Context || !data.settings().navClicks) return;
    try {
      if (!audio) {
        audio = new Context();
        sounds = { move: tone(audio, 2400, 2.5, 0.22), edge: tone(audio, 320, 12, 0.35), select: tone(audio, 1300, 6, 0.28) };
      }
      var source = audio.createBufferSource();
      source.buffer = sounds[kind];
      source.connect(audio.destination);
      source.start();
    } catch (error) { /* no audio output: stay silent */ }
  }
  function handleKeyWithFeedback(code) {
    var arrow = code >= 37 && code <= 40;
    if (code === 13) press(true);
    if (changes) changes.takeRecords();
    var handled = handleKey(code);
    if (arrow && changes) {
      if (changes.takeRecords().length) { click('move'); parallax(code); }
      else { bounce(code); click('edge'); }
    } else if (code === 13 && handled) click('select');
    return handled;
  }

  function closeDialog(result) {
    if (!dialog) return;
    dialog.node.remove();
    var resolve = dialog.resolve;
    dialog = null;
    scheduleGlass();
    if (resolve) resolve(result);
    if (railFocused) paintRail();
    else if (current()) current().screen.focus();
  }
  function openDialog(options) {
    if (dialog) closeDialog(false);
    if (current() && current().screen.hideFocus) current().screen.hideFocus();
    if (railFocused) {
      for (var i = 0; i < railItems.length; i++) railItems[i].classList.remove('focused');
    }
    return new Promise(function (resolve) {
      var shade = Kit.el('div', 'modal-shade'),
        panel = Kit.el('div', 'modal-panel');
      panel.appendChild(Kit.el('h2', 'modal-title', options.title || 'Are you sure?'));
      if (options.body) panel.appendChild(Kit.el('p', 'modal-body', options.body));
      // options.choices: a vertical list (Up/Down) that resolves with the chosen index, or false on Back.
      var actions = Kit.el('div', options.choices ? 'modal-choices' : 'modal-actions');
      var items = (options.choices || [options.cancel || 'Cancel', options.confirm || 'Confirm']).map(function (label) {
        return actions.appendChild(Kit.el('div', options.choices ? 'modal-choice' : 'modal-action', label));
      });
      panel.appendChild(actions);
      shade.appendChild(panel);
      root.appendChild(shade);
      // options.index: the choice focused first (a list's remembered answer).
      var start = options.choices ? Math.max(0, Math.min(items.length - 1, options.index || 0)) : 0;
      dialog = { node: shade, actions: items, choice: start, resolve: resolve, list: !!options.choices };
      items[start].classList.add('focused');
      scheduleGlass();
    });
  }
  function showExit() {
    openDialog({
      title: 'Exit Couch TV?',
      cancel: 'Stay',
      confirm: 'Exit'
    }).then(function (accepted) {
      if (accepted && window.tizen && window.tizen.application)
        window.tizen.application.getCurrentApplication().exit();
    });
  }
  function handleKey(code) {
    if (dialog) {
      if (code >= 37 && code <= 40) {
        dialog.actions[dialog.choice].classList.remove('focused');
        dialog.choice = dialog.list ? Math.max(0, Math.min(dialog.actions.length - 1, dialog.choice + (code === 40 ? 1 : -1))) :
          code === 39 || code === 40 ? 1 : 0;
        dialog.actions[dialog.choice].classList.add('focused');
        if (dialog.list) dialog.actions[dialog.choice].scrollIntoView({ block: 'nearest' });
        return true;
      }
      if (code === 13) {
        closeDialog(dialog.list ? dialog.choice : dialog.choice === 1);
        return true;
      }
      if (code === 10009) {
        closeDialog(false);
        return true;
      }
      return true;
    }
    if (loadingOn) {
      if (code === 10009) back();
      return true;
    }
    if (railFocused) {
      if (code === 37 || code === 39) {
        railIndex = Math.max(0, Math.min(nav.length - 1, railIndex + (code === 39 ? 1 : -1)));
        paintRail();
        return true;
      }
      if (code === 13 || code === 40) {
        if (nav[railIndex].key === activeNavKey()) focusScreen();
        else go(nav[railIndex].key);
        return true;
      }
      if (code === 10009) {
        if (activeNavKey() === 'home' && stack.length === 1) showExit();
        else go('home');
        return true;
      }
      return code === 38;
    }
    if (!current()) return false;
    if (current().screen.handleKey(code)) return true;
    // Up past the top of a screen reaches the tab bar; pushed pages (a title's details) have none.
    if (code === 38 && stack.length === 1) {
      focusRail();
      return true;
    }
    if (code === 10009) {
      back();
      return true;
    }
    return false;
  }
  function updateOnline() {
    if (offlineNode) offlineNode.hidden = navigator.onLine !== false;
  }
  function init(rootEl, source) {
    root = rootEl;
    data = source;
    root.textContent = '';
    root.classList.add('shell-root');
    stage = Kit.el('div', 'shell-stage');
    rail = Kit.el('nav', 'nav-rail');
    var brand = Kit.el('div', 'wordmark shell-brand', 'couch ');
    brand.appendChild(Kit.el('span', 'wordmark-accent', 'tv'));
    rail.appendChild(brand);
    for (var i = 0; i < nav.length; i++) {
      var item = Kit.el('div', 'nav-item nav-item-' + nav[i].key);
      item.appendChild(Kit.icon(nav[i].icon));
      item.appendChild(Kit.el('span', 'nav-label', nav[i].label));
      rail.appendChild(item);
      railItems.push(item);
    }
    railPill = Kit.Pill(rail);
    toastNode = Kit.el('div', 'shell-toast');
    loadingNode = Kit.el('div', 'shell-loading');
    var loaderNode = Kit.loader('');
    loadingLabel = loaderNode.lastChild;
    loadingNode.appendChild(loaderNode);
    offlineNode = Kit.el('div', 'offline-banner', "You're offline — check your connection");
    root.appendChild(stage);
    root.appendChild(rail);
    root.appendChild(offlineNode);
    root.appendChild(loadingNode);
    root.appendChild(toastNode);
    watchFocus();
    // Anything a key changes on screen; none at all means the key met an edge (handleKeyWithFeedback).
    changes = new MutationObserver(function () {});
    changes.observe(root, { attributes: true, childList: true, characterData: true, subtree: true });
    updateOnline();
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    if (data.onChange)
      data.onChange(function () {
        // Progress is saved every few seconds during playback; rebuilding rows behind the video
        // competes with it. The final save on close (player already closed) refreshes everything.
        if (window.Player && window.Player.isOpen()) return;
        for (var key in cache)
          if (Object.prototype.hasOwnProperty.call(cache, key) && cache[key].refresh)
            cache[key].refresh();
        for (var s = 0; s < stack.length; s++)
          if (stack[s].name === 'details' && stack[s].screen.refresh) stack[s].screen.refresh();
      });
    go('home');
  }
  function register(name, factory) {
    registry[name] = factory;
  }
  var api = {
    init: init,
    register: register,
    go: go,
    back: back,
    handleKey: handleKeyWithFeedback,
    release: function () { press(false); },
    toast: toast,
    loading: loading,
    confirm: openDialog,
    choose: openDialog,
    tuck: tuck
  };
  window.Shell = api;
})();
