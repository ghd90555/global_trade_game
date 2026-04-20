const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = path.join(__dirname, "public");

const RESOURCE_KEYS = ["ivory", "silver", "porcelain", "cowrie", "nutmeg"];
const TRADE_KEYS = RESOURCE_KEYS;
const GOODS_KEYS = RESOURCE_KEYS;
const LOBBY_IDS = ["lobby-1", "lobby-2", "lobby-3", "lobby-4", "lobby-5"];
const LOBBY_NAMES = {
  "lobby-1": "Rosa",
  "lobby-2": "Lucy",
  "lobby-3": "Kathleen",
  "lobby-4": "Jessica",
  "lobby-5": "Emma",
};

const TEAM_VALUES = {
  china: {
    porcelain: 5,
    nutmeg: 8,
    silver: 10,
    ivory: 8,
    cowrie: 1,
  },
  europe: {
    nutmeg: 10,
    porcelain: 8,
    ivory: 8,
    silver: 5,
    cowrie: 1,
  },
  southeastAsia: {
    nutmeg: 4,
    silver: 10,
    cowrie: 1,
    ivory: 4,
    porcelain: 8,
  },
  westAfrica: {
    cowrie: 10,
    ivory: 2,
    porcelain: 5,
    silver: 0,
    nutmeg: 2,
  },
};

const ENDGAME_VALUES = {
  silver: 8,
  nutmeg: 10,
  porcelain: 5,
  ivory: 7,
  cowrie: 0.5,
};

const DEFAULT_TEAMS = {
  southeastAsia: {
    id: "southeastAsia",
    name: "Southeast Asia",
    goal:
      "Build the strongest position through trade and maximize your total score.",
    inventory: {
      ivory: 5,
      silver: 0,
      porcelain: 0,
      cowrie: 20,
      nutmeg: 10,
    },
  },
  china: {
    id: "china",
    name: "China",
    goal: "Build the strongest position through trade and maximize your total score.",
    inventory: {
      ivory: 0,
      silver: 0,
      porcelain: 10,
      cowrie: 5,
      nutmeg: 0,
    },
  },
  westAfrica: {
    id: "westAfrica",
    name: "West Africa",
    goal: "Build the strongest position through trade and maximize your total score.",
    inventory: {
      ivory: 10,
      silver: 0,
      porcelain: 0,
      cowrie: 10,
      nutmeg: 0,
    },
  },
  europe: {
    id: "europe",
    name: "Europe",
    goal: "Build the strongest position through trade and maximize your total score.",
    inventory: {
      ivory: 0,
      silver: 10,
      porcelain: 0,
      cowrie: 20,
      nutmeg: 0,
    },
  },
};

const sessions = new Map();
const lobbies = new Map();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createLobby(id) {
  const teamNotifications = Object.fromEntries(
    Object.keys(DEFAULT_TEAMS).map((teamId) => [teamId, []])
  );
  return {
    id,
    name: LOBBY_NAMES[id],
    state: "lobby",
    round: 0,
    totalRounds: 3,
    roundDurationSeconds: 300,
    roundEndsAt: null,
    teams: clone(DEFAULT_TEAMS),
    currentEvent: currentEventForRound(0),
    settingsDraft: {
      teamInventories: clone(
        Object.fromEntries(
          Object.entries(DEFAULT_TEAMS).map(([teamId, team]) => [teamId, team.inventory])
        )
      ),
    },
    trades: [],
    nextTradeId: 1,
    notifications: teamNotifications,
    nextNotificationId: 1,
    europeBlockUsedInRound: false,
    resultsShown: false,
    finalResults: null,
    updatedAt: Date.now(),
  };
}

for (const id of LOBBY_IDS) {
  lobbies.set(id, createLobby(id));
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Request body too large."));
      }
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(new Error("Invalid JSON body."));
      }
    });
  });
}

function getSession(reqUrl) {
  const token = reqUrl.searchParams.get("token");
  if (!token || !sessions.has(token)) {
    return null;
  }
  return sessions.get(token);
}

