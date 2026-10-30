(function () {
  'use strict';
  // A person's films and shows (from a title's Cast row), most popular first.
  Shell.register('person', function (ctx) {
    var data = ctx.data, kit = ctx.kit, shell = ctx.shell;
    var el = kit.el('main', 'browse-screen person-screen'),
      track = kit.el('div', 'browse-track'),
      header = kit.el('div', 'browse-header'),
      title = kit.el('h1', 'person-name');
    header.appendChild(title);
    track.appendChild(header);
    var grid = kit.Grid({ columns: 3, onSelect: function (item) { shell.go('details', { id: item.id, item: item }); } });
    track.appendChild(grid.el);
    el.appendChild(track);
    var focused = false, token = 0;
    function updateFocus() {
      if (focused) grid.focus(); else grid.blur();
      var shift = focused ? Math.max(0, grid.el.offsetTop - 90) : 0;
      track.style.transform = 'translate3d(0,' + -shift + 'px,0)';
    }
    function show(params, returning) {
      if (returning) return;
      var request = ++token;
      title.textContent = params.name || '';
      grid.setItems([]);
      grid.setLoading(true);
      data.personCredits(params.id).then(function (items) {
        if (request !== token) return;
        grid.setLoading(false);
        grid.setItems(items);
        if (!items.length) grid.setEmpty('No films or shows listed for ' + (params.name || 'this person') + '.');
        updateFocus();
      }, function () {
        if (request !== token) return;
        grid.setError(function () { show(params, false); });
        updateFocus();
      });
    }
    return {
      el: el,
      show: show,
      hide: function () { focused = false; updateFocus(); el.hidden = true; },
      focus: function () { focused = true; updateFocus(); },
      hideFocus: function () { focused = false; updateFocus(); },
      handleKey: function (code) { return code === 10009 ? false : grid.handleKey(code); }
    };
  });
})();
