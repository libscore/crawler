var child_process = require('child_process');
var kue = require('kue');
var request = require('request');

var CRAWL_TIMEOUT = 60000;
var CONCURRENCY = 3;


console.log("Running");
var jobs = kue.createQueue({
  redis: {
    host: 'api.libscore.com',
    auth: process.env.LIBSCORE_REDIS_PASS
  }
});
jobs.process('website', CONCURRENCY, function(job, done) {
  crawl(job.data, done);
});

setTimeout(function() {
  jobs.shutdown(CRAWL_TIMEOUT, function(err) {
    process.exit(0);
  });
  dumpFile.unwatch();
}, 60*60*1000);  // Kill ourselves after an hour to prevent long running process issues


function crawl(site, callback) {
  var crawler = child_process.spawn("node", [ "crawler.js", site.domain, site.id ]);

  var killTimer = setTimeout(function() {
    crawler.kill();
  }, CRAWL_TIMEOUT);

  crawler.on("close", function (code) {
    clearTimeout(killTimer);
    switch (code) {
      case 0:
        console.log("Success " + site.domain);
        callback();
        break;
      case 1:
        console.log("Failed " + site.domain);
        callback('Crawl failed');
        break;
      case null:
        console.log("Killed " + site.domain);
        callback('Crawl failed - killed');
        break;
    }
  });
}
