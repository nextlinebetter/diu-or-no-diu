"use strict";

const originalDealOrNoDealAmounts = [
  0.01, 1, 5, 10, 25, 50, 75, 100, 200, 300, 400, 500, 750,
  1000, 5000, 10000, 25000, 50000, 75000, 100000, 200000,
  300000, 400000, 500000, 750000, 1000000
];

const defaultAmounts = originalDealOrNoDealAmounts.map((amount) => Number((amount / 1000).toFixed(5)));

const naiveOfferFunction = `function bankerOffer(ctx) {
  const remaining = ctx.remainingAmounts;
  const average = remaining.reduce((sum, value) => sum + value, 0) / remaining.length;
  const max = Math.max(...remaining);
  const roundPressure = 0.52 + ctx.roundIndex * 0.075;
  const riskDiscount = 1 - Math.min(max / Math.max(average, 1), 8) * 0.018;
  return Math.round(average * roundPressure * riskDiscount);
}`;

const percentileOfferFunction = `function bankerOffer(ctx) {
  const baseRates = [0.25, 0.34, 0.43, 0.52, 0.61, 0.70, 0.80, 0.90, 1.00];
  const alpha = 0.35;
  const remaining = [...ctx.remainingAmounts].sort((a, b) => a - b);
  const ev = remaining.reduce((sum, value) => sum + value, 0) / remaining.length;
  const playerAmount = ctx.playerCaseAmount;
  const playerRank = remaining.filter((value) => value <= playerAmount).length;
  const q = playerRank / remaining.length;
  const baseRate = baseRates[Math.min(ctx.roundIndex, baseRates.length - 1)];
  const noise = 0.85 + Math.random() * 0.30;
  const maxFactor = 1.35;
  const minFactor = 0.70;
  const rawFactor = 1 + alpha * (q - 0.5) * 2;
  const factor = Math.min(maxFactor, Math.max(minFactor, rawFactor));
  return Math.round(ev * baseRate * factor * noise);
}`;

const bankerFunctionTemplates = {
  classic: naiveOfferFunction,
  percentile: percentileOfferFunction
};

const selectors = {
  amountInput: document.querySelector("#amountInput"),
  bankerModeInputs: document.querySelectorAll("input[name='bankerMode']"),
  caseAmountList: document.querySelector("#caseAmountList"),
  offerInput: document.querySelector("#offerInput"),
  lowMoneyBoard: document.querySelector("#lowMoneyBoard"),
  highMoneyBoard: document.querySelector("#highMoneyBoard"),
  caseGrid: document.querySelector("#caseGrid"),
  messageText: document.querySelector("#messageText"),
  primaryAction: document.querySelector("#primaryAction"),
  resetConfig: document.querySelector("#resetConfig"),
  phaseLabel: document.querySelector("#phaseLabel"),
  playerCaseLabel: document.querySelector("#playerCaseLabel"),
  roundLabel: document.querySelector("#roundLabel"),
  offerValue: document.querySelector("#offerValue"),
  dealButton: document.querySelector("#dealButton"),
  noDealButton: document.querySelector("#noDealButton"),
  historyList: document.querySelector("#historyList")
};

let game = createEmptyGame();
let audioContext = null;
const audioFiles = {
  good: createAudioElement("sounds/cheer.wav"),
  bad: createAudioElement("sounds/sad.wav")
};

function createEmptyGame() {
  return {
    phase: "config",
    cases: [],
    amounts: [],
    openedCaseIds: new Set(),
    playerCaseId: null,
    roundIndex: 0,
    picksRemaining: 0,
    offer: null,
    lastOffer: null,
    history: [],
    bankerOffer: null
  };
}

function formatMoney(value) {
  const formatted = new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 5
  }).format(value);
  return `¥${formatted}`;
}

function parseAmounts(raw) {
  const amounts = raw
    .split(/[\s,，;；]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => Number(part.replace(/[￥¥,_]/g, "")));

  if (amounts.length < 4) {
    throw new Error("至少需要 4 个金额。");
  }

  if (amounts.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("金额必须是非负数字。");
  }

  return amounts;
}

