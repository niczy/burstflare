package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/niczy/burstflare/apps/runtime-agent/agent"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	handler := agent.NewHandler()
	if err := agent.EnsureSshd(); err != nil {
		log.Fatal(err)
	}
	addr := "0.0.0.0:" + port
	fmt.Printf("BurstFlare Go runtime agent listening on %s\n", port)
	log.Fatal(http.ListenAndServe(addr, handler))
}
