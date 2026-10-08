@echo off
title 티처스케줄 학사일정 로컬 서버
echo ==========================================
echo 티처스케줄 학사일정 로컬 서버 기동기
echo ==========================================
echo.

where py >nul 2>nul
if %errorlevel% equ 0 (
    echo [안내] 시스템에 Python 환경이 감지되었습니다. 로컬 웹 서버(http://localhost:8000)를 구동합니다.
    echo.
    echo 이 창을 닫으면 서버가 종료됩니다.
    echo.
    start http://localhost:8000/
    py -m http.server 8000
) else (
    where node >nul 2>nul
    if %errorlevel% equ 0 (
        echo [안내] 시스템에 Node.js 환경이 감지되었습니다. npx로 서버(http://localhost:8000)를 구동합니다.
        echo.
        echo 이 창을 닫으면 서버가 종료됩니다.
        echo.
        start http://localhost:8000/
        npx http-server -p 8000
    ) else (
        echo [경고] 웹 서버 구동에 필요한 Python 또는 Node.js가 감지되지 않았습니다.
        echo.
        echo 임시 조치로 인터넷 브라우저로 index.html 파일을 직접 실행합니다.
        echo (주의: 브라우저 보안 규정으로 인해 오프라인 앱 설치 기능이 제한될 수 있습니다.)
        echo.
        pause
        start index.html
    )
)