function getLobby(lobbyId) {
  if (!lobbies.has(lobbyId)) {
    throw new Error("Unknown lobby.");
  }
  return lobbies.get(lobbyId);
}

function markUpdated(lobby) {
  lobby.updatedAt = Date.now();
}

function summarizeLobby(lobby) {
  return {
    id: lobby.id,
    name: lobby.name,
    state: lobby.state,
    round: lobby.round,
    updatedAt: lobby.updatedAt,
    nations: Object.values(lobby.teams).map((team) => ({
      id: team.id,
      name: team.name,
      claimed: sessionsClaimLobbyNation(lobby.id, team.id),
    })),
  };
}

function sessionsClaimLobbyNation(lobbyId, nationId) {
  for (const session of sessions.values()) {
    if (
      session.lobbyId === lobbyId &&
      session.role === "team" &&
      session.nationId === nationId
    ) {
      return true;
    }
  }
  return false;
}

function publicTrade(trade) {
  return {
    id: trade.id,
    lobbyId: trade.lobbyId,
    fromNationId: trade.fromNationId,
    toNationId: trade.toNationId,
    offer: trade.offer,
    status: trade.status,
    createdAt: trade.createdAt,
    respondedAt: trade.respondedAt || null,
    settledAt: trade.settledAt || null,
  };
}

function currentEventForRound(round) {
  if (round === 2) {
    return {
      round,
      title: "Spice Boom",
      description: "Nutmeg values increase by 5 points for every region in round 2.",
    };
  }
  if (round === 3) {
    return {
      round,
      title: "VOC Monopoly",
      description:
        "Europe forces Southeast Asia to sell their Nutmeg. Southeast Asia's nutmeg value drops to 0. Southeast Asia can only trade Nutmeg with Europe. Every accepted trade must be approved or rejected by Europe in this round.",
    };
  }
  return {
    round: 1,
    title: "No Event",
    description: "Round 1 begins with no special event in effect.",
  };
}

function valuesForNation(lobby, nationId) {
  const base = clone(TEAM_VALUES[nationId]);
  if (lobby.round === 2) {
    base.nutmeg += 5;
  }
  if (lobby.round === 3 && nationId === "southeastAsia") {
    base.nutmeg = 0;
  }
  return base;
}

function calculatePoints(values, inventory) {
  return RESOURCE_KEYS.reduce((sum, key) => sum + values[key] * inventory[key], 0);
}

function getTeamView(lobby, nationId) {
  const team = lobby.teams[nationId];
  const teamValues = valuesForNation(lobby, nationId);
  const pendingIncoming = lobby.trades
    .filter((trade) => trade.toNationId === nationId && trade.status === "pending")
    .map(publicTrade);
  const pendingOutgoing = lobby.trades
    .filter(
      (trade) =>
        trade.fromNationId === nationId &&
        ["pending", "awaiting_europe"].includes(trade.status)
    )
    .map(publicTrade);
  const approvalQueue =
    nationId === "europe"
      ? lobby.trades
          .filter((trade) => trade.status === "awaiting_europe")
          .map(publicTrade)
      : [];

  return {
    role: "team",
    lobby: {
      id: lobby.id,
      name: lobby.name,
      state: lobby.state,
      round: lobby.round,
      totalRounds: lobby.totalRounds,
      roundDurationSeconds: lobby.roundDurationSeconds,
      roundEndsAt: lobby.roundEndsAt,
      currentEvent: lobby.currentEvent,
      canTrade: lobby.state === "round-active",
      europeBlockUsedInRound: lobby.europeBlockUsedInRound,
      resultsShown: lobby.resultsShown,
    },
    team: {
      id: team.id,
      name: team.name,
      goal: team.goal,
      inventory: team.inventory,
      values: teamValues,
      points: calculatePoints(teamValues, team.inventory),
    },
    nations: Object.values(lobby.teams)
      .filter((other) => other.id !== nationId)
      .map((other) => ({ id: other.id, name: other.name })),
    pendingIncoming,
    pendingOutgoing,
    approvalQueue,
    notifications: lobby.notifications[nationId] || [],
    recentTrades: lobby.trades.slice(-10).map(publicTrade),
    gameResult: lobby.resultsShown ? lobby.finalResults : null,
  };
}

