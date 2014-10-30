package main

import (
	"flag"
	"fmt"
	"io/ioutil"
	"os/exec"
	"strings"
)

// CLI flags
var siteFlag string

// Other global stuff
const NUM_WORKERS = 20
const STUB_SITE = "www.foo.com"

var failedSites []string

func crawlerCmd(site string, siteRank int) (string, string, string) {
	return "node", "crawler.js", site, siteRank
}

func slurpSitesFile() string {
	siteContents, err := ioutil.ReadFile("sites-100.txt")
	if err != nil {
		panic("The file (sites.txt) isn't even here, we're done.")
	}

	return string(siteContents)
}

func pwd() string {
	out, err := exec.Command("pwd").Output()
	if err != nil {
		fmt.Println("Failed to pwd")
	}

	return string(out)
}

func work(siteJobs <-chan string, res chan<- string) {
	siteRank := 0;

	for site := range siteJobs {
		siteRank++;

		out, err := exec.Command(crawlerCmd(site, siteRank)).Output()
		res <- "OK"

		if err != nil {
			fmt.Println("---> Crawl of site:", site, "failed!")
			fmt.Println("\t", err)
			failedSites = append(failedSites, site)
			continue
		}

		fmt.Println("===> Crawl of site:", site, "succeeded!")
		fmt.Println(string(out))
	}
}

func crawlSites(sites string) {
	fmt.Println("Executing in: " + pwd())

	siteJobs := make(chan string, 1000000)
	out := make(chan string, 1000000)
	failedSites = make([]string, 0)

	// Kick off worker pool
	for i := 1; i <= NUM_WORKERS; i++ {
		go work(siteJobs, out)
	}

	var isAppending bool

	if siteFlag == STUB_SITE {
		isAppending = true
	}

	totalSites := 0
	for _, line := range strings.Split(sites, "\n") {
		splitLine := strings.Split(line, ",")
		// Could hit \n at the end, too lazy to fix right now
		if len(splitLine) == 2 {
			_, site := splitLine[0], splitLine[1]

			if siteFlag == site {
				isAppending = true
			}

			if isAppending {
				siteJobs <- site
				totalSites++
			}
		}
	}

	close(siteJobs)

	// Wait for all the jobs to flush
	for i := 0; i < totalSites; i++ {
		<-out
	}

	numFailedSites := len(failedSites)
	retryJobs := make(chan string, numFailedSites)

	// Kick off retry worker pool
	for i := 1; i <= NUM_WORKERS; i++ {
		go work(retryJobs, out)
	}

	// Then push failed sites back on channels
	for _, failedSite := range failedSites {
		fmt.Println("<=== Requeueing job for failed site", failedSite)
		retryJobs <- failedSite
	}

	close(retryJobs)

	// Retry the jobs and wait
	fmt.Println("This many sites failed:", numFailedSites)
	for i := 0; i < (numFailedSites - 1); i++ {
		<-out
	}

	fmt.Println("========== WE ARE DONE!!!! ==========")
	fmt.Println("Here are some statistics!")
	fmt.Println("\t# Total sites in set:", totalSites)
	fmt.Println("\t# Failed sites:", numFailedSites)
	fmt.Println("\tFailed sites:", failedSites)
}

func bindFlags() {
	flag.StringVar(&siteFlag, "site", STUB_SITE, "Pass a site as a starting index")
	flag.Parse()
}

func main() {
	fmt.Println("Starting crawl...")
	sites := slurpSitesFile()
	bindFlags()
	crawlSites(sites)
}