function compileBankerOffer(source) {
  const factory = new Function(`${source}; return bankerOffer;`);
  const fn = factory();
  if (typeof fn !== "function") {
    throw new Error("需要声明 function bankerOffer(ctx)。");
  }
  return fn;
}

function shuffle(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function picksForRound(roundIndex, caseCount) {
  const pattern = caseCount >= 20 ? [6, 5, 4, 3, 2, 1] : [3, 2, 2, 1];
  return pattern[Math.min(roundIndex, pattern.length - 1)];
}

function unopenedPlayableCases() {
  return game.cases.filter((item) => item.id !== game.playerCaseId && !game.openedCaseIds.has(item.id));
}

function remainingAmounts() {
  return game.cases
    .filter((item) => !game.openedCaseIds.has(item.id))
    .map((item) => item.amount);
}

function createAudioElement(source) {
  const audio = new Audio(source);
  audio.preload = "auto";
  return audio;
}

function playAudioFile(kind) {
  const audio = audioFiles[kind];
  if (!audio) {
    return false;
  }

  audio.currentTime = 0;
  const playPromise = audio.play();
  if (!playPromise) {
    return true;
  }

  playPromise.catch(() => {
    playSynthResultSound(kind === "good");
  });
  return true;
}

function getAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return null;
  }

  if (!audioContext) {
    audioContext = new AudioContextClass();
  }

  if (audioContext.state === "suspended") {
    audioContext.resume();
  }

  return audioContext;
}

function playTone(frequency, startTime, duration, volume, type = "sine") {
  const context = getAudioContext();
  if (!context) {
    return;
  }

  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startTime);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.02);
}

function playSynthResultSound(isGoodOpen) {
  const context = getAudioContext();
  if (!context) {
    return;
  }

  const now = context.currentTime;
  if (isGoodOpen) {
    playTone(523.25, now, 0.12, 0.08, "triangle");
    playTone(659.25, now + 0.1, 0.12, 0.08, "triangle");
    playTone(783.99, now + 0.2, 0.18, 0.09, "triangle");
    playTone(1046.5, now + 0.34, 0.16, 0.06, "sine");
    return;
  }

  playTone(392, now, 0.18, 0.07, "sawtooth");
  playTone(329.63, now + 0.16, 0.2, 0.065, "sawtooth");
  playTone(261.63, now + 0.34, 0.28, 0.06, "triangle");
}

function playOpenResultSound(isGoodOpen) {
  const kind = isGoodOpen ? "good" : "bad";
  if (playAudioFile(kind)) {
    return;
  }

  playSynthResultSound(isGoodOpen);
}

function isGoodOpenedAmount(amount) {
  if (game.lastOffer !== null) {
    return amount <= game.lastOffer;
  }

  const values = game.amounts.length ? game.amounts : defaultAmounts;
  const splitIndex = Math.ceil(values.length / 2);
  const highestLowSideAmount = values[splitIndex - 1];
  return amount <= highestLowSideAmount;
}

function setMessage(text) {
  selectors.messageText.textContent = text;
}

function setPhase(phase) {
  game.phase = phase;
  const labels = {
    config: "配置",
    choosing: "选箱",
    opening: "开箱",
    offer: "报价",
    final: "终局"
  };
  selectors.phaseLabel.textContent = labels[phase] || phase;
}

function setBankerMode(mode) {
  const template = bankerFunctionTemplates[mode];
  if (!template) {
    return;
  }

  selectors.offerInput.value = template;
  selectors.bankerModeInputs.forEach((input) => {
    input.checked = input.value === mode;
  });
}

