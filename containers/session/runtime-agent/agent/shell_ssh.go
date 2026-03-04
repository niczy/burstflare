package agent

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"path"
	"runtime"
	"sort"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
)

var websocketUpgrader = websocket.Upgrader{
	CheckOrigin: func(_ *http.Request) bool {
		return true
	},
}

type shellSession struct {
	SessionID string
	CWD       string
	Home      string
	Closed    bool
}

func resolveShellPath(currentDir string, target string) string {
	raw := strings.TrimSpace(target)
	if raw == "" || raw == "~" {
		return "/workspace"
	}
	absolute := raw
	if !strings.HasPrefix(raw, "/") {
		absolute = path.Join(currentDir, raw)
	}
	normalized := path.Clean(absolute)
	if normalized == "." || normalized == "" {
		return "/workspace"
	}
	if strings.HasPrefix(normalized, "/") {
		return normalized
	}
	return "/" + normalized
}

func (s *RuntimeState) runShellCommand(state *shellSession, command string) string {
	trimmed := strings.TrimSpace(command)
	if trimmed == "" {
		return ""
	}

	switch {
	case trimmed == "help":
		return "available: help, pwd, ls, cd <path>, cat <path>, whoami, env, uname -a, exit"
	case trimmed == "pwd":
		return state.CWD
	case trimmed == "ls":
		return s.listShellEntries(state.CWD)
	case trimmed == "whoami":
		return "flare"
	case trimmed == "env":
		s.mu.Lock()
		restoredSnapshotID := s.RestoredSnapshotID
		secretCount := len(s.SecretNames)
		s.mu.Unlock()
		return strings.Join(
			[]string{
				"SESSION_ID=" + state.SessionID,
				"USER=flare",
				"HOME=" + state.Home,
				"PWD=" + state.CWD,
				"LAST_RESTORED_SNAPSHOT=" + restoredSnapshotID,
				fmt.Sprintf("BURSTFLARE_RUNTIME_SECRET_COUNT=%d", secretCount),
			},
			"\n",
		)
	case trimmed == "uname -a":
		return fmt.Sprintf("Linux %s 6.6-cloudflare #1 SMP %s %s", hostName(), runtimeArchitecture(), runtimePlatform())
	case trimmed == "exit":
		state.Closed = true
		return "logout"
	case strings.HasPrefix(trimmed, "cd"):
		state.CWD = resolveShellPath(state.CWD, strings.TrimSpace(strings.TrimPrefix(trimmed, "cd")))
		return state.CWD
	case strings.HasPrefix(trimmed, "cat"):
		resolved := resolveShellPath(state.CWD, strings.TrimSpace(strings.TrimPrefix(trimmed, "cat")))
		s.mu.Lock()
		content, exists := s.Files[resolved]
		s.mu.Unlock()
		if exists {
			return content
		}
		return fmt.Sprintf("cat: %s: No such file or directory", resolved)
	default:
		return strings.Join(
			[]string{
				"$ " + trimmed,
				"session=" + state.SessionID,
				"cwd=" + state.CWD,
				"executed_at=" + nowISO(),
			},
			"\n",
		)
	}
}

func (s *RuntimeState) listShellEntries(currentDir string) string {
	switch currentDir {
	case "/workspace/.burstflare/snapshots":
		s.mu.Lock()
		entries := make([]string, 0)
		for filePath := range s.Files {
			if strings.HasPrefix(filePath, "/workspace/.burstflare/snapshots/") {
				entries = append(entries, path.Base(filePath))
			}
		}
		s.mu.Unlock()
		sort.Strings(entries)
		return strings.Join(entries, "\n")
	case "/workspace/.burstflare":
		entries := []string{"last.snapshot"}
		s.mu.Lock()
		for filePath := range s.Files {
			if strings.HasPrefix(filePath, "/workspace/.burstflare/snapshots/") {
				entries = append(entries, "snapshots")
				break
			}
		}
		s.mu.Unlock()
		return strings.Join(entries, "\n")
	default:
		return strings.Join([]string{".burstflare", "workspace", "README.md", "logs"}, "\n")
	}
}

func (s *RuntimeState) handleShell(w http.ResponseWriter, r *http.Request) {
	if strings.ToLower(r.Header.Get("upgrade")) != "websocket" {
		http.NotFound(w, r)
		return
	}

	conn, err := websocketUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	sessionID := defaultString(r.URL.Query().Get("sessionId"), "unknown")
	state := &shellSession{
		SessionID: sessionID,
		CWD:       "/workspace",
		Home:      "/home/flare",
	}

	_ = conn.WriteMessage(websocket.TextMessage, []byte("BurstFlare container shell attached to "+sessionID))
	_ = conn.WriteMessage(websocket.TextMessage, []byte("Type `help` for available commands."))

	for {
		messageType, payload, err := conn.ReadMessage()
		if err != nil {
			return
		}
		if messageType != websocket.TextMessage && messageType != websocket.BinaryMessage {
			continue
		}

		reply := s.runShellCommand(state, string(payload))
		if reply != "" {
			if err := conn.WriteMessage(websocket.TextMessage, []byte(reply)); err != nil {
				return
			}
		}
		if state.Closed {
			_ = conn.WriteMessage(websocket.TextMessage, []byte("Session closed by remote shell."))
			_ = conn.WriteControl(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseNormalClosure, "Session closed"),
				noDeadline(),
			)
			return
		}
	}
}

func (s *RuntimeState) handleSSH(w http.ResponseWriter, r *http.Request) {
	if strings.ToLower(r.Header.Get("upgrade")) != "websocket" {
		http.NotFound(w, r)
		return
	}

	conn, err := websocketUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	upstream, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", sshPort()))
	if err != nil {
		_ = conn.WriteControl(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "SSH upstream unavailable"),
			noDeadline(),
		)
		return
	}
	defer upstream.Close()

	errCh := make(chan error, 2)
	var closeOnce sync.Once
	closeBoth := func() {
		closeOnce.Do(func() {
			_ = upstream.Close()
			_ = conn.Close()
		})
	}

	go func() {
		defer closeBoth()
		for {
			messageType, payload, err := conn.ReadMessage()
			if err != nil {
				errCh <- err
				return
			}
			if messageType != websocket.TextMessage && messageType != websocket.BinaryMessage {
				continue
			}
			if _, err := upstream.Write(payload); err != nil {
				errCh <- err
				return
			}
		}
	}()

	go func() {
		defer closeBoth()
		buffer := make([]byte, 32*1024)
		for {
			readBytes, err := upstream.Read(buffer)
			if readBytes > 0 {
				if writeErr := conn.WriteMessage(websocket.BinaryMessage, buffer[:readBytes]); writeErr != nil {
					errCh <- writeErr
					return
				}
			}
			if err != nil {
				if err == io.EOF {
					_ = conn.WriteControl(
						websocket.CloseMessage,
						websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
						noDeadline(),
					)
				} else {
					errCh <- err
				}
				return
			}
		}
	}()

	<-errCh
}

func websocketURL(serverURL string, routePath string) string {
	parsed, err := url.Parse(serverURL)
	if err != nil {
		return ""
	}
	if parsed.Scheme == "https" {
		parsed.Scheme = "wss"
	} else {
		parsed.Scheme = "ws"
	}
	parsed.Path = routePath
	parsed.RawQuery = ""
	return parsed.String()
}

func runtimeArchitecture() string {
	return runtime.GOARCH
}

func runtimePlatform() string {
	return runtime.GOOS
}
