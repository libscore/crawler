var fs = require('fs');
var async = require('async');

var kue = require('kue')
  , jobs = kue.createQueue();

var data = fs.readFileSync('sites.txt', 'utf8');

var lines = data.split("\n");
var a = 0;
async.eachLimit(lines, 50, function (line, done) {
  a++;
  if (/,/.test(line)) {         
    var lineData = line.split(",");
    jobs.create('website', { url: lineData[1], rank: lineData[0] }).attempts(3).backoff( {delay: 60*1000, type:'fixed'} ).save(function(){
      console.log(a);
      done();

    });;
  } else {
    done();
  }
}, function(err){
    // if any of the saves produced an error, err would equal that error
    var totalSites = lines.length;
  console.log(totalSites)
});



//websiteQueue.process(function(job, done){

//});