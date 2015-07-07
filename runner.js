var child_process = require('child_process');
var kue = require('kue');
var request = require('request');

var CRAWL_TIMEOUT = 60000;
var CONCURRENCY = 100;

var timeout = false;

console.log("Running");
var jobs = kue.createQueue({
  redis: {
    host: '45.55.11.15',
    auth: process.env.LIBSCORE_REDIS_PASS
  }
});
jobs.process('website', CONCURRENCY, function(job, done) {
  crawl(job, done);
});

setTimeout(function() {
  var timeout = true;
  jobs.shutdown(CRAWL_TIMEOUT, function(err) {
    // Exiting process or even trying to kill them is not enough to recycle
    // stuck phantom instances
    child_process.spawn("shutdown", ['-r', 'now']);
  });
}, 10*60*1000);  // Kill ourselves after 10 minutes to prevent long running process issues


function crawl(job, callback) {
  var crawler = child_process.spawn("node", [ "crawler.js", job.data.domain, job.data.id ], { detached: true });

  var killTimer = setTimeout(function() {
    process.kill(-crawler.pid, 'SIGKILL');
  }, CRAWL_TIMEOUT);

  crawler.on("close", function (code) {
    clearTimeout(killTimer);
    switch (code) {
      case 0:
        console.log("Success " + job.data.domain, job.id);
        callback();
        break;
      case 1:
        console.log("Failed " + job.data.domain, job.id);
        callback('Crawl failed');
        break;
      case null:
        console.log("Killed " + job.data.domain, job.id);
        callback('Crawl failed - killed');
        break;
    }
  });
}
