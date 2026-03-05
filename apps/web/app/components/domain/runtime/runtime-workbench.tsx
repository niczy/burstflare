"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "../../primitives/badge.js";
import { Button } from "../../primitives/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../primitives/card.js";
import { Input } from "../../primitives/input.js";
import { clientApiJson } from "../../../lib/client/api.js";
import type { RuntimeAttachResponse, SessionRecord } from "../../../lib/types.js";

type ToastKind = "info" | "success" | "error";

type RuntimeWorkbenchProps = {
  sessions: SessionRecord[];
  disabled?: boolean;
  onError?: (message: string) => void;
  onToast?: (kind: ToastKind, message: string) => void;
};

type TerminalStatus = "disconnected" | "connecting" | "connected" | "reconnecting" | "error";

function normalizeError(error: unknown): string {
  if (error && typeof error === "object" && "error" in error) {
    return String((error as { error: unknown }).error || "Request failed");
  }
  return error instanceof Error ? error.message : "Request failed";
}

function pickSessionId(sessions: SessionRecord[], current: string): string {
  if (current && sessions.some((entry) => entry.id === current)) {
    return current;
  }
  const running = sessions.find((entry) => entry.state === "running");
  if (running) {
    return running.id;
  }
  return sessions[0]?.id || "";
}

function statusVariant(status: TerminalStatus): "default" | "accent" {
  return status === "connected" ? "accent" : "default";
}

