"use strict";

(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const state = {
    user: null,
    csrf: "",
    history: [],
    datasetId: null,
    datasetFilename: "",
    datasetSummary: null,
    datasetPreview: [],
    generatorFile: null,
    charts: {},
    dashboardData: null,
    authMode: "login",
    toastTimer: null,
    sending: false,
    uploading: false,
  };

  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[ch]);

  const number = (value) =>
    Number(value || 0).toLocaleString(undefined, {
      maximumFractionDigits: 2
    });

  function toast(message, error = false) {
    const el = $("#toast");
    if (!el) return;

    clearTimeout(state.toastTimer);
    el.textContent = message;
    el.classList.toggle("error", error);
    el.classList.add("show");

    state.toastTimer = setTimeout(
      () => el.classList.remove("show"),
      3500
    );
  }

  // --------------------------------------------------
  // API REQUESTS
  // --------------------------------------------------

  async function api(url, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    const headers = new Headers(options.headers || {});
    let body = options.body;

    if (
      body &&
      !(body instanceof FormData) &&
      typeof body === "object"
    ) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(body);
    }

    if (
      method === "POST" &&
      !["/api/login", "/api/register"].includes(url) &&
      state.user
    ) {
      if (!state.csrf) {
        try {
          const csrfResponse = await fetch("/api/csrf", {
            credentials: "same-origin",
            cache: "no-store"
          });

          if (csrfResponse.ok) {
            const csrfData = await csrfResponse.json();
            state.csrf = csrfData.csrf || "";
          }
        } catch (error) {
          console.warn("Could not refresh CSRF token:", error);
        }
      }

      if (state.csrf) {
        headers.set("X-CSRF-Token", state.csrf);
      }
    }

    const { timeout = 60000, ...fetchOptions } = options;
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      timeout
    );

    let response;

    try {
      response = await fetch(url, {
        ...fetchOptions,
        method,
        headers,
        body,
        credentials: "same-origin",
        cache: "no-store",
        signal: fetchOptions.signal || controller.signal
      });
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new Error(
          "The request timed out. Please try again. " +
          "If this keeps happening, check the Flask terminal " +
          "for the Gemini error."
        );
      }

      throw new Error(
        "Could not reach the server. Check that Flask is running and try again."
      );
    } finally {
      clearTimeout(timeoutId);
    }

    let data = {};
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      try {
        data = await response.json();
      } catch {
        throw new Error("The server returned invalid JSON.");
      }
    } else {
      if (
        response.redirected ||
        response.url.includes("/login")
      ) {
        state.user = null;
        state.csrf = "";
        showAuth();

        throw new Error(
          "Your session has expired. Please sign in again."
        );
      }

      throw new Error(
        "Unexpected server response. Check the Flask terminal."
      );
    }

    if (!response.ok) {
      if (response.status === 401 && state.user) {
        state.user = null;
        state.csrf = "";
        showAuth();
      }

      throw new Error(
        data.error || `Request failed (${response.status}).`
      );
    }

    return data;
  }

  // --------------------------------------------------
  // AUTHENTICATION
  // --------------------------------------------------

  function showAuth() {
    $("#authScreen")?.classList.remove("hidden");
    $("#appShell")?.classList.add("hidden");
  }

  function showApp(user) {
    state.user = user;

    $("#authScreen")?.classList.add("hidden");
    $("#appShell")?.classList.remove("hidden");

    const name = user?.name || "Workspace member";

    if ($("#profileName")) {
      $("#profileName").textContent = name;
    }

    if ($("#profileEmail")) {
      $("#profileEmail").textContent = user?.email || "";
    }

    if ($("#avatar")) {
      $("#avatar").textContent =
        name.trim().charAt(0).toUpperCase() || "N";
    }

    if ($("#welcomeName")) {
      $("#welcomeName").textContent =
        name.split(/\s+/)[0] || "there";
    }

    loadHistory().catch(() => {});
    navigate("overview");
  }

  function setAuthMode(mode) {
    state.authMode = mode;

    const register = mode === "register";

    $("#authTitle").textContent = register
      ? "Create your workspace."
      : "Welcome back.";

    $("#authSubtitle").textContent = register
      ? "Set up your private Nexora AI account."
      : "Sign in to continue to your workspace.";

    $("#nameField").classList.toggle("hidden", !register);
    $("#authName").required = register;

    $("#authPassword").autocomplete = register
      ? "new-password"
      : "current-password";

    $("#authSubmit").innerHTML = register
      ? 'Create account <span>→</span>'
      : 'Sign in <span>→</span>';

    $("#authSwitchText").textContent = register
      ? "Already have an account?"
      : "New to Nexora?";

    $("#authSwitch").textContent = register
      ? "Sign in"
      : "Create account";

    $("#authError").textContent = "";
  }

  async function handleAuth(event) {
    event.preventDefault();

    const register = state.authMode === "register";
    const email = $("#authEmail").value.trim();
    const password = $("#authPassword").value;
    const name = $("#authName").value.trim();

    $("#authError").textContent = "";

    if (register && !name) {
      $("#authError").textContent = "Please enter your name.";
      return;
    }

    if (password.length < 12) {
      $("#authError").textContent =
        "Use a password of at least 12 characters.";
      return;
    }

    const button = $("#authSubmit");
    button.disabled = true;

    try {
      button.textContent = register
        ? "Creating account…"
        : "Signing in…";

      const result = await api(
        register ? "/api/register" : "/api/login",
        {
          method: "POST",
          body: register
            ? { name, email, password }
            : { email, password }
        }
      );

      state.csrf = result.csrf || "";
      showApp(result.user);

      toast(
        register
          ? "Your workspace is ready."
          : "Welcome back."
      );
    } catch (error) {
      $("#authError").textContent = error.message;
    } finally {
      button.disabled = false;
      setAuthMode(state.authMode);
    }
  }

  async function logout() {
    try {
      await api("/api/logout", {
        method: "POST",
        body: {}
      });
    } catch (error) {
      toast(error.message, true);
      return;
    }

    state.user = null;
    state.csrf = "";
    state.history = [];
    state.datasetId = null;
    state.datasetSummary = null;
    state.datasetPreview = [];
    state.datasetFilename = "";
    state.generatorFile = null;

    resetDashboard();
    showAuth();

    $("#authForm").reset();
    setAuthMode("login");

    toast("You have signed out.");
  }

  // --------------------------------------------------
  // NAVIGATION
  // --------------------------------------------------

  function navigate(view) {
    const validViews = [
      "overview",
      "generator",
      "decision",
      "copilot",
      "data",
      "history"
    ];

    if (!validViews.includes(view)) {
      view = "overview";
    }

    $$(".page-view").forEach((page) => {
      page.classList.toggle(
        "hidden",
        page.id !== `view-${view}`
      );
    });

    $$(".nav-item").forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.view === view
      );
    });

    const labels = {
      overview: "Overview",
      generator: "Dashboard Studio",
      decision: "Decision Intelligence",
      copilot: "AI Copilot",
      data: "Data Analysis",
      history: "Activity history"
    };

    if ($("#breadcrumbCurrent")) {
      $("#breadcrumbCurrent").textContent = labels[view];
    }

    closeSidebar();

    if (view === "history") {
      loadHistory().catch(
        (error) => toast(error.message, true)
      );
    }

    if (view === "data" && state.datasetSummary) {
      renderDataAnalysis(
        state.datasetFilename,
        state.datasetSummary,
        state.datasetPreview
      );
    }

    if (view === "generator") {
      requestAnimationFrame(resizeCharts);
    }
  }

  function closeSidebar() {
    $("#sidebar")?.classList.remove("open");
    $("#sidebarBackdrop")?.classList.remove("show");
  }

  function openSidebar() {
    $("#sidebar")?.classList.add("open");
    $("#sidebarBackdrop")?.classList.add("show");
  }

  // --------------------------------------------------
  // ACTIVITY HISTORY
  // --------------------------------------------------

  async function loadHistory() {
    const result = await api("/api/history");

    state.history = Array.isArray(result.items)
      ? result.items
      : [];

    renderHistory();
    renderRecentActivity();

    const datasets = state.history.filter(
      (item) => item.kind === "dataset"
    );

    const chats = state.history.filter(
      (item) => item.kind === "chat"
    );

    if ($("#statDatasets")) {
      $("#statDatasets").textContent = number(datasets.length);
    }

    if ($("#statChats")) {
      $("#statChats").textContent = number(chats.length);
    }

    if ($("#statActivity")) {
      $("#statActivity").textContent = number(state.history.length);
    }

    if ($("#historyCount")) {
      $("#historyCount").textContent =
        `${state.history.length} EVENTS`;
    }
  }

  function formatDate(value) {
    if (!value) return "Date unavailable";

    const normalized = value.includes("T")
      ? value
      : value.replace(" ", "T") + "Z";

    const date = new Date(normalized);

    if (Number.isNaN(date.getTime())) return value;

    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function renderRecentActivity() {
    const root = $("#recentActivity");
    if (!root) return;

    const items = state.history.slice(0, 5);

    if (!items.length) {
      root.innerHTML = `
        <div class="empty-state compact">
          <span>◷</span>
          <strong>Your story starts here.</strong>
          <p>Upload data or start a conversation to see activity.</p>
        </div>`;
      return;
    }

    root.innerHTML = items.map((item) => `
      <div class="activity-item">
        <span class="activity-dot">
          ${item.kind === "chat" ? "✳" : "▤"}
        </span>
        <div class="activity-copy">
          <strong>${esc(item.title || "Workspace activity")}</strong>
          <small>
            ${esc(item.kind || "Activity")} ·
            ${esc(formatDate(item.created_at))}
          </small>
        </div>
      </div>
    `).join("");
  }

  function renderHistory() {
    const root = $("#historyList");

    const datasets = state.history.filter(
      (item) => item.kind === "dataset"
    );

    if (!root) return;

    if (!state.history.length) {
      root.innerHTML = `
        <div class="empty-state">
          <span>◷</span>
          <h3>Nothing here just yet.</h3>
          <p>Your datasets and Copilot conversations will appear here.</p>
        </div>`;
    } else {
      root.innerHTML = state.history.map((item) => {
        const content = item.content || {};
        const datasetId = content.dataset_id || "";
        const isDataset = item.kind === "dataset";

        return `
          <div class="history-item">
            <span class="activity-dot">
              ${isDataset ? "▤" : "✳"}
            </span>
            <div class="activity-copy">
              <strong>${esc(item.title || "Workspace activity")}</strong>
              <small>${esc(formatDate(item.created_at))}</small>
              <span class="history-kind">
                ${esc(item.kind || "activity")}
              </span>
            </div>
            ${
              isDataset && datasetId
                ? `<button class="btn btn-quiet history-action"
                    data-open-dataset="${esc(datasetId)}"
                    data-filename="${esc(item.title || "Dataset")}">
                    Open data →
                   </button>`
                : `<button class="btn btn-quiet history-action"
                    data-history-chat="${esc(item.id)}">
                    Review ↗
                   </button>`
            }
          </div>`;
      }).join("");
    }

    const datasetRoot = $("#datasetHistory");
    if (!datasetRoot) return;

    if (!datasets.length) {
      datasetRoot.innerHTML =
        '<p class="muted">Upload a dataset to get started.</p>';
      return;
    }

    datasetRoot.innerHTML = datasets.map((item) => {
      const id = item.content?.dataset_id || "";

      return `
        <div class="dataset-entry">
          <span class="action-icon teal-bg">▤</span>
          <div>
            <strong>${esc(item.title)}</strong>
            <small>${esc(formatDate(item.created_at))}</small>
          </div>
          ${
            id
              ? `<button class="btn btn-quiet"
                   data-open-dataset="${esc(id)}"
                   data-filename="${esc(item.title)}">
                   Open →
                 </button>`
              : ""
          }
        </div>`;
    }).join("");
  }

  // --------------------------------------------------
  // DATASET LOADING AND ANALYSIS
  // --------------------------------------------------

  async function openDataset(datasetId, filename = "Dataset") {
    try {
      const result = await api(
        `/api/datasets/${encodeURIComponent(datasetId)}`
      );

      state.datasetId = result.dataset_id;
      state.datasetFilename = result.filename || filename;
      state.datasetSummary = result.summary;
      state.datasetPreview = result.preview || [];

      renderDataAnalysis(
        state.datasetFilename,
        state.datasetSummary,
        state.datasetPreview
      );

      navigate("data");
      toast("Dataset loaded.");
    } catch (error) {
      toast(error.message, true);
    }
  }

  function renderDataAnalysis(filename, summary, preview) {
    if (!summary) return;
    const results = $("#datasetResults");
    results?.classList.remove("hidden");
    if ($("#datasetTitle")) $("#datasetTitle").textContent = filename || "Dataset audit report";
    if ($("#dataRows")) $("#dataRows").textContent = number(summary.rows);
    if ($("#dataMissing")) $("#dataMissing").textContent = `${number(summary.missing_percent)}%`;
    if ($("#dataDuplicates")) $("#dataDuplicates").textContent = number(summary.duplicate_rows);
    if ($("#dataHealthScore")) {
      const health = Math.max(0, Math.min(100, 100 - Number(summary.missing_percent || 0) - (Number(summary.rows) ? Number(summary.duplicate_rows || 0) / Number(summary.rows) * 100 : 0)));
      $("#dataHealthScore").textContent = `${health.toFixed(0)}/100`;
    }
    const categorySummary = summary.category_summary || {};
    const missingRoot = $("#missingValuesBreakdown");
    if (missingRoot) {
      const missingByColumn = summary.missing_by_column || {};
      const entries = Object.entries(missingByColumn).filter(([, value]) => Number(value) > 0).sort((a,b) => b[1]-a[1]);
      missingRoot.innerHTML = entries.length ? entries.slice(0,10).map(([name,value]) => `<div class="insight-row"><span class="insight-check">!</span><p><strong>${esc(name)}</strong> · ${number(value)} missing cells</p></div>`).join("") : '<p class="muted">No missing values were detected.</p>';
    }
    const suggestions = $("#chartSuggestionsList");
    if (suggestions) {
      const numeric = Object.keys(summary.numeric_summary || {});
      const categorical = Object.keys(categorySummary);
      const items = [];
      if (numeric.length) items.push(`Use histograms or box plots to inspect numeric fields: ${numeric.slice(0,4).join(", ")}.`);
      if (categorical.length) items.push(`Use bar charts to compare categories such as ${categorical.slice(0,4).join(", ")}.`);
      if (numeric.length >= 2) items.push("Consider a scatter plot to investigate relationships between numeric variables; correlation does not prove causation.");
      suggestions.innerHTML = items.length ? items.map(v => `<div class="insight-row"><span class="insight-check">▦</span><p>${esc(v)}</p></div>`).join("") : '<p class="muted">Upload a dataset with usable columns to receive chart suggestions.</p>';
    }
    const roadmap = $("#recoveryRoadmapList");
    if (roadmap) {
      const items = [];
      if (Number(summary.missing_cells || 0)) items.push("Review why values are missing before deciding whether to fill, exclude, or retain them.");
      if (Number(summary.duplicate_rows || 0)) items.push("Inspect duplicate rows and confirm whether they are valid repeated records before removing them.");
      items.push("Validate column names, data types, units, and unusual values against the source system.");
      roadmap.innerHTML = items.map(v => `<div class="insight-row"><span class="insight-check">✓</span><p>${esc(v)}</p></div>`).join("");
    }
    const recs = $("#recommendationsList");
    if (recs) {
      const items = summary.insights || [];
      recs.innerHTML = items.length ? items.map(v => `<div class="insight-row"><span class="insight-check">✳</span><p>${esc(v)}</p></div>`).join("") : '<p class="muted">No additional recommendations available.</p>';
    }
    // Keep the dataset preview available to dashboard and Copilot flows.
    state.datasetSummary = summary;
    state.datasetPreview = Array.isArray(preview) ? preview : [];
  }

  function renderInsights(root, insights) {
    if (!root) return;

    root.innerHTML = insights.length
      ? insights.map((insight) => `
          <div class="insight-row">
            <span class="insight-check">✓</span>
            <p>${esc(insight)}</p>
          </div>
        `).join("")
      : '<p class="muted">No observations available.</p>';
  }

  function renderTable(table, rows) {
    if (!table) return;

    const thead = table.querySelector("thead");
    const tbody = table.querySelector("tbody");

    if (!rows || !rows.length) {
      thead.innerHTML = "";
      tbody.innerHTML = `
        <tr><td>No preview rows available.</td></tr>`;
      return;
    }

    const columns = [
      ...new Set(rows.flatMap((row) => Object.keys(row)))
    ];

    thead.innerHTML = `
      <tr>
        ${columns.map((column) => `<th>${esc(column)}</th>`).join("")}
      </tr>`;

    tbody.innerHTML = rows.map((row) => `
      <tr>
        ${columns.map((column) => {
          const value = row[column];
          const display = value == null ? "—" : String(value);

          return `
            <td title="${esc(display)}">${esc(display)}</td>`;
        }).join("")}
      </tr>
    `).join("");
  }

  // --------------------------------------------------
  // FILE UPLOAD
  // --------------------------------------------------

  function validateFile(file) {
    if (!file) {
      throw new Error("Choose a CSV or Excel file first.");
    }

    const ext = file.name.split(".").pop().toLowerCase();

    if (!["csv", "xlsx"].includes(ext)) {
      throw new Error("Only CSV and XLSX files are supported.");
    }

    if (file.size > 25 * 1024 * 1024) {
      throw new Error("The file exceeds the 25 MB upload limit.");
    }

    return file;
  }

  function attachDropZone(zone, input, onFile) {
    if (!zone || !input) return;

    ["dragenter", "dragover"].forEach((eventName) => {
      zone.addEventListener(eventName, (event) => {
        event.preventDefault();
        zone.classList.add("drag-over");
      });
    });

    ["dragleave", "drop"].forEach((eventName) => {
      zone.addEventListener(eventName, (event) => {
        event.preventDefault();
        zone.classList.remove("drag-over");
      });
    });

    zone.addEventListener("drop", (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;

      try {
        validateFile(file);
        onFile(file);
      } catch (error) {
        toast(error.message, true);
      }
    });

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;

      try {
        validateFile(file);
        onFile(file);
      } catch (error) {
        input.value = "";
        toast(error.message, true);
      }
    });
  }

  async function uploadDataset(file) {
    validateFile(file);

    if (state.uploading) return null;

    state.uploading = true;

    const button = $("#uploadBtn");

    if (button) {
      button.disabled = true;
      button.textContent = "Analyzing…";
    }

    if ($("#upload-status")) {
      $("#upload-status").textContent =
        "Reading your dataset and calculating statistics…";
    }

    try {
      const formData = new FormData();
      formData.append("file", file);

      const result = await api("/api/upload", {
        method: "POST",
        body: formData,
        timeout: 60000
      });

      if (!result?.dataset_id) {
        throw new Error(
          result?.error || "The server did not return a dataset ID."
        );
      }

      state.datasetId = result.dataset_id;
      state.datasetFilename = result.filename || file.name;
      state.datasetSummary = result.summary;
      state.datasetPreview = result.preview || [];

      renderDataAnalysis(
        state.datasetFilename,
        state.datasetSummary,
        state.datasetPreview
      );

      if ($("#upload-status")) {
        $("#upload-status").textContent =
          "Dataset uploaded successfully.";
      }

      toast("Dataset uploaded successfully.");

      loadHistory().catch((error) => {
        console.warn("History refresh failed:", error.message);
      });

      return result;
    } catch (error) {
      if ($("#upload-status")) {
        $("#upload-status").textContent = error.message;
      }

      toast(error.message, true);
      return null;
    } finally {
      state.uploading = false;

      if (button) {
        button.disabled = false;
        button.textContent = "Analyze dataset →";
      }
    }
  }

  function updateFileLabels(file) {
    if ($("#selectedFile")) {
      $("#selectedFile").textContent = file
        ? file.name
        : "Drop a dataset here or browse";
    }

    if ($("#generatorFileName")) {
      $("#generatorFileName").textContent = file
        ? file.name
        : "Drop your file here";
    }
  }

  // --------------------------------------------------
  // DASHBOARD LAYOUT AND CHARTS
  // --------------------------------------------------

  function destroyCharts() {
    Object.values(state.charts).forEach((chart) => {
      try {
        chart.destroy();
      } catch {
        // Chart already disposed.
      }
    });

    state.charts = {};
  }

  function resetDashboard() {
    destroyCharts();

    state.dashboardData = null;

    $("#dashboardOutput")?.classList.add("hidden");
    $("#dashboardEmpty")?.classList.remove("hidden");

    if ($("#generateReportBtn")) {
      $("#generateReportBtn").disabled = true;
    }
  }

  function niceColor(index) {
    const palette = [
      "#62e6c2",
      "#8bb9ff",
      "#c2a2ff",
      "#f6c979",
      "#ff9292",
      "#69c8dd",
      "#ed9bc7",
      "#a8d77d"
    ];

    return palette[index % palette.length];
  }

  function chartTheme() {
    const light = document.body.classList.contains("light-theme");

    return {
      text: light ? "#687985" : "#8d9eac",
      grid: light ? "#e7edef" : "#24313d"
    };
  }

  function prepareDashboardLayout() {
    const output = $("#dashboardOutput");
    const kpis = $("#dashboardKpis");
    const charts = $("#charts-grid");

    if (output) {
      output.style.width = "100%";
      output.style.minWidth = "0";
      output.style.boxSizing = "border-box";
    }

    if (kpis) {
      kpis.style.display = "grid";
      kpis.style.gridTemplateColumns =
        "repeat(auto-fit, minmax(min(100%, 190px), 1fr))";
      kpis.style.gap = "16px";
      kpis.style.width = "100%";
      kpis.style.minWidth = "0";
      kpis.style.alignItems = "stretch";
      kpis.style.marginBottom = "24px";
    }

    if (charts) {
      charts.style.display = "grid";
      charts.style.gridTemplateColumns =
        "repeat(auto-fit, minmax(min(100%, 340px), 1fr))";
      charts.style.gap = "20px";
      charts.style.width = "100%";
      charts.style.minWidth = "0";
      charts.style.alignItems = "stretch";
      charts.style.gridAutoFlow = "row";
    }
  }

  function makeChart(id, config) {
    const canvas = document.getElementById(id);

    if (!canvas || typeof Chart === "undefined") {
      return null;
    }

    if (state.charts[id]) {
      state.charts[id].destroy();
      delete state.charts[id];
    }

    const theme = chartTheme();

    config.options = config.options || {};
    config.options.responsive = true;
    config.options.maintainAspectRatio = false;

    config.options.animation = {
      duration: 350
    };

    config.options.plugins = {
      ...(config.options.plugins || {}),
      legend: {
        ...(config.options.plugins?.legend || {}),
        labels: {
          color: theme.text,
          boxWidth: 10,
          boxHeight: 10,
          padding: 14,
          font: {
            family: "DM Sans",
            size: 11
          }
        }
      },
      tooltip: {
        enabled: true,
        ...(config.options.plugins?.tooltip || {})
      }
    };

    if (!["doughnut", "pie"].includes(config.type)) {
      const suppliedScales = config.options.scales || {};

      config.options.scales = {
        x: {
          ticks: {
            color: theme.text,
            maxRotation: 35,
            minRotation: 0,
            autoSkip: true
          },
          grid: {
            display: false
          },
          ...(suppliedScales.x || {})
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: theme.text
          },
          grid: {
            color: theme.grid
          },
          ...(suppliedScales.y || {})
        },
        ...Object.fromEntries(
          Object.entries(suppliedScales).filter(
            ([key]) => !["x", "y"].includes(key)
          )
        )
      };
    } else {
      delete config.options.scales;
    }

    state.charts[id] = new Chart(canvas, config);

    return state.charts[id];
  }

  function generateDashboard(result) {
    destroyCharts();

    state.dashboardData = result;

    const output = $("#dashboardOutput");
    const empty = $("#dashboardEmpty");

    if (!output || !empty) {
      throw new Error("Dashboard output containers were not found.");
    }

    prepareDashboardLayout();

    empty.classList.add("hidden");
    output.classList.remove("hidden");

    if ($("#generateReportBtn")) {
      $("#generateReportBtn").disabled = false;
    }

    const summary = result.summary || {};

    const title =
      result.title ||
      $("#dash-title")?.value.trim() ||
      "Business dashboard";

    const focus =
      $("#dash-type")?.selectedOptions?.[0]?.textContent ||
      result.dashboard_type ||
      "Overview";

    const filename =
      result.filename ||
      state.datasetFilename ||
      "Dataset";

    $("#dashboardResultTitle").textContent = title;

    $("#dashboardResultMeta").textContent =
      `${filename} · ${result.subtitle ||
        `${number(summary.rows)} rows · ${number(summary.columns)} columns · ${focus}`}`;

    const fallbackKpis = [
      {
        label: "Total records",
        value: summary.rows || 0,
        format: "number"
      },
      {
        label: "Data fields",
        value: summary.columns || 0,
        format: "number"
      },
      {
        label: "Data completeness",
        value: Math.max(
          0,
          100 - Number(summary.missing_percent || 0)
        ),
        suffix: "%",
        format: "percent"
      },
      {
        label: "Duplicate rows",
        value: summary.duplicate_rows || 0,
        format: "number"
      }
    ];

    const kpis =
      Array.isArray(result.kpis) && result.kpis.length
        ? result.kpis
        : fallbackKpis;

    $("#dashboardKpis").innerHTML = kpis.map((kpi) => {
      const raw = Number(kpi.value);

      const value = Number.isFinite(raw)
        ? number(raw) + (kpi.suffix || "")
        : esc(kpi.value ?? "—");

      return `
        <article class="dashboard-kpi"
          style="
            min-width:0;
            box-sizing:border-box;
            width:100%;
            height:100%;
            padding:20px;
            border-radius:16px;
            overflow-wrap:anywhere;
          ">
          <span class="kpi-label">
            ${esc(kpi.label || "Metric")}
          </span>

          <strong style="
            display:block;
            margin:12px 0;
            font-size:clamp(22px, 2vw, 30px);
            line-height:1.2;
            overflow-wrap:anywhere;
          ">${value}</strong>

          <small>
            ${esc(
              kpi.foot ||
              kpi.description ||
              "Calculated from uploaded data"
            )}
          </small>
        </article>`;
    }).join("");

    const charts = Array.isArray(result.charts)
      ? result.charts
      : [];

    const chartGrid = $("#charts-grid");

    chartGrid.innerHTML = "";

    if (!charts.length) {
      chartGrid.innerHTML = `
        <article class="panel chart-panel"
          style="grid-column:1/-1; min-width:0;">
          <h3>No chartable fields found</h3>
          <p class="muted">
            The dataset summary is available, but there are not
            enough usable values to create charts.
          </p>
        </article>`;
    } else {
      charts.forEach((chart, index) => {
        const canvasId = `nexora-dashboard-chart-${index}`;

        const chartType = String(
          chart.chart_type || "bar"
        ).toLowerCase();

        const isWide =
          index === 0 ||
          chartType === "bar-grouped" ||
          chartType === "bar-horizontal";

        const card = document.createElement("article");

        card.className = "panel chart-panel";

        card.style.cssText = `
          box-sizing:border-box;
          width:100%;
          min-width:0;
          max-width:100%;
          grid-column:${isWide ? "1 / -1" : "auto"};
          padding:clamp(16px, 2vw, 24px);
          border-radius:16px;
          overflow:hidden;
          display:flex;
          flex-direction:column;
          gap:16px;
        `;

        const heading = document.createElement("div");

        heading.className = "chart-heading";

        heading.style.cssText = `
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap:12px;
          flex-wrap:wrap;
          width:100%;
          min-width:0;
        `;

        const titleBlock = document.createElement("div");

        titleBlock.style.cssText = `
          flex:1 1 220px;
          min-width:0;
          overflow-wrap:anywhere;
        `;

        const h3 = document.createElement("h3");

        h3.textContent = chart.title || `Chart ${index + 1}`;

        h3.style.cssText = `
          margin:0 0 8px;
          overflow-wrap:anywhere;
        `;

        const desc = document.createElement("p");

        desc.className = "muted";
        desc.textContent =
          chart.description ||
          "Calculated from the uploaded dataset.";

        desc.style.cssText = `
          margin:0;
          line-height:1.6;
          overflow-wrap:anywhere;
        `;

        titleBlock.append(h3, desc);

        const typeBadge = document.createElement("span");

        typeBadge.className = "chart-type";
        typeBadge.textContent =
          chartType === "bar-grouped"
            ? "GROUPED BAR"
            : chartType.replace(
                "bar-horizontal",
                "HORIZONTAL BAR"
              ).toUpperCase();

        typeBadge.style.cssText = `
          flex:0 0 auto;
          max-width:100%;
          overflow-wrap:anywhere;
        `;

        heading.append(titleBlock, typeBadge);

        const canvasWrap = document.createElement("div");

        canvasWrap.className = "chart-canvas";

        canvasWrap.style.cssText = `
          position:relative;
          width:100%;
          min-width:0;
          height:${isWide ? "340px" : "290px"};
          max-height:420px;
        `;

        const canvas = document.createElement("canvas");

        canvas.id = canvasId;
        canvas.setAttribute("role", "img");
        canvas.setAttribute(
          "aria-label",
          chart.title || `Chart ${index + 1}`
        );

        canvas.style.cssText = `
          display:block;
          width:100% !important;
          height:100% !important;
          max-width:100%;
        `;

        canvasWrap.appendChild(canvas);
        card.append(heading, canvasWrap);
        chartGrid.appendChild(card);

        const labels = Array.isArray(chart.labels)
          ? chart.labels.map((value) => String(value))
          : [];

        let type = chartType === "bar-grouped"
          ? "bar"
          : chartType === "bar-horizontal"
            ? "bar"
            : chartType;

        if (
          !["bar", "line", "pie", "doughnut"].includes(type)
        ) {
          type = "bar";
        }

        const hasSeries =
          Array.isArray(chart.series) &&
          chart.series.length > 0;

        const datasets = hasSeries
          ? chart.series.map((series, seriesIndex) => ({
              label: series.label || `Series ${seriesIndex + 1}`,
              data: Array.isArray(series.values)
                ? series.values.map((value) => Number(value) || 0)
                : [],
              backgroundColor:
                type === "line"
                  ? `${niceColor(seriesIndex)}33`
                  : niceColor(seriesIndex),
              borderColor: niceColor(seriesIndex),
              borderWidth: type === "line" ? 2 : 0,
              fill: false,
              tension: 0.25,
              pointRadius: type === "line" ? 3 : 0,
              borderRadius: type === "bar" ? 5 : 0,
              maxBarThickness: 42
            }))
          : [{
              label: chart.y_label || chart.title || "Value",
              data: Array.isArray(chart.values)
                ? chart.values.map((value) => Number(value) || 0)
                : [],
              backgroundColor:
                type === "pie" || type === "doughnut"
                  ? labels.map((_, i) => niceColor(i))
                  : labels.map((_, i) => `${niceColor(i)}cc`),
              borderColor:
                type === "line"
                  ? niceColor(index)
                  : chartTheme().grid,
              borderWidth:
                type === "line"
                  ? 2
                  : type === "pie" || type === "doughnut"
                    ? 2
                    : 0,
              fill: false,
              tension: 0.25,
              pointRadius: type === "line" ? 3 : 0,
              borderRadius: type === "bar" ? 5 : 0,
              maxBarThickness: 42
            }];

        const isCircular =
          type === "pie" || type === "doughnut";

        const isHorizontal =
          chartType === "bar-horizontal";

        makeChart(canvasId, {
          type,
          data: {
            labels,
            datasets
          },
          options: {
            indexAxis: isHorizontal ? "y" : "x",
            cutout: type === "doughnut" ? "62%" : undefined,
            interaction: {
              intersect: false,
              mode: "index"
            },
            plugins: {
              legend: {
                display:
                  datasets.length > 1 ||
                  isCircular,
                position: isCircular ? "bottom" : "top"
              }
            },
            scales: isCircular
              ? undefined
              : {
                  x: {
                    title: {
                      display: Boolean(chart.x_label),
                      text: chart.x_label || "",
                      color: chartTheme().text
                    }
                  },
                  y: {
                    beginAtZero: true,
                    title: {
                      display: Boolean(chart.y_label),
                      text: chart.y_label || "",
                      color: chartTheme().text
                    }
                  }
                }
          }
        });
      });
    }

    const insights = Array.isArray(result.insights)
      ? result.insights
      : summary.insights || [];

    renderInsights(
      $("#dashboardInsights"),
      insights.length
        ? insights
        : ["Dashboard generated from the uploaded dataset."]
    );

    const recommendations = Array.isArray(result.recommendations)
      ? result.recommendations
      : [];

    renderInsights(
      $("#dashboardRecommendations"),
      recommendations.length
        ? recommendations
        : [
            "Review data quality flags and validate important patterns against the source system."
          ]
    );

    const preview = Array.isArray(result.preview)
      ? result.preview
      : state.datasetPreview;

    renderTable($("#previewTable"), preview || []);

    if ($("#previewCaption")) {
      $("#previewCaption").textContent =
        `${number((preview || []).length)} preview rows · ` +
        `${number(summary.columns)} columns`;
    }

    requestAnimationFrame(() => {
      resizeCharts();
      prepareDashboardLayout();
    });
  }

  function resizeCharts() {
    Object.values(state.charts).forEach((chart) => {
      try {
        chart.resize();
      } catch {
        // Canvas may be hidden.
      }
    });
  }

  async function handleGenerateDashboard(event) {
    event.preventDefault();

    if ($("#generatorError")) $("#generatorError").textContent = "";

    const file =
      state.generatorFile ||
      $("#generatorFile").files?.[0];

    if (!file) {
      if ($("#generatorError")) $("#generatorError").textContent =
        "Choose a CSV or Excel file to generate a dashboard.";
      return;
    }

    if (state.uploading) return;

    const button = $("#generate-dashboard-btn");

    button.disabled = true;
    button.textContent = "Building your dashboard…";

    try {
      const uploaded = await uploadDataset(file);

      if (!uploaded) return;

      const requestBody = {
        dataset_id: uploaded.dataset_id,
        title:
          $("#dash-title").value.trim() ||
          "Business dashboard",
        dashboard_type:
          $("#dash-type").value || "executive",
        goal: $("#dash-goal").value.trim()
      };

      const dashboard = await api(
        "/api/dashboard/generate",
        {
          method: "POST",
          body: requestBody
        }
      );

      state.datasetId = uploaded.dataset_id;
      state.datasetFilename =
        uploaded.filename || file.name;

      state.datasetSummary =
        dashboard.summary || uploaded.summary;

      state.datasetPreview =
        dashboard.preview || uploaded.preview || [];

      generateDashboard(dashboard);

      navigate("generator");

      toast(
        `Dashboard generated with ${(dashboard.charts || []).length} charts.`
      );

      await loadHistory().catch(() => {});
    } catch (error) {
      if ($("#generatorError")) $("#generatorError").textContent =
        error.message ||
        "Dashboard generation failed. Please try again.";

      toast("Dashboard generation failed.", true);
    } finally {
      button.disabled = false;
      button.innerHTML =
        'Generate dashboard <span>→</span>';
    }
  }


  async function handleDecision(event) {
    event.preventDefault();
    const topic = $("#decisionTopic")?.value.trim();
    if (!topic) { toast("Describe the decision you want to evaluate.", true); return; }
    const button = $("#evaluateDecisionBtn");
    if (button) { button.disabled = true; button.textContent = "Evaluating…"; }
    try {
      const result = await api("/api/decision/evaluate", { method: "POST", body: { topic, risk_tolerance: $("#riskTolerance")?.value || "moderate", dataset_id: state.datasetId || null }, timeout: 60000 });
      if ($("#decisionEmpty")) $("#decisionEmpty").classList.add("hidden");
      if ($("#decisionResults")) $("#decisionResults").classList.remove("hidden");
      if ($("#decisionResultTitle")) $("#decisionResultTitle").textContent = result.title || "Decision evaluation";
      const grid = $("#scenariosGrid");
      if (grid) grid.innerHTML = (result.scenarios || []).map((item, i) => `<article class="panel"><div class="eyebrow">OPTION ${i + 1}</div><h3>${esc(item.name)}</h3><p>${esc(item.description)}</p><p><strong>Risk:</strong> ${esc(item.risk)}</p><p><strong>Potential:</strong> ${esc(item.potential)}</p><p>${esc(item.tradeoff)}</p></article>`).join("");
      const actions = $("#decisionActionItems");
      if (actions) actions.innerHTML = (result.action_plan || []).map(item => `<div class="insight-row"><span class="insight-check">✓</span><p>${esc(item)}</p></div>`).join("");
      toast("Decision evaluation completed.");
      await loadHistory().catch(() => {});
    } catch (error) { toast(error.message || "Could not evaluate this decision.", true); }
    finally { if (button) { button.disabled = false; button.innerHTML = 'Evaluate scenarios <span>→</span>'; } }
  }

  // --------------------------------------------------
  // EXPORT DASHBOARD
  // --------------------------------------------------

  function exportDashboardCSV() {
    const dashboard = state.dashboardData;

    if (!dashboard) {
      toast("Generate a dashboard first.", true);
      return;
    }

    const rows = [
      ["Section", "Name", "Value"]
    ];

    (dashboard.kpis || []).forEach((kpi) => {
      rows.push([
        "KPI",
        kpi.label || "",
        `${kpi.value ?? ""}${kpi.suffix || ""}`
      ]);
    });

    (dashboard.insights || []).forEach((value, index) => {
      rows.push([
        "Insight",
        `Insight ${index + 1}`,
        value
      ]);
    });

    (dashboard.recommendations || []).forEach((value, index) => {
      rows.push([
        "Recommendation",
        `Recommendation ${index + 1}`,
        value
      ]);
    });

    (dashboard.charts || []).forEach((chart) => {
      if (Array.isArray(chart.series) && chart.series.length) {
        chart.series.forEach((series) => {
          (series.values || []).forEach((value, index) => {
            rows.push([
              "Chart",
              `${chart.title || chart.id} — ` +
              `${series.label || "Series"} — ` +
              `${chart.labels?.[index] ?? index + 1}`,
              value
            ]);
          });
        });
      } else {
        (chart.values || []).forEach((value, index) => {
          rows.push([
            "Chart",
            `${chart.title || chart.id} — ` +
            `${chart.labels?.[index] ?? index + 1}`,
            value
          ]);
        });
      }
    });

    const csvCell = (value) =>
      `"${String(value ?? "").replace(/"/g, '""')}"`;

    const csv = rows
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");

    const blob = new Blob(
      ["\uFEFF" + csv],
      { type: "text/csv;charset=utf-8;" }
    );

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;

    anchor.download =
      `${(
        $("#dash-title").value.trim() ||
        "nexora-dashboard"
      ).replace(/[^\w-]+/g, "-")}.csv`;

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);

    toast("Dashboard exported successfully.");
  }

  // --------------------------------------------------
  // AI COPILOT
  // --------------------------------------------------

  function addChatMessage(role, content, label = "") {
    const root = $("#chatMessages");
    if (!root) return null;

    const isUser = role === "user";

    const article = document.createElement("div");

    article.className =
      `message ${isUser ? "user-message" : "assistant-message"}`;

    const avatar = document.createElement("div");

    avatar.className = "message-avatar";

    avatar.textContent = isUser
      ? state.user?.name?.charAt(0)?.toUpperCase() || "Y"
      : "N";

    const body = document.createElement("div");
    body.className = "message-body";

    const author = document.createElement("div");

    author.className = "message-author";

    author.textContent = isUser
      ? "YOU"
      : `NEXORA COPILOT${label ? " · " + label : ""}`;

    const text = document.createElement("div");

    text.className = "message-content";
    text.textContent = content;

    body.append(author, text);
    article.append(avatar, body);
    root.appendChild(article);

    root.scrollTop = root.scrollHeight;

    return text;
  }

  async function sendChat(message) {
    if (!message || state.sending) return;

    state.sending = true;

    const sendButton = $("#ask-llm-btn");
    const input = $("#llm-prompt");
    const errorBox = $("#chatError");

    if (sendButton) sendButton.disabled = true;
    if (errorBox) errorBox.textContent = "";

    addChatMessage("user", message);

    const pending = addChatMessage(
      "assistant",
      "Thinking through your question…",
      "WORKING"
    );

    if (!pending) {
      state.sending = false;
      if (sendButton) sendButton.disabled = false;
      return;
    }

    try {
      const payload = { message };

      if (state.datasetId) {
        payload.dataset_id = state.datasetId;
      }

      // Frontend timeout is slightly longer than the provider timeout.
      const result = await api("/api/chat", {
        method: "POST",
        body: payload,
        timeout: 55000
      });

      pending.textContent =
        result.reply || "I couldn't generate a response.";

      const author =
        pending.parentElement?.querySelector(".message-author");

      if (author) {
        author.textContent = result.ai_enabled
          ? "NEXORA COPILOT · GEMINI"
          : "NEXORA COPILOT · AI NOT CONFIGURED";
      }

      await loadHistory().catch(() => {});
    } catch (error) {
      pending.textContent =
        "I couldn't complete that request.";

      pending.parentElement
        ?.querySelector(".message-author")
        ?.replaceChildren(
          document.createTextNode(
            "NEXORA COPILOT · REQUEST FAILED"
          )
        );

      if (errorBox) {
        errorBox.textContent =
          error.message ||
          "Something went wrong. Please try again.";
      }

      console.error("Copilot request failed:", error);
    } finally {
      state.sending = false;

      if (sendButton) sendButton.disabled = false;
      if (input) input.focus();
    }
  }

  function clearChat() {
    const root = $("#chatMessages");
    if (root) root.innerHTML = "";

    addChatMessage(
      "assistant",
      "New conversation started. What would you like to understand or decide?"
    );

    if ($("#chatError")) {
      $("#chatError").textContent = "";
    }
  }

  // --------------------------------------------------
  // THEME
  // --------------------------------------------------

  function applyTheme(theme) {
    document.body.classList.toggle(
      "light-theme",
      theme === "light"
    );

    if ($("#themeIcon")) {
      $("#themeIcon").textContent =
        theme === "light" ? "☀" : "☾";
    }

    try {
      localStorage.setItem("nexora-theme", theme);
    } catch {
      // Optional preference.
    }

    if (
      state.dashboardData &&
      !$("#dashboardOutput")?.classList.contains("hidden")
    ) {
      generateDashboard(state.dashboardData);
    }
  }

  // --------------------------------------------------
  // EVENTS
  // --------------------------------------------------

  function setupEvents() {
    if ($("#authYear")) {
      $("#authYear").textContent = new Date().getFullYear();
    }

    if ($("#footerYear")) {
      $("#footerYear").textContent = new Date().getFullYear();
    }

    if ($("#topbarDate")) {
      $("#topbarDate").textContent =
        new Date().toLocaleDateString([], {
          weekday: "short",
          month: "short",
          day: "numeric"
        });
    }

    $("#authForm")?.addEventListener("submit", handleAuth);

    $("#authSwitch")?.addEventListener("click", () => {
      setAuthMode(
        state.authMode === "login"
          ? "register"
          : "login"
      );
    });

    $("#logoutBtn")?.addEventListener("click", logout);
    $("#topLogoutBtn")?.addEventListener("click", logout);

    document.addEventListener("click", (event) => {
      const target = event.target;

      if (!(target instanceof Element)) return;

      const nav = target.closest("[data-view]");

      if (nav) {
        event.preventDefault();
        navigate(nav.dataset.view);
      }

      const prompt = target.closest("[data-prompt]");

      if (prompt) {
        navigate("copilot");

        if ($("#llm-prompt")) {
          $("#llm-prompt").value = prompt.dataset.prompt;
          $("#llm-prompt").focus();
        }
      }

      const open = target.closest("[data-open-dataset]");

      if (open) {
        openDataset(
          open.dataset.openDataset,
          open.dataset.filename
        );
      }

      const historyChat =
        target.closest("[data-history-chat]");

      if (historyChat) {
        const item = state.history.find(
          (entry) =>
            String(entry.id) === historyChat.dataset.historyChat
        );

        if (item?.content) {
          navigate("copilot");

          addChatMessage(
            "user",
            item.content.question ||
            item.title ||
            "Previous question"
          );

          addChatMessage(
            "assistant",
            item.content.reply ||
            "No saved response is available."
          );
        }
      }
    });

    $("#menuToggle")?.addEventListener("click", openSidebar);

    $("#sidebarBackdrop")?.addEventListener(
      "click",
      closeSidebar
    );

    $("#themeToggle")?.addEventListener("click", () => {
      applyTheme(
        document.body.classList.contains("light-theme")
          ? "dark"
          : "light"
      );
    });

    attachDropZone(
      $("#view-data .drop-zone"),
      $("#file-input"),
      (file) => {
        const transfer = new DataTransfer();

        transfer.items.add(file);
        $("#file-input").files = transfer.files;

        if ($("#selectedFile")) {
          $("#selectedFile").textContent = file.name;
        }
      }
    );

    $("#upload-form")?.addEventListener(
      "submit",
      async (event) => {
        event.preventDefault();

        const file = $("#file-input").files?.[0];

        if (!file) {
          if ($("#upload-status")) {
            $("#upload-status").textContent =
              "Choose a CSV or Excel file first.";
          }
          return;
        }

        await uploadDataset(file);
      }
    );

    attachDropZone(
      $("#generatorDrop"),
      $("#generatorFile"),
      (file) => {
        state.generatorFile = file;
        updateFileLabels(file);
      }
    );

    $("#generatorForm")?.addEventListener(
      "submit",
      handleGenerateDashboard
    );

    $("#decisionForm")?.addEventListener("submit", handleDecision);

    $("#generateReportBtn")?.addEventListener(
      "click",
      exportDashboardCSV
    );

    $("#chatForm")?.addEventListener(
      "submit",
      async (event) => {
        event.preventDefault();

        const input = $("#llm-prompt");
        if (!input) return;

        const message = input.value.trim();

        if (!message || state.sending) return;

        input.value = "";

        await sendChat(message);
      }
    );

    $("#llm-prompt")?.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key === "Enter" &&
          !event.shiftKey
        ) {
          event.preventDefault();
          $("#chatForm")?.requestSubmit();
        }
      }
    );

    $("#clearChatBtn")?.addEventListener(
      "click",
      clearChat
    );

    $("#askDatasetBtn")?.addEventListener("click", () => {
      navigate("copilot");

      if ($("#llm-prompt")) {
        $("#llm-prompt").value = state.datasetFilename
          ? `Help me interpret the uploaded dataset "${state.datasetFilename}". Identify what the computed summary supports, what remains unknown, and which questions I should investigate next.`
          : "Help me interpret a dataset and identify useful next questions.";

        $("#llm-prompt").focus();
      }
    });

    $("#refreshHistoryBtn")?.addEventListener("click", () => {
      loadHistory()
        .then(() => toast("History refreshed."))
        .catch((error) => toast(error.message, true));
    });

    window.addEventListener("resize", resizeCharts);

    window.addEventListener("pageshow", () => {
      if (!state.user) checkSession();
    });
  }

  // --------------------------------------------------
  // SESSION AND INITIALIZATION
  // --------------------------------------------------

  async function checkSession() {
    try {
      const result = await api("/api/me");

      if (result.user) {
        state.csrf = "";

        try {
          const csrf = await api("/api/csrf");
          state.csrf = csrf.csrf || "";
        } catch {
          // Next POST will attempt to refresh the token.
        }

        showApp(result.user);
      } else {
        state.user = null;
        showAuth();
      }
    } catch (error) {
      console.warn("Session check failed:", error.message);
      showAuth();
    }
  }

  async function init() {
    setupEvents();

    let theme = "dark";

    try {
      theme = localStorage.getItem("nexora-theme") || "dark";
    } catch {
      // Default theme.
    }

    applyTheme(theme);
    setAuthMode("login");

    await checkSession();
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      { once: true }
    );
  } else {
    init();
  }
})();