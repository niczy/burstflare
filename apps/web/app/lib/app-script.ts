export function getAppScript(turnstileKey = ""): string {
  return `(function(){
    const TURNSTILE_KEY = ${JSON.stringify(turnstileKey)};
    const TOKEN_KEY = "burstflare_token";
    const REFRESH_KEY = "burstflare_refresh_token";

    function byId(id){ return document.getElementById(id); }
    function setText(id, value){ const node = byId(id); if (node) node.textContent = String(value || ""); }
    function setHtml(id, value){ const node = byId(id); if (node) node.innerHTML = String(value || ""); }
    function setValue(id, value){ const node = byId(id); if (node) node.value = String(value || ""); }
    function getValue(id){ const node = byId(id); return node && typeof node.value === "string" ? node.value.trim() : ""; }
    function setError(message){ setText("errors", message || ""); }
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
      if (!TURNSTILE_KEY || !window.turnstile || !byId("turnstileWidget")) return;
      window.turnstile.render("#turnstileWidget", {
        sitekey: TURNSTILE_KEY,
        callback: function(nextToken){
          const input = byId("turnstileToken");
          if (input) input.value = nextToken;
        }
      });
    }

    function renderInstances(instances){
      const root = byId("instances");
      if (!root) return;
      const items = Array.isArray(instances) ? instances : [];
      if (items.length === 0) {
        root.innerHTML = '<div class="muted">No instances yet.</div>';
      } else {
        root.innerHTML = items.map(function(instance){
          return '<div class="surface-note" style="margin-bottom:10px">' +
            '<strong>' + instance.name + '</strong><br />' +
            '<span class="muted">' + instance.image + '</span><br />' +
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
      if (!token()) {
        setText("identity", "Not signed in");
        setText("lastRefresh", "Last refresh: never");
        return null;
      }
      try {
        const data = await api("/api/auth/me");
        const label = data && data.user ? (data.user.name || data.user.email || "Signed in") : "Signed in";
        setText("identity", label);
        setText("lastRefresh", "Last refresh: " + new Date().toLocaleTimeString());
        if (data && data.workspace) {
          setValue("workspaceName", data.workspace.name || "");
        }
        return data;
      } catch (error) {
        if (error && error.status === 401) {
          clearSession();
          setText("identity", "Not signed in");
          setText("lastRefresh", "Last refresh: never");
          return null;
        }
        throw error;
      }
    }

    async function loadDashboard(){
      if (!byId("instances") && !byId("sessions")) return;
      if (!token()) {
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
      if (!token()) {
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

    async function handleAuth(action){
      const email = getValue("email");
      const name = getValue("name");
      const turnstileToken = getValue("turnstileToken");
      const recoveryCode = getValue("recoveryCode");
      if (action === "register") {
        storeSession(await api("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ email: email, name: name, turnstileToken: turnstileToken })
        }));
      } else if (action === "login") {
        storeSession(await api("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email: email, kind: "browser", turnstileToken: turnstileToken })
        }));
      } else if (action === "recover") {
        storeSession(await api("/api/auth/recover", {
          method: "POST",
          body: JSON.stringify({ email: email, code: recoveryCode, turnstileToken: turnstileToken })
        }));
      } else if (action === "logout") {
        await api("/api/auth/logout", {
          method: "POST",
          body: JSON.stringify({ refreshToken: refreshToken() })
        });
        clearSession();
      }
      await refreshAll();
    }

    async function createInstance(){
      const name = getValue("instanceName");
      const image = getValue("instanceImage");
      const description = getValue("instanceDescription");
      await api("/api/instances", {
        method: "POST",
        body: JSON.stringify({ name: name, image: image, description: description })
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
        if (target.id === "registerButton") return await handleAuth("register");
        if (target.id === "loginButton") return await handleAuth("login");
        if (target.id === "recoverButton") return await handleAuth("recover");
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
        renderTurnstile();
        refreshAll();
      });
    } else {
      renderTurnstile();
      refreshAll();
    }
  })();`;
}