function toWebSocketUrl(sessionId: string, token: string): string {
  const base = typeof window !== "undefined" ? window.location.origin : "https://burstflare.dev";
  const url = new URL(`/runtime/sessions/${sessionId}/terminal`, base);
  if (token) {
    url.searchParams.set("token", token);
  }
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function toSshAttachUrl(sessionId: string, token: string): string {
  const base = typeof window !== "undefined" ? window.location.origin : "https://burstflare.dev";
  const url = new URL(`/runtime/sessions/${sessionId}/ssh`, base);
  url.searchParams.set("token", token);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function RuntimeWorkbench({ sessions, disabled = false, onError, onToast }: RuntimeWorkbenchProps) {
  const [selectedSessionId, setSelectedSessionId] = useState(() => pickSessionId(sessions, ""));
  const [terminalStatus, setTerminalStatus] = useState<TerminalStatus>("disconnected");
  const [terminalOutput, setTerminalOutput] = useState("Waiting for terminal attach...");
  const [terminalInput, setTerminalInput] = useState("");
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [runtimeToken, setRuntimeToken] = useState("");
  const [sshCommand, setSshCommand] = useState("");
  const [sshAttachUrl, setSshAttachUrl] = useState("");

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const manualCloseRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const sessionIdRef = useRef(selectedSessionId);
  const terminalUrlRef = useRef("");

  const selectedSession = useMemo(
    () => sessions.find((entry) => entry.id === selectedSessionId) || null,
    [selectedSessionId, sessions]
  );

  const canAttach = Boolean(selectedSession) && selectedSession?.state === "running" && !disabled;
  const previewHref = selectedSession?.previewUrl || "";
  const editorHref = selectedSession
    ? `/runtime/sessions/${selectedSession.id}/editor?path=${encodeURIComponent("/workspace")}`
    : "";

  function emitToast(kind: ToastKind, message: string): void {
    onToast?.(kind, message);
  }

  function emitError(message: string): void {
    onError?.(message);
    emitToast("error", message);
  }

  function appendTerminalLine(line: string): void {
    const next = line || "";
    setTerminalOutput((previous) => {
      if (!previous || previous === "Waiting for terminal attach...") {
        return next;
      }
      return `${previous}\n${next}`;
    });
  }

  function clearReconnectTimer(): void {
    if (reconnectTimerRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }

  function closeTerminal(message = "Terminal disconnected."): void {
    manualCloseRef.current = true;
    clearReconnectTimer();
    const socket = socketRef.current;
    socketRef.current = null;
    terminalUrlRef.current = "";
    if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
      socket.close();
    }
    reconnectAttemptsRef.current = 0;
    setTerminalStatus("disconnected");
    appendTerminalLine(message);
  }

  function openTerminal(url: string, sessionId: string): void {
    if (!url || !sessionId) {
      return;
    }
    clearReconnectTimer();
    manualCloseRef.current = false;
    terminalUrlRef.current = url;
    setTerminalStatus(reconnectAttemptsRef.current > 0 ? "reconnecting" : "connecting");

    const socket = new WebSocket(url);
    socketRef.current = socket;

    socket.onopen = () => {
      reconnectAttemptsRef.current = 0;
      setTerminalStatus("connected");
      appendTerminalLine(`Connected to ${sessionId}.`);
    };

    socket.onmessage = (event) => {
      if (typeof event.data === "string") {
        appendTerminalLine(event.data);
        return;
      }
      if (event.data instanceof ArrayBuffer) {
        appendTerminalLine(new TextDecoder().decode(event.data));
        return;
      }
      if (typeof Blob !== "undefined" && event.data instanceof Blob) {
        void event.data.text().then((text) => appendTerminalLine(text));
      }
    };

    socket.onerror = () => {
      setTerminalStatus("error");
    };

    socket.onclose = () => {
      socketRef.current = null;
      if (manualCloseRef.current || sessionIdRef.current !== sessionId) {
        setTerminalStatus("disconnected");
        return;
      }

      if (reconnectAttemptsRef.current < 4 && terminalUrlRef.current) {
        reconnectAttemptsRef.current += 1;
        const delayMs = Math.min(5000, 500 * 2 ** reconnectAttemptsRef.current);
        setTerminalStatus("reconnecting");
        appendTerminalLine(`Connection dropped. Reconnecting in ${Math.ceil(delayMs / 1000)}s...`);
        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null;
          if (sessionIdRef.current !== sessionId) {
            return;
          }
          openTerminal(terminalUrlRef.current, sessionId);
        }, delayMs);
        return;
      }

      setTerminalStatus("error");
      appendTerminalLine("Terminal connection closed.");
      emitToast("error", "Terminal disconnected. Reconnect to continue.");
    };
  }

  async function requestRuntimeToken(sessionId: string): Promise<RuntimeAttachResponse> {
    return clientApiJson<RuntimeAttachResponse>(`/api/sessions/${sessionId}/ssh-token`, {
      method: "POST"
    });
  }

  async function connectTerminal(): Promise<void> {
    if (!selectedSession) {
      emitError("Select a session first.");
      return;
    }
    if (selectedSession.state !== "running") {
      emitError("Session must be running before attaching terminal.");
      return;
    }

    closeTerminal("Preparing terminal attach...");
    setTerminalBusy(true);
    try {
      let token = "";
      try {
        const attach = await requestRuntimeToken(selectedSession.id);
        token = attach.token || "";
        setRuntimeToken(token);
        if (attach.sshCommand) {
          setSshCommand(attach.sshCommand);
        }
        if (token) {
          setSshAttachUrl(toSshAttachUrl(selectedSession.id, token));
        }
      } catch (tokenError) {
        const message = normalizeError(tokenError);
        emitToast("info", `${message}. Falling back to browser session attach.`);
      }

      const terminalUrl = toWebSocketUrl(selectedSession.id, token);
      setTerminalOutput("Connecting...");
      openTerminal(terminalUrl, selectedSession.id);
      emitToast("success", "Terminal attach requested.");
    } catch (connectError) {
      const message = normalizeError(connectError);
      emitError(message);
      setTerminalStatus("error");
    } finally {
      setTerminalBusy(false);
    }
  }

  async function fetchSshDetails(): Promise<void> {
    if (!selectedSession) {
      emitError("Select a session first.");
      return;
    }
    if (selectedSession.state !== "running") {
      emitError("Session must be running before requesting SSH attach details.");
      return;
    }

    setTerminalBusy(true);
    try {
      const attach = await requestRuntimeToken(selectedSession.id);
      if (!attach.token) {
        throw new Error("Runtime token missing.");
      }
      setRuntimeToken(attach.token);
      setSshCommand(attach.sshCommand || "");
      setSshAttachUrl(toSshAttachUrl(selectedSession.id, attach.token));
      emitToast("success", "SSH attach details loaded.");
    } catch (sshError) {
      emitError(normalizeError(sshError));
    } finally {
      setTerminalBusy(false);
    }
  }

  async function copySshCommand(): Promise<void> {
    if (!sshCommand) {
      emitError("Fetch SSH details first.");
      return;
    }
    if (!navigator?.clipboard?.writeText) {
      emitError("Clipboard API is unavailable in this browser.");
      return;
    }
    try {
      await navigator.clipboard.writeText(sshCommand);
      emitToast("success", "SSH command copied.");
    } catch (_error) {
      emitError("Failed to copy SSH command.");
    }
  }

  function sendTerminalInput(): void {
    const value = terminalInput.trim();
    if (!value) {
      return;
    }
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      emitError("Terminal is not connected.");
      return;
    }
    socket.send(value);
    appendTerminalLine(`$ ${value}`);
    setTerminalInput("");
  }

  useEffect(() => {
    setSelectedSessionId((current) => pickSessionId(sessions, current));
  }, [sessions]);

  useEffect(() => {
    sessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    closeTerminal("Session changed. Terminal disconnected.");
    setTerminalOutput("Waiting for terminal attach...");
    setRuntimeToken("");
    setSshAttachUrl("");
    setSshCommand("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId]);

  useEffect(() => {
    return () => {
      closeTerminal();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Runtime access</CardTitle>
        <CardDescription>Launch preview/editor, fetch SSH attach details, and use a reconnecting browser terminal.</CardDescription>
      </CardHeader>
      <CardContent className="runtime-shell">
        <div className="dashboard-field">
          <label htmlFor="runtimeSession">Session</label>
          <select
            id="runtimeSession"
            className="dashboard-select"
            value={selectedSessionId}
            disabled={disabled || sessions.length === 0}
            onChange={(event) => setSelectedSessionId(event.target.value)}
          >
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.name} ({session.state})
              </option>
            ))}
          </select>
        </div>

        <div className="runtime-status-row">
          <Badge variant={statusVariant(terminalStatus)}>{terminalStatus}</Badge>
          <Badge variant={selectedSession?.state === "running" ? "accent" : "default"}>
            {selectedSession?.state || "no-session"}
          </Badge>
          <span className="dashboard-copy">Active websocket clients keep running sessions alive.</span>
        </div>

        <div className="runtime-row">
          <div className="inline-actions">
            {previewHref ? (
              <a className="dashboard-link" href={previewHref} target="_blank" rel="noreferrer">
                Preview
              </a>
            ) : (
              <span className="dashboard-copy">Preview unavailable</span>
            )}
            {editorHref ? (
              <a className="dashboard-link" href={editorHref} target="_blank" rel="noreferrer">
                Editor
              </a>
            ) : (
              <span className="dashboard-copy">Editor unavailable</span>
            )}
            <Button variant="secondary" onClick={fetchSshDetails} disabled={!canAttach || terminalBusy}>
              Fetch SSH details
            </Button>
            <Button variant="secondary" onClick={copySshCommand} disabled={!sshCommand || disabled}>
              Copy SSH command
            </Button>
          </div>
          <div className="inline-actions">
            <Button onClick={connectTerminal} disabled={!canAttach || terminalBusy}>
              Connect terminal
            </Button>
            <Button variant="secondary" onClick={() => closeTerminal()} disabled={disabled}>
              Disconnect
            </Button>
          </div>
        </div>

        <div className="runtime-note">
          When no websocket clients remain connected, reconcile can stop running sessions after the idle timeout (default about 15 minutes).
        </div>

        <pre className="runtime-terminal">{terminalOutput}</pre>

        <div className="runtime-terminal-row">
          <Input
            value={terminalInput}
            disabled={disabled}
            placeholder="Type a command and press Enter"
            onChange={(event) => setTerminalInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                sendTerminalInput();
              }
            }}
          />
          <Button variant="secondary" onClick={sendTerminalInput} disabled={disabled}>
            Send
          </Button>
          <Button variant="secondary" onClick={() => setTerminalOutput("")} disabled={disabled}>
            Clear
          </Button>
        </div>

        {sshCommand ? (
          <div className="runtime-code">{sshCommand}</div>
        ) : null}

        {runtimeToken ? (
          <div className="runtime-code">Runtime attach URL: {sshAttachUrl || toSshAttachUrl(selectedSessionId, runtimeToken)}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}