function getHostView(lobby) {
  return {
    role: "host",
    lobby: {
      id: lobby.id,
      name: lobby.name,
      state: lobby.state,
      round: lobby.round,
      totalRounds: lobby.totalRounds,
      roundDurationSeconds: lobby.roundDurationSeconds,
      roundEndsAt: lobby.roundEndsAt,
      currentEvent: lobby.currentEvent,
      europeBlockUsedInRound: lobby.europeBlockUsedInRound,
      resultsShown: lobby.resultsShown,
    },
    teams: Object.values(lobby.teams).map((team) => ({
      ...team,
      points: calculatePoints(valuesForNation(lobby, team.id), team.inventory),
      values: valuesForNation(lobby, team.id),
    })),
    trades: lobby.trades.map(publicTrade),
    settingsDraft: lobby.settingsDraft,
    results: lobby.resultsShown ? lobby.finalResults : null,
  };
}

function calculateFinalResults(lobby) {
  return Object.values(lobby.teams)
    .map((team) => ({
      nationId: team.id,
      nationName: team.name,
      points: calculatePoints(
        team.id === "southeastAsia"
          ? { ...ENDGAME_VALUES, nutmeg: 0 }
          : ENDGAME_VALUES,
        team.inventory
      ),
      inventory: clone(team.inventory),
    }))
    .sort((a, b) => b.points - a.points)
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));
}

function assertLobbyState(lobby, expectedState) {
  if (lobby.state !== expectedState) {
    throw new Error(`Lobby must be in ${expectedState} state.`);
  }
}

function ensureTeamSession(session) {
  if (!session || session.role !== "team") {
    throw new Error("Team session required.");
  }
}

function ensureHostSession(session) {
  if (!session || session.role !== "host") {
    throw new Error("Host session required.");
  }
}

function startRound(lobby) {
  if (lobby.round >= lobby.totalRounds) {
    throw new Error("All rounds are complete.");
  }
  lobby.round += 1;
  if (lobby.round >= 2) {
    lobby.teams.china.inventory.porcelain += 3;
    lobby.teams.europe.inventory.cowrie += 20;
    lobby.teams.europe.inventory.ivory += 2;
    lobby.teams.europe.inventory.silver += 2;
    lobby.teams.europe.inventory.porcelain += 2;
    lobby.teams.europe.inventory.nutmeg += 2;
    lobby.teams.southeastAsia.inventory.nutmeg += 4;
    lobby.teams.westAfrica.inventory.ivory += 3;
    pushNotification(
      lobby,
      "china",
      `Round ${lobby.round} start: China received +3 Porcelain.`
    );
    pushNotification(
      lobby,
      "europe",
      `Round ${lobby.round} start: Europe received +20 Cowrie, +2 Ivory, +2 Silver, +2 Porcelain, and +2 Nutmeg.`
    );
    pushNotification(
      lobby,
      "southeastAsia",
      `Round ${lobby.round} start: Southeast Asia received +4 Nutmeg.`
    );
    pushNotification(
      lobby,
      "westAfrica",
      `Round ${lobby.round} start: West Africa received +3 Ivory.`
    );
  }
  lobby.state = "round-active";
  lobby.roundEndsAt = Date.now() + lobby.roundDurationSeconds * 1000;
  lobby.europeBlockUsedInRound = false;
  lobby.currentEvent = currentEventForRound(lobby.round);
  markUpdated(lobby);
}

function finishRound(lobby) {
  if (lobby.state !== "round-active") {
    return;
  }
  if (lobby.round === 3) {
    transferRemainingNutmegToEurope(lobby);
  }
  lobby.state = lobby.round >= lobby.totalRounds ? "awaiting-results" : "between-rounds";
  lobby.roundEndsAt = null;
  resolveExpiredPendingTrades(lobby);
  markUpdated(lobby);
}

