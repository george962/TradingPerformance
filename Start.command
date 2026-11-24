#!/bin/bash
# Trading Performance vs S&P 500 — double-click to launch.
# Starts the local server and opens the dashboard in your browser.
cd "$(dirname "$0")"
exec python3 server.py
