var child_process = require('child_process');
var Tail = require('tail').Tail;
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

var dumpFile = new Tail('dump.json');
dumpFile.on('line', function(line) {
  var message = JSON.parse(line);
  request({
    method: 'POST',
    uri: 'http://api.libscore.com/sites/' + message.id,
    json: message.data
  })
});

setTimeout(function() {
  jobs.shutdown(CRAWL_TIMEOUT, function(err) {
    process.exit(0);
  });
  dumpFile.unwatch();
}, 60*60*1000);  // Kill ourselves after an hour to prevent long running process issues


function crawl(site, callback) {
  var crawler = child_process.spawn("node", [ "crawler.js", site.domain, site.rank, site.id ]);

  var killTimer = setTimeout(function() {
    crawler.kill();
  }, CRAWL_TIMEOUT);

  crawler.on("close", function (code) {
    clearTimeout(killTimer);
    switch (code) {
      case 0:
        console.log("Crawl succeeded " + site.domain);
        callback();
        break;
      case 1:
        console.log("Crawl failed " + site.domain);
        callback('Crawl failed');
        break;
      case null:
        console.log("Crawl failed (error: killed) " + site.domain);
        callback('Crawl failed - killed');
        break;
    }
  });
}
