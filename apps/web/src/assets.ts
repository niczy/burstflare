export const styles: string = `
:root {
  color-scheme: light;
  --bg: #f2eee8;
  --bg-deep: #e7dfd4;
  --panel: rgba(255, 252, 248, 0.9);
  --panel-strong: #fffdf9;
  --panel-soft: rgba(255, 250, 244, 0.72);
  --ink: #162128;
  --muted: #5b676e;
  --accent: #b44c23;
  --accent-deep: #8d3716;
  --accent-soft: rgba(180, 76, 35, 0.1);
  --line: rgba(22, 33, 40, 0.1);
  --line-strong: rgba(22, 33, 40, 0.18);
  --shadow: 0 28px 60px rgba(58, 37, 24, 0.08);
  --shadow-soft: 0 16px 32px rgba(22, 33, 40, 0.06);
}

* { box-sizing: border-box; }

html, body {
  min-height: 100%;
}

body {
  margin: 0;
  font-family: "Satoshi", "Avenir Next", "IBM Plex Sans", "Segoe UI", sans-serif;
  color: var(--ink);
  background:
    radial-gradient(circle at 8% 10%, rgba(180, 76, 35, 0.16), transparent 22%),
    radial-gradient(circle at 88% 14%, rgba(22, 33, 40, 0.07), transparent 18%),
    radial-gradient(circle at 74% 78%, rgba(180, 76, 35, 0.08), transparent 20%),
    linear-gradient(140deg, #faf6f0 0%, var(--bg) 42%, var(--bg-deep) 100%);
}

body::before,
body::after {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
}

body::before {
  background:
    linear-gradient(120deg, rgba(255, 255, 255, 0.5), transparent 34%),
    repeating-linear-gradient(
      135deg,
      rgba(22, 33, 40, 0.014) 0,
      rgba(22, 33, 40, 0.014) 1px,
      transparent 1px,
      transparent 17px
    );
  opacity: 0.55;
}

body::after {
  background:
    linear-gradient(to right, transparent 0, rgba(255, 255, 255, 0.18) 50%, transparent 100%);
  opacity: 0.35;
}

main {
  min-height: 100dvh;
  max-width: 1440px;
  margin: 0 auto;
  padding: clamp(16px, 2vw, 28px) clamp(14px, 2.8vw, 40px) 88px;
  position: relative;
  z-index: 1;
}

.shell {
  display: grid;
  gap: 28px;
}

.hero {
  display: grid;
  gap: 28px;
  grid-template-columns: minmax(0, 1.32fr) minmax(320px, 0.9fr);
  align-items: start;
}

.hero-main,
.hero-band,
.grid,
.stack,
.list,
.output-shell,
.quickstart-grid,
.split-panel {
  display: grid;
  gap: 18px;
}

.hero-band {
  grid-template-columns: minmax(0, 1.08fr) minmax(280px, 0.92fr);
}

.grid {
  gap: 24px;
}

.grid.grid-2 {
  grid-template-columns: minmax(0, 1.08fr) minmax(300px, 0.92fr);
}

.grid.grid-3 {
  grid-template-columns: minmax(0, 1.12fr) minmax(0, 0.98fr) minmax(280px, 0.9fr);
}

.card {
  position: relative;
  overflow: hidden;
  border-radius: 30px;
  border: 1px solid var(--line);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(255, 250, 244, 0.82)),
    linear-gradient(140deg, rgba(180, 76, 35, 0.02), transparent 46%);
  padding: clamp(18px, 2vw, 28px);
  box-shadow: var(--shadow);
  backdrop-filter: blur(14px);
}

.card::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(140deg, rgba(255, 255, 255, 0.3), transparent 28%);
  opacity: 0.55;
}

.card > * {
  position: relative;
  z-index: 1;
}

.hero-card {
  display: grid;
  gap: 20px;
  min-height: 100%;
  background:
    radial-gradient(circle at 92% 14%, rgba(180, 76, 35, 0.14), transparent 20%),
    linear-gradient(140deg, rgba(255, 252, 247, 0.98), rgba(255, 246, 238, 0.86));
}

.hero-card::after {
  content: "";
  position: absolute;
  right: -40px;
  top: -42px;
  width: 220px;
  height: 220px;
  border-radius: 999px;
  border: 1px solid rgba(180, 76, 35, 0.14);
  background: radial-gradient(circle, rgba(180, 76, 35, 0.1), transparent 65%);
  pointer-events: none;
}

.hero-side {
  position: sticky;
  top: 18px;
  display: grid;
  gap: 16px;
}

.eyebrow,
.pill {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  width: fit-content;
  border-radius: 999px;
  padding: 7px 12px;
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.eyebrow {
  background: rgba(180, 76, 35, 0.1);
  color: var(--accent);
}

.eyebrow::before,
.pill::before {
  content: "";
  width: 8px;
  height: 8px;
  border-radius: 999px;
}

.eyebrow::before {
  background: var(--accent);
  box-shadow: 0 0 0 5px rgba(180, 76, 35, 0.1);
}

.pill {
  background: rgba(22, 33, 40, 0.08);
  color: var(--ink);
}

.pill::before {
  background: var(--ink);
}

.hero-topline {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.section-kicker {
  margin: 0;
  font-size: 0.76rem;
  font-weight: 850;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent);
}

.title {
  margin: 0;
  max-width: 10ch;
  font-size: clamp(3.1rem, 7vw, 6.2rem);
  line-height: 0.9;
  letter-spacing: -0.065em;
  font-weight: 820;
}

.subtitle,
.section-copy,
.card-head p,
.muted,
.surface-note span,
.step span {
  color: var(--muted);
  line-height: 1.65;
}

.subtitle {
  margin: 0;
  max-width: 66ch;
  font-size: 1rem;
}

.hero-copy {
  display: grid;
  gap: 16px;
}

.hero-metrics {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.metric-chip {
  display: grid;
  gap: 8px;
  padding: 16px 18px;
  border-radius: 22px;
  border: 1px solid rgba(22, 33, 40, 0.08);
  background: rgba(255, 255, 255, 0.7);
  box-shadow: var(--shadow-soft);
}

.metric-chip strong {
  display: block;
  font-size: 1.04rem;
  letter-spacing: -0.03em;
}

.metric-chip span {
  font-size: 0.84rem;
  color: var(--muted);
}

.hero-actions,
.row,
.inline-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.row > * {
  flex: 1 1 180px;
}

.card-head {
  display: grid;
  gap: 6px;
}

.card-head h2,
.section-title {
  margin: 0;
  font-size: clamp(1.3rem, 2vw, 1.85rem);
  line-height: 1.08;
  letter-spacing: -0.045em;
  font-weight: 780;
}

.section-copy {
  margin: 0;
}

.quickstart-shell,
.hero-pulse {
  min-height: 100%;
}

.quickstart-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.step {
  display: grid;
  gap: 10px;
  padding: 16px;
  border-radius: 22px;
  border: 1px solid rgba(22, 33, 40, 0.08);
  background: var(--panel-soft);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.65);
}

.step strong {
  font-size: 0.92rem;
  letter-spacing: -0.02em;
}

.code-block {
  margin: 0;
  padding: 14px 16px;
  border-radius: 18px;
  border: 1px solid rgba(180, 76, 35, 0.12);
  background:
    radial-gradient(circle at 100% 0, rgba(180, 76, 35, 0.08), transparent 28%),
    linear-gradient(145deg, #171d24, #10161c);
  color: #edf3f6;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.mini-note,
.surface-note {
  padding: 14px 16px;
  border-radius: 18px;
  border: 1px solid rgba(22, 33, 40, 0.08);
  background: rgba(255, 255, 255, 0.62);
}

.mini-note {
  margin: 0;
  color: var(--ink);
  line-height: 1.58;
}

.surface-note strong {
  display: block;
  margin-bottom: 4px;
  font-size: 0.92rem;
  letter-spacing: -0.02em;
}

label {
  display: block;
  margin-bottom: 7px;
  font-size: 0.76rem;
  font-weight: 780;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

input,
textarea,
select {
  width: 100%;
  border-radius: 18px;
  border: 1px solid var(--line-strong);
  padding: 13px 14px;
  font: inherit;
  color: var(--ink);
  background: rgba(255, 255, 255, 0.88);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.76);
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}

input:focus,
textarea:focus,
select:focus {
  outline: none;
  border-color: rgba(180, 76, 35, 0.42);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.76),
    0 0 0 4px rgba(180, 76, 35, 0.08);
}

textarea {
  min-height: 96px;
  resize: vertical;
}

button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: 17px;
  padding: 12px 16px;
  font: inherit;
  font-weight: 760;
  letter-spacing: -0.01em;
  cursor: pointer;
  color: #fff7f2;
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  box-shadow: 0 14px 28px rgba(180, 76, 35, 0.18);
  transition:
    transform 0.24s cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 0.24s cubic-bezier(0.16, 1, 0.3, 1),
    filter 0.24s cubic-bezier(0.16, 1, 0.3, 1);
}

button:hover {
  transform: translateY(-1px);
  box-shadow: 0 18px 32px rgba(180, 76, 35, 0.2);
  filter: saturate(1.03);
}

button:active {
  transform: translateY(1px) scale(0.99);
}

button.secondary {
  background: rgba(255, 255, 255, 0.8);
  color: var(--ink);
  border: 1px solid var(--line);
  box-shadow: none;
}

pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
  font-size: 0.82rem;
  line-height: 1.55;
}

.item {
  border-radius: 20px;
  border: 1px solid rgba(22, 33, 40, 0.08);
  background: rgba(255, 255, 255, 0.76);
  padding: 14px 15px;
  box-shadow: var(--shadow-soft);
}

.output-shell pre {
  padding: 14px 16px;
  border-radius: 20px;
  border: 1px solid rgba(22, 33, 40, 0.08);
  background: rgba(255, 255, 255, 0.72);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.72);
}

.terminal {
  min-height: 240px;
  max-height: 380px;
  overflow: auto;
  padding: 16px;
  border-radius: 22px;
  border: 1px solid rgba(180, 76, 35, 0.14);
  background:
    radial-gradient(circle at 95% 0, rgba(180, 76, 35, 0.12), transparent 24%),
    linear-gradient(145deg, #11181f, #0b1016);
  color: #edf2f5;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.terminal-input {
  font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
}

.turnstile-shell {
  min-height: 72px;
  padding: 14px;
  border-radius: 20px;
  border: 1px dashed rgba(22, 33, 40, 0.16);
  background: rgba(255, 255, 255, 0.72);
}

.split-panel.columns {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}

.error {
  min-height: 1.25em;
  padding: 10px 12px;
  border-radius: 14px;
  color: #a13814;
  background: rgba(180, 76, 35, 0.08);
}

.section-shell {
  display: grid;
  gap: 10px;
}

@media (max-width: 1180px) {
  .hero,
  .hero-band,
  .grid.grid-2,
  .grid.grid-3,
  .split-panel.columns {
    grid-template-columns: 1fr;
  }

  .hero-side {
    position: static;
  }
}

@media (max-width: 820px) {
  main {
    padding: 14px 12px 74px;
  }

  .card {
    border-radius: 24px;
    padding: 16px;
  }

  .title {
    max-width: none;
    font-size: clamp(2.45rem, 15vw, 4rem);
  }

  .hero-metrics,
  .quickstart-grid {
    grid-template-columns: 1fr;
  }

  .row > * {
    flex-basis: 100%;
  }
}

@keyframes burstflare-card-enter {
  from {
    opacity: 0;
    transform: translateY(18px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes burstflare-orbit {
  0%,
  100% {
    transform: translate3d(0, 0, 0) scale(1);
  }

  50% {
    transform: translate3d(-16px, 18px, 0) scale(1.04);
  }
}

:root {
  --bg: #e7e1d6;
  --bg-deep: #d1c8ba;
  --panel: rgba(255, 249, 241, 0.88);
  --panel-strong: #fffdf8;
  --panel-soft: rgba(255, 249, 241, 0.74);
  --ink: #121b23;
  --muted: #52606a;
  --accent: #c35424;
  --accent-deep: #8b3414;
  --accent-soft: rgba(195, 84, 36, 0.12);
  --line: rgba(18, 27, 35, 0.08);
  --line-strong: rgba(18, 27, 35, 0.14);
  --shadow: 0 30px 72px rgba(41, 28, 17, 0.12);
  --shadow-soft: 0 16px 34px rgba(18, 27, 35, 0.08);
}

body {
  background:
    radial-gradient(circle at 10% 12%, rgba(195, 84, 36, 0.2), transparent 24%),
    radial-gradient(circle at 86% 10%, rgba(24, 77, 92, 0.12), transparent 20%),
    radial-gradient(circle at 76% 82%, rgba(195, 84, 36, 0.12), transparent 26%),
    linear-gradient(136deg, #fbf6ed 0%, var(--bg) 46%, var(--bg-deep) 100%);
}

body::before {
  opacity: 0.68;
}

body::after {
  background:
    radial-gradient(circle at 30% 0, rgba(255, 255, 255, 0.3), transparent 28%),
    linear-gradient(to right, transparent 0, rgba(255, 255, 255, 0.18) 50%, transparent 100%);
  opacity: 0.4;
}

main {
  max-width: 1520px;
  padding: clamp(18px, 2.4vw, 34px) clamp(16px, 3vw, 48px) 96px;
}

.shell {
  gap: 32px;
}

.hero {
  gap: 32px;
  grid-template-columns: minmax(0, 1.38fr) minmax(320px, 0.8fr);
}

.hero-band,
.grid,
.stack,
.list,
.output-shell,
.quickstart-grid,
.split-panel {
  gap: 20px;
}

.card {
  border-radius: 34px;
  border: 1px solid rgba(255, 255, 255, 0.74);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(253, 245, 237, 0.8)),
    linear-gradient(135deg, rgba(195, 84, 36, 0.08), transparent 42%);
  box-shadow:
    var(--shadow),
    inset 0 1px 0 rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(22px);
  animation: burstflare-card-enter 560ms cubic-bezier(0.19, 1, 0.22, 1) both;
}

.card::before {
  background: linear-gradient(140deg, rgba(255, 255, 255, 0.52), transparent 30%);
  opacity: 0.78;
}

.hero-card {
  min-height: clamp(620px, calc(100dvh - 140px), 920px);
  gap: 24px;
  background:
    radial-gradient(circle at 92% 14%, rgba(195, 84, 36, 0.18), transparent 22%),
    radial-gradient(circle at 10% 82%, rgba(24, 77, 92, 0.08), transparent 18%),
    linear-gradient(140deg, rgba(255, 253, 249, 0.98), rgba(255, 245, 236, 0.88));
}

.hero-card::after {
  top: -58px;
  right: -52px;
  width: 280px;
  height: 280px;
  border-color: rgba(195, 84, 36, 0.18);
  background: radial-gradient(circle, rgba(195, 84, 36, 0.14), transparent 66%);
  animation: burstflare-orbit 18s ease-in-out infinite;
}

.hero-side {
  top: 24px;
  gap: 18px;
}

.eyebrow,
.pill {
  padding: 8px 13px;
  border: 1px solid rgba(255, 255, 255, 0.58);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
}

.title {
  max-width: 8ch;
  font-size: clamp(3.35rem, 7.5vw, 7rem);
  letter-spacing: -0.07em;
}

.subtitle {
  max-width: 60ch;
  color: rgba(18, 27, 35, 0.78);
}

.hero-metrics {
  gap: 16px;
}

.metric-chip,
.item,
.output-shell pre,
.turnstile-shell {
  border-radius: 24px;
  border: 1px solid rgba(18, 27, 35, 0.08);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.86), rgba(251, 244, 237, 0.74));
  box-shadow:
    0 16px 34px rgba(18, 27, 35, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.74);
}

.metric-chip {
  min-height: 152px;
  padding: 18px 18px 20px;
}

.card-head h2 {
  letter-spacing: -0.035em;
  font-size: clamp(1.35rem, 1.5vw, 1.72rem);
}

.card-head p,
.surface-note span,
.step span,
.mini-note,
.muted {
  color: rgba(18, 27, 35, 0.64);
}

.code-block,
.output-shell pre {
  border-radius: 24px;
  border: 1px solid rgba(15, 21, 29, 0.14);
  background:
    radial-gradient(circle at 100% 0, rgba(195, 84, 36, 0.12), transparent 24%),
    linear-gradient(145deg, #111921, #0d141c);
  color: #f5f1ea;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    0 14px 30px rgba(9, 13, 17, 0.18);
}

.surface-note,
.mini-note {
  padding: 16px 18px;
  border-radius: 22px;
  border: 1px solid rgba(18, 27, 35, 0.07);
  background: rgba(255, 255, 255, 0.58);
  backdrop-filter: blur(14px);
}

label {
  font-size: 0.73rem;
  letter-spacing: 0.08em;
  color: rgba(18, 27, 35, 0.72);
}

input,
textarea,
select {
  border-radius: 18px;
  border: 1px solid rgba(18, 27, 35, 0.1);
  background: rgba(255, 255, 255, 0.74);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.76),
    0 8px 18px rgba(18, 27, 35, 0.04);
}

input:focus,
textarea:focus,
select:focus {
  border-color: rgba(195, 84, 36, 0.42);
  box-shadow:
    0 0 0 4px rgba(195, 84, 36, 0.12),
    0 12px 24px rgba(18, 27, 35, 0.08);
}

button {
  border-radius: 999px;
  padding: 12px 18px;
  font-weight: 800;
  letter-spacing: -0.01em;
  background:
    linear-gradient(180deg, #d36433, #a64117);
  box-shadow:
    0 18px 36px rgba(195, 84, 36, 0.24),
    inset 0 1px 0 rgba(255, 255, 255, 0.24);
}

button:hover {
  box-shadow:
    0 22px 42px rgba(195, 84, 36, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.28);
}

button.secondary {
  background: rgba(255, 255, 255, 0.68);
  border-color: rgba(18, 27, 35, 0.08);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.74),
    0 10px 20px rgba(18, 27, 35, 0.05);
}

.terminal {
  min-height: 280px;
  border-radius: 28px;
  border-color: rgba(195, 84, 36, 0.16);
  background:
    radial-gradient(circle at 100% 0, rgba(195, 84, 36, 0.16), transparent 26%),
    radial-gradient(circle at 0 100%, rgba(24, 77, 92, 0.16), transparent 22%),
    linear-gradient(145deg, #0c1319, #0f1820 54%, #0a1118);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 24px 42px rgba(7, 12, 16, 0.24);
}

.turnstile-shell {
  border-style: solid;
  border-color: rgba(18, 27, 35, 0.08);
}

.error {
  min-height: 44px;
  display: flex;
  align-items: center;
  border-radius: 18px;
  color: #9f3210;
  border: 1px solid rgba(195, 84, 36, 0.08);
  background: rgba(195, 84, 36, 0.08);
}

.section-frame {
  display: grid;
  gap: 16px;
}

.section-intro {
  display: grid;
  gap: 10px;
}

.section-intro h2 {
  margin: 0;
  font-size: clamp(1.5rem, 2.3vw, 2.3rem);
  letter-spacing: -0.04em;
}

.section-intro p {
  margin: 0;
  color: var(--muted);
}

.hero-banner {
  min-height: 54dvh;
  display: grid;
  align-content: center;
  gap: 18px;
  text-align: center;
}

.hero-banner h1 {
  margin: 0;
  font-size: clamp(2.8rem, 8vw, 6.8rem);
  line-height: 0.9;
  letter-spacing: -0.07em;
}

.hero-banner p {
  margin: 0 auto;
  max-width: 70ch;
  color: var(--muted);
}

.workflow-canvas {
  position: relative;
  overflow: hidden;
}

.workflow-track {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  position: relative;
}

.workflow-track::before {
  content: "";
  position: absolute;
  left: 10%;
  right: 10%;
  top: 50%;
  height: 2px;
  background: linear-gradient(90deg, rgba(195, 84, 36, 0.05), rgba(195, 84, 36, 0.7), rgba(195, 84, 36, 0.05));
  transform: translateY(-50%);
}

.workflow-node {
  appearance: none;
  text-align: left;
  position: relative;
  z-index: 1;
  padding: 16px;
  border-radius: 20px;
  border: 1px solid rgba(18, 27, 35, 0.08);
  background: rgba(255, 255, 255, 0.82);
  display: grid;
  gap: 8px;
  animation: burstflare-card-enter 560ms cubic-bezier(0.19, 1, 0.22, 1) both;
  cursor: pointer;
  box-shadow: none;
  color: var(--ink);
}

.workflow-node:hover {
  border-color: rgba(195, 84, 36, 0.3);
}

.workflow-node.is-active {
  border-color: rgba(195, 84, 36, 0.5);
  background: rgba(255, 246, 239, 0.9);
}

.workflow-node.is-locked {
  opacity: 0.55;
}

.workflow-panels {
  display: grid;
  gap: 14px;
}

.workflow-panel[hidden] {
  display: none;
}

.workflow-node::before {
  content: "";
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: var(--accent);
  box-shadow: 0 0 0 8px rgba(195, 84, 36, 0.12);
  animation: burstflare-orbit 3.8s ease-in-out infinite;
}

.workflow-node strong {
  font-size: 0.95rem;
}

.comparison-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.comparison-card {
  padding: 16px;
  border-radius: 20px;
  border: 1px solid rgba(18, 27, 35, 0.08);
  background: rgba(255, 255, 255, 0.82);
}

.comparison-card h3 {
  margin: 0 0 10px;
  font-size: 1rem;
}

.comparison-card ul {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 8px;
  color: var(--muted);
}

.steps-stack {
  display: grid;
  gap: 18px;
}

.step-card {
  border-radius: 24px;
  border: 1px solid rgba(18, 27, 35, 0.08);
  background: rgba(255, 255, 255, 0.82);
  padding: 18px;
  display: grid;
  gap: 14px;
}

.step-head {
  display: grid;
  gap: 4px;
}

.step-head h3 {
  margin: 0;
  font-size: 1.08rem;
}

.step-head p {
  margin: 0;
  color: var(--muted);
}

.quick-status {
  min-height: 38px;
  display: flex;
  align-items: center;
  padding: 9px 12px;
  border-radius: 14px;
  border: 1px solid rgba(18, 27, 35, 0.08);
  background: rgba(255, 255, 255, 0.62);
  color: var(--muted);
}

details.advanced-panel {
  border: 1px solid rgba(18, 27, 35, 0.08);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.7);
  padding: 12px;
}

details.advanced-panel > summary {
  cursor: pointer;
  font-weight: 760;
  color: var(--ink);
}

.contacts-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr);
  gap: 16px;
}

/* Flat storefront-style surface */
:root {
  --bg: #f1f3f4;
  --bg-deep: #f1f3f4;
  --row-odd: #E8E8E8;
  --row-even: rgb(250, 250, 250);
  --panel: #ffffff;
  --panel-strong: #ffffff;
  --panel-soft: #ffffff;
  --ink: #202124;
  --muted: #5f6368;
  --accent: #c35424;
  --accent-deep: #8b3414;
  --accent-soft: rgba(195, 84, 36, 0.12);
  --line: rgba(0, 0, 0, 0.08);
  --line-strong: rgba(0, 0, 0, 0.12);
  --shadow: none;
  --shadow-soft: none;
}

body {
  background: var(--bg);
}

body::before,
body::after {
  display: none;
}

main {
  max-width: 1200px;
  padding: clamp(18px, 2.4vw, 34px) clamp(16px, 2.6vw, 40px) 96px;
}

.shell {
  gap: 0;
}

.card {
  border: 0;
  background: transparent;
  box-shadow: none;
  border-radius: 0;
  padding: 0;
}

.shell > section {
  position: relative;
  z-index: 0;
  isolation: isolate;
  padding: clamp(36px, 6vw, 84px) 0;
}

.shell > section::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(50% - 50vw);
  right: calc(50% - 50vw);
  z-index: -1;
  background: transparent;
}

.shell > section:nth-of-type(odd)::before {
  background: var(--row-odd);
}

.shell > section:nth-of-type(even)::before {
  background: var(--row-even);
}

/* Explicit section backgrounds requested */
.shell > section.row-white::before {
  background: rgb(250, 250, 250);
}

.hero-banner h1,
.section-intro h2,
.step-head h3,
.comparison-card h3 {
  color: #202124;
}

.subtitle,
.section-intro p,
.step-head p,
.comparison-card ul,
.muted {
  color: #5f6368;
}

.hero-banner {
  min-height: clamp(360px, 54vh, 620px);
  align-content: center;
}

.section-frame {
  min-height: clamp(320px, 44vh, 560px);
  gap: 20px;
}

.workflow-canvas {
  min-height: clamp(420px, 58vh, 760px);
}

.workflow-node,
.comparison-card,
.step-card,
.surface-note,
.mini-note,
.turnstile-shell,
.item,
.output-shell pre {
  border: 0;
  box-shadow: none;
  background: #f8f9fa;
}

.step-card {
  padding: 22px;
  min-height: 300px;
}

.workflow-panel {
  min-height: 380px;
}

.workflow-node.is-active {
  background: #eef3fd;
}

.card::before,
.card::after {
  display: none;
}

button {
  color: #ffffff;
  background: linear-gradient(180deg, var(--accent), var(--accent-deep));
  box-shadow: none;
}

button:hover {
  filter: brightness(1.04);
  box-shadow: none;
}

button.secondary {
  color: #8b3414;
  background: #f7e7df;
  border: 0;
  box-shadow: none;
}

@media (max-width: 1180px) {
  .hero-card {
    min-height: auto;
  }
}

@media (max-width: 820px) {
  .card {
    border-radius: 28px;
  }

  .hero-card {
    min-height: auto;
  }

  .workflow-track,
  .comparison-grid,
  .contacts-grid {
    grid-template-columns: 1fr;
  }

  .workflow-track::before {
    display: none;
  }
}
`;

