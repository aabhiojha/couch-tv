(function () {
  'use strict';
  function optional(path) {
    return new Promise(function (resolve) {
      var script = document.createElement('script');
      script.src = path;
      script.onload = resolve;
      script.onerror = resolve;
      document.body.appendChild(script);
    });
  }
  optional('js/screens/search.js')
    .then(function () {
      return optional('js/screens/details.js');
    })
    .then(function () {
      Shell.init(document.getElementById('app'), Data);
      document.addEventListener('keyup', function (event) { if (event.keyCode === 13) Shell.release(); });
      document.addEventListener('keydown', function (event) {
        var code = event.keyCode;
        if (code === 8 || code === 27) code = 10009;
        if (code === 32) code = 10252;
        if (Shell.handleKey(code)) event.preventDefault();
      });
    });
  window.DevMain = { data: Data };
})();