function pushNotification(lobby, nationId, message) {
  if (!lobby.notifications[nationId]) {
    return;
  }
  lobby.notifications[nationId].push({
    id: `${lobby.nextNotificationId++}`,
    message,
    createdAt: Date.now(),
  });
  lobby.notifications[nationId] = lobby.notifications[nationId].slice(-20);
}

function transferRemainingNutmegToEurope(lobby) {
  const southeastAsia = lobby.teams.southeastAsia;
  const europe = lobby.teams.europe;
  if (!southeastAsia || !europe || southeastAsia.inventory.nutmeg <= 0) {
    return;
  }
  const transferredNutmeg = southeastAsia.inventory.nutmeg;
  southeastAsia.inventory.nutmeg = 0;
  europe.inventory.nutmeg += transferredNutmeg;
  pushNotification(
    lobby,
    "southeastAsia",
    `VOC Monopoly: Europe seized your remaining ${transferredNutmeg} nutmeg at the end of the round.`
  );
  pushNotification(
    lobby,
    "europe",
    `VOC Monopoly: Europe received ${transferredNutmeg} nutmeg from Southeast Asia at the end of the round.`
  );
}

function resolveExpiredPendingTrades(lobby) {
  for (const trade of lobby.trades) {
    if (["pending", "awaiting_europe"].includes(trade.status)) {
      trade.status = "expired";
      trade.respondedAt = Date.now();
      trade.settledAt = Date.now();
    }
  }
}

function validateOfferShape(offer) {
  for (const side of ["from", "to"]) {
    if (!offer[side]) {
      throw new Error("Offer is missing one side of the trade.");
    }
    for (const key of TRADE_KEYS) {
      const value = Number(offer[side][key] || 0);
      if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
        throw new Error("Trade quantities must be whole numbers.");
      }
    }
  }
}

function totalDisplayedValue(offerSide, values) {
  return TRADE_KEYS.reduce((sum, key) => sum + offerSide[key] * values[key], 0);
}

function ensureTradeHasValue(lobby, fromNationId, toNationId, offer) {
  const fromValue = totalDisplayedValue(offer.from, valuesForNation(lobby, fromNationId));
  const toValue = totalDisplayedValue(offer.to, valuesForNation(lobby, toNationId));
  const southeastAsiaForcedSale =
    lobby.round === 3 &&
    ((fromNationId === "southeastAsia" && offer.from.nutmeg > 0) ||
      (toNationId === "southeastAsia" && offer.to.nutmeg > 0));
  if ((fromValue < 1 || toValue < 1) && !southeastAsiaForcedSale) {
    throw new Error("Each side of a trade must include at least one resource worth 1 point or more to the region offering it.");
  }
}

function ensureRoundThreeNutmegRule(lobby, fromNationId, toNationId, offer) {
  if (lobby.round !== 3) {
    return;
  }
  const southeastAsiaOffersNutmegToNonEurope =
    fromNationId === "southeastAsia" &&
    toNationId !== "europe" &&
    offer.from.nutmeg > 0;
  const nonEuropeRequestsNutmegFromSoutheastAsia =
    toNationId === "southeastAsia" &&
    fromNationId !== "europe" &&
    offer.to.nutmeg > 0;
  if (southeastAsiaOffersNutmegToNonEurope || nonEuropeRequestsNutmegFromSoutheastAsia) {
    throw new Error("In round 3, Southeast Asia can only trade Nutmeg with Europe.");
  }
}

function ensureInventoryCanCover(inventory, offerSide) {
  for (const key of TRADE_KEYS) {
    if (offerSide[key] > inventory[key]) {
      throw new Error("Insufficient resources to complete trade.");
    }
  }
}

function hasPendingTradeBetween(lobby, nationA, nationB) {
  return lobby.trades.some(
    (trade) =>
      ["pending", "awaiting_europe"].includes(trade.status) &&
      ((trade.fromNationId === nationA && trade.toNationId === nationB) ||
        (trade.fromNationId === nationB && trade.toNationId === nationA))
  );
}