export const html: string = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BurstFlare</title>
    <link rel="stylesheet" href="/styles.css" />
    __BURSTFLARE_TURNSTILE_SCRIPT__
  </head>
  <body>
    <main class="shell">
      <section class="card hero-banner">
        <span class="eyebrow">BurstFlare</span>
        <h1>Your Dev Environment, Ready in Minutes</h1>
        <p>
          BurstFlare gives teams one place for auth, templates, build promotion, live sessions, preview, terminal, snapshots, and audit
          history so new users can go from zero to a working environment with minimal setup.
        </p>
        <div class="hero-actions" style="justify-content:center">
          <button id="heroQuickLaunchButton">Quick Launch Working Session</button>
          <button class="secondary" id="quickOpenPreviewButton">Open Latest Preview</button>
        </div>
      </section>

      <section class="card section-frame workflow-canvas row-white">
        <div class="section-intro">
          <h2>How The System Works</h2>
          <p>Use these tabs in order. Each step exposes only the controls needed for that phase.</p>
        </div>
        <div class="workflow-track">
          <button class="workflow-node" type="button" data-workflow-step="0">
            <strong>1. Identity</strong>
            <span class="muted">Sign in and run quick launch from basic inputs.</span>
          </button>
          <button class="workflow-node is-locked" type="button" data-workflow-step="1">
            <strong>2. Template Build</strong>
            <span class="muted">Workspace setup, template creation, and promotion.</span>
          </button>
          <button class="workflow-node is-locked" type="button" data-workflow-step="2">
            <strong>3. Session Runtime</strong>
            <span class="muted">Session lifecycle, preview, terminal, and runtime actions.</span>
          </button>
          <button class="workflow-node is-locked" type="button" data-workflow-step="3">
            <strong>4. Operate & Restore</strong>
            <span class="muted">Snapshots, usage, reports, releases, and audit.</span>
          </button>
        </div>

        <div class="workflow-panels">
          <article class="step-card workflow-panel" data-workflow-panel="0">
            <div class="step-head">
              <h3>Identity</h3>
              <p>Start with basic information and optionally run one-click session launch.</p>
            </div>
            <div class="row">
              <div>
                <label for="quickEmail">Email</label>
                <input id="quickEmail" type="email" placeholder="you@example.com" />
              </div>
              <div>
                <label for="quickName">Name</label>
                <input id="quickName" type="text" placeholder="Your name" />
              </div>
            </div>
            <div class="row">
              <div>
                <label for="quickTemplateName">Template Name (Optional)</label>
                <input id="quickTemplateName" type="text" placeholder="Leave empty for random" />
              </div>
              <div>
                <label for="quickSessionName">Session Name (Optional)</label>
                <input id="quickSessionName" type="text" placeholder="Leave empty for random" />
              </div>
            </div>
            <div class="row">
              <button id="quickLaunchButton">Create Working Dev Environment</button>
            </div>
            <div class="quick-status" id="quickLaunchStatus">Waiting to launch.</div>
            <div class="list" id="dashboardPulse"></div>

            <div class="row">
              <div>
                <label for="email">Email</label>
                <input id="email" type="email" placeholder="you@example.com" />
              </div>
              <div>
                <label for="name">Name</label>
                <input id="name" type="text" placeholder="Nicholas" />
              </div>
            </div>
            <div>
              <label>Verification Challenge</label>
              <div class="turnstile-shell muted" id="turnstileWidget">The verification challenge loads automatically in the hosted app.</div>
            </div>
            <div>
              <label for="turnstileToken">Verification Token</label>
              <input id="turnstileToken" type="text" placeholder="Leave blank unless local testing" />
            </div>
            <div class="row">
              <button id="registerButton">Register</button>
              <button class="secondary" id="loginButton">Login</button>
              <button class="secondary" id="passkeyLoginButton">Passkey Login</button>
            </div>
            <div class="row">
              <button class="secondary" id="recoverButton">Use Recovery Code</button>
              <button class="secondary" id="logoutButton">Logout</button>
              <button class="secondary" id="logoutAllButton">Logout All Sessions</button>
            </div>
            <div>
              <label for="recoveryCode">Recovery Code</label>
              <input id="recoveryCode" type="text" placeholder="recovery_..." />
            </div>
            <div class="row">
              <button class="secondary" id="recoveryCodesButton">New Recovery Codes</button>
              <button class="secondary" id="passkeyRegisterButton">Register Passkey</button>
            </div>
            <div class="surface-note">
              <strong id="identity">Not signed in</strong>
              <span id="lastRefresh">Last refresh: never</span>
            </div>
            <pre class="code-block" id="recoveryCodes">No recovery codes generated.</pre>
            <div class="list" id="passkeys"></div>
            <div class="muted" id="deviceStatus">Pending device approvals: 0</div>
            <div class="list" id="pendingDevices"></div>
            <div class="list" id="authSessions"></div>
            <div class="row">
              <div>
                <label for="deviceCode">Approve Device Code</label>
                <input id="deviceCode" type="text" placeholder="device_..." />
              </div>
              <div class="inline-actions" style="align-self:end">
                <button class="secondary" id="approveDeviceButton">Approve Device</button>
                <button class="secondary" id="authSessionsButton">Refresh Sessions</button>
              </div>
            </div>
            <div class="error" id="errors"></div>
            <div class="row">
              <button class="secondary" type="button" data-next-step="1">Continue to Template Build</button>
            </div>
          </article>

          <article class="step-card workflow-panel" data-workflow-panel="1" hidden>
            <div class="step-head">
              <h3>Template Build</h3>
              <p>Create workspace metadata, build template version, and promote it.</p>
            </div>
            <div>
              <label for="workspaceName">Workspace Name</label>
              <input id="workspaceName" type="text" placeholder="My Workspace" />
            </div>
            <div class="row">
              <div>
                <label for="inviteEmail">Invite Email</label>
                <input id="inviteEmail" type="email" placeholder="teammate@example.com" />
              </div>
              <div>
                <label for="inviteRole">Role</label>
                <select id="inviteRole">
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                  <option value="viewer">viewer</option>
                </select>
              </div>
            </div>
            <div class="row">
              <button class="secondary" id="saveWorkspaceButton">Save Workspace</button>
              <button id="inviteButton">Create Invite</button>
              <button class="secondary" id="membersButton">Refresh Members</button>
            </div>
            <div class="row">
              <div>
                <label for="inviteCode">Accept Invite Code</label>
                <input id="inviteCode" type="text" placeholder="invite_..." />
              </div>
              <div class="inline-actions" style="align-self:end">
                <button class="secondary" id="acceptInviteButton">Accept Invite</button>
                <button class="secondary" id="planButton">Upgrade To Pro</button>
              </div>
            </div>
            <div class="list" id="members"></div>

            <div>
              <label for="templateName">Template Name</label>
              <input id="templateName" type="text" placeholder="node-dev" />
            </div>
            <div>
              <label for="templateDescription">Description</label>
              <textarea id="templateDescription" placeholder="Node.js shell with SSH, browser access, and preview ports"></textarea>
            </div>
            <button id="createTemplateButton">Create Template</button>
            <div class="row">
              <div>
                <label for="versionTemplate">Template ID</label>
                <input id="versionTemplate" type="text" placeholder="tpl_..." />
              </div>
              <div>
                <label for="templateVersion">Version</label>
                <input id="templateVersion" type="text" placeholder="1.0.0" />
              </div>
            </div>
            <div>
              <label for="persistedPaths">Persisted Paths</label>
              <input id="persistedPaths" type="text" placeholder="/workspace,/home/dev/.cache" />
            </div>
            <div class="row">
              <button class="secondary" id="addVersionButton">Queue Build</button>
              <button class="secondary" id="processBuildsButton">Process Builds</button>
              <button class="secondary" id="listBuildsButton">Refresh Builds</button>
            </div>
            <div class="row">
              <div>
                <label for="promoteTemplate">Template ID</label>
                <input id="promoteTemplate" type="text" placeholder="tpl_..." />
              </div>
              <div>
                <label for="promoteVersion">Version ID</label>
                <input id="promoteVersion" type="text" placeholder="tplv_..." />
              </div>
            </div>
            <button id="promoteButton">Promote Version</button>
            <div class="list" id="templates"></div>
            <div class="output-shell">
              <pre id="templateInspector">Select a template to inspect.</pre>
              <pre id="builds">[]</pre>
            </div>
            <div class="row">
              <button class="secondary" type="button" data-prev-step="0">Back</button>
              <button class="secondary" type="button" data-next-step="2">Continue to Session Runtime</button>
            </div>
          </article>

          <article class="step-card workflow-panel" data-workflow-panel="2" hidden>
            <div class="step-head">
              <h3>Session Runtime</h3>
              <p>Create and manage session, then attach quick terminal.</p>
            </div>
            <div class="row">
              <div>
                <label for="sessionName">Session Name</label>
                <input id="sessionName" type="text" placeholder="my-workspace" />
              </div>
              <div>
                <label for="sessionTemplate">Template ID</label>
                <input id="sessionTemplate" type="text" placeholder="tpl_..." />
              </div>
            </div>
            <button id="createSessionButton">Create Session</button>
            <div class="list" id="sessions"></div>
            <div class="row">
              <button class="secondary" id="refreshButton">Refresh Workspace</button>
              <button class="secondary" id="reconcileButton">Run Cleanup</button>
            </div>
            <div class="muted" id="terminalStatus">Not connected</div>
            <pre class="terminal" id="terminalOutput">Waiting for a session attach...</pre>
            <div class="row">
              <input class="terminal-input" id="terminalInput" type="text" placeholder="Type a command or message" />
              <button class="secondary" id="terminalSendButton">Send</button>
              <button class="secondary" id="terminalCloseButton">Close</button>
            </div>
            <div class="row">
              <button class="secondary" type="button" data-prev-step="1">Back</button>
              <button class="secondary" type="button" data-next-step="3">Continue to Operate & Restore</button>
            </div>
          </article>

          <article class="step-card workflow-panel" data-workflow-panel="3" hidden>
            <div class="step-head">
              <h3>Operate & Restore</h3>
              <p>Snapshot restore, usage reporting, release visibility, and audit trails.</p>
            </div>
            <div class="row">
              <div>
                <label for="snapshotSession">Session ID</label>
                <input id="snapshotSession" type="text" placeholder="ses_..." />
              </div>
              <div>
                <label for="snapshotLabel">Label</label>
                <input id="snapshotLabel" type="text" placeholder="manual-save" />
              </div>
            </div>
            <div>
              <label for="snapshotContent">Snapshot Content</label>
              <textarea id="snapshotContent" placeholder="Optional text payload"></textarea>
            </div>
            <div class="row">
              <button id="snapshotButton">Create Snapshot</button>
              <button class="secondary" id="snapshotListButton">Load Snapshots</button>
              <button class="secondary" id="reportButton">Refresh Admin Report</button>
            </div>
            <div class="list" id="snapshotList"></div>
            <div class="output-shell">
              <pre id="snapshotContentPreview">No snapshot content loaded.</pre>
              <pre id="usage"></pre>
              <pre id="report">[]</pre>
              <pre id="releases">[]</pre>
              <pre id="audit">[]</pre>
            </div>
            <div class="row">
              <button class="secondary" type="button" data-prev-step="2">Back</button>
            </div>
          </article>
        </div>
      </section>

      <section class="card section-frame">
        <div class="section-intro">
          <h2>Why BurstFlare Wins</h2>
          <p>Compared with typical hosted IDE products, BurstFlare keeps runtime control and CLI-grade workflows together.</p>
        </div>
        <div class="comparison-grid">
          <article class="comparison-card">
            <h3>BurstFlare</h3>
            <ul>
              <li>One hosted endpoint + CLI path without environment juggling.</li>
              <li>Template lifecycle and session lifecycle share one control plane.</li>
              <li>Preview, editor, terminal, SSH, snapshots, and audit all in one surface.</li>
            </ul>
          </article>
          <article class="comparison-card">
            <h3>Typical Market Flow</h3>
            <ul>
              <li>Separate systems for auth, environment catalog, and runtime access.</li>
              <li>More manual handoffs between template build and session launch.</li>
              <li>New users must learn operator controls before first success.</li>
            </ul>
          </article>
        </div>
      </section>


      <section class="card section-frame row-white">
        <div class="section-intro">
          <h2>Further Reading & Contact</h2>
          <p>Continue with docs or start a support loop with the team.</p>
        </div>
        <div class="contacts-grid">
          <div class="surface-note">
            <strong>Resources</strong>
            <span>Read architecture, runbook, and roadmap under <code>spec/</code>. Use the CLI docs to automate workflows.</span>
            <pre class="code-block">spec/overview.md
