(function () {
  "use strict";

  // Relative path so the fetch resolves correctly under a GitHub Pages
  // /repo-name/ subpath as well as a plain local file server.
  const SCENARIO_URL = "attack-scenario-bfsi-ransomware.json";

  const DISCLAIMER =
    "Illustrative teaching detections. Some reference enrichment lookups (asset inventory) not present in a lab environment.";

  // ----- In-memory state only. No localStorage / sessionStorage. Reset on reload. -----
  const state = {
    scenario: null,
    tactics: [],
    steps: [],
    usedTactics: new Set(),
    view: "landing", // "landing" | "step" | "closing"
    currentStep: 0,
    answers: [], // per-step: null (unanswered) or selected option index
  };

  const appEl = document.getElementById("app");
  const scoreReadout = document.getElementById("score-readout");
  const scoreReadoutValue = document.getElementById("score-readout-value");

  // ===================================================================
  // Boot
  // ===================================================================
  fetch(SCENARIO_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${SCENARIO_URL}`);
      return res.json();
    })
    .then((data) => {
      hydrate(data);
      render();
    })
    .catch((err) => {
      appEl.innerHTML = `
        <div class="error-state">
          <strong>Could not load the scenario.</strong>
          <p>Failed to fetch <code>${escapeHtml(SCENARIO_URL)}</code>: ${escapeHtml(err.message)}</p>
          <p>Serve this folder over HTTP (e.g. <code>python3 -m http.server 8000</code>) rather than opening the
          file directly — browsers block <code>fetch()</code> on <code>file://</code> URLs.</p>
        </div>`;
      // Surface the underlying error in the console for debugging.
      console.error(err);
    });

  function hydrate(data) {
    state.scenario = data.scenario || {};
    state.tactics = Array.isArray(data.tactics_legend) ? data.tactics_legend : [];
    state.steps = Array.isArray(data.steps) ? data.steps : [];
    state.closing = data.closing_summary || {};
    state.answers = state.steps.map(() => null);
    state.usedTactics = new Set(state.steps.map((s) => s.tactic));
    // Map each used tactic to the earliest step index that references it,
    // so the progress bar can show "already reached" vs "still upcoming".
    state.tacticFirstStep = {};
    state.steps.forEach((s, i) => {
      if (!(s.tactic in state.tacticFirstStep)) state.tacticFirstStep[s.tactic] = i;
    });
  }

  // ===================================================================
  // Score
  // ===================================================================
  function scoreOf() {
    let correct = 0;
    let answered = 0;
    state.answers.forEach((a, i) => {
      if (a === null) return;
      answered++;
      if (a === state.steps[i].quiz.correct_index) correct++;
    });
    return { correct, answered, total: state.steps.length };
  }

  function updateScoreReadout() {
    if (state.view !== "step") {
      scoreReadout.hidden = true;
      return;
    }
    const { correct, answered } = scoreOf();
    scoreReadout.hidden = false;
    scoreReadoutValue.textContent = `${correct} / ${answered}`;
  }

  // ===================================================================
  // Render dispatch
  // ===================================================================
  function render() {
    if (state.view === "landing") renderLanding();
    else if (state.view === "step") renderStep();
    else if (state.view === "closing") renderClosing();
    updateScoreReadout();
  }

  // ----- Landing -----
  function renderLanding() {
    const s = state.scenario;
    appEl.innerHTML = `
      <section class="landing" aria-labelledby="landing-title">
        <p class="landing-kicker">MITRE ATT&CK Enterprise · Interactive Walkthrough</p>
        <h2 class="landing-title" id="landing-title">${escapeHtml(s.title || "Untitled scenario")}</h2>

        <div class="landing-meta">
          <div class="meta-card">
            <div class="meta-card-label">Threat Archetype</div>
            <div class="meta-card-value">${escapeHtml(s.threat_archetype || "—")}</div>
          </div>
          <div class="meta-card">
            <div class="meta-card-label">Target Profile</div>
            <div class="meta-card-value">${escapeHtml(s.target_profile || "—")}</div>
          </div>
        </div>

        <div class="landing-objective">
          <div class="meta-card-label">Learning Objective</div>
          <p>${escapeHtml(s.learning_objective || "—")}</p>
        </div>

        <div class="landing-start">
          <button class="btn btn-primary btn-lg" id="start-btn" type="button">Start Walkthrough</button>
          <span class="landing-steps-note">${state.steps.length} steps · ${state.usedTactics.size} of ${state.tactics.length} ATT&CK tactics exercised</span>
        </div>
      </section>`;

    const startBtn = document.getElementById("start-btn");
    startBtn.addEventListener("click", startWalkthrough);
    startBtn.focus();
  }

  function startWalkthrough() {
    state.view = "step";
    state.currentStep = 0;
    render();
  }

  // ----- Tactics progress bar -----
  function tacticsBarHtml() {
    const currentTactic = state.steps[state.currentStep].tactic;
    const chips = state.tactics
      .map((t) => {
        let cls = "tactic-chip";
        if (!state.usedTactics.has(t.id)) {
          cls += " is-unused";
        } else if (t.id === currentTactic) {
          cls += " is-active";
        } else if (state.tacticFirstStep[t.id] <= state.currentStep) {
          cls += " is-done";
        } else {
          cls += " is-used";
        }
        return `
          <div class="${cls}" title="${escapeHtml(t.name)}${state.usedTactics.has(t.id) ? "" : " — not used in this scenario"}">
            <div class="tc-num">${escapeHtml(t.attack_id || "")}</div>
            <div class="tc-name">${escapeHtml(t.name)}</div>
          </div>`;
      })
      .join("");

    return `
      <section class="tactics-bar" aria-label="ATT&CK tactics progress">
        <div class="tactics-bar-head">
          <span class="tactics-bar-title">Kill-Chain Progress — 14 ATT&CK Enterprise Tactics</span>
          <span class="tactics-legend-key">
            <span><span class="key-swatch is-active"></span>Current</span>
            <span><span class="key-swatch is-done"></span>Passed</span>
            <span><span class="key-swatch is-unused"></span>Unused in this scenario</span>
          </span>
        </div>
        <div class="tactics-track">${chips}</div>
      </section>`;
  }

  // ----- Step -----
  function renderStep() {
    const i = state.currentStep;
    const step = state.steps[i];
    const answered = state.answers[i] !== null;
    const tactic = state.tactics.find((t) => t.id === step.tactic);
    const tacticName = tactic ? tactic.name : step.tactic;

    appEl.innerHTML = `
      ${tacticsBarHtml()}

      <div class="step-head">
        <span class="step-counter">Step ${i + 1} of ${state.steps.length}</span>
        <div class="chips">
          <span class="chip chip-tactic">${escapeHtml(tacticName)}</span>
          ${techniqueChipHtml(step.technique)}
        </div>
      </div>

      <section class="step-card" aria-labelledby="step-narrative-label">
        <p class="step-section-label" id="step-narrative-label">What happens</p>
        <p class="step-narrative">${escapeHtml(step.narrative)}</p>

        <hr class="step-divider" />

        <p class="quiz-question">${escapeHtml(step.quiz.question)}</p>
        <div class="quiz-options" role="group" aria-label="Answer options">
          ${step.quiz.options
            .map((opt, oi) => quizOptionHtml(step, i, oi, opt))
            .join("")}
        </div>

        <div class="reveal" id="reveal" ${answered ? "" : "hidden"}>
          ${answered ? revealHtml(step, i) : ""}
        </div>
      </section>

      <nav class="step-nav" aria-label="Step navigation">
        <button class="btn" id="prev-btn" type="button">← Previous</button>
        <span class="step-nav-hint">${answered ? "Use ← → arrow keys to navigate" : "Answer the question to continue"}</span>
        <button class="btn btn-primary" id="next-btn" type="button" ${answered ? "" : "disabled"}>
          ${i === state.steps.length - 1 ? "Finish →" : "Next →"}
        </button>
      </nav>`;

    // Wire quiz options
    appEl.querySelectorAll(".quiz-option").forEach((btn) => {
      btn.addEventListener("click", () => selectAnswer(parseInt(btn.dataset.index, 10)));
    });

    // Wire nav
    document.getElementById("prev-btn").addEventListener("click", goPrev);
    document.getElementById("next-btn").addEventListener("click", goNext);

    // Wire copy buttons + syntax highlight
    highlightAndWireDetections();

    // Focus management: land keyboard users on the first unanswered option,
    // or on Next once the step is answered.
    if (!answered) {
      const first = appEl.querySelector(".quiz-option");
      if (first) first.focus();
    } else {
      document.getElementById("next-btn").focus();
    }
  }

  function techniqueChipHtml(tech) {
    if (!tech || !tech.id) return "";
    // Build the official MITRE URL from the ID: sub-techniques use a dot
    // (T1566.001) which maps to a slash in the URL (T1566/001).
    const url = `https://attack.mitre.org/techniques/${tech.id.replace(".", "/")}/`;
    return `<a class="chip chip-technique" href="${escapeHtml(url)}" target="_blank" rel="noopener"
      title="Open ${escapeHtml(tech.id)} on attack.mitre.org">
      <span class="chip-id">${escapeHtml(tech.id)}</span> ${escapeHtml(tech.name || "")}
      <span class="ext-arrow" aria-hidden="true">↗</span>
    </a>`;
  }

  function quizOptionHtml(step, stepIndex, optIndex, optText) {
    const answered = state.answers[stepIndex] !== null;
    const chosen = state.answers[stepIndex];
    const correctIndex = step.quiz.correct_index;

    let cls = "quiz-option";
    let mark = "";
    if (answered) {
      if (optIndex === correctIndex) {
        cls += " is-correct";
        mark = `<span class="opt-mark" aria-hidden="true">✓ Correct</span>`;
      } else if (optIndex === chosen) {
        cls += " is-incorrect";
        mark = `<span class="opt-mark" aria-hidden="true">✕ Your pick</span>`;
      } else {
        cls += " is-dimmed";
      }
    }
    const key = String.fromCharCode(65 + optIndex); // A, B, C, D
    const ariaPressed = answered && optIndex === chosen ? 'aria-pressed="true"' : "";
    return `
      <button class="${cls}" type="button" data-index="${optIndex}" ${answered ? "disabled" : ""} ${ariaPressed}>
        <span class="opt-key" aria-hidden="true">${key}</span>
        <span class="opt-text">${escapeHtml(optText)}</span>
        ${mark}
      </button>`;
  }

  function revealHtml(step, stepIndex) {
    const correct = state.answers[stepIndex] === step.quiz.correct_index;
    return `
      <div class="verdict ${correct ? "correct" : "incorrect"}" role="status">
        <span class="verdict-icon" aria-hidden="true">${correct ? "✓" : "✕"}</span>
        <span>${correct ? "Correct" : "Not quite"} — here's what an analyst would see.</span>
      </div>

      <div class="reveal-block">
        <p class="step-section-label">Why</p>
        <p>${escapeHtml(step.quiz.explanation)}</p>
      </div>

      <div class="reveal-block">
        <p class="step-section-label">Analyst view</p>
        <p>${escapeHtml(step.analyst_view)}</p>
      </div>

      <div class="reveal-block">
        <p class="step-section-label">Log source</p>
        <span class="log-source">${escapeHtml(step.log_source)}</span>
      </div>

      <div class="reveal-block">
        <p class="step-section-label">Detection</p>
        <div class="detection-block">
          <div class="detection-head">
            <span class="detection-platform">${escapeHtml(step.detection.platform)}</span>
            <button class="copy-btn" type="button" data-copy-target="det-code-${stepIndex}">
              <span aria-hidden="true">⧉</span> Copy
            </button>
          </div>
          <pre class="language-${prismLang(step.detection.platform)}"><code id="det-code-${stepIndex}" class="language-${prismLang(
      step.detection.platform
    )}">${escapeHtml(step.detection.query)}</code></pre>
        </div>
        <p class="detection-disclaimer">
          <span class="disc-icon" aria-hidden="true">⚠</span>
          <span>${escapeHtml(DISCLAIMER)}</span>
        </p>
      </div>`;
  }

  // Map a detection platform label to the closest loaded Prism grammar.
  function prismLang(platform) {
    const p = (platform || "").toLowerCase();
    if (p.includes("sigma") || p.includes("yaml")) return "yaml";
    if (p.includes("powershell")) return "powershell";
    // KQL (Sentinel/Defender/Elastic) and SPL (Splunk) are pipe-oriented
    // query languages; SQL highlighting is the closest visual match.
    return "sql";
  }

  function highlightAndWireDetections() {
    if (window.Prism) {
      appEl.querySelectorAll("pre code[class*='language-']").forEach((el) => {
        window.Prism.highlightElement(el);
      });
    }
    appEl.querySelectorAll(".copy-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = document.getElementById(btn.dataset.copyTarget);
        if (!target) return;
        const text = target.textContent;
        copyText(text).then((ok) => {
          if (!ok) return;
          const original = btn.innerHTML;
          btn.classList.add("copied");
          btn.innerHTML = `<span aria-hidden="true">✓</span> Copied`;
          setTimeout(() => {
            btn.classList.remove("copied");
            btn.innerHTML = original;
          }, 1500);
        });
      });
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        () => true,
        () => fallbackCopy(text)
      );
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "absolute";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  // ----- Answer handling (quiz gate) -----
  function selectAnswer(index) {
    const i = state.currentStep;
    if (state.answers[i] !== null) return; // commit once — no changing answers
    state.answers[i] = index;
    renderStep(); // re-render to reveal explanation + analyst view + detection
    updateScoreReadout();
  }

  // ----- Navigation -----
  function goNext() {
    const i = state.currentStep;
    if (state.answers[i] === null) return; // gated: must answer first
    if (i === state.steps.length - 1) {
      state.view = "closing";
      render();
    } else {
      state.currentStep++;
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function goPrev() {
    if (state.currentStep === 0) {
      state.view = "landing";
      render();
      return;
    }
    state.currentStep--;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ----- Closing -----
  function renderClosing() {
    const c = state.closing;
    const { correct, total } = scoreOf();
    const pct = total ? Math.round((correct / total) * 100) : 0;
    const points = Array.isArray(c.teaching_points) ? c.teaching_points : [];

    appEl.innerHTML = `
      <section class="closing" aria-labelledby="closing-headline">
        <div class="closing-score">
          <span class="cs-value">${correct} / ${total}</span>
          <span class="cs-label">questions correct</span>
          <span class="cs-pct">${pct}%</span>
        </div>

        <h2 class="closing-headline" id="closing-headline">${escapeHtml(c.headline || "Walkthrough complete.")}</h2>

        <p class="step-section-label">Teaching points</p>
        <ul class="closing-points">
          ${points.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}
        </ul>

        ${
          c.next_activity_suggestion
            ? `<div class="closing-next">
                 <div class="meta-card-label">Next activity</div>
                 <p>${escapeHtml(c.next_activity_suggestion)}</p>
               </div>`
            : ""
        }

        <button class="btn btn-primary btn-lg" id="restart-btn" type="button">↺ Restart Walkthrough</button>
      </section>`;

    const restart = document.getElementById("restart-btn");
    restart.addEventListener("click", () => {
      state.answers = state.steps.map(() => null);
      state.currentStep = 0;
      state.view = "landing";
      render();
    });
    restart.focus();
  }

  // ===================================================================
  // Keyboard navigation (global)
  // ===================================================================
  document.addEventListener("keydown", (e) => {
    // Don't hijack typing in form fields (none here, but be safe).
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;

    if (state.view === "landing") {
      if (e.key === "Enter") {
        e.preventDefault();
        startWalkthrough();
      }
      return;
    }

    if (state.view === "step") {
      if (e.key === "ArrowRight") {
        if (state.answers[state.currentStep] !== null) {
          e.preventDefault();
          goNext();
        }
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (["1", "2", "3", "4"].includes(e.key)) {
        // Number-key answer selection for the current unanswered step.
        const idx = parseInt(e.key, 10) - 1;
        const step = state.steps[state.currentStep];
        if (state.answers[state.currentStep] === null && idx < step.quiz.options.length) {
          e.preventDefault();
          selectAnswer(idx);
        }
      }
      return;
    }

    if (state.view === "closing") {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        state.view = "step";
        state.currentStep = state.steps.length - 1;
        render();
      }
    }
  });

  // ===================================================================
  // Utils
  // ===================================================================
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
