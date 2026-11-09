@echo off
chcp 65001 >nul
title 比特王新聞網（關閉這個視窗網站就會停止）
cd /d "%~dp0"
start "" http://localhost:5520
python server.py
pause
