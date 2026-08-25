@echo off
REM ===========================================================================
REM Inferno - launch the whole stack in separate windows:
REM   Redis + Gateway + 6 model workers + Chat service + Frontend
REM Each opens in its own console so you can watch logs and Ctrl+C individually.
REM
REM RESOURCE NOTE: this launches every model. On first run each worker downloads
REM its model (a few GB total) and they load into RAM. On a memory-limited
REM laptop, comment out the heavier workers (whisper / resnet / chat) below.
REM ===========================================================================
setlocal
set HERE=%~dp0

echo [Inferno] Launching Redis...
start "Inferno Redis" cmd /k "%HERE%run-redis.bat"
timeout /t 2 >nul

echo [Inferno] Launching Gateway...
start "Inferno Gateway" cmd /k "%HERE%run-backend.bat"
timeout /t 3 >nul

echo [Inferno] Launching model workers (text, image, detection, speech, search, RAG)...
start "Inferno Worker dummy" cmd /k "%HERE%run-worker.bat dummy-echo"
timeout /t 2 >nul
start "Inferno Worker distilbert" cmd /k "%HERE%run-worker.bat distilbert-sentiment"
timeout /t 2 >nul
start "Inferno Worker resnet" cmd /k "%HERE%run-worker.bat resnet-image"
timeout /t 2 >nul
start "Inferno Worker yolo" cmd /k "%HERE%run-worker.bat yolo-detect"
timeout /t 2 >nul
start "Inferno Worker whisper" cmd /k "%HERE%run-worker.bat whisper-transcribe"
timeout /t 2 >nul
start "Inferno Worker rag" cmd /k "%HERE%run-worker.bat rag-search"
timeout /t 2 >nul
REM semantic-search is declared in backend\models\models.yaml, so the UI offers
REM it; without a worker those jobs hang until the client timeout.
start "Inferno Worker semantic" cmd /k "%HERE%run-worker.bat semantic-search"
timeout /t 2 >nul

echo [Inferno] Launching Chat service (local LLM; first run downloads the model)...
start "Inferno Chat" cmd /k "%HERE%run-chat.bat"

echo [Inferno] Launching Frontend...
start "Inferno Frontend" cmd /k "%HERE%run-frontend.bat"

echo [Inferno] All components launching. Open http://localhost:5173
echo [Inferno] (Tip: the resnet/whisper/chat windows take 10-30s on first run to download+load.)
echo [Inferno] To close everything later, run:  scripts\stop-all.bat
endlocal
