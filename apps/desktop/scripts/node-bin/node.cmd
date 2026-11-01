@echo off
set ELECTRON_RUN_AS_NODE=1
"%LIWA_DESKTOP_NODE_EXECUTABLE%" --expose-internals %*
