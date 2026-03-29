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
    echo "Initializing Volundr home at $VLDR_HOME..."
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

# --- Parse flags ---
LOCAL_BUILD=false
for arg in "$@"; do
    case "$arg" in
        --rebuild|--local) LOCAL_BUILD=true ;;
    esac
done

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

# --- Fast path: dashboard already running and healthy ---
if [ "$LOCAL_BUILD" = false ] && curl -sf http://localhost:3141/api/health >/dev/null 2>&1; then
    echo "Dashboard already running."
    echo
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
fi

# --- Step 2: Start dashboard ---
export VLDR_HOME_DATA="$VLDR_HOME/data"
export CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"

if [ "$LOCAL_BUILD" = true ]; then
    echo "Building dashboard from source..."
    export DOCKER_BUILDKIT=1
    docker compose -f docker-compose.yml -f docker-compose.build.yml up --build -d
else
    echo "Pulling and starting dashboard..."
    if ! docker compose pull; then
        echo
        echo "Failed to pull dashboard image. This can happen if:"
        echo "  - The image hasn't been published yet (first-time setup)"
        echo "  - Docker can't reach ghcr.io (network issue)"
        echo
        echo "Falling back to local build..."
        export DOCKER_BUILDKIT=1
        docker compose -f docker-compose.yml -f docker-compose.build.yml up --build -d
    else
        docker compose up -d
    fi
fi

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
