var express = require('express'),
  swig = require('swig'),
  path = require('path'),
  chalk = require('chalk'),
  Monitor = require('../lib/mon'),
  Debug = require('../lib/util/debug');

module.exports = runServer;

function runServer(port, debug) {
  var app = express();
  var protected = false
  // all environments
  app.set('view engine', 'html');
  app.set('views', path.join(__dirname, 'views'));
  app.engine('html', swig.renderFile);

  var mon = Monitor({
    sockio: io,
    debug: !!debug
  });
  if (mon._config.get("username") != undefined && mon._config.get("password") != undefined) { protected = true }
  if (protected) {
  app.use(function(req, res, next) {
    var auth;
    // check whether an autorization header was send
    if (req.headers.authorization) {
      // only accepting basic auth, so:
      // * cut the starting "Basic " from the header
      // * decode the base64 encoded username:password
      // * split the string at the colon
      // -> should result in an array
      auth = new Buffer(req.headers.authorization.substring(6), 'base64').toString().split(':');
    }

    // checks if:
    // * auth array exists
    // * first value matches the expected user
    // * second value the expected password
    if (!auth || auth[0] !== mon._config.get('username') || auth[1] !== mon._config.get('password')) {
        // any of the tests failed
        // send an Basic Auth request (HTTP Code: 401 Unauthorized)
        res.statusCode = 401;
        // MyRealmName can be changed to anything, will be prompted to the user
        res.setHeader('WWW-Authenticate', 'Basic realm="MyRealmName"');
        // this will displayed in the browser when authorization is cancelled
        res.end('Unauthorized');
    } else {
        // continue with processing, user was authenticated
        next();
    }
 });
}

  app.use(express.static(path.join(__dirname, 'public')));

  var log = Debug(({namespace: 'forever-web', debug: !!debug}));
  // router
  require('../lib/util/router')(app, log);

  if (!port || isNaN(port)) {
    port = 8088;
  }

  var server = require('http').Server(app);
  var io = require('socket.io')(server);
  server.listen(port);
  log.i('http', 'Web server of', chalk.bold.underline('Nodejitsu/forever'), 'is listening on port', chalk.bold(port));

   mon = Monitor({
    sockio: io,
    debug: !!debug
  });

  mon.run();
}