/****************
    Libraries
****************/

/* jQuery must be initialized with a window object, hence the jsdom shim. */
var jQuery = require("jquery")(require("jsdom").jsdom().parentWindow);
var URL = require("url");
var Phantom = require("phantom");
var Colors = require("colors");
var FS = require("fs");

/*****************
    Constants
*****************/

/* For increased website compatability, change Phantom's proprietary user agent to Chrome's (standard, version found below). */
var PHANTOM_USERAGENT_DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_9_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/37.0.2062.122 Safari/537.36";
/* iPhone 4 useragent. */
var PHANTOM_USERAGENT_MOBILE = "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_2_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8C148 Safari/6533.18.5";
/* Time (in ms) that each of the page's individual resources must load within before its request is forcefully cancelled. */
var PHANTOM_RESOURCE_TIMEOUT = 3000;
/* Time (in ms) to wait after DOMContentLoaded for asynchronous scripts to load. */
/* Note: There's no foolproof way of doing this, so we choose 3000ms, which sites load within 99% of the time. */
var PHANTOM_EVALUATE_DELAY = 3000;
/* To avoid crawler sabotage (sites that cause it to run indefinitely), we forecfully exit at some point. */
var GLOBAL_TIMEOUT = 30000;

/* Deprecated jQuery properties for both the jQuery global and the fn method. */
/* Note: Updated as of jQuery 2.1.1. */
var JQUERY_DEPRECATED = {
		Utility: [ "isNaN", "_Deferred", "attrFix", "migrateReset", "migrateTrace", "migrateWarnings", "migrateMute", "_mark",
		           "_unmark", "bindReady", "boxModel", "curCSS", "getText", "handleError", "httpData", "httpNotModified", "httpSuccess",
		           "nth", "props", "cache", "clean", "attrFn", "browser", "deletedIds", "fragments", "noData", "sub", "uaMatch", "uuid" ],
		Fn: [ "live", "die", "_toggle", "_load", "setArray" ]
	};

/***************
    Process
***************/

/* Terminate the connected Phantom instance when node exits abruptly. */
process.on("exit", disconnectFromPage);

setTimeout(function() {
	throw new Error ("global timeout exceeded");
}, GLOBAL_TIMEOUT);

/*****************
    Arguments
*****************/

var Arguments = {
		url: process.argv[2],
		rank: process.argv[3],
		isDump: !!process.argv[3]
	};

/*****************
    Utilities
*****************/

/* Console and REST status reporting. */
function out (success, stage, message) {
	stage = stage.toString().toUpperCase();
	message = message || "";

	if (success) {
		if (stage !== "DOWNLOADED" && /(string|number)/.test(jQuery.type(message))) {
			console.log("✓".bold.green, stage.bold, message.toString().toUpperCase().grey);
		} else {
			console.log("✓".bold.green, (stage + ":").bold, JSON.stringify(message).green);
		}
	} else {
		console.log((stage + ": " + JSON.stringify(message)).red.inverse);
		/* Ensure all errors bubble to an exit code of 1 so that the process runner can respond accordingly. */
		process.exit(1);
	}
}

/*****************
    Baselines
*****************/

var baselines = {
		window: {},
		jQuery: {}
	};

function evaluateBaselines (windowObj) {
	if (jQuery.isPlainObject(windowObj) && !jQuery.isEmptyObject(windowObj) ) {
		/* Deprecated jQuery properties are stubbed on our baseline jQuery to prevent false positives
		   resulting from jQuery version changes. */
		JQUERY_DEPRECATED.Utility.forEach(function(value) { jQuery[value] = null; });
		JQUERY_DEPRECATED.Fn.forEach(function(value) { jQuery.fn[value] = null; });

		baselines.window = windowObj;
		baselines.jQuery = jQuery;

		out(true, "baseline", "window object, jquery object");
	} else {
		out(false, "baseline", "did not receive window object");
	}
}

/**************
     Page
**************/

