/****************
    Libraries
****************/

var FS = require("fs");
var Colors = require("colors");
var Async = require("async");

/*****************
    Arguments
*****************/

var Arguments = {
		concurrency: process.argv[2],
		sitesFile: process.argv[3],
		siteOffset: process.argv[4]
	};

/*****************
    Variables
*****************/

var CRAWL_TIMEOUT = 30000;

var siteOffsetReached = false,
	sites = [],
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

function processSitesFile () {
	FS.readFile(Arguments.sitesFile, { encoding: "utf-8" }, function (error, data) {
		if (error) {
			out(false, "Could not read sites file", Arguments.sitesFile);
		} else {
			out(true, "Read sites file", Arguments.sitesFile);

			var lines = data.split("\n");

			for (var i = 0; i < lines.length; i++) {
				if (/,/.test(lines[i])) {					
					var lineData = lines[i].split(",");

					sites.push({ url: lineData[1], rank: lineData[0] });
				}
			}

			totalSites = sites.length;

			spawnCrawls(sites);
		}
	});
}

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
				break;

			case 1:
				out(false, "Crawl", "failed " + site.url);
				failedSites.push(site);
				break;

			case null:
				out("false", "Crawl", "failed (error: killed) " + site.url);
				failedSites.push(site);
				break;
		}

		callback();
	});
}

function spawnCrawls (sites) {
	function reportCrawlsDone() {
		out(true, "Failed sites", failedSites || "none");
		out(true, "Stats", (totalSites - failedSites.length) + "/" + totalSites + " sites succeeded");
		out(true, "Done");
	}

	if (Arguments.siteOffset) {
		for (var i = 0; i < sites.length; i++) {
			if (sites[i].url === Arguments.siteOffset) {
				var sitesSliced = sites.slice(sites[i]);
				break;
			}
		}

		sites = sitesSliced;
	} 

	Async.eachLimit(sites, Arguments.concurrency, crawl, function(error) {
		if (error) {
			throw new Error(error);
		}

		if (failedSites.length) {
			out(true, "Failed sites on first try", failedSites.length);
			out(true, "Re-crawling failed sites...");

			sites = failedSites.slice(0);
			failedSites = [];

			Async.eachLimit(sites, Arguments.concurrency, crawl, function() {
				reportCrawlsDone();
			});
		} else {
			reportCrawlsDone();
		}
	});
}

/****************
      Init
****************/

out(true, "Running");
processSitesFile();