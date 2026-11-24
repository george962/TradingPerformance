@echo off
rem Trading Performance vs the S and P 500 - double-click to launch (Windows).
rem Starts the local server and opens the dashboard in your browser.
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 server.py
) else (
  python server.py
)
if errorlevel 1 (
  echo.
  echo Could not start. Install Python 3 from https://www.python.org/downloads/
  echo and tick "Add python.exe to PATH" during setup, then try again.
  pause
)
