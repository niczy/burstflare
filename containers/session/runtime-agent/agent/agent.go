package agent

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	HealthPath             = "/health"
	MetaPath               = "/meta"
	BootstrapPath          = "/runtime/bootstrap"
	LifecyclePath          = "/runtime/lifecycle"
	SnapshotRestorePath    = "/snapshot/restore"
	SnapshotExportPath     = "/snapshot/export"
	CommonStateRestorePath = "/common-state/restore"
	CommonStateExportPath  = "/common-state/export"
	EditorPath             = "/editor"
	ShellPath              = "/shell"
	SSHPath                = "/ssh"

	SnapshotFormat    = "burstflare.snapshot.v2"
	CommonStateFormat = "burstflare.common-state.v1"

	SnapshotContentType    = "application/vnd.burstflare.snapshot+json; charset=utf-8"
	CommonStateContentType = "application/vnd.burstflare.common-state+json; charset=utf-8"

	AuthorizedKeysPath = "/home/flare/.ssh/authorized_keys"
	LastSnapshotAlias  = "/workspace/.burstflare/last.snapshot"
	LifecycleMetadata  = "/workspace/.burstflare/lifecycle.json"
	SecretsEnvPath     = "/run/burstflare/secrets.env"
	SessionMetadata    = "/workspace/.burstflare/session.json"
)

var authorizedKeyPattern = regexp.MustCompile(`^ssh-(ed25519|rsa)\s+[A-Za-z0-9+/=]+(?:\s+.*)?$`)

type FileEntry struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type SnapshotEnvelope struct {
	Format             string      `json:"format"`
	SessionID          string      `json:"sessionId"`
	ExportedAt         string      `json:"exportedAt,omitempty"`
	RestoredSnapshotID string      `json:"restoredSnapshotId,omitempty"`
	RestoredAt         string      `json:"restoredAt,omitempty"`
	PersistedPaths     []string    `json:"persistedPaths"`
	Files              []FileEntry `json:"files"`
}

type CommonStateEnvelope struct {
	Format     string      `json:"format"`
	InstanceID string      `json:"instanceId"`
	Files      []FileEntry `json:"files"`
}

type SnapshotRestorePayload struct {
	SessionID      string   `json:"sessionId"`
	SnapshotID     string   `json:"snapshotId"`
	Label          string   `json:"label"`
	PersistedPaths []string `json:"persistedPaths"`
	ContentType    string   `json:"contentType"`
	ContentBase64  string   `json:"contentBase64"`
}

type SnapshotRestoreResult struct {
	OK             bool     `json:"ok"`
	SessionID      string   `json:"sessionId"`
	SnapshotID     string   `json:"snapshotId"`
	Label          string   `json:"label"`
	AppliedPath    string   `json:"appliedPath"`
	AliasPath      string   `json:"aliasPath"`
	RestoredAt     string   `json:"restoredAt"`
	Bytes          int      `json:"bytes"`
	ContentType    string   `json:"contentType"`
	PersistedPaths []string `json:"persistedPaths"`
	RestoredPaths  []string `json:"restoredPaths"`
}

type CommonStateRestorePayload struct {
	SessionID     string `json:"sessionId"`
	InstanceID    string `json:"instanceId"`
	ContentType   string `json:"contentType"`
	ContentBase64 string `json:"contentBase64"`
}

type CommonStateRestoreResult struct {
	OK            bool     `json:"ok"`
	SessionID     string   `json:"sessionId"`
	InstanceID    string   `json:"instanceId"`
	Bytes         int      `json:"bytes"`
	ContentType   string   `json:"contentType"`
	RestoredPaths []string `json:"restoredPaths"`
}

type BootstrapPayload struct {
	SessionID              string            `json:"sessionId"`
	WorkspaceID            string            `json:"workspaceId"`
	InstanceID             string            `json:"instanceId"`
	TemplateID             string            `json:"templateId"`
	TemplateName           string            `json:"templateName"`
	State                  string            `json:"state"`
	PreviewURL             string            `json:"previewUrl"`
	LastRestoredSnapshotID string            `json:"lastRestoredSnapshotId"`
	PersistedPaths         []string          `json:"persistedPaths"`
	RuntimeSecrets         map[string]string `json:"runtimeSecrets"`
	RuntimeVersion         int               `json:"runtimeVersion"`
	SSHAuthorizedKeys      []string          `json:"sshAuthorizedKeys"`
}