spec/architecture.md
spec/runbook.md
apps/cli/README.md</pre>
          </div>
          <div class="surface-note">
            <strong>Contact</strong>
            <span>Use workspace invites for team access and this dashboard for session and audit visibility.</span>
            <p class="mini-note">Product endpoint: <code>https://burstflare.dev</code></p>
          </div>
        </div>
      </section>
    </main>
    <script type="module" src="/app.js"></script>
  </body>
</html>`;

export const appJs: string = `
const TURNSTILE_SITE_KEY = __BURSTFLARE_TURNSTILE_SITE_KEY__;

const state = {
  refreshToken: localStorage.getItem("burstflare_refresh_token") || "",
  csrfToken: localStorage.getItem("burstflare_csrf") || "",
  me: null,
  terminalSocket: null,
  terminalSessionId: "",
  quickPreviewUrl: "",
  workflowStep: Number(localStorage.getItem("burstflare_workflow_step") || 0),
  workflowUnlocked: Number(localStorage.getItem("burstflare_workflow_unlocked") || 0),
  turnstileWidgetId: "",
  refreshTimer: null,
  refreshPending: false
};

localStorage.removeItem("burstflare_token");

function byId(id) {
  return document.getElementById(id);
}

function setError(message) {
  byId("errors").textContent = message || "";
}