function applyTrade(lobby, trade) {
  const fromTeam = lobby.teams[trade.fromNationId];
  const toTeam = lobby.teams[trade.toNationId];
  ensureInventoryCanCover(fromTeam.inventory, trade.offer.from);
  ensureInventoryCanCover(toTeam.inventory, trade.offer.to);

  for (const key of TRADE_KEYS) {
    fromTeam.inventory[key] -= trade.offer.from[key];
    toTeam.inventory[key] += trade.offer.from[key];
    toTeam.inventory[key] -= trade.offer.to[key];
    fromTeam.inventory[key] += trade.offer.to[key];
  }

  trade.status = "accepted";
  trade.settledAt = Date.now();
  markUpdated(lobby);
}

function resetLobby(lobby) {
  lobby.state = "lobby";
  lobby.round = 0;
  lobby.roundEndsAt = null;
  lobby.teams = clone(DEFAULT_TEAMS);
  for (const team of Object.values(lobby.teams)) {
    team.inventory = clone(lobby.settingsDraft.teamInventories[team.id]);
  }
  lobby.currentEvent = currentEventForRound(0);
  lobby.trades = [];
  lobby.nextTradeId = 1;
  lobby.notifications = Object.fromEntries(
    Object.keys(lobby.teams).map((teamId) => [teamId, []])
  );
  lobby.nextNotificationId = 1;
  lobby.europeBlockUsedInRound = false;
  lobby.resultsShown = false;
  lobby.finalResults = null;
  for (const [token, session] of sessions.entries()) {
    if (session.lobbyId === lobby.id && session.role === "team" && !lobby.teams[session.nationId]) {
      sessions.delete(token);
    }
  }
  markUpdated(lobby);
}

