package main

import (
	"fmt"
	"io/ioutil"
	"os/exec"
	"strings"
)

const NUM_WORKERS = 20
const NUM_SITES = 1000

func crawlerCmd(site string) (string, string, string) {
	return "node", "crawler.js", site
}

func slurpSitesFile() string {
	siteContents, err := ioutil.ReadFile("sites-1000.txt")
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

func work(siteJobs <-chan string, out chan<- string) {
	for site := range siteJobs {
		out, err := exec.Command(crawlerCmd(site)).Output()
		if err != nil {
			fmt.Println("---> Crawl of site:", site, "failed!")
			fmt.Println("\t", err)
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

	for i := 1; i <= NUM_WORKERS; i++ {
		go work(siteJobs, out)
	}

	for _, line := range strings.Split(sites, "\n") {
		splitLine := strings.Split(line, ",")
		// Could hit \n at the end, too lazy to fix right now
		if len(splitLine) == 2 {
			_, site := splitLine[0], splitLine[1]
			siteJobs <- site
		}
	}
	close(siteJobs)

	for i := 0; i <= NUM_WORKERS; i++ {
		fmt.Println(<-out)
	}
}

func main() {
	fmt.Println("Starting crawl...")
	sites := slurpSitesFile()
	crawlSites(sites)
}
