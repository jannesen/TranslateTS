setlocal

set NODEJS=%~dp0..\..\
set NODE_PATH=%NODEJS%node_modules

"%NODEJS%node.exe" "%~dp0lib\main" %*
