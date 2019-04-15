@ echo off
setlocal

set NODEJS=%~dp0..\..\
set NODE_PATH=%NODEJS%node_modules

cd %~dp0

echo tsc: TranslateTS
"%NODEJS%node.exe" %NODE_PATH%\typescript\lib\tsc.js -p src\tsconfig.json
if errorlevel 1 goto done

echo tslint: TranslateTS
"%NODEJS%node.exe" %NODE_PATH%\tslint\lib\tslintCli --project src

:done