function startGame() {
  try {
    const amounts = parseAmounts(selectors.amountInput.value);
    const bankerOffer = compileBankerOffer(selectors.offerInput.value);
    const shuffled = shuffle(amounts);
    game = {
      ...createEmptyGame(),
      phase: "choosing",
      amounts: [...amounts].sort((a, b) => a - b),
      cases: shuffled.map((amount, index) => ({ id: index + 1, amount })),
      bankerOffer
    };
    setPhase("choosing");
    selectors.primaryAction.textContent = "重新开始";
    selectors.playerCaseLabel.textContent = "-";
    selectors.roundLabel.textContent = "-";
    selectors.offerValue.textContent = "-";
    setOfferButtons(false);
    setMessage("选择一个箱子留到最后。");
    render();
  } catch (error) {
    setMessage(error.message);
  }
}

function chooseCase(caseId) {
  game.playerCaseId = caseId;
  game.roundIndex = 0;
  game.picksRemaining = Math.min(picksForRound(0, game.cases.length), unopenedPlayableCases().length);
  selectors.playerCaseLabel.textContent = String(caseId);
  selectors.roundLabel.textContent = `${game.roundIndex + 1}`;
  setPhase("opening");
  setMessage(`打开 ${game.picksRemaining} 个箱子。`);
  render();
}

function openCase(caseId) {
  const selected = game.cases.find((item) => item.id === caseId);
  if (!selected || selected.id === game.playerCaseId || game.openedCaseIds.has(caseId)) {
    return;
  }

  game.openedCaseIds.add(caseId);
  game.picksRemaining -= 1;
  game.history.unshift(`箱子 ${caseId}: ${formatMoney(selected.amount)}`);
  playOpenResultSound(isGoodOpenedAmount(selected.amount));

  if (unopenedPlayableCases().length === 0) {
    revealFinal(false);
    return;
  }

  if (game.picksRemaining <= 0) {
    makeOffer();
  } else {
    setMessage(`继续打开 ${game.picksRemaining} 个箱子。`);
  }

  render();
}

function makeOffer() {
  const ctx = {
    remainingAmounts: remainingAmounts(),
    openedAmounts: game.cases.filter((item) => game.openedCaseIds.has(item.id)).map((item) => item.amount),
    playerCaseAmount: game.cases.find((item) => item.id === game.playerCaseId)?.amount,
    roundIndex: game.roundIndex,
    caseCount: game.cases.length,
    openedCount: game.openedCaseIds.size
  };

  try {
    const value = Number(game.bankerOffer(ctx));
    if (!Number.isFinite(value) || value < 0) {
      throw new Error("Banker 函数必须返回非负数字。");
    }
    game.offer = Math.round(value * 100000) / 100000;
    game.lastOffer = game.offer;
    game.history.unshift(`Banker: ${formatMoney(game.offer)}`);
    selectors.offerValue.textContent = formatMoney(game.offer);
    setPhase("offer");
    setOfferButtons(true);
    setMessage("Banker 已报价。");
  } catch (error) {
    setMessage(error.message);
    setPhase("opening");
  }
}

function acceptDeal() {
  game.history.unshift(`Deal: ${formatMoney(game.offer)}`);
  revealFinal(true);
}

function declineDeal() {
  game.roundIndex += 1;
  game.picksRemaining = Math.min(picksForRound(game.roundIndex, game.cases.length), unopenedPlayableCases().length);
  game.offer = null;
  selectors.offerValue.textContent = "-";
  selectors.roundLabel.textContent = `${game.roundIndex + 1}`;
  setOfferButtons(false);
  setPhase("opening");
  setMessage(`No Deal。打开 ${game.picksRemaining} 个箱子。`);
  render();
}

function revealFinal(tookDeal) {
  const playerCase = game.cases.find((item) => item.id === game.playerCaseId);
  setPhase("final");
  setOfferButtons(false);
  selectors.offerValue.textContent = tookDeal ? formatMoney(game.offer) : formatMoney(playerCase.amount);
  game.history.unshift(`你的箱子 ${game.playerCaseId}: ${formatMoney(playerCase.amount)}`);
  setMessage(tookDeal
    ? `成交金额 ${formatMoney(game.offer)}。你的箱子里是 ${formatMoney(playerCase.amount)}。`
    : `最终打开你的箱子：${formatMoney(playerCase.amount)}。`);
  render();
}