type BootstrapState struct {
	SessionID              string   `json:"sessionId"`
	WorkspaceID            string   `json:"workspaceId,omitempty"`
	InstanceID             string   `json:"instanceId,omitempty"`
	TemplateID             string   `json:"templateId,omitempty"`
	TemplateName           string   `json:"templateName,omitempty"`
	State                  string   `json:"state,omitempty"`
	PreviewURL             string   `json:"previewUrl,omitempty"`
	LastRestoredSnapshotID string   `json:"lastRestoredSnapshotId,omitempty"`
	PersistedPaths         []string `json:"persistedPaths"`
	RuntimeSecretNames     []string `json:"runtimeSecretNames"`
	SSHKeyCount            int      `json:"sshKeyCount"`
	RuntimeVersion         int      `json:"runtimeVersion"`
	BootstrappedAt         string   `json:"bootstrappedAt"`
}

type LifecyclePayload struct {
	SessionID string `json:"sessionId"`
	Phase     string `json:"phase"`
	Reason    string `json:"reason"`
}

type LifecycleState struct {
	SessionID  string `json:"sessionId"`
	Phase      string `json:"phase"`
	Reason     string `json:"reason"`
	RecordedAt string `json:"recordedAt"`
}

type RuntimeState struct {
	mu                  sync.Mutex
	RestoredSnapshotID  string
	RestoredAt          string
	RestoredBytes       int
	RestoredContentType string
	PersistedPaths      []string
	SecretNames         []string
	SSHAuthorizedKeys   []string
	Bootstrap           *BootstrapState
	LastLifecycle       *LifecycleState
	Files               map[string]string
}

func NewState() *RuntimeState {
	ensureRuntimeFilesystemLayout()
	return &RuntimeState{
		Files: map[string]string{},
	}
}

func NewHandler() http.Handler {
	return NewState()
}

func ensureRuntimeFilesystemLayout() {
	paths := []string{
		"/workspace",
		"/workspace/.burstflare",
		"/workspace/.burstflare/snapshots",
		"/home/flare",
		"/home/flare/.ssh",
	}
	for _, entry := range paths {
		_ = os.MkdirAll(entry, 0o755)
	}
	_ = os.Chmod("/home/flare/.ssh", 0o700)

	if uid, gid, ok := runtimeUserIdentity(); ok {
		for _, entry := range []string{"/workspace", "/workspace/.burstflare", "/workspace/.burstflare/snapshots", "/home/flare", "/home/flare/.ssh"} {
			_ = os.Chown(entry, uid, gid)
		}
	}
}

func NormalizePersistedPaths(values []string) []string {
	normalized := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, entry := range values {
		value := strings.TrimSpace(entry)
		if value == "" {
			continue
		}
		if !strings.HasPrefix(value, "/") {
			value = "/" + value
		}
		safe := path.Clean(value)
		if !strings.HasPrefix(safe, "/") {
			continue
		}
		if _, exists := seen[safe]; exists {
			continue
		}
		seen[safe] = struct{}{}
		normalized = append(normalized, safe)
	}
	return normalized
}

func normalizeRuntimeFilePath(value string) string {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return ""
	}
	if !strings.HasPrefix(raw, "/") {
		raw = "/" + raw
	}
	safe := path.Clean(raw)
	if !strings.HasPrefix(safe, "/") {
		return ""
	}
	return safe
}

func isWithinPersistedPaths(filePath string, persistedPaths []string) bool {
	if filePath == "" || len(persistedPaths) == 0 {
		return false
	}
	for _, basePath := range persistedPaths {
		if filePath == basePath || strings.HasPrefix(filePath, basePath+"/") {
			return true
		}
	}
	return false
}

func (s *RuntimeState) resetPersistedFiles(persistedPaths []string) {
	for filePath := range s.Files {
		if isWithinPersistedPaths(filePath, persistedPaths) {
			delete(s.Files, filePath)
		}
	}
}

