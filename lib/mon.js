var fs       = require('fs'),
    path     = require('path'),
    nconf    = require('nconf'),
    Debug    = require('./util/debug'),
    stat     = require('./stat'),
    chokidar = require('chokidar'),
    _        = require('lodash'),
    ansiHTML = require('ansi-html'),
    chalk    = require('chalk'),
    pm       = require('./pm');

module.exports = Monitor;

/**
 * Monitor of project monitor web.
 * @param options
 * @returns {Monitor}
 * @constructor
 */
function Monitor(options){
  if (!(this instanceof Monitor)) {
    return new Monitor(options);
  }

  // Initialize...
  this._init(options);
};

/**
 * Initialize options and configurations.
 * @private
 */
Monitor.prototype._init = function(options){
  options = options || {};
  // bind default options.
  _.defaults(options, {
    refresh     : 5000,
    manipulation: true
  });

  // Get root directory of forever.
  var foreverRoot = process.env.FOREVER_ROOT || path.join(process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'], '.forever');

  // Make sure exist
  if (!fs.existsSync(foreverRoot)) {
    throw new Error('Forever root can not be located, try to set env by `export FOREVER_ROOT=[ROOT]`.');
  }

  options.foreverRoot = foreverRoot;

  // Bind socket.io server to context.
  if (options.sockio) {
    this._sockio = options.sockio;
    delete options.sockio;
  }

  // Bind to context.
  this.options = options;
  Object.freeze(this.options);

  // Initialize configurations.
  this._config = new nconf.File({file: path.resolve(this.options.foreverRoot, 'forever-web.json')});

  // Set configurations
  this.config('forever', this._config.get('forever') || this.options.forever || this.options.foreverRoot);
  this.config('refresh', this._config.get('refresh') || this.options.refresh);
  this.config('manipulation', this._config.get('manipulation') || this.options.manipulation || true);

  // Loger
  this._log = Debug({
    namespace: 'monitor-web',
    debug    : !!this.options.debug
  });
};

/**
 * Operations of configuration.
 * @example:
 *    set config    : mon.config('key', 'value');
 *    clear config  : mon.config('key', null);
 *    get config    : mon.config('key');
 * @param {String} key
 * @param {Mixed} value
 * @returns {*}
 */
Monitor.prototype.config = function(key, value){
  if (!key) {
    return;
  }
  // Load config from File.
  this._config.loadSync();

  if (typeof value == 'undefined') {
    // Get config.
    return this._config.get(key);
  } else if (value == null) {
    // Clear config.
    this._config.clear(key);
    // Reset to default if necessary.
    if (key == 'refresh') {
      value = 5000;
    } else if (key == 'manipulation') {
      value = true;
    }
    value && this._config.set(key, value);
    return this._config.saveSync();
  }

  // Make sure value in a correct type.
  if (typeof value != 'boolean') {
    if (!isNaN(value)) {
      value = parseFloat(value);
    } else if (/^(true|false)$/.test(value)) {
      value = (value == 'true');
    }
  }
  this._config.set(key, value);
  // Save it.
  this._config.saveSync();
};

/**
 * Run socket.io server.
 */
Monitor.prototype.run = function(){
  if (!this._sockio) {
    return;
  }
  this._noClient = true;

  this._beats = {};
  // Watch `sock` directory
  this._watchSocks();

  // Listen connection event.
  this._sockio.on('connection', this._connectSock.bind(this));
}

/**
 * Connection event.
 * @param {Socket} socket
 * @private
 */
Monitor.prototype._connectSock = function(socket){
  // Still has one client connects to server at least.
  this._noClient = false;
  socket.on('disconnect', function(){
    // Check connecting client.
    this._noClient = _.size(this._sockio.sockets.connected) <= 0;
  }.bind(this));

  // Tail logs
  socket.on('tail_beat', this._tailLogs.bind(this, socket));
  socket.on('tail_destroy', this._checkTailBeat.bind(this, socket.id))

  // Trigger actions of process.
  socket.on('action', function(action, id){
    pm.action(path.join(this.config('forever'), 'sock'), action, id, function(err, data){
      if (err) {
        this._log.e(action, err.message);
        return socket.emit('action', id, err.message);
      }
    }.bind(this));
  }.bind(this));

  // If processes have been fetched, emit the last to current client.
  this._procs && socket.emit(typeof this._procs == 'string' ? 'info' : 'procs', this._procs);
  // If sysStat have been fetched, emit the last to current client.
  this._sysStat && this._broadcast('system_stat', this._sysStat);

  // Grep system states once and again.
  (this._status != 'R') && this._nextTick(this.config('refresh') || 5000);
}

/**
 * Show logs by uid.
 * @param {socket.io} socket
 * @param {String} uid
 * @private
 */
Monitor.prototype._tailLogs = function(socket, uid){
  var beat;
  if ((beat = this._beats[uid])) {
    (!beat.sockets[socket.id]) && (beat.sockets[socket.id] = socket);
    beat.tick = Date.now();
    this._beats[uid] = beat;
    return;
  }

  this._log.i('tail', uid);

  this._beats[uid] = {
    tick   : Date.now(),
    sockets: {}
  };
  this._beats[uid].sockets[socket.id] = socket;

  var sockPath = path.join(this.config('forever'), 'sock');

  function broadcast(data){
    var beat = this._beats[uid];
    if (!beat) {
      this._log.e('beat does not exist.');
      return;
    }
    for (var key in beat.sockets) {
      beat.sockets[key].emit('tail', data)
    }
  }

  function emitError(err){
    broadcast.call(this, {
      uid: uid,
      msg: '<span style="color: #ff0000">Error: ' + err.message + '</span>'
    });
  }

  // Verify directory exist or not.
  if (!fs.existsSync(sockPath)) {
    emitError.call(this, 'The socket directory does not exist, it is due to locate forever root failed, try to set it by `$ fw set forever [ROOT]`');
  }

  pm.tail(sockPath, uid, function(err, lines){
    if (err) {
      return emitError.call(this, err);
    }
    // Emit tail to clients.
    broadcast.call(this, {
      uid: uid,
      msg: lines.map(function(line){
        line = line.replace(/\s/, '&nbsp;');
        return '<span>' + ansiHTML(line) + '</span>';
      }).join('')
    });
  }.bind(this), function(err, tail){
    if (err) {
      return emitError.call(this, err);
    }

    this._log.d(chalk.magenta('tail'), 'tailing...');
    this._beats[uid].tail = tail;
    this._checkTailBeat();
  }.bind(this));
};

/**
 * Check beats.
 * @returns {number}
 * @private
 */
Monitor.prototype._checkTailBeat = function(socketId, uid){
  this._beatTimer && clearTimeout(this._beatTimer);
  this._beatTimer = null;

  function destroyTail(beat, key){
    beat.tail && beat.tail.kill('SIGTERM');
    this._log.d(chalk.magenta('tail'), chalk.red('destroy'), key);
    delete this._beats[key];
  }

  if (socketId && uid) {
    this._log.i('tail', chalk.red('destroy'), uid, socketId);
    var beat = this._beats[uid];
    if (beat && beat.sockets) {
      delete beat.sockets[socketId];
    }
    if (Object.keys(beat.sockets).length == 0) {
      destroyTail.call(this, beat, uid);
    }
  } else {
    for (var key in this._beats) {
      var beat = this._beats[key];
      // Kill timeout beats.
      if (Date.now() - beat.tick > 4000) {
        destroyTail.call(this, beat, key);
      }
    }
  }
  // Loop
  if (Object.keys(this._beats).length > 0) {
    this._log.d(chalk.magenta('tail'), 4000);
    this._beatTimer = setTimeout(this._checkTailBeat.bind(this), 4000);
  }
};

/**
 * Grep system state loop
 * @param {Number} tick
 * @private
 */
Monitor.prototype._nextTick = function(tick, continuously){
  // Return it if worker is running.
  if (this._status == 'R' && !continuously) {
    return;
  }
  // Running
  this._status = 'R';
  this._log.d(chalk.magenta('monitor'), tick);
  // Grep system state
  this._systemStat(function(){
    // If there still has any client, grep again after `tick` ms.
    if (!this._noClient) {
      return setTimeout(this._nextTick.bind(this, tick, true), tick);
    }
    // Stop
    delete this._status;
    this._log.d(chalk.magenta('monitor'), chalk.red('destroy'));
  }.bind(this));
}

/**
 * Grep system states.
 * @param {Function} cb
 * @private
 */
Monitor.prototype._systemStat = function(cb){
  stat.cpuUsage(function(err, cpu_usage){
    if (err) {
      // Log only.
      this._log.e('sockio', 'Can not load system/cpu/memory information: ' + err.message);
    } else {
      // System states.
      this._sysStat = _.defaults(_(stat).pick('cpus', 'arch', 'hostname', 'platform', 'release', 'uptime', 'memory').clone(), {
        cpu: cpu_usage
      });
      this._broadcast('system_stat', this._sysStat);
    }
    cb();
  }.bind(this));
}

/**
 * Watch `sock` directory.
 * @private
 */
Monitor.prototype._watchSocks = function(){
  var root = this.config('forever'),
      pidPath = path.join(root, 'pids'),
      sockPath = path.join(root, 'sock');

  // Verify directory exist or not.
  if (!fs.existsSync(sockPath) || !fs.existsSync(pidPath)) {
    this._procs = 'The socket directory does not exist, it is due to locate forever root failed, try to set it by `$ fw set forever [ROOT]`';
    return this._broadcast('info', this._procs);
  }

  this._log.i('chokidar', 'watching', pidPath);

  // Chokidar doesn't watch the `0 byte size` file at all, so we try to watch `pids` directory.
  // And if there has any changes, try to get sockets from `sock`.
  chokidar.watch(pidPath, {
    ignored   : false,
    persistent: true
  }).on('all', function(e, p){
    this._log.i('chokidar', e, p);

    // Avoid refresh bomb.
    if (this._throttle) {
      clearTimeout(this._throttle);
    }
    this._throttle = setTimeout(function(ctx){
      ctx._throttle = null;
      ctx._refreshProcs(sockPath);
    }, 500, this);
  }.bind(this));
};

/**
 * Refresh processes
 * @private
 */
Monitor.prototype._refreshProcs = function(sockPath){
  pm.list(sockPath, function(err, procs){
    if (err) {
      return this._broadcast('info', 'Error: ' + err.message);
    }

    // Emit to client
    this._broadcast('procs', this._procs = procs);
  }.bind(this))
};

/**
 * Broadcast to all connected clients.
 * @param event
 * @param data
 * @private
 */
Monitor.prototype._broadcast = function(event, data){
  this._sockio.sockets.emit(event, data);
};