function setTerminalStatus(message) {
  byId("terminalStatus").textContent = message || "Not connected";
}

function setTerminalOutput(message) {
  byId("terminalOutput").textContent = message;
  byId("terminalOutput").scrollTop = byId("terminalOutput").scrollHeight;
}

function setDeviceStatus(message) {
  byId("deviceStatus").textContent = message;
}

function setLastRefresh(value) {
  byId("lastRefresh").textContent = value ? 'Last refresh: ' + value : 'Last refresh: never';
}

function setRecoveryCodes(codes = []) {
  byId("recoveryCodes").textContent = Array.isArray(codes) && codes.length
    ? codes.join("\\n")
    : "No recovery codes generated.";
}

function renderPasskeys(passkeys = []) {
  const items = passkeys.map((passkey) => {
    const action = '<button class="secondary" data-passkey-delete="' + passkey.id + '">Delete</button>';
    return '<div class="item"><strong>' + (passkey.label || passkey.id) + '</strong><br><span class="muted">' + passkey.id +
      '</span><br><span class="muted">alg ' + passkey.algorithm + '</span><br><span class="muted">created ' +
      passkey.createdAt + (passkey.lastUsedAt ? ' / used ' + passkey.lastUsedAt : '') +
      '</span><div class="row" style="margin-top:8px">' + action + '</div></div>';
  });
  byId("passkeys").innerHTML = items.length ? items.join("") : '<div class="item muted">No passkeys registered.</div>';

  document.querySelectorAll("[data-passkey-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm('Delete this passkey?')) {
        return;
      }
      await perform(async () => api('/api/auth/passkeys/' + button.dataset.passkeyDelete, { method: 'DELETE' }));
    });
  });
}

