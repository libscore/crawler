/****************
    Libraries
****************/

var FS = require("fs");
var Colors = require("colors");
var Async = require("async");
var kue = require('kue');
var cluster = require('cluster');

/*****************
    Arguments
*****************/

var Arguments = {
	startTime: process.argv[2],
	redisHost: process.argv[3]
};

/*****************
    Queue
*****************/

var jobs = kue.createQueue({
	redis: { host: Arguments.redisHost }
});
var clusterWorkerSize = require('os').cpus().length;

/*****************
    Variables
*****************/

var CRAWL_TIMEOUT = 60000;

var sites = [],
	totalSites = 0,
	failedSites = [];

/*****************
    Utilities
*****************/

/* Console and REST status reporting. */
function out (success, stage, message) {
	stage = stage.toString().toUpperCase();
	message = message || "";

	if (success) {
		if (/(string|number)/.test(typeof message)) {
			console.log("✓".bold.green, stage.bold, message.toString().toUpperCase().grey);
		} else {
			console.log("✓".bold.green, (stage + ":").bold, JSON.stringify(message).green);
		}
	} else {
		console.log((stage + ": " + JSON.stringify(message)).red.inverse);
	}
}

/*************
     Main
*************/

function crawl (site, callback) {
	var spawn = require("child_process").spawn;
	var crawler = spawn("node", [ "crawler.js", site.url, site.rank ]);
	var finished = false;

	setTimeout(function() {
		if (!finished) {
			require('child_process').exec("kill -9 " + crawler.pid);
		}
	}, CRAWL_TIMEOUT);

	crawler.on("close", function (code) {
		finished = true;

		switch (code) {
			case 0:
				out(true, "Crawl", "succeeded " + site.url);
			callback();

				break;

			case 1:
				out(false, "Crawl", "failed " + site.url);
				//failedSites.push(site);
				callback('Crawl failed');

				break;

			case null:
				out("false", "Crawl", "failed (error: killed) " + site.url);
				callback('Crawl failed - killed');
				//failedSites.push(site);
				break;
		}

	});
}

function spawnCrawls () {
	function reportCrawlsDone() {
		out(true, "Failed sites", failedSites || "none");
		out(true, "Stats", (totalSites - failedSites.length) + "/" + totalSites + " sites succeeded");
		out(true, "Done");
	}
	if (cluster.isMaster) {
	  for (var i = 0; i < clusterWorkerSize; i++) {
	    cluster.fork();
	  }
	} else {

		jobs.process('website', 3, function(job, done) {
			crawl(job.data, done);
		});
	}

}

/****************
      Init
****************/

out(true, "Running");
spawnCrawls();
