package agent

import (
	"io"
	"net"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestRunShellCommand(t *testing.T) {
	state := NewState()
	state.Files["/workspace/project/notes.txt"] = "draft 1"
	state.SecretNames = []string{"API_TOKEN"}
	state.RestoredSnapshotID = "snap_test"
	session := &shellSession{
		SessionID: "ses_shell",
		CWD:       "/workspace/project",
		Home:      "/home/flare",
	}

	if got := state.runShellCommand(session, "pwd"); got != "/workspace/project" {
		t.Fatalf("unexpected pwd: %s", got)
	}
	if got := state.runShellCommand(session, "cat notes.txt"); got != "draft 1" {
		t.Fatalf("unexpected cat output: %s", got)
	}
	envOutput := state.runShellCommand(session, "env")
	if !strings.Contains(envOutput, "BURSTFLARE_RUNTIME_SECRET_COUNT=1") {
		t.Fatalf("unexpected env output: %s", envOutput)
	}
	if got := state.runShellCommand(session, "exit"); got != "logout" || !session.Closed {
		t.Fatalf("expected exit to close the shell")
	}
}

func TestShellWebsocket(t *testing.T) {
	state := NewState()
	server := httptest.NewServer(state)
	defer server.Close()

	conn, _, err := websocket.DefaultDialer.Dial(websocketURL(server.URL, ShellPath)+"?sessionId=ses_ws", nil)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer conn.Close()

	_, greeting, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read greeting failed: %v", err)
	}
	if !strings.Contains(string(greeting), "ses_ws") {
		t.Fatalf("unexpected greeting: %s", string(greeting))
	}
	_, _, err = conn.ReadMessage()
	if err != nil {
		t.Fatalf("read help hint failed: %v", err)
	}

	if err := conn.WriteMessage(websocket.TextMessage, []byte("whoami")); err != nil {
		t.Fatalf("write failed: %v", err)
	}
	_, reply, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read reply failed: %v", err)
	}
	if string(reply) != "flare" {
		t.Fatalf("unexpected shell reply: %s", string(reply))
	}
}

func TestSSHWebsocketProxy(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen failed: %v", err)
	}
	defer listener.Close()

	previousPort := os.Getenv("BURSTFLARE_SSH_PORT")
	t.Cleanup(func() {
		_ = os.Setenv("BURSTFLARE_SSH_PORT", previousPort)
	})
	_ = os.Setenv("BURSTFLARE_SSH_PORT", strings.TrimPrefix(listener.Addr().String(), "127.0.0.1:"))

	go func() {
		connection, acceptErr := listener.Accept()
		if acceptErr != nil {
			return
		}
		defer connection.Close()
		buffer := make([]byte, 32)
		readBytes, readErr := connection.Read(buffer)
		if readErr != nil {
			return
		}
		_, _ = connection.Write(buffer[:readBytes])
	}()

	state := NewState()
	server := httptest.NewServer(state)
	defer server.Close()

	conn, _, err := websocket.DefaultDialer.Dial(websocketURL(server.URL, SSHPath), nil)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer conn.Close()

	if err := conn.WriteMessage(websocket.BinaryMessage, []byte("ping")); err != nil {
		t.Fatalf("write failed: %v", err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	messageType, reply, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read failed: %v", err)
	}
	if messageType != websocket.BinaryMessage {
		t.Fatalf("expected binary reply, received %d", messageType)
	}
	if string(reply) != "ping" {
		t.Fatalf("unexpected reply: %s", string(reply))
	}
}

func TestSSHPortDefaults(t *testing.T) {
	previousPort := os.Getenv("BURSTFLARE_SSH_PORT")
	t.Cleanup(func() {
		_ = os.Setenv("BURSTFLARE_SSH_PORT", previousPort)
	})

	_ = os.Unsetenv("BURSTFLARE_SSH_PORT")
	if got := sshPort(); got != 2222 {
		t.Fatalf("unexpected default port: %d", got)
	}

	_ = os.Setenv("BURSTFLARE_SSH_PORT", "not-a-number")
	if got := sshPort(); got != 2222 {
		t.Fatalf("unexpected fallback port: %d", got)
	}
}

func TestResolveShellPath(t *testing.T) {
	if got := resolveShellPath("/workspace/project", "../notes.txt"); got != "/workspace/notes.txt" {
		t.Fatalf("unexpected resolved path: %s", got)
	}
}

func TestWebsocketURL(t *testing.T) {
	if got := websocketURL("http://127.0.0.1:8080", ShellPath); got != "ws://127.0.0.1:8080/shell" {
		t.Fatalf("unexpected websocket URL: %s", got)
	}
}

func TestDiscardWriter(t *testing.T) {
	if _, err := io.WriteString(ioDiscard(), "ok"); err != nil {
		t.Fatalf("discard write failed: %v", err)
	}
}
