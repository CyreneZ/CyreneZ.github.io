@echo off
rem Mo trang tren may de xem truoc khi dang.
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Can cai Node.js truoc: https://nodejs.org & pause & exit /b 1)
node serve.js
pause
