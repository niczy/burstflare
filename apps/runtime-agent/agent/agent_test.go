package agent

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func toBase64(value string) string {
	return base64.StdEncoding.EncodeToString([]byte(value))
}

func TestSnapshotRestoreFiltersPersistedPaths(t *testing.T) {
	state := NewState()

	result, err := state.ApplySnapshotRestore(SnapshotRestorePayload{
		SessionID:      "ses_test",
		SnapshotID:     "snap_test",
		Label:          "test",
		PersistedPaths: []string{"/workspace/project"},
		ContentType:    SnapshotContentType,
		ContentBase64: toBase64(`{
  "format": "burstflare.snapshot.v2",
  "files": [
    { "path": "/workspace/project/app.txt", "content": "hello world" },
    { "path": "/tmp/blocked.txt", "content": "blocked" }
  ]
}`),
	})
	if err != nil {
		t.Fatalf("restore failed: %v", err)
	}

	if len(result.RestoredPaths) != 1 || result.RestoredPaths[0] != "/workspace/project/app.txt" {
		t.Fatalf("unexpected restored paths: %#v", result.RestoredPaths)
	}
	if state.Files["/workspace/project/app.txt"] != "hello world" {
		t.Fatalf("expected restored workspace file")
	}
	if _, exists := state.Files["/tmp/blocked.txt"]; exists {
		t.Fatalf("blocked file should not have been restored")
	}

	body, contentType, err := state.ExportSnapshotPayload("ses_test", []string{"/workspace/project"})
	if err != nil {
		t.Fatalf("export failed: %v", err)
	}
	if contentType != SnapshotContentType {
		t.Fatalf("unexpected content type: %s", contentType)
	}

	var envelope SnapshotEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if envelope.Format != SnapshotFormat {
		t.Fatalf("unexpected format: %s", envelope.Format)
	}
	if len(envelope.Files) != 1 || envelope.Files[0].Path != "/workspace/project/app.txt" {
		t.Fatalf("unexpected exported files: %#v", envelope.Files)
	}
}

func TestCommonStateRestoreSkipsAuthorizedKeys(t *testing.T) {
	state := NewState()
	state.Files[AuthorizedKeysPath] = "ssh-key\n"

	result, err := state.ApplyCommonStateRestore(CommonStateRestorePayload{
		SessionID:   "ses_common",
		InstanceID:  "ins_common",
		ContentType: CommonStateContentType,
		ContentBase64: toBase64(`{
  "format": "burstflare.common-state.v1",
  "files": [
    { "path": "/home/flare/.myconfig", "content": "hello common state" },
    { "path": "/tmp/blocked.txt", "content": "blocked" },
    { "path": "/home/flare/.ssh/authorized_keys", "content": "overwrite" }
  ]
}`),
	})
	if err != nil {
		t.Fatalf("restore failed: %v", err)
	}
	if len(result.RestoredPaths) != 1 || result.RestoredPaths[0] != "/home/flare/.myconfig" {
		t.Fatalf("unexpected restored paths: %#v", result.RestoredPaths)
	}
	if state.Files["/home/flare/.myconfig"] != "hello common state" {
		t.Fatalf("expected common state file")
	}
	if state.Files[AuthorizedKeysPath] != "ssh-key\n" {
		t.Fatalf("authorized_keys should not be overwritten")
	}

	body, contentType, err := state.ExportCommonStatePayload("ins_common")
	if err != nil {
		t.Fatalf("export failed: %v", err)
	}
	if contentType != CommonStateContentType {
		t.Fatalf("unexpected content type: %s", contentType)
	}

	var envelope CommonStateEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if envelope.Format != CommonStateFormat {
		t.Fatalf("unexpected format: %s", envelope.Format)
	}
	if len(envelope.Files) != 1 || envelope.Files[0].Path != "/home/flare/.myconfig" {
		t.Fatalf("unexpected exported files: %#v", envelope.Files)
	}
}

func TestBootstrapAndLifecycleWriteMetadataFiles(t *testing.T) {
	state := NewState()

	bootstrap := state.ApplyRuntimeBootstrap(BootstrapPayload{
		SessionID:      "ses_bootstrap",
		WorkspaceID:    "ws_test",
		InstanceID:     "ins_test",
		TemplateID:     "tpl_test",
		TemplateName:   "Runtime Template",
		State:          "running",
		PersistedPaths: []string{"/workspace/project"},
		RuntimeSecrets: map[string]string{"API_TOKEN": "super-secret"},
		SSHAuthorizedKeys: []string{
			"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGJ1cnN0ZmxhcmV0ZXN0a2V5bWF0ZXJpYWw= flare@test",
		},
		RuntimeVersion: 3,
	})

	if bootstrap.SessionID != "ses_bootstrap" {
		t.Fatalf("unexpected bootstrap session id: %s", bootstrap.SessionID)
	}
	if !strings.Contains(state.Files[SessionMetadata], "Runtime Template") {
		t.Fatalf("expected session metadata file")
	}
	if !strings.Contains(state.Files[SecretsEnvPath], "API_TOKEN=super-secret") {
		t.Fatalf("expected secrets env file")
	}
	if !strings.Contains(state.Files[AuthorizedKeysPath], "ssh-ed25519") {
		t.Fatalf("expected authorized keys file")
	}

	lifecycle := state.RecordLifecycle(LifecyclePayload{
		SessionID: "ses_bootstrap",
		Phase:     "sleep",
		Reason:    "session_stop",
	})
	if lifecycle.Phase != "sleep" {
		t.Fatalf("unexpected lifecycle phase: %s", lifecycle.Phase)
	}
	if !strings.Contains(state.Files[LifecycleMetadata], "session_stop") {
		t.Fatalf("expected lifecycle metadata file")
	}
}

