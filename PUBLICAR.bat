@echo off
REM Publica la aplicacion: guarda los cambios y los envia a GitHub (GitHub Pages se actualiza solo en ~1 minuto).
cd /d "%~dp0"
set "PATH=%PATH%;C:\Program Files\Git\cmd"
git add -A
git commit -m "Actualizacion" 2>nul
git push
echo.
echo ==============================================================
echo  Si arriba aparece "main -> main", ya se envio.
echo  En 1 minuto abra: https://jeffersonkid.github.io/gastos-sechura/
echo ==============================================================
pause
