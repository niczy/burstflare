export function getAppScript(turnstileKey = ""): string {
  return `(function(){
    const TURNSTILE_KEY = ${JSON.stringify(turnstileKey)};
    const TOKEN_KEY = "burstflare_token";
    const REFRESH_KEY = "burstflare_refresh_token";
    const SEARCH = new URLSearchParams(window.location.search);
    let authState = null;
    const TURNSTILE_RENDER_STATE = {
      rendered: false,
      attempts: 0,
      timer: null
    };

    function byId(id){ return document.getElementById(id); }
    function setText(id, value){ const node = byId(id); if (node) node.textContent = String(value || ""); }
    function setHtml(id, value){ const node = byId(id); if (node) node.innerHTML = String(value || ""); }
    function setValue(id, value){ const node = byId(id); if (node) node.value = String(value || ""); }
    function getValue(id){ const node = byId(id); return node && typeof node.value === "string" ? node.value.trim() : ""; }
    function setError(message){ setText("errors", message || ""); }
    function setEmailCodeStatus(message){ setText("emailCodeStatus", message || ""); }
    function token(){ return localStorage.getItem(TOKEN_KEY) || ""; }
    function refreshToken(){ return localStorage.getItem(REFRESH_KEY) || ""; }
    function storeSession(data){
      if (data && data.token) localStorage.setItem(TOKEN_KEY, data.token);
      if (data && data.refreshToken) localStorage.setItem(REFRESH_KEY, data.refreshToken);
    }
    function clearSession(){
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_KEY);
    }
    function setNavState(auth){
      const session = byId("navSessionState");
      const cta = byId("navPrimaryCta");
      const profile = byId("navProfileLink");
      if (session) {
        session.textContent = auth && auth.user
          ? (auth.user.name || auth.user.email || "Signed in")
          : "Guest mode";
      }
      if (cta) {
        cta.textContent = auth ? "Open app" : "Sign in";
        cta.href = auth ? "/dashboard" : "/login";
      }
      if (profile) {
        profile.href = auth ? "/profile" : "/login";
      }
    }
    function pretty(id, data){
      const node = byId(id);
      if (!node) return;
      node.textContent = JSON.stringify(data, null, 2);
    }

    async function api(path, options){
      const init = options || {};
      const headers = new Headers(init.headers || {});
      const hasBody = init.body !== undefined && init.body !== null;
      if (hasBody && !headers.has("content-type") && typeof init.body === "string") {
        headers.set("content-type", "application/json; charset=utf-8");
      }
      if (token()) {
        headers.set("authorization", "Bearer " + token());
      }
      const response = await fetch(path, {
        ...init,
        headers,
        credentials: "same-origin"
      });
      const contentType = response.headers.get("content-type") || "";
      const payload = contentType.includes("application/json")
        ? await response.json().catch(function(){ return {}; })
        : await response.text().catch(function(){ return ""; });
      if (!response.ok) {
        const message = payload && payload.error ? payload.error : (typeof payload === "string" ? payload : response.statusText);
        const error = new Error(message || "Request failed");
        error.status = response.status;
        throw error;
      }
      return payload;
    }

    function renderTurnstile(){
      if (!TURNSTILE_KEY || TURNSTILE_RENDER_STATE.rendered || !byId("turnstileWidget")) return;
      if (!window.turnstile || typeof window.turnstile.render !== "function") {
        TURNSTILE_RENDER_STATE.attempts += 1;
        if (TURNSTILE_RENDER_STATE.attempts <= 40 && !TURNSTILE_RENDER_STATE.timer) {
          TURNSTILE_RENDER_STATE.timer = setTimeout(function(){
            TURNSTILE_RENDER_STATE.timer = null;
            renderTurnstile();
          }, TURNSTILE_RENDER_STATE.attempts < 5 ? 100 : 250);
        }
        return;
      }
      TURNSTILE_RENDER_STATE.attempts = 0;
      window.turnstile.render("#turnstileWidget", {
        sitekey: TURNSTILE_KEY,
        callback: function(nextToken){
          const input = byId("turnstileToken");
          if (input) input.value = nextToken;
        }
      });
      TURNSTILE_RENDER_STATE.rendered = true;
    }

    function getCliLoginState(){
      const deviceCode = SEARCH.get("device_code") || "";
      const redirectUrl = SEARCH.get("cli_redirect") || "";
      if (!deviceCode) {
        return null;
      }
      return {
        deviceCode: deviceCode,
        redirectUrl: redirectUrl
      };
    }

    function isCliLoginFlow(){
      return Boolean(getCliLoginState());
    }

    function redirectTargetForSignedInState(){
      const path = window.location.pathname || "/";
      if (path === "/") {
        return "/dashboard";
      }
      if (path === "/login" && !isCliLoginFlow()) {
        return "/dashboard";
      }
      return "";
    }

    function renderInstances(instances){
      const root = byId("instances");
      if (!root) return;
      const items = Array.isArray(instances) ? instances : [];
      if (items.length === 0) {
        root.innerHTML = '<div class="muted">No instances yet.</div>';
      } else {
        root.innerHTML = items.map(function(instance){
          const baseImage = instance.baseImage || instance.image || "";
          return '<div class="surface-note" style="margin-bottom:10px">' +
            '<strong>' + instance.name + '</strong><br />' +
            '<span class="muted">' + baseImage + '</span><br />' +
            '<span class="muted">common state: ' + (instance.commonStateBytes || 0) + ' bytes</span><br />' +
            '<div class="row" style="margin-top:8px">' +
              '<button class="secondary" data-action="instance-push" data-instance-id="' + instance.id + '">Push</button>' +
              '<button class="secondary" data-action="instance-pull" data-instance-id="' + instance.id + '">Pull</button>' +
              '<button class="secondary" data-action="instance-delete" data-instance-id="' + instance.id + '">Delete</button>' +
            '</div>' +
          '</div>';
        }).join("");
      }

      ["sessionInstance", "commonStateInstance"].forEach(function(id){
        const select = byId(id);
        if (!select) return;
        const current = select.value;
        select.innerHTML = items.map(function(instance){
          const selected = current === instance.id ? ' selected' : '';
          return '<option value="' + instance.id + '"' + selected + '>' + instance.name + '</option>';
        }).join("");
      });
    }

    function renderSessions(sessions){
      const root = byId("sessions");
      if (!root) return;
      const items = Array.isArray(sessions) ? sessions : [];
      if (items.length === 0) {
        root.innerHTML = '<div class="muted">No sessions yet.</div>';
        return;
      }
      root.innerHTML = items.map(function(session){
        const action = session.state === "running" ? "stop" : "start";
        const label = session.state === "running" ? "Stop" : "Start";
        return '<div class="surface-note" style="margin-bottom:10px">' +
          '<strong>' + session.name + '</strong><br />' +
          '<span class="muted">' + (session.instanceName || session.instanceId || "No instance") + ' · ' + session.state + '</span><br />' +
          '<span class="muted">latest snapshot: ' + (session.latestSnapshotBytes || 0) + ' bytes</span><br />' +
          '<div class="row" style="margin-top:8px">' +
            '<button class="secondary" data-action="session-' + action + '" data-session-id="' + session.id + '">' + label + '</button>' +
            '<button class="secondary" data-action="session-restart" data-session-id="' + session.id + '">Restart</button>' +
            '<button class="secondary" data-action="session-delete" data-session-id="' + session.id + '">Delete</button>' +
          '</div>' +
          '<div class="row" style="margin-top:8px">' +
            '<a class="secondary" style="text-decoration:none; display:inline-flex; align-items:center;" href="' + (session.previewUrl || "#") + '" target="_blank" rel="noreferrer">Preview</a>' +
            '<a class="secondary" style="text-decoration:none; display:inline-flex; align-items:center;" href="/api/sessions/' + session.id + '/editor" target="_blank" rel="noreferrer">Editor</a>' +
          '</div>' +
        '</div>';
      }).join("");
    }

    function renderAuthSessions(data){
      const root = byId("authSessions");
      if (!root) return;
      const items = data && Array.isArray(data.sessions) ? data.sessions : [];
      if (items.length === 0) {
        root.innerHTML = '<div class="muted">No active browser sessions.</div>';
        return;
      }
      root.innerHTML = items.map(function(entry){
        return '<div class="surface-note" style="margin-bottom:10px">' +
          '<strong>' + (entry.kind || "browser") + '</strong><br />' +
          '<span class="muted">' + (entry.createdAt || "unknown") + '</span><br />' +
          '<button class="secondary" style="margin-top:8px" data-action="auth-revoke" data-auth-session-id="' + entry.id + '">Revoke</button>' +
        '</div>';
      }).join("");
    }

    async function refreshAuth(){
      try {
        const data = await api("/api/auth/me");
        authState = data || null;
        setNavState(authState);
        const label = data && data.user ? (data.user.name || data.user.email || "Signed in") : "Signed in";
        setText("identity", label);
        setText("lastRefresh", "Last refresh: " + new Date().toLocaleTimeString());
        if (data && data.workspace) {
          setValue("workspaceName", data.workspace.name || "");
        }
        const redirectTarget = redirectTargetForSignedInState();
        if (redirectTarget) {
          window.location.replace(redirectTarget);
        }
        return data;
      } catch (error) {
        if (error && error.status === 401) {
          authState = null;
          clearSession();
          setNavState(null);
          setText("identity", "Not signed in");
          setText("lastRefresh", "Last refresh: never");
          return null;
        }
        throw error;
      }
    }

    async function loadDashboard(){
      if (!byId("instances") && !byId("sessions")) return;
      if (!authState) {
        renderInstances([]);
        renderSessions([]);
        pretty("usage", {});
        pretty("report", {});
        pretty("audit", []);
        return;
      }
      const instances = await api("/api/instances");
      const sessions = await api("/api/sessions");
      renderInstances(instances.instances || []);
      renderSessions(sessions.sessions || []);
      pretty("usage", await api("/api/usage"));
      pretty("report", await api("/api/admin/report"));
      pretty("audit", await api("/api/admin/audit"));
    }

    async function loadProfile(){
      if (!byId("authSessions") && !byId("billingSummary")) return;
      if (!authState) {
        renderAuthSessions({ sessions: [] });
        pretty("billingSummary", {});
        return;
      }
      renderAuthSessions(await api("/api/auth/sessions"));
      pretty("billingSummary", await api("/api/workspaces/current/billing"));
    }

    async function refreshAll(){
      setError("");
      try {
        await refreshAuth();
        await loadDashboard();
        await loadProfile();
      } catch (error) {
        setError(error.message || String(error));
      }
    }

    async function sendSignInCode(){
      const email = getValue("email");
      const turnstileToken = getValue("turnstileToken");
      const requested = await api("/api/auth/email-code/request", {
        method: "POST",
        body: JSON.stringify({
          email: email,
          kind: "browser",
          turnstileToken: turnstileToken
        })
      });
      setValue("emailCode", requested.code || "");
      setEmailCodeStatus(
        requested.code
          ? "Verification code created. Managed smoke mailboxes expose it inline here."
          : "Verification code sent. Check your email and paste the six-digit code here."
      );
      return requested;
    }

    async function attemptCliRedirect(redirectUrl, deviceCode){
      if (!redirectUrl || !deviceCode) {
        return false;
      }
      let target;
      try {
        target = new URL(redirectUrl);
      } catch (_error) {
        return false;
      }
      if (target.hostname !== "127.0.0.1" && target.hostname !== "localhost") {
        return false;
      }
      target.searchParams.set("device_code", deviceCode);
      try {
        await Promise.race([
          fetch(target.toString(), {
            method: "GET",
            mode: "no-cors",
            cache: "no-store"
          }),
          new Promise(function(_resolve, reject){
            setTimeout(function(){ reject(new Error("timeout")); }, 1500);
          })
        ]);
        window.location.replace(target.toString());
        return true;
      } catch (_error) {
        return false;
      }
    }

    async function completeCliDeviceApproval(){
      const state = getCliLoginState();
      if (!state || !token()) {
        return false;
      }
      await api("/api/cli/device/approve", {
        method: "POST",
        body: JSON.stringify({
          deviceCode: state.deviceCode
        })
      });
      const redirected = await attemptCliRedirect(state.redirectUrl, state.deviceCode);
      setEmailCodeStatus(
        redirected
          ? "Browser sign-in complete. Your local CLI should finish automatically."
          : "Browser sign-in complete. If the CLI is waiting on another machine, paste this code there: " + state.deviceCode
      );
      return true;
    }

    async function verifyEmailCode(){
      const email = getValue("email");
      const code = getValue("emailCode");
      const login = await api("/api/auth/email-code/verify", {
        method: "POST",
        body: JSON.stringify({
          email: email,
          code: code
        })
      });
      storeSession(login);
      await completeCliDeviceApproval();
      await refreshAll();
      return login;
    }

    async function handleAuth(action){
      if (action === "login") {
        await sendSignInCode();
        return;
      } else if (action === "verify-email-code") {
        await verifyEmailCode();
        return;
      } else if (action === "logout") {
        await api("/api/auth/logout", {
          method: "POST",
          body: JSON.stringify({ refreshToken: refreshToken() })
        });
        authState = null;
        clearSession();
        setNavState(null);
      }
      await refreshAll();
    }

    async function createInstance(){
      const name = getValue("instanceName");
      const image = getValue("instanceImage");
      const description = getValue("instanceDescription");
      await api("/api/instances", {
        method: "POST",
        body: JSON.stringify({ name: name, baseImage: image, description: description })
      });
      setValue("instanceName", "");
      await loadDashboard();
    }

    async function createSession(){
      const name = getValue("sessionName");
      const instanceId = getValue("sessionInstance");
      const created = await api("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ name: name, instanceId: instanceId })
      });
      await api("/api/sessions/" + created.session.id + "/start", { method: "POST" });
      setValue("sessionName", "");
      await loadDashboard();
    }

    async function saveWorkspace(){
      await api("/api/workspaces/current/settings", {
        method: "PATCH",
        body: JSON.stringify({ name: getValue("workspaceName") })
      });
      await refreshAll();
    }

    async function upgradePlan(){
      await api("/api/workspaces/current/plan", {
        method: "POST",
        body: JSON.stringify({ plan: "pro" })
      });
      await refreshAll();
    }

    document.addEventListener("click", async function(event){
      const target = event.target instanceof Element ? event.target.closest("button,[data-action]") : null;
      if (!target) return;
      try {
        if (target.id === "loginButton") return await handleAuth("login");
        if (target.id === "verifyEmailCodeButton") return await handleAuth("verify-email-code");
        if (target.id === "logoutButton") return await handleAuth("logout");
        if (target.id === "refreshButton" || target.id === "refreshProfileButton") return await refreshAll();
        if (target.id === "createInstanceButton") return await createInstance();
        if (target.id === "createSessionButton") return await createSession();
        if (target.id === "pushCommonStateButton") return await api("/api/instances/" + getValue("commonStateInstance") + "/push", { method: "POST" }).then(refreshAll);
        if (target.id === "pullCommonStateButton") return await api("/api/instances/" + getValue("commonStateInstance") + "/pull", { method: "POST" }).then(refreshAll);
        if (target.id === "saveWorkspaceButton") return await saveWorkspace();
        if (target.id === "planButton") return await upgradePlan();
        if (target.id === "authSessionsButton") return await loadProfile();
        if (target.id === "logoutAllButton") {
          await api("/api/auth/logout-all", { method: "POST" });
          clearSession();
          return await refreshAll();
        }

        const action = target.getAttribute("data-action") || "";
        const instanceId = target.getAttribute("data-instance-id") || "";
        const sessionId = target.getAttribute("data-session-id") || "";
        const authSessionId = target.getAttribute("data-auth-session-id") || "";
        if (action === "instance-push") return await api("/api/instances/" + instanceId + "/push", { method: "POST" }).then(refreshAll);
        if (action === "instance-pull") return await api("/api/instances/" + instanceId + "/pull", { method: "POST" }).then(refreshAll);
        if (action === "instance-delete") return await api("/api/instances/" + instanceId, { method: "DELETE" }).then(refreshAll);
        if (action === "session-start") return await api("/api/sessions/" + sessionId + "/start", { method: "POST" }).then(refreshAll);
        if (action === "session-stop") return await api("/api/sessions/" + sessionId + "/stop", { method: "POST" }).then(refreshAll);
        if (action === "session-restart") return await api("/api/sessions/" + sessionId + "/restart", { method: "POST" }).then(refreshAll);
        if (action === "session-delete") return await api("/api/sessions/" + sessionId, { method: "DELETE" }).then(refreshAll);
        if (action === "auth-revoke") return await api("/api/auth/sessions/" + authSessionId, { method: "DELETE" }).then(loadProfile);
      } catch (error) {
        setError(error.message || String(error));
      }
    });

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function(){
        if (SEARCH.get("email")) {
          setValue("email", SEARCH.get("email") || "");
        }
        if (getCliLoginState()) {
          setEmailCodeStatus("Complete browser sign-in, then this page will finish the pending CLI login.");
        }
        setNavState(null);
        renderTurnstile();
        refreshAll();
        window.addEventListener("storage", function(event){
          if (!event || !event.key || event.key === TOKEN_KEY || event.key === REFRESH_KEY) {
            refreshAll();
          }
        });
        window.addEventListener("focus", function(){
          refreshAll();
        });
      });
    } else {
      if (SEARCH.get("email")) {
        setValue("email", SEARCH.get("email") || "");
      }
      if (getCliLoginState()) {
        setEmailCodeStatus("Complete browser sign-in, then this page will finish the pending CLI login.");
      }
      setNavState(null);
      renderTurnstile();
      refreshAll();
      window.addEventListener("storage", function(event){
        if (!event || !event.key || event.key === TOKEN_KEY || event.key === REFRESH_KEY) {
          refreshAll();
        }
      });
      window.addEventListener("focus", function(){
        refreshAll();
      });
    }
  })();`;
}