function renderPendingDevices(devices = []) {
  const items = devices.map((device) => {
    return '<div class="item"><strong>' + device.code + '</strong><br><span class="muted">expires ' + device.expiresAt +
      '</span><div class="row" style="margin-top:8px"><button class="secondary" data-device-approve="' + device.code +
      '">Approve</button></div></div>';
  });
  byId("pendingDevices").innerHTML = items.length ? items.join("") : '<div class="item muted">No pending device approvals.</div>';

  document.querySelectorAll("[data-device-approve]").forEach((button) => {
    button.addEventListener("click", async () => {
      await perform(async () => {
        await api('/api/cli/device/approve', {
          method: 'POST',
          body: JSON.stringify({ deviceCode: button.dataset.deviceApprove })
        });
      });
    });
  });
}

function isPasskeySupported() {
  return typeof window.PublicKeyCredential === 'function' && navigator.credentials && typeof navigator.credentials.create === 'function';
}

function bytesToBase64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || new ArrayBuffer(0));
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function serializeAttestationCredential(credential) {
  const response = credential.response;
  return {
    id: credential.id,
    type: credential.type,
    response: {
      clientDataJSON: bytesToBase64Url(response.clientDataJSON),
      publicKey: bytesToBase64Url(response.getPublicKey ? response.getPublicKey() : new Uint8Array()),
      publicKeyAlgorithm: response.getPublicKeyAlgorithm ? response.getPublicKeyAlgorithm() : null,
      authenticatorData: bytesToBase64Url(response.getAuthenticatorData ? response.getAuthenticatorData() : new Uint8Array()),
      transports: response.getTransports ? response.getTransports() : []
    }
  };
}

function serializeAssertionCredential(credential) {
  const response = credential.response;
  return {
    id: credential.id,
    type: credential.type,
    response: {
      clientDataJSON: bytesToBase64Url(response.clientDataJSON),
      authenticatorData: bytesToBase64Url(response.authenticatorData),
      signature: bytesToBase64Url(response.signature),
      userHandle: response.userHandle ? bytesToBase64Url(response.userHandle) : null
    }
  };
}

function resetTurnstile() {
  byId("turnstileToken").value = "";
  if (TURNSTILE_SITE_KEY && state.turnstileWidgetId && globalThis.turnstile?.reset) {
    globalThis.turnstile.reset(state.turnstileWidgetId);
  }
}

function mountTurnstile() {
  const host = byId("turnstileWidget");
  if (!host) {
    return;
  }
  if (!TURNSTILE_SITE_KEY) {
    host.textContent = "Turnstile is not configured for this deployment.";
    return;
  }
  if (!globalThis.turnstile?.render) {
    host.textContent = "Loading Turnstile widget...";
    setTimeout(mountTurnstile, 250);
    return;
  }
  if (state.turnstileWidgetId) {
    return;
  }
  host.textContent = "";
  state.turnstileWidgetId = globalThis.turnstile.render(host, {
    sitekey: TURNSTILE_SITE_KEY,
    theme: "light",
    callback(token) {
      byId("turnstileToken").value = token;
    },
    "expired-callback"() {
      byId("turnstileToken").value = "";
    },
    "error-callback"() {
      byId("turnstileToken").value = "";
      host.textContent = "Turnstile challenge failed. You can still paste a token manually.";
      state.turnstileWidgetId = "";
      setTimeout(mountTurnstile, 500);
    }
  });
}

function appendTerminalOutput(message) {
  const current = byId("terminalOutput").textContent;
  byId("terminalOutput").textContent = current ? current + "\\n" + message : message;
  byId("terminalOutput").scrollTop = byId("terminalOutput").scrollHeight;
}

function parsePersistedPaths(value) {
  const items = String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

function setQuickStatus(message) {
  const target = byId("quickLaunchStatus");
  if (target) {
    target.textContent = message;
  }
}

function clampStep(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.min(3, Math.floor(parsed)));
}

function setWorkflowStep(step) {
  const nextStep = clampStep(step);
  const allowedStep = Math.min(nextStep, clampStep(state.workflowUnlocked));
  state.workflowStep = allowedStep;
  localStorage.setItem("burstflare_workflow_step", String(allowedStep));

  document.querySelectorAll("[data-workflow-step]").forEach((button) => {
    const buttonStep = clampStep(button.dataset.workflowStep || "0");
    button.classList.toggle("is-active", buttonStep === allowedStep);
    button.classList.toggle("is-locked", buttonStep > state.workflowUnlocked);
  });

  document.querySelectorAll("[data-workflow-panel]").forEach((panel) => {
    const panelStep = clampStep(panel.dataset.workflowPanel || "0");
    panel.hidden = panelStep !== allowedStep;
  });
}

function unlockWorkflowStep(step) {
  const nextUnlocked = Math.max(clampStep(state.workflowUnlocked), clampStep(step));
  state.workflowUnlocked = nextUnlocked;
  localStorage.setItem("burstflare_workflow_unlocked", String(nextUnlocked));
  setWorkflowStep(Math.max(state.workflowStep, Math.min(state.workflowStep, nextUnlocked)));
}

function initWorkflowTabs() {
  state.workflowStep = clampStep(state.workflowStep);
  state.workflowUnlocked = clampStep(state.workflowUnlocked);
  if (state.refreshToken || state.csrfToken) {
    state.workflowUnlocked = Math.max(state.workflowUnlocked, 1);
  }
  if (state.workflowUnlocked < state.workflowStep) {
    state.workflowUnlocked = state.workflowStep;
  }
  document.querySelectorAll("[data-workflow-step]").forEach((button) => {
    button.addEventListener("click", () => {
      setWorkflowStep(button.dataset.workflowStep || "0");
    });
  });
  document.querySelectorAll("[data-next-step]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = clampStep(button.dataset.nextStep || "0");
      unlockWorkflowStep(next);
      setWorkflowStep(next);
    });
  });
  document.querySelectorAll("[data-prev-step]").forEach((button) => {
    button.addEventListener("click", () => {
      const prev = clampStep(button.dataset.prevStep || "0");
      setWorkflowStep(prev);
    });
  });
  localStorage.setItem("burstflare_workflow_unlocked", String(state.workflowUnlocked));
  setWorkflowStep(state.workflowStep);
}

function scrollToWorkflowStep(step) {
  const target = document.querySelector('[data-workflow-panel="' + clampStep(step) + '"]');
  if (target && typeof target.scrollIntoView === "function") {
    target.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
}

async function ensureSignedInForQuickLaunch() {
  if (state.refreshToken || state.csrfToken) {
    return;
  }
  let email = byId("quickEmail").value.trim() || byId("email").value.trim();
  const name = byId("quickName").value.trim() || byId("name").value.trim() || "BurstFlare User";
  if (!email) {
    email = "quick-" + Date.now() + "@example.com";
    byId("quickEmail").value = email;
    byId("email").value = email;
  }
  const turnstileToken = byId("turnstileToken").value.trim();
  if (TURNSTILE_SITE_KEY && !turnstileToken) {
    throw new Error("Complete the verification challenge in Step 1 before quick launch.");
  }

  try {
    const data = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email,
        name,
        ...(turnstileToken ? { turnstileToken } : {})
      })
    });
    setAuth(data.refreshToken, data.csrfToken || "");
    byId("email").value = email;
    byId("name").value = name;
    return;
  } catch (_registerError) {}

  const login = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email,
      kind: "browser",
      ...(turnstileToken ? { turnstileToken } : {})
    })
  });
  setAuth(login.refreshToken, login.csrfToken || "");
  byId("email").value = email;
  byId("name").value = name;
}

async function runQuickLaunch() {
  setQuickStatus("Signing in...");
  await ensureSignedInForQuickLaunch();

  setQuickStatus("Preparing quick-start session...");
  const quickPayload = {};
  const templateName = byId("quickTemplateName").value.trim();
  const sessionName = byId("quickSessionName").value.trim();
  if (templateName) {
    quickPayload.templateName = templateName;
  }
  if (sessionName) {
    quickPayload.sessionName = sessionName;
  }

  const result = await api("/api/quickstart/session", {
    method: "POST",
    body: JSON.stringify(quickPayload)
  });

  byId("templateName").value = result.template.name;
  byId("versionTemplate").value = result.template.id;
  byId("promoteTemplate").value = result.template.id;
  byId("templateVersion").value = result.templateVersion.version;
  byId("promoteVersion").value = result.templateVersion.id;
  byId("sessionName").value = result.session.name;
  byId("sessionTemplate").value = result.template.id;
  byId("snapshotSession").value = result.session.id;
  state.quickPreviewUrl = result.session.previewUrl || "";
  setQuickStatus("Ready. Session " + result.session.id + " is " + result.session.state + ".");
  unlockWorkflowStep(3);
  setWorkflowStep(2);
}

