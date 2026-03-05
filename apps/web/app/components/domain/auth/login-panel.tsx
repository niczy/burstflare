"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../primitives/button.js";
import { Input } from "../../primitives/input.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../primitives/card.js";
import { clientApiJson } from "../../../lib/client/api.js";

type LoginPanelProps = {
  turnstileSiteKey?: string;
};

type TurnstileApi = {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      callback?: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    }
  ): string;
  reset(widgetId?: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

type EmailCodeRequestResponse = {
  ok: boolean;
  code?: string;
};

type EmailCodeVerifyResponse = {
  token?: string;
};

function normalizeError(error: unknown): string {
  if (error && typeof error === "object" && "error" in error) {
    return String((error as { error: unknown }).error || "Request failed");
  }
  return error instanceof Error ? error.message : "Request failed";
}

export function LoginPanel({ turnstileSiteKey = "" }: LoginPanelProps) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [requested, setRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState("Request a verification code, then enter it to complete sign-in.");
  const [error, setError] = useState("");

  const canRequest = useMemo(() => email.trim().length > 3, [email]);
  const canVerify = useMemo(() => requested && code.trim().length >= 4, [requested, code]);

  useEffect(() => {
    if (!turnstileSiteKey || !turnstileContainerRef.current || typeof window === "undefined") {
      return;
    }
    const timer = window.setInterval(() => {
      if (turnstileWidgetIdRef.current || !window.turnstile || !turnstileContainerRef.current) {
        return;
      }
      turnstileWidgetIdRef.current = window.turnstile.render(turnstileContainerRef.current, {
        sitekey: turnstileSiteKey,
        callback(token: string) {
          setTurnstileToken(token);
        },
        "expired-callback"() {
          setTurnstileToken("");
        },
        "error-callback"() {
          setTurnstileToken("");
        }
      });
    }, 100);
    return () => {
      window.clearInterval(timer);
      if (window.turnstile && turnstileWidgetIdRef.current) {
        window.turnstile.reset(turnstileWidgetIdRef.current);
      }
    };
  }, [turnstileSiteKey]);

  async function requestCode() {
    if (!canRequest || busy) {
      return;
    }
    setBusy(true);
    setError("");
    setStatus("Sending verification code...");
    try {
      const payload = await clientApiJson<EmailCodeRequestResponse>("/api/auth/email-code/request", {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({
          email: email.trim(),
          kind: "browser",
          ...(turnstileToken ? { turnstileToken } : {})
        })
      });
      setRequested(true);
      setStatus(payload.code ? `Code sent. (dev: ${payload.code})` : "Code sent. Check your inbox.");
    } catch (requestError) {
      setError(normalizeError(requestError));
      setStatus("Verification code request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    if (!canVerify || busy) {
      return;
    }
    setBusy(true);
    setError("");
    setStatus("Verifying code...");
    try {
      await clientApiJson<EmailCodeVerifyResponse>("/api/auth/email-code/verify", {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({
          email: email.trim(),
          code: code.trim()
        })
      });
      setStatus("Sign-in complete. Redirecting...");
      window.location.href = "/dashboard";
    } catch (verifyError) {
      setError(normalizeError(verifyError));
      setStatus("Verification failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel-stack">
      <Card>
        <CardHeader>
          <CardTitle className="section-title">Sign in with email</CardTitle>
          <CardDescription className="section-copy">
            Use your work email to receive a short-lived verification code.
          </CardDescription>
        </CardHeader>
        <CardContent className="panel-stack">
          <div className="field-stack">
            <label htmlFor="loginEmail">Work email</label>
            <Input
              id="loginEmail"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="field-stack">
            <label htmlFor="loginCode">Verification code</label>
            <Input
              id="loginCode"
              type="text"
              inputMode="numeric"
              placeholder="123456"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              disabled={!requested}
            />
          </div>

          <div className="status-box">
            {turnstileSiteKey
              ? "Turnstile verification is configured for this deployment."
              : "Turnstile is not configured for this deployment."}
          </div>
          {turnstileSiteKey ? <div ref={turnstileContainerRef} /> : null}

          <div className="inline-actions">
            <Button onClick={requestCode} disabled={!canRequest || busy}>
              Send Sign-In Code
            </Button>
            <Button variant="secondary" onClick={verifyCode} disabled={!canVerify || busy}>
              Verify Code
            </Button>
          </div>

          <div className="status-box">{status}</div>
          {error ? <div className="error-box">{error}</div> : null}
        </CardContent>
      </Card>
    </section>
  );
}
