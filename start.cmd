@echo off
rem Spusti Nakupnik na http://localhost:8081 a otevre ho v prohlizeci.
title Nakupnik
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" %*