async function triggerQuickLaunch() {
  setError("");
  setWorkflowStep(0);
  scrollToWorkflowStep(0);
  try {
    await runQuickLaunch();
    await refresh();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Quick launch failed";
    setQuickStatus(message);
    setError(message);
  }
}

function setAuth(refreshToken = state.refreshToken, csrfToken = state.csrfToken) {
  state.refreshToken = refreshToken || "";
  state.csrfToken = csrfToken || "";
  if (state.refreshToken) {
    localStorage.setItem("burstflare_refresh_token", state.refreshToken);
  } else {
    localStorage.removeItem("burstflare_refresh_token");
  }
  if (state.csrfToken) {
    localStorage.setItem("burstflare_csrf", state.csrfToken);
  } else {
    localStorage.removeItem("burstflare_csrf");
  }
  if (state.refreshToken || state.csrfToken) {
    unlockWorkflowStep(1);
  }
}

function stopAutoRefresh() {
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
}

function startAutoRefresh() {
  if (state.refreshTimer || (!state.refreshToken && !state.csrfToken)) {
    return;
  }
  state.refreshTimer = setInterval(() => {
    if (state.refreshPending) {
      return;
    }
    state.refreshPending = true;
    refresh().catch((error) => {
      console.error(error);
    }).finally(() => {
      state.refreshPending = false;
    });
  }, 15000);
}

function closeTerminal(message = "Not connected") {
  if (state.terminalSocket) {
    const socket = state.terminalSocket;
    state.terminalSocket = null;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close(1000, "Closed");
    }
  }
  state.terminalSessionId = "";
  setTerminalStatus(message);
}

async function openTerminal(sessionId) {
  closeTerminal("Connecting...");
  setTerminalOutput("Connecting to " + sessionId + "...");
  const data = await api('/api/sessions/' + sessionId + '/ssh-token', { method: 'POST' });
  const url = new URL('/runtime/sessions/' + sessionId + '/terminal?token=' + encodeURIComponent(data.token), window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url.toString());
  state.terminalSocket = socket;
  state.terminalSessionId = sessionId;
  socket.onopen = () => {
    setTerminalStatus('Connected to ' + sessionId);
    appendTerminalOutput('connected');
  };
  socket.onmessage = (event) => {
    appendTerminalOutput(String(event.data ?? ''));
  };
  socket.onerror = () => {
    setTerminalStatus('Terminal connection failed');
    appendTerminalOutput('connection error');
  };
  socket.onclose = () => {
    state.terminalSocket = null;
    setTerminalStatus('Disconnected');
  };
}

function sendTerminalInput() {
  const value = byId("terminalInput").value;
  if (!value) {
    return;
  }
  if (!state.terminalSocket || state.terminalSocket.readyState !== WebSocket.OPEN) {
    throw new Error("Terminal is not connected");
  }
  state.terminalSocket.send(value);
  appendTerminalOutput('> ' + value);
  byId("terminalInput").value = "";
}

async function refreshAuth() {
  if (!state.refreshToken) {
    throw new Error("Authentication expired");
  }
  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ refreshToken: state.refreshToken })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    stopAutoRefresh();
    setAuth("", "");
    throw new Error(data.error || "Authentication expired");
  }
  setAuth(data.refreshToken, data.csrfToken || "");
  return data;
}

async function api(path, options = {}, allowRetry = true) {
  const headers = new Headers(options.headers || {});
  if (!headers.has("content-type") && options.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (["POST", "PUT", "PATCH", "DELETE"].includes((options.method || "GET").toUpperCase()) && state.csrfToken) {
    headers.set("x-burstflare-csrf", state.csrfToken);
  }
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && allowRetry && state.refreshToken) {
    await refreshAuth();
    return api(path, options, false);
  }
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

async function requestRaw(path, options = {}, allowRetry = true) {
  const headers = new Headers(options.headers || {});
  if (["POST", "PUT", "PATCH", "DELETE"].includes((options.method || "GET").toUpperCase()) && state.csrfToken) {
    headers.set("x-burstflare-csrf", state.csrfToken);
  }
  const response = await fetch(path, { ...options, headers });
  if (response.status === 401 && allowRetry && state.refreshToken) {
    await refreshAuth();
    return requestRaw(path, options, false);
  }
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(bodyText || "Request failed");
  }
  return response;
}

async function registerPasskey() {
  if (!isPasskeySupported()) {
    throw new Error("Passkeys are not supported in this browser");
  }
  const start = await api('/api/auth/passkeys/register/start', {
    method: 'POST'
  });
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: base64UrlToBytes(start.publicKey.challenge),
      rp: {
        name: 'BurstFlare',
        id: start.publicKey.rpId
      },
      user: {
        id: base64UrlToBytes(start.publicKey.user.id),
        name: start.publicKey.user.name,
        displayName: start.publicKey.user.displayName
      },
      timeout: start.publicKey.timeoutMs,
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred'
      },
      pubKeyCredParams: start.publicKey.pubKeyCredParams,
      excludeCredentials: (start.publicKey.excludeCredentialIds || []).map((id) => ({
        type: 'public-key',
        id: base64UrlToBytes(id)
      }))
    }
  });
  if (!credential) {
    throw new Error("Passkey registration was cancelled");
  }
  await api('/api/auth/passkeys/register/finish', {
    method: 'POST',
    body: JSON.stringify({
      challengeId: start.challengeId,
      label: byId("name").value || byId("email").value || 'BurstFlare Passkey',
      credential: serializeAttestationCredential(credential)
    })
  });
}

async function loginWithPasskey() {
  if (!isPasskeySupported()) {
    throw new Error("Passkeys are not supported in this browser");
  }
  try {
    const start = await api('/api/auth/passkeys/login/start', {
      method: 'POST',
      body: JSON.stringify({
        email: byId("email").value,
        turnstileToken: byId("turnstileToken").value
      })
    });
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: base64UrlToBytes(start.publicKey.challenge),
        rpId: start.publicKey.rpId,
        timeout: start.publicKey.timeoutMs,
        userVerification: start.publicKey.userVerification || 'preferred',
        allowCredentials: (start.publicKey.allowCredentialIds || []).map((id) => ({
          type: 'public-key',
          id: base64UrlToBytes(id)
        }))
      }
    });
    if (!credential) {
      throw new Error("Passkey login was cancelled");
    }
    const data = await api('/api/auth/passkeys/login/finish', {
      method: 'POST',
      body: JSON.stringify({
        challengeId: start.challengeId,
        credential: serializeAssertionCredential(credential)
      })
    });
    setAuth(data.refreshToken, data.csrfToken || "");
  } finally {
    resetTurnstile();
  }
}

function renderIdentity() {
  byId("identity").textContent = state.me
    ? state.me.user.email + " in " + state.me.workspace.name + " (" + state.me.membership.role + ", " + state.me.workspace.plan + ")"
    : "Not signed in";
  if (state.me) {
    byId("workspaceName").value = state.me.workspace.name;
    setDeviceStatus('Pending device approvals: ' + state.me.pendingDeviceCodes);
    renderPasskeys(state.me.passkeys || []);
    renderPendingDevices(state.me.pendingDevices || []);
  } else {
    setDeviceStatus('Pending device approvals: 0');
    renderPasskeys([]);
    renderPendingDevices([]);
  }
}

function renderMembers(membersData) {
  const members = membersData.members.map((member) => {
    const email = member.user ? member.user.email : member.userId;
    return '<div class="item"><strong>' + email + '</strong><br><span class="muted">' + member.role + '</span></div>';
  });
  const invites = membersData.invites.map((invite) => {
    return '<div class="item"><strong>' + invite.email + '</strong><br><span class="muted">' + invite.role +
      ' / ' + invite.code + '</span></div>';
  });
  const items = members.concat(invites);
  byId("members").innerHTML = items.length ? items.join("") : '<div class="item muted">No members or invites yet.</div>';
}

function renderAuthSessions(authSessions) {
  const items = authSessions.map((session) => {
    const kinds = session.tokenKinds.join(", ");
    const action = session.current
      ? '<span class="pill" style="margin-top:8px">Current</span>'
      : '<button class="secondary" data-auth-session-revoke="' + session.id + '">Revoke</button>';
    return '<div class="item"><strong>' + session.id + '</strong><br><span class="muted">' + session.workspaceId +
      '</span><br><span class="muted">' + kinds + ' / ' + session.tokenCount + ' token(s)</span><br><span class="muted">expires ' +
      session.expiresAt + '</span><div class="row" style="margin-top:8px">' + action + '</div></div>';
  });
  byId("authSessions").innerHTML = items.length ? items.join("") : '<div class="item muted">No active auth sessions.</div>';

  document.querySelectorAll("[data-auth-session-revoke]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm('Revoke this sign-in session?')) {
        return;
      }
      await perform(async () => api('/api/auth/sessions/' + button.dataset.authSessionRevoke, { method: 'DELETE' }));
    });
  });
}

function renderDashboardPulse(counts) {
  const items = [
    {
      label: 'templates',
      value: counts.templates
    },
    {
      label: 'builds',
      value: counts.builds
    },
    {
      label: 'sessions',
      value: counts.sessions
    },
    {
      label: 'snapshots',
      value: counts.snapshots
    }
  ];
  byId("dashboardPulse").innerHTML = items
    .map((item) => '<div class="item"><strong>' + item.value + '</strong><br><span class="muted">' + item.label + '</span></div>')
    .join("");
}