func collectPersistedFilesystemFiles(persistedPaths []string) []FileEntry {
	normalizedPaths := NormalizePersistedPaths(persistedPaths)
	filesByPath := map[string]string{}

	for _, basePath := range normalizedPaths {
		info, err := os.Stat(basePath)
		if err != nil {
			continue
		}
		if !info.IsDir() {
			content, readErr := os.ReadFile(basePath)
			if readErr == nil {
				filesByPath[basePath] = string(content)
			}
			continue
		}
		_ = filepath.WalkDir(basePath, func(current string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil || entry.IsDir() {
				return nil
			}
			if entry.Type()&os.ModeSymlink != 0 {
				return nil
			}
			filePath := normalizeRuntimeFilePath(current)
			if filePath == "" || !isWithinPersistedPaths(filePath, normalizedPaths) {
				return nil
			}
			content, readErr := os.ReadFile(current)
			if readErr != nil {
				return nil
			}
			filesByPath[filePath] = string(content)
			return nil
		})
	}

	files := make([]FileEntry, 0, len(filesByPath))
	for filePath, content := range filesByPath {
		files = append(files, FileEntry{
			Path:    filePath,
			Content: content,
		})
	}
	sort.Slice(files, func(i, j int) bool {
		return files[i].Path < files[j].Path
	})
	return files
}

func clearPersistedFilesystem(persistedPaths []string) {
	for _, basePath := range NormalizePersistedPaths(persistedPaths) {
		if basePath == "/" {
			continue
		}
		entries, err := os.ReadDir(basePath)
		if err != nil {
			if os.IsNotExist(err) {
				_ = os.MkdirAll(basePath, 0o755)
			}
			continue
		}
		for _, entry := range entries {
			_ = os.RemoveAll(path.Join(basePath, entry.Name()))
		}
	}
	ensureRuntimeFilesystemLayout()
}

func writeRuntimeFile(filePath string, content string) {
	normalized := normalizeRuntimeFilePath(filePath)
	if normalized == "" {
		return
	}
	parent := path.Dir(normalized)
	_ = os.MkdirAll(parent, 0o755)
	_ = os.WriteFile(normalized, []byte(content), 0o644)
	if uid, gid, ok := runtimeUserIdentity(); ok {
		_ = os.Chown(parent, uid, gid)
		_ = os.Chown(normalized, uid, gid)
	}
}

func parseSnapshotEnvelope(raw []byte, contentType string, persistedPaths []string) *SnapshotEnvelope {
	if !strings.Contains(contentType, "json") && !strings.Contains(contentType, "burstflare.snapshot+json") {
		return nil
	}

	var parsed SnapshotEnvelope
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil
	}
	if parsed.Format != SnapshotFormat {
		return nil
	}

	normalizedPaths := NormalizePersistedPaths(persistedPaths)
	filtered := make([]FileEntry, 0, len(parsed.Files))
	for _, file := range parsed.Files {
		filePath := normalizeRuntimeFilePath(file.Path)
		if filePath == "" || !isWithinPersistedPaths(filePath, normalizedPaths) {
			continue
		}
		filtered = append(filtered, FileEntry{
			Path:    filePath,
			Content: file.Content,
		})
	}

	return &SnapshotEnvelope{
		Format:         SnapshotFormat,
		PersistedPaths: normalizedPaths,
		Files:          filtered,
	}
}

func (s *RuntimeState) createSnapshotEnvelope(sessionID string, persistedPaths []string) SnapshotEnvelope {
	normalizedPaths := NormalizePersistedPaths(persistedPaths)
	filesByPath := map[string]string{}
	for filePath, content := range s.Files {
		if isWithinPersistedPaths(filePath, normalizedPaths) {
			filesByPath[filePath] = content
		}
	}
	for _, file := range collectPersistedFilesystemFiles(normalizedPaths) {
		filesByPath[file.Path] = file.Content
	}
	files := make([]FileEntry, 0, len(filesByPath))
	for filePath, content := range filesByPath {
		files = append(files, FileEntry{
			Path:    filePath,
			Content: content,
		})
	}
	sort.Slice(files, func(i, j int) bool {
		return files[i].Path < files[j].Path
	})

	return SnapshotEnvelope{
		Format:             SnapshotFormat,
		SessionID:          defaultString(sessionID, "unknown"),
		ExportedAt:         nowISO(),
		RestoredSnapshotID: s.RestoredSnapshotID,
		RestoredAt:         s.RestoredAt,
		PersistedPaths:     normalizedPaths,
		Files:              files,
	}
}

