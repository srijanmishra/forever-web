var childProcess = require('child_process'),
    fs           = require('fs'),
    path         = require('path'),
    nssock       = require('nssocket'),
    _            = require('lodash'),
    async        = require('async'),
    stat         = require('./stat'),
    isWindows    = process.env.platform == 'win32';

/**
 * Forever lib.
 * @type {{}}
 */
var pm = module.exports = {};

/**
 * List available processes.
 * @param {String} sockPath
 * @param {Function} cb
 * @param {Boolean} ignoreMem
 */
pm.list = function(sockPath, cb, ignoreMem){
  var socks;
  try {
    var getTick = function(sockName){
      return parseFloat(sockName.slice(sockName.indexOf('.') + 1, sockName.lastIndexOf('.') - 3));
    };
    // Read socket paths and sort them by ctime.
    socks = fs.readdirSync(sockPath).filter(function(sock){
      return /\.sock$/.test(sock);
    }).sort(function(sock1, sock2){
      return getTick(sock1) - getTick(sock2);
    });
    getTick = null;
  } catch (err) {
    cb(err);
  }

  // Query information.
  async.mapSeries(socks, function(sock, next){
    var sp = path.join(sockPath, sock);
    isWindows && (sp = '\\\\.\\pipe\\' + sp);

    var socket = new nssock.NsSocket();
    socket.connect(sp, function(err){
      if (err) {
        return next(err);
      }

      socket.dataOnce(['data'], function(data){
        data.socket = sp;
        if(!ignoreMem) {
          stat.memoryUsage(data.pid, function(err, mem){
            data.memory = !err && mem ? mem : '0';
            socket.end();
            next(null, data);
          });
        }else{
          socket.end();
          next(null, data);
        }
      });

      socket.send(['data']);
    });

    socket.on('error', function(err){
      if (err.code === 'ECONNREFUSED') {
        // Remove dumps.
        fs.unlink(sp, function(){
          next();
        });
      } else {
        next();
      }
    });
  }, cb);
};

/**
 * Find process by uid.
 * @param {String} sockPath
 * @param {String} id
 * @param {Function} cb
 * @private
 */
pm._findById = function(sockPath, id, cb){
  pm.list(sockPath, function(err, procs){
    if(err){
      return cb(err);
    }
    if (!procs || procs.length == 0) {
      return cb(new Error('No pm processes running'));
    }

    var proc = _.find(procs, function(p){
      return p.uid == id;
    });

    if (!proc) {
      return cb(new Error('Cannot find pm process by UID: ' + id));
    }

    cb(null, proc);
  }, true);
}

/**
 * Trigger actions of process by uid.
 * @param {String} sockPath
 * @param {String} uid
 * @param {Function} cb
 */
pm.action = function(sockPath, action, uid, cb){
  pm._findById(sockPath, uid, function(err, proc){
    if(err){
      return cb(err);
    }

    pm._actionByUid(proc, action, cb);
  })
};

/**
 * Trigger actions of process by uid.
 * @param {Object} proc
 * @param {Function} cb
 * @private
 */
pm._actionByUid = function(proc, action, cb){
    var socket = new nssock.NsSocket();

    function onMessage(data) {
      socket.undata([action, 'ok'],    onMessage);
      socket.undata([action, 'error'], onMessage);
      socket.end();

      var message = data && data.message,
          type    = this.event.pop();

      if (type === 'error' && message && !/is not running/.test(message)) {
        return cb(new Error(message));
      }
      cb(null, data);
    }

    socket.connect(proc.socket, function (err) {
      if (err) {
        return cb(err);
      }

      socket.dataOnce([action, 'ok'],    onMessage);
      socket.dataOnce([action, 'error'], onMessage);
      socket.send([action]);
    });

    socket.on('error', function (err) {
      cb(err);
    });
};

/**
 * Tail logs.
 * @param {String} sockPath
 * @param {String} uid
 * @param {Function} each Iterator
 * @param {Function} cb
 * @returns {*}
 */
pm.tail = function(sockPath, uid, each, cb){
  // TODO: PR in demand, Windows doesn't support `tail`.
  if (isWindows) {
    return cb(new Error('Logs can not work on Windows.'));
  }
  // Fetch the proccess that we need.
  pm.list(sockPath, function(err, procs){
    if (err) {
      return cb(err);
    }
    if (!procs || procs.length == 0) {
      return cb(new Error('No pm processes running'));
    }

    var proc = _.find(procs, function(p){
      return p.uid == uid;
    });

    if (!proc) {
      return cb(new Error('Cannot find pm process by UID: ' + uid));
    }

    // Tail logs.
    var tail = pm._tailLogs(proc, each);
    if (tail instanceof Error) {
      cb(tail);
    } else {
      cb(null, tail);
    }
  }, true);
};
/**
 * Use linux `tail` command to grep logs.
 * @param {Object} proc
 * @param {Function} cb
 * @returns {*}
 * @private
 */
pm._tailLogs = function(proc, cb){
  if (!fs.existsSync(proc.logFile)) {
    return new Error('Log file "' + proc.logFile + '" does not exist.');
  }

  var tail = childProcess.spawn('tail', ['-f', '-n', 10, proc.logFile], {
    killSignal: 'SIGTERM',
    stdio     : [null, 'pipe', 'pipe']
  });

  // Use utf8 encoding.
  tail.stdio.forEach(function(stdio){
    stdio.setEncoding('utf8');
  });

  // stdout.
  tail.stdout.on('data', function(data){
    var lines = data.split(/\n/);
    lines = lines.filter(function(line){
      return !/^[\s\r\t]*$/.test(line);
    });
    if (lines.length > 0) {
      cb(null, lines);
    }
  });

  // handle error.
  tail.stderr.on('data', function(data){
    tail.disconnect();
    cb(new Error(data.toString().replace(/\n/, '')));
  });
  return tail;
}
