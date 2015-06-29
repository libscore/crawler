/****************
    Libraries
****************/

var child_process = require('child_process');
var colors = require("colors");
var kue = require('kue');

/*****************
    Queue
*****************/

var jobs = kue.createQueue({
	redis: { host: '45.55.17.121' }
});
var clusterWorkerSize = require('os').cpus().length;

var CRAWL_TIMEOUT = 60000;
var CONCURRENCY = 3;


out(true, "Running");
jobs.process('website', CONCURRENCY, function(job, done) {
	crawl(job.data, done);
});


function out(success, stage, message) {
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

function crawl(site, callback) {
	var crawler = child_process.spawn("node", [ "crawler.js", site.domain, site.rank ]);

	var killTimer = setTimeout(function() {
		crawler.kill();
	}, CRAWL_TIMEOUT);

	crawler.on("close", function (code) {
		clearTimeout(killTimer);
		switch (code) {
			case 0:
				out(true, "Crawl", "succeeded " + site.domain);
				callback();
				break;
			case 1:
				out(false, "Crawl", "failed " + site.domain);
				callback('Crawl failed');
				break;
			case null:
				out("false", "Crawl", "failed (error: killed) " + site.domain);
				callback('Crawl failed - killed');
				break;
		}
	});
}
