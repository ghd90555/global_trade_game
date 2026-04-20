const app = document.getElementById("app");
const STORAGE_KEY = "jol-trade-game-session";
const pageParams = new URLSearchParams(window.location.search);

const RESOURCE_LABELS = {
  ivory: "Ivory",
  silver: "Silver",
  porcelain: "Porcelain",
  cowrie: "Cowrie",
  nutmeg: "Nutmeg",
};

const REGION_META = {
  china: {
    title: "China",
    strap: "Porcelain markets and silver routes",
    motif: "Porcelain kilns, harbor ledgers, and maritime exchange",
    className: "region-china",
    image: "/images/china-banner.png",
  },
  europe: {
    title: "Europe",
    strap: "Dynastic houses and chartered ventures",
    motif: "Counting rooms, sea charts, and contract books",
    className: "region-europe",
    image: "/images/europe-banner.png",
  },
  southeastAsia: {
    title: "Southeast Asia",
    strap: "Spice islands and island port networks",
    motif: "Nutmeg groves, island waters, and coastal trade winds",
    className: "region-southeast-asia",
    image: "/images/southeast-asia-banner.png",
  },
  westAfrica: {
    title: "West Africa",
    strap: "Ivory routes and coastal exchange",
    motif: "Atlantic coastlines, caravan pathways, and port brokers",
    className: "region-west-africa",
    image: "/images/west-africa-banner.png",
  },
};

const state = {
  bootstrap: null,
  session: loadSession(),
  view: null,
  error: "",
  actionMessage: "",
  selectedLobbyId: "lobby-1",
  tradeDrafts: {},
  interactionLock: false,
  seenNotificationIds: {},
  notificationQueue: [],
  pageMode: pageParams.get("mode") === "admin" ? "admin" : "default",
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error(text);
    }
  }
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