func (s *RuntimeState) ApplySnapshotRestore(payload SnapshotRestorePayload) (SnapshotRestoreResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	sessionID := defaultString(payload.SessionID, "unknown")
	snapshotID := defaultString(payload.SnapshotID, "unknown")
	label := defaultString(payload.Label, snapshotID)
	contentType := defaultString(payload.ContentType, "application/octet-stream")
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(payload.ContentBase64))
	if err != nil {
		return SnapshotRestoreResult{}, err
	}
	snapshotPath := fmt.Sprintf("/workspace/.burstflare/snapshots/%s.snapshot", snapshotID)
	persistedPaths := NormalizePersistedPaths(payload.PersistedPaths)
	envelope := parseSnapshotEnvelope(raw, contentType, persistedPaths)

	s.PersistedPaths = persistedPaths
	s.resetPersistedFiles(persistedPaths)
	s.RestoredSnapshotID = snapshotID
	s.RestoredAt = nowISO()
	s.RestoredBytes = len(raw)
	s.RestoredContentType = contentType

	restoredPaths := make([]string, 0)
	if envelope != nil {
		clearPersistedFilesystem(persistedPaths)
		for _, file := range envelope.Files {
			s.Files[file.Path] = file.Content
			writeRuntimeFile(file.Path, file.Content)
			restoredPaths = append(restoredPaths, file.Path)
		}
	}

	var snapshotBody []byte
	if envelope != nil {
		exported, _ := json.MarshalIndent(s.createSnapshotEnvelope(sessionID, persistedPaths), "", "  ")
		snapshotBody = exported
	} else {
		snapshotBody = raw
	}
	s.Files[snapshotPath] = string(snapshotBody)
	s.Files[LastSnapshotAlias] = string(snapshotBody)

	return SnapshotRestoreResult{
		OK:             true,
		SessionID:      sessionID,
		SnapshotID:     snapshotID,
		Label:          label,
		AppliedPath:    snapshotPath,
		AliasPath:      LastSnapshotAlias,
		RestoredAt:     s.RestoredAt,
		Bytes:          len(raw),
		ContentType:    contentType,
		PersistedPaths: persistedPaths,
		RestoredPaths:  restoredPaths,
	}, nil
}

func (s *RuntimeState) ExportSnapshotPayload(sessionID string, persistedPaths []string) ([]byte, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	body, err := json.MarshalIndent(s.createSnapshotEnvelope(sessionID, persistedPaths), "", "  ")
	if err != nil {
		return nil, "", err
	}
	return body, SnapshotContentType, nil
}

func isWithinCommonState(filePath string) bool {
	return filePath == "/home/flare" || strings.HasPrefix(filePath, "/home/flare/")
}

func (s *RuntimeState) listCommonStateFiles() []FileEntry {
	files := make([]FileEntry, 0)
	for filePath, content := range s.Files {
		if isWithinCommonState(filePath) && filePath != AuthorizedKeysPath {
			files = append(files, FileEntry{
				Path:    filePath,
				Content: content,
			})
		}
	}
	sort.Slice(files, func(i, j int) bool {
		return files[i].Path < files[j].Path
	})
	return files
}

func (s *RuntimeState) resetCommonStateFiles() {
	for filePath := range s.Files {
		if isWithinCommonState(filePath) && filePath != AuthorizedKeysPath {
			delete(s.Files, filePath)
		}
	}
}

