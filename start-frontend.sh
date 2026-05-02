#!/bin/bash
# Kill any existing Vite processes on dev ports
for port in 5173 5174 5175; do
  pids=$(netstat -ano 2>/dev/null | grep ":$port " | grep LISTENING | awk '{print $5}')
  for pid in $pids; do
    taskkill //F //PID "$pid" 2>/dev/null
    echo "killed PID $pid on port $port"
  done
done

sleep 1
cd "$(dirname "$0")/frontend" && npx vite --host