function renderTemplates(templates) {
  const items = templates.map((template) => {
    const active = template.activeVersion ? template.activeVersion.version : "none";
    const versions = template.versions.map((entry) => entry.version + ' (' + entry.status + ')').join(", ") || "no versions";
    const status = template.archivedAt ? 'archived' : 'active';
    const bundleBytes = template.storageSummary ? template.storageSummary.bundleBytes || 0 : 0;
    const stateAction = template.archivedAt
      ? '<button class="secondary" data-template-restore="' + template.id + '">Restore</button>'
      : '<button class="secondary" data-template-archive="' + template.id + '">Archive</button>';
    const inspectAction = '<button class="secondary" data-template-inspect="' + template.id + '">Inspect</button>';
    const deleteAction = '<button class="secondary" data-template-delete="' + template.id + '">Delete</button>';
    return '<div class="item"><strong>' + template.name + '</strong><br><span class="muted">' + template.id +
      '</span><br><span class="muted">status: ' + status + '</span><br><span class="muted">active: ' + active +
      '</span><br><span class="muted">versions: ' + versions + '</span><br><span class="muted">releases: ' + (template.releaseCount || 0) +
      '</span><br><span class="muted">bundle bytes: ' + bundleBytes + '</span><div class="row" style="margin-top:8px">' +
      inspectAction + stateAction + deleteAction + '</div></div>';
  });
  byId("templates").innerHTML = items.length ? items.join("") : '<div class="item muted">No templates yet.</div>';
  if (!items.length) {
    renderTemplateInspector(null);
  }

  document.querySelectorAll("[data-template-inspect]").forEach((button) => {
    button.addEventListener("click", async () => {
      await perform(async () => {
        const detail = await api('/api/templates/' + button.dataset.templateInspect);
        renderTemplateInspector(detail.template);
      });
    });
  });

  document.querySelectorAll("[data-template-archive]").forEach((button) => {
    button.addEventListener("click", async () => {
      await perform(async () => api('/api/templates/' + button.dataset.templateArchive + '/archive', { method: 'POST' }));
    });
  });

  document.querySelectorAll("[data-template-restore]").forEach((button) => {
    button.addEventListener("click", async () => {
      await perform(async () => api('/api/templates/' + button.dataset.templateRestore + '/restore', { method: 'POST' }));
    });
  });

  document.querySelectorAll("[data-template-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm('Delete this template and its stored versions?')) {
        return;
      }
      await perform(async () => api('/api/templates/' + button.dataset.templateDelete, { method: 'DELETE' }));
    });
  });
}

function renderTemplateInspector(template) {
  if (!template) {
    byId("templateInspector").textContent = "Select a template to inspect.";
    return;
  }

  byId("versionTemplate").value = template.id;
  byId("promoteTemplate").value = template.id;

  const lines = [
    'name: ' + template.name,
    'id: ' + template.id,
    'status: ' + (template.archivedAt ? 'archived' : 'active'),
    'activeVersion: ' + (template.activeVersion ? template.activeVersion.version + ' (' + template.activeVersion.id + ')' : 'none'),
    'versions: ' + template.versions.length,
    'releases: ' + (template.releases ? template.releases.length : template.releaseCount || 0),
    'bundleBytes: ' + (template.storageSummary ? template.storageSummary.bundleBytes || 0 : 0),
    'buildArtifactBytes: ' + (template.storageSummary ? template.storageSummary.buildArtifactBytes || 0 : 0),
    'buildSummary: queued=' + (template.buildSummary?.queued || 0) +
      ', building=' + (template.buildSummary?.building || 0) +
      ', succeeded=' + (template.buildSummary?.succeeded || 0) +
      ', failed=' + (template.buildSummary?.failed || 0) +
      ', deadLettered=' + (template.buildSummary?.deadLettered || 0)
  ];

  if (Array.isArray(template.versions) && template.versions.length) {
    lines.push('');
    lines.push('versions:');
    template.versions.forEach((version) => {
      lines.push(
        '- ' + version.version + ' [' + version.id + '] build=' + (version.build?.status || 'none') +
        ' bundle=' + (version.bundleBytes || 0) + ' bytes'
      );
    });
  }

  if (Array.isArray(template.releases) && template.releases.length) {
    lines.push('');
    lines.push('releases:');
    template.releases.forEach((release) => {
      lines.push('- ' + release.id + ' version=' + release.versionId + ' mode=' + release.mode);
    });
  }

  byId("templateInspector").textContent = lines.join("\\n");
}

function renderSessions(sessions) {
  const items = sessions.map((session) => {
    const runtimeMeta = session.runtime
      ? '<br><span class="muted">runtime: ' + session.runtime.status + ' / ' + session.runtime.runtimeState + '</span>'
      : '';
    const restoreMeta = session.lastRestoredSnapshotId
      ? '<br><span class="muted">restored: ' + session.lastRestoredSnapshotId + '</span>'
      : '';
    return '<div class="item"><strong>' + session.name + '</strong><br><span class="muted">' + session.id +
      '</span><br><span class="muted">' + session.templateName + ' / ' + session.state + '</span>' + runtimeMeta + restoreMeta + '<div class="row" style="margin-top:8px">' +
      '<button data-start="' + session.id + '">Start</button>' +
      '<button class="secondary" data-stop="' + session.id + '">Stop</button>' +
      '<button class="secondary" data-restart="' + session.id + '">Restart</button>' +
      '<button class="secondary" data-preview="' + session.previewUrl + '">Preview</button>' +
      '<button class="secondary" data-editor="' + session.id + '">Editor</button>' +
      '<button class="secondary" data-ssh="' + session.id + '">SSH</button>' +
      '<button class="secondary" data-events="' + session.id + '">Events</button>' +
      '<button class="secondary" data-delete="' + session.id + '">Delete</button></div></div>';
  });
  byId("sessions").innerHTML = items.length ? items.join("") : '<div class="item muted">No sessions yet.</div>';
}

function renderSnapshots(snapshots) {
  const items = snapshots.map((snapshot) => {
    return '<div class="item"><strong>' + snapshot.label + '</strong><br><span class="muted">' + snapshot.id +
      '</span><br><span class="muted">' + (snapshot.bytes || 0) + ' bytes</span><div class="row" style="margin-top:8px">' +
      '<button class="secondary" data-snapshot-download="' + snapshot.id + '">View</button>' +
      '<button class="secondary" data-snapshot-restore="' + snapshot.id + '">Restore</button>' +
      '<button class="secondary" data-snapshot-delete="' + snapshot.id + '">Delete</button></div></div>';
  });
  byId("snapshotList").innerHTML = items.length ? items.join("") : '<div class="item muted">No snapshots for this session.</div>';

  document.querySelectorAll("[data-snapshot-download]").forEach((button) => {
    button.addEventListener("click", async () => {
      await perform(async () => {
        const sessionId = byId("snapshotSession").value;
        const response = await requestRaw('/api/sessions/' + sessionId + '/snapshots/' + button.dataset.snapshotDownload + '/content');
        const text = await response.text();
        byId("snapshotContentPreview").textContent = text || "Snapshot content is empty.";
      });
    });
  });

  document.querySelectorAll("[data-snapshot-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      await perform(async () => {
        const sessionId = byId("snapshotSession").value;
        await api('/api/sessions/' + sessionId + '/snapshots/' + button.dataset.snapshotDelete, {
          method: 'DELETE'
        });
      });
    });
  });

  document.querySelectorAll("[data-snapshot-restore]").forEach((button) => {
    button.addEventListener("click", async () => {
      await perform(async () => {
        const sessionId = byId("snapshotSession").value;
        await api('/api/sessions/' + sessionId + '/snapshots/' + button.dataset.snapshotRestore + '/restore', {
          method: 'POST'
        });
      });
    });
  });
}

async function refreshSnapshots() {
  const sessionId = byId("snapshotSession").value;
  if (!sessionId) {
    byId("snapshotList").textContent = "";
    byId("snapshotContentPreview").textContent = "No snapshot content loaded.";
    return;
  }
  const data = await api('/api/sessions/' + sessionId + '/snapshots');
  renderSnapshots(data.snapshots);
}

function clearPanels() {
  byId("deviceCode").value = "";
  byId("workspaceName").value = "";
  byId("persistedPaths").value = "";
  byId("members").textContent = "";
  byId("authSessions").textContent = "";
  byId("pendingDevices").textContent = "";
  byId("dashboardPulse").textContent = "";
  byId("templates").textContent = "";
  byId("builds").textContent = "";
  byId("sessions").textContent = "";
  byId("terminalInput").value = "";
  setTerminalOutput("Waiting for a session attach...");
  closeTerminal();
  byId("snapshotContent").value = "";
  byId("snapshotList").textContent = "";
  byId("snapshotContentPreview").textContent = "No snapshot content loaded.";
  setLastRefresh("");
  setRecoveryCodes();
  renderPasskeys([]);
  resetTurnstile();
  byId("usage").textContent = "";
  byId("report").textContent = "";
  byId("releases").textContent = "";
  byId("audit").textContent = "";
}

function attachSessionButtons() {
  document.querySelectorAll("[data-start]").forEach((button) => {
    button.addEventListener("click", async () => {
      await perform(async () => api('/api/sessions/' + button.dataset.start + '/start', { method: 'POST' }));
    });
  });
  document.querySelectorAll("[data-stop]").forEach((button) => {
    button.addEventListener("click", async () => {
      await perform(async () => api('/api/sessions/' + button.dataset.stop + '/stop', { method: 'POST' }));
    });
  });
  document.querySelectorAll("[data-restart]").forEach((button) => {
    button.addEventListener("click", async () => {
      await perform(async () => api('/api/sessions/' + button.dataset.restart + '/restart', { method: 'POST' }));
    });
  });
  document.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      await perform(async () => api('/api/sessions/' + button.dataset.delete, { method: 'DELETE' }));
    });
  });
  document.querySelectorAll("[data-ssh]").forEach((button) => {
    button.addEventListener("click", async () => {
      await perform(async () => {
        await openTerminal(button.dataset.ssh);
      });
    });
  });
  document.querySelectorAll("[data-preview]").forEach((button) => {
    button.addEventListener("click", () => {
      window.open(button.dataset.preview, "_blank", "noopener");
    });
  });
  document.querySelectorAll("[data-editor]").forEach((button) => {
    button.addEventListener("click", () => {
      window.open('/runtime/sessions/' + button.dataset.editor + '/editor', "_blank", "noopener");
    });
  });
  document.querySelectorAll("[data-events]").forEach((button) => {
    button.addEventListener("click", async () => {
      await perform(async () => {
        const data = await api('/api/sessions/' + button.dataset.events + '/events');
        alert(JSON.stringify(data.events, null, 2));
      });
    });
  });
}

