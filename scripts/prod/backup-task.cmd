@echo off
rem Scheduled backup task entry: bun + backup-node.mjs, log for diagnostics.
cd /d C:\doma-cloud-main
"C:\Users\admin\AppData\Roaming\npm\bun.cmd" scripts\prod\backup-node.mjs >> "C:\doma-cloud-main\backup-last.log" 2>&1