func TestEditorRouteStaysScoped(t *testing.T) {
	state := NewState()

	update, err := state.UpdateEditorFile("/workspace/project/notes.txt", "draft 1", []string{"/workspace/project"})
	if err != nil {
		t.Fatalf("update failed: %v", err)
	}
	if !update.OK || update.Path != "/workspace/project/notes.txt" {
		t.Fatalf("unexpected update: %#v", update)
	}

	listed := state.ListEditorFiles([]string{"/workspace/project"})
	if len(listed.Files) != 1 || listed.Files[0] != "/workspace/project/notes.txt" {
		t.Fatalf("unexpected listing: %#v", listed)
	}

	if _, err := state.UpdateEditorFile("/tmp/blocked.txt", "nope", []string{"/workspace/project"}); err == nil {
		t.Fatalf("expected out-of-scope editor write to fail")
	}
}

func TestBootstrapScriptHashIncludedInState(t *testing.T) {
	state := NewState()

	bootstrap := state.ApplyRuntimeBootstrap(BootstrapPayload{
		SessionID:       "ses_script",
		BootstrapScript: "#!/bin/sh\necho hello",
	})

	if bootstrap.BootstrapScriptHash == "" {
		t.Fatalf("expected bootstrap script hash to be set")
	}
	expectedHash := scriptHash("#!/bin/sh\necho hello")
	if bootstrap.BootstrapScriptHash != expectedHash {
		t.Fatalf("unexpected hash: got %s, want %s", bootstrap.BootstrapScriptHash, expectedHash)
	}
	if bootstrap.BootstrapScriptStatus != "skipped" {
		t.Fatalf("expected bootstrap script status to be skipped by default, got %s", bootstrap.BootstrapScriptStatus)
	}
}

func TestBootstrapScriptRunsOnEveryStartRequest(t *testing.T) {
	state := NewState()
	payload := BootstrapPayload{
		SessionID:          "ses_script_start",
		BootstrapScript:    "#!/bin/sh\ntrue",
		RunBootstrapScript: true,
	}

	first := state.ApplyRuntimeBootstrap(payload)
	second := state.ApplyRuntimeBootstrap(payload)

	if first.BootstrapScriptStatus != "executed" {
		t.Fatalf("expected first bootstrap execution to run, got %s", first.BootstrapScriptStatus)
	}
	if second.BootstrapScriptStatus != "executed" {
		t.Fatalf("expected second bootstrap execution to run, got %s", second.BootstrapScriptStatus)
	}
}

func TestBootstrapWithoutScriptHasNoHash(t *testing.T) {
	state := NewState()

	bootstrap := state.ApplyRuntimeBootstrap(BootstrapPayload{
		SessionID: "ses_noscript",
	})

	if bootstrap.BootstrapScriptHash != "" {
		t.Fatalf("expected no bootstrap script hash, got %s", bootstrap.BootstrapScriptHash)
	}
	if bootstrap.BootstrapScriptStatus != "" {
		t.Fatalf("expected no bootstrap script status, got %s", bootstrap.BootstrapScriptStatus)
	}
}

func TestHandlerServesHealthAndMeta(t *testing.T) {
	state := NewState()
	handler := http.Handler(state)

	healthRecorder := httptest.NewRecorder()
	healthRequest := httptest.NewRequest(http.MethodGet, HealthPath, nil)
	handler.ServeHTTP(healthRecorder, healthRequest)
	if healthRecorder.Code != http.StatusOK {
		t.Fatalf("unexpected health status: %d", healthRecorder.Code)
	}

	state.ApplyRuntimeBootstrap(BootstrapPayload{
		SessionID: "ses_http",
	})
	metaRecorder := httptest.NewRecorder()
	metaRequest := httptest.NewRequest(http.MethodGet, MetaPath+"?sessionId=ses_http", nil)
	handler.ServeHTTP(metaRecorder, metaRequest)
	if metaRecorder.Code != http.StatusOK {
		t.Fatalf("unexpected meta status: %d", metaRecorder.Code)
	}
	if !strings.Contains(metaRecorder.Body.String(), `"runtime":"go"`) {
		t.Fatalf("expected go runtime metadata")
	}
}
