var fs = require('fs');


var kue = require('kue')
  , jobs = kue.createQueue();

var data = fs.readFileSync('sites.txt', 'utf8');

var lines = data.split("\n");

for (var i = 0; i < lines.length; i++) {
  if (/,/.test(lines[i])) {         
    var lineData = lines[i].split(",");
    jobs.create('website', { url: lineData[1], rank: lineData[0] }).attempts(10).backoff( {delay: 60*1000, type:'fixed'} ).save(function(){
      console.log(i);
    });;
  }
}

var totalSites = lines.length;
console.log(totalSites)

//websiteQueue.process(function(job, done){

//});