func (s *RuntimeState) ApplyCommonStateRestore(payload CommonStateRestorePayload) (CommonStateRestoreResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	sessionID := defaultString(payload.SessionID, "unknown")
	instanceID := defaultString(payload.InstanceID, "unknown")
	contentType := defaultString(payload.ContentType, "application/octet-stream")
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(payload.ContentBase64))
	if err != nil {
		return CommonStateRestoreResult{}, err
	}

	var parsed CommonStateEnvelope
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return CommonStateRestoreResult{}, err
	}
	if parsed.Format != CommonStateFormat {
		return CommonStateRestoreResult{}, fmt.Errorf("invalid common state payload")
	}

	s.resetCommonStateFiles()
	restoredPaths := make([]string, 0)
	for _, file := range parsed.Files {
		filePath := normalizeRuntimeFilePath(file.Path)
		if filePath == "" || !isWithinCommonState(filePath) || filePath == AuthorizedKeysPath {
			continue
		}
		s.Files[filePath] = file.Content
		restoredPaths = append(restoredPaths, filePath)
	}

	return CommonStateRestoreResult{
		OK:            true,
		SessionID:     sessionID,
		InstanceID:    instanceID,
		Bytes:         len(raw),
		ContentType:   contentType,
		RestoredPaths: restoredPaths,
	}, nil
}

func (s *RuntimeState) ExportCommonStatePayload(instanceID string) ([]byte, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	body, err := json.MarshalIndent(CommonStateEnvelope{
		Format:     CommonStateFormat,
		InstanceID: defaultString(instanceID, "unknown"),
		Files:      s.listCommonStateFiles(),
	}, "", "  ")
	if err != nil {
		return nil, "", err
	}
	return body, CommonStateContentType, nil
}

