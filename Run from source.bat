@echo off
rem Double-click this to open the Padel Rotation Scheduler.
rem pyw runs it without a console window; if that is missing, py is the fallback.
start "" pyw "%~dp0padel_gui.py" 2>nul || py "%~dp0padel_gui.py"
