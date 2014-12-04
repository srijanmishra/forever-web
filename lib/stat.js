var usage  = require('usage'),
    os     = require('os'),
    winCPU = require('windows-cpu');

/**
 * System states
 * @type {{hostname: *, platform: *, arch: *, release: *, cpus, uptime, memory}}
 */
var stat = module.exports = {
  /**
   * Hostname, e.g.: localhost, TjatseMacProBook.local...
   */
  hostname: os.hostname(),
  /**
   * Platform, e.g.: darwin, win32, linux...
   */
  platform: os.platform(),
  /**
   * Architecture, e.g.: 64, 32...
   */
  arch    : os.arch(),
  /**
   * Ver number of system.
   */
  release : os.release(),
  /**
   * List all CPUs.
   * @returns {*}
   */
  get cpus(){
    return os.cpus();
  },
  /**
   * Uptime.
   * @returns {*}
   */
  get uptime(){
    return os.uptime();
  },
  /**
   * System memory usage.
   * @returns {{free: *, total: *, percentage: number}}
   */
  get memory(){
    return {
      free      : os.freemem(),
      total     : os.totalmem(),
      percentage: Math.round(100 * (1 - os.freemem() / os.totalmem()))
    }
  }
};

/**
 * System CPU usage percentage (total).
 * @param fn
 */
stat.cpuUsage = function(fn){
  if (process.platform == 'win32') {
    winCPU.totalLoad(function(err, results){
      fn(err, results.reduce(function(p1, p2){
        return (p1 + (p2 || p1)) / 2;
      }).toFixed(2));
    })
  } else {
    setTimeout(function(ctx, stat1){
      var stat2 = ctx.cpuInfo(),
          perc = 100 * (1 - (stat2.idle - stat1.idle) / (stat2.total - stat1.total));
      fn(null, perc.toFixed(2));
    }, 1000, this, this.cpuInfo());
  }
};

/**
 * System CPU usage detail information.
 * @param fn
 * @returns {{idle: number, total: number}}
 */
stat.cpuInfo = function(fn){
  var cpus = this.cpus, idle = 0, total = 0;
  for (var i in cpus) {
    idle += cpus[i].times.idle;
    for (var k in cpus[i].times) {
      total += cpus[i].times[k];
    }
  }
  return {
    'idle' : idle,
    'total': total
  };
}