func normalizeAuthorizedKeys(values []string) []string {
	normalized := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, entry := range values {
		value := strings.TrimSpace(entry)
		if value == "" || !authorizedKeyPattern.MatchString(value) {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		normalized = append(normalized, value)
	}
	return normalized
}

func (s *RuntimeState) applyAuthorizedKeys(values []string) []string {
	keys := normalizeAuthorizedKeys(values)
	s.SSHAuthorizedKeys = keys
	sshDir := "/home/flare/.ssh"
	body := ""
	if len(keys) > 0 {
		body = strings.Join(keys, "\n") + "\n"
	}
	_ = os.MkdirAll(sshDir, 0o700)
	_ = os.Chmod(sshDir, 0o700)
	_ = os.WriteFile(AuthorizedKeysPath, []byte(body), 0o600)
	_ = os.Chmod(AuthorizedKeysPath, 0o600)
	if uid, gid, ok := runtimeUserIdentity(); ok {
		_ = os.Chown(sshDir, uid, gid)
		_ = os.Chown(AuthorizedKeysPath, uid, gid)
	}
	s.Files[AuthorizedKeysPath] = body
	return keys
}

func (s *RuntimeState) ApplyRuntimeBootstrap(payload BootstrapPayload) BootstrapState {
	s.mu.Lock()
	defer s.mu.Unlock()

	persistedPaths := getEditorScope(payload.PersistedPaths)
	runtimeSecrets := payload.RuntimeSecrets
	if runtimeSecrets == nil {
		runtimeSecrets = map[string]string{}
	}
	runtimeSecretNames := make([]string, 0, len(runtimeSecrets))
	for name := range runtimeSecrets {
		runtimeSecretNames = append(runtimeSecretNames, name)
	}
	sort.Strings(runtimeSecretNames)
	secretsLines := make([]string, 0, len(runtimeSecretNames))
	for _, name := range runtimeSecretNames {
		secretsLines = append(secretsLines, fmt.Sprintf("%s=%s", name, runtimeSecrets[name]))
	}
	sshAuthorizedKeys := s.applyAuthorizedKeys(payload.SSHAuthorizedKeys)
	bootstrap := BootstrapState{
		SessionID:              defaultString(payload.SessionID, "unknown"),
		WorkspaceID:            payload.WorkspaceID,
		InstanceID:             payload.InstanceID,
		TemplateID:             payload.TemplateID,
		TemplateName:           payload.TemplateName,
		State:                  payload.State,
		PreviewURL:             payload.PreviewURL,
		LastRestoredSnapshotID: payload.LastRestoredSnapshotID,
		PersistedPaths:         persistedPaths,
		RuntimeSecretNames:     runtimeSecretNames,
		SSHKeyCount:            len(sshAuthorizedKeys),
		RuntimeVersion:         payload.RuntimeVersion,
		BootstrappedAt:         nowISO(),
	}
	s.PersistedPaths = persistedPaths
	s.SecretNames = runtimeSecretNames
	s.Bootstrap = &bootstrap

	sessionBody, _ := json.MarshalIndent(bootstrap, "", "  ")
	s.Files[SessionMetadata] = string(sessionBody)
	if len(secretsLines) > 0 {
		secretsBody := strings.Join(secretsLines, "\n") + "\n"
		_ = os.MkdirAll("/run/burstflare", 0o755)
		_ = os.WriteFile(SecretsEnvPath, []byte(secretsBody), 0o600)
		s.Files[SecretsEnvPath] = secretsBody
	} else {
		delete(s.Files, SecretsEnvPath)
	}

	return bootstrap
}

func (s *RuntimeState) RecordLifecycle(payload LifecyclePayload) LifecycleState {
	s.mu.Lock()
	defer s.mu.Unlock()

	sessionID := defaultString(payload.SessionID, "unknown")
	if s.Bootstrap != nil && sessionID == "" {
		sessionID = s.Bootstrap.SessionID
	}
	phase := defaultString(payload.Phase, "unknown")
	reason := defaultString(payload.Reason, phase)
	lifecycle := LifecycleState{
		SessionID:  sessionID,
		Phase:      phase,
		Reason:     reason,
		RecordedAt: nowISO(),
	}
	s.LastLifecycle = &lifecycle
	body, _ := json.MarshalIndent(lifecycle, "", "  ")
	s.Files[LifecycleMetadata] = string(body)
	return lifecycle
}

func getEditorScope(persistedPaths []string) []string {
	normalized := NormalizePersistedPaths(persistedPaths)
	if len(normalized) == 0 {
		return []string{"/workspace"}
	}
	return normalized
}

func defaultEditorPath(scope []string) string {
	basePath := "/workspace"
	if len(scope) > 0 && scope[0] != "" {
		basePath = scope[0]
	}
	trimmed := strings.TrimRight(basePath, "/")
	if trimmed == "" {
		trimmed = "/workspace"
	}
	return trimmed + "/notes.txt"
}

type EditorListing struct {
	Scope []string `json:"scope"`
	Files []string `json:"files"`
}

func (s *RuntimeState) ListEditorFiles(persistedPaths []string) EditorListing {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.listEditorFilesUnlocked(persistedPaths)
}

func (s *RuntimeState) listEditorFilesUnlocked(persistedPaths []string) EditorListing {
	scope := getEditorScope(persistedPaths)
	files := make([]string, 0)
	for filePath := range s.Files {
		if isWithinPersistedPaths(filePath, scope) {
			files = append(files, filePath)
		}
	}
	sort.Strings(files)
	if len(files) == 0 {
		files = append(files, defaultEditorPath(scope))
	}
	return EditorListing{
		Scope: scope,
		Files: files,
	}
}

type EditorUpdateResult struct {
	OK    bool     `json:"ok"`
	Path  string   `json:"path"`
	Scope []string `json:"scope"`
}

func (s *RuntimeState) UpdateEditorFile(filePath string, content string, persistedPaths []string) (EditorUpdateResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	listed := s.listEditorFilesUnlocked(persistedPaths)
	normalized := normalizeRuntimeFilePath(filePath)
	if normalized == "" || !isWithinPersistedPaths(normalized, listed.Scope) {
		return EditorUpdateResult{}, fmt.Errorf("editor path must stay inside the configured persisted paths")
	}
	s.PersistedPaths = listed.Scope
	s.Files[normalized] = content
	writeRuntimeFile(normalized, content)
	return EditorUpdateResult{
		OK:    true,
		Path:  normalized,
		Scope: listed.Scope,
	}, nil
}

func (s *RuntimeState) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.URL.Path == HealthPath && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":       true,
			"hostname": hostName(),
			"now":      nowISO(),
		})
		return
	case r.URL.Path == MetaPath && r.Method == http.MethodGet:
		s.mu.Lock()
		payload := map[string]any{
			"path":               r.URL.Path,
			"search":             r.URL.RawQuery,
			"hostname":           hostName(),
			"runtime":            "go",
			"restoredSnapshotId": s.RestoredSnapshotID,
			"restoredAt":         s.RestoredAt,
			"bootstrap":          s.Bootstrap,
			"lastLifecycle":      s.LastLifecycle,
		}
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, payload)
		return
	case r.URL.Path == BootstrapPath && r.Method == http.MethodPost:
		var payload BootstrapPayload
		if err := decodeJSON(r, &payload); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		bootstrap := s.ApplyRuntimeBootstrap(payload)
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":        true,
			"bootstrap": bootstrap,
		})
		return
	case r.URL.Path == LifecyclePath && r.Method == http.MethodPost:
		var payload LifecyclePayload
		if err := decodeJSON(r, &payload); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		lifecycle := s.RecordLifecycle(payload)
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":        true,
			"lifecycle": lifecycle,
		})
		return
	case r.URL.Path == SnapshotRestorePath && r.Method == http.MethodPost:
		var payload SnapshotRestorePayload
		if err := decodeJSON(r, &payload); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		result, err := s.ApplySnapshotRestore(payload)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
		return
	case r.URL.Path == SnapshotExportPath && (r.Method == http.MethodPost || r.Method == http.MethodGet):
		sessionID := r.URL.Query().Get("sessionId")
		persistedPaths := []string{}
		if r.Method == http.MethodPost {
			var payload struct {
				SessionID      string   `json:"sessionId"`
				PersistedPaths []string `json:"persistedPaths"`
			}
			if err := decodeJSON(r, &payload); err != nil {
				writeError(w, http.StatusBadRequest, err)
				return
			}
			if payload.SessionID != "" {
				sessionID = payload.SessionID
			}
			persistedPaths = payload.PersistedPaths
		}
		body, contentType, err := s.ExportSnapshotPayload(sessionID, persistedPaths)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeBytes(w, http.StatusOK, contentType, body)
		return
	case r.URL.Path == CommonStateRestorePath && r.Method == http.MethodPost:
		var payload CommonStateRestorePayload
		if err := decodeJSON(r, &payload); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		result, err := s.ApplyCommonStateRestore(payload)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
		return
	case r.URL.Path == CommonStateExportPath && (r.Method == http.MethodPost || r.Method == http.MethodGet):
		instanceID := r.URL.Query().Get("instanceId")
		if r.Method == http.MethodPost {
			var payload struct {
				InstanceID string `json:"instanceId"`
			}
			if err := decodeJSON(r, &payload); err != nil {
				writeError(w, http.StatusBadRequest, err)
				return
			}
			if payload.InstanceID != "" {
				instanceID = payload.InstanceID
			}
		}
		body, contentType, err := s.ExportCommonStatePayload(instanceID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeBytes(w, http.StatusOK, contentType, body)
		return
	case r.URL.Path == EditorPath && (r.Method == http.MethodGet || r.Method == http.MethodPost):
		s.handleEditor(w, r)
		return
	case r.URL.Path == ShellPath:
		s.handleShell(w, r)
		return
	case r.URL.Path == SSHPath:
		s.handleSSH(w, r)
		return
	default:
		w.Header().Set("content-type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(s.renderRuntimeHTML(r)))
	}
}