function handleApiRequest(req, res, reqUrl) {
  const pathname = reqUrl.pathname;
  if (req.method === "GET" && pathname === "/api/bootstrap") {
    sendJson(res, 200, { lobbies: Array.from(lobbies.values()).map(summarizeLobby) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/session/host") {
    readBody(req)
      .then((body) => {
        const lobby = getLobby(body.lobbyId);
        const token = crypto.randomUUID();
        sessions.set(token, { token, role: "host", lobbyId: lobby.id });
        sendJson(res, 200, { token });
      })
      .catch((error) => sendJson(res, 400, { error: error.message }));
    return;
  }

  if (req.method === "POST" && pathname === "/api/session/join") {
    readBody(req)
      .then((body) => {
        const lobby = getLobby(body.lobbyId);
        const nationId = body.nationId;
        if (!lobby.teams[nationId]) {
          throw new Error("Unknown region.");
        }
        if (sessionsClaimLobbyNation(lobby.id, nationId)) {
          throw new Error("That region has already been claimed in this lobby.");
        }
        const token = crypto.randomUUID();
        sessions.set(token, { token, role: "team", lobbyId: lobby.id, nationId });
        markUpdated(lobby);
        sendJson(res, 200, { token });
      })
      .catch((error) => sendJson(res, 400, { error: error.message }));
    return;
  }

  if (req.method === "POST" && pathname === "/api/session/logout") {
    readBody(req)
      .then((body) => {
        if (!body.token || !sessions.has(body.token)) {
          sendJson(res, 200, { ok: true });
          return;
        }
        const session = sessions.get(body.token);
        sessions.delete(body.token);
        if (session.lobbyId && lobbies.has(session.lobbyId)) {
          markUpdated(lobbies.get(session.lobbyId));
        }
        sendJson(res, 200, { ok: true });
      })
      .catch((error) => sendJson(res, 400, { error: error.message }));
    return;
  }

  if (req.method === "GET" && pathname === "/api/state") {
    try {
      const session = getSession(reqUrl);
      if (!session) {
        throw new Error("Session not found.");
      }
      const lobby = getLobby(session.lobbyId);
      const payload =
        session.role === "host"
          ? getHostView(lobby)
          : getTeamView(lobby, session.nationId);
      sendJson(res, 200, payload);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/host/action") {
    readBody(req)
      .then((body) => {
        const session = sessions.get(body.token);
        ensureHostSession(session);
        const lobby = getLobby(session.lobbyId);
        if (body.action === "startRound") {
          if (!["lobby", "between-rounds"].includes(lobby.state)) {
            throw new Error("Round can only start from the lobby or between rounds.");
          }
          startRound(lobby);
        } else if (body.action === "endRoundNow") {
          if (lobby.state !== "round-active") {
            throw new Error("Only an active round can be ended immediately.");
          }
          finishRound(lobby);
        } else if (body.action === "resetLobby") {
          resetLobby(lobby);
        } else if (body.action === "showResults") {
          if (lobby.state !== "awaiting-results") {
            throw new Error("Results can only be shown after round 3 ends.");
          }
          lobby.resultsShown = true;
          lobby.finalResults = calculateFinalResults(lobby);
          lobby.currentEvent = {
            round: lobby.round,
            title: "Cowrie Collapse",
            description: "Cowrie value drops to 0.5.",
          };
          lobby.state = "game-over";
          markUpdated(lobby);
        } else if (body.action === "updateSettings") {
          if (lobby.state === "round-active") {
            throw new Error("Settings cannot be changed during an active round.");
          }
          const nextInventories = body.settings.teamInventories;
          for (const teamId of Object.keys(lobby.teams)) {
            for (const key of RESOURCE_KEYS) {
              const value = Number(nextInventories[teamId][key]);
              if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
                throw new Error("Starting quantities must be whole numbers.");
              }
            }
          }
          lobby.settingsDraft = {
            teamInventories: clone(nextInventories),
          };
          resetLobby(lobby);
        } else {
          throw new Error("Unknown host action.");
        }
        sendJson(res, 200, { ok: true });
      })
      .catch((error) => sendJson(res, 400, { error: error.message }));
    return;
  }

  if (req.method === "POST" && pathname === "/api/trades/propose") {
    readBody(req)
      .then((body) => {
        const session = sessions.get(body.token);
        ensureTeamSession(session);
        const lobby = getLobby(session.lobbyId);
        assertLobbyState(lobby, "round-active");
        const fromNationId = session.nationId;
        const toNationId = body.toNationId;
        if (fromNationId === toNationId) {
          throw new Error("Cannot trade with the same region.");
        }
        if (!lobby.teams[toNationId]) {
          throw new Error("Target region not found.");
        }
        if (hasPendingTradeBetween(lobby, fromNationId, toNationId)) {
          throw new Error("Trade offer already in progress with this region.");
        }
        const offer = body.offer;
        validateOfferShape(offer);
        ensureRoundThreeNutmegRule(lobby, fromNationId, toNationId, offer);
        ensureTradeHasValue(lobby, fromNationId, toNationId, offer);
        ensureInventoryCanCover(lobby.teams[fromNationId].inventory, offer.from);
        const trade = {
          id: String(lobby.nextTradeId++),
          lobbyId: lobby.id,
          fromNationId,
          toNationId,
          offer,
          status: "pending",
          createdAt: Date.now(),
        };
        lobby.trades.push(trade);
        markUpdated(lobby);
        sendJson(res, 200, { trade: publicTrade(trade) });
      })
      .catch((error) => sendJson(res, 400, { error: error.message }));
    return;
  }

  if (req.method === "POST" && pathname === "/api/trades/respond") {
    readBody(req)
      .then((body) => {
        const session = sessions.get(body.token);
        ensureTeamSession(session);
        const lobby = getLobby(session.lobbyId);
        const trade = lobby.trades.find((entry) => entry.id === String(body.tradeId));
        if (!trade) {
          throw new Error("Trade not found.");
        }
        if (trade.toNationId !== session.nationId) {
          throw new Error("Only the receiving region can respond to this trade.");
        }
        if (trade.status !== "pending") {
          throw new Error("This trade is no longer pending.");
        }
        if (body.decision === "reject") {
          trade.status = "rejected";
          trade.respondedAt = Date.now();
          trade.settledAt = Date.now();
          pushNotification(
            lobby,
            trade.fromNationId,
            `${labelNation(trade.toNationId)} rejected your trade offer.`
          );
          markUpdated(lobby);
          sendJson(res, 200, { ok: true });
          return;
        }
        if (body.decision !== "accept") {
          throw new Error("Unknown trade response.");
        }
        ensureInventoryCanCover(lobby.teams[trade.fromNationId].inventory, trade.offer.from);
        ensureInventoryCanCover(lobby.teams[trade.toNationId].inventory, trade.offer.to);

        trade.respondedAt = Date.now();
        if (
          lobby.round === 3 &&
          trade.fromNationId !== "europe" &&
          trade.toNationId !== "europe"
        ) {
          trade.status = "awaiting_europe";
          pushNotification(
            lobby,
            trade.fromNationId,
            `Your trade with ${labelNation(trade.toNationId)} is waiting for Europe to approve it.`
          );
          pushNotification(
            lobby,
            trade.toNationId,
            `Europe must approve the trade with ${labelNation(trade.fromNationId)} before it can go through.`
          );
          markUpdated(lobby);
          sendJson(res, 200, { ok: true, awaitingEurope: true });
          return;
        }

        applyTrade(lobby, trade);
        pushNotification(
          lobby,
          trade.fromNationId,
          `${labelNation(trade.toNationId)} accepted your trade offer.`
        );
        sendJson(res, 200, { ok: true });
      })
      .catch((error) => sendJson(res, 400, { error: error.message }));
    return;
  }

  if (req.method === "POST" && pathname === "/api/trades/europe") {
    readBody(req)
      .then((body) => {
        const session = sessions.get(body.token);
        ensureTeamSession(session);
        if (session.nationId !== "europe") {
          throw new Error("Only Europe can approve or block these trades.");
        }
        const lobby = getLobby(session.lobbyId);
        const trade = lobby.trades.find((entry) => entry.id === String(body.tradeId));
        if (!trade || trade.status !== "awaiting_europe") {
          throw new Error("Trade is not waiting for Europe.");
        }
        if (body.decision === "approve") {
          applyTrade(lobby, trade);
          pushNotification(
            lobby,
            trade.fromNationId,
            `Europe approved the trade with ${labelNation(trade.toNationId)}.`
          );
          pushNotification(
            lobby,
            trade.toNationId,
            `Europe approved the trade with ${labelNation(trade.fromNationId)}.`
          );
          sendJson(res, 200, { ok: true });
          return;
        }
        if (body.decision === "block") {
          trade.status = "blocked";
          trade.settledAt = Date.now();
          pushNotification(
            lobby,
            trade.fromNationId,
            `Europe blocked the trade with ${labelNation(trade.toNationId)}.`
          );
          pushNotification(
            lobby,
            trade.toNationId,
            `Europe blocked the trade with ${labelNation(trade.fromNationId)}.`
          );
          markUpdated(lobby);
          sendJson(res, 200, { ok: true });
          return;
        }
        throw new Error("Unknown Europe decision.");
      })
      .catch((error) => sendJson(res, 400, { error: error.message }));
    return;
  }

  sendJson(res, 404, { error: "Not found." });
}

function labelNation(nationId) {
  return {
    southeastAsia: "Southeast Asia",
    china: "China",
    westAfrica: "West Africa",
    europe: "Europe",
  }[nationId] || nationId;
}

function serveStatic(req, res, reqUrl) {
  let filePath = reqUrl.pathname === "/" ? "/index.html" : reqUrl.pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.join(PUBLIC_DIR, filePath);
  if (!absolutePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(absolutePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(absolutePath);
    const contentType =
      {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
      }[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  });
}

setInterval(() => {
  const now = Date.now();
  for (const lobby of lobbies.values()) {
    if (lobby.state === "round-active" && lobby.roundEndsAt && now >= lobby.roundEndsAt) {
      finishRound(lobby);
    }
  }
}, 500);

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  if (reqUrl.pathname.startsWith("/api/")) {
    handleApiRequest(req, res, reqUrl);
    return;
  }
  serveStatic(req, res, reqUrl);
});

server.listen(PORT, HOST, () => {
  console.log(`JOL history trade game running on http://${HOST}:${PORT}`);
});