async function refresh() {
  if (!state.refreshToken && !state.csrfToken) {
    return;
  }
  state.me = await api('/api/auth/me');
  startAutoRefresh();
  setLastRefresh(new Date().toLocaleTimeString());
  renderIdentity();
  renderMembers(await api('/api/workspaces/current/members'));
  const authSessions = await api('/api/auth/sessions');
  renderAuthSessions(authSessions.sessions);
  const templates = await api('/api/templates');
  renderTemplates(templates.templates);
  const builds = await api('/api/template-builds');
  byId("builds").textContent = JSON.stringify(builds.builds, null, 2);
  const sessions = await api('/api/sessions');
  renderSessions(sessions.sessions);
  renderDashboardPulse({
    templates: templates.templates.length,
    builds: builds.builds.length,
    sessions: sessions.sessions.length,
    snapshots: sessions.sessions.reduce((sum, entry) => sum + (entry.snapshotCount || 0), 0)
  });
  attachSessionButtons();
  await refreshSnapshots();
  const usage = await api('/api/usage');
  byId("usage").textContent = JSON.stringify(usage, null, 2);
  const report = await api('/api/admin/report');
  byId("report").textContent = JSON.stringify(report.report, null, 2);
  const releases = await api('/api/releases');
  byId("releases").textContent = JSON.stringify(releases.releases, null, 2);
  const audit = await api('/api/audit');
  byId("audit").textContent = JSON.stringify(audit.audit, null, 2);
}

async function perform(action) {
  setError("");
  try {
    await action();
    await refresh();
  } catch (error) {
    console.error(error);
    setError(error.message || "Request failed");
  }
}

byId("registerButton").addEventListener("click", async () => {
  await perform(async () => {
    try {
      const data = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: byId("email").value,
          name: byId("name").value,
          turnstileToken: byId("turnstileToken").value
        })
      });
      setAuth(data.refreshToken, data.csrfToken || "");
    } finally {
      resetTurnstile();
    }
  });
});

byId("loginButton").addEventListener("click", async () => {
  await perform(async () => {
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: byId("email").value,
          kind: 'browser',
          turnstileToken: byId("turnstileToken").value
        })
      });
      setAuth(data.refreshToken, data.csrfToken || "");
    } finally {
      resetTurnstile();
    }
  });
});

byId("passkeyLoginButton").addEventListener("click", async () => {
  await perform(async () => {
    await loginWithPasskey();
  });
});

byId("recoverButton").addEventListener("click", async () => {
  await perform(async () => {
    try {
      const data = await api('/api/auth/recover', {
        method: 'POST',
        body: JSON.stringify({
          email: byId("email").value,
          code: byId("recoveryCode").value,
          turnstileToken: byId("turnstileToken").value
        })
      });
      setAuth(data.refreshToken, data.csrfToken || "");
      byId("recoveryCode").value = "";
    } finally {
      resetTurnstile();
    }
  });
});

byId("logoutButton").addEventListener("click", async () => {
  setError("");
  try {
    if (state.refreshToken) {
      await api('/api/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: state.refreshToken })
      });
    }
  } catch (error) {
    console.error(error);
  } finally {
    stopAutoRefresh();
    setAuth("", "");
    state.me = null;
    renderIdentity();
    clearPanels();
  }
});

byId("recoveryCodesButton").addEventListener("click", async () => {
  await perform(async () => {
    const data = await api('/api/auth/recovery-codes/generate', {
      method: 'POST',
      body: JSON.stringify({})
    });
    setRecoveryCodes(data.recoveryCodes || []);
  });
});

byId("passkeyRegisterButton").addEventListener("click", async () => {
  await perform(async () => {
    await registerPasskey();
  });
});

byId("logoutAllButton").addEventListener("click", async () => {
  setError("");
  try {
    if (state.refreshToken || state.csrfToken) {
      await api('/api/auth/logout-all', {
        method: 'POST'
      });
    }
  } catch (error) {
    console.error(error);
  } finally {
    stopAutoRefresh();
    setAuth("", "");
    state.me = null;
    renderIdentity();
    clearPanels();
  }
});

byId("inviteButton").addEventListener("click", async () => {
  await perform(async () => {
    const data = await api('/api/workspaces/current/invites', {
      method: 'POST',
      body: JSON.stringify({ email: byId("inviteEmail").value, role: byId("inviteRole").value })
    });
    byId("inviteCode").value = data.invite.code;
  });
});

byId("saveWorkspaceButton").addEventListener("click", async () => {
  await perform(async () => {
    await api('/api/workspaces/current/settings', {
      method: 'PATCH',
      body: JSON.stringify({ name: byId("workspaceName").value })
    });
  });
});

byId("membersButton").addEventListener("click", () => perform(async () => {}));

byId("approveDeviceButton").addEventListener("click", async () => {
  await perform(async () => {
    await api('/api/cli/device/approve', {
      method: 'POST',
      body: JSON.stringify({ deviceCode: byId("deviceCode").value })
    });
    byId("deviceCode").value = "";
  });
});

byId("authSessionsButton").addEventListener("click", () => perform(async () => {}));

byId("acceptInviteButton").addEventListener("click", async () => {
  await perform(async () => {
    await api('/api/workspaces/current/invites/accept', {
      method: 'POST',
      body: JSON.stringify({ inviteCode: byId("inviteCode").value })
    });
  });
});

byId("planButton").addEventListener("click", async () => {
  await perform(async () => {
    await api('/api/workspaces/current/plan', {
      method: 'POST',
      body: JSON.stringify({ plan: 'pro' })
    });
  });
});

byId("createTemplateButton").addEventListener("click", async () => {
  await perform(async () => {
    await api('/api/templates', {
      method: 'POST',
      body: JSON.stringify({
        name: byId("templateName").value,
        description: byId("templateDescription").value
      })
    });
    unlockWorkflowStep(2);
  });
});

byId("addVersionButton").addEventListener("click", async () => {
  await perform(async () => {
    await api('/api/templates/' + byId("versionTemplate").value + '/versions', {
      method: 'POST',
      body: JSON.stringify({
        version: byId("templateVersion").value,
        manifest: {
          image: 'registry.cloudflare.com/example/' + byId("versionTemplate").value + ':' + byId("templateVersion").value,
          features: ['ssh', 'browser', 'snapshots'],
          persistedPaths: parsePersistedPaths(byId("persistedPaths").value)
        }
      })
    });
  });
});

byId("processBuildsButton").addEventListener("click", async () => {
  await perform(async () => {
    await api('/api/template-builds/process', { method: 'POST' });
  });
});

byId("listBuildsButton").addEventListener("click", () => perform(async () => {}));

byId("promoteButton").addEventListener("click", async () => {
  await perform(async () => {
    await api('/api/templates/' + byId("promoteTemplate").value + '/promote', {
      method: 'POST',
      body: JSON.stringify({ versionId: byId("promoteVersion").value })
    });
    unlockWorkflowStep(2);
    setWorkflowStep(2);
  });
});

byId("createSessionButton").addEventListener("click", async () => {
  await perform(async () => {
    const data = await api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({
        name: byId("sessionName").value,
        templateId: byId("sessionTemplate").value
      })
    });
    await api('/api/sessions/' + data.session.id + '/start', { method: 'POST' });
    unlockWorkflowStep(3);
    setWorkflowStep(3);
  });
});

byId("quickLaunchButton").addEventListener("click", async () => {
  await triggerQuickLaunch();
});

byId("heroQuickLaunchButton").addEventListener("click", async () => {
  await triggerQuickLaunch();
});

byId("quickOpenPreviewButton").addEventListener("click", () => {
  if (!state.quickPreviewUrl) {
    setQuickStatus("No preview URL yet. Run quick launch first.");
    return;
  }
  window.open(state.quickPreviewUrl, "_blank", "noopener");
});

byId("snapshotButton").addEventListener("click", async () => {
  await perform(async () => {
    const sessionId = byId("snapshotSession").value;
    const created = await api('/api/sessions/' + sessionId + '/snapshots', {
      method: 'POST',
      body: JSON.stringify({ label: byId("snapshotLabel").value || 'manual' })
    });
    const snapshotBody = byId("snapshotContent").value;
    if (snapshotBody) {
      await api('/api/sessions/' + sessionId + '/snapshots/' + created.snapshot.id + '/content', {
        method: 'PUT',
        headers: {
          'content-type': 'text/plain; charset=utf-8'
        },
        body: snapshotBody
      });
      byId("snapshotContentPreview").textContent = snapshotBody;
    }
  });
});

byId("snapshotListButton").addEventListener("click", () => perform(async () => {
  await refreshSnapshots();
}));

byId("refreshButton").addEventListener("click", () => perform(async () => {}));

byId("terminalSendButton").addEventListener("click", async () => {
  await perform(async () => {
    sendTerminalInput();
  });
});

byId("terminalCloseButton").addEventListener("click", () => {
  closeTerminal();
});

byId("terminalInput").addEventListener("keydown", async (event) => {
  if (event.key !== 'Enter') {
    return;
  }
  event.preventDefault();
  await perform(async () => {
    sendTerminalInput();
  });
});

byId("reconcileButton").addEventListener("click", async () => {
  await perform(async () => {
    await api('/api/admin/reconcile', { method: 'POST' });
  });
});

byId("reportButton").addEventListener("click", () => perform(async () => {}));

initWorkflowTabs();
mountTurnstile();

if (state.refreshToken || state.csrfToken) {
  refresh().catch((error) => {
    console.error(error);
    stopAutoRefresh();
    setAuth("", "");
    state.me = null;
    renderIdentity();
    clearPanels();
    setError(error.message || "Could not restore session");
  });
} else {
  renderIdentity();
}
`;
