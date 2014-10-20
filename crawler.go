package main

import (
	"fmt"
	"io/ioutil"
	"os/exec"
	"strings"
)

const NUM_WORKERS = 20
const NUM_SITES = 100

var failedSites []string

func crawlerCmd(site string) (string, string, string) {
	return "node", "crawler.js", site
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
	for site := range siteJobs {
		out, err := exec.Command(crawlerCmd(site)).Output()
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

	siteJobs := make(chan string, NUM_SITES)
	out := make(chan string, NUM_SITES)
	failedSites = make([]string, 0)

	// Kick off worker pool
	for i := 1; i <= NUM_WORKERS; i++ {
		go work(siteJobs, out)
	}

	totalSites := 0
	for _, line := range strings.Split(sites, "\n") {
		splitLine := strings.Split(line, ",")
		// Could hit \n at the end, too lazy to fix right now
		if len(splitLine) == 2 {
			_, site := splitLine[0], splitLine[1]
			siteJobs <- site
			totalSites++
		}
	}

	close(siteJobs)

	// Wait for all the jobs to flush
	for i := 0; i < NUM_SITES; i++ {
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

func main() {
	fmt.Println("Starting crawl...")
	sites := slurpSitesFile()
	crawlSites(sites)
}
