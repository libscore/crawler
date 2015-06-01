var async = require('async');

var kue = require('kue')
  , queue = kue.createQueue();

kue.Job.rangeByState('failed', 0, 1000, 'asc', function(err, jobs) {
  async.each(jobs, function(job, done) {
    queue.create('website', { url: job.data.url, rank: job.data.rank }).attempts(3).backoff( {delay: 60*1000, type:'fixed'} ).save(function(){
      job.remove(done);
    });
  }, function(err) {
    console.log('Done', err);
  });
});
