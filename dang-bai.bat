@echo off
rem Keo file anh hoac video tha vao file nay de dang len web.
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Can cai Node.js truoc: https://nodejs.org & pause & exit /b 1)
if not exist node_modules\ffmpeg-static\ffmpeg.exe (
    echo Dang cai bo xu ly video, chi can lam mot lan...
    call npm install --no-audit --no-fund
)
node tools\post.mjs %*
pause
