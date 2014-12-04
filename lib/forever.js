var childProcess = require('child_process'),
    fs           = require('fs'),
    path         = require('path'),
    nssock       = require('nssocket'),
    _            = require('lodash'),
    async        = require('async'),
    isWindows    = process.env.platform == 'win32';

/**
 * Forever lib.
 * @type {{}}
 */
var forever = module.exports = {};

/**
 * Tail logs.
 * @param {String} sockPath
 * @param {String} uid
 * @param {Function} each Iterator
 * @param {Function} cb
 * @returns {*}
 */
forever.tail = function(sockPath, uid, each, cb){
  // TODO: PR in demand, Windows doesn't support `tail`.
  if(isWindows){
    return cb(new Error('Logs can not work on Windows.'));
  }
  // Fetch the proccess that we need.
  forever.list(sockPath, function(err, procs){
    if (err) {
      return cb(err);
    }
    if (!procs || procs.length == 0) {
      return cb(new Error('No forever processes running'));
    }

    var proc = _.find(procs, function(p){
      return p.uid == uid;
    });

    if (!proc) {
      return cb(new Error('Cannot find forever process by UID: ' + uid));
    }

    // Tail logs.
    var tail = forever._tailLogs(proc, each);
    if(tail instanceof Error) {
      cb(tail);
    }else{
      cb(null, tail);
    }
  });
};
/**
 * Use linux `tail` command to grep logs.
 * @param {Object} proc
 * @param {Function} cb
 * @returns {*}
 * @private
 */
forever._tailLogs = function(proc, cb){
  if (!fs.existsSync(proc.logFile)) {
    return new Error('Log file "' + proc.logFile + '" does not exist.');
  }

  var tail = childProcess.spawn('tail', ['-f', '-n', 10, proc.logFile], {
    killSignal: 'SIGTERM',
    stdio: [null, 'pipe', 'pipe']
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
    if(lines.length > 0){
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

/**
 * List available processes.
 * @param {String} sockPath
 * @param {Function} cb
 */
forever.list = function(sockPath, cb){
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
        next(null, data);
        socket.end();
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