function saveSession(session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function loadSession() {
  const tokenFromUrl = pageParams.get("token");
  if (tokenFromUrl) {
    return { token: tokenFromUrl };
  }
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch (error) {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
  state.session = null;
  state.view = null;
}

function formatTime(endTime) {
  if (!endTime) return "05:00";
  const secondsLeft = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
  const minutes = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const seconds = String(secondsLeft % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function resourceCards(inventory) {
  return Object.entries(RESOURCE_LABELS)
    .map(
      ([key, label]) => `
        <div class="resource-card">
          <strong>${label}</strong>
          <div>${inventory[key]}</div>
        </div>
      `
    )
    .join("");
}

function valueCards(values) {
  return Object.entries(RESOURCE_LABELS)
    .map(
      ([key, label]) => `
        <div class="resource-card">
          <strong>${label}</strong>
          <div>${values[key]} pts</div>
        </div>
      `
    )
    .join("");
}

function resultLabel(rank) {
  return { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th" }[rank] || `${rank}th`;
}

function imagePanelStyle(imageUrl, overlay) {
  return `style="background-image: ${overlay}, url('${imageUrl}')"`;
}

async function refreshBootstrap() {
  state.bootstrap = await api("/api/bootstrap");
}

async function refreshView() {
  if (!state.session) return;
  const nextView = await api(`/api/state?token=${encodeURIComponent(state.session.token)}`);
  queueNotifications(nextView);
  state.view = nextView;
}

async function poll() {
  try {
    await refreshBootstrap();
    if (state.session) {
      await refreshView();
    }
    state.error = "";
  } catch (error) {
    state.error = error.message;
    if (error.message === "Session not found.") {
      clearSession();
    }
  }
  if (!shouldDeferRender()) {
    render();
  }
}

function lobbyOptions() {
  return state.bootstrap.lobbies
    .map(
      (lobby) => `
        <option value="${lobby.id}" ${lobby.id === state.selectedLobbyId ? "selected" : ""}>
          ${lobby.name}
        </option>
      `
    )
    .join("");
}

function nationSelectionCards() {
  const lobby = state.bootstrap.lobbies.find((entry) => entry.id === state.selectedLobbyId);
  if (!lobby) return "";
  return lobby.nations
    .map(
      (nation) => {
        const meta = REGION_META[nation.id];
        return `
        <div class="nation-card nation-card-themed ${meta.className}">
          <div class="region-banner">
            <div>
          <strong>${nation.name}</strong>
              <div class="small">${meta.strap}</div>
            </div>
            <span class="region-seal">${nation.name.split(" ")[0]}</span>
          </div>
          <div class="region-illustration" ${imagePanelStyle(meta.image, "linear-gradient(180deg, rgba(14, 11, 6, 0.08), rgba(14, 11, 6, 0.38))")}>
            <div class="region-illustration-title">${meta.title}</div>
            <div class="small">${meta.motif}</div>
          </div>
          <div class="chip-row">
            <span class="claim-pill ${nation.claimed ? "claimed" : ""}">
              ${nation.claimed ? "Taken" : "Available"}
            </span>
          </div>
          <div class="small">One device per region in this lobby.</div>
          <div class="inline-actions">
            <button ${nation.claimed ? "disabled" : ""} onclick="joinNation('${nation.id}')">Join ${nation.name}</button>
          </div>
        </div>
      `;
      }
    )
    .join("");
}

function renderLanding() {
  app.innerHTML = `
    <div class="shell stack">
      <section class="hero">
        <div class="scroll-banner"></div>
        <div class="eyebrow">History Class Trade Simulation</div>
        <h1>Global Trade Game</h1>
      </section>

      <section class="grid-2">
        <div class="panel stack">
          <h2>Host / Projector</h2>
          <div class="small">Open this on the classroom computer to control a lobby and project the timer, event text, and final rankings.</div>
          <label>
            Lobby
            <select id="host-lobby-select">${lobbyOptions()}</select>
          </label>
          <div class="actions">
            <button onclick="joinHost()">Open Host Screen</button>
          </div>
        </div>

        <div class="panel stack">
          <h2>Student Join</h2>
          <div class="small">Students can open the same link, choose the lobby, and claim one region for their group.</div>
          <label>
            Lobby
            <select id="student-lobby-select">${lobbyOptions()}</select>
          </label>
          <div class="grid-2">
            ${nationSelectionCards()}
          </div>
        </div>
      </section>
    </div>
    ${renderModal()}
  `;
}

function renderHost() {
  const { lobby } = state.view;
  app.innerHTML = `
    <div class="shell stack">
      <section class="hero">
        <div class="scroll-banner"></div>
        <div class="eyebrow">Host / Projector</div>
        <h1>${lobby.name}</h1>
        <div class="actions">
          <button class="secondary" onclick="leaveSession()">Leave host view</button>
          <button onclick="hostAction('startRound')" ${lobby.state === "round-active" || lobby.state === "game-over" || lobby.state === "awaiting-results" ? "disabled" : ""}>
            ${lobby.round === 0 ? "Start Round 1" : lobby.round < lobby.totalRounds ? `Start Round ${lobby.round + 1}` : "All rounds complete"}
          </button>
          <button class="danger" onclick="hostAction('endRoundNow')" ${lobby.state === "round-active" ? "" : "disabled"}>
            End Round Now
          </button>
          <button class="secondary" onclick="hostAction('resetLobby')">Reset Lobby</button>
          <button onclick="hostAction('showResults')" ${lobby.state === "awaiting-results" ? "" : "disabled"}>
            Show Results
          </button>
        </div>
      </section>

      <section class="projector">
        <div class="projector-main projector-main-wide">
          <div class="projector-stage projector-stage-wide">
            <div class="scroll-banner scroll-banner-projector"></div>
            <span class="tag">${lobby.state === "round-active" ? `Round ${lobby.round} in progress` : lobby.state === "game-over" ? "Game complete" : lobby.round === 0 ? "Waiting to begin" : `Round ${lobby.round} complete`}</span>
            <div class="projector-overline">Commercial Office Ledger</div>
            <div class="timer">${formatTime(lobby.roundEndsAt)}</div>
            <div>
              <h2>${lobby.currentEvent ? lobby.currentEvent.title : "No current event"}</h2>
              <div>${lobby.currentEvent ? lobby.currentEvent.description : "Start the first round when the class is ready."}</div>
            </div>
          </div>
        </div>
      </section>
      ${
        lobby.resultsShown
          ? `
            <section class="panel stack">
              <h2>Final Rankings</h2>
              ${renderRankings(state.view.results)}
            </section>
          `
          : ""
      }
    </div>
    ${renderModal()}
  `;
}

function renderAdmin() {
  const { lobby, teams, settingsDraft, trades, results } = state.view;
  app.innerHTML = `
    <div class="shell stack">
      <section class="hero">
        <div class="scroll-banner"></div>
        <div class="eyebrow">Teacher Admin</div>
        <h1>${lobby.name}</h1>
        <div class="meta">Private controls and game state for the teacher only.</div>
        <div class="actions">
          <button class="secondary" onclick="leaveSession()">Leave admin view</button>
          <button onclick="hostAction('startRound')" ${lobby.state === "round-active" || lobby.state === "game-over" || lobby.state === "awaiting-results" ? "disabled" : ""}>
            ${lobby.round === 0 ? "Start Round 1" : lobby.round < lobby.totalRounds ? `Start Round ${lobby.round + 1}` : "All rounds complete"}
          </button>
          <button class="secondary" onclick="hostAction('resetLobby')">Reset Lobby</button>
          <button onclick="hostAction('showResults')" ${lobby.state === "awaiting-results" ? "" : "disabled"}>Show Results</button>
          <button class="secondary" onclick="openProjectorView()">Open Projector View</button>
        </div>
      </section>

      <section class="grid-2">
        <div class="panel stack">
          <h2>Admin Settings</h2>
          <div class="small">Updating these starting inventories resets the selected lobby so you can rebalance before a run.</div>
          ${renderSettingsForm(settingsDraft)}
        </div>

        <div class="panel stack">
          <h2>Lobby Snapshot</h2>
          <div class="grid-2">
            ${teams
              .map(
                (team) => `
                  <div class="nation-card">
                    <div class="region-banner ${REGION_META[team.id].className}">
                      <div>
                    <strong>${team.name}</strong>
                        <div class="small">${REGION_META[team.id].strap}</div>
                      </div>
                      <span class="region-seal">${team.name.split(" ")[0]}</span>
                    </div>
                    <div class="region-illustration" ${imagePanelStyle(REGION_META[team.id].image, "linear-gradient(180deg, rgba(14, 11, 6, 0.08), rgba(14, 11, 6, 0.38))")}>
                      <div class="region-illustration-title">${REGION_META[team.id].title}</div>
                      <div class="small">${REGION_META[team.id].motif}</div>
                    </div>
                    <div class="small">${team.goal}</div>
                    <div class="score-banner">Live score ${team.points}</div>
                    <div class="resource-grid">${resourceCards(team.inventory)}</div>
                  </div>
                `
              )
              .join("")}
          </div>
        </div>
      </section>

      <section class="grid-2">
        <div class="panel stack">
          <h2>Trades</h2>
          ${trades.length ? trades.slice().reverse().map(renderTradeCard).join("") : `<div class="empty">No trades yet.</div>`}
        </div>
        <div class="panel stack">
          <h2>Results</h2>
          ${
            results
              ? renderRankings(results)
              : `<div class="empty">Results will appear here when the game ends.</div>`
          }
        </div>
      </section>
    </div>
    ${renderModal()}
  `;
  hydrateSettingsForm(settingsDraft);
}

function renderSettingsForm(settingsDraft) {
  const teamFields = Object.entries(settingsDraft.teamInventories)
    .map(
      ([teamId, inventory]) => `
        <div class="trade-side">
          <h3>${labelNation(teamId)}</h3>
          ${Object.entries(RESOURCE_LABELS)
            .map(
              ([resourceKey, label]) => `
                <div class="field-row">
                  <label for="settings-${teamId}-${resourceKey}">${label}</label>
                  <input id="settings-${teamId}-${resourceKey}" class="numeric-input" type="text" inputmode="numeric" pattern="[0-9]*" value="${inventory[resourceKey]}" />
                </div>
              `
            )
            .join("")}
        </div>
      `
    )
    .join("");

  return `
    <div class="grid-2">${teamFields}</div>
    <div class="actions">
      <button onclick="saveSettings()">Save Settings And Reset Lobby</button>
    </div>
  `;
}

function renderRankings(results) {
  return results
    .map(
      (result) => `
        <div class="result-card ${result.rank === 1 ? "success" : ""}">
          <strong>${resultLabel(result.rank)}: ${result.nationName}</strong>
          <div>${result.points} points</div>
        </div>
      `
    )
    .join("");
}

function renderTradeCard(trade) {
  return `
    <div class="trade-card ${trade.status === "awaiting_europe" ? "awaiting" : ""}">
      <strong>${labelNation(trade.fromNationId)} to ${labelNation(trade.toNationId)}</strong>
      <div class="small">Status: ${formatTradeStatus(trade.status)}</div>
      <div class="trade-grid">
        <div class="trade-side">
          <h4>${labelNation(trade.fromNationId)} gives</h4>
          ${tradeLines(trade.offer.from)}
        </div>
        <div class="trade-side">
          <h4>${labelNation(trade.toNationId)} gives</h4>
          ${tradeLines(trade.offer.to)}
        </div>
      </div>
    </div>
  `;
}

function tradeLines(side) {
  return Object.entries(RESOURCE_LABELS)
    .map(
      ([key, label]) => `
        <div class="trade-line">
          <span>${label}</span>
          <span>${side[key]}</span>
        </div>
      `
    )
    .join("");
}

function formatTradeStatus(status) {
  return {
    pending: "Pending",
    rejected: "Rejected",
    accepted: "Accepted",
    awaiting_europe: "Waiting for Europe",
    blocked: "Blocked by Europe",
    expired: "Expired at round end",
  }[status] || status;
}

function labelNation(nationId) {
  const labels = {
    southeastAsia: "Southeast Asia",
    china: "China",
    westAfrica: "West Africa",
    europe: "Europe",
  };
  return labels[nationId] || nationId;
}

function renderTeam() {
  const { lobby, team, nations, pendingIncoming, pendingOutgoing, approvalQueue, gameResult } = state.view;
  const activeDraft = state.tradeDrafts[team.id]?.target || nations[0]?.id || "";
  const region = REGION_META[team.id];
  app.innerHTML = `
    <div class="shell stack">
      <section class="hero hero-region ${region.className}">
        <div class="hero-region-grid">
          <div class="hero-region-copy">
            <div class="scroll-banner"></div>
            <div class="eyebrow">${lobby.name}</div>
            <h1>${team.name}</h1>
            <div class="meta">${team.goal}</div>
            <div class="actions">
              <button class="secondary" onclick="leaveSession()">Leave team view</button>
              <span class="status-pill">
                ${lobby.state === "round-active" ? `Round ${lobby.round} live` : lobby.state === "game-over" ? "Game complete" : lobby.state === "awaiting-results" ? "Waiting for results" : lobby.round === 0 ? "Waiting for host" : `Waiting for round ${lobby.round + 1}`}
              </span>
              <span class="status-pill">Timer ${formatTime(lobby.roundEndsAt)}</span>
              <span class="status-pill">Live score ${team.points}</span>
            </div>
          </div>
          <div class="hero-region-art" ${imagePanelStyle(region.image, "linear-gradient(180deg, rgba(12, 8, 3, 0.1), rgba(12, 8, 3, 0.42))")}>
            <div class="hero-region-title">${region.strap}</div>
            <div class="small">${region.motif}</div>
          </div>
        </div>
      </section>

      <section class="grid-2">
        <div class="panel stack">
          <h2>Your Resources</h2>
          <div class="score-banner">Current total ${team.points} points</div>
          <div class="resource-grid">${resourceCards(team.inventory)}</div>
        </div>
        <div class="panel stack">
          <h2>Your Value Table</h2>
          <div class="resource-grid">${valueCards(team.values)}</div>
          <div class="small">${lobby.currentEvent ? `${lobby.currentEvent.title}: ${lobby.currentEvent.description}` : "No event is active yet."}</div>
        </div>
      </section>

      ${
        gameResult
          ? `
            <section class="panel stack">
              <h2>End Of Game</h2>
              ${gameResult
                .map(
                  (result) => `
                    <div class="result-card ${result.rank === 1 ? "success" : ""}">
                      <strong>${resultLabel(result.rank)}: ${result.nationName}</strong>
                      <div>${result.points} points</div>
                    </div>
                  `
                )
                .join("")}
            </section>
          `
          : `
            <section class="grid-2">
              <div class="panel stack">
                <h2>Propose A Trade</h2>
                ${
                  lobby.canTrade
                    ? `
                      <label>
                        Trade with
                        <select id="trade-target" onchange="changeTradeTarget(this.value)">
                          ${nations
                            .map(
                              (nation) => `
                                <option value="${nation.id}" ${nation.id === activeDraft ? "selected" : ""}>${nation.name}</option>
                              `
                            )
                            .join("")}
                        </select>
                      </label>
                      ${renderTradeForm(team, activeDraft)}
                    `
                    : `<div class="empty">Trades are frozen until the host starts the round.</div>`
                }
              </div>

              <div class="panel stack">
                <h2>Incoming Offers</h2>
                ${
                  pendingIncoming.length
                    ? pendingIncoming.map((trade) => renderIncomingTrade(trade, team.id)).join("")
                    : `<div class="empty">No pending offers right now.</div>`
                }
                ${
                  team.id === "europe"
                    ? `
                      <h3>Europe Approval Queue</h3>
                      ${
                        approvalQueue.length
                          ? approvalQueue.map(renderEuropeTrade).join("")
                          : `<div class="empty">No trades waiting for Europe.</div>`
                      }
                    `
                    : ""
                }
              </div>
            </section>

            <section class="panel stack">
              <h2>Your Pending Offers</h2>
              ${
                pendingOutgoing.length
                  ? pendingOutgoing.map(renderTradeCard).join("")
                  : `<div class="empty">You have no pending outgoing offers.</div>`
              }
            </section>
          `
      }
    </div>
    ${renderModal()}
  `;
  hydrateTradeForm(team, activeDraft, nations);
}

function renderModal() {
  const message = state.actionMessage || state.error;
  if (!message) return "";
  return `
    <div class="modal-backdrop" onclick="closeModal()">
      <div class="modal-card" onclick="event.stopPropagation()">
        <h2>Notice</h2>
        <div class="modal-message">${message}</div>
        <div class="actions">
          <button onclick="closeModal()">Close</button>
        </div>
      </div>
    </div>
  `;
}

function queueNotifications(view) {
  if (!view || view.role !== "team" || !Array.isArray(view.notifications)) {
    return;
  }
  for (const notification of view.notifications) {
    if (state.seenNotificationIds[notification.id]) {
      continue;
    }
    state.seenNotificationIds[notification.id] = true;
    state.notificationQueue.push(notification.message);
  }
  if (!state.actionMessage && !state.error && state.notificationQueue.length) {
    state.actionMessage = state.notificationQueue.shift();
  }
}

function captureFocusedInputState() {
  const active = document.activeElement;
  if (!active || !active.id) {
    return null;
  }
  const tag = active.tagName;
  if (tag !== "INPUT" && tag !== "TEXTAREA") {
    return null;
  }
  return {
    id: active.id,
    selectionStart: active.selectionStart,
    selectionEnd: active.selectionEnd,
  };
}

function restoreFocusedInputState(snapshot) {
  if (!snapshot) {
    return;
  }
  const next = document.getElementById(snapshot.id);
  if (!next) {
    return;
  }
  next.focus();
  if (typeof snapshot.selectionStart === "number" && typeof snapshot.selectionEnd === "number") {
    next.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
  }
}

function shouldDeferRender() {
  return document.activeElement?.tagName === "SELECT";
}

function renderTradeForm(team, targetId) {
  const draft = getTradeDraft(team.id, targetId);
  return `
    <div class="trade-grid">
      <div class="trade-side">
        <h3>${team.name} gives</h3>
        ${Object.entries(RESOURCE_LABELS)
          .map(
            ([key, label]) => `
              <div class="field-row">
                <label for="from-${key}">${label} <span class="small">(max ${team.inventory[key]})</span></label>
                <input id="from-${key}" class="numeric-input" type="text" inputmode="numeric" pattern="[0-9]*" value="${draft.from[key]}" />
              </div>
            `
          )
          .join("")}
      </div>
      <div class="trade-side">
        <h3>${labelNation(targetId)} gives</h3>
        ${Object.entries(RESOURCE_LABELS)
          .map(
            ([key, label]) => `
              <div class="field-row">
                <label for="to-${key}">${label}</label>
                <input id="to-${key}" class="numeric-input" type="text" inputmode="numeric" pattern="[0-9]*" value="${draft.to[key]}" />
              </div>
            `
          )
          .join("")}
      </div>
    </div>
    <div class="actions">
      <button onpointerdown="submitTrade('${targetId}'); return false;" onclick="return false;">Send Offer</button>
    </div>
  `;
}

function renderIncomingTrade(trade, nationId) {
  return `
    <div class="trade-card">
      <strong>${labelNation(trade.fromNationId)} wants to trade with you</strong>
      <div class="trade-grid">
        <div class="trade-side">
          <h4>${labelNation(trade.fromNationId)} gives</h4>
          ${tradeLines(trade.offer.from)}
        </div>
        <div class="trade-side">
          <h4>${labelNation(nationId)} gives</h4>
          ${tradeLines(trade.offer.to)}
        </div>
      </div>
      <div class="inline-actions">
        <button onclick="respondTrade('${trade.id}', 'accept')">Accept</button>
        <button class="secondary" onclick="respondTrade('${trade.id}', 'reject')">Reject</button>
      </div>
    </div>
  `;
}

function renderEuropeTrade(trade) {
  return `
    <div class="trade-card awaiting">
      <strong>${labelNation(trade.fromNationId)} and ${labelNation(trade.toNationId)} need Europe to decide</strong>
      <div class="trade-grid">
        <div class="trade-side">
          <h4>${labelNation(trade.fromNationId)} gives</h4>
          ${tradeLines(trade.offer.from)}
        </div>
        <div class="trade-side">
          <h4>${labelNation(trade.toNationId)} gives</h4>
          ${tradeLines(trade.offer.to)}
        </div>
      </div>
      <div class="inline-actions">
        <button onclick="europeDecision('${trade.id}', 'approve')">Approve</button>
        <button class="danger" onclick="europeDecision('${trade.id}', 'block')">Block This Trade</button>
      </div>
    </div>
  `;
}

function render() {
  const focusSnapshot = captureFocusedInputState();
  if (!state.bootstrap) {
    app.innerHTML = `<div class="shell"><div class="panel">Loading…</div></div>`;
    restoreFocusedInputState(focusSnapshot);
    return;
  }
  if (!state.session || !state.view) {
    renderLanding();
    restoreFocusedInputState(focusSnapshot);
    return;
  }
  if (state.view.role === "host") {
    if (state.pageMode === "admin") {
      renderAdmin();
      restoreFocusedInputState(focusSnapshot);
      return;
    }
    renderHost();
    restoreFocusedInputState(focusSnapshot);
    return;
  }
  renderTeam();
  restoreFocusedInputState(focusSnapshot);
}

function getTradeDraft(teamId, targetId) {
  const defaults = {
    target: targetId,
    from: { ivory: 0, silver: 0, porcelain: 0, cowrie: 0, nutmeg: 0 },
    to: { ivory: 0, silver: 0, porcelain: 0, cowrie: 0, nutmeg: 0 },
  };
  const current = state.tradeDrafts[teamId];
  if (!current || current.target !== targetId) {
    state.tradeDrafts[teamId] = defaults;
  }
  return state.tradeDrafts[teamId];
}

function hydrateTradeForm(team, targetId) {
  const draft = getTradeDraft(team.id, targetId);
  for (const key of Object.keys(RESOURCE_LABELS)) {
    const fromInput = document.getElementById(`from-${key}`);
    const toInput = document.getElementById(`to-${key}`);
    if (fromInput) {
      fromInput.addEventListener("input", (event) => {
        const value = Math.max(
          0,
          Math.min(team.inventory[key], parseInt(String(event.target.value).replace(/[^\d]/g, "") || "0", 10) || 0)
        );
        draft.from[key] = value;
        event.target.value = value;
      });
    }
    if (toInput) {
      toInput.addEventListener("input", (event) => {
        const value = Math.max(
          0,
          parseInt(String(event.target.value).replace(/[^\d]/g, "") || "0", 10) || 0
        );
        draft.to[key] = value;
        event.target.value = value;
      });
    }
  }
}

function hydrateSettingsForm(settingsDraft) {
  if (!settingsDraft) return;
  state.pendingSettings = JSON.parse(JSON.stringify(settingsDraft));
  for (const [teamId, inventory] of Object.entries(settingsDraft.teamInventories)) {
    for (const key of Object.keys(inventory)) {
      const input = document.getElementById(`settings-${teamId}-${key}`);
    if (!input) continue;
    input.addEventListener("input", (event) => {
      state.pendingSettings.teamInventories[teamId][key] = Math.max(
        0,
        parseInt(String(event.target.value).replace(/[^\d]/g, "") || "0", 10) || 0
      );
      event.target.value = state.pendingSettings.teamInventories[teamId][key];
    });
  }
  }
}

async function joinHost() {
  state.actionMessage = "";
  state.error = "";
  const select = document.getElementById("host-lobby-select");
  state.selectedLobbyId = select.value;
  const payload = await api("/api/session/host", {
    method: "POST",
    body: { lobbyId: state.selectedLobbyId },
  });
  state.session = { token: payload.token, role: "host" };
  saveSession(state.session);
  await poll();
}

async function joinNation(nationId) {
  state.actionMessage = "";
  state.error = "";
  const select = document.getElementById("student-lobby-select");
  state.selectedLobbyId = select.value;
  const payload = await api("/api/session/join", {
    method: "POST",
    body: { lobbyId: state.selectedLobbyId, nationId },
  });
  state.session = { token: payload.token, role: "team" };
  saveSession(state.session);
  await poll();
}

async function hostAction(action) {
  state.actionMessage = "";
  state.error = "";
  try {
    await api("/api/host/action", {
      method: "POST",
      body: { token: state.session.token, action },
    });
  } catch (error) {
    state.actionMessage = error.message;
    render();
    return;
  }
  await poll();
}

async function saveSettings() {
  state.actionMessage = "";
  state.error = "";
  try {
    await api("/api/host/action", {
      method: "POST",
      body: {
        token: state.session.token,
        action: "updateSettings",
        settings: state.pendingSettings,
      },
    });
  } catch (error) {
    state.actionMessage = error.message;
    render();
    return;
  }
  await poll();
}

function changeTradeTarget(targetId) {
  const teamId = state.view.team.id;
  state.tradeDrafts[teamId] = getTradeDraft(teamId, targetId);
  state.tradeDrafts[teamId].target = targetId;
  render();
}

async function submitTrade(targetId) {
  const teamId = state.view.team.id;
  const draft = getTradeDraft(teamId, targetId);
  state.actionMessage = "";
  try {
    await api("/api/trades/propose", {
      method: "POST",
      body: {
        token: state.session.token,
        toNationId: targetId,
        offer: draft,
      },
    });
  } catch (error) {
    state.actionMessage = error.message;
    render();
    return;
  }
  state.tradeDrafts[teamId] = {
    target: targetId,
    from: { ivory: 0, silver: 0, porcelain: 0, cowrie: 0, nutmeg: 0 },
    to: { ivory: 0, silver: 0, porcelain: 0, cowrie: 0, nutmeg: 0 },
  };
  await poll();
}

async function respondTrade(tradeId, decision) {
  state.actionMessage = "";
  try {
    await api("/api/trades/respond", {
      method: "POST",
      body: { token: state.session.token, tradeId, decision },
    });
  } catch (error) {
    state.actionMessage = error.message;
    render();
    return;
  }
  await poll();
}

async function europeDecision(tradeId, decision) {
  state.actionMessage = "";
  try {
    await api("/api/trades/europe", {
      method: "POST",
      body: { token: state.session.token, tradeId, decision },
    });
  } catch (error) {
    state.actionMessage = error.message;
    render();
    return;
  }
  await poll();
}

async function leaveSession() {
  const token = state.session?.token;
  state.actionMessage = "";
  state.error = "";
  clearSession();
  if (token) {
    try {
      await api("/api/session/logout", {
        method: "POST",
        body: { token },
      });
    } catch (error) {
      console.error(error);
    }
  }
  await poll();
}

function openProjectorView() {
  window.location.href = `${window.location.origin}?token=${encodeURIComponent(state.session.token)}`;
}

function closeModal() {
  if (state.actionMessage) {
    state.actionMessage = state.notificationQueue.shift() || "";
  }
  state.error = "";
  render();
}

document.addEventListener("change", (event) => {
  if (event.target.id === "host-lobby-select" || event.target.id === "student-lobby-select") {
    state.selectedLobbyId = event.target.value;
  }
});

document.addEventListener("focusin", (event) => {
  const tag = event.target.tagName;
  if (tag === "SELECT") {
    state.interactionLock = true;
  }
});

document.addEventListener("focusout", () => {
  setTimeout(() => {
    state.interactionLock = document.activeElement?.tagName === "SELECT";
    if (!shouldDeferRender()) {
      render();
    }
  }, 0);
});

setInterval(() => {
  if (
    !shouldDeferRender() &&
    state.view &&
    state.view.lobby &&
    state.view.lobby.roundEndsAt
  ) {
    render();
  }
}, 500);

setInterval(poll, 1500);
poll();