var Page = {
		url: Arguments.url || "julian.local:5757/velocity/bugfix.html",
		/* Keep track of whether the page is currently going through a mobile useragent pass. */
		isMobilePass: false,
		mobileRedirectDetected: null,
		/* All the processed page library data. */
		libs: {
			/* Third-party global functions (or objects that contain functions) that either start
			   with a capital or have a .version property. */
			window: { 
				mobile: [],
				desktop: []
			},
			/* Third-party jQuery utility and $.fn functions. */
			jQuery: { 
				mobile: [],
				desktop: []
			},
			/* Cross-domain, ./, lib(s)/, plugin(s)/, vendor(s)/, or external(s)/ modules required via
			   RequireJS that don't end in .css, .json, or .html. */
			modules: { 
				mobile: [],
				desktop: []
			},
			/* Cross-domain scripts that weren't injected by RequireJS. */
			scripts: { 
				mobile: [],
				desktop: []
			}
		}
	};

function injectIntoPage () {
	/******************
	    Injections
	******************/

	/* Shim the Function.bind method that React requires but Phantom's version of webkit does not have. */
	pageInstance.injectJs("./phantomjs-react-shim.js", function(data) {
		out(true, "inject", "react.js shim");
	});
}

function evaluatePageData () {
	/* Wrap all in-browser logic in a try/catch so that we can return fatal errors to Phantom for output. */
	try {
		/* Note: The bulk of variable evaluation happens within the page's environment since node-phantom's JSON stringification
		   process between its submodules causes functions to lose their properties. */
		return (function() {
			/****************
			    Variables
			****************/

			/* Whitelisted popular libraries (top 250 GitHub front-end JavaScript projects as of 10/02/2014) that
			   don't start with a capital and don't have a .version property. */
			/* Note: If libscore fails to detect a library, ask the author to add a .version property! */
			var LIBRARY_WHITELIST = [
					"jQuery", "$", "bootstrap", "socket", "impress", "yepnope",
					"hljs", "videojs", "timeline", "ace", "respond", "picturefill",
					"key" /* keymaster */, "alertify", "scrollReveal", "imagesLoaded",
					"responsiveNav", "katex", "riot"
				];

			var evaluatedData = {
					window: [],
					jQueryUtility: [],
					jQueryFn: [],
					modules: [],
					scripts: []
				};

			var rHttp = /^((https?:\/\/)|(\/\/))/i;

			/* Port of jQuery's $.type for use on pages that don't have jQuery. */
			function Type (variable) {
				var class2type = {},
					toString = class2type.toString,
					types = "Boolean Number String Function Array Date RegExp Object Error".split(" ");

				for (var i = 0; i < types.length; i++) {
					class2type[ "[object " + types[i] + "]" ] = types[i].toLowerCase();
				}

				if (variable == null) {
					return variable + "";
				}

				return typeof variable === "object" || typeof variable === "function" ?
					class2type[ toString.call(variable) ] || "object" :
					typeof variable;
			}

			/**************
			    Modules
			**************/

			/* RequireJS stores all loaded modules on a .contexts property. This property can be in one of two places depending on the version of requirejs. */
			var requirejsContexts = window.requirejs && (requirejs.contexts || (requirejs.s && requirejs.s.contexts));
			var seajsModules = window.seajs && window.seajs.cache;
			var moduleContexts = (requirejsContexts && requirejsContexts._.defined) || seajsModules;

			if (Type(moduleContexts) === "object") {
				for (var moduleName in moduleContexts) {
					var moduleNamePassed = false;
					/* Exclude non-JavaScript page files. */
					var isBlacklistedFiletype = /\.(css|json|html)$/i.test(moduleName);
					var isJavaScriptFile = /\.js$/i.test(moduleName);
					var isInSubfolder = moduleName.match(/\//g);
					/* If the module is located in a subdirectory, only accept it if the subdirectory name is commonly associated with vendor libraries. */
					/* Note: Manual tests have shown that this covers 98%+ of module directory configurations. Chances of match misses is certainly
					   non-zero, but false positive occurrences are hugely reduced. We accept this tradeoff. */ 
					var whitelistedSubfolder = "(lib|vendor|plugin|external)s?";
					var containsWhitelistedSubfolder = new RegExp("\\/" + whitelistedSubfolder + "\\/", "i");
					var isInWhitelistedSubfolder = new RegExp("^(js\\/)?" + whitelistedSubfolder + "\\/", "i");

					if (!isBlacklistedFiletype) {
						/* Note: SeaJS acts as an external script loader, not a pre-processed bundle loader. */
						if (seajsModules) {
							/* For SeaJS, accept all external script links that contain a whitelisted vendor subfolder. */
							/* Note: Unlike with RequireJS, where we can efficiently remove false positives due to being strict about vender subfolder 
							   hierarchy, we have to be looser with full-path external links since they aren't relative and often contain arbitrary
							   subfolder names. */
							if (isJavaScriptFile && containsWhitelistedSubfolder.test(moduleName)) {
								/* Extract just the file name from the path and remove the extension. */
								moduleName = moduleName.split("/")[moduleName.split("/").length - 1].split(/(\.min)?\.js$/i)[0];
								moduleNamePassed = true;
							}
						} else if (requirejsContexts) {
							/* For RequireJS, accept all internal links within a whitelisted vendor subfolder. */
							if (!rHttp.test(moduleName) && ((isInSubfolder && isInWhitelistedSubfolder.test(moduleName)))) {
								/* Extract the last part of the path name (the actual file name). */
								moduleName = moduleName.split("/")[moduleName.split("/").length - 1];
								moduleNamePassed = true;
							}
						}
					}

					if (moduleNamePassed === true) {
						evaluatedData.modules.push(moduleName);
					}
				}
			}

			/***************
			    Scripts
			***************/

			/* Grab all scripts with a src attribute. */
			var scripts = document.querySelectorAll("script[src]");
			for (var i = 0; i < scripts.length; i++) {
				/* Ensure the script is external (internal scripts would have already been detected via the other sniffs) and that it wasn't loaded by requirejs
				   (which has also already been sniffed for). */
				if (rHttp.test(scripts[i].getAttribute("src")) && !scripts[i].getAttribute("data-requiremodule")) {
					evaluatedData.scripts.push(scripts[i].getAttribute("src"));
				}
			}

			/**********************
			    Window & jQuery 
			**********************/

			function processWindowVariable (globalProperty) {
				var key = thirdPartyGlobal.key,
					value = thirdPartyGlobal.value;

				/* jQuery ($) variables are handled separately. */
				if (key === "jQuery" || key === "$") {
					/* Dumbly confirm a genuine copy of jQuery by checking for the .fn array. */
					if (value && value.fn !== undefined && value.fn.length !== undefined) {
						/* Log all jQuery utility variables. */
						for (var i in value) {
							evaluatedData.jQueryUtility.push(i);
						}

						/* Log all jQuery .fn variables. */
						for (var i in value.fn) {
							evaluatedData.jQueryFn.push(i);
						}
					}
				} else {
					evaluatedData.window.push(key);
				}
			}

			var thirdPartyGlobals = Object.keys(window);
			for (var i = 0; i < thirdPartyGlobals.length; i++) {
				var thirdPartyGlobal = { key: thirdPartyGlobals[i], value: window[thirdPartyGlobals[i]] };

				if (thirdPartyGlobal.value) {
					var descentStart = Date.now();

					var isWindowAlias = /^(top|window)$/.test(thirdPartyGlobal.key);
					var hasVersionProperty = thirdPartyGlobal.value.version || thirdPartyGlobal.value.VERSION;
					var startsWithCapital = /^[A-Z]/.test(thirdPartyGlobal.key);
					var isWhitelistedLibrary = (LIBRARY_WHITELIST.indexOf(thirdPartyGlobal.key) !== -1);

					/* Exclude properties that alias to the window object, and ensure that the property has either a .version, starts with a Capital,
					   or is a whitelisted library (which has been whitelisted due to being popular but not satisfying either of the previous two requirements). */
					if (!isWindowAlias && thirdPartyGlobal.key !== "document" && (hasVersionProperty || startsWithCapital || isWhitelistedLibrary)) {
						var globalValue = thirdPartyGlobal.value;

						/* Retain globals that are functions or are objects that have a member function. */
						if (Type(globalValue) === "function") {
							processWindowVariable(thirdPartyGlobal);
						} else if (Type(globalValue) === "object") {
							var containsFunction = false;
							
							/* Recursively check objects members for functions. */
							(function findFunctions (globalValue) {
								var isWindowAlias = globalValue && globalValue.chrome && globalValue.webkitURL;

								/* Don't descend through window aliases (which have a .document property) or DOM elements. Further, 
								   only proceed with recursion if we've spent less than 50ms descending into this global variable. We
								   do this to dumbly avoid infinite recursion resulting from properties that refer to one another. */
								if ((!isWindowAlias && globalValue.nodeType === undefined) && ((Date.now() - descentStart) < 50)) {
									for (var j in globalValue) {
										var subProperty = globalValue[j];

										if (Type(subProperty) === "object") {
											findFunctions(subProperty);
										} else if (Type(subProperty) === "function") {
											containsFunction = true;

											return;
										}
									};
								}
							})(globalValue);

							if (containsFunction) {
								processWindowVariable(thirdPartyGlobal);
							}
						}
					}
				}
			}

			return evaluatedData;
		})();
	} catch (error) {
		return error;
	}
}

function filterPageData (data) {
	if (!(data && data.window && data.window.length)) {
		out(false, "evaluate", data || "window variables not received");
	} else {

		var device = Page.isMobilePass ? "mobile" : "desktop";

		/*************
		    Window
		*************/

		data.window.forEach(function(val) {
			/* Exclude window variables that were present before page load. */
			if (baselines.window[val] === undefined) {
				Page.libs.window[device].push(val);
			}
		});

		/**************
		    jQuery
		**************/

		/* If jQuery existed on the page, default utility functions would have been passed through.
		   We also ensure we're not mistaking Zepto (which also has a .fn property) for jQuery. Fortunately,
		   Zepto creates a .zepto utility property that we can check for. */
		if (data.jQueryUtility.length && data.jQueryUtility.indexOf("zepto") === -1) {
			/* Page evaluation strips the window object of jQuery and $, so we re-add it here. */
			Page.libs.window[device].push("jQuery");

			/* Exclude default jQuery utility variables. */
			data.jQueryUtility.forEach(function (val) {
				if (baselines.jQuery[val] === undefined) {
					Page.libs.jQuery[device].push("$." + val);
				}
			});

			/* Exclude default jQuery .fn variables. */
			data.jQueryFn.forEach(function (val) {
				if (baselines.jQuery.fn[val] === undefined) {
					Page.libs.jQuery[device].push("$.fn." + val);
				}
			});
		}

		/**************
		    Modules
		**************/

		data.modules.forEach(function(val) {
			/* If we match a module that has already been exposed on jQuery or window, drop it to avoid duplicates;
			   the goal of our module sniffing is to find modules that are hidden inside an anonymous scope and 
			   don't reveal themselves anywhere. */
			var isUnique = true;

			/* Find out whether the module name is prefixed with "jquery." so we can push this variable to our jQuery
			   array instead of our modules array (which winds up being interpreted as global variables by the backend). */
			var rjQueryPlugin = /^jQuery\./i,
				isjQueryPlugin = false;

			if (rjQueryPlugin.test(val)) {
				isjQueryPlugin = true;

				/* Strip off the "jquery." prefix so that the value can be compared against the current jQuery array items. */
				val = val.replace(rjQueryPlugin, "");
			}

			for (var i = 0; i < 2; i++) {
				var testVal = (i === 1) ? val : val.toLowerCase();

				[ Page.libs.jQuery[device], Page.libs.window[device] ].forEach(function(j, i) {
					j.forEach(function(k) {
						/* Strip the prefixes from the jQuery data cache. */
						if (j === 0) { 
							k = k.split(".")[k.split(".").length - 1];
						}

						/* Perform a case insensitive lookup since module names are commonly required in lowercase. */
						if (k.toUpperCase() === val.toUpperCase()) {
							isUnique = false;
						}
					});
				});
			}

			if (isUnique) {
				if (isjQueryPlugin) {
					/* (We get to this point when a jQuery plugin has been required without a globally exposed jQuery global.) 
					   When transferring this item from the modules list to the jQuery list, we classify the variable as both a
					   jQuery utility and a jQuery fn variable since we have no way of actually determining which it really is. */
					Page.libs.jQuery[device].push("$." + val);
					Page.libs.jQuery[device].push("$.fn." + val);
				} else {
					Page.libs.modules[device].push(val);
				}
			} else {
				out(true, "module clean", "dropped non-unique module name: " + val);
			}
		});

		/* For the time being, we're going to treat all unique, non-jQuery-prefixed modules as global variables. The downside is that
		   uncaught jQuery modules will convert into incorrect global variable names. But this ultimately makes data lookups easier
		   so that we don't have to segregate RequireJS module matches as a separate response type with a "lesser" consideration of validity. */
		Page.libs.window[device] = Page.libs.window[device].concat(Page.libs.modules[device]);

		/**************
		    Scripts
		**************/

		Page.libs.scripts[device] = jQuery.map(data.scripts, function (val, i) {
			/* Strip query strings and protocols from script urls. */
			var pageHostname = URL.parse(val, false, true).hostname;

			/* Strip www subdomains to normalize direct lookup matches. */ 
			if (/^www\./.test(pageHostname)) {
				pageHostname = pageHostname.replace("www.", "");
			}

			/* Reduce CloudFront to its root domain since subdomains vary across all sites. */
			if (/cloudfront\.net$/.test(pageHostname)) {
				pageHostname = "cloudfront.net";
			}

			return pageHostname;
		});
	}

	if (Page.isMobilePass) {
		disconnectFromPage();
		reportPageData();
	} else {
		/* Evaluate the page once more with a mobile user agent so we can sniff for new mobile-only resources. */
		Page.isMobilePass = true;
		disconnectFromPage();
		connectToPage();

		out(true, "mobile redirect", "checking...");
	}
}

function reportPageData () {
	function reportPageDataDone() {
		out(true, "done", (Date.now() - startTime)/1000 + "s");
		process.exit();
	}

	delete Page.libs.modules;

	jQuery.each(Page.libs, function (dataType, data) {
		jQuery.each(data, function(deviceType, deviceData) {
			/* Reduce all arrays to unique matches, and truncate them to 75 results max (in case someone is trying to sabotage our results). */
			Page.libs[dataType][deviceType] = Page.libs[dataType][deviceType].filter(function(val, i, self) { 
		    	return self.indexOf(val) === i;
			}).slice(0, 75);

			out(true, dataType + " [" + deviceType + "]", Page.libs[dataType][deviceType].length ? Page.libs[dataType][deviceType] : "N/A");
		});
	});

	if (Arguments.isDump) {
		var dumpData = JSON.stringify({ url: Arguments.url, rank: Arguments.rank, libs: Page.libs });

		FS.appendFile("dump.json", dumpData + "\n", function(error) {
			if (error) {
		        out(false, "dump", error);
			} else {
				out(true, "dump", "written");

				reportPageDataDone();
			}
		});
	} else {
		out(true, "dump", "not requested");
		reportPageDataDone();
	}
}

/***************
    Phantom
***************/

var phantomInstance;
var pageInstance;

/* Phantom requires that urls are prepended with a protocol. */
if (!/^https?:\/\//i.test(Page.url)) {
	Page.url = "http://" + Page.url;
}

function connectToPage () {
	/* Note: --ssl-protocol option is used to force Phantom to connect to sites that use outdated versions of TLS, e.g. tumblr.com. */
	Phantom.create(
		"--ssl-protocol=any", 
		{ 
			onExit: function (code) {
				if (code !== 0) {
					out(false, "phantom", "crash");
				}
			}
		},
		function (_phantomInstance) {
			phantomInstance = _phantomInstance;
			phantomInstance.createPage(function (_pageInstance) {
				pageInstance = _pageInstance;

				/*****************
				    Baselines
				*****************/

				/* Request the window object from the browser instance then pipe it into evaluateBaselines(). */
				pageInstance.evaluate(function() { return window; }, evaluateBaselines);

				/****************
				    Settings
				****************/

				/* Do a first pass with a mobile user agent. If a mobile redirect is detected, we evaluate the page once more with a desktop user agent. */
				pageInstance.set("settings.userAgent", Page.isMobilePass ? PHANTOM_USERAGENT_MOBILE : PHANTOM_USERAGENT_DESKTOP );
				pageInstance.set("settings.resourceTimeout", PHANTOM_RESOURCE_TIMEOUT);
				/* Cancel requests for all image resources. */
				/* Note: Tests have shown that image blocking does not lead to errors or JavaScript execution prevention. */
				pageInstance.set("settings.loadImages", false);

				/***********************
				   Callbacks: General
				***********************/

				/* When a page is requested, but before it has begun loading, inject scripts that modify runtime globals. */
				pageInstance.set("onInitialized", injectIntoPage);
				pageInstance.set("onLoadStarted", function() { 
					out(true, "downloading...");
				});

				/***********************
				   Callbacks: Mobile
				***********************/

				function mobileRedirectNotDetected() {
					Page.mobileRedirectDetected = false;
					out(true, "mobile redirect", "not detected");
					reportPageData();
				}

				pageInstance.set("onResourceReceived", function(resourceResponse) {
					/* Check if a mobile useragent leads to a mobile subdomain redirect (not merely a www. subdomain redirect). If so, we re-evaluate this
					   page and sum the total results. */
					/* Note: If desktop sites conditionally load scripts/modules based whether the device is mobile, this won't catch the difference. We are accepting
					   this tradeoff since the occurrence of this is low. If we find otherwise, we'll change behavior. */
					if (Page.isMobilePass && Page.mobileRedirectDetected === null) {
						/* Note: The id property corresponds to this resource's order in the overall requests pool. We check for a redirect on the first
						   two resources to allow for an ssl redirect to occur before the mobile redirect. */
						if (resourceResponse.redirectURL && resourceResponse.id <= 2) {
							if (/^(m|mobile)\./i.test(URL.parse(resourceResponse.redirectURL).hostname)) {
								Page.mobileRedirectDetected = true;
								out(true, "mobile redirect", "detected");
							}
						} else if (resourceResponse.id > 2) {
							mobileRedirectNotDetected();
						}
					}
				});

				pageInstance.set("onLoadFinished", function() {
					if (Page.isMobilePass && Page.mobileRedirectDetected === null) {
						mobileRedirectNotDetected();
					}
				});

				/***************
				    Connect
				***************/

				/* Request the target page then proceed with page evaluation once when onDOMContentLoaded is fired
				   (all resource requests have been fulfilled). */
				pageInstance.open(Page.url, function(status) {
					if (!(Page.isMobilePass && !Page.mobileRedirectDetected)) {
						if (status === "success") {
							out(true, "downloaded", Page.url);

							/* Allow time for asynchronous scripts to load (which onDOMContentLoaded wouldn't have caught). */
							out(true, "sleeping...")
							setTimeout(function() {
								pageInstance.evaluate(evaluatePageData, filterPageData);
							}, PHANTOM_EVALUATE_DELAY);
						} else {
							out(false, "connect", "did not connect to page")
						}
					}
				});
			});
		}
	);
}

function disconnectFromPage () {
	pageInstance && pageInstance.close();
	phantomInstance && phantomInstance.exit();

	if (Page) {
		out(true, "disconnect", Page.url);
	}
}

/**************
     Init
**************/

var startTime = Date.now();

connectToPage();