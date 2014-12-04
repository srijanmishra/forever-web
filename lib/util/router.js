var _ = require('lodash'),
  path = require('path'),
  chalk = require('chalk'),
  fs = require('fs'),
  url = require('url');

var routes = []

// bind actions.
global.action = function (method, path, func) {
  if (typeof method == 'function') {
    func = method;
    method = 'get';
    path = func.name;
  } else if (typeof path == 'function') {
    func = path;
    path = func.name;
  }
  if (typeof method != 'string' || typeof path != 'string' || typeof func != 'function') {
    throw new Error('Arguments of action() should be one of `[FUNCTION]` / `[METHOD], [FUNCTION]` / `[METHOD], [PATH], [FUNCTION]`.')
  }
  routes.push({
    method: method,
    path: '/' + (!!~['index', 'home', 'main'].indexOf(__route_root) ? '':__route_root) + (path ? '/' + path : ''),
    fn: func
  });
};

// initialize.
module.exports = function (server, log) {
  var cwd = path.resolve(process.cwd(), 'web/routes');
  fs.readdirSync(cwd).forEach(function (f) {
    if(path.extname(f) != '.js'){
      return;
    }
    global.__route_root = path.basename(f, '.js');
    require(path.resolve(cwd, f));
    delete global.__route_root;
  });
  routes.forEach(function (route) {
    log.i('hook', chalk.bold.green(route.method.toUpperCase()), chalk.underline.grey(route.path));
    server[route.method](route.path, function(req, res, next){
      req.log = log;
      next();
    }, route.fn);
  });
};