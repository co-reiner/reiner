@echo off
rem Runs the Reiner CLI from source, with this folder as the project.
set "REINER_CWD=%~dp0"
node "%~dp0..\..\reiner\packages\reiner\bin\reiner.js" %*