func (s *RuntimeState) handleEditor(w http.ResponseWriter, r *http.Request) {
	sessionID := defaultString(r.URL.Query().Get("sessionId"), "unknown")
	requestedPaths := r.URL.Query()["persistedPath"]
	csrfToken := r.URL.Query().Get("csrf")
	scope := getEditorScope(requestedPaths)
	if len(requestedPaths) == 0 {
		s.mu.Lock()
		scope = getEditorScope(s.PersistedPaths)
		s.PersistedPaths = scope
		s.mu.Unlock()
	} else {
		s.mu.Lock()
		s.PersistedPaths = scope
		s.mu.Unlock()
	}

	activePath := r.URL.Query().Get("path")
	saved := false
	if r.Method == http.MethodPost {
		if err := r.ParseForm(); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		updated, err := s.UpdateEditorFile(r.Form.Get("path"), r.Form.Get("content"), scope)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		activePath = updated.Path
		saved = true
	}

	listed := s.ListEditorFiles(scope)
	selectedPath := normalizeRuntimeFilePath(activePath)
	filePath := defaultEditorPath(listed.Scope)
	if len(listed.Files) > 0 {
		filePath = listed.Files[0]
	}
	if selectedPath != "" && isWithinPersistedPaths(selectedPath, listed.Scope) {
		filePath = selectedPath
	}

	w.Header().Set("content-type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(s.renderEditorHTML(sessionID, filePath, listed, saved, csrfToken)))
}

func (s *RuntimeState) renderEditorHTML(sessionID string, filePath string, listed EditorListing, saved bool, csrfToken string) string {
	s.mu.Lock()
	content := s.Files[filePath]
	s.mu.Unlock()

	scopeRows := make([]string, 0, len(listed.Scope))
	for _, entry := range listed.Scope {
		scopeRows = append(scopeRows, "<li>"+html.EscapeString(entry)+"</li>")
	}

	fileRows := make([]string, 0, len(listed.Files))
	for _, entry := range listed.Files {
		fileRows = append(fileRows, `<a href="?path=`+entry+`">`+html.EscapeString(entry)+`</a>`)
	}

	statusText := "Editing the live container runtime."
	if saved {
		statusText = "Saved to the live container runtime."
	}

	return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BurstFlare Editor ` + html.EscapeString(sessionID) + `</title>
  </head>
  <body>
    <main>
      <h1>Workspace Editor</h1>
      <p>Session ` + html.EscapeString(sessionID) + `</p>
      <ul>` + strings.Join(scopeRows, "") + `</ul>
      <nav>` + strings.Join(fileRows, "") + `</nav>
      <form method="POST">
        <input type="hidden" name="csrf" value="` + html.EscapeString(csrfToken) + `" />
        <input name="path" value="` + html.EscapeString(filePath) + `" />
        <textarea name="content">` + html.EscapeString(content) + `</textarea>
        <button type="submit">Save File</button>
      </form>
      <p>` + html.EscapeString(statusText) + `</p>
    </main>
  </body>
</html>`
}

func (s *RuntimeState) renderRuntimeHTML(r *http.Request) string {
	sessionID := defaultString(r.URL.Query().Get("sessionId"), "unknown")
	s.mu.Lock()
	payload := map[string]any{
		"sessionId":          sessionID,
		"hostname":           hostName(),
		"now":                nowISO(),
		"runtime":            "go",
		"restoredSnapshotId": s.RestoredSnapshotID,
		"restoredAt":         s.RestoredAt,
		"bootstrap":          s.Bootstrap,
		"lastLifecycle":      s.LastLifecycle,
		"persistedPaths":     s.PersistedPaths,
	}
	restoredFiles := make([]string, 0, len(s.Files))
	for filePath := range s.Files {
		restoredFiles = append(restoredFiles, filePath)
	}
	sort.Strings(restoredFiles)
	payload["restoredFiles"] = restoredFiles
	s.mu.Unlock()

	body, _ := json.MarshalIndent(payload, "", "  ")
	return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BurstFlare Session ` + html.EscapeString(sessionID) + `</title>
  </head>
  <body>
    <main>
      <h1>BurstFlare Session ` + html.EscapeString(sessionID) + `</h1>
      <pre>` + html.EscapeString(string(body)) + `</pre>
    </main>
  </body>
</html>`
}

func decodeJSON(r *http.Request, target any) error {
	defer r.Body.Close()
	buffer := bytes.NewBuffer(nil)
	if _, err := buffer.ReadFrom(r.Body); err != nil {
		return err
	}
	raw := strings.TrimSpace(buffer.String())
	if raw == "" {
		raw = "{}"
	}
	return json.Unmarshal([]byte(raw), target)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	body, err := json.Marshal(payload)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeBytes(w, status, "application/json; charset=utf-8", body)
}

func writeBytes(w http.ResponseWriter, status int, contentType string, body []byte) {
	w.Header().Set("content-type", contentType)
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]any{
		"error": defaultString(err.Error(), http.StatusText(status)),
	})
}

func defaultString(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func nowISO() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

func hostName() string {
	name, err := os.Hostname()
	if err != nil || strings.TrimSpace(name) == "" {
		return "unknown"
	}
	return name
}