function setOfferButtons(enabled) {
  selectors.dealButton.disabled = !enabled;
  selectors.noDealButton.disabled = !enabled;
}

function handleCaseClick(caseId) {
  if (game.phase === "choosing") {
    chooseCase(caseId);
  } else if (game.phase === "opening") {
    openCase(caseId);
  }
}

function renderMoneyBoard() {
  const openedAmounts = new Set(
    game.cases.filter((item) => game.openedCaseIds.has(item.id)).map((item) => item.amount)
  );
  const values = game.amounts.length ? game.amounts : defaultAmounts;
  const splitIndex = Math.ceil(values.length / 2);

  selectors.lowMoneyBoard.innerHTML = "";
  selectors.highMoneyBoard.innerHTML = "";

  renderMoneyColumn(selectors.lowMoneyBoard, values.slice(0, splitIndex), openedAmounts);
  renderMoneyColumn(selectors.highMoneyBoard, values.slice(splitIndex), openedAmounts);
}

function renderMoneyColumn(container, values, openedAmounts) {
  values.forEach((amount) => {
    const tile = document.createElement("div");
    tile.className = `money-tile${openedAmounts.has(amount) ? " opened" : ""}`;
    tile.innerHTML = `<span>${formatMoney(amount)}</span>`;
    container.append(tile);
  });
}

function renderCases() {
  selectors.caseGrid.innerHTML = "";
  const cases = game.cases.length
    ? game.cases
    : defaultAmounts.map((amount, index) => ({ id: index + 1, amount }));

  cases.forEach((item) => {
    const isOpened = game.openedCaseIds.has(item.id) || game.phase === "final";
    const isPlayer = item.id === game.playerCaseId;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `case${isOpened ? " opened" : ""}${isPlayer ? " player" : ""}`;
    button.disabled = game.phase === "config"
      || game.phase === "offer"
      || game.phase === "final"
      || isOpened
      || (game.phase === "opening" && isPlayer);
    button.innerHTML = `
      <span class="case-value">${isOpened ? formatMoney(item.amount) : ""}</span>
      <span class="case-number">${item.id}</span>
    `;
    button.addEventListener("click", () => handleCaseClick(item.id));
    selectors.caseGrid.append(button);
  });
}

function renderHistory() {
  selectors.historyList.innerHTML = "";
  game.history.slice(0, 9).forEach((entry) => {
    const item = document.createElement("li");
    item.textContent = entry;
    selectors.historyList.append(item);
  });
}

function renderCaseAmountList() {
  selectors.caseAmountList.innerHTML = "";

  if (!game.cases.length) {
    const empty = document.createElement("p");
    empty.className = "case-amount-empty";
    empty.textContent = "开始新局后显示每个箱子的实际金额。";
    selectors.caseAmountList.append(empty);
    return;
  }

  game.cases.forEach((item) => {
    const row = document.createElement("div");
    row.className = "case-amount-row";
    row.innerHTML = `
      <span>箱子 ${item.id}</span>
      <strong>${formatMoney(item.amount)}</strong>
    `;
    selectors.caseAmountList.append(row);
  });
}

function render() {
  renderMoneyBoard();
  renderCases();
  renderHistory();
  renderCaseAmountList();
}

function resetConfig() {
  selectors.amountInput.value = defaultAmounts.join("\n");
  setBankerMode("percentile");
  setMessage("默认配置已恢复。");
}

selectors.primaryAction.addEventListener("click", startGame);
selectors.resetConfig.addEventListener("click", resetConfig);
selectors.dealButton.addEventListener("click", acceptDeal);
selectors.noDealButton.addEventListener("click", declineDeal);
selectors.bankerModeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    if (input.checked) {
      setBankerMode(input.value);
    }
  });
});

resetConfig();
render();
