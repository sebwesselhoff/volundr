#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo ""
printf '\e[38;2;59;130;246m __     __    _                 _\e[0m\n'
printf '\e[38;2;96;165;250m \\ \\   / /__ | |_   _ _ __   __| |_ __\e[0m\n'
printf '\e[38;2;59;130;246m  \\ \\ / / _ \\| | | | | '"'"'_ \\ / _` | '"'"'__|\e[0m\n'
printf '\e[38;2;96;165;250m   \\ V / (_) | | |_| | | | | (_| | |\e[0m\n'
printf '\e[38;2;59;130;246m    \\_/ \\___/|_|\\__,_|_| |_|\\__,_|_|   \e[38;2;232;168;56mThe Forge\e[0m\n'
echo ""

# --- Set VLDR_HOME default ---
export VLDR_HOME="${VLDR_HOME:-$HOME/.volundr}"

# --- Initialize VLDR_HOME on first run ---
if [ ! -f "$VLDR_HOME/projects/registry.json" ]; then
    echo "Initializing Vǫlundr home at $VLDR_HOME..."
    mkdir -p "$VLDR_HOME/projects" "$VLDR_HOME/global/patterns" "$VLDR_HOME/data"

    # Migrate existing data from repo if present
    if [ -f "projects/registry.json" ]; then
        echo "Migrating existing projects to $VLDR_HOME..."
        cp -r projects/* "$VLDR_HOME/projects/" 2>/dev/null || true
        cp -r global/* "$VLDR_HOME/global/" 2>/dev/null || true
        echo "Migration complete."
    else
        echo '{"version":1,"projects":{},"activeProject":null}' > "$VLDR_HOME/projects/registry.json"
        echo "# Global Lessons" > "$VLDR_HOME/global/lessons.md"
    fi
    echo
fi

# --- Step 1: Start Docker if not running ---
if ! docker info >/dev/null 2>&1; then
    echo "Starting Docker..."
    if [[ "$OSTYPE" == darwin* ]]; then
        open -a "Docker"
    else
        systemctl start docker 2>/dev/null || sudo systemctl start docker 2>/dev/null || {
            echo "Could not start Docker. Please start it manually."
            exit 1
        }
    fi
    echo "Waiting for Docker daemon..."
    until docker info >/dev/null 2>&1; do sleep 3; done
    echo "Docker is ready."
fi

echo

# --- Step 2: Build and start dashboard container ---
echo "Building and starting dashboard..."
export VLDR_HOME_DATA="$VLDR_HOME/data"
export CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"
docker compose up --build -d

echo "Waiting for dashboard health check..."
until curl -sf http://localhost:3141/api/health >/dev/null 2>&1; do sleep 2; done
echo "Dashboard is healthy."

echo

# --- Step 3: Open browser ---
echo "Opening dashboard in browser..."
if command -v xdg-open &>/dev/null; then xdg-open http://localhost:3000
elif command -v open &>/dev/null; then open http://localhost:3000
fi

echo
echo "============================================"
echo "  Dashboard ready. Launching Claude CLI..."
echo "============================================"
echo
exec claude "Wake up!" --dangerously-skip